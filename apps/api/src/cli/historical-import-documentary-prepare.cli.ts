#!/usr/bin/env node
// Source-only H2B.1 extraction for clean imports: no DB or file-storage writes.
import { readFile, writeFile } from 'node:fs/promises';
import { reextractDocumentaryStaging } from '../modules/historical-import/documentary-staging.js';
import type { SourceStagingRecord } from '../modules/historical-import/staging.service.js';

async function main() {
  const args = process.argv.slice(2);
  const required = (flag: string) => {
    const i = args.indexOf(flag);
    const value = i >= 0 ? args[i + 1] : undefined;
    if (!value || value.startsWith('--')) throw new Error(`${flag} is required`);
    return value;
  };
  const input = required('--staging');
  const output = required('--output');
  const records = JSON.parse(await readFile(input, 'utf8')) as SourceStagingRecord[];
  const staging = await reextractDocumentaryStaging(records, { aw25Dir: required('--aw25-dir'), ss26Dir: required('--ss26-dir') });
  await writeFile(output, JSON.stringify(staging, null, 2), { flag: 'wx' });
  console.log(`Extracted ${staging.length} source documents to NEW staging artifact ${output}`);
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
