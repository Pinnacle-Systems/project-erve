/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QualityExecutionValidationError, QualityExecutionView } from '@erve/types';
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

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function button(label: string): HTMLButtonElement {
  return [...container.querySelectorAll('button')].find((item) => item.textContent === label)!;
}

function validationError(
  componentId: string,
  componentTitle: string,
  fieldKey: string,
  fieldLabel: string,
  rowIndex?: number,
): QualityExecutionValidationError {
  return {
    sectionId: componentId === 'meeting' ? 'meeting-section' : 'approval-section',
    sectionTitle:
      componentId === 'meeting'
        ? 'Meeting context'
        : componentId === 'follow-up'
          ? 'People and follow-up'
          : 'Approval',
    componentId,
    componentTitle,
    fieldKey,
    fieldLabel,
    ...(rowIndex === undefined ? {} : { rowIndex }),
    code: 'REQUIRED',
    message: `${fieldLabel} is required`,
  };
}

const execution = (status: 'DRAFT' | 'FINALIZED' = 'DRAFT'): QualityExecutionView => ({
  id: 'execution-1',
  jobOrderId: 'job-1',
  jobOrderNumber: 'JO-2026-000001',
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
  productionContext: {
    associatedActivity: { id: 'sewing-stage', code: 'SEWING', name: 'Sewing' },
    stages: [
      {
        id: 'cutting-stage',
        code: 'CUTTING',
        name: 'Cutting',
        status: 'COMPLETED',
        relationship: 'PREVIOUS',
      },
      {
        id: 'sewing-stage',
        code: 'SEWING',
        name: 'Sewing',
        status: 'IN_PROGRESS',
        relationship: 'ASSOCIATED',
      },
      {
        id: 'finishing-stage',
        code: 'FINISHING',
        name: 'Finishing',
        status: 'NOT_STARTED',
        relationship: 'FOLLOWING',
      },
    ],
  },
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
          config: {
            metrics: [
              { key: 'cut', label: '% Cut', sourceActivityCode: 'CUTTING' },
              { key: 'sewn', label: '% Sewn', sourceActivityCode: 'SEWING' },
              { key: 'finish', label: '% Finish', sourceActivityCode: 'FINISHING' },
            ],
          },
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

const ppmExecution = (status: 'DRAFT' | 'FINALIZED' = 'DRAFT'): QualityExecutionView => {
  const item = execution(status);
  return {
    ...item,
    activityName: 'SIZE SET / PRE-PRODUCTION REPORT',
    qualityForm: { ...item.qualityForm, code: 'PPM', name: 'Pre-Production Meeting Report' },
    responses: {
      ...item.responses,
      fieldResponses: [
        { componentId: 'meeting', fieldKey: 'meetingDate', value: '2026-08-20' },
        { componentId: 'meeting', fieldKey: 'conductedBy', value: 'Asha' },
      ],
      attendees: [{ componentId: 'attendees', roleKey: 'Merchandiser', attendeeName: 'Meera' }],
      actions: [
        {
          componentId: 'follow-up',
          values: { action: 'Approve trims', owner: 'Ravi', targetDate: '2026-08-24' },
        },
      ],
      comments: [{ componentId: 'notes', value: 'Confirm wash standard.' }],
      signoffs: [{ componentId: 'signatures', roleKey: 'inspector', signatoryName: 'Anil' }],
    },
    sections: [
      {
        id: 'meeting-section',
        sequence: 1,
        title: 'Meeting context',
        components: [
          {
            id: 'context',
            sequence: 1,
            type: 'SYSTEM_CONTEXT',
            title: 'System context',
            config: {
              fields: [
                { key: 'supplier', label: 'Supplier' },
                { key: 'order', label: 'Order Number' },
                { key: 'quantity', label: 'Quantity' },
              ],
            },
            systemValue: [
              { key: 'supplier', value: 'Clifton', available: true },
              { key: 'order', value: 'PO-2026-000001', available: true },
              { key: 'quantity', value: 60, available: true },
            ],
          },
          {
            id: 'meeting',
            sequence: 2,
            type: 'FIELD_GROUP',
            title: 'Meeting details',
            config: {
              fields: [
                { key: 'meetingDate', label: 'Meeting Date', dataType: 'DATE', required: true },
                {
                  key: 'conductedBy',
                  label: 'Meeting Conducted By',
                  dataType: 'TEXT',
                  required: true,
                },
              ],
            },
          },
        ],
      },
      {
        id: 'people-section',
        sequence: 2,
        title: 'People and follow-up',
        components: [
          {
            id: 'attendees',
            sequence: 1,
            type: 'ATTENDEE_LIST',
            title: 'Attendees',
            config: { roles: ['Merchandiser', 'QA'] },
          },
          {
            id: 'follow-up',
            sequence: 2,
            type: 'ACTION_LIST',
            title: 'Follow-up actions',
            config: {
              columns: [
                { key: 'action', label: 'Action', dataType: 'TEXT', required: true },
                { key: 'owner', label: 'Owner', dataType: 'TEXT' },
                { key: 'targetDate', label: 'Target date', dataType: 'DATE' },
              ],
            },
          },
          { id: 'notes', sequence: 3, type: 'COMMENTS', title: 'Notes', config: {} },
        ],
      },
      {
        id: 'approval-section',
        sequence: 3,
        title: 'Approval',
        components: [
          {
            id: 'signatures',
            sequence: 1,
            type: 'SIGNATURES',
            title: 'Sign-off',
            config: {
              roles: [
                { key: 'inspector', label: 'Inspector', required: true },
                { key: 'qaManager', label: 'QA Manager', required: true },
                { key: 'supplier', label: 'Supplier', required: true },
              ],
            },
          },
        ],
      },
    ],
  };
};

const finalExecution = (status: 'DRAFT' | 'FINALIZED' = 'DRAFT'): QualityExecutionView => {
  const item = execution(status);
  const inspection = item.sections.find((section) => section.id === 's1')!;
  const tests = inspection.components.find((component) => component.id === 'tests')!;
  tests.title = 'On-site tests';
  tests.config = {
    tests: [
      { key: 'gsm', label: 'GSM', responseOptions: ['PASSED', 'FAILED', 'N/A'] },
      {
        key: 'certificate',
        label: 'Certificate inspection',
        responseOptions: ['ACCEPTABLE', 'NOT ACCEPTABLE', 'NOT AVAILABLE'],
      },
    ],
  };
  const quantity = inspection.components.find((component) => component.id === 'quantity')!;
  quantity.title = 'Inspection and shipment sampling';
  quantity.config = {
    fields: [
      {
        key: 'totalOrderQuantity',
        label: 'Total Order Quantity',
        dataType: 'NUMBER',
        source: 'SYSTEM',
      },
      {
        key: 'quantityInspected',
        label: 'Quantity Inspected',
        dataType: 'NUMBER',
        source: 'SYSTEM',
      },
      { key: 'numberOfBoxes', label: 'Number of Boxes', dataType: 'NUMBER' },
      { key: 'openCartons', label: 'Open Cartons', dataType: 'NUMBER' },
    ],
  };
  quantity.systemValue = [
    { key: 'totalOrderQuantity', value: 100, available: true },
    { key: 'quantityInspected', value: 25, available: true },
  ];
  return {
    ...item,
    activityName: 'Final Inspection',
    qualityForm: { ...item.qualityForm, code: 'FINAL', name: 'Final Inspection Report' },
    batchNumber: 2,
    inspectedQuantity: 25,
    coverage: {
      preparedQuantityAuthoritative: true,
      preparedQuantity: 60,
      inspectedQuantity: status === 'FINALIZED' ? 45 : 20,
      remainingQuantity: status === 'FINALIZED' ? 15 : 40,
      complete: false,
      reconciliationConflict: false,
      state: 'IN_PROGRESS',
      passedBatches: status === 'FINALIZED' ? 2 : 1,
      failedBatches: 0,
      hasFailedBatches: false,
      batches: [
        {
          id: 'batch-1',
          batchNumber: 1,
          inspectedQuantity: 20,
          status: 'FINALIZED',
          outcome: 'PASS',
          finalizedAt: '2026-08-20T10:00:00.000Z',
        },
        {
          id: item.id,
          batchNumber: 2,
          inspectedQuantity: 25,
          status,
          outcome: status === 'FINALIZED' ? 'PASS' : null,
          finalizedAt: status === 'FINALIZED' ? '2026-08-21T10:00:00.000Z' : null,
        },
      ],
    },
  };
};

describe('QualityExecutionForm shared web/mobile renderer', () => {
  it('renders immutable definition order, read-only system data, and every operational component', () => {
    act(() =>
      root.render(
        <QualityExecutionForm execution={execution()} onSave={vi.fn()} onFinalize={vi.fn()} />,
      ),
    );
    expect(
      [...container.querySelectorAll('[data-quality-execution-section="true"] h2')].map(
        (node) => node.textContent,
      ),
    ).toEqual(['Inspection', 'Conclusion']);
    expect(container.textContent).toContain('JO-1');
    expect(container.textContent).toContain('Cutting');
    expect(container.textContent).toContain('Sewing');
    expect(container.textContent).toContain('Finishing');
    expect(container.textContent).toContain('Complete');
    expect(container.textContent).toContain('In progress');
    expect(container.textContent).toContain('Not started');
    expect(container.textContent).toContain('Associated Production activity');
    expect(container.textContent).not.toContain('% Cut');
    expect(container.textContent).not.toContain('% Sewn');
    expect(container.textContent).not.toContain('% Finish');
    expect(container.textContent).not.toContain('Unavailable');
    expect(container.textContent).not.toMatch(/\d+(?:\.\d+)?%/);
    expect(container.textContent).toContain('Read-only · Production lifecycle state.');
    expect(container.querySelector('[aria-label="Workmanship"]')).not.toBeNull();
    expect(container.querySelector('#quality-aql-MAJOR-maxAllowed')).not.toBeNull();
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

  it('maps shared checklist choice edits back into definition-driven responses', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    act(() =>
      root.render(
        <QualityExecutionForm execution={execution()} onSave={save} onFinalize={vi.fn()} />,
      ),
    );

    const group = container.querySelector('[role="radiogroup"][aria-label="Workmanship"]')!;
    await act(async () =>
      (group.querySelector('input[value="PASSED"]') as HTMLInputElement).click(),
    );
    await act(async () => button('Save draft').click());

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        checklistResponses: [{ componentId: 'check', itemKey: 'work', response: 'PASSED' }],
      }),
    );
  });

  it('presents Final test results with compact choices and the shared Select fallback', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    act(() =>
      root.render(
        <QualityExecutionForm execution={finalExecution()} onSave={save} onFinalize={vi.fn()} />,
      ),
    );

    const compact = container.querySelector('[role="radiogroup"][aria-label="GSM"]')!;
    expect(compact).not.toBeNull();
    expect(compact.querySelectorAll('input[type="radio"]')).toHaveLength(3);
    expect(
      container.querySelector('[role="combobox"][aria-label="Certificate inspection"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-component-id="tests"] select:not([aria-hidden="true"])'),
    ).toBeNull();

    await act(async () =>
      (compact.querySelector('input[value="PASSED"]') as HTMLInputElement).click(),
    );
    await act(async () => button('Save draft').click());
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        testResults: [{ componentId: 'tests', testKey: 'gsm', response: 'PASSED' }],
      }),
    );
  });

  it('distinguishes authoritative prior, current, and remaining Final batch quantities', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    act(() =>
      root.render(
        <QualityExecutionForm execution={finalExecution()} onSave={save} onFinalize={vi.fn()} />,
      ),
    );

    expect(
      container.querySelector('[aria-label="Final inspection batch summary"]')?.textContent,
    ).toBe(
      'Prepared 60 · Previously inspected 20 · This inspection 25 · Remaining after this batch 15',
    );
    const reconciliation = container.querySelector(
      '[data-quality-quantity-reconciliation="true"]',
    )!;
    expect(reconciliation.textContent).toContain('Prepared quantity60');
    expect(reconciliation.textContent).toContain('Previously inspected20');
    expect(reconciliation.textContent).toContain('This inspection25');
    expect(reconciliation.textContent).toContain('Remaining after this batch15');
    expect(reconciliation.textContent).toContain('15 units remain after this batch.');
    expect(
      reconciliation.querySelector('[data-reconciliation-state="IN_PROGRESS"]'),
    ).not.toBeNull();
    expect(reconciliation.querySelector('[data-quality-field-grid="true"]')?.className).toContain(
      'lg:grid-cols-4',
    );

    act(() =>
      setInputValue(
        container.querySelector('#quality-quantity-numberOfBoxes') as HTMLInputElement,
        '6',
      ),
    );
    await act(async () => button('Save draft').click());
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        quantities: [{ componentId: 'quantity', fieldKey: 'numberOfBoxes', value: 6 }],
      }),
    );
  });

  it('explains unknown prepared quantity without disabling permissive draft save', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const item = finalExecution();
    item.coverage = {
      ...item.coverage!,
      preparedQuantityAuthoritative: false,
      preparedQuantity: null,
      remainingQuantity: null,
      state: 'UNKNOWN',
    };
    act(() =>
      root.render(<QualityExecutionForm execution={item} onSave={save} onFinalize={vi.fn()} />),
    );

    expect(container.textContent).toContain('Prepared quantity unavailable');
    expect(container.textContent).toContain(
      'This draft can be saved, but prepared quantity reconciliation is required before finalization.',
    );
    expect(container.querySelector('[data-reconciliation-state="UNKNOWN"]')).not.toBeNull();
    await act(async () => button('Save draft').click());
    expect(save).toHaveBeenCalledOnce();
  });

  it('keeps finalized Final tests and reconciliation semantic in the same geometry', () => {
    const item = finalExecution('FINALIZED');
    item.responses.testResults = [
      { componentId: 'tests', testKey: 'gsm', response: 'PASSED' },
      { componentId: 'tests', testKey: 'certificate', response: 'ACCEPTABLE' },
    ];
    item.responses.quantities = [
      { componentId: 'quantity', fieldKey: 'numberOfBoxes', value: 6 },
      { componentId: 'quantity', fieldKey: 'openCartons', value: 2 },
    ];
    act(() =>
      root.render(<QualityExecutionForm execution={item} onSave={vi.fn()} onFinalize={vi.fn()} />),
    );

    const tests = container.querySelector('[data-component-id="tests"]')!;
    const reconciliation = container.querySelector('[data-component-id="quantity"]')!;
    expect(tests.querySelector('input, select, [role="combobox"]')).toBeNull();
    expect(tests.textContent).toContain('PASSED');
    expect(tests.textContent).toContain('ACCEPTABLE');
    expect(reconciliation.querySelector('input')).toBeNull();
    expect(reconciliation.textContent).toContain('Number of Boxes6');
    expect(
      [...container.querySelectorAll('[data-quality-execution-section="true"] h2')].map(
        (node) => node.textContent,
      ),
    ).toEqual(['Inspection', 'Conclusion']);
  });

  it('lets shared outcome remarks use the section width while keeping choices compact', () => {
    act(() =>
      root.render(
        <QualityExecutionForm execution={execution()} onSave={vi.fn()} onFinalize={vi.fn()} />,
      ),
    );

    const outcome = container.querySelector('[data-quality-inspection-outcome="true"]')!;
    expect(outcome.className).toContain('w-full');
    expect(outcome.className).not.toContain('max-w-2xl');
    expect(
      outcome.querySelector('[role="radiogroup"]')?.parentElement?.parentElement?.className,
    ).toContain('max-w-md');
    expect(outcome.querySelector('textarea')?.className).toContain('w-full');
  });

  it('renders every configured component once without repeating Inline specialized content', () => {
    const item = execution();
    act(() =>
      root.render(<QualityExecutionForm execution={item} onSave={vi.fn()} onFinalize={vi.fn()} />),
    );

    const configured = item.sections.flatMap((section) => section.components);
    for (const component of configured)
      expect(container.querySelectorAll(`[data-component-id="${component.id}"]`)).toHaveLength(1);
    expect(container.querySelectorAll('[data-component-type="AQL_RESULT"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-quality-production-context="true"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-quality-defect-list="true"]')).toHaveLength(1);
  });

  it('renders one configured Sign-off once and preserves distinct signature groups', () => {
    const item = finalExecution();
    const signatures = item.sections
      .flatMap((section) => section.components)
      .filter((component) => component.type === 'SIGNATURES');
    expect(signatures).toHaveLength(1);

    act(() =>
      root.render(<QualityExecutionForm execution={item} onSave={vi.fn()} onFinalize={vi.fn()} />),
    );
    expect(container.querySelectorAll('[data-component-type="SIGNATURES"]')).toHaveLength(1);
    expect(container.querySelectorAll(`[data-component-id="${signatures[0]!.id}"]`)).toHaveLength(
      1,
    );

    const conclusion = item.sections.find((section) => section.title === 'Conclusion')!;
    conclusion.components.push({
      id: 'signatures-customer',
      sequence: 99,
      type: 'SIGNATURES',
      title: 'Customer sign-off',
      config: { roles: [{ key: 'customer', label: 'Customer', required: false }] },
    });
    act(() =>
      root.render(<QualityExecutionForm execution={item} onSave={vi.fn()} onFinalize={vi.fn()} />),
    );
    expect(container.querySelectorAll('[data-component-type="SIGNATURES"]')).toHaveLength(2);
  });

  it('does not invent a configured Production stage when lifecycle state is absent', () => {
    const item = execution();
    item.productionContext!.stages = item.productionContext!.stages.filter(
      (stage) => stage.code !== 'FINISHING',
    );

    act(() =>
      root.render(<QualityExecutionForm execution={item} onSave={vi.fn()} onFinalize={vi.fn()} />),
    );

    expect(container.textContent).not.toContain('Finishing');
    expect(container.textContent).not.toContain('% Finish');
  });

  it('retains legitimately distinct components of the same type', () => {
    const item = execution();
    item.sections[0]!.components.push({
      id: 'defects-finishing',
      sequence: 6,
      type: 'DEFECT_LIST',
      title: 'Finishing defects',
      config: { severities: ['MINOR'], captureQuantity: true },
    });

    act(() =>
      root.render(<QualityExecutionForm execution={item} onSave={vi.fn()} onFinalize={vi.fn()} />),
    );

    expect(container.querySelectorAll('[data-component-type="DEFECT_LIST"]')).toHaveLength(2);
    expect(container.querySelector('[data-component-id="defects"]')).not.toBeNull();
    expect(container.querySelector('[data-component-id="defects-finishing"]')).not.toBeNull();
  });

  it('renders finalized executions as read-only and preserves outcome state', () => {
    const item = execution('FINALIZED');
    item.responses.outcome = { componentId: 'outcome', value: 'FAIL', remarks: 'Failed' };
    item.responses.aqlResults = [
      { componentId: 'aql', severity: 'MAJOR', maxAllowed: 2, found: 3 },
    ];
    item.responses.defects = [
      { componentId: 'defects', description: 'Loose seam at side', severity: 'MAJOR', quantity: 2 },
    ];
    item.responses.correctiveActions = [
      { componentId: 'actions', values: { action: 'Repair affected pieces' } },
    ];
    item.attachments = [
      {
        id: 'attachment-1',
        componentId: 'files',
        requirementKey: 'photo',
        fileName: 'inline-evidence.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 2048,
        createdAt: '2026-08-20T10:00:00.000Z',
      },
    ];
    item.responses.checklistResponses = [
      { componentId: 'check', itemKey: 'work', response: 'PASSED' },
    ];
    act(() =>
      root.render(<QualityExecutionForm execution={item} onSave={vi.fn()} onFinalize={vi.fn()} />),
    );
    expect(container.querySelector('fieldset')?.disabled).toBe(true);
    expect(container.textContent).not.toContain('Save draft');
    expect(container.querySelector('[role="radiogroup"][aria-label="Workmanship"]')).toBeNull();
    expect(container.querySelector('[data-quality-checklist-result="true"]')?.textContent).toBe(
      '\u2713PASSED',
    );
    expect(container.querySelector('[data-quality-inspection-outcome="true"] input')).toBeNull();
    expect(
      container.querySelector('[data-quality-inspection-outcome="true"]')?.textContent,
    ).toContain('✕FAIL');
    expect(container.textContent).toContain('Loose seam at side');
    expect(container.textContent).toContain('Repair affected pieces');
    expect(container.textContent).toContain('inline-evidence.jpg');
    expect(container.querySelector('[data-quality-defect-list="true"] input')).toBeNull();
    expect(container.querySelector('[data-quality-corrective-actions="true"] input')).toBeNull();
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(container.textContent).not.toContain('Remove defect');
    expect(container.textContent).not.toContain('Remove action');
  });

  it('keeps defect and corrective-action editing functional with compact shared rows', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    act(() =>
      root.render(
        <QualityExecutionForm execution={execution()} onSave={save} onFinalize={vi.fn()} />,
      ),
    );

    act(() => button('Add defect').click());
    act(() =>
      setInputValue(
        container.querySelector('[aria-label="Defect description"]') as HTMLInputElement,
        'Broken stitch',
      ),
    );
    act(() =>
      setInputValue(
        container.querySelector('[aria-label="Defect quantity"]') as HTMLInputElement,
        '4',
      ),
    );
    act(() => button('Add corrective action').click());
    act(() =>
      setInputValue(container.querySelector('#quality-actions-row-0-action')!, 'Repair pieces'),
    );
    act(() =>
      (
        container.querySelector(
          '[role="radiogroup"][aria-label="Outcome"] input[value="PASS"]',
        ) as HTMLInputElement
      ).click(),
    );
    await act(async () => button('Save draft').click());

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        defects: [
          expect.objectContaining({
            componentId: 'defects',
            description: 'Broken stitch',
            severity: 'MAJOR',
            quantity: 4,
          }),
        ],
        correctiveActions: [{ componentId: 'actions', values: { action: 'Repair pieces' } }],
        outcome: { componentId: 'outcome', value: 'PASS' },
      }),
    );

    act(() => button('Remove defect').click());
    act(() => button('Remove action').click());
    expect(container.textContent).toContain('No defects recorded.');
    expect(container.textContent).toContain('No corrective actions added.');
  });

  it('presents evidence through the shared upload surface and preserves upload/remove callbacks', async () => {
    const upload = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue(undefined);
    const item = execution();
    item.attachments = [
      {
        id: 'attachment-1',
        componentId: 'files',
        requirementKey: 'photo',
        fileName: 'existing.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 2048,
        createdAt: '2026-08-20T10:00:00.000Z',
      },
    ];
    act(() =>
      root.render(
        <QualityExecutionForm
          execution={item}
          onSave={vi.fn()}
          onFinalize={vi.fn()}
          onUpload={upload}
          onRemoveAttachment={remove}
        />,
      ),
    );

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.className).toContain('sr-only');
    expect(container.textContent).toContain('Add more evidence');
    expect(container.textContent).toContain('Uploaded · 2 KB');
    const file = new File(['evidence'], 'new-evidence.jpg', { type: 'image/jpeg' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    expect(upload).toHaveBeenCalledWith('files', 'photo', file);

    await act(async () => button('Remove').click());
    expect(remove).toHaveBeenCalledWith('attachment-1');
  });

  it('renders a PPM definition as a responsive operational form with hydrated values', () => {
    act(() =>
      root.render(
        <QualityExecutionForm execution={ppmExecution()} onSave={vi.fn()} onFinalize={vi.fn()} />,
      ),
    );

    expect(container.querySelector('h1')?.textContent).toBe('Size Set / Pre-Production Report');
    expect(
      [...container.querySelectorAll('[data-quality-execution-section="true"] h2')].map(
        (node) => node.textContent,
      ),
    ).toEqual(['Meeting context', 'People and follow-up', 'Approval']);
    expect(container.querySelectorAll('[data-quality-execution-section="true"] h2')).toHaveLength(
      3,
    );

    const context = [...container.querySelectorAll('fieldset')].find(
      (fieldset) => fieldset.querySelector('legend')?.textContent === 'System context',
    )!;
    expect(context.textContent).toContain('Clifton');
    expect(context.textContent).toContain('PO-2026-000001');
    expect(context.querySelector('input, textarea, select')).toBeNull();
    expect(context.querySelector('[data-quality-read-only-grid="true"]')).not.toBeNull();
    expect(context.querySelector('dl')?.className).toContain('grid-cols-1');

    const meeting = [...container.querySelectorAll('fieldset')].find(
      (fieldset) => fieldset.querySelector('legend')?.textContent === 'Meeting details',
    )!;
    const meetingGrid = meeting.querySelector('[data-quality-field-grid="true"]')!;
    expect(meetingGrid.className).toContain('sm:grid-cols-2');
    expect(meetingGrid.className).toContain('lg:grid-cols-3');

    expect(
      (container.querySelector('#quality-meeting-meetingDate') as HTMLInputElement).value,
    ).toBe('20/08/2026');
    expect(
      (container.querySelector('#quality-meeting-conductedBy') as HTMLInputElement).value,
    ).toBe('Asha');
    expect(
      (container.querySelector('#quality-attendees-Merchandiser') as HTMLInputElement).value,
    ).toBe('Meera');
    expect((container.querySelector('#quality-notes-value') as HTMLTextAreaElement).value).toBe(
      'Confirm wash standard.',
    );
    expect(
      (container.querySelector('#quality-signatures-inspector') as HTMLInputElement).value,
    ).toBe('Anil');
  });

  it('adds, edits, removes, and saves configured PPM responses', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    act(() =>
      root.render(
        <QualityExecutionForm execution={ppmExecution()} onSave={save} onFinalize={vi.fn()} />,
      ),
    );

    act(() =>
      setInputValue(container.querySelector('#quality-meeting-meetingDate')!, '21/08/2026'),
    );
    act(() => setInputValue(container.querySelector('#quality-meeting-conductedBy')!, 'Leela'));
    act(() => setInputValue(container.querySelector('#quality-attendees-QA')!, 'Nina'));
    act(() => button('Add follow-up').click());
    const actionInputs = [...container.querySelectorAll<HTMLInputElement>('input')].filter(
      (input) => input.labels?.[0]?.textContent?.includes('Action'),
    );
    expect(actionInputs).toHaveLength(2);
    act(() => setInputValue(actionInputs[1]!, 'Book lab test'));
    act(() => button('Remove item').click());
    expect(
      [...container.querySelectorAll<HTMLInputElement>('input')].filter((input) =>
        input.labels?.[0]?.textContent?.includes('Action'),
      ),
    ).toHaveLength(1);

    await act(async () => button('Save draft').click());
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: 2,
        fieldResponses: expect.arrayContaining([
          { componentId: 'meeting', fieldKey: 'meetingDate', value: '2026-08-21' },
          { componentId: 'meeting', fieldKey: 'conductedBy', value: 'Leela' },
        ]),
        attendees: expect.arrayContaining([
          { componentId: 'attendees', roleKey: 'QA', attendeeName: 'Nina' },
        ]),
        actions: [{ componentId: 'follow-up', values: { action: 'Book lab test' } }],
      }),
    );

    const saved = save.mock.calls[0]![0];
    act(() =>
      root.render(
        <QualityExecutionForm
          key="reloaded-draft"
          execution={{ ...ppmExecution(), version: 3, responses: saved }}
          onSave={vi.fn()}
          onFinalize={vi.fn()}
        />,
      ),
    );
    expect(
      (container.querySelector('#quality-meeting-conductedBy') as HTMLInputElement).value,
    ).toBe('Leela');
    expect((container.querySelector('#quality-attendees-QA') as HTMLInputElement).value).toBe(
      'Nina',
    );
    expect(
      [...container.querySelectorAll<HTMLInputElement>('input')].some(
        (input) => input.value === 'Book lab test',
      ),
    ).toBe(true);
  });

  it('shows configured required indicators and maps finalize errors inline and into a navigable summary', () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    const errors = [
      validationError('meeting', 'Meeting details', 'conductedBy', 'Meeting Conducted By'),
      validationError('signatures', 'Sign-off', 'qaManager', 'QA Manager'),
      validationError('signatures', 'Sign-off', 'supplier', 'Supplier'),
    ];

    act(() =>
      root.render(
        <QualityExecutionForm
          execution={ppmExecution()}
          validationErrors={errors}
          error="Please complete the required fields"
          onSave={vi.fn()}
          onFinalize={vi.fn()}
        />,
      ),
    );

    expect(container.querySelector('label[for="quality-meeting-conductedBy"]')?.textContent).toBe(
      'Meeting Conducted By*',
    );
    expect(container.querySelector('label[for="quality-signatures-qaManager"]')?.textContent).toBe(
      'QA Manager*',
    );
    const first = container.querySelector('#quality-meeting-conductedBy') as HTMLInputElement;
    expect(first.getAttribute('aria-invalid')).toBe('true');
    expect(container.textContent).toContain('Meeting Conducted By is required');
    expect(container.textContent).toContain(
      'Meeting context → Meeting details → Meeting Conducted By',
    );
    expect(container.textContent).toContain('Approval → Sign-off → QA Manager');
    expect(document.activeElement).toBe(first);
    expect(scrollIntoView).toHaveBeenCalled();

    act(() => setInputValue(first, '   '));
    expect(first.getAttribute('aria-invalid')).toBe('true');
    act(() => setInputValue(first, 'Leela'));
    expect(first.getAttribute('aria-invalid')).toBeNull();
    expect(container.textContent).not.toContain('Meeting Conducted By is required');

    act(() =>
      [...container.querySelectorAll<HTMLButtonElement>('button')]
        .find((item) => item.textContent?.includes('QA Manager'))!
        .click(),
    );
    expect(document.activeElement).toBe(container.querySelector('#quality-signatures-qaManager'));
  });

  it('identifies and clears the exact invalid field in a repeating row', () => {
    act(() =>
      root.render(
        <QualityExecutionForm execution={ppmExecution()} onSave={vi.fn()} onFinalize={vi.fn()} />,
      ),
    );
    act(() => button('Add follow-up').click());
    const rowError = validationError('follow-up', 'Follow-up actions', 'action', 'Action', 1);
    act(() =>
      root.render(
        <QualityExecutionForm
          execution={ppmExecution()}
          validationErrors={[rowError]}
          onSave={vi.fn()}
          onFinalize={vi.fn()}
        />,
      ),
    );

    const invalid = container.querySelector('#quality-follow-up-row-1-action') as HTMLInputElement;
    expect(invalid.getAttribute('aria-invalid')).toBe('true');
    expect(container.textContent).toContain('Follow-up actions 2 → Action');
    act(() => setInputValue(invalid, 'Book lab test'));
    expect(invalid.getAttribute('aria-invalid')).toBeNull();
    expect(container.textContent).not.toContain('Action is required');
  });

  it('keeps draft saving permissive and submits a completed PPM for finalization', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const finalize = vi.fn().mockResolvedValue(undefined);
    act(() =>
      root.render(
        <QualityExecutionForm execution={ppmExecution()} onSave={save} onFinalize={finalize} />,
      ),
    );

    await act(async () => button('Save draft').click());
    expect(save).toHaveBeenCalledOnce();

    act(() => setInputValue(container.querySelector('#quality-signatures-qaManager')!, 'Priya'));
    act(() => setInputValue(container.querySelector('#quality-signatures-supplier')!, 'Clifton'));
    await act(async () => button('Finalize').click());
    expect(finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        signoffs: expect.arrayContaining([
          expect.objectContaining({ roleKey: 'qaManager', signatoryName: 'Priya' }),
          expect.objectContaining({ roleKey: 'supplier', signatoryName: 'Clifton' }),
        ]),
      }),
    );
  });

  it('toggles the generic follow-up empty state as rows are added and removed', () => {
    const item = ppmExecution();
    item.responses.actions = [];
    act(() =>
      root.render(<QualityExecutionForm execution={item} onSave={vi.fn()} onFinalize={vi.fn()} />),
    );

    expect(container.textContent).toContain('No follow-up actions added.');
    expect(button('Add follow-up')).not.toBeNull();

    act(() => button('Add follow-up').click());
    expect(container.textContent).not.toContain('No follow-up actions added.');

    act(() => button('Remove item').click());
    expect(container.textContent).toContain('No follow-up actions added.');
    expect(button('Add follow-up')).not.toBeNull();
  });

  it('keeps every configured PPM control immutable after finalization', () => {
    act(() =>
      root.render(
        <QualityExecutionForm
          execution={ppmExecution('FINALIZED')}
          onSave={vi.fn()}
          onFinalize={vi.fn()}
        />,
      ),
    );
    expect([...container.querySelectorAll('fieldset')].every((fieldset) => fieldset.disabled)).toBe(
      true,
    );
    expect(
      [...container.querySelectorAll('[data-quality-execution-section="true"] h2')].map(
        (node) => node.textContent,
      ),
    ).toEqual(['Meeting context', 'People and follow-up', 'Approval']);
    expect(container.querySelector('#quality-meeting-meetingDate')).toBeNull();
    expect(container.querySelector('#quality-attendees-Merchandiser')).toBeNull();
    expect(container.querySelector('#quality-follow-up-row-0-action')).toBeNull();
    expect(container.querySelector('#quality-signatures-inspector')).toBeNull();
    expect(container.querySelector('#quality-notes-value')).toBeNull();
    expect(
      container.querySelectorAll('[data-quality-read-only-value="true"]').length,
    ).toBeGreaterThan(0);
    expect(container.textContent).toContain('20/08/2026');
    expect(container.textContent).toContain('Meera');
    expect(container.textContent).toContain('Approve trims');
    expect(container.textContent).toContain('24/08/2026');
    expect(container.textContent).toContain('Confirm wash standard.');
    expect(container.textContent).toContain('Anil');
    expect(container.textContent).not.toContain('Add follow-up');
    expect(container.textContent).not.toContain('Remove item');
    expect(container.textContent).not.toContain('Save draft');
  });

  it('blocks Start reinspection until the current Factory rework cycle is COMPLETED', async () => {
    const item = finalExecution('FINALIZED');
    item.finalBatch = {
      id: 'batch-2',
      batchNumber: 2,
      physicalQuantity: 25,
      disposition: 'AWAITING_REINSPECTION',
      allocations: [{ jobOrderLineSizeId: 'size-1', sizeCode: 'M', sizeLabel: 'M', quantity: 25 }],
      attempts: [],
      release: null,
      reworks: [
        {
          id: 'rework-1',
          cycleNumber: 1,
          status: 'IN_PROGRESS',
          failedQualityExecutionId: 'execution-1',
          failedAttemptNumber: 1,
          notes: 'Reinforcing the collar seam',
          acknowledgedBy: { id: 'u1', name: 'Factory User', email: 'f@test.local' },
          acknowledgedAt: '2026-08-20T10:00:00.000Z',
          startedBy: { id: 'u1', name: 'Factory User', email: 'f@test.local' },
          startedAt: '2026-08-20T11:00:00.000Z',
          completedBy: null,
          completedAt: null,
          version: 3,
          createdAt: '2026-08-20T09:00:00.000Z',
          updatedAt: '2026-08-20T11:00:00.000Z',
        },
      ],
    };
    const onStartReinspection = vi.fn().mockResolvedValue(undefined);
    act(() =>
      root.render(
        <QualityExecutionForm
          execution={item}
          onSave={vi.fn()}
          onFinalize={vi.fn()}
          onStartReinspection={onStartReinspection}
          onPermanentlyReject={vi.fn()}
        />,
      ),
    );
    expect(container.textContent).toContain('Factory rework in progress');
    expect(container.textContent).toContain('Reinforcing the collar seam');
    const blockedButton = button('Start reinspection (factory rework must complete first)');
    expect(blockedButton.disabled).toBe(true);
    await act(async () => blockedButton.click());
    expect(onStartReinspection).not.toHaveBeenCalled();

    item.finalBatch = {
      ...item.finalBatch,
      reworks: [
        {
          ...item.finalBatch.reworks![0]!,
          status: 'COMPLETED',
          completedBy: { id: 'u1', name: 'Factory User', email: 'f@test.local' },
          completedAt: '2026-08-20T12:00:00.000Z',
        },
      ],
    };
    act(() =>
      root.render(
        <QualityExecutionForm
          execution={item}
          onSave={vi.fn()}
          onFinalize={vi.fn()}
          onStartReinspection={onStartReinspection}
          onPermanentlyReject={vi.fn()}
        />,
      ),
    );
    expect(container.textContent).toContain('Ready for reinspection');
    const readyButton = button('Start reinspection');
    expect(readyButton.disabled).toBe(false);
    await act(async () => readyButton.click());
    expect(onStartReinspection).toHaveBeenCalledTimes(1);
  });

  it('requires explicit PASS/FAIL confirmation before finalizing an inspection with an outcome', async () => {
    const finalize = vi.fn().mockResolvedValue(undefined);
    act(() =>
      root.render(
        <QualityExecutionForm execution={execution()} onSave={vi.fn()} onFinalize={finalize} />,
      ),
    );
    const group = container.querySelector('[role="radiogroup"][aria-label="Outcome"]')!;
    await act(async () =>
      (group.querySelector('input[value="PASS"]') as HTMLInputElement).click(),
    );

    await act(async () => button('Finalize').click());
    expect(finalize).not.toHaveBeenCalled();
    expect(
      Array.from(document.body.querySelectorAll('[role="dialog"]')).some((dialog) =>
        dialog.textContent?.includes('Finalize this inspection as PASS?'),
      ),
    ).toBe(true);

    const confirm = Array.from(document.body.querySelectorAll('button')).find(
      (item) => item.textContent === 'Yes, finalize',
    ) as HTMLButtonElement;
    await act(async () => confirm.click());
    expect(finalize).toHaveBeenCalledOnce();
  });

  it('shows the FAIL confirmation wording and leaves the form unchanged when cancelled', async () => {
    const finalize = vi.fn().mockResolvedValue(undefined);
    act(() =>
      root.render(
        <QualityExecutionForm execution={execution()} onSave={vi.fn()} onFinalize={finalize} />,
      ),
    );
    const group = container.querySelector('[role="radiogroup"][aria-label="Outcome"]')!;
    await act(async () =>
      (group.querySelector('input[value="FAIL"]') as HTMLInputElement).click(),
    );

    await act(async () => button('Finalize').click());
    expect(
      Array.from(document.body.querySelectorAll('[role="dialog"]')).some((dialog) =>
        dialog.textContent?.includes('Finalize this inspection as FAIL?'),
      ),
    ).toBe(true);

    const cancel = Array.from(document.body.querySelectorAll('button')).find(
      (item) => item.textContent === 'Cancel',
    ) as HTMLButtonElement;
    await act(async () => cancel.click());

    expect(finalize).not.toHaveBeenCalled();
    expect(
      (group.querySelector('input[value="FAIL"]') as HTMLInputElement).checked,
    ).toBe(true);
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it('finalizes a PPM directly without a confirmation dialog, since it has no PASS/FAIL outcome', async () => {
    const finalize = vi.fn().mockResolvedValue(undefined);
    act(() =>
      root.render(
        <QualityExecutionForm execution={ppmExecution()} onSave={vi.fn()} onFinalize={finalize} />,
      ),
    );
    act(() => setInputValue(container.querySelector('#quality-signatures-qaManager')!, 'Priya'));
    act(() => setInputValue(container.querySelector('#quality-signatures-supplier')!, 'Clifton'));
    await act(async () => button('Finalize').click());
    expect(finalize).toHaveBeenCalledOnce();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });
});
