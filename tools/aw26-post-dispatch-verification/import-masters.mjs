// Drives the CURRENT supported import mechanisms over HTTP: preflight -> (optional) execute, saving each response.
//
//   node import-masters.mjs <preflight|execute> <kind> <xlsx> <label>
//   kind: seasons | sizes | hsns | factories | distributors | retail-stores | styles
//
// Env: AW26_API (default http://127.0.0.1:4080), AW26_WORKSPACE, AW26_ADMIN (identifier), AW26_ADMIN_PASSWORD_FILE.
// Results: <workspace>/05-preflight-results/<label>-<kind>-<mode>.json (+ exceptions workbook when rows need correction).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createClient, readSecret } from './client.mjs';

const [mode, kind, file, label] = process.argv.slice(2);
if (!['preflight', 'execute'].includes(mode) || !kind || !file || !label) {
  console.error('usage: import-masters.mjs <preflight|execute> <kind> <xlsx> <label>');
  process.exit(2);
}
const ws = process.env.AW26_WORKSPACE;
const client = createClient(process.env.AW26_API ?? 'http://127.0.0.1:4080');
const token = await client.login(
  process.env.AW26_ADMIN ?? 'admin.aw26@erve.test',
  readSecret(
    process.env.AW26_ADMIN_PASSWORD_FILE ??
      path.join(ws, '06-test-fixtures', 'runtime', 'admin-password.txt'),
  ),
);
const base = kind === 'styles' ? '/styles/bulk-import' : `/master-imports/${kind}`;
const bytes = readFileSync(file);
const form = (extra = {}) => {
  const f = new FormData();
  f.append('file', new Blob([bytes]), path.basename(file));
  for (const [k, v] of Object.entries(extra)) f.append(k, v);
  return f;
};
const worksheets = await client.expect(200, 'POST', `${base}/worksheets`, {
  token,
  form: form(),
  key: false,
});
const worksheetList = Array.isArray(worksheets) ? worksheets : worksheets.worksheets;
const worksheet = (worksheetList[0].name ?? worksheetList[0]) + '';
const plan = await client.expect(200, 'POST', `${base}/preflight`, {
  token,
  form: form({ worksheet }),
  key: false,
});
const out = path.join(ws, '05-preflight-results');
mkdirSync(out, { recursive: true });
const stem = `${label}-${kind}`;
const summarize = (rows) => {
  const counts = {};
  for (const row of rows ?? [])
    counts[row.outcome ?? row.status] = (counts[row.outcome ?? row.status] ?? 0) + 1;
  return counts;
};
const result = {
  kind,
  file: path.basename(file),
  worksheet,
  sha256: plan.sourceFileChecksum ?? plan.checksum,
  preflightSummary: plan.summary ?? summarize(plan.rows),
  preflightRows: plan.rows,
};
const needsCorrection = (plan.rows ?? []).some((r) =>
  ['NEEDS_REVIEW', 'REJECTED', 'FAILED'].includes(r.outcome ?? r.status),
);
if (needsCorrection) {
  const ex = await client.call('POST', `${base}/exceptions`, {
    token,
    form: form({ worksheet }),
    key: false,
    raw: true,
  });
  if (ex.status === 200) writeFileSync(path.join(out, `${stem}-exceptions.xlsx`), ex.buffer);
}
if (mode === 'execute') {
  const executed = await client.expect(200, 'POST', `${base}/execute`, {
    token,
    key: false,
    form: form({
      worksheet,
      confirmationToken: plan.confirmationToken,
      ...(plan.sourceFileChecksum ? { sourceFileChecksum: plan.sourceFileChecksum } : {}),
    }),
  });
  result.executed = executed;
}
writeFileSync(path.join(out, `${stem}-${mode}.json`), JSON.stringify(result, null, 2));
console.log(
  `${kind} ${mode}: ${JSON.stringify(mode === 'execute' ? (result.executed.summary ?? result.executed) : result.preflightSummary)}`,
);
