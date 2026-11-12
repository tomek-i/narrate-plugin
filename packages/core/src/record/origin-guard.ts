import type { BrowserContext, Page, Route } from "playwright";

/**
 * The origin of a URL as the guard compares it. `file:` URLs have an opaque
 * origin ("null") in the URL standard, so all local files count as one origin,
 * `file://`. Throws on something that isn't an absolute URL.
 */
export function originOf(url: string): string {
  const u = new URL(url);
  return u.protocol === "file:" ? "file://" : u.origin;
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

/**
 * Keeps a recording on the scene's own site. Every request in the browser
 * context is routed through `install`: requests to other origins are aborted, so
 * the other server never sees them. Navigations of the main page are fetched
 * without following redirects, so a 3xx to another origin is refused before the
 * browser follows it. A blocked main-page navigation is remembered as a
 * violation; the recorder checks for one after every step and at the end of
 * every beat (`check`) and fails the render.
 */
export class OriginGuard {
  private readonly allowed: Set<string>;
  private violation: string | null = null;
  private readonly blockedOther = new Set<string>();

  constructor(
    origins: string[],
    private readonly warn: (msg: string) => void = () => {},
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
    const req = route.request();
    const url = req.url();
    const isMainNav = req.isNavigationRequest() && req.frame() === page.mainFrame();
    if (!this.allows(url)) {
      this.block(url, isMainNav);
      await route.abort("blockedbyclient");
      return;
    }
    if (!isMainNav) {
      await route.continue();
      return;
    }
    // Fetch the navigation ourselves without following redirects, so a 3xx
    // `Location` to another origin can be refused before the browser follows it.
    // An allowed redirect is handed back to the browser, which follows it as a
    // new request — routed here again.
    let response: Awaited<ReturnType<Route["fetch"]>>;
    try {
      response = await route.fetch({ maxRedirects: 0 });
    } catch {
      await route.abort("failed");
      return;
    }
    const location = response.headers().location;
    if (response.status() >= 300 && response.status() < 400 && location) {
      const target = new URL(location, url).href;
      if (!this.allows(target)) {
        this.block(target, true);
        await route.abort("blockedbyclient");
        return;
      }
    }
    await route.fulfill({ response });
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

  /**
   * Fail if the page left (or tried to leave) the allowed origins. `where` names
   * the step or beat for the error message.
   */
  check(page: Page, where: string): void {
    const current = page.url();
    const blocked = this.violation ?? (this.allows(current) ? null : current);
    if (!blocked) return;
    throw new OriginGuardError(
      `Same-origin guard: ${where} tried to leave the allowed origins (${[...this.allowed].join(", ")}) for ${blocked}. ` +
        "No video was written, because the recording may show the other page.",
      blocked,
    );
  }
}
