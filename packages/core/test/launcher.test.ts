import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { isInstalledPlugin, writeLaunchers } from "../src/launcher.js";
import { tempDir } from "./helpers.js";

const tmp = tempDir("narrate-launcher-");
after(() => tmp.cleanup());
const bin = join(tmp.dir, "home", "bin");

/** A stand-in CLI bundle that reports its version and arguments. */
function fakeBundle(version: string): string {
  const dir = join(tmp.dir, "cache", version, "bin");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "narrate.mjs");
  writeFileSync(
    file,
    `console.log(JSON.stringify({ version: ${JSON.stringify(version)}, args: process.argv.slice(2) }));`,
  );
  return file;
}

function runLauncher(...args: string[]) {
  return spawnSync(process.execPath, [join(bin, "narrate.mjs"), ...args], { encoding: "utf8" });
}

test("the launcher forwards arguments to the bundle it points at", () => {
  const v1 = fakeBundle("1.0.0");
  assert.equal(writeLaunchers(v1, bin), true);
  assert.equal(writeLaunchers(v1, bin), false, "an up-to-date launcher isn't rewritten");
  const r = runLauncher("render", "--scene", "a b.json");
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), {
    version: "1.0.0",
    args: ["render", "--scene", "a b.json"],
  });
});

test("after an update the launcher runs the new version, and explains a removed one", () => {
  const v1 = fakeBundle("1.0.0");
  writeLaunchers(v1, bin);
  writeLaunchers(fakeBundle("2.0.0"), bin);
  assert.equal(JSON.parse(runLauncher().stdout).version, "2.0.0");

  writeLaunchers(v1, bin);
  rmSync(v1);
  const gone = runLauncher("check");
  assert.equal(gone.status, 1);
  assert.match(gone.stderr, /no longer exists/);
});

test("the shell launchers forward to narrate.mjs", () => {
  writeLaunchers(fakeBundle("3.0.0"), bin);
  const r =
    process.platform === "win32"
      ? spawnSync("cmd.exe", ["/d", "/c", join(bin, "narrate.cmd"), "check"], { encoding: "utf8" })
      : spawnSync("sh", [join(bin, "narrate"), "check"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { version: "3.0.0", args: ["check"] });
});

test("only a bundle in Claude Code's plugin cache updates the launchers on its own", () => {
  assert.ok(
    isInstalledPlugin(
      "C:\\Users\\me\\.claude\\plugins\\cache\\m\\narrate\\0.23.0\\bin\\narrate.mjs",
    ),
  );
  assert.ok(isInstalledPlugin("/home/me/.claude/plugins/cache/m/narrate/0.23.0/bin/narrate.mjs"));
  assert.ok(!isInstalledPlugin("/home/me/src/narrate-plugin/packages/plugin/bin/narrate.mjs"));
});
