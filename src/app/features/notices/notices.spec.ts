import type { GoogleLink, SheetWithRows } from '@core/models';
import { noticeCount, notices, type NoticeInput } from './notices';

const base: NoticeInput = {
  macId: 1,
  sheets: [],
  links: [],
  failures: new Map(),
  update: { offered: null, installed: null, screens: null },
  today: '2026-11-20',
  now: Date.UTC(2026, 10, 20, 12),
};

const sheet = (sheetId: number, title: string) => ({ sheetId, macId: 1, title, templateKey: null, columns: [], rows: [] }) as unknown as SheetWithRows;
const link = (sheetId: number, lastSyncedAt: string | null, origin: string | null = null) => ({ sheetId, macId: 1, lastSyncedAt, origin }) as unknown as GoogleLink;

describe('notices', () => {
  it('says nothing when nothing needs attention', () => {
    expect(notices(base)).toEqual([]);
    expect(noticeCount([])).toBe(0);
  });

  it('tells an update waiting, even with no MAC open', () => {
    const list = notices({ ...base, macId: null, update: { offered: '0.4.0', installed: null, screens: null } });
    expect(list.map((item) => item.id)).toEqual(['update']);
    expect(list[0].title).toContain('0.4.0');
    expect(noticeCount(list)).toBe(1);
  });

  it('lists new screens without counting them', () => {
    const list = notices({ ...base, update: { offered: null, installed: null, screens: '0.4.1' } });
    expect(list).toHaveLength(1);
    expect(noticeCount(list)).toBe(0);
  });

  it('names the tables a Google read failed for, and why', () => {
    const list = notices({ ...base, sheets: [sheet(5, 'Harvest')], failures: new Map([[5, 'No access']]) });
    expect(list[0]).toMatchObject({ id: 'sync-failed', tone: 'danger' });
    expect(list[0].detail).toBe('Harvest (No access)');
  });

  it('tells tables not read for over a day, not the ones read lately, nor the ones the app writes to', () => {
    const list = notices({
      ...base,
      sheets: [sheet(1, 'Batch'), sheet(2, 'Pruning'), sheet(3, 'Harvest'), sheet(4, 'Zones')],
      links: [link(1, '2026-11-20 08:00:00'), link(2, '2026-11-18 08:00:00'), link(3, null), link(4, '2026-11-01 00:00:00', 'app')],
    });
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('sync-old');
    expect(list[0].title).toBe('2 tables not read from Google for over a day');
    expect(list[0].detail).toBe('Pruning, Harvest');
  });

  it('keeps a failed table out of the "not read" list so it is told once', () => {
    const list = notices({ ...base, sheets: [sheet(2, 'Pruning')], links: [link(2, null)], failures: new Map([[2, 'Offline']]) });
    expect(list.map((item) => item.id)).toEqual(['sync-failed']);
  });
});
