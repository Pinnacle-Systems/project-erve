import { describe, expect, it } from 'vitest';
import { buildQualitySections } from './qualityResponseBlocks.js';
import {
  makePpmQualityExecutionView,
  makeQualityExecutionView,
} from '../execution/qualityExecutionTestFixture.js';

describe('buildQualitySections', () => {
  it('excludes INSPECTION_OUTCOME from the generic section list (outcome is printed separately)', () => {
    const sections = buildQualitySections(makeQualityExecutionView(), new Map());
    const componentHeadings = sections.flatMap((section) => section.blocks.map((block) => block.heading));
    expect(componentHeadings).not.toContain('Inspection Outcome');
  });

  it('renders every configured component type as a block, one per component', () => {
    const sections = buildQualitySections(makeQualityExecutionView(), new Map());
    const blocks = sections.flatMap((section) => section.blocks);
    // 15 components configured in the fixture minus the excluded INSPECTION_OUTCOME
    expect(blocks).toHaveLength(14);
  });

  it('builds a SYSTEM_CONTEXT grid using the configured field label', () => {
    const sections = buildQualitySections(makeQualityExecutionView(), new Map());
    const block = sections[0]!.blocks.find((b) => b.heading === 'System Context');
    expect(block).toMatchObject({
      kind: 'grid',
      items: [{ label: 'Job Order Number', value: 'JO-1001' }],
    });
  });

  it('formats a FIELD_GROUP DATE response and a BOOLEAN response for display', () => {
    const sections = buildQualitySections(makeQualityExecutionView(), new Map());
    const block = sections[1]!.blocks.find((b) => b.heading === 'Details');
    expect(block?.kind).toBe('grid');
    if (block?.kind !== 'grid') throw new Error('expected grid block');
    expect(block.items).toEqual([
      { label: 'Meeting Date', value: '15 Jan 2026' },
      { label: 'Ready', value: 'Yes' },
    ]);
  });

  it('builds a CHECKLIST block with response and remarks', () => {
    const sections = buildQualitySections(makeQualityExecutionView(), new Map());
    const block = sections[1]!.blocks.find((b) => b.heading === 'Checklist');
    expect(block).toMatchObject({
      kind: 'checklist',
      rows: [{ label: 'Trims card confirmed', result: 'YES', remarks: 'Checked' }],
    });
  });

  it('builds an ACTION_LIST table with one row per action, columns from config', () => {
    const sections = buildQualitySections(makeQualityExecutionView(), new Map());
    const block = sections[1]!.blocks.find((b) => b.heading === 'Follow-up Actions');
    expect(block?.kind).toBe('table');
    if (block?.kind !== 'table') throw new Error('expected table block');
    expect(block.rows).toEqual([{ action: 'Fix seam', dueDate: '01 Feb 2026' }]);
  });

  it('renders an empty ACTION_LIST as an empty-state table with no rows', () => {
    const view = makeQualityExecutionView({
      responses: { ...makeQualityExecutionView().responses, actions: [] },
    });
    const sections = buildQualitySections(view, new Map());
    const block = sections[1]!.blocks.find((b) => b.heading === 'Follow-up Actions');
    expect(block).toMatchObject({ kind: 'table', rows: [], emptyText: 'No follow-up actions added.' });
  });

  it('marks an ATTACHMENTS requirement required and captures evidence metadata', () => {
    const sections = buildQualitySections(makeQualityExecutionView(), new Map());
    const block = sections[1]!.blocks.find((b) => b.heading === 'Evidence');
    expect(block?.kind).toBe('attachments');
    if (block?.kind !== 'attachments') throw new Error('expected attachments block');
    expect(block.requirements).toEqual([
      {
        label: 'Defect Photo',
        required: true,
        items: [
          {
            id: 'attachment-1',
            fileName: 'defect.jpg',
            contentType: 'image/jpeg',
            sizeBytes: 12345,
            isImage: true,
            image: { placeholder: true },
          },
        ],
      },
    ]);
  });

  it('classifies a non-image attachment as metadata-only (no image field populated)', () => {
    const view = makeQualityExecutionView({
      attachments: [
        {
          id: 'attachment-2',
          componentId: 'attachments-1',
          requirementKey: 'photo',
          fileName: 'measurements.pdf',
          contentType: 'application/pdf',
          sizeBytes: 4096,
          createdAt: '2026-01-10T10:30:00Z',
        },
      ],
    });
    const sections = buildQualitySections(view, new Map());
    const block = sections[1]!.blocks.find((b) => b.heading === 'Evidence');
    if (block?.kind !== 'attachments') throw new Error('expected attachments block');
    expect(block.requirements[0]!.items[0]).toEqual({
      id: 'attachment-2',
      fileName: 'measurements.pdf',
      contentType: 'application/pdf',
      sizeBytes: 4096,
      isImage: false,
      image: null,
    });
  });

  it('resolves an image attachment from the pre-resolved evidence map, not the network', () => {
    const images = new Map([['attachment-1', { dataUri: 'data:image/jpeg;base64,mock' }]]);
    const sections = buildQualitySections(makeQualityExecutionView(), images);
    const block = sections[1]!.blocks.find((b) => b.heading === 'Evidence');
    if (block?.kind !== 'attachments') throw new Error('expected attachments block');
    expect(block.requirements[0]!.items[0]!.image).toEqual({ dataUri: 'data:image/jpeg;base64,mock' });
  });

  it('PPM (no INSPECTION_OUTCOME component in its form) never produces an outcome-shaped block', () => {
    const sections = buildQualitySections(makePpmQualityExecutionView(), new Map());
    const headings = sections.flatMap((section) => section.blocks.map((block) => block.heading));
    expect(headings).not.toContain('Inspection Outcome');
    const serialized = JSON.stringify(sections);
    expect(serialized).not.toMatch(/"PASS"|"FAIL"/);
  });

  it('prints zero as 0 and null as an em dash for AQL results, never converting one into the other', () => {
    const view = makeQualityExecutionView({
      responses: {
        ...makeQualityExecutionView().responses,
        aqlResults: [{ componentId: 'aql-1', severity: 'MAJOR', maxAllowed: 0, found: null }],
      },
    });
    const sections = buildQualitySections(view, new Map());
    const block = sections[1]!.blocks.find((b) => b.heading === 'AQL Results');
    if (block?.kind !== 'table') throw new Error('expected table block');
    expect(block.rows[0]).toMatchObject({ maxAllowed: '0', found: '—' });
  });
});
