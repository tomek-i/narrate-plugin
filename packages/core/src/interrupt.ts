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

/** How long one cleanup may take before it's abandoned (a wedged browser mustn't block exit). */
const CLEANUP_TIMEOUT_MS = 5000;

const EXIT_CODE = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 } as const;
export type InterruptSignal = keyof typeof EXIT_CODE;

/** Register a cleanup to run on interrupt; call the returned function once it's no longer needed. */
export function onInterrupt(fn: Cleanup): () => void {
  cleanups.add(fn);
  return () => {
    cleanups.delete(fn);
  };
}

/** Run every registered cleanup, newest first, each with a time limit. */
export async function runCleanups(log: (msg: string) => void): Promise<void> {
  const pending = [...cleanups].reverse();
  cleanups.clear();
  for (const fn of pending) {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(fn),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("timed out")), CLEANUP_TIMEOUT_MS);
        }),
      ]);
    } catch (err) {
      log(`⚠️  Cleanup step failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * On SIGINT/SIGTERM/SIGHUP (or the IPC message), run the cleanups and exit with
 * 130/143/129. A second signal while cleaning up exits at once. Returns a
 * function that removes the handlers.
 */
export function exitOnInterrupt(log: (msg: string) => void): () => void {
  let stopping = false;
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
