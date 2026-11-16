import { evaluateFormula, type FormulaScalar } from './evaluate-formula';
import { formatPattern } from './number-format';
import { parseFormula } from './parse-formula';

function run(formula: string, row: Record<string, FormulaScalar> = {}, tables: Record<string, FormulaScalar[]> = {}) {
  return evaluateFormula(parseFormula(formula), {
    column: (name) => row[name] ?? null,
    tableColumn: (table, name) => tables[`${table}.${name}`] ?? [],
    today: '2026-11-10',
  });
}

describe('the functions the QA/QC analysis uses', () => {
  it('IFS gives the first condition that holds, TRUE the rest, and #N/A when none does', () => {
    expect(run('=IFS(1=2,"a",2=2,"b",TRUE,"c")')).toBe('b');
    expect(run('=IFS(1=2,"a",2=3,"b",TRUE,"c")')).toBe('c');
    expect(run('=IFS(1=2,"a")')).toMatchObject({ code: '#N/A' });
    // Only the winning value is worked out.
    expect(run('=IFS(TRUE,"ok",TRUE,1/0)')).toBe('ok');
  });

  it('N makes a number of a number, a Yes, or nothing', () => {
    expect(run('=N([x])', { x: 4 })).toBe(4);
    expect(run('=N([x])', { x: null })).toBe(0);
    expect(run('=N([x])', { x: 'text' })).toBe(0);
    expect(run('=N(TRUE)')).toBe(1);
  });

  it('TEXT writes a number in its format', () => {
    expect(run('=TEXT(0.9,"0%")')).toBe('90%');
    expect(run('=TEXT(0.9444,"0.0%")')).toBe('94.4%');
    expect(run('=TEXT(1.005,"0.00")')).toBe('1.01');
    expect(run('=TEXT(18,"0.00")')).toBe('18.00');
    expect(run('=TEXT([x],"0.00")', { x: '3.5' })).toBe('3.50');
    expect(run('=TEXT("A","0.00")')).toBe('A');
  });

  it('AVERAGEIFS averages the rows that match every pair, and is #DIV/0! with none', () => {
    const tables = { 'T.Value': [10, 20, 30, 40], 'T.Batch': ['B1', 'B1', 'B2', 'B1'], 'T.Kind': ['a', 'b', 'a', 'a'] };
    expect(run("=AVERAGEIFS('T'[Value],'T'[Batch],\"B1\")", {}, tables)).toBe(70 / 3);
    expect(run("=AVERAGEIFS('T'[Value],'T'[Batch],\"B1\",'T'[Kind],\"a\")", {}, tables)).toBe(25);
    expect(run("=AVERAGEIFS('T'[Value],'T'[Batch],\"B9\")", {}, tables)).toMatchObject({ code: '#DIV/0!' });
    expect(run("=IFERROR(AVERAGEIFS('T'[Value],'T'[Batch],\"B9\"),\"\")", {}, tables)).toBe('');
  });

  it('dates taken from each other are the days between, as the harvest timing needs', () => {
    expect(run('=[harvest]-[planting]', { harvest: '2026-07-24', planting: '2026-05-10' })).toBe(75);
  });
});

describe('number formats', () => {
  it('writes the patterns the analysis shows', () => {
    expect(formatPattern(0.9, '0%')).toBe('90%');
    expect(formatPattern(18.9, '0.00')).toBe('18.90');
    expect(formatPattern(75, '0" DAT"')).toBe('75 DAT');
    expect(formatPattern(0.1, '+0%;-0%;0%')).toBe('+10%');
    expect(formatPattern(-0.2, '+0%;-0%;0%')).toBe('-20%');
    expect(formatPattern(0, '+0%;-0%;0%')).toBe('0%');
    expect(formatPattern(-2.5, '0.0')).toBe('-2.5');
  });
});
