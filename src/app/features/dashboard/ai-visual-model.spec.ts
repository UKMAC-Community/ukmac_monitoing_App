import { parseAiVisuals, validateAiSelection } from './ai-visual-model';
import type { StudioField } from './studio-model';

const FIELDS: StudioField[] = [
  { key: '', name: 'Rows', kind: 'number' },
  { key: 'c1', name: 'Origin', kind: 'text' },
  { key: 'c2', name: 'Weight', kind: 'number' },
  { key: 'c3', name: 'Planted', kind: 'date' },
];
const ANSWER = { visuals: [{ type: 'donut', title: 'Rows by origin', axis: 'c1', column: '', aggregate: 'count', part: 'value', goal: null }] };
const JSON_ANSWER = JSON.stringify(ANSWER);

describe('reading the AI reply', () => {
  it('accepts a plain JSON object', () => {
    const [visual] = parseAiVisuals(JSON_ANSWER, FIELDS);
    expect(visual.type).toBe('donut');
    expect(visual.axis).toBe('c1');
    expect(visual.title).toBe('Rows by origin');
  });

  it('accepts a fenced block, with or without the language tag', () => {
    expect(parseAiVisuals('```json\n' + JSON_ANSWER + '\n```', FIELDS)).toHaveLength(1);
    expect(parseAiVisuals('```\n' + JSON_ANSWER + '\n```', FIELDS)).toHaveLength(1);
  });

  it('ignores a <think> block before the answer, even one that holds braces or a decoy object', () => {
    const thinking = '<think>The user wants {"visuals": []} maybe. I should use { c1 } and a donut.</think>\n\n';
    expect(parseAiVisuals(thinking + JSON_ANSWER, FIELDS)).toHaveLength(1);
  });

  it('finds the object inside sentences and fences around it', () => {
    expect(parseAiVisuals('Sure! Here is what I suggest:\n```json\n' + JSON_ANSWER + '\n```\nHope that helps {smile}.', FIELDS)).toHaveLength(1);
    expect(parseAiVisuals('Use { carefully. ' + JSON_ANSWER, FIELDS)).toHaveLength(1);
  });

  it('keeps braces and quotes inside a title from splitting the object', () => {
    const tricky = { visuals: [{ ...ANSWER.visuals[0], title: 'Origin {all} "quoted" \\ done' }] };
    const [visual] = parseAiVisuals('Answer: ' + JSON.stringify(tricky) + ' (end)', FIELDS);
    expect(visual.title).toBe('Origin {all} "quoted" \\ done');
  });

  it('skips an unrelated object and takes the one that carries visuals', () => {
    expect(parseAiVisuals('Settings {"mode":"fast"} then ' + JSON_ANSWER, FIELDS)).toHaveLength(1);
  });

  it('says so when there is nothing usable, rather than guessing', () => {
    for (const text of ['I cannot help with that.', '<think>still thinking', '{"visuals": [', '{"mode":"fast"}', '']) {
      expect(() => parseAiVisuals(text, FIELDS), text).toThrowError(/valid chart instructions|between one and six/);
    }
  });

  it('still rejects anything the table cannot back, however it was wrapped', () => {
    const bad = (visual: Record<string, unknown>) => '<think>ok</think>```json\n' + JSON.stringify({ visuals: [{ ...ANSWER.visuals[0], ...visual }] }) + '\n```';
    expect(() => parseAiVisuals(bad({ axis: 'c9' }), FIELDS)).toThrowError(/not in this table/);
    expect(() => parseAiVisuals(bad({ type: 'sunburst' }), FIELDS)).toThrowError(/does not support/);
    expect(() => parseAiVisuals(bad({ aggregate: 'sum', column: 'c1' }), FIELDS)).toThrowError(/numeric/);
    expect(() => parseAiVisuals(bad({ part: 'month' }), FIELDS)).toThrowError(/date field/);
  });

  it('rechecks a chosen selection against the fields it was made for', () => {
    const visuals = parseAiVisuals(JSON_ANSWER, FIELDS);
    expect(() => validateAiSelection(visuals, FIELDS)).not.toThrow();
    expect(() => validateAiSelection(visuals, FIELDS.filter((field) => field.key !== 'c1'))).toThrowError(/not in this table/);
  });
});
