/**
 * Voice tags: short bracketed cues in a beat's `say` text, such as `[excited]`,
 * `[whispers]` or `[short pause]`. Voices that understand them (Gemini, and
 * ElevenLabs v3 models) get the text as written and act on the cues. Every
 * other voice would read them out, so they're removed first, and captions
 * never show them.
 *
 * A tag is lowercase (any script: `[fröhlich]`, `[взволнованно]`), so keys and
 * UI labels like `[Enter]` or `[Save]` stay part of the narration, and a
 * markdown link's `[text](url)` isn't one.
 */
const TAG = /\[\p{Ll}[\p{Ll} '-]{0,39}\](?!\()/u;
const TAG_WITH_SPACE = new RegExp(`\\s*${TAG.source}\\s*`, "gu");

/** True if `text` contains a voice tag. */
export function hasVoiceTags(text: string): boolean {
  return TAG.test(text);
}

/** `say` text without its voice tags; text without tags is returned as it is (trimmed). */
export function stripVoiceTags(text: string): string {
  return text
    .replace(TAG_WITH_SPACE, (match: string, offset: number, whole: string) => {
      const before = whole.slice(0, offset);
      const after = whole.slice(offset + match.length);
      // Keep one space between words; none at an edge, before punctuation or
      // just inside an opening quote or bracket.
      if (!before || !after || /^[,.!?;:…]/u.test(after) || /["'(“‘«]$/u.test(before)) {
        return "";
      }
      return " ";
    })
    .trim();
}
