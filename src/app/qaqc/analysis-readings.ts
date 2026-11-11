import type { SheetWithRows } from '../core/models';
import { formatFormulaValue } from '../formula/evaluate-formula';
import { formatPattern } from '../formula/number-format';
import type { WorkbookFormulas } from '../formula/sheet-formulas';
import type { Analysis, AnalysisColumn } from './analysis-sheet';

export type Status = 'GREEN' | 'YELLOW' | 'RED';

/** What one check says of one plot: its status and the Actual Result behind it. */
export interface Reading {
  stage: string;
  /** The check with its target, as the analysis names it (what tells two checks apart). */
  check: string;
  /** Its own name ("Fruit Length (Standard)") and its target ("6.5–7.8 cm"). */
  label: string;
  target: string;
  status: Status;
  /** What it reads: the Actual Result, else the Value. */
  result: string;
}

/** Red is worse than yellow, yellow than green. */
export const STATUS_ORDER: Record<Status, number> = { GREEN: 0, YELLOW: 1, RED: 2 };

export function worst(statuses: readonly Status[]): Status | null {
  return statuses.reduce<Status | null>((worse, status) => (worse === null || STATUS_ORDER[status] > STATUS_ORDER[worse] ? status : worse), null);
}

/**
 * What the analysis says of each zone plot (by its plot code, the QA/QC record's Zone): every check that has a status,
 * with its Actual Result. A check with nothing to say of a plot (the record has no counts for it yet) is left out.
 */
export function plotReadings(analysis: Analysis, formulas: WorkbookFormulas): Map<string, Reading[]> {
  const zone = analysis.sheet.columns.find((column) => !column.box && column.name === 'Zone');
  const readings = new Map<string, Reading[]>();
  if (!zone) return readings;
  const statuses = analysis.columns.filter((item) => item.kind === 'status');
  const results = analysis.columns.filter((item) => item.kind === 'result');
  const values = analysis.columns.filter((item) => item.kind === 'value' && item.header === 'Value');
  for (const row of analysis.rows) {
    const plot = (row.data[zone.key] ?? '').trim();
    if (!plot) continue;
    const list: Reading[] = [];
    for (const item of statuses) {
      const word = formatFormulaValue(formulas.cell(analysis.sheet, row, item.column)).trim().toUpperCase();
      if (word !== 'GREEN' && word !== 'YELLOW' && word !== 'RED') continue;
      const same = (other: AnalysisColumn) => other.stage === item.stage && other.check === item.check;
      const result = results.find(same);
      const value = values.find(same);
      const text = (column: AnalysisColumn | undefined) => {
        if (!column) return '';
        const cell = formulas.cell(analysis.sheet, row, column.column);
        return typeof cell === 'number' && column.format ? formatPattern(cell, column.format) : formatFormulaValue(cell);
      };
      list.push({
        stage: item.stage,
        check: item.check,
        label: item.label ?? item.check,
        target: item.target ?? '',
        status: word,
        // A check with no Actual Result column (Plant Flowering) says its Value.
        result: text(result) || text(value),
      });
    }
    readings.set(plot, list);
  }
  return readings;
}

export type { SheetWithRows };
