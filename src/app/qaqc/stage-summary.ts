import { formatFormulaValue } from '../formula/evaluate-formula';
import type { WorkbookFormulas } from '../formula/sheet-formulas';
import { type Status, STATUS_ORDER, worst } from './analysis-readings';
import type { Analysis } from './analysis-sheet';

/** How a stage stands over the plots: how many are red, yellow, green (a plot's worst check in the stage), and how many have no reading yet. */
export interface StageSummary {
  red: number;
  yellow: number;
  green: number;
  /** Plots with no check worked out in this stage (its records aren't in yet). */
  none: number;
  total: number;
  /** The plots' row ids, the ones needing action first: red, then yellow, then green, then no reading (a tie keeps the table's order). */
  order: number[];
}

export interface StageSummaries {
  stages: Map<string, StageSummary>;
  /** How many plots have a red check in some stage. */
  redPlots: number;
}

const word = (value: unknown): Status | null => {
  const text = formatFormulaValue(value as never).trim().toUpperCase();
  return text === 'GREEN' || text === 'YELLOW' || text === 'RED' ? text : null;
};

/** The standing of every stage, each plot by the worst of that stage's checks. */
export function stageSummaries(analysis: Analysis, formulas: WorkbookFormulas): StageSummaries {
  const names = [...new Set(analysis.columns.filter((item) => item.stage).map((item) => item.stage))];
  const stages = new Map<string, StageSummary>();
  const redRows = new Set<number>();
  for (const name of names) {
    const statuses = analysis.columns.filter((item) => item.stage === name && item.kind === 'status');
    const summary: StageSummary = { red: 0, yellow: 0, green: 0, none: 0, total: analysis.rows.length, order: [] };
    const ranked = analysis.rows.map((row, index) => {
      const found = statuses.map((item) => word(formulas.cell(analysis.sheet, row, item.column))).filter((status): status is Status => status !== null);
      const status = worst(found);
      if (status === 'RED') {
        summary.red += 1;
        redRows.add(row.rowId);
      } else if (status === 'YELLOW') summary.yellow += 1;
      else if (status === 'GREEN') summary.green += 1;
      else summary.none += 1;
      const reds = found.filter((item) => item === 'RED').length;
      const yellows = found.filter((item) => item === 'YELLOW').length;
      return { id: row.rowId, index, rank: status === null ? -1 : STATUS_ORDER[status], reds, yellows };
    });
    ranked.sort((a, b) => b.rank - a.rank || b.reds - a.reds || b.yellows - a.yellows || a.index - b.index);
    summary.order = ranked.map((item) => item.id);
    stages.set(name, summary);
  }
  return { stages, redPlots: redRows.size };
}
