import type { Column } from '../core/models';

/**
 * Matching the columns of a file laid out as the old QA QC sheet is — a stage banner, a group, a field, over each column —
 * to the columns of a table that has the same stages, groups and fields (named a little differently). The stage a column is in
 * comes first (the same group and field are in several stages), then the group, then the field.
 *
 * Wrong is worse than missing: a value in the wrong column goes unnoticed, an unmatched column is one drag. So a pair is
 * taken only when it is the one possible for both of them, and what can't be told is left for the person.
 */

export interface StagedColumn {
  /** The worksheet column. */
  position: number;
  /** The stage it is in (1–10), 0 when it is the row's own. */
  stage: number;
  group: string;
  field: string;
}

/** The stage of a table column: the number its box begins with ("3 · Vegetative (30 DAT)"), else 0. */
export function stageOfBox(box: string | undefined): number {
  const found = /^\s*(\d+)\s*·/.exec(box ?? '');
  return found ? Number(found[1]) : 0;
}

/** A header text with what doesn't tell columns apart taken out: case, brackets and what is in them, dashes, underscores, punctuation. */
export function loose(text: string): string {
  return text
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[–—_\-/\n\r]+/g, ' ')
    .replace(/[^\p{L}\p{N}# ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const tokens = (text: string) => loose(text).split(' ').filter(Boolean);

/** Edit distance between two words, for a typo ("uprigth", "upright"). */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

/** Whether a word is the same or a typo of another (long enough that two letters is a typo, not another word). */
const near = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && distance(a, b) <= 2);

/** Whether every word of `small` is (nearly) a word of `big`. */
const covers = (big: readonly string[], small: readonly string[]) => small.length > 0 && small.every((word) => big.some((other) => near(word, other)));

interface Target {
  column: Column;
  stage: number;
  group: string;
  name: string;
}

/** The pairs where each has only the other as a candidate (the rest are left). */
function onlyOnes(candidates: Map<number, Target[]>): Map<number, Target> {
  const claimed = new Map<Target, number[]>();
  for (const [position, list] of candidates) for (const target of list) claimed.set(target, [...(claimed.get(target) ?? []), position]);
  const taken = new Map<number, Target>();
  for (const [position, list] of candidates) {
    if (list.length === 1 && claimed.get(list[0])!.length === 1) taken.set(position, list[0]);
  }
  return taken;
}

/**
 * Which table column each file column (of a stage) is, where it can be told: by group and field, then by a group that says
 * more or less, then (a weekly Date, W1, Date, W2…) by order within a group when the counts are the same, last by a typo
 * or a word more or less in the field. `columns` are the table's columns that can take a value (not worked out), `taken` the
 * keys of those already matched.
 */
export function matchByStage(files: readonly StagedColumn[], columns: readonly Column[], taken: ReadonlySet<string>): Map<number, Column> {
  const result = new Map<number, Column>();
  let free: Target[] = columns
    .filter((column) => !taken.has(column.key) && column.type !== 'formula')
    .map((column) => ({ column, stage: stageOfBox(column.box), group: loose(column.group ?? ''), name: loose(column.name) }))
    .filter((target) => target.stage > 0);
  let left = files.filter((file) => file.stage > 0 && loose(file.field) !== '').map((file) => ({ ...file, group: loose(file.group), field: loose(file.field) }));

  const take = (pairs: Map<number, Target>) => {
    for (const [position, target] of pairs) result.set(position, target.column);
    const used = new Set(pairs.values());
    const done = new Set(pairs.keys());
    free = free.filter((target) => !used.has(target));
    left = left.filter((file) => !done.has(file.position));
  };
  const pass = (fits: (file: (typeof left)[number], target: Target) => boolean) => {
    const candidates = new Map<number, Target[]>();
    for (const file of left) {
      const list = free.filter((target) => target.stage === file.stage && fits(file, target));
      if (list.length) candidates.set(file.position, list);
    }
    take(onlyOnes(candidates));
  };
  const groupSays = (file: { group: string }, target: Target) => {
    const a = tokens(file.group);
    const b = tokens(target.group);
    return a.length > 0 && b.length > 0 && (a.join(' ') === b.join(' ') || covers(a, b) || covers(b, a));
  };

  // 1. The same group and field (a table column with no group is told by its field alone: the date of a stage).
  pass((file, target) => file.field === target.name && (target.group === '' || file.group === target.group));
  // 2. The same field, a group that says more ("Rejected_Marketable Fruit") or less than the table's.
  pass((file, target) => file.field === target.name && groupSays(file, target));
  // 3. In order, within a group, when what is left of the file's group and of the table's are as many (and more than one).
  {
    const groups = new Map<string, typeof left>();
    for (const file of left) groups.set(`${file.stage}|${file.group}`, [...(groups.get(`${file.stage}|${file.group}`) ?? []), file]);
    const pairs = new Map<number, Target>();
    for (const [, fileList] of groups) {
      const here = free.filter((target) => target.stage === fileList[0].stage && target.group !== '' && groupSays(fileList[0], target));
      const byGroup = new Map<string, Target[]>();
      for (const target of here) byGroup.set(target.group, [...(byGroup.get(target.group) ?? []), target]);
      // Only when one table group is the file group's, and what is left of each is as many.
      if (byGroup.size !== 1) continue;
      const [targets] = [...byGroup.values()];
      if (fileList.length > 1 && fileList.length === targets.length) {
        fileList.sort((a, b) => a.position - b.position).forEach((file, index) => pairs.set(file.position, targets[index]));
      }
    }
    take(pairs);
  }
  // 4. A typo, or a word more or less ("Uprigth Plants", "Mixed Orien-", "1st" for "1st Date"), in a group that fits.
  pass((file, target) => {
    if (!(target.group === '' || groupSays(file, target))) return false;
    const a = tokens(file.field);
    const b = tokens(target.name);
    return covers(a, b) || covers(b, a);
  });
  return result;
}
