import { parseArgs } from 'node:util';
import { runSourceNormalization } from './master-source-export.js';

const { values } = parseArgs({
  options: {
    'source-root': { type: 'string' },
    'audit-root': { type: 'string' },
    'output-root': { type: 'string' },
    corrections: { type: 'string' },
    help: { type: 'boolean' },
  },
  strict: true,
});

if (values.help) {
  console.log(
    'File-only normalization: --source-root PATH --audit-root PATH --output-root PATH [--corrections reviewed.json]',
  );
} else {
  try {
    if (!values['source-root'] || !values['audit-root'] || !values['output-root'])
      throw new Error('--source-root, --audit-root and --output-root are required');
    const result = await runSourceNormalization({
      sourceRoot: values['source-root'],
      auditRoot: values['audit-root'],
      outputRoot: values['output-root'],
      correctionsFile: values.corrections,
    });
    console.log(
      JSON.stringify(
        {
          counts: result.counts,
          reportsDirectory: `${values['output-root']}/reports`,
          commercialReadiness: result.exceptions.length ? 'NEEDS_REVIEW' : 'READY',
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Source normalization failed');
    process.exitCode = 1;
  }
}
