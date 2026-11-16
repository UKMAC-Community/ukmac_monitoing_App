import { parseKpis, starterKpis, stringifyKpis, type ChiliKpi } from './chili-kpis';
import {
  copyKpis,
  emptyBook,
  fileName,
  fileText,
  importVersion,
  inUseVersion,
  keptWords,
  latestOf,
  MAX_FILE_BYTES,
  MAX_VERSIONS,
  parseBook,
  parseFile,
  publish,
  removeVersion,
  sameKpis,
  stringifyBook,
  switchTo,
  switchToSuggested,
  versionDays,
  type Clock,
  type DashboardFile,
  type DashboardVersion,
  type VersionBook,
} from './chili-versions';

/** Each person's clock numbers its ids from its own prefix, as real random ids would differ. */
function makeClock(prefix = 'me'): Clock {
  let n = 0;
  return { now: () => new Date(Date.UTC(2026, 10, 9, 8, 0, n++)).toISOString(), id: () => `${prefix}-${String(n++).padStart(4, '0')}` };
}
/** A KPI that is not one of the starter's. */
const extra = (id: string, title: string): ChiliKpi => ({ ...starterKpis()[0], id, title });

const mine = (count: number): ChiliKpi[] => starterKpis().slice(0, count);
const working = (kpis: ChiliKpi[], custom = true) => ({ kpis, custom });

/** What a recipient would get from a file made by `book`'s latest version. */
function fileOf(book: VersionBook, number: number): DashboardFile {
  const version = book.versions.find((item) => item.number === number)!;
  return parseFile(fileText(version));
}

describe('publishing a version (Export)', () => {
  it('makes version 1 the first time, and writes the same version again while nothing has changed', () => {
    const clock = makeClock();
    const first = publish(emptyBook(), mine(3), 'Chili KPIs', 'First', clock);
    expect(first.created).toBe(true);
    expect([first.version.number, first.version.name, first.version.note, first.version.source]).toEqual([1, 'Chili KPIs', 'First', 'made']);
    expect(first.book.activeId).toBe(first.version.dashboardId);
    const again = publish(first.book, mine(3), 'Other name', 'Other note', clock);
    expect(again.created).toBe(false);
    expect(again.version.id).toBe(first.version.id);
    expect(again.book.versions).toHaveLength(1);
  });

  it('makes the next number once it changes, of the same dashboard', () => {
    const clock = makeClock();
    const one = publish(emptyBook(), mine(3), '', '', clock);
    const two = publish(one.book, mine(4), '', 'Added one', clock);
    expect(two.created).toBe(true);
    expect([two.version.number, two.version.dashboardId, two.version.name]).toEqual([2, one.version.dashboardId, 'Chili dashboard']);
    expect(latestOf(two.book, two.version.dashboardId)?.id).toBe(two.version.id);
  });

  it('never gives a number again after a version is removed', () => {
    const clock = makeClock();
    let book = publish(emptyBook(), mine(3), '', '', clock).book;
    const two = publish(book, mine(4), '', '', clock);
    book = removeVersion(two.book, two.version.id);
    const next = publish(book, mine(5), '', '', clock);
    expect(next.version.number).toBe(3);
  });

  it('exports a version you went back to as a new, newest one, so others get it', () => {
    const clock = makeClock();
    const one = publish(emptyBook(), mine(3), '', '', clock);
    const two = publish(one.book, mine(4), '', '', clock);
    const back = publish(two.book, mine(3), '', '', clock);
    expect(back.created).toBe(true);
    expect([back.version.number, back.version.note]).toEqual([3, 'Same as version 1']);
  });

  it('exports the built-in suggested dashboard too', () => {
    const made = publish(emptyBook(), starterKpis(), '', '', makeClock('me'));
    expect(made.version.kpis).toHaveLength(15);
  });

  it('refuses to go past the most versions it keeps', () => {
    const clock = makeClock();
    let book = emptyBook();
    for (let n = 1; n <= MAX_VERSIONS; n++) book = publish(book, [extra(`k${n}`, `T${n}`)], '', '', clock).book;
    expect(book.versions).toHaveLength(MAX_VERSIONS);
    expect(() => publish(book, mine(2), '', '', clock)).toThrowError(/Remove some old ones/);
  });
});

describe('comparing dashboards', () => {
  it("ignores the key order and the undefined keys the editor's changes leave", () => {
    const list = mine(3);
    const edited = list.map((kpi) => ({ ...kpi, ...{ box: undefined, yearBox: undefined } }));
    const shuffled = list.map((kpi) => Object.fromEntries(Object.entries(kpi).reverse()) as unknown as ChiliKpi);
    expect(sameKpis(list.map((kpi) => ({ ...kpi, box: undefined })), edited)).toBe(true);
    expect(sameKpis(list, shuffled)).toBe(true);
    expect(sameKpis(list, [{ ...list[0], title: 'Changed' }, ...list.slice(1)])).toBe(false);
  });

  it('finds the version in use through such differences, and copies share nothing', () => {
    const clock = makeClock();
    const made = publish(emptyBook(), mine(3), '', '', clock);
    const edited = mine(3).map((kpi) => ({ ...kpi, box: undefined }));
    expect(inUseVersion(made.book, edited)?.id).toBe(made.version.id);
    expect(inUseVersion(made.book, mine(4))).toBeNull();
    const copy = copyKpis(made.version.kpis);
    copy[0].title = 'Changed';
    expect(made.version.kpis[0].title).not.toBe('Changed');
  });
});

describe('importing a version', () => {
  function sender() {
    const clock = makeClock('sender');
    let book = publish(emptyBook(), mine(3), 'Chili dashboard', 'First', clock).book;
    book = publish(book, mine(4), '', 'Added one', clock).book;
    book = publish(book, mine(5), '', 'Added two', clock).book;
    return book;
  }

  it('brings someone with the built-in dashboard straight to the version, with nothing to keep', () => {
    const sent = sender();
    const got = importVersion(emptyBook(), fileOf(sent, 3), working(starterKpis(), false), makeClock('me'));
    expect(got.outcome).toBe('updated');
    expect(got.kpis).toHaveLength(5);
    expect(got.kept).toBeNull();
    expect(got.book.versions).toHaveLength(1);
    expect(got.book.versions[0].source).toBe('imported');
    expect(got.book.activeId).toBe(got.version.dashboardId);
  });

  it('updates an older dashboard to the newest and keeps the version they had', () => {
    const sent = sender();
    let theirs = importVersion(emptyBook(), fileOf(sent, 1), working(starterKpis(), false), makeClock('me')).book;
    const update = importVersion(theirs, fileOf(sent, 3), working(mine(3)), makeClock('me'));
    expect(update.outcome).toBe('updated');
    expect(update.kpis).toHaveLength(5);
    expect(update.kept).toBeNull(); // what they had is version 1 already
    theirs = update.book;
    expect(theirs.versions.map((v) => v.number).sort()).toEqual([1, 3]);
    expect(inUseVersion(theirs, update.kpis!)?.number).toBe(3);
  });

  it('keeps their own unsaved changes as a version before replacing them', () => {
    const sent = sender();
    const theirs = importVersion(emptyBook(), fileOf(sent, 1), working(starterKpis(), false), makeClock('me')).book;
    const changed = [...mine(3), extra('mine-1', 'Mine')];
    const update = importVersion(theirs, fileOf(sent, 2), working(changed), makeClock('me'));
    expect(update.outcome).toBe('updated');
    expect(update.kept).not.toBeNull();
    expect(update.kept!.kpis.map((kpi) => kpi.title)).toContain('Mine');
    expect(update.kept!.note).toBe('Before updating to version 2');
    // Kept as a dashboard of its own: its number can't clash with the sender's.
    expect(update.kept!.dashboardId).not.toBe(update.version.dashboardId);
    expect([update.kept!.number, update.kept!.name]).toEqual([1, 'Your earlier dashboard']);
    expect(update.book.versions).toHaveLength(3);
    // ... and they can go back to it.
    const back = switchTo(update.book, update.kept!.id, working(update.kpis!), makeClock('me'));
    expect(back.kpis.map((kpi) => kpi.title)).toContain('Mine');
  });

  it('is still brought up to date by the sender\'s later versions after keeping their own changes', () => {
    const sent = sender();
    const first = importVersion(emptyBook(), fileOf(sent, 1), working(starterKpis(), false), makeClock());
    const second = importVersion(first.book, fileOf(sent, 2), working([...mine(3), extra('mine-1', 'Mine')]), makeClock());
    expect(second.kept).not.toBeNull();
    const third = importVersion(second.book, fileOf(sent, 3), working(second.kpis!), makeClock());
    expect(third.outcome).toBe('updated');
    expect(third.kpis).toHaveLength(5);
    expect(third.kept).toBeNull();
  });

  it('keeps changes to a dashboard this Mac made as its next version, then goes on', () => {
    const clock = makeClock();
    const one = publish(emptyBook(), mine(3), '', '', clock);
    const two = switchTo(publish(one.book, mine(4), '', '', clock).book, one.version.id, working([...mine(3), extra('mine-1', 'Mine')]), clock);
    expect(two.kept!.dashboardId).toBe(one.version.dashboardId);
    expect(two.kept!.number).toBe(3);
  });

  it('keeps work from before any version, as the first version of a dashboard of their own', () => {
    const sent = sender();
    const own = [extra('mine-1', 'Mine')];
    const update = importVersion(emptyBook(), fileOf(sent, 1), working(own), makeClock('me'));
    expect(update.kept).not.toBeNull();
    expect(update.kept!.number).toBe(1);
    expect(update.kept!.dashboardId).not.toBe(update.version.dashboardId);
    expect(update.book.versions).toHaveLength(2);
  });

  it('only adds an older version, and leaves the dashboard as it is', () => {
    const sent = sender();
    const theirs = importVersion(emptyBook(), fileOf(sent, 3), working(starterKpis(), false), makeClock('me')).book;
    const old = importVersion(theirs, fileOf(sent, 1), working(mine(5)), makeClock('me'));
    expect(old.outcome).toBe('older');
    expect(old.kpis).toBeNull();
    expect(old.top).toBe(3);
    expect(old.book.versions).toHaveLength(2);
  });

  it('does nothing to a version it already has: importing the same file twice changes nothing', () => {
    const sent = sender();
    const first = importVersion(emptyBook(), fileOf(sent, 3), working(starterKpis(), false), makeClock('me'));
    const again = importVersion(first.book, fileOf(sent, 3), working(first.kpis!), makeClock('me'));
    expect(again.outcome).toBe('up-to-date');
    expect(again.kpis).toBeNull();
    expect(again.book.versions).toHaveLength(1);
    const older = importVersion(importVersion(first.book, fileOf(sent, 1), working(first.kpis!), makeClock('me')).book, fileOf(sent, 1), working(first.kpis!), makeClock('me'));
    expect(older.outcome).toBe('present');
  });

  it('brings the newest back again after they went to an older version', () => {
    const sent = sender();
    let theirs = importVersion(emptyBook(), fileOf(sent, 3), working(starterKpis(), false), makeClock('me'));
    theirs = importVersion(theirs.book, fileOf(sent, 1), working(theirs.kpis!), makeClock('me'));
    const one = theirs.book.versions.find((v) => v.number === 1)!;
    const wentBack = switchTo(theirs.book, one.id, working(mine(5)), makeClock('me'));
    expect(wentBack.kpis).toHaveLength(3);
    const again = importVersion(wentBack.book, fileOf(sent, 3), working(wentBack.kpis), makeClock('me'));
    expect(again.outcome).toBe('updated');
    expect(again.kpis).toHaveLength(5);
  });

  it('never replaces a newer dashboard with an older file, even after the newer version was removed', () => {
    const sent = sender();
    const theirs = importVersion(emptyBook(), fileOf(sent, 2), working(starterKpis(), false), makeClock());
    const v2 = theirs.book.versions[0];
    // The version in use is removed from the list: the dashboard stays, and so does the memory of version 2.
    const removed = removeVersion(theirs.book, v2.id);
    const old = importVersion(removed, fileOf(sent, 1), working(theirs.kpis!), makeClock());
    expect(old.outcome).toBe('older');
    expect(old.kpis).toBeNull();
    expect(old.top).toBe(2);
    // ... also when version 1 is already in the list.
    const withOne = importVersion(removed, fileOf(sent, 1), working(theirs.kpis!), makeClock()).book;
    expect(importVersion(withOne, fileOf(sent, 1), working(theirs.kpis!), makeClock()).outcome).toBe('present');
    expect(importVersion(withOne, fileOf(sent, 1), working(theirs.kpis!), makeClock()).kpis).toBeNull();
    // Version 2 itself comes back as a tie only if it has another id; the same file is the newest again.
    expect(importVersion(withOne, fileOf(sent, 2), working(theirs.kpis!), makeClock()).outcome).toBe('up-to-date');
    // Version 3 still arrives normally.
    const three = importVersion(withOne, fileOf(sent, 3), working(theirs.kpis!), makeClock());
    expect(three.outcome).toBe('updated');
    expect(three.kpis).toHaveLength(5);
  });

  it('says where a kept copy is', () => {
    const sent = sender();
    const first = importVersion(emptyBook(), fileOf(sent, 1), working(starterKpis(), false), makeClock());
    const second = importVersion(first.book, fileOf(sent, 2), working([...mine(3), extra('mine-1', 'Mine')]), makeClock());
    expect(keptWords(second.kept!)).toBe('kept');
    const clock = makeClock();
    const own = publish(emptyBook(), mine(3), '', '', clock);
    const ownKept = switchTo(publish(own.book, mine(4), '', '', clock).book, own.version.id, working([...mine(3), extra('m', 'M')]), clock);
    expect(keptWords(ownKept.kept!)).toBe('kept as version 3');
  });

  it('does not replace the dashboard for the same number with other content (two people edited at once)', () => {
    const sent = sender();
    const theirs = importVersion(emptyBook(), fileOf(sent, 2), working(starterKpis(), false), makeClock('me'));
    const other = { ...fileOf(sent, 2), versionId: 'id-other-2', kpis: mine(2) };
    const clash = importVersion(theirs.book, other, working(theirs.kpis!), makeClock('me'));
    expect(clash.outcome).toBe('added');
    expect(clash.kpis).toBeNull();
    expect(clash.book.versions).toHaveLength(2);
  });

  it('refuses when there is no room, without changing anything', () => {
    const sent = sender();
    let book = emptyBook();
    const clock = makeClock();
    for (let n = 1; n <= MAX_VERSIONS; n++) book = publish(book, [extra(`k${n}`, `T${n}`)], '', '', clock).book;
    expect(() => importVersion(book, fileOf(sent, 1), working(starterKpis(), false), clock)).toThrowError(/Remove some old ones/);
    expect(book.versions).toHaveLength(MAX_VERSIONS);
  });
});

describe('going to a version, the suggested dashboard, and removing', () => {
  it('keeps what is in use as a version before going anywhere, but not what already is one', () => {
    const clock = makeClock();
    const one = publish(emptyBook(), mine(3), '', '', clock);
    const two = publish(one.book, mine(4), '', '', clock);
    const plain = switchTo(two.book, one.version.id, working(mine(4)), clock);
    expect(plain.kept).toBeNull();
    const changed = switchTo(two.book, one.version.id, working(mine(6)), clock);
    expect(changed.kept?.kpis).toHaveLength(6);
    expect(changed.book.versions).toHaveLength(3);
    const suggested = switchToSuggested(two.book, working(mine(6)), clock);
    expect(suggested.kept?.note).toBe('Before going back to the suggested dashboard');
    expect(switchToSuggested(two.book, working(starterKpis(), false), clock).kept).toBeNull();
    expect(() => switchTo(two.book, 'nope', working(mine(3)), clock)).toThrowError(/no longer there/);
  });

  it('removes just that version and leaves the rest', () => {
    const clock = makeClock();
    const one = publish(emptyBook(), mine(3), '', '', clock);
    const two = publish(one.book, mine(4), '', '', clock);
    const rest = removeVersion(two.book, one.version.id);
    expect(rest.versions.map((v) => v.number)).toEqual([2]);
    expect(rest.counters[two.version.dashboardId]).toBe(2);
  });
});

describe('the dashboard file', () => {
  const made = publish(emptyBook(), mine(4), 'Chili dashboard', 'Added things', makeClock('me'));

  it('is read back as it was written', () => {
    const file = parseFile(fileText(made.version));
    expect([file.format, file.number, file.name, file.note, file.versionId, file.dashboardId]).toEqual(['ukmac-dashboard', 1, 'Chili dashboard', 'Added things', made.version.id, made.version.dashboardId]);
    expect(file.kpis).toEqual(parseKpis(stringifyKpis(made.version.kpis)));
    expect(parseFile(new TextEncoder().encode(fileText(made.version)).buffer).number).toBe(1);
    expect(fileName(made.version)).toBe('Chili dashboard v1.ukdash');
    expect(fileName({ name: 'A/B: "x"', number: 2 })).toBe('A-B- -x- v2.ukdash');
  });

  it('is turned away when it is not one of ours, too new, too large, or damaged', () => {
    const text = JSON.parse(fileText(made.version)) as Record<string, unknown>;
    const as = (change: Record<string, unknown>) => JSON.stringify({ ...text, ...change });
    expect(() => parseFile('not json')).toThrowError(/isn't a UKMAC dashboard file/);
    expect(() => parseFile(JSON.stringify({ hello: 1 }))).toThrowError(/isn't a UKMAC dashboard file/);
    expect(() => parseFile(as({ format: 'something-else' }))).toThrowError(/isn't a UKMAC dashboard file/);
    expect(() => parseFile(as({ formatVersion: 2 }))).toThrowError(/newer version of UKMAC/);
    expect(() => parseFile('x'.repeat(MAX_FILE_BYTES + 1))).toThrowError(/too large/);
    expect(() => parseFile(new ArrayBuffer(MAX_FILE_BYTES + 1))).toThrowError(/too large/);
    for (const bad of [{ number: 0 }, { number: 1.5 }, { dashboardId: 'x' }, { versionId: '../../etc' }, { createdAt: 'yesterday' }, { note: 'n'.repeat(301) }, { kpis: 'x' }, { kpis: [{ title: 'bad' }] }, { kpis: [...(text['kpis'] as unknown[]), { title: 'bad' }] }]) {
      expect(() => parseFile(as(bad)), JSON.stringify(bad).slice(0, 40)).toThrowError(/damaged/);
    }
  });
});

describe('the saved book', () => {
  it('is read back as it was, and one that cannot be read is an empty book', () => {
    const clock = makeClock();
    let book = publish(emptyBook(), mine(3), '', 'One', clock).book;
    const two = publish(book, mine(4), '', 'Two', clock);
    book = removeVersion(two.book, two.version.id);
    expect(parseBook(stringifyBook(book))).toEqual(book);
    expect(parseBook(null)).toEqual(emptyBook());
    expect(parseBook('{nope')).toEqual(emptyBook());
    expect(parseBook('{"versions":3}')).toEqual(emptyBook());
  });

  it('leaves out a version it cannot read, and never forgets a number that was used', () => {
    const made = publish(emptyBook(), mine(3), '', '', makeClock('me'));
    const raw = JSON.parse(stringifyBook(made.book)) as { versions: unknown[]; counters: Record<string, number> };
    raw.versions.push({ id: 'x', dashboardId: 'y' }, { ...(raw.versions[0] as object), id: 'id-dup-1', number: 7 });
    raw.counters = {};
    const read = parseBook(JSON.stringify(raw));
    expect(read.versions.map((v) => v.number)).toEqual([1, 7]);
    expect(read.counters[made.version.dashboardId]).toBe(7);
  });
});

describe('versionDays (the timeline)', () => {
  const at = (iso: string): DashboardVersion => ({ id: iso, dashboardId: 'd', name: 'n', number: 1, note: '', createdAt: iso, source: 'made', kpis: [] });
  const noon = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 0, 0).toISOString();
  const now = new Date(2026, 10, 9, 15, 0, 0);

  it('groups by local day, newest first, and names today and yesterday', () => {
    const list = [at(noon(2026, 11, 9, 14)), at(noon(2026, 11, 9, 9)), at(noon(2026, 11, 8)), at(noon(2026, 11, 2))];
    const days = versionDays(list, now);
    expect(days.map((day) => [day.label, day.versions.length])).toEqual([['Today', 2], ['Yesterday', 1], ['Mon 2 Nov 2026', 1]]);
    expect(days.map((day) => day.key)).toEqual(['2026-11-09', '2026-11-08', '2026-11-02']);
  });

  it('keeps a day together only while its versions are next to each other', () => {
    const days = versionDays([at(noon(2026, 11, 9)), at(noon(2026, 11, 8)), at(noon(2026, 11, 9, 1))], now);
    expect(days.map((day) => day.key)).toEqual(['2026-11-09', '2026-11-08', '2026-11-09']);
  });

  it('says so when a time cannot be read, and is empty for no versions', () => {
    expect(versionDays([at('not a time')], now)).toEqual([{ key: '', label: 'Unknown date', versions: [expect.anything()] }]);
    expect(versionDays([], now)).toEqual([]);
  });
});
