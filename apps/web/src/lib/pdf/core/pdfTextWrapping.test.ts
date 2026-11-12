import { describe, expect, it } from 'vitest';
import { MAX_WHOLE_WORD_LENGTH, OVERLONG_WORD_CHUNK_LENGTH, wordPreservingHyphenation } from './pdfTextWrapping.js';

describe('wordPreservingHyphenation', () => {
  it.each(['Rajasthan', 'Collectorate', 'Thiruvananthapuram', '342001', '22AAAAA0000A1Z5', 'Rajasthan,'])(
    'keeps the ordinary word "%s" as one fragment',
    (word) => {
      expect(wordPreservingHyphenation(word)).toEqual([word]);
    },
  );

  it('keeps a word of exactly the maximum whole-word length intact', () => {
    const word = 'A'.repeat(MAX_WHOLE_WORD_LENGTH);
    expect(wordPreservingHyphenation(word)).toEqual([word]);
  });

  it('cuts an over-long unbroken token into bounded pieces that rejoin to the original', () => {
    const token = 'Y'.repeat(75);
    const pieces = wordPreservingHyphenation(token);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.join('')).toBe(token);
    for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(OVERLONG_WORD_CHUNK_LENGTH);
  });

  it('never splits a surrogate pair when cutting an over-long token', () => {
    const token = '😀'.repeat(MAX_WHOLE_WORD_LENGTH + 5);
    const pieces = wordPreservingHyphenation(token);
    expect(pieces.join('')).toBe(token);
    for (const piece of pieces) expect(Array.from(piece).every((c) => c === '😀')).toBe(true);
  });
});
