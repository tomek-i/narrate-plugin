/**
 * Voice tags: short bracketed cues in a beat's `say` text, such as `[excited]`,
 * `[whispers]` or `[short pause]`. Voices that understand them (Gemini, and
 * ElevenLabs v3 models) get the text as written and act on the cues. Every
 * other voice would read them out, so they're removed first, and captions
 * never show them.
 */
const TAG = /\[[A-Za-z][A-Za-z '-]{0,39}\]/g;

/** `say` text without its voice tags, whitespace tidied. */
export function stripVoiceTags(text: string): string {
  return text
    .replace(TAG, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}
