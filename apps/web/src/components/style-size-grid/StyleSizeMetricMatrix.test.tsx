/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StyleImage } from '../../pages/master-data/types.js';
import { groupSourceLinesByStyle, type StyleSizeSourceLine } from '../../pages/fulfillment/style-size-grouping.js';
import { StyleSizeMetricMatrix, type StyleSizeMetric } from './StyleSizeMetricMatrix.js';

const authedImage = vi.hoisted(() => ({
  state: { url: 'blob:thumb' as string | null, loading: false, error: false },
  requested: [] as string[],
}));
vi.mock('../../lib/use-authed-image.js', () => ({
  useAuthedImage: (path: string) => {
    authedImage.requested.push(path);
    return authedImage.state;
  },
}));
const requested = () => authedImage.requested;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  authedImage.state = { url: 'blob:thumb', loading: false, error: false };
  requested().length = 0;
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const image: StyleImage = {
  id: 'img-1',
  styleId: 'style-a',
  fileId: 'file-1',
  fileName: 'photo.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 1000,
  isPrimary: true,
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
};

interface Line extends StyleSizeSourceLine {
  id: string;
  dispatched: number;
  received: number | null;
  order?: string;
}

function line(overrides: Partial<Line> & Pick<Line, 'id' | 'styleId' | 'sizeId' | 'sizeCode'>): Line {
  return {
    styleNumber: overrides.styleId.toUpperCase(),
    styleName: `${overrides.styleId} name`,
    sizeLabel: overrides.sizeCode,
    sizeSortOrder: undefined,
    primaryImage: null,
    dispatched: 10,
    received: 10,
    ...overrides,
  };
}

const metrics: StyleSizeMetric<Line>[] = [
  { key: 'dispatched', label: 'Dispatched', value: (l) => l.dispatched },
  { key: 'received', label: 'Received', value: (l) => l.received, missingLabel: 'Not recorded' },
  { key: 'short', label: 'Short', value: (l) => (l.received === null ? null : l.dispatched - l.received), tone: (t) => (t > 0 ? 'danger' : undefined), missingLabel: 'Not recorded' },
];

function render(lines: Line[], props: Partial<Parameters<typeof StyleSizeMetricMatrix<Line>>[0]> = {}, contextKey?: (l: Line) => string) {
  const { columns, rows } = groupSourceLinesByStyle(lines, contextKey);
  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <StyleSizeMetricMatrix label="Test matrix" columns={columns} rows={rows} metrics={metrics} {...props} />
      </QueryClientProvider>,
    );
  });
}
const rowCells = (block: Element, label: string) => {
  const row = [...block.querySelectorAll('tr')].find((tr) => tr.querySelector('th')?.textContent === label)!;
  return [...row.children].map((c) => c.textContent);
};
const blocks = () => [...container.querySelectorAll('tbody')];
const headers = () => [...container.querySelectorAll('thead th')].map((th) => th.textContent);

describe('StyleSizeMetricMatrix', () => {
  it('renders one block per Style with different Size sets in canonical order, "—" where a Style has no such Size', () => {
    render([
      line({ id: '1', styleId: 'style-a', sizeId: 'xl', sizeCode: 'XL', sizeSortOrder: 4, dispatched: 4, received: 4 }),
      line({ id: '2', styleId: 'style-a', sizeId: 's', sizeCode: 'S', sizeSortOrder: 1, dispatched: 6, received: 5 }),
      line({ id: '3', styleId: 'style-b', sizeId: 'm', sizeCode: 'M', sizeSortOrder: 2, dispatched: 7, received: 7 }),
    ]);
    expect(headers()).toEqual(['Measure', 'S', 'M', 'XL', 'Total']);
    expect(blocks().slice(0, 2).map((b) => b.querySelector('th')?.textContent)).toEqual(['STYLE-Astyle-a name', 'STYLE-Bstyle-b name']);
    expect(rowCells(blocks()[0]!, 'Dispatched')).toEqual(['Dispatched', '6', '—', '4', '10']);
    expect(rowCells(blocks()[1]!, 'Dispatched')).toEqual(['Dispatched', '—', '7', '—', '7']);
    expect(rowCells(blocks()[0]!, 'Short')).toEqual(['Short', '1', '—', '0', '1']);
  });

  it('shows all-Styles totals as sums over every Style and Size, and omits them for a single Style', () => {
    render([
      line({ id: '1', styleId: 'style-a', sizeId: 's', sizeCode: 'S', sizeSortOrder: 1, dispatched: 6, received: 5 }),
      line({ id: '2', styleId: 'style-b', sizeId: 's', sizeCode: 'S', sizeSortOrder: 1, dispatched: 3, received: 3 }),
    ]);
    const footer = container.querySelector('tfoot')!;
    expect(rowCells(footer, 'Dispatched')).toEqual(['Dispatched', '9', '9']);
    expect(rowCells(footer, 'Received')).toEqual(['Received', '8', '8']);

    render([line({ id: '1', styleId: 'style-a', sizeId: 's', sizeCode: 'S' })]);
    expect(container.querySelector('tfoot')).toBeNull();
    render(
      [line({ id: '1', styleId: 'style-a', sizeId: 's', sizeCode: 'S' }), line({ id: '2', styleId: 'style-b', sizeId: 's', sizeCode: 'S' })],
      { showColumnTotals: false },
    );
    expect(container.querySelector('tfoot')).toBeNull();
  });

  it('keeps the same Style in independent contexts (dispatch / source order) as separate rows', () => {
    render(
      [
        line({ id: '1', styleId: 'style-a', sizeId: 's', sizeCode: 'S', order: 'SO-1', dispatched: 1 }),
        line({ id: '2', styleId: 'style-a', sizeId: 's', sizeCode: 'S', order: 'SO-2', dispatched: 2 }),
      ],
      { context: (row) => <span>{(row.sources[0] as Line).order}</span> },
      (l) => l.order!,
    );
    expect(blocks()).toHaveLength(2);
    expect(blocks().map((b) => b.querySelector('th')?.textContent)).toEqual(['STYLE-Astyle-a nameSO-1', 'STYLE-Astyle-a nameSO-2']);
    expect(rowCells(blocks()[0]!, 'Dispatched').at(-1)).toBe('1');
    expect(rowCells(blocks()[1]!, 'Dispatched').at(-1)).toBe('2');
  });

  it('aggregates only the displayed number for several source lines in one Size, and leaves the sources intact', () => {
    const lines = [
      line({ id: 'a', styleId: 'style-a', sizeId: 's', sizeCode: 'S', dispatched: 6, received: 4 }),
      line({ id: 'b', styleId: 'style-a', sizeId: 's', sizeCode: 'S', dispatched: 4, received: 4 }),
    ];
    const model = groupSourceLinesByStyle(lines);
    expect(model.rows).toHaveLength(1);
    expect(model.rows[0]!.sourcesBySize.s!.map((l) => l.id)).toEqual(['a', 'b']);
    expect(model.rows[0]!.sources).toEqual(lines);
    render(lines, { detail: (row) => <ul>{row.sources.map((l) => <li key={(l as Line).id}>{(l as Line).id}</li>)}</ul> });
    expect(rowCells(blocks()[0]!, 'Dispatched')).toEqual(['Dispatched', '10', '10']);
    expect([...blocks()[0]!.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['a', 'b']);
  });

  it('distinguishes missing evidence from a recorded zero, including in totals', () => {
    render([
      line({ id: '1', styleId: 'style-a', sizeId: 's', sizeCode: 'S', sizeSortOrder: 1, dispatched: 5, received: null }),
      line({ id: '2', styleId: 'style-a', sizeId: 'm', sizeCode: 'M', sizeSortOrder: 2, dispatched: 5, received: 0 }),
    ]);
    expect(rowCells(blocks()[0]!, 'Received')).toEqual(['Received', 'Not recorded', '0', 'Not recorded']);
    expect(rowCells(blocks()[0]!, 'Short')).toEqual(['Short', 'Not recorded', '5', 'Not recorded']);
    const shortCells = [...blocks()[0]!.querySelectorAll('tr')].find((tr) => tr.querySelector('th')?.textContent === 'Short')!.querySelectorAll('span.text-danger');
    expect(shortCells).toHaveLength(1);
  });

  it('delegates editable measures to renderCell per original source line without altering other measures', () => {
    const lines = [
      line({ id: 'a', styleId: 'style-a', sizeId: 's', sizeCode: 'S', dispatched: 6 }),
      line({ id: 'b', styleId: 'style-a', sizeId: 's', sizeCode: 'S', dispatched: 4 }),
    ];
    render(lines, {
      metrics: [
        ...metrics.slice(0, 1),
        { key: 'edit', label: 'Edit', value: () => 0, renderCell: ({ sources }) => <>{sources.map((l) => <input key={l.id} aria-label={`edit-${l.id}`} />)}</> },
      ],
    });
    expect([...container.querySelectorAll('input')].map((i) => i.getAttribute('aria-label'))).toEqual(['edit-a', 'edit-b']);
    expect(rowCells(blocks()[0]!, 'Dispatched')).toEqual(['Dispatched', '10', '10']);
  });

  it('is horizontally scrollable with pinned measure labels', () => {
    render([line({ id: '1', styleId: 'style-a', sizeId: 's', sizeCode: 'S' })]);
    expect(container.firstElementChild!.className).toContain('overflow-x-auto');
    expect(container.querySelector('tbody th[scope="row"]')!.className).toContain('sticky');
  });

  it('shows the empty message when there is nothing to display', () => {
    render([], { emptyMessage: 'Nothing here' });
    expect(container.textContent).toBe('Nothing here');
  });

  describe('Style thumbnail', () => {
    it('uses the real styleId UUID for the authenticated image request when a primary image is present', () => {
      render([line({ id: '1', styleId: 'style-a', sizeId: 's', sizeCode: 'S', styleNumber: 'ST-A', primaryImage: image })]);
      expect(requested()).toEqual(['/styles/style-a/images/img-1/content']);
      expect(container.querySelector('img')!.getAttribute('src')).toBe('blob:thumb');
      expect(container.querySelector('button[aria-label="View style image"]')).not.toBeNull();
    });

    it('shows a visible placeholder and makes no image request when the Style has no primary image', () => {
      render([line({ id: '1', styleId: 'style-a', sizeId: 's', sizeCode: 'S' })]);
      expect(requested()).toEqual([]);
      expect(container.querySelector('img')).toBeNull();
      expect(container.querySelector('tbody svg')).not.toBeNull();
    });

    it('falls back to the placeholder when the image cannot be loaded', () => {
      authedImage.state = { url: null, loading: false, error: true };
      render([line({ id: '1', styleId: 'style-a', sizeId: 's', sizeCode: 'S', primaryImage: image })]);
      expect(container.querySelector('img')).toBeNull();
      expect(container.querySelector('tbody svg')).not.toBeNull();
    });
  });
});
