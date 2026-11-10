import { WorkbookFormulas } from '../formula/sheet-formulas';
import { makeSheet } from '../test-helpers';
import { blankKpi, columnRef, kpiAvailable, parseKpis, sheetOf, starterKpis, stringifyKpis, yearSeries, type ChiliKpi } from './chili-kpis';

const nursery = makeSheet(
  1,
  'Nursery Batches',
  [
    { key: 'c1', name: 'Supply date', type: 'date' },
    { key: 'c2', name: 'Total number', type: 'number' },
    { key: 'c3', name: 'Healthy %', type: 'percentage' },
  ],
  [
    { c1: '2025-03-01', c2: '1000', c3: '80' },
    { c1: '2025-09-01', c2: '500', c3: '90' },
    { c1: '2026-02-01', c2: '2000', c3: '95' },
  ],
  'nursery-batches',
);
const byHand = makeSheet(2, 'My notes', [{ key: 'c1', name: 'Weight', type: 'number' }], [{ c1: '4' }, { c1: '6' }]);
const sheets = [nursery, byHand];
const formulas = new WorkbookFormulas(sheets, '2026-11-08');

const seedlings = (): ChiliKpi => starterKpis().find((kpi) => kpi.title === 'Seedlings')!;

describe('the starter KPIs', () => {
  it('is the system\'s Chili page: thirteen cards, then three charts of the years', () => {
    const list = starterKpis();
    expect(list.filter((kpi) => kpi.show === 'card')).toHaveLength(13);
    expect(list.filter((kpi) => kpi.show !== 'card').map((kpi) => [kpi.title, kpi.show])).toEqual([
      ['Seedlings by year', 'column'],
      ['Healthy % by year', 'line'],
      ['Plants planted by year', 'column'],
    ]);
    expect(new Set(list.map((kpi) => kpi.id)).size).toBe(list.length);
  });

  it('works out each year, and the whole, as the cards always did', () => {
    const found = yearSeries(seedlings(), sheets, formulas)!;
    expect(found.trend).toEqual([{ label: '2025', value: 1500 }, { label: '2026', value: 2000 }]);
    expect(found.whole).toBe(3500);
    const healthy = yearSeries(starterKpis().find((kpi) => kpi.title === 'Healthy %')!, sheets, formulas)!;
    expect(healthy.trend.map((point) => point.value)).toEqual([85, 95]);
  });

  it('leaves out a KPI whose table or column this MAC does not have', () => {
    expect(yearSeries(starterKpis().find((kpi) => kpi.title === 'Harvest (kg)')!, sheets, formulas)).toBeNull();
    expect(yearSeries({ ...seedlings(), column: 'Nope' }, sheets, formulas)).toBeNull();
    expect(kpiAvailable(seedlings(), sheets, formulas)).toBe(true);
    expect(kpiAvailable({ ...seedlings(), table: 'zone-records' }, sheets, formulas)).toBe(false);
  });
});

describe('a KPI of an edited list', () => {
  it('reads a table made by hand by its title, and works out one number without years', () => {
    expect(sheetOf(sheets, 'My notes')).toBe(byHand);
    expect(sheetOf(sheets, 'nursery-batches')).toBe(nursery);
    const kpi: ChiliKpi = { ...blankKpi('k1', byHand), column: 'Weight', aggregate: 'sum' };
    expect(yearSeries(kpi, sheets, formulas)).toEqual({ trend: [], whole: 10 });
  });

  it('keeps the same KPI whichever place it moves to: the charts are not read by position', () => {
    const list = starterKpis();
    const reversed = [...list].reverse();
    const charts = (kpis: ChiliKpi[]) => kpis.filter((kpi) => kpi.show !== 'card').map((kpi) => [kpi.title, kpi.column, kpi.table].join('|')).sort();
    expect(charts(reversed)).toEqual(charts(list));
    const without = list.filter((kpi) => kpi.title !== 'Seedlings');
    expect(without.find((kpi) => kpi.title === 'Seedlings by year')!.column).toBe('Total number');
  });

  it('names a column by its box only where its name is shared', () => {
    const shared = makeSheet(3, 'Two', [
      { key: 'c1', name: 'Date', type: 'date' },
      { key: 'c2', name: 'Date', type: 'date', box: '2 · Later' },
      { key: 'c3', name: 'Count', type: 'number' },
    ]);
    expect(columnRef(shared, shared.columns[0])).toEqual({ column: 'Date', box: '' });
    expect(columnRef(shared, shared.columns[1])).toEqual({ column: 'Date', box: '2 · Later' });
    expect(columnRef(shared, shared.columns[2])).toEqual({ column: 'Count' });
  });
});

describe('the saved list', () => {
  it('is read back as it was saved', () => {
    const list = starterKpis();
    expect(parseKpis(stringifyKpis(list))).toEqual(list);
    const custom: ChiliKpi[] = [{ ...blankKpi('mine', nursery), title: 'Mean "plants" {x}', column: 'Total number', aggregate: 'average', year: 'Supply date', decimals: 2 }];
    expect(parseKpis(stringifyKpis(custom))).toEqual(custom);
  });

  it('shows the starter (null) when nothing is saved or it cannot be read, but keeps a list emptied on purpose', () => {
    expect(parseKpis(null)).toBeNull();
    expect(parseKpis('')).toBeNull();
    expect(parseKpis('{not json')).toBeNull();
    expect(parseKpis('{"kpis":"x"}')).toBeNull();
    expect(parseKpis('{"kpis":[{"title":"bad"}]}')).toBeNull();
    expect(parseKpis('{"kpis":[]}')).toEqual([]);
  });

  it('drops one unreadable KPI, not the rest, and makes duplicate ids unique', () => {
    const good = { ...seedlings(), id: 'a' };
    const text = JSON.stringify({ kpis: [good, { ...good, id: 'a', title: 'Again' }, { ...good, id: 'b', aggregate: 'median' }, { ...good, id: 'c', show: 'pie' }, { ...good, id: 'd', column: '' }, { ...good, id: 'e', decimals: 9 }] });
    const kpis = parseKpis(text)!;
    expect(kpis.map((kpi) => kpi.title)).toEqual(['Seedlings', 'Again']);
    expect(new Set(kpis.map((kpi) => kpi.id)).size).toBe(2);
  });

  it('keeps two KPIs of one title apart', () => {
    const one = { ...seedlings(), id: 'x' }, two = { ...seedlings(), id: 'y' };
    const back = parseKpis(stringifyKpis([one, two]))!;
    expect(back.map((kpi) => kpi.id)).toEqual(['x', 'y']);
  });
});
