# Scenes

A scene is a JSON file describing the walkthrough: where to go, how big, and the
ordered narrated **beats**. Each beat is one line of speech (`say`) plus the timed
visual actions (`do`) shown while it plays.

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/tomek-i/narrate-plugin/main/narrate.scene.schema.json",  // optional, for editor autocomplete
  "name": "signup",                            // output file = <name>.mp4
  "site": "http://localhost:3000",
  "viewport": { "width": 1440, "height": 900 },
  "theme": "dark",                              // optional; emulates prefers-color-scheme (light | dark | system)
  "beats": [
    {
      "id": "intro",
      "say": "Let's walk through signing up for a new account.",
      "voice": "Kore",                          // optional per-beat voice override
      "do": [{ "action": "wait", "ms": 800 }]
    },
    {
      "id": "form",
      "say": "We enter an email and a password, then submit.",
      "focus": "form#signup",                   // optional: highlight this element for the whole beat
      "focusStyle": "spotlight",                // optional: ring (default) | glow | spotlight
      "focusLabel": "Sign-up form",             // optional: caption next to it
      "do": [
        { "action": "scrollIntoView", "selector": "form#signup" },
        { "action": "type", "selector": "#email", "text": "test@example.com" },
        { "action": "fill", "selector": "#password", "text": "hunter2!" },
        { "action": "click", "selector": "button[type=submit]" },
        { "action": "waitForUrl", "url": "**/welcome" }
      ]
    }
  ]
}
```

## Site

`site` is usually a running URL (`http://localhost:3000`). It can also be a
**local file path** (e.g. `demo/index.html`) — anything that isn't an
`http(s)://` or `file://` URL is resolved relative to the scene file and loaded
as a `file://` page, so a self-contained demo needs no server. See the bundled
example at `packages/plugin/examples/demo.scene.json`.

## Pacing

Each beat is held on screen for **exactly its narration length**. Keep a beat's
`do` steps shorter than its spoken line; if the steps overrun, the engine logs a
warning so you can split the beat or lengthen the narration.

## Theme

The optional `theme` emulates the browser's `prefers-color-scheme`, so it works
for any site that honors that media query. Sites with a *manual* theme toggle
(a button/switch) won't change from this alone — drive that toggle with a
`click`/`menu` step. Omit `theme` if it doesn't apply.

## Step reference

Selectors are real [Playwright selectors](https://playwright.dev/docs/selectors)
(CSS, `text=`, `role=`, `[name=...]`, …). Steps run in order within a beat.

### Timing
| Step | Fields |
| --- | --- |
| `wait` | `ms` |
| `waitFor` | `selector`, `state` = `attached`\|`detached`\|`visible`(default)\|`hidden` |
| `waitForUrl` | `url` (string or glob, e.g. `**/dashboard`) |

### Navigation
| Step | Fields |
| --- | --- |
| `navigate` | `url` |
| `back` / `forward` / `reload` | — |

### Mouse
| Step | Fields |
| --- | --- |
| `click` | `selector` |
| `dblclick` | `selector` |
| `hover` | `selector` |
| `dragTo` | `from`, `to` |

### Keyboard / forms
| Step | Fields |
| --- | --- |
| `fill` | `selector`, `text` — set value instantly |
| `type` | `selector`, `text`, `delay` (ms/char, default 60) — key-by-key |
| `clear` | `selector` |
| `press` | `key` (e.g. `Enter`, `Control+A`), `selector` (optional) |
| `selectOption` | `selector`, and `label` **or** `value` |
| `check` / `uncheck` | `selector` |
| `focus` / `blur` | `selector` |
| `uploadFile` | `selector`, `files` (array of paths) |

### Scrolling (smoothly animated over `over` ms)
| Step | Fields |
| --- | --- |
| `scrollTo` | `y`, `over` (default 0 = instant) |
| `scrollThrough` | `selector` (optional; whole page if omitted), `over` (default 4000) |
| `scrollIntoView` | `selector`, `over` (default 800) |

### Highlighting / pointer
These drive an overlay injected **into the recorded page** (a synthetic cursor and
element highlights) — never the real OS cursor, and `pointer-events:none` so they
never block the actual interactions. Toggle them in [config `overlay`](./configuration.md).

| Step | Fields |
| --- | --- |
| `highlight` | `selector`, `style` (`ring`\|`glow`\|`spotlight`; default from config), `label` (optional), `hold` (ms; default `overlay.holdMs` ≈ 3s, `0` = until `unhighlight`/beat end) |
| `unhighlight` | `selector` (optional; omit to clear all) |
| `point` | `selector` — glide the synthetic cursor onto an element (no click) |

Two roles, kept separate so the result doesn't feel random:
- **Cursor = interaction.** With `overlay.cursor` on (default), `click`/`dblclick`/
  `hover`/`type`/`fill`/… automatically glide the cursor to their target first
  (clicks add a ripple). Let the cursor carry interactions consistently — you
  rarely need an explicit `point`, and you shouldn't ring every field by hand.
- **Highlights = brief accents.** A highlight **pulses for ~3s then fades back to
  the clean page** (`overlay.holdMs`); it doesn't sit there for the whole beat.
  Use it to point at what the narration is describing.

For "the narration talks about X", prefer the beat-level **`focus`** /
`focusStyle` / `focusLabel` fields (above): they pulse X briefly at the start of
the beat and fade on their own. `focus` is best for an element already in view —
if the beat scrolls X into view first, use a `highlight` step *after* the scroll so
the pulse lands when X is actually visible.

### Convenience / escape hatch
| Step | Fields |
| --- | --- |
| `menu` | `trigger`, `item` — click trigger, then a `menuitem` by visible text |
| `eval` | `fn` — body of an async function run in the page; last resort |

The canonical source of truth is the zod `StepSchema` in
`packages/core/src/types.ts`; `narrate.scene.schema.json` is generated from it.
