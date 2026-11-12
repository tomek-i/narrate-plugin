import type { BrowserContext, Page, Request, Route } from "playwright";

/**
 * The origin of a URL as the guard compares it. `file:` URLs have an opaque
 * origin ("null") in the URL standard, so all local files count as one origin,
 * `file://`. Throws on something that isn't an absolute URL.
 */
export function originOf(url: string): string {
  const u = new URL(url);
  return u.protocol === "file:" ? "file://" : u.origin;
}

/**
 * Whether a request navigates the recorded page itself (not an iframe or a
 * popup). `frame()` throws for a popup's first navigation, issued before its
 * frame exists — that's not the recorded page.
 */
function isMainNavigation(req: Request, page: Page): boolean {
  if (!req.isNavigationRequest()) return false;
  try {
    return req.frame() === page.mainFrame();
  } catch {
    return false;
  }
}

/** Schemes that never reach a server (inline content, the blank page). */
const LOCAL_SCHEMES = new Set(["about:", "data:", "blob:"]);

/** Thrown when the page leaves the allowed origins; the recording is discarded. */
export class OriginGuardError extends Error {
  constructor(
    message: string,
    readonly blockedUrl: string,
  ) {
    super(message);
    this.name = "OriginGuardError";
  }
}

/** Redirect hops followed for one navigation before giving up (as browsers do). */
const MAX_REDIRECTS = 20;

/**
 * Keeps a recording on the scene's own site. Every request in the browser
 * context is routed through `install`: requests to other origins are aborted, so
 * the other server never sees them.
 *
 * Navigations need more: Playwright doesn't route the redirect hops of a
 * navigation, so a 3xx from the site to another origin would be followed
 * unseen. So the guard fetches each navigation itself, one hop at a time
 * (`maxRedirects: 0`), refusing any hop to another origin. A chain that stays
 * on allowed origins is handed back to the browser as a single redirect to
 * where it ends, which the browser then loads.
 *
 * A blocked navigation of the recorded page is remembered as a violation; the
 * recorder checks after every step and every beat (`check`) and fails the render.
 */
export class OriginGuard {
  private readonly allowed: Set<string>;
  private violation: string | null = null;
  private readonly blockedOther = new Set<string>();

  constructor(
    origins: string[],
    private readonly warn: (msg: string) => void = () => {},
    /** Timeout for each hop the guard fetches itself (ms; 0 = none). */
    private readonly timeoutMs = 30000,
  ) {
    this.allowed = new Set(origins.map(originOf));
  }

  allows(url: string): boolean {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return false;
    }
    if (LOCAL_SCHEMES.has(u.protocol)) return true;
    return this.allowed.has(originOf(url));
  }

  async install(context: BrowserContext, page: Page): Promise<void> {
    await context.route("**/*", (route) => this.handle(route, page));
  }

  private async handle(route: Route, page: Page): Promise<void> {
    try {
      const req = route.request();
      const url = req.url();
      if (!this.allows(url)) {
        this.block(url, isMainNavigation(req, page));
        await route.abort("blockedbyclient");
        return;
      }
      // Subresource redirects are routed hop by hop already; only navigations
      // over http(s) need the guard to walk the chain (file: can't redirect).
      if (!req.isNavigationRequest() || !/^https?:$/.test(new URL(url).protocol)) {
        await route.continue();
        return;
      }
      await this.navigate(route, req, page);
    } catch {
      // The page or context closed mid-request (e.g. at the end of the recording).
    }
  }

  private async navigate(route: Route, req: Request, page: Page): Promise<void> {
    let current = req.url();
    let method = req.method();
    let postData = req.postDataBuffer() ?? undefined;
    let status = 0;
    // Later hops must not carry the first request's cookies to another (allowed)
    // origin; without a Cookie header, the context's cookie jar supplies each
    // hop's own cookies.
    const hopHeaders = { ...req.headers() };
    delete hopHeaders.cookie;
    let response: Awaited<ReturnType<Route["fetch"]>>;
    try {
      response = await route.fetch({ maxRedirects: 0, timeout: this.timeoutMs });
      for (let hop = 1; ; hop++) {
        const location = response.headers().location;
        if (response.status() < 300 || response.status() >= 400 || !location) break;
        const target = new URL(location, current).href;
        if (!this.allows(target)) {
          this.block(target, isMainNavigation(req, page));
          await route.abort("blockedbyclient");
          return;
        }
        if (hop > MAX_REDIRECTS) throw new Error(`more than ${MAX_REDIRECTS} redirects`);
        status = response.status();
        // 307/308 repeat the request as is; the others turn it into a GET.
        if (status !== 307 && status !== 308) {
          method = "GET";
          postData = undefined;
          delete hopHeaders["content-type"];
          delete hopHeaders["content-length"];
        }
        current = target;
        response = await route.fetch({
          url: target,
          method,
          headers: hopHeaders,
          postData,
          maxRedirects: 0,
          timeout: this.timeoutMs,
        });
      }
    } catch (err) {
      // First line only: Playwright's call log lists request headers, cookies included.
      const reason = (err instanceof Error ? err.message : String(err)).split("\n")[0];
      this.warn(`Same-origin guard: could not load ${current}: ${reason}`);
      await route.abort("failed");
      return;
    }
    if (current === req.url()) {
      await route.fulfill({ response });
      return;
    }
    // The whole chain stays on allowed origins: send the browser straight to
    // where it ends, keeping the method if the chain did (307). The browser then
    // requests that last page itself, so it is requested twice; if it redirects
    // elsewhere the second time, the page-URL checks still catch it.
    const keepMethod = method !== "GET" && (status === 307 || status === 308);
    await route.fulfill({ status: keepMethod ? 307 : 302, headers: { location: current } });
  }

  private block(url: string, isMainNav: boolean): void {
    if (isMainNav) {
      this.violation ??= url;
    } else if (!this.blockedOther.has(url)) {
      // A blocked image/script/iframe can't put another site in the video, so it
      // only warns; the page may look incomplete.
      this.blockedOther.add(url);
      this.warn(`Blocked a request to another origin: ${url}`);
    }
  }

  /** The URL the page left for, if it tried to leave or is no longer on an allowed origin. */
  private offSite(page: Page): string | null {
    if (this.violation) return this.violation;
    const current = page.url();
    // A failed load (connection refused, DNS…) shows the browser's own error
    // page; that's a network error for the step to report, not leaving the site.
    if (current.startsWith("chrome-error:") || this.allows(current)) return null;
    return current;
  }

  /** True once the page tried to leave, or is no longer on, an allowed origin. */
  violated(page: Page): boolean {
    return this.offSite(page) !== null;
  }

  /**
   * Fail if the page left (or tried to leave) the allowed origins. `where` names
   * the step or beat for the error message.
   */
  check(page: Page, where: string): void {
    const blocked = this.offSite(page);
    if (!blocked) return;
    throw new OriginGuardError(
      `Same-origin guard: ${where} tried to leave the allowed origins (${[...this.allowed].join(", ")}) for ${blocked}. ` +
        "No video was written, because the recording may show the other page.",
      blocked,
    );
  }
}
