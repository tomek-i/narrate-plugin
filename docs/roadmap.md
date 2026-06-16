# Roadmap

Planned and possible features, with the reasoning behind each so the intent is
clear before any of it is built. Nothing here is committed or scheduled — it's a
shared picture of where narrate could go and why. Order is rough priority.

---

## Interactive (Claude-in-the-loop) recorder

**What.** An alternative recording mode where the agent drives the browser live
(via the Playwright MCP) and the run is captured, instead of the engine playing a
pre-written scene in one continuous pass.

**Why.** Some walkthroughs can't be fully scripted ahead of time — the agent may
need to read the page, make a decision, and react (e.g. "find the settings most
relevant to billing and demo those"). A live loop handles open-ended,
exploratory demos the declarative scene format can't express.

**Why it's not the default.** It reintroduces the sync problem the engine was
built to avoid: every agent step adds latency and dead air, so narration and
visuals drift, and the video looks janky. It would need **content-anchored sync**
(align narration to events/markers after the fact) rather than the current
wall-clock pacing. Worth it only for the ad-hoc case, as an opt-in mode.

---

## "Code explanation" scene type

**What.** A new scene/source kind that renders syntax-highlighted code (a file, a
diff, a snippet) and narrates it — pan/scroll/zoom across lines, highlight ranges
as they're discussed — without needing a running website.

**Why.** A huge share of "explain this" content is about *code*, not UI: walking
through a PR, explaining an algorithm, onboarding to a module. Today narrate
needs a live site; this would let it narrate the change an agent just made, which
is the original motivating use case (a coding agent demoing its own work).

**Notes.** Likely a local HTML render (highlighter + theme) the engine drives like
any other page, with `do` steps for "highlight lines 10–20", "scroll to function
X". Reuses the whole TTS + record + mux pipeline.

---

## Chapters & captions track

**What.** Emit a chapter marker per beat and a caption/subtitle track (WebVTT or
burned-in) from the narration text the engine already has.

**Why.** Accessibility (captions) and navigability (jump to a section in a long
walkthrough). The data is essentially free — we already know each beat's text and
its exact start/end time from the pacing step — so this is mostly a muxing/output
concern.

**Notes.** WebVTT sidecar is the low-risk first step; chapter metadata in the MP4
container and optional burned-in captions are follow-ons.

---

## More TTS providers + voice preview

**What.** Additional TTS backends beyond Gemini / ElevenLabs / OS-native, plus a
command to list and preview available voices (`narrate voices`, short sample clip
per voice).

**Why.** Voice is the most subjective part of the output; people want their
preferred provider/voice, and choosing one blind from a name is hard. Previews let
users pick before committing to a full render. The provider interface is already
pluggable (`TTSProvider`), so new backends are isolated additions.

---

## Distribution / runtime simplification

**What.** Reduce first-run friction further — e.g. a stable shared runtime dir so
the Playwright package isn't reinstalled per plugin version, and/or an optional
`npx @narrate/core` path for non-plugin use.

**Why.** The current model installs the Playwright package into the versioned
plugin cache on first render (browsers are reused from an installed Edge/Chrome).
That works, but the package install repeats when the plugin version changes. A
persistent runtime location would make upgrades instant.
