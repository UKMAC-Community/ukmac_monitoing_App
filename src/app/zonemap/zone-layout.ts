import type { MapShape } from '../components/mac-map';
import type { PlotCard } from '../components/mac-map-3d';
import type { SheetWithRows } from '../core/models';
import { formatDate } from '../sheet/columns';

/** The colours of a numbered section, as the system's Zone Map gives them (its `getSectionNumberPalette`). */
const SECTION_PALETTE = [
  { bg: '#E3F9E3', border: '#B9EFB9', text: '#1F7A1F' },
  { bg: '#FBE6FB', border: '#F0B8F0', text: '#8A1F8A' },
  { bg: '#FBE6E2', border: '#F3B8AC', text: '#8C2410' },
  { bg: '#E1FBFB', border: '#AEF0F0', text: '#0E7A7A' },
  { bg: '#FCFBD9', border: '#F2EFA0', text: '#7A7500' },
  { bg: '#F2F2F2', border: '#DADADA', text: '#5C5C5C' },
  { bg: '#E4EFFC', border: '#AFCEF5', text: '#1B4E91' },
  { bg: '#bababa', border: '#C9C9C9', text: '#4D4D4D' },
  { bg: '#FEF1E1', border: '#FBD8AC', text: '#8A4E0F' },
  { bg: '#E8F3E4', border: '#C3E0B9', text: '#2F5C23' },
];
const UNNUMBERED = { bg: '#eef0ee', border: '#c7ccc8', text: '#5b615c' };
const UNUSED = { bg: '#f7f8f7', border: '#d7dbd8', text: '#8a928e' };
const WATER = { bg: '#dbeafe', border: '#60a5fa', text: '#1d4ed8' };

export type Usage = 'normal' | 'unused' | 'water';

export interface Palette {
  bg: string;
  border: string;
  text: string;
}

export interface PlotRecord {
  date: string;
  count: string;
  type: string;
  status: string;
  note: string;
}

export interface ZoneCell {
  id: string;
  zone: string;
  section: number | null;
  row: number;
  column: number;
  plot: string;
  label: string;
  usage: Usage;
  capacity: string;
  note: string;
  outline: [number, number][];
  records: PlotRecord[];
  planted: boolean;
  palette: Palette;
}

export interface ZoneSection {
  section: number | null;
  rows: number;
  rowStart: number;
  cells: ZoneCell[];
}

export interface ZoneArea {
  zone: string;
  columns: number;
  rows: number;
  sections: ZoneSection[];
}

export interface ZoneLayout {
  areas: ZoneArea[];
  cells: ZoneCell[];
}

export function sectionPalette(section: number | null): Palette {
  return section == null ? UNNUMBERED : SECTION_PALETTE[Math.max(0, section - 1) % SECTION_PALETTE.length];
}

function mix(hex: string, ratio: number, to: number): string {
  const value = parseInt(hex.replace('#', ''), 16);
  const channel = (shift: number) => {
    const c = (value >> shift) & 255;
    return Math.round(c + (to - c) * ratio).toString(16).padStart(2, '0');
  };
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

/** A plot with a plant record fills with the section's stronger shade; one without stays pale (as the system draws it). */
function paletteFor(usage: Usage, section: number | null, planted: boolean): Palette {
  if (usage === 'water') return WATER;
  if (usage === 'unused') return UNUSED;
  const base = sectionPalette(section);
  return planted
    ? { bg: base.border, border: mix(base.border, 0.25, 0), text: mix(base.text, 0.25, 0) }
    : { ...base, bg: mix(base.bg, 0.55, 255), border: mix(base.border, 0.4, 255) };
}

function parseOutline(text: string): [number, number][] {
  return text
    .split(';')
    .map((pair) => pair.split(',').map(Number))
    .filter((pair) => pair.length === 2 && pair.every(Number.isFinite))
    .map((pair) => [pair[0], pair[1]] as [number, number]);
}

function usageOf(text: string): Usage {
  const word = text.trim().toLowerCase();
  if (word === 'water') return 'water';
  return ['unused', 'not use', 'not usable', 'blocked'].includes(word) ? 'unused' : 'normal';
}

function byName(sheet: SheetWithRows) {
  const keys = new Map(sheet.columns.map((column) => [column.name.toLowerCase(), column.key]));
  return (row: SheetWithRows['rows'][number], name: string) => {
    const key = keys.get(name.toLowerCase());
    const value = key ? row.data[key] : undefined;
    return value === undefined || value === null ? '' : String(value).trim();
  };
}

/** The Zones table as the system's Zone Map lays it out: each zone an area, its numbered sections stacked, every plot at its row and column. */
export function buildZoneLayout(zones: SheetWithRows | null, records: SheetWithRows | null): ZoneLayout {
  if (!zones) return { areas: [], cells: [] };
  const zoneValue = byName(zones);
  const byPlot = new Map<string, PlotRecord[]>();
  if (records) {
    const recordValue = byName(records);
    for (const row of records.rows) {
      const plot = recordValue(row, 'Zone plot');
      if (!plot) continue;
      const list = byPlot.get(plot) ?? [];
      list.push({
        date: recordValue(row, 'Record date'),
        count: recordValue(row, 'Plant count'),
        type: recordValue(row, 'Plant type'),
        status: recordValue(row, 'Status'),
        note: recordValue(row, 'Note'),
      });
      byPlot.set(plot, list);
    }
    for (const list of byPlot.values()) list.sort((a, b) => b.date.localeCompare(a.date));
  }

  const cells: ZoneCell[] = [];
  for (const row of zones.rows) {
    const rowNumber = Number(zoneValue(row, 'Row'));
    const columnNumber = Number(zoneValue(row, 'Column'));
    if (!(rowNumber >= 1) || !(columnNumber >= 1)) continue;
    const plot = zoneValue(row, 'Plot');
    const usage = usageOf(zoneValue(row, 'Plot status'));
    const sectionText = zoneValue(row, 'Zone number');
    const section = sectionText && Number.isFinite(Number(sectionText)) ? Number(sectionText) : null;
    const name = zoneValue(row, 'Status name');
    const planted = usage === 'normal' && (byPlot.get(plot)?.length ?? 0) > 0;
    cells.push({
      id: String(row.rowId),
      zone: zoneValue(row, 'Zone'),
      section,
      row: rowNumber,
      column: columnNumber,
      plot,
      label: usage === 'water' ? name || 'Water' : usage === 'unused' ? name || 'not use' : plot,
      usage,
      capacity: zoneValue(row, 'Plant capacity'),
      note: zoneValue(row, 'Note'),
      outline: parseOutline(zoneValue(row, 'Outline')),
      records: plot ? (byPlot.get(plot) ?? []) : [],
      planted,
      palette: paletteFor(usage, section, planted),
    });
  }

  const areas: ZoneArea[] = [];
  for (const zone of [...new Set(cells.map((cell) => cell.zone))].sort()) {
    const inZone = cells.filter((cell) => cell.zone === zone);
    const sections: ZoneSection[] = [];
    let rowStart = 0;
    const numbers = [...new Set(inZone.map((cell) => cell.section))].sort((a, b) => (a ?? 0) - (b ?? 0));
    for (const number of numbers) {
      const members = inZone.filter((cell) => cell.section === number);
      const rows = Math.max(...members.map((cell) => cell.row));
      sections.push({ section: number, rows, rowStart, cells: members });
      rowStart += rows;
    }
    areas.push({ zone, columns: Math.max(...inZone.map((cell) => cell.column)), rows: rowStart, sections });
  }
  return { areas, cells };
}

/** The plots with an outline, as shapes for the satellite map. */
export function plotShapes(layout: ZoneLayout): MapShape[] {
  return layout.cells
    .filter((cell) => cell.outline.length >= 3)
    .map((cell) => ({
      id: cell.id,
      points: cell.outline,
      fill: cell.palette.bg,
      stroke: cell.palette.border,
      label: cell.usage === 'normal' ? cell.plot : cell.label,
      ...(cell.section !== null && cell.usage === 'normal'
        ? { group: `Zone ${cell.zone} · ${cell.section}`, groupColor: cell.palette.border, groupText: cell.palette.text }
        : {}),
    }));
}

/** What a plot is used for, in a word. */
export function usageWord(cell: ZoneCell) {
  return cell.usage === 'water' ? 'Water' : cell.usage === 'unused' ? 'Not in use' : cell.planted ? 'Planted' : 'Not planted yet';
}

/** A picked plot's card on the satellite map: its zone and use, and its latest record. */
export function plotCard(cell: ZoneCell): PlotCard {
  const place = `Zone ${cell.zone}${cell.section ? ' · ' + cell.section : ''}`;
  const lines = [[place, usageWord(cell), cell.capacity ? `${cell.capacity} plants max` : ''].filter(Boolean).join(' · ')];
  const last = cell.records[0];
  if (last) {
    const date = last.date ? formatDate(last.date) : '';
    lines.push([date ? `Latest ${date}` : 'Latest record', last.count ? `${last.count} plants` : '', last.status].filter(Boolean).join(' · '));
    if (cell.records.length > 1) lines.push(`${cell.records.length} records`);
  } else if (cell.usage === 'normal') {
    lines.push('No records yet');
  }
  return { title: cell.usage === 'normal' ? cell.plot : cell.label, lines, color: cell.palette.text };
}
