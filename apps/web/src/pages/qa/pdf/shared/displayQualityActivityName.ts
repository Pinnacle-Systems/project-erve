/**
 * Mirrors `displayActivityName` in `@erve/app-components/job-order-operational-presentation.ts`
 * (not exported from that package's public index) — turns an ALL-CAPS activity name like "PPM" or
 * "IN LINE QC" into the same acronym-aware title-case the QA execution screen shows, so the PDF
 * title matches what the user sees on screen.
 */
export function displayQualityActivityName(name: string): string {
  if (name !== name.toUpperCase()) return name;
  return name.replace(/[A-Z]+/g, (word) => {
    const acronymLike = word.length > 1 && !/[AEIOU]/.test(word);
    return acronymLike ? word : `${word[0]}${word.slice(1).toLowerCase()}`;
  });
}
