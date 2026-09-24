import { describe, expect, it } from 'vitest';
import { extractHsnCode } from './po-pdf-parser.js';
import { parseHsnSourceLine, resolveHsnSourceDescription, type HsnDescriptionSourceInput } from './hsn-description.js';

// Line shapes below are verbatim from the 91-document audit
// (.artifacts/historical-import/AW25-SS26/h2b-hsn-description-audit/).
describe('parseHsnSourceLine', () => {
  it.each([
    ['*HS 61091000 Boys / T-Shirt', '61091000', 'Boys / T-Shirt'],
    ['*HS61034200 Boys / Sweat Pant', '61034200', 'Boys / Sweat Pant'],
    ['*HS - 61046200 Girls / Pant', '61046200', 'Girls / Pant'],
    ['*HS - 61046200', '61046200', null],
    ['*HS 61091000', '61091000', null],
    // EI25013: no separator between the code and the label still splits deterministically.
    ['*HS 61061000Boys / Sweat Shirt', '61061000', 'Boys / Sweat Shirt'],
  ])('%s -> code %s, description %s', (line, code, description) => {
    expect(parseHsnSourceLine(line)).toMatchObject({ hsnCode: code, candidateDescription: description });
  });

  it('keeps the label exactly as printed apart from surrounding whitespace', () => {
    expect(parseHsnSourceLine('*HS 61061000 Girls/ Hoody  ')!.candidateDescription).toBe('Girls/ Hoody');
    expect(parseHsnSourceLine('*HS 61034200 Boys/ cotton SweatPant')!.candidateDescription).toBe('Boys/ cotton SweatPant');
  });

  it('never moves digits between the code and the label, and agrees with extractHsnCode', () => {
    for (const line of ['*HS 61091000 Boys / T-Shirt', '*HS61034200 Boys / Sweat Pant', '*HS - 61046200', '*HS 61061000Boys / Sweat Shirt']) {
      expect(parseHsnSourceLine(line)!.hsnCode).toBe(extractHsnCode([{ y: 0, items: [], text: line }]).value);
    }
    expect(parseHsnSourceLine('*HS 610910001 Boys')).toBeNull(); // 9 digits is not a valid boundary
    expect(parseHsnSourceLine('*ST1: Boys T-Shirt')).toBeNull();
  });
});

function input(overrides: Partial<HsnDescriptionSourceInput> & { hsLine?: string; st1?: string }): HsnDescriptionSourceInput {
  const { hsLine = '*HS 61091000 Boys / T-Shirt', st1 = '*ST1: Boys Short Sleeve T-Shirt - Jurrasic World', ...rest } = overrides;
  return {
    specificationText: `${st1}\n${hsLine}`,
    tableDescription: 'SandShell Boys Short Sleeve T Shirt',
    tableStyleName: "Boy's T- Shirt",
    expectedHsnCode: parseHsnSourceLine(hsLine)?.hsnCode ?? null,
    ...rest,
  };
}

describe('resolveHsnSourceDescription (Policy C)', () => {
  it('populates a code + label consistent with the table and *ST1', () => {
    const result = resolveHsnSourceDescription(input({}));
    expect(result).toMatchObject({
      classification: 'HSN_WITH_SOURCE_DESCRIPTION',
      semanticCheck: 'PASS',
      parsedHsnCode: '61091000',
      proposedHsnDescription: 'Boys / T-Shirt',
      hsnCodeSourceSuspect: false,
    });
  });

  it('leaves a code-only line null', () => {
    const result = resolveHsnSourceDescription(input({
      hsLine: '*HS - 61046200',
      st1: '*ST1: Girls High Waist Shorts - BARBIE',
      tableDescription: 'Girls High Waist Shorts',
      tableStyleName: 'Barbie Girls Shorts',
    }));
    expect(result).toMatchObject({ classification: 'HSN_CODE_ONLY', proposedHsnDescription: null, parsedHsnCode: '61046200' });
  });

  it('EI25013 shape: a label naming the other gender is review-required and null', () => {
    const result = resolveHsnSourceDescription(input({
      hsLine: '*HS 61061000Boys / Sweat Shirt',
      st1: '*ST1: Girls Sweat Shirt - Paw Patrol',
      tableDescription: 'Prism Pink Girls Sweat Shirt',
      tableStyleName: "Girl's Sweat Shirt",
    }));
    expect(result).toMatchObject({
      classification: 'REVIEW_REQUIRED',
      semanticCheck: 'GENDER_CONFLICT',
      candidateHsnDescription: 'Boys / Sweat Shirt',
      proposedHsnDescription: null,
      hsnCodeSourceSuspect: false,
    });
  });

  it('EI25011 shape: *ST1 contradicting the table makes the stanza (and its code) source-suspect', () => {
    const result = resolveHsnSourceDescription(input({
      hsLine: '*HS61034200 Boys / Sweat Pant',
      st1: "*ST1: Boys's Sweat Pant - Hot Wheels",
      tableDescription: 'Black Girls Crop Hoody',
      tableStyleName: 'Girls Crop Hoody',
    }));
    expect(result).toMatchObject({
      classification: 'REVIEW_REQUIRED',
      semanticCheck: 'SOURCE_BLOCK_CONFLICT',
      proposedHsnDescription: null,
      parsedHsnCode: '61034200',
      hsnCodeSourceSuspect: true,
    });
  });

  it('flags a product-identity contradiction between the label and the table', () => {
    const result = resolveHsnSourceDescription(input({ hsLine: '*HS 61091000 Boys / Sweat Pant' }));
    expect(result).toMatchObject({ classification: 'REVIEW_REQUIRED', semanticCheck: 'PRODUCT_CONFLICT', proposedHsnDescription: null });
  });

  it.each([
    ['disclaimer spillover', '*HS 61091000 Boys / T-Shirt *For detailed Trims and Accessories please refer Bill of Material'],
    ['another *ST marker', '*HS 61091000 Boys / T-Shirt ST2: Girls'],
    ['punctuation-only', '*HS 61091000 / -'],
    ['numeric-only', '*HS 61091000 - 12'],
  ])('rejects %s', (_label, hsLine) => {
    const result = resolveHsnSourceDescription(input({ hsLine }));
    expect(result).toMatchObject({ classification: 'REVIEW_REQUIRED', semanticCheck: 'SPILLOVER', proposedHsnDescription: null });
  });

  it('does not trust the label when its code disagrees with the hsnCode being persisted', () => {
    const result = resolveHsnSourceDescription(input({ expectedHsnCode: '61046200' }));
    expect(result).toMatchObject({ classification: 'REVIEW_REQUIRED', semanticCheck: 'HSN_CODE_MISMATCH', proposedHsnDescription: null });
  });

  it('reports no HS line, several HS lines, and an unparseable HS line without proposing a value', () => {
    expect(resolveHsnSourceDescription(input({ specificationText: '*ST1: Boys T-Shirt' }))).toMatchObject({ classification: 'NO_HS_LINE', proposedHsnDescription: null });
    expect(resolveHsnSourceDescription(input({ specificationText: '*HS 61091000 Boys / T-Shirt\n*HS 61091000 Boys / T-Shirt' }))).toMatchObject({ classification: 'REVIEW_REQUIRED', proposedHsnDescription: null });
    expect(resolveHsnSourceDescription(input({ specificationText: '*HS - Boys / T-Shirt' }))).toMatchObject({ classification: 'PARSE_ERROR', proposedHsnDescription: null });
  });
});
