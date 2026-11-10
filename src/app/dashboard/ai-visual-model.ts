import type { GroupPart, KpiAggregate } from '../core/models';
import { hasAxis } from './dashboard-model';
import { autoTitle, blankVisual, STUDIO_TYPES, type StudioField, type StudioVisual } from './studio-model';

const AGGREGATES: readonly KpiAggregate[] = ['count', 'count_values', 'distinct', 'sum', 'average', 'min', 'max'];
const NUMERIC = new Set<KpiAggregate>(['sum', 'average', 'min', 'max']);
const PARTS: readonly GroupPart[] = ['value', 'month', 'year'];
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }

const THINK_END = '</think>';
const MAX_OBJECT_STARTS = 64;

/** Every top-level `{…}` in the text, respecting strings, so braces in a title or in prose cannot split one. */
function* objectCandidates(text: string): Generator<string> {
  let starts = 0;
  for (let start = text.indexOf('{'); start >= 0 && starts < MAX_OBJECT_STARTS; start = text.indexOf('{', start + 1), starts++) {
    let depth = 0, inString = false, escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') inString = false; continue; }
      if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) { yield text.slice(start, i + 1); start = i; break; }
    }
  }
}

/** Models often wrap the answer: a `<think>` block first (Qwen3, DeepSeek-R1), a code fence, or a sentence around it. */
function answerPayload(content: string): unknown {
  const end = content.lastIndexOf(THINK_END);
  const text = (end >= 0 ? content.slice(end + THINK_END.length) : content).trim();
  if (text.length > 40_000) throw new Error('The AI response is too large. Ask for fewer visuals.');
  try { return JSON.parse(text); } catch { /* fall through to look for the object inside the text */ }
  for (const candidate of objectCandidates(text)) {
    try { const value: unknown = JSON.parse(candidate); if (record(value) && 'visuals' in value) return value; } catch { /* try the next object */ }
  }
  throw new Error('The AI did not return valid chart instructions. Try a more specific request.');
}

/** Generated output is data: only supported types, real fields and valid calculations are accepted. */
export function parseAiVisuals(content: string, fields: readonly StudioField[]): StudioVisual[] {
  if (typeof content !== 'string' || content.length > 200_000) throw new Error('The AI response is too large. Ask for fewer visuals.');
  const payload = answerPayload(content);
  if (!record(payload) || !Array.isArray(payload['visuals']) || payload['visuals'].length < 1 || payload['visuals'].length > 6) throw new Error('Ask the AI for between one and six visuals.');
  const byKey = new Map(fields.filter((field) => field.key).map((field) => [field.key, field]));
  return payload['visuals'].map((item: unknown) => {
    if (!record(item)) throw new Error('The AI returned an incomplete visual. Please try again.');
    const type = STUDIO_TYPES.find((entry) => entry.type === item['type'])?.type;
    if (!type) throw new Error('The AI suggested a chart type this editor does not support. Please try again.');
    const axis = item['axis'] ?? '', column = item['column'] ?? '', aggregate = item['aggregate'], part = item['part'] ?? 'value';
    if (typeof axis !== 'string' || typeof column !== 'string' || (axis && !byKey.has(axis)) || (column && !byKey.has(column))) throw new Error('The AI suggested a field that is not in this table. Please try again.');
    if (typeof aggregate !== 'string' || !AGGREGATES.includes(aggregate as KpiAggregate)) throw new Error('The AI suggested an unsupported calculation. Please try again.');
    const calculation = aggregate as KpiAggregate;
    if ((calculation === 'count' && column !== '') || (calculation !== 'count' && !column)) throw new Error('The AI did not match a calculation to a field. Please try again.');
    if (NUMERIC.has(calculation) && byKey.get(column)?.kind !== 'number') throw new Error('The AI tried to calculate a numeric value from a text or date field. Please try again.');
    if (typeof part !== 'string' || !PARTS.includes(part as GroupPart)) throw new Error('The AI suggested an unsupported date grouping.');
    if (hasAxis(type) && !axis) throw new Error('The AI left a chart without a category field. Please try again.');
    if (!hasAxis(type) && axis) throw new Error('The AI added categories to a card or gauge. Please try again.');
    if (part !== 'value' && (!axis || byKey.get(axis)?.kind !== 'date')) throw new Error('Month and year grouping need a date field. Please try again.');
    const title = item['title'] ?? '', goal = item['goal'] ?? null;
    if (typeof title !== 'string' || title.length > 120) throw new Error('The AI returned an invalid chart title.');
    if (goal !== null && (typeof goal !== 'number' || !Number.isFinite(goal))) throw new Error('The AI returned an invalid goal.');
    const visual: StudioVisual = { ...blankVisual(type), title: title.trim(), axis, part: part as GroupPart, values: [{ column, aggregate: calculation }], goal: (type === 'card' || type === 'gauge') ? goal as number | null : null };
    if (!visual.title) visual.title = autoTitle(visual, fields);
    return visual;
  });
}

/** Recheck at apply time, because a column may have changed while a preview was open. */
export function validateAiSelection(visuals: readonly StudioVisual[], fields: readonly StudioField[]): void {
  parseAiVisuals(JSON.stringify({ visuals: visuals.map((v) => ({ type: v.type, title: v.title, axis: v.axis, column: v.values[0]?.column ?? '', aggregate: v.values[0]?.aggregate, part: v.part, goal: v.goal })) }), fields);
}
