import type { MapShape } from '../components/mac-map';
import type { PlotCard } from '../components/mac-map-3d';
import type { SheetWithRows } from '../core/models';
import { formatDate } from '../sheet/columns';

/**
 * The colour of each numbered section, as the farm's own Farm Update sheet colours it: Zone A's sections
 * 1, 3, 5, 7, 9 are orange, blue, yellow, brick red and light green; Zone B's 2, 4, 6, 8, 10 are green,
 * dark grey, light grey, cyan and magenta.
 */
const SECTION_COLORS = [
  '#F2A03D', // 1 orange
  '#5BAD5B', // 2 green
  '#5B86E0', // 3 blue
  '#999999', // 4 dark grey
  '#FFF04D', // 5 yellow
  '#D9D9D9', // 6 light grey
  '#BF4E33', // 7 brick red
  '#80FFFF', // 8 cyan
  '#7BF542', // 9 light green
  '#E83CF5', // 10 magenta
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
  if (section == null) return UNNUMBERED;
  const color = SECTION_COLORS[Math.max(0, section - 1) % SECTION_COLORS.length];
  return { bg: color, border: mix(color, 0.22, 0), text: mix(color, 0.6, 0) };
}

function mix(hex: string, ratio: number, to: number): string {
  const value = parseInt(hex.replace('#', ''), 16);
  const channel = (shift: number) => {
    const c = (value >> shift) & 255;
    return Math.round(c + (to - c) * ratio).toString(16).padStart(2, '0');
  };
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

/** A plot is its section's colour from the sheet; one with a plant record is outlined darker. */
function paletteFor(usage: Usage, section: number | null, planted: boolean): Palette {
  if (usage === 'water') return WATER;
  if (usage === 'unused') return UNUSED;
  const base = sectionPalette(section);
  return planted ? { ...base, border: mix(base.bg, 0.55, 0) } : base;
}

export function parseOutline(text: string): [number, number][] {
  return text
    .split(';')
    .map((pair) => pair.split(',').map(Number))
    .filter((pair) => pair.length === 2 && pair.every(Number.isFinite))
    .map((pair) => [pair[0], pair[1]] as [number, number]);
}

/** An outline as the Zones table keeps it: "lat,lng;lat,lng", 7 decimals (about a centimetre), no closing point. */
export function formatOutline(points: [number, number][]): string {
  return points.map(([lat, lng]) => `${lat.toFixed(7)},${lng.toFixed(7)}`).join(';');
}

/** An outline moved whole, by this much north and east. */
export function moveOutline(points: [number, number][], dLat: number, dLng: number): [number, number][] {
  return points.map(([lat, lng]) => [lat + dLat, lng + dLng] as [number, number]);
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

/** Which plots the map shows: all of them, the zones (plots in use with a zone number), or the rest (not in use, water, an old chili plot…). */
export type PlotShow = 'all' | 'zones' | 'other';

export function showsPlot(cell: ZoneCell, show: PlotShow): boolean {
  return show === 'all' || (show === 'zones') === (cell.usage === 'normal' && cell.section !== null);
}

/** The choices of a filter over the plots, with how many plots each shows: what a page's switch says. */
export function plotShowOptions(layout: ZoneLayout): { value: PlotShow; label: string; count: number; title: string }[] {
  const zones = layout.cells.filter((cell) => showsPlot(cell, 'zones')).length;
  return [
    { value: 'all', label: 'All', count: layout.cells.length, title: 'Every plot' },
    { value: 'zones', label: 'Zones', count: zones, title: 'The zones: plots in use, that can be planted' },
    { value: 'other', label: 'Other', count: layout.cells.length - zones, title: 'Not in use, water and the rest that is not a zone' },
  ];
}

/** The layout with only the plots to show, each staying where it is (the same layout when all are shown). */
export function filterLayout(layout: ZoneLayout, show: PlotShow): ZoneLayout {
  if (show === 'all') return layout;
  const areas = layout.areas
    .map((area) => ({
      ...area,
      sections: area.sections
        .map((section) => ({ ...section, cells: section.cells.filter((cell) => showsPlot(cell, show)) }))
        .filter((section) => section.cells.length),
    }))
    .filter((area) => area.sections.length);
  return { areas, cells: layout.cells.filter((cell) => showsPlot(cell, show)) };
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

/**
 * Where the satellite map looks: the MAC's own latitude and longitude when it has them; else the middle of the plots' outlines, so
 * a MAC opened from a file (which leaves the farm's own place out) still shows its map. Null when there is neither.
 */
export function mapCentre(
  mac: { latitude: number | null; longitude: number | null },
  shapes: readonly MapShape[],
): { lat: number; lng: number } | null {
  if (mac.latitude !== null && mac.longitude !== null) return { lat: mac.latitude, lng: mac.longitude };
  const points = shapes.filter((shape) => shape.points.length >= 3).flatMap((shape) => shape.points);
  if (!points.length) return null;
  const lats = points.map((point) => point[0]);
  const lngs = points.map((point) => point[1]);
  return { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lng: (Math.min(...lngs) + Math.max(...lngs)) / 2 };
}

/** What a plot is used for, in a word. */
export function usageWord(cell: ZoneCell) {
  return cell.usage === 'water' ? 'Water' : cell.usage === 'unused' ? 'Not in use' : cell.planted ? 'Planted' : 'Not planted yet';
}

/** A picked plot's card on the satellite map: its zone and use, and its latest record. */
export function plotCard(cell: ZoneCell): PlotCard {
  // Only a plot with a zone number is in a zone: another (an old chili plot, a pond…) is named by its area alone.
  const place = cell.section !== null ? `Zone ${cell.zone} · ${cell.section}` : cell.zone;
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
