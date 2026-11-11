import type { Cells, Column, Row, SheetWithRows } from '../core/models';
import { ACTION_WIDTH, actionFormula, CHECKS, STAGES, STATUS_WIDTH, type Check, type Field } from './analysis-checks';

/**
 * The QA/QC Analysis over a QA/QC table, as the web system's Analysis tab is: a row for each zone plot (its latest
 * record), and for each stage the checks against the growth standard, each a formula. Nothing of it is saved or put
 * in the QA/QC table: it is built in memory over a copy of the table's records (so a baseline can average every record
 * of a batch) and worked out by the app's own formula engine, again whenever a record changes.
 *
 * The web's formulas read the old table's columns (a plant average, Harvested, Plant batch). The farm's sheet, which
 * the table now follows, has each plant's own reading instead, so those are worked out here from the sheet's columns:
 * a plant average is the average of the 20 plants, the yield per plant the sum of the harvest rounds, the pest and
 * disease totals the sum of the weeks, and the plant batch the one Plant Progress gives the plot.
 */

/** The title the working copy goes by (no table of a person's is called this), what a baseline's whole-column formulas name. */
export const ANALYSIS_TITLE = 'QA/QC Analysis (working)';
const ANALYSIS_ID = -1;
/** The box the working columns (averages, sums) sit in, so a formula can name them. */
const WORKING = 'Working';

/** What the analysis shows in a column. */
export interface AnalysisColumn {
  column: Column;
  /** The header's three rows: the stage, the check (with its target), the column's own name. */
  stage: string;
  check: string;
  /** The check's own name and its target, apart ("Fruit Length (Standard)" and "6.5–7.8 cm"). */
  label?: string;
  target?: string;
  header: string;
  /** How a number in it is written ("0%", "0.00"); none: as it comes. */
  format?: string;
  width: number;
  /** The kind of cell: the Status's word becomes a pill. */
  kind: 'identity' | 'date' | 'value' | 'status' | 'result' | 'action';
  /** The formula as the 4th row writes it: the columns by their names. */
  formulaText: string;
}

export interface Analysis {
  /** The working copy: the table's columns and every record, then the working columns and the analysis's own. */
  sheet: SheetWithRows;
  /** What is shown: each plot's latest record. */
  rows: Row[];
  columns: AnalysisColumn[];
  /** Checks left out because the table has no column for what they read. */
  skipped: string[];
}

/** Where a plot's nursery batch is found (the Plant Progress table's), for the baselines. */
export interface BatchSource {
  table: string;
  batch: string;
  plot: string;
}

const clean = (text: string | undefined | null) => (text ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const SEPARATOR = ' › ';

/** The plant averages: the web's "Plant average" measure of a stage, and the group of the 20 plants it is now. */
const AVERAGES: Record<string, string> = {
  '3|Vigor score (1–5)': 'Plant Vigor Score (1–5)',
  '3|Plant height': 'Plant Height (cm)',
  '3|Canopy A, widest': 'Canopy Diameter A (cm) – widest direction',
  '3|Canopy B, across': 'Canopy Diameter B (cm) – perpendicular direction',
  '3|Branches': 'Branching (No. branches/plant)',
  '4|Flowers per plant': 'Plant Flowering – Flowers per Plant (No.)',
  '5|Young fruits per plant': 'Young/Developing Fruits (No. fruits/plant)',
  '6|Fruit length': 'Fruit Length (cm)',
  '6|Fruit diameter': 'Fruit Diameter (cm)',
};
const FLOWERING_GROUP = 'Plant Flowering – Flowers per Plant (No.)';

/** How a working column is made: its name, and its formula over the table's own columns. */
interface Working {
  name: string;
  formula: string;
}

export function buildAnalysis(records: SheetWithRows, batchSource: BatchSource | null): Analysis {
  const sourceColumns = records.columns;
  const working: Working[] = [];
  const workingKey = new Map<string, string>();

  const inStage = (stage: number) => sourceColumns.filter((column) => (column.box ?? '').startsWith(`${stage} ·`));
  const pathOf = (column: Column) => [column.box, column.group, column.name].filter(Boolean).join(SEPARATOR);
  const numbersOf = (stage: number, group: string) => inStage(stage).filter((column) => clean(column.group) === clean(group) && column.type === 'number');

  /** A working column (made once), by its name: the name a formula reads it by. */
  const addWorking = (name: string, formula: string) => {
    if (!workingKey.has(name)) {
      workingKey.set(name, name);
      working.push({ name, formula });
    }
    return `${WORKING}${SEPARATOR}${name}`;
  };
  const list = (columns: Column[]) => columns.map((column) => `[${pathOf(column)}]`).join(',');

  /** The name (path) a field is read by, or null when the table has no column for it. */
  const resolve = (field: Field): string | null => {
    if (field.box === null) {
      const found = sourceColumns.find((column) => !column.box && column.name === field.name);
      return found ? pathOf(found) : null;
    }
    if (field.box === 'record') {
      // The sheet's Block is the row's Zone; the plant batch is Plant Progress's for the plot.
      if (field.name === 'Block') return resolve({ box: null, name: 'Zone' });
      if (!batchSource) return null;
      const zone = resolve({ box: null, name: 'Zone' });
      if (!zone) return null;
      const quoted = (text: string) => text.replaceAll("'", "''");
      return addWorking(
        'Plant batch',
        `=IF([${zone}]="","",LOOKUP('${quoted(batchSource.table)}'[${batchSource.batch}],'${quoted(batchSource.table)}'[${batchSource.plot}],[${zone}],""))`,
      );
    }
    const stage = field.box;
    const group = field.group ?? '';
    if (group === 'Plant average') {
      const plants = AVERAGES[`${stage}|${field.name}`];
      if (plants) {
        const columns = numbersOf(stage, plants);
        if (!columns.length) return null;
        return addWorking(`${plants} (average of the plants)`, `=IFERROR(AVERAGE(${list(columns)}),"")`);
      }
      if (stage === 4 && field.name === 'Plant flowering') {
        // The share of the measured plants that have flowers: the sheet counts flowers, not plants.
        const columns = numbersOf(4, FLOWERING_GROUP);
        if (!columns.length) return null;
        const counted = list(columns);
        const flowering = columns.map((column) => `IF(N([${pathOf(column)}])>0,1,0)`).join('+');
        return addWorking('Plants with flowers (share of the plants measured)', `=IF(COUNT(${counted})=0,"",(${flowering})/COUNT(${counted}))`);
      }
      return null;
    }
    if (group === 'Cumulative Yield' && ['Harvested', 'Harvest rounds', 'Yield per plant'].includes(field.name)) {
      // The sheet keeps each round's kilos a plant (1st Harvest … 5th Harvest): their sum is the yield a plant, their count the rounds.
      const rounds = inStage(stage).filter((column) => clean(column.group) === 'cumulative yield' && column.type === 'number' && /^\d+(st|nd|rd|th) harvest$/i.test(column.name.trim()));
      if (!rounds.length) return null;
      const sum = `SUM(${list(rounds)})`;
      const counted = `COUNT(${list(rounds)})`;
      if (field.name === 'Harvest rounds') return addWorking(`Stage ${stage} harvest rounds`, `=IF(${counted}=0,"",${counted})`);
      if (field.name === 'Yield per plant') return addWorking(`Stage ${stage} yield per plant (kg)`, `=IF(${counted}=0,"",${sum})`);
      const plants = sourceColumns.find((column) => (column.box ?? '').startsWith(`${stage} ·`) && column.name === 'Total plant');
      if (!plants) return null;
      return addWorking(`Stage ${stage} harvested (kg)`, `=IF(OR(${counted}=0,N([${pathOf(plants)}])<=0),"",${sum}*[${pathOf(plants)}])`);
    }
    if (group === 'Pest / Disease per block (No.)') {
      // The weeks W1–W10 (0–70 DAT) and W1–W21 (0–150 DAT) as one total each.
      const weeks = inStage(stage).filter((column) => /^W\d+$/.test(column.name.trim()) && column.type === 'number');
      const to = field.name === '0–70 DAT' ? 10 : field.name === '0–150 DAT' ? 21 : 0;
      const wanted = weeks.filter((column) => Number(column.name.trim().slice(1)) <= to);
      if (!wanted.length) return null;
      return addWorking(`Pest and disease, weeks 1–${to}`, `=IF(COUNT(${list(wanted)})=0,"",SUM(${list(wanted)}))`);
    }
    // The stage's observation date: its first column (the sheet's "30 DAT Vegetative").
    if (field.name === 'Date' && !group) {
      const found = inStage(stage).find((column) => !column.group && column.type === 'date');
      return found ? pathOf(found) : null;
    }
    const found = inStage(stage).find((column) => clean(column.name) === clean(field.name) && (group ? clean(column.group) === clean(group) : !column.group));
    return found ? pathOf(found) : null;
  };

  // ---------------------------------------------------------------- the analysis's columns
  const shown: AnalysisColumn[] = [];
  const columns: Column[] = [];
  const skipped: string[] = [];
  let next = 0;
  const analysisColumn = (header: string, stage: string, check: string, formula: string): Column => {
    const column: Column = { key: `a${(next += 1)}`, name: header, type: 'formula', formula, box: stage, group: check, required: false };
    columns.push(column);
    return column;
  };

  // The plot's identity: its batch, its zone and its planting date.
  const batchPath = resolve(SHARED_BATCH);
  const zonePath = resolve({ box: null, name: 'Zone' });
  const datePath = resolve({ box: null, name: 'Date' });
  const identity = (label: string, name: string | null, width: number, kind: 'identity' | 'date') => {
    if (!name) return;
    const column = name.startsWith(`${WORKING}${SEPARATOR}`) ? undefined : sourceColumns.find((item) => pathOf(item) === name);
    shown.push({
      column: column ?? { key: '', name, type: 'formula', formula: `=[${name}]`, box: WORKING, required: false },
      stage: '',
      check: '',
      header: label,
      kind,
      width,
      formulaText: '',
    });
  };

  for (const { dat, offset, stage } of STAGES) {
    const stageName = `Stage ${stage} (${dat})`;
    const date = resolve({ box: stage, name: 'Date' });
    const planting = datePath;
    if (date) {
      // The day it was seen, else the plan's: planting + its days.
      const formula =
        offset === null || !planting
          ? `=IF([${date}]="","",[${date}])`
          : `=IF([${date}]<>"",[${date}],IF([${planting}]="","",[${planting}]+${offset}))`;
      const column = analysisColumn('Date', stageName, '', formula);
      shown.push({
        column,
        stage: stageName,
        check: '',
        header: 'Date',
        kind: 'date',
        width: 100,
        formulaText: offset === null || !planting ? '=IF([Date]="","",[Date])' : `=IF([Date]<>"",[Date],IF([Planting Date]="","",[Planting Date]+${offset}))`,
      });
    }
    for (const check of CHECKS.filter((item) => item.stage === stage)) {
      const group = check.target ? `${check.label} (${check.target})` : check.label;
      const made = checkColumns(check, stageName, group);
      if (!made) {
        skipped.push(`${stageName} · ${check.label}`);
        continue;
      }
      for (const item of made) shown.push(item);
    }
  }

  /** One check's columns, or null when a column it reads isn't in the table (the web leaves such a check empty). */
  function checkColumns(check: Check, stage: string, group: string): AnalysisColumn[] | null {
    const paths: Record<string, string> = {};
    for (const [name, field] of Object.entries(check.fields)) {
      const path = resolve(field);
      if (path === null) return null;
      paths[name] = path;
    }
    const specs = [
      ...check.columns.map((spec) => ({ header: spec.header, formula: spec.formula, format: spec.format, width: spec.width })),
      ...(check.messages ? [{ header: 'Corrective Action', formula: actionFormula(check.messages), format: undefined, width: ACTION_WIDTH }] : []),
    ].filter((spec) => spec.formula);
    const own = (header: string) => `${stage}${SEPARATOR}${group}${SEPARATOR}${header}`;
    const worked = specs.map((spec) => {
      const text = (formula: string, forDisplay: boolean) =>
        formula.replace(/\{([A-Za-z ]+?)(\*?)\}/g, (_all, name: string, whole: string) => {
          const path = paths[name];
          if (path === undefined) return forDisplay ? `[${name}]` : `[${own(name)}]`;
          if (forDisplay) return `[${path.split(SEPARATOR).at(-1)}]`;
          return whole ? `'${ANALYSIS_TITLE}'[${path}]` : `[${path}]`;
        });
      return { spec, formula: text(spec.formula, false), display: text(spec.formula, true) };
    });
    return worked.map(({ spec, formula, display }) => {
      const column = analysisColumn(spec.header, stage, group, formula);
      return {
        column,
        stage,
        check: group,
        label: check.label,
        ...(check.target ? { target: check.target } : {}),
        header: spec.header,
        format: spec.format,
        width: spec.width,
        kind: spec.header === 'Status' ? 'status' : spec.header === 'Actual Result' ? 'result' : spec.header === 'Corrective Action' ? 'action' : 'value',
        formulaText: display,
      } satisfies AnalysisColumn;
    });
  }

  const identities: AnalysisColumn[] = [];
  const before = shown.length;
  identity('Plant Batch', batchPath, 120, 'identity');
  identity('Zone', zonePath, 110, 'identity');
  identity('Planting Date', datePath, 108, 'date');
  identities.push(...shown.splice(before));
  shown.unshift(...identities);

  // ---------------------------------------------------------------- the working copy and its rows
  const workingColumns: Column[] = working.map((item, index) => ({
    key: `w${index + 1}`,
    name: item.name,
    type: 'formula',
    formula: item.formula,
    box: WORKING,
    required: false,
  }));
  // The batch column shown: the working column of that name.
  for (const item of shown) {
    if (item.column.key === '' && item.column.name.startsWith(WORKING)) {
      const own = workingColumns.find((column) => `${WORKING}${SEPARATOR}${column.name}` === item.column.name);
      if (own) item.column = own;
    }
  }
  const sheet: SheetWithRows = {
    ...records,
    sheetId: ANALYSIS_ID,
    title: ANALYSIS_TITLE,
    templateKey: null,
    dashboard: null,
    columns: [...sourceColumns, ...workingColumns, ...columns],
    rows: records.rows.map((row) => ({ ...row, sheetId: ANALYSIS_ID })),
  };
  return { sheet, rows: latestPerPlot(sheet.rows, sourceColumns), columns: shown, skipped };
}

const SHARED_BATCH: Field = { box: 'record', name: 'Plant batch' };

/** Each zone plot's latest record (by its Date, then the newest), in plot order. */
export function latestPerPlot(rows: readonly Row[], columns: readonly Column[]): Row[] {
  const zone = columns.find((column) => !column.box && column.name === 'Zone');
  const date = columns.find((column) => !column.box && column.name === 'Date');
  const id = columns.find((column) => column.auto);
  if (!zone) return [];
  const best = new Map<string, { row: Row; when: string; id: number }>();
  for (const row of rows) {
    const plot = (row.data[zone.key] ?? '').trim();
    if (!plot) continue;
    const when = date ? (row.data[date.key] ?? '') : '';
    const number = Number(id ? row.data[id.key] : row.rowId) || row.rowId;
    const had = best.get(plot);
    if (!had || when > had.when || (when === had.when && number > had.id)) best.set(plot, { row, when, id: number });
  }
  return [...best.entries()].sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })).map(([, item]) => item.row);
}

/** Where the Plant Progress table keeps each plot's nursery batch, from the MAC's tables (none: the batch baselines stay empty). */
export function batchSourceOf(sheets: readonly SheetWithRows[]): BatchSource | null {
  const progress = sheets.find((sheet) => sheet.templateKey === 'zone-records');
  if (!progress) return null;
  const find = (...names: string[]) => progress.columns.find((column) => names.some((name) => clean(column.name) === clean(name)));
  const batch = find('Nursery batch', 'Plant batch', 'Batch');
  const plot = find('Zone plot', 'Zone', 'Plot');
  return batch && plot ? { table: progress.title, batch: batch.name, plot: plot.name } : null;
}

export type { Cells };
