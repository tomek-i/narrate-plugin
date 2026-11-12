import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { onInterrupt, runCleanups } from "../src/interrupt.js";
import { type TestServer, browserSkipReason, html, serve, tempDir } from "./helpers.js";

test("runCleanups runs newest first, logs failures and skips unregistered ones", async () => {
  const order: string[] = [];
  const logs: string[] = [];
  onInterrupt(() => {
    order.push("first");
  });
  const off = onInterrupt(() => {
    order.push("removed");
  });
  onInterrupt(() => {
    throw new Error("boom");
  });
  onInterrupt(async () => {
    order.push("last");
  });
  off();
  await runCleanups((m) => logs.push(m));
  assert.deepEqual(order, ["last", "first"]);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /boom/);
  // Each cleanup runs once: a second interrupt has nothing left to do.
  await runCleanups((m) => logs.push(m));
  assert.deepEqual(order, ["last", "first"]);
});

interface Proc {
  pid: number;
  ppid: number;
  name: string;
}

/** Every process on the machine, as pid / parent pid / name. */
function processes(): Proc[] {
  if (process.platform === "win32") {
    const out = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.Name)" }',
      ],
      { encoding: "utf8" },
    );
    return parse(out);
  }
  return parse(execFileSync("ps", ["-A", "-o", "pid=,ppid=,comm="], { encoding: "utf8" }));
}

function parse(out: string): Proc[] {
  return out
    .split(/\r?\n/)
    .map((l) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), name: m[3].trim() }));
}

/** All processes started (directly or not) by `root`. */
function descendants(root: number): Proc[] {
  const all = processes();
  const found: Proc[] = [];
  let parents = new Set([root]);
  while (parents.size) {
    const children = all.filter((p) => parents.has(p.ppid) && !found.some((f) => f.pid === p.pid));
    found.push(...children);
    parents = new Set(children.map((c) => c.pid));
  }
  return found;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const isBrowser = (p: Proc) => /chrom|msedge|headless_shell/i.test(p.name);

describe("an interrupted render", () => {
  const tmp = tempDir("narrate-interrupt-");
  const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
  const tsx = import.meta.resolve("tsx");
  let site: TestServer;
  let skip: string | false = "not probed";
  before(async () => {
    site = await serve((_req, res) => html(res, "<h1>Slow walkthrough</h1>"));
    skip = await browserSkipReason();
  });
  after(async () => {
    await site.close();
    tmp.cleanup();
  });

  /**
   * Start a render, wait until `ready` matches one of its processes, interrupt
   * it (SIGTERM on POSIX; the IPC path on Windows, which can't deliver SIGTERM),
   * then check it exited 143 with an empty stdout and left nothing running.
   */
  async function interruptWhen(
    name: string,
    scene: object,
    ready: (procs: Proc[]) => boolean,
    extraArgs: string[] = [],
  ) {
    const file = join(tmp.dir, `${name}.json`);
    writeFileSync(file, JSON.stringify({ name, site: site.url, ...scene }));
    const child = spawn(
      process.execPath,
      [
        "--import",
        tsx,
        cli,
        "render",
        "--json",
        "--scene",
        file,
        "--provider",
        "mock",
        ...extraArgs,
      ],
      { cwd: tmp.dir, stdio: ["ignore", "pipe", "pipe", "ipc"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => {
      stdout += d;
    });
    child.stderr?.on("data", (d) => {
      stderr += d;
    });
    const closed = once(child, "close");

    let started: Proc[] = [];
    const deadline = Date.now() + 150_000;
    while (Date.now() < deadline && child.exitCode === null) {
      started = descendants(child.pid ?? -1);
      if (ready(started)) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    assert.ok(ready(started), `never reached the point to interrupt:\n${stderr}`);
    // Take the snapshot again just before interrupting, to include late starters.
    started = descendants(child.pid ?? -1);

    if (process.platform === "win32") child.send({ type: "narrate:interrupt", signal: "SIGTERM" });
    else child.kill("SIGTERM");
    const [code] = (await closed) as [number | null];
    assert.equal(code, 143, stderr);
    assert.match(stderr, /Interrupted \(SIGTERM\)/);
    assert.equal(stdout, "", "stdout must stay empty when interrupted");
    assert.doesNotMatch(stderr, /Failed while/, "an interrupt isn't a render failure");

    // Everything it started must be gone (give the OS a moment to reap them).
    const stillRunning = () => started.filter((p) => alive(p.pid));
    const until = Date.now() + 10_000;
    while (stillRunning().length && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.deepEqual(
      stillRunning().map((p) => `${p.pid} ${p.name}`),
      [],
      "processes left running",
    );
    const ext = extraArgs.includes("--config") ? "webm" : "mp4";
    assert.ok(!existsSync(join(tmp.dir, "out", `${name}.${ext}`)), "a partial video was left");
  }

  test("while recording: stops the browser and exits 143", { timeout: 180_000 }, async (t) => {
    if (skip) return t.skip(skip);
    await interruptWhen(
      "slow",
      { beats: [{ id: "a", say: "Hello.", do: [{ action: "wait", ms: 60_000 }] }] },
      (procs) => procs.some(isBrowser),
    );
  });

  test(
    "while muxing: stops ffmpeg and removes the partial video",
    { timeout: 240_000 },
    async (t) => {
      if (skip) return t.skip(skip);
      // A ~15s webm (VP9 encodes slowly) gives a mux long enough to interrupt.
      const config = join(tmp.dir, "webm.json");
      writeFileSync(config, JSON.stringify({ output: { format: "webm" } }));
      await interruptWhen(
        "muxing",
        { beats: [{ id: "a", say: Array(40).fill("word").join(" ") }] },
        // The mux's own ffmpeg, not the recorder's (ffmpeg-win64, ffmpeg-linux, …).
        (procs) => procs.some((p) => /^ffmpeg(\.exe)?$/i.test(p.name)),
        ["--config", config],
      );
    },
  );
});
