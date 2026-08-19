/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QualityExecutionView } from '@erve/types';
import { QualityExecutionForm } from './quality-execution-form.js';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const execution = (status: 'DRAFT' | 'FINALIZED' = 'DRAFT'): QualityExecutionView => ({
  id: 'execution-1',
  jobOrderId: 'job-1',
  processFlowActivityId: 'activity-1',
  activityName: 'Inline Inspection',
  qualityForm: {
    id: 'form',
    code: 'INLINE',
    name: 'Inline Inspection Report',
    versionId: 'version-1',
    versionNumber: 1,
  },
  attemptNumber: 1,
  batchNumber: 1,
  inspectedQuantity: null,
  ppSample: null,
  coverage: null,
  status,
  version: 2,
  startedAt: '',
  finalizedAt: status === 'FINALIZED' ? '' : null,
  responses: {
    expectedVersion: 2,
    checklistResponses: [],
    aqlResults: [],
    defects: [],
    correctiveActions: [],
    testResults: [],
    quantities: [],
    comments: [],
    fieldResponses: [],
    attendees: [],
    actions: [],
    signoffs: [],
    outcome: null,
  },
  attachments: [],
  sections: [
    {
      id: 's2',
      sequence: 2,
      title: 'Conclusion',
      components: [
        {
          id: 'outcome',
          sequence: 1,
          type: 'INSPECTION_OUTCOME',
          title: 'Outcome',
          config: { allowedOutcomes: ['PASS', 'FAIL'] },
        },
        {
          id: 'sign',
          sequence: 2,
          type: 'SIGNATURES',
          title: 'Sign-off',
          config: { roles: [{ key: 'qa', label: 'Quality Controller', required: true }] },
        },
      ],
    },
    {
      id: 's1',
      sequence: 1,
      title: 'Inspection',
      components: [
        {
          id: 'context',
          sequence: 1,
          type: 'SYSTEM_CONTEXT',
          title: 'Context',
          config: { fields: [{ key: 'job', label: 'Job Order' }] },
          systemValue: [{ key: 'job', value: 'JO-1', available: true }],
        },
        {
          id: 'progress',
          sequence: 2,
          type: 'PRODUCTION_PROGRESS',
          title: 'Progress',
          config: { metrics: [{ key: 'sewn', label: 'Sewn' }] },
          systemValue: [{ key: 'sewn', value: 50, available: true }],
        },
        {
          id: 'check',
          sequence: 3,
          type: 'CHECKLIST',
          title: 'Checklist',
          config: {
            items: [{ key: 'work', label: 'Workmanship' }],
            responseOptions: ['PASSED', 'FAILED'],
          },
        },
        {
          id: 'aql',
          sequence: 4,
          type: 'AQL_RESULT',
          title: 'AQL',
          config: { criteria: [{ severity: 'MAJOR', aql: 2.5 }] },
        },
        {
          id: 'defects',
          sequence: 5,
          type: 'DEFECT_LIST',
          title: 'Defects',
          config: { severities: ['MAJOR'], captureQuantity: true },
        },
        {
          id: 'actions',
          sequence: 6,
          type: 'CORRECTIVE_ACTIONS',
          title: 'Actions',
          config: { columns: [{ key: 'action', label: 'Action', dataType: 'TEXT' }] },
        },
        {
          id: 'tests',
          sequence: 7,
          type: 'TEST_RESULTS',
          title: 'Tests',
          config: { tests: [{ key: 'gsm', label: 'GSM', responseOptions: ['PASSED', 'FAILED'] }] },
        },
        {
          id: 'quantity',
          sequence: 8,
          type: 'QUANTITY_RECONCILIATION',
          title: 'Quantities',
          config: {
            fields: [
              { key: 'order', label: 'Order', source: 'SYSTEM' },
              { key: 'inspected', label: 'Inspected' },
            ],
          },
          systemValue: [{ key: 'order', value: 100, available: true }],
        },
        { id: 'comment', sequence: 9, type: 'COMMENTS', title: 'Comments', config: {} },
        {
          id: 'files',
          sequence: 10,
          type: 'ATTACHMENTS',
          title: 'Evidence',
          config: { requirements: [{ key: 'photo', label: 'Photo' }] },
        },
      ],
    },
  ],
});

describe('QualityExecutionForm shared web/mobile renderer', () => {
  it('renders immutable definition order, read-only system data, and every operational component', () => {
    act(() =>
      root.render(
        <QualityExecutionForm execution={execution()} onSave={vi.fn()} onFinalize={vi.fn()} />,
      ),
    );
    expect([...container.querySelectorAll('section > h2')].map((node) => node.textContent)).toEqual(
      ['Inspection', 'Conclusion'],
    );
    expect(container.textContent).toContain('JO-1');
    expect(container.textContent).toContain('Sewn');
    expect(container.querySelector('[aria-label="Workmanship"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="MAJOR max"]')).not.toBeNull();
    expect(container.textContent).toContain('Add defect');
    expect(container.textContent).toContain('Add corrective action');
    expect(container.textContent).toContain('GSM');
    expect(container.textContent).toContain('Inspected');
    expect(container.textContent).toContain('Photo');
    expect(container.textContent).toContain('Quality Controller');
    expect(container.textContent).toContain('PASS');
    expect(container.textContent).toContain('Save draft');
    expect(container.textContent).toContain('Finalize');
  });

  it('renders finalized executions as read-only and preserves outcome state', () => {
    const item = execution('FINALIZED');
    item.responses.outcome = { componentId: 'outcome', value: 'FAIL', remarks: 'Failed' };
    act(() =>
      root.render(<QualityExecutionForm execution={item} onSave={vi.fn()} onFinalize={vi.fn()} />),
    );
    expect(container.querySelector('fieldset')?.disabled).toBe(true);
    expect(container.textContent).not.toContain('Save draft');
    expect((container.querySelector('input[type="radio"]:checked') as HTMLInputElement).value).toBe(
      'on',
    );
  });
});
