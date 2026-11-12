/**
 * Cleanup when a render is interrupted (Ctrl+C, a caller's timeout): close the
 * browser, stop ffmpeg and remove a partial video before exiting, so no
 * Chromium or ffmpeg process is left running and no half-written file is
 * mistaken for a finished video.
 *
 * Work that starts such a process registers how to stop it with `onInterrupt`
 * and unregisters when it's done. The CLI installs `exitOnInterrupt`, which runs
 * every registered cleanup on SIGINT, SIGTERM or SIGHUP and exits with the
 * conventional 128 + signal number (and on an uncaught exception, exits 1).
 * Windows can't send those signals to another process, so a parent that spawned
 * narrate with an IPC channel can send `{ type: "narrate:interrupt" }` instead,
 * which takes the same path.
 */

type Cleanup = () => void | Promise<void>;

const cleanups = new Set<Cleanup>();
/** Synchronous last-resort kills, run as the process exits however it exits. */
const exitKills = new Set<() => void>();

let installed = false;
let stopping = false;
let logTo: (msg: string) => void = (m) => console.error(m);

/** How long one cleanup may take before it's abandoned (a wedged browser mustn't block exit). */
const CLEANUP_TIMEOUT_MS = 5000;

const EXIT_CODE = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 } as const;
export type InterruptSignal = keyof typeof EXIT_CODE;

/** True once an interrupt (or crash) is being handled: the work still running is being torn down. */
export function interrupted(): boolean {
  return stopping;
}

/** True when `exitOnInterrupt` handles signals (otherwise Playwright should handle its own). */
export function interruptHandled(): boolean {
  return installed;
}

/**
 * Register a cleanup to run on interrupt; call the returned function once it's
 * no longer needed. Registered while an interrupt is already being handled, it
 * runs at once: the work that registered it must not outlive the exit.
 */
export function onInterrupt(fn: Cleanup): () => void {
  if (stopping) {
    void runOne(fn);
    return () => {};
  }
  cleanups.add(fn);
  return () => {
    cleanups.delete(fn);
  };
}

/**
 * Register a synchronous kill that runs when the process exits, also on a
 * second, immediate interrupt that skips the cleanups. Call the returned
 * function once the process it kills has ended.
 */
export function onExitKill(fn: () => void): () => void {
  exitKills.add(fn);
  return () => {
    exitKills.delete(fn);
  };
}

process.on("exit", () => {
  for (const kill of exitKills) {
    try {
      kill();
    } catch {
      // Already gone: nothing to stop.
    }
  }
});

async function runOne(fn: Cleanup): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timed out")), CLEANUP_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    logTo(`⚠️  Cleanup step failed: ${err instanceof Error ? err.message : err}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Run every registered cleanup, newest first, each with a time limit. */
export async function runCleanups(log: (msg: string) => void): Promise<void> {
  logTo = log;
  const pending = [...cleanups].reverse();
  cleanups.clear();
  for (const fn of pending) await runOne(fn);
}

/**
 * On SIGINT/SIGTERM/SIGHUP (or the IPC message), run the cleanups and exit with
 * 130/143/129. A second signal while cleaning up exits at once. Messages go to
 * `log`, which should be stderr so `render --json` keeps stdout to its result.
 * Returns a function that removes the handlers.
 */
export function exitOnInterrupt(log: (msg: string) => void): () => void {
  installed = true;
  logTo = log;
  const stop = (signal: InterruptSignal) => {
    if (stopping) process.exit(EXIT_CODE[signal]);
    stopping = true;
    log(`\n⏹  Interrupted (${signal}): stopping the browser and ffmpeg…`);
    void runCleanups(log).finally(() => process.exit(EXIT_CODE[signal]));
  };
  const handlers = (Object.keys(EXIT_CODE) as InterruptSignal[]).map((signal) => {
    const handler = () => stop(signal);
    process.on(signal, handler);
    return [signal, handler] as const;
  });
  const onMessage = (m: unknown) => {
    if (isInterruptMessage(m)) stop(m.signal ?? "SIGTERM");
  };
  process.on("message", onMessage);
  // An unexpected exception mustn't leave the browser or ffmpeg running either.
  const onCrash = (err: unknown) => {
    if (stopping) return;
    stopping = true;
    log(`\n❌ Unexpected error: ${err instanceof Error ? (err.stack ?? err.message) : err}`);
    void runCleanups(log).finally(() => process.exit(1));
  };
  process.on("uncaughtException", onCrash);
  process.on("unhandledRejection", onCrash);
  // Don't let the listener alone keep the process alive once the work is done.
  process.channel?.unref();
  return () => {
    installed = false;
    for (const [signal, handler] of handlers) process.off(signal, handler);
    process.off("message", onMessage);
    process.off("uncaughtException", onCrash);
    process.off("unhandledRejection", onCrash);
  };
}

function isInterruptMessage(m: unknown): m is { type: string; signal?: InterruptSignal } {
  if (typeof m !== "object" || m === null) return false;
  const { type, signal } = m as { type?: unknown; signal?: unknown };
  return (
    type === "narrate:interrupt" &&
    (signal === undefined || (typeof signal === "string" && signal in EXIT_CODE))
  );
}
