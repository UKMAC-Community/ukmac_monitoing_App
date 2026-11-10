import type { MapShape } from '../components/mac-map';
import type { SheetWithRows } from '../core/models';
import { buildZoneLayout, plotShapes } from './zone-layout';

/** One area of the picture: its corners in pixels, its colours, and where its label sits. */
export interface PictureShape {
  points: [number, number][];
  fill: string;
  stroke: string;
  label: string;
  at: [number, number];
  size: [number, number];
}

/** What to draw: the plots as the Zone Map shows them (north up), and a key of the zones' colours under them. */
export interface MapPicture {
  width: number;
  height: number;
  shapes: PictureShape[];
  legend: { color: string; text: string }[];
}

const PAD = 40;
const KEY_ROW = 38;

/** Lays the plots out in a picture `width` pixels wide: latitude up, longitude across, true to the ground. */
export function planMapPicture(shapes: MapShape[], width = 2400): MapPicture | null {
  const all = shapes.flatMap((shape) => shape.points);
  if (all.length < 3) return null;
  const lats = all.map((point) => point[0]);
  const lngs = all.map((point) => point[1]);
  const minLng = Math.min(...lngs);
  const maxLat = Math.max(...lats);
  const flat = Math.cos((((maxLat + Math.min(...lats)) / 2) * Math.PI) / 180);
  const spanX = Math.max((Math.max(...lngs) - minLng) * flat, 1e-9);
  const spanY = Math.max(maxLat - Math.min(...lats), 1e-9);
  const scale = (width - 2 * PAD) / spanX;
  const toPixel = ([lat, lng]: [number, number]): [number, number] => [PAD + (lng - minLng) * flat * scale, PAD + (maxLat - lat) * scale];

  const drawn: PictureShape[] = shapes
    .filter((shape) => shape.points.length >= 3)
    .map((shape) => {
      const points = shape.points.map(toPixel);
      const xs = points.map((point) => point[0]);
      const ys = points.map((point) => point[1]);
      return {
        points,
        fill: shape.fill,
        stroke: shape.stroke,
        label: shape.label,
        at: [xs.reduce((a, b) => a + b, 0) / xs.length, ys.reduce((a, b) => a + b, 0) / ys.length],
        size: [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)],
      };
    });

  // One key entry per zone's section, as the map names them ("Zone A · 1"), in reading order.
  const seen = new Map<string, string>();
  for (const shape of shapes) if (shape.group && !seen.has(shape.group)) seen.set(shape.group, shape.groupColor ?? shape.stroke);
  const legend = [...seen]
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
    .map(([text, color]) => ({ text, color }));

  const mapHeight = Math.ceil(spanY * scale + 2 * PAD);
  return { width, height: mapHeight + keyHeight(legend, width), shapes: drawn, legend };
}

/** The room the key of colours takes under the map: its entries wrap onto rows. */
function keyHeight(legend: { text: string }[], width: number) {
  let rows = legend.length ? 1 : 0;
  let used = 0;
  for (const item of legend) {
    const need = 40 + item.text.length * 11;
    if (used + need > width - 2 * PAD && used > 0) {
      rows++;
      used = 0;
    }
    used += need;
  }
  return rows ? rows * KEY_ROW + PAD / 2 : 0;
}

/** The picture as a PNG data URL, or null where there is nothing to draw on (no canvas, no plots). */
export function drawMapPicture(plan: MapPicture): string | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = plan.width;
  canvas.height = plan.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#e6ede3';
  ctx.fillRect(0, 0, plan.width, plan.height);
  ctx.lineJoin = 'round';
  for (const shape of plan.shapes) {
    ctx.beginPath();
    shape.points.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = shape.fill;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = shape.stroke;
    ctx.stroke();
  }
  // Plot codes in the dark tags the map uses, where the plot is big enough to hold one.
  ctx.font = '600 15px -apple-system, "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const shape of plan.shapes) {
    if (!shape.label) continue;
    const text = ctx.measureText(shape.label).width + 14;
    if (shape.size[0] < text * 0.9 || shape.size[1] < 24) continue;
    const [x, y] = shape.at;
    ctx.fillStyle = 'rgba(32, 36, 33, 0.82)';
    ctx.beginPath();
    ctx.roundRect(x - text / 2, y - 12, text, 24, 7);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(shape.label, x, y + 1);
  }
  // The key of the zones' colours.
  ctx.font = '600 17px -apple-system, "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'left';
  let x = PAD;
  let y = plan.height - keyHeight(plan.legend, plan.width) + KEY_ROW / 2;
  for (const item of plan.legend) {
    const need = 40 + item.text.length * 11;
    if (x + need > plan.width - PAD && x > PAD) {
      x = PAD;
      y += KEY_ROW;
    }
    ctx.fillStyle = item.color;
    ctx.beginPath();
    ctx.roundRect(x, y - 10, 20, 20, 5);
    ctx.fill();
    ctx.fillStyle = '#2b312d';
    ctx.fillText(item.text, x + 30, y + 1);
    x += need;
  }
  return canvas.toDataURL('image/png');
}

/** The Zones table as a picture of the map, for the Excel file (null when it has no plot with an outline). */
export function zoneMapPicture(zones: SheetWithRows): { dataUrl: string; width: number; height: number } | null {
  const plan = planMapPicture(plotShapes(buildZoneLayout(zones, null)));
  if (!plan) return null;
  const dataUrl = drawMapPicture(plan);
  return dataUrl ? { dataUrl, width: plan.width, height: plan.height } : null;
}
