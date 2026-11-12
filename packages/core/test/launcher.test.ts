import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import {
  compareVersions,
  isInstalledPlugin,
  launcherTarget,
  shouldRefresh,
  writeLaunchers,
} from "../src/launcher.js";
import { tempDir } from "./helpers.js";

// Paths with a space, a quote and non-ASCII, as user names can have.
const tmp = tempDir("narrate launcher ł'q ");
after(() => tmp.cleanup());
const bin = join(tmp.dir, "home", "bin");
// Stands in for ~/.claude, so the machine's real plugin install is never used.
const claudeHome = join(tmp.dir, "claude");

beforeEach(() => {
  rmSync(bin, { recursive: true, force: true });
  rmSync(claudeHome, { recursive: true, force: true });
});

/** A stand-in CLI bundle in a versioned cache folder that reports its version and arguments. */
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

/** Record `version` as the installed plugin, the way Claude Code does. */
function install(version: string): void {
  mkdirSync(join(claudeHome, "plugins"), { recursive: true });
  writeFileSync(
    join(claudeHome, "plugins", "installed_plugins.json"),
    JSON.stringify({
      version: 2,
      plugins: {
        "narrate@narrate-marketplace": [
          { scope: "user", installPath: join(tmp.dir, "cache", version), version },
        ],
      },
    }),
  );
}

const env = () => ({ ...process.env, CLAUDE_CONFIG_DIR: claudeHome });

function runLauncher(...args: string[]) {
  return spawnSync(process.execPath, [join(bin, "narrate.mjs"), ...args], {
    encoding: "utf8",
    env: env(),
  });
}

test("the launcher forwards arguments to the bundle it was written for", () => {
  const v1 = fakeBundle("1.0.0");
  assert.equal(writeLaunchers(v1, "1.0.0", bin), true);
  assert.equal(writeLaunchers(v1, "1.0.0", bin), false, "an up-to-date launcher isn't rewritten");
  const r = runLauncher("render", "--scene", "a b.json");
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), {
    version: "1.0.0",
    args: ["render", "--scene", "a b.json"],
  });
  assert.deepEqual(launcherTarget(bin), { target: v1, version: "1.0.0" });
});

test("right after an update the launcher runs the newly installed version", () => {
  writeLaunchers(fakeBundle("1.0.0"), "1.0.0", bin);
  fakeBundle("2.0.0");
  install("2.0.0");
  assert.equal(JSON.parse(runLauncher().stdout).version, "2.0.0");
});

test("a removed version is explained, not run", () => {
  const v1 = fakeBundle("1.0.0");
  writeLaunchers(v1, "1.0.0", bin);
  rmSync(v1);
  const gone = runLauncher("check");
  assert.equal(gone.status, 1);
  assert.match(gone.stderr, /no longer exists/);
});

test("an older version can't take the launchers back", () => {
  const v2 = fakeBundle("0.23.0");
  writeLaunchers(v2, "0.23.0", bin);
  assert.equal(shouldRefresh("0.9.0", bin), false);
  assert.equal(shouldRefresh("0.23.0", bin), true);
  assert.equal(shouldRefresh("0.24.0", bin), true);
  rmSync(v2);
  assert.equal(shouldRefresh("0.9.0", bin), true, "unless what they point at is gone");
  assert.equal(shouldRefresh("0.9.0", join(tmp.dir, "nowhere")), true);
  assert.equal(compareVersions("0.9.0", "0.23.0"), -1);
  assert.equal(compareVersions("1.0.0", "1.0"), 0);
});

test("the shell launchers forward to narrate.mjs, also through a symlink", () => {
  writeLaunchers(fakeBundle("3.0.0"), "3.0.0", bin);
  if (process.platform === "win32") {
    const r = spawnSync("cmd.exe", ["/d", "/c", join(bin, "narrate.cmd"), "check"], {
      encoding: "utf8",
      env: env(),
    });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { version: "3.0.0", args: ["check"] });
    return;
  }
  const link = join(tmp.dir, "narrate-link");
  rmSync(link, { force: true });
  symlinkSync(join(bin, "narrate"), link);
  for (const script of [join(bin, "narrate"), link]) {
    const r = spawnSync("sh", [script, "check"], { encoding: "utf8", env: env() });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { version: "3.0.0", args: ["check"] });
  }
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
