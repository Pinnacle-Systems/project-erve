import { beforeAll, describe, expect, it } from 'vitest';
import {
  PDF_PAGE_SIDE_PADDING,
  expectBodyWithinPageBands,
  expectNoStrandedLeadIns,
  expectNoTextBoxOverlap,
  expectWithinPrintableWidth,
  renderAndInspectPdf,
  splitPageChrome,
  type InspectedPdf,
} from '../../../lib/pdf/core/pdfInspection.test-utils.js';
import { StyleDetailDocument } from './StyleDetailDocument.js';
import type { StyleDetailPdfViewModel } from './buildStyleDetailViewModel.js';
import {
  PORTRAIT_PNG_RENDERED,
  STYLE_FIXTURES,
  buildFixtureViewModel,
  makeFactories,
  makeStyle,
  type StyleFixture,
} from './styleDetailPdfFixtures.test-utils.js';

/** A4 portrait in PDF points. */
const A4 = { width: 595.28, height: 841.89 };
const SECTION_TITLES = ['Style Details', 'Valid Sizes', 'Factory Mappings'];
const TABLE_HEADERS = ['Factory', 'Ex-Factory Rate'];
const ELLIPSIS = String.fromCharCode(0x2026);
const EM_DASH = String.fromCharCode(0x2014);

interface Rendered {
  fixture: StyleFixture;
  viewModel: StyleDetailPdfViewModel;
  inspected: InspectedPdf;
  headerText: string;
  /** Body (non-chrome) runs per page. */
  bodyByPage: ReturnType<typeof splitPageChrome>['body'][];
}

const rendered = new Map<string, Rendered>();

async function renderFixture(fixture: StyleFixture): Promise<Rendered> {
  const viewModel = buildFixtureViewModel(fixture);
  const inspected = await renderAndInspectPdf(<StyleDetailDocument viewModel={viewModel} />);
  const headerText = `${viewModel.title} ${viewModel.subtitle}`;
  const bodyByPage = inspected.runsByPage.map((runs) => splitPageChrome(runs, headerText).body);
  return { fixture, viewModel, inspected, headerText, bodyByPage };
}

const bodyRuns = (r: Rendered) => r.bodyByPage.flat().map((run) => run.str.trim());
const countRuns = (r: Rendered, text: string) => bodyRuns(r).filter((run) => run === text).length;
const squash = (text: string) => text.replace(/\s+/g, '');
/**
 * All body text with every whitespace removed. pdfjs reports text in paint order, which interleaves the lines of
 * side-by-side grid items, so each of the three grid columns is read top-to-bottom, page by page, on its own.
 */
const GRID_COLUMN_EDGES = [205, 383];
function columnTexts(r: Rendered): string[] {
  const columns: string[][] = [[], [], []];
  r.bodyByPage.forEach((body) => {
    [...body]
      .sort((a, b) => b.y - a.y || a.x - b.x)
      .forEach((run) => {
        const column = run.x < GRID_COLUMN_EDGES[0]! ? 0 : run.x < GRID_COLUMN_EDGES[1]! ? 1 : 2;
        columns[column]!.push(run.str.trim());
      });
  });
  return columns.map((column) => squash(column.join('')));
}
const bodyContains = (r: Rendered, text: string) => columnTexts(r).some((column) => column.includes(squash(text)));

beforeAll(async () => {
  for (const fixture of STYLE_FIXTURES) rendered.set(fixture.id, await renderFixture(fixture));
}, 120_000);

const get = (id: string) => rendered.get(id)!;

describe('StyleDetailDocument pagination and layout', () => {
  describe.each(STYLE_FIXTURES.map((fixture) => [fixture.id, fixture.label] as const))('%s: %s', (id) => {
    it('keeps every page A4 portrait', () => {
      for (const size of get(id).inspected.pageSizes) {
        expect(size.width).toBeCloseTo(A4.width, 0);
        expect(size.height).toBeCloseTo(A4.height, 0);
      }
    });

    it('never overlaps text and stays inside the printable area', () => {
      const { inspected, headerText } = get(id);
      expectNoTextBoxOverlap(inspected);
      expectBodyWithinPageBands(inspected, headerText);
      expectWithinPrintableWidth(inspected);
    });

    it('does not strand a heading, field label or table header at the foot of a page', () => {
      const { inspected, headerText, viewModel } = get(id);
      expectNoStrandedLeadIns(inspected, headerText, [
        ...SECTION_TITLES,
        ...TABLE_HEADERS,
        ...viewModel.identityItems.map((item) => item.label),
      ]);
    });

    it('renders every Size, Factory row, section and identity value exactly once', () => {
      const r = get(id);
      const { viewModel } = r;
      for (const title of SECTION_TITLES) {
        const expected = title === 'Factory Mappings' && viewModel.factoryRows.length === 0 ? 0 : 1;
        expect(countRuns(r, title), `section "${title}"`).toBe(expected);
      }
      for (const label of viewModel.sizeLabels) expect(countRuns(r, label), `size ${label}`).toBe(1);
      for (const row of viewModel.factoryRows) {
        expect(countRuns(r, row.name), `factory ${row.name}`).toBe(1);
        expect(countRuns(r, row.exFactoryPrice), `rate ${row.exFactoryPrice}`).toBe(1);
      }
      for (const item of viewModel.identityItems) {
        expect(countRuns(r, item.label), `label ${item.label}`).toBe(1);
        if (item.value !== null && item.value !== undefined && String(item.value).trim() !== '') {
          expect(bodyContains(r, String(item.value)), `value of ${item.label}`).toBe(true);
        }
      }
      expect(bodyContains(r, viewModel.seasonLabel)).toBe(true);
    });

    it('draws the header and "Page N of M" footer on every page', () => {
      const { inspected, headerText } = get(id);
      inspected.runsByPage.forEach((runs, index) => {
        const { header, footer } = splitPageChrome(runs, headerText);
        expect(header[0]?.str).toBe('STYLE MASTER');
        expect(footer.map((run) => run.str)).toEqual([`Page ${index + 1} of ${inspected.numPages}`]);
      });
    });

    it('keeps the header subtitle to two lines while the full Style name stays in the body', () => {
      const r = get(id);
      r.inspected.runsByPage.forEach((runs) => {
        const { header } = splitPageChrome(runs, r.headerText);
        const subtitleLines = header.filter((run) => run.str !== 'STYLE MASTER');
        expect(subtitleLines.length).toBeLessThanOrEqual(2);
      });
      expect(bodyContains(r, r.fixture.style.styleName)).toBe(true);
    });
  });

  describe('regression: an unbreakable section taller than a page collapsed the whole layout', () => {
    it('Factory Mappings with 90 rows flows over several pages with the table header repeated', () => {
      const r = get('many-factories');
      expect(r.inspected.numPages).toBeGreaterThanOrEqual(3);
      // Sections stay in order, each below the previous one (they used to be stacked at one Y).
      const first = r.bodyByPage[0]!;
      const y = (text: string) => first.find((run) => run.str.trim() === text)!.y;
      expect(y('Style Details')).toBeGreaterThan(y('Valid Sizes'));
      expect(y('Valid Sizes')).toBeGreaterThan(y('Factory Mappings'));
      // Every page carrying factory rows carries the repeated column header above them.
      r.bodyByPage.forEach((body, index) => {
        const hasRows = body.some((run) => /^Factory \d{3} Apparels/.test(run.str));
        if (hasRows) {
          expect(
            body.some((run) => run.str.trim() === 'Ex-Factory Rate'),
            `page ${index + 1}`,
          ).toBe(true);
        }
      });
    });

    it('a table only slightly taller than a page flows to a second page instead of squashing the first', () => {
      const r = get('factories-just-over-a-page');
      expect(r.inspected.numPages).toBe(2);
    });

    it('a multi-page description is split across pages without losing any of it', () => {
      const r = get('extreme-text');
      expect(r.inspected.numPages).toBeGreaterThanOrEqual(3);
      expect(bodyContains(r, r.fixture.style.description!)).toBe(true);
    });

    it('the worst case spans several pages and keeps all 120 Factory rows', () => {
      const r = get('worst-case');
      expect(r.inspected.numPages).toBeGreaterThanOrEqual(4);
      expect(r.viewModel.factoryRows).toHaveLength(120);
    });

    it('a 200-row Factory table lays out through the real view-model builder', async () => {
      const viewModel = buildFixtureViewModel({
        id: 'x',
        label: 'x',
        style: makeStyle({ factories: makeFactories(200) }),
      });
      const inspected = await renderAndInspectPdf(<StyleDetailDocument viewModel={viewModel} />);
      expectNoTextBoxOverlap(inspected);
      expectBodyWithinPageBands(inspected, `${viewModel.title} ${viewModel.subtitle}`);
      expect(inspected.numPages).toBeGreaterThanOrEqual(5);
    }, 60_000);
  });

  describe('Sizes and short documents', () => {
    it('renders the complete native Size set, one chip each, on a single page', () => {
      const r = get('native-sizes');
      expect(r.inspected.numPages).toBe(1);
      expect(r.viewModel.sizeLabels).toHaveLength(15);
    });

    it('keeps normal Styles to a single page', () => {
      expect(get('normal').inspected.numPages).toBe(1);
      expect(get('few-factories').inspected.numPages).toBe(1);
      expect(get('optional-missing').inspected.numPages).toBe(1);
    });

    it('shows an em dash for missing optional values and an empty Size list', () => {
      const r = get('optional-missing');
      expect(bodyRuns(r).filter((run) => run === EM_DASH).length).toBeGreaterThanOrEqual(8);
      expect(countRuns(r, 'Factory Mappings')).toBe(0);
    });
  });

  describe('Style image', () => {
    const thumbnails = (r: Rendered) =>
      r.inspected.imagesByPage.flatMap((images, page) =>
        images
          .filter((image) => image.y < r.inspected.pageSizes[page]!.height - 72)
          .map((image) => ({ ...image, page })),
      );

    it('draws the image once, on page 1, in its 120pt box without distortion', () => {
      for (const id of ['normal-image', 'worst-case']) {
        const images = thumbnails(get(id));
        expect(images, id).toHaveLength(1);
        const image = images[0]!;
        expect(image.page).toBe(0);
        expect(image.width).toBeCloseTo(PORTRAIT_PNG_RENDERED.width, 0);
        expect(image.height).toBeCloseTo(PORTRAIT_PNG_RENDERED.height, 0);
        expect(image.x).toBeGreaterThanOrEqual(PDF_PAGE_SIDE_PADDING - 1);
      }
    });

    it('does not paint the image over any text', () => {
      for (const id of ['normal-image', 'worst-case']) {
        const r = get(id);
        const image = thumbnails(r)[0]!;
        for (const run of r.bodyByPage[0]!) {
          const overlapsX = run.x < image.x + image.width && run.x + run.width > image.x;
          const overlapsY = run.y < image.y + image.height && run.y + run.height > image.y;
          expect(overlapsX && overlapsY, `"${run.str}" under the image`).toBe(false);
        }
      }
    });

    it('draws no image for a Style without one', () => {
      expect(thumbnails(get('normal'))).toHaveLength(0);
    });
  });

  it('ellipsises a header subtitle that would need more than two lines', () => {
    const r = get('extreme-text');
    const header = splitPageChrome(r.inspected.runsByPage[0]!, r.headerText).header;
    expect(header.at(-1)!.str.endsWith(ELLIPSIS)).toBe(true);
  });
});
