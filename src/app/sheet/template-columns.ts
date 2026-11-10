import type { Column, RetiredColumn } from '../core/models';

/**
 * Bringing a table made from the template up to date: the columns the template has gained since, found by their
 * stage box, group and name (how a template names a column), and put where they belong among the table's own.
 * Nothing the table has is removed or moved. A column of the template's that the table has but gave no limit
 * (its least and most) gets the template's; a limit the person set is left as it is.
 */

/** A column told apart by its box, group and name, in any case and spacing. */
export function columnIdentity(column: Pick<Column, 'box' | 'group' | 'name'>) {
  const clean = (text: string | undefined) => (text ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  return [clean(column.box), clean(column.group), clean(column.name)].join('|');
}

/** The columns the table has that an earlier template had and this one doesn't (the template says which). */
export function retiredColumns(existing: readonly Column[], retired: readonly RetiredColumn[]): Column[] {
  const gone = new Set(retired.map(columnIdentity));
  return existing.filter((column) => gone.has(columnIdentity(column)));
}

/**
 * Of those, the ones to take off: no row has a value in them, so nothing is lost. (One that holds values stays, for
 * the person to look at and delete themselves.)
 */
export function columnsToRemove(existing: readonly Column[], retired: readonly RetiredColumn[], hasValue: (column: Column) => boolean): Column[] {
  return retiredColumns(existing, retired).filter((column) => !hasValue(column));
}

/** Whether the table is just what the template made, now or earlier: every column is the template's or one it dropped. */
export function isUntouched(existing: readonly Column[], template: readonly Column[], retired: readonly RetiredColumn[]): boolean {
  const known = new Set([...template, ...retired].map(columnIdentity));
  return existing.every((column) => known.has(columnIdentity(column)));
}

/** The template's columns the table doesn't have (by name: one renamed here counts as missing). */
export function missingTemplateColumns(existing: readonly Column[], template: readonly Column[]): Column[] {
  const have = new Set(existing.map(columnIdentity));
  return template.filter((column) => !have.has(columnIdentity(column)));
}

/** What a column of the table is missing that the template gives it: its limits (least, most) and the other names it answers to. */
type Taken = Pick<Column, 'min' | 'max' | 'aliases'>;

function takenFromTemplate(column: Column, template: Column | undefined): Taken | undefined {
  if (!template) return undefined;
  const min = column.min === undefined ? template.min : undefined;
  const max = column.max === undefined ? template.max : undefined;
  const have = new Set((column.aliases ?? []).map((alias) => alias.trim().toLowerCase()));
  const names = (template.aliases ?? []).filter((alias) => !have.has(alias.trim().toLowerCase()));
  if (min === undefined && max === undefined && !names.length) return undefined;
  return { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}), ...(names.length ? { aliases: [...(column.aliases ?? []), ...names] } : {}) };
}

/** The columns the table has that the template gives a limit or another name they don't have yet (a limit the person set is not changed). */
export function columnsToLimit(existing: readonly Column[], template: readonly Column[]): Column[] {
  const byIdentity = new Map(template.map((column) => [columnIdentity(column), column]));
  return existing.filter((column) => takenFromTemplate(column, byIdentity.get(columnIdentity(column))) !== undefined);
}

/**
 * The table's columns with the template's missing ones among them: each goes right after the nearest column before it
 * in the template that the table has (or is given), so a stage's new columns land in that stage. The table's columns come
 * back once each, in the order they were (with a template's limit where they had none), but for those in `remove`; the
 * new ones have no key (the table gives them).
 */
export function withTemplateColumns(existing: readonly Column[], template: readonly Column[], remove: readonly Column[] = []): Column[] {
  const gone = new Set(remove.map((column) => column.key));
  const result = [...existing];
  let after = -1;
  for (const column of template) {
    const identity = columnIdentity(column);
    const at = result.findIndex((item) => columnIdentity(item) === identity);
    if (at >= 0) {
      const taken = takenFromTemplate(result[at], column);
      if (taken) result[at] = { ...result[at], ...taken };
      after = at;
      continue;
    }
    after += 1;
    result.splice(after, 0, { ...column, key: '' });
  }
  return gone.size ? result.filter((column) => !gone.has(column.key)) : result;
}

/**
 * Whether a table is brought up to date without asking: it has no rows and nothing of the person's own, and it is still the
 * older layout (it has columns the template has since dropped). Once it is brought up to date it has none of those, so
 * this is never true again: what the person deletes or changes after that stays so.
 */
export function upgradesItself(existing: readonly Column[], rowCount: number, template: readonly Column[], retired: readonly RetiredColumn[]): boolean {
  return rowCount === 0 && existing.length > 0 && retiredColumns(existing, retired).length > 0 && isUntouched(existing, template, retired);
}
