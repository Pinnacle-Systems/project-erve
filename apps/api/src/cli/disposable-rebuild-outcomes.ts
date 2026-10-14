export function summarizeRebuildIssues(stages: Array<{ stage: string; result: unknown }>) {
  let exceptions = 0,
    failures = 0;
  for (const { stage, result } of stages) {
    if (!result || typeof result !== 'object') continue;
    if (stage === 'references' && Array.isArray(result)) {
      exceptions += result.filter((row) => row.outcome === 'NEEDS_REVIEW').length;
    } else if (stage === 'styles') {
      const style = result as {
        preview?: Array<{ rowNumber: number; status: string }>;
        execution?: { results: Array<{ rowNumber: number; outcome: string }> };
        warnings?: unknown[];
      };
      const rejected = new Set(
        style.preview?.filter((row) => row.status === 'REJECTED').map((row) => row.rowNumber),
      );
      exceptions += rejected.size + (style.warnings?.length ?? 0);
      failures +=
        style.execution?.results.filter(
          (row) =>
            row.outcome === 'IMAGE_PENDING' ||
            (row.outcome === 'FAILED' && !rejected.has(row.rowNumber)),
        ).length ?? 0;
    } else if ('summary' in result && result.summary && typeof result.summary === 'object') {
      const summary = result.summary as Record<string, number>;
      exceptions += (summary.NEEDS_REVIEW ?? 0) + (summary.REJECTED ?? 0);
      failures += summary.FAILED ?? 0;
    }
  }
  return { exceptions, failures };
}
