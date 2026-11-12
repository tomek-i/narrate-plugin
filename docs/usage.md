# Usage

Two ways to use narrate: as a **Claude Code plugin** (`/narrate-video`) or as a
**standalone CLI**.

## Requirements

- **Node ≥ 18**
- **ffmpeg + ffprobe** on your PATH — the only manual dependency. The Playwright
  package is auto-installed on first render and an installed Edge/Chrome is used
  if present (otherwise Chromium is downloaded once).
- For real narration, a **TTS API key** (Gemini by default). No key? `--provider os`
  uses the OS voice, or `--provider mock` is silent. See [configuration.md](./configuration.md).

## As a Claude Code plugin

Install from the marketplace:

```
/plugin marketplace add tomek-i/narrate-plugin
/plugin install narrate@narrate-marketplace
```

Then, from inside any project, describe what you want demoed:

```
/narrate-video the signup flow using test@example.com and a valid password
```

The agent investigates the project, starts the dev server, scripts the
walkthrough as a scene, records + narrates it, and drops the finished video in
your repo. You can also just ask in plain language ("record a narrated
walkthrough of the dashboard") — the `narrate-video` skill auto-triggers.

Not sure it's wired up? Run **`/narrate-demo`** (skill) — it renders a built-in demo app
end-to-end (no project, dev server, or website of your own needed) and writes
`./docs/narrate-demo.mp4`.

### Conventions

- Intermediate files (scene JSON, per-beat audio, raw video) go in
  **`./.narrate/tmp/`** and are cleaned up after; `.narrate/` is added to your
  project's `.gitignore`.
- The finished video is copied to **`./docs/<slug>.mp4`** in your repo.

## As a CLI

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/narrate.mjs" init                  # scaffold .narrate/settings.local.json
node "${CLAUDE_PLUGIN_ROOT}/bin/narrate.mjs" set-key gemini        # save a key (hidden prompt; or --clipboard) + pick the provider
node "${CLAUDE_PLUGIN_ROOT}/bin/narrate.mjs" check                 # validate ffmpeg + config + key (exit 0/1)
node "${CLAUDE_PLUGIN_ROOT}/bin/narrate.mjs" render --scene scene.json
# or in the source monorepo:
pnpm narrate render --scene packages/plugin/examples/demo.scene.json
```

Settings are global with per-project overrides (see
[configuration.md](./configuration.md)). `set-key` stores an API key in your
global `~/.narrate/settings.json` and switches the active provider (add
`--project` to override just this project). `init` scaffolds an empty project
override file `.narrate/settings.local.json` and gitignores `.narrate/`. `check`
is a deterministic preflight you can run anytime; it shows where each value comes
from.

Flags (`render`):

| Flag                | Meaning                                            |
| ------------------- | -------------------------------------------------- |
| `-s, --scene <f>`   | scene JSON file (required)                          |
| `-o, --out <dir>`   | output directory (default `out`, or config value)   |
| `-c, --config <f>`  | project config file, layered over the global one (default `.narrate/settings.local.json`)|
| `--provider <p>`    | override TTS provider (`gemini`/`elevenlabs`/`os`/`mock`)|
| `--voice <v>`       | override voice                                      |
| `--untrusted`       | safe mode for generated scenes ([scenes.md](./scenes.md#untrusted-generated-scenes)) |
| `--no-env`          | type `${NAME}` in `fill`/`type` text literally instead of expanding it |
| `--site <url>`      | record this site instead of the scene's `site` |
| `--allow-origin <url…>` | allow these origins too and turn on the same-origin guard (the only way to allow more under `--untrusted`) |
| `--storage-state <f>` | load this saved session; overrides the scene's `auth.storageState` |
| `--same-origin`     | keep the browser on the site's origin; fail without a video if it leaves ([scenes.md](./scenes.md#same-origin-guard)) |
| `--json`            | print one JSON result object on stdout; all progress goes to stderr (see below) |
| `--log <f>`         | write the diagnostic log here (default `<out>/narrate.log`) |

### Machine-readable render results (`--json`)

For scripts and agents, `render --json` prints exactly one JSON object on stdout,
whether the render succeeds or fails. Progress and warnings go to stderr. The exit
code is 0 on success and 1 on failure.

```json
{ "ok": true, "video": "/abs/out/demo.mp4", "captions": "/abs/out/demo.vtt", "durationSec": 42.3,
  "audio": { "present": true, "meanVolumeDb": -24.7, "silent": false }, "log": "/abs/out/narrate.log" }
```

```json
{ "ok": false, "stage": "tts", "error": "No API key for gemini …", "log": "/abs/out/narrate.log" }
```

- Paths are absolute. `captions` is null when `output.vtt` is off.
- `stage` says where it failed: `validate` (config, scene file or scene checks;
  nothing was rendered), `setup` (ffmpeg or the browser), `tts`, `record` or `mux`.
- `log` is the diagnostic log. It is null when a `validate` failure happens before
  rendering starts and no `--log` was given (a rejected scene writes nothing to
  the output folder), or when the log couldn't be written.
- With `--json`, a video with no audio stream or silent audio is a failure
  (stage `mux`) and the video is removed, so a caller never publishes a "narrated"
  video without narration. The `mock` provider is exempt: its narration is silent
  by design, and its result reports `"silent": true`.
- A usage error (e.g. `--scene` missing) is reported by the argument parser as
  plain text on stderr, with nothing on stdout and exit code 1.

### Validating a scene without rendering

```bash
narrate validate --scene scene.json            # exit 0 = valid, 1 = invalid (one line per problem)
narrate validate --scene scene.json --json     # machine-readable
narrate validate --scene scene.json --untrusted  # also apply the --untrusted rules (add --allow-origin as for render)
narrate validate --scene scene.json --untrusted --site http://localhost:3000  # check against the site render will pin
```

`validate` runs the same checks `render` does before it starts (JSON syntax, the
scene schema, unique beat ids, and the `--untrusted` rules when asked for or set
in the scene), without a browser, ffmpeg, a TTS voice or any network access. Use
it to check a generated scene before spending time and TTS credits on a render,
or in a generator's tests to catch drift from narrate's schema.

It is stricter than `render` in two ways, both to catch mistakes early:

- Unknown keys are problems (`render` ignores them), so a typo such as
  `untrused` or a renamed field is reported instead of silently doing nothing.
  A top-level `$schema` is allowed.
- The scene's `auth.storageState` file must exist (relative to the current
  directory, as for `render`). Not checked in untrusted mode, which ignores it.

Pass the same `--site` and `--allow-origin` you will pass to `render`, so the
untrusted rules are checked against the site that will actually be recorded.

Duplicate beat ids are rejected by `render` too: each beat's audio and timing is
keyed by its id, so a duplicate used to give wrong timing and captions.

With `--json` it prints exactly one JSON object to stdout:

```json
{ "ok": false, "schemaVersion": 1, "problems": [{ "path": "beats[2].do[0].ms", "message": "Too small: expected number to be >0" }] }
```

- `ok`: true when there are no problems (and the exit code is 0).
- `schemaVersion`: the scene format version. It only changes on incompatible
  changes (a field removed or its meaning changed), not when optional fields are
  added, so a caller can refuse to run against a version it doesn't know.
- `problems`: one entry per problem. `path` is a JSON path into the scene (`""`
  for the file as a whole, e.g. invalid JSON; `--allow-origin` for a bad flag
  value); `message` is human-readable and may change between versions.

A usage error (e.g. `--scene` missing) is reported by the argument parser as
plain text on stderr, with nothing on stdout and exit code 1.

Keyless smoke test (silent narration, exercises the whole pipeline):

```bash
pnpm narrate render --scene packages/plugin/examples/demo.scene.json --provider mock
```

Authoring scenes (format + full step reference): [scenes.md](./scenes.md).
