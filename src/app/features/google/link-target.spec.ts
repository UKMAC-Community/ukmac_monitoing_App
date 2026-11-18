import type { GoogleLink } from '@core/models';
import { spreadsheetOf, tabNamed } from './link-target';

const link = (sheetId: number, macId: number, spreadsheetId: string, tabTitle = 'Tab'): GoogleLink => ({
  linkId: sheetId,
  sheetId,
  macId,
  macName: 'MAC',
  tableTitle: `Table ${sheetId}`,
  spreadsheetId,
  spreadsheetTitle: `File ${spreadsheetId}`,
  tabTitle,
  headerMap: {},
  lastSyncedAt: null,
  lastRowCount: 0,
  layout: null,
});

describe('spreadsheetOf', () => {
  it("is the table's own Google Sheet when it has a link", () => {
    expect(spreadsheetOf([link(4, 1, 'a'), link(11, 1, 'b'), link(10, 1, 'b')], 4, 1)).toEqual({ spreadsheetId: 'a', spreadsheetTitle: 'File a' });
  });

  it("is the one most of the MAC's other tables read when it has none, never another MAC's", () => {
    const links = [link(4, 1, 'a'), link(11, 1, 'b'), link(10, 1, 'b'), link(20, 2, 'c'), link(21, 2, 'c'), link(22, 2, 'c')];
    expect(spreadsheetOf(links, 1, 1)).toEqual({ spreadsheetId: 'b', spreadsheetTitle: 'File b' });
    expect(spreadsheetOf(links, 30, 3)).toBeNull();
    expect(spreadsheetOf([], 1, 1)).toBeNull();
  });
});

describe('tabNamed', () => {
  const tabs = [{ name: 'QA QC' }, { name: 'Plant Progress' }, { name: 'qa qc' }];

  it('finds the tab with exactly that name first, then one that differs only in capitals or spaces', () => {
    expect(tabNamed(tabs, 'qa qc')).toBe(tabs[2]);
    expect(tabNamed(tabs, 'QA QC')).toBe(tabs[0]);
    expect(tabNamed(tabs, '  plant   progress ')).toBe(tabs[1]);
  });

  it('finds nothing for a name no tab has, or nothing typed', () => {
    expect(tabNamed(tabs, 'Harvest')).toBeNull();
    expect(tabNamed(tabs, 'QAQC')).toBeNull();
    expect(tabNamed(tabs, '   ')).toBeNull();
  });
});
