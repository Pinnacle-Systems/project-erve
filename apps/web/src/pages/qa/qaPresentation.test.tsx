/** @vitest-environment jsdom */
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { QualityExecutionForm } from '@erve/app-components';
import { buildQualitySections } from './pdf/shared/qualityResponseBlocks.js';
import { contextExecution } from '../../test-support/qa-presentation-fixture.js';

it.each(['Pre-Production Meeting', 'Inline Inspection', 'Final Inspection'])(
  'keeps authored %s fields while suppressing all derived provenance in UI/PDF blocks',
  (activity) => {
    for (const status of ['DRAFT', 'FINALIZED'] as const) {
      const execution = contextExecution(activity, status);
      if (status === 'DRAFT') {
        const customer = execution.sections[0]!.components[0]!.systemValue!.find(
          (item) => item.key === 'customer',
        )!;
        customer.value = 'Distributor Alpha'; // single source; finalized fixture covers consolidated sources
      }
      const original = structuredClone(execution);
      const html = renderToStaticMarkup(
        <QualityExecutionForm
          compactIdentity
          execution={execution}
          onSave={vi.fn()}
          onFinalize={vi.fn()}
        />,
      );
      const pdfBlocks = JSON.stringify(buildQualitySections(execution, new Map()));
      for (const output of [html, pdfBlocks]) {
        expect(output).not.toMatch(/Distributor Alpha|Distributor Beta|EIOS-|Private Planner/);
        expect(output).toContain('Authored Buyer');
        expect(output).toContain('Authored Supplier');
      }
      expect(html).toContain('Basic Tee');
      expect(html).toContain('Approved Factory');
      expect(html).toContain('1800');
      expect(html.match(/<h1/g)).toHaveLength(1);
      expect(execution).toEqual(original);
    }
  },
);
