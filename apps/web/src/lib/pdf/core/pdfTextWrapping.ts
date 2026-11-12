/**
 * Words up to 24 characters are normally preserved without splitting.
 * This threshold accommodates common place names and identifiers.
 *
 * Character count does not guarantee that a word fits its container.
 * Unusually wide character sequences may still overflow narrow columns.
 * A separate width-aware solution is required for those cases.
 */
export const MAX_WHOLE_WORD_LENGTH = 24;

/** Size of the pieces an over-long unbroken token is cut into, so no piece can exceed a column. */
export const OVERLONG_WORD_CHUNK_LENGTH = 16;

/**
 * Hyphenation policy for free-text PDF values (addresses, Store/Destination names, identifiers).
 *
 * `@react-pdf/renderer` hyphenates by default using English syllable patterns, which splits Indian
 * place names and street words mid-word ("Ra-jasthan", "Col-lectorate"). This callback returns an
 * ordinary word as a single fragment, so lines only break at whitespace and at existing natural
 * punctuation (commas, slashes, existing hyphens) and every word stays intact.
 *
 * react-pdf has NO last-resort character break: an unbreakable token wider than its column would
 * run past the column edge and overlap the neighbouring field (or be clipped at the page edge).
 * So the only exception is a token longer than `MAX_WHOLE_WORD_LENGTH` — never a real word — which
 * is cut into `OVERLONG_WORD_CHUNK_LENGTH`-character pieces so it wraps inside its column.
 *
 * Passed per-`<Text>` via `hyphenationCallback` — deliberately not registered globally through
 * `Font.registerHyphenationCallback`, so PDFs that do not opt in keep their existing behaviour.
 */
export function wordPreservingHyphenation(word: string): string[] {
  const characters = Array.from(word);
  if (characters.length <= MAX_WHOLE_WORD_LENGTH) return [word];
  const pieces: string[] = [];
  for (let i = 0; i < characters.length; i += OVERLONG_WORD_CHUNK_LENGTH) {
    pieces.push(characters.slice(i, i + OVERLONG_WORD_CHUNK_LENGTH).join(''));
  }
  return pieces;
}
