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

describe('QualityExecutionForm shared web/mobile renderer', () => {
  it('renders immutable definition order, read-only system data, and every operational component', () => {
    act(() =>
      root.render(
        <QualityExecutionForm execution={execution()} onSave={vi.fn()} onFinalize={vi.fn()} />,
      ),
    );
    expect(
      [...container.querySelectorAll('section > div > h2')].map((node) => node.textContent),
    ).toEqual(['Inspection', 'Conclusion']);
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

  it('renders a PPM definition as a responsive operational form with hydrated values', () => {
    act(() =>
      root.render(
        <QualityExecutionForm execution={ppmExecution()} onSave={vi.fn()} onFinalize={vi.fn()} />,
      ),
    );

    expect(container.querySelector('h1')?.textContent).toBe('Size Set / Pre-Production Report');
    expect(
      [...container.querySelectorAll('section > div > h2')].map((node) => node.textContent),
    ).toEqual(['Meeting context', 'People and follow-up', 'Approval']);
    expect(container.querySelectorAll('section > div > h2')).toHaveLength(3);

    const context = [...container.querySelectorAll('fieldset')].find(
      (fieldset) => fieldset.querySelector('legend')?.textContent === 'System context',
    )!;
    expect(context.textContent).toContain('Clifton');
    expect(context.textContent).toContain('PO-2026-000001');
    expect(context.querySelector('input, textarea, select')).toBeNull();
    expect(context.querySelector('dl')?.className).toContain('grid-cols-1');

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
    expect(container.textContent).not.toContain('Add follow-up');
    expect(container.textContent).not.toContain('Remove item');
    expect(container.textContent).not.toContain('Save draft');
  });
});
