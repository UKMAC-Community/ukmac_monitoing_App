import type { Cells, Column, Mac, Row, SheetWithRows } from './core/models';

let nextRow = 1;

export function makeSheet(
  sheetId: number,
  title: string,
  columns: Column[],
  rows: Cells[] = [],
  templateKey: string | null = null,
): SheetWithRows {
  return {
    sheetId,
    macId: 1,
    title,
    heading: 'Test',
    icon: null,
    about: '',
    templateKey,
    columns,
    dashboard: null,
    displayOrder: sheetId,
    rowCount: rows.length,
    createdAt: '2026-11-03 00:00:00',
    updatedAt: '2026-11-03 00:00:00',
    rows: rows.map((data, index): Row => ({
      rowId: nextRow++,
      sheetId,
      position: index + 1,
      data,
      importId: null,
      createdAt: '2026-11-03 00:00:00',
      updatedAt: '2026-11-03 00:00:00',
    })),
  };
}

export function makeMac(extra: Partial<Mac> = {}): Mac {
  return {
    macId: 1,
    macUuid: 'u-1',
    macName: 'Battambang - Tmor Kol',
    macCode: 'BTB-1022',
    macLocation: 'Battambang',
    latitude: 13.0957,
    longitude: 103.2022,
    startDate: '2026-06-01',
    endDate: null,
    crop: 'chili',
    note: null,
    createdAt: '2026-11-03 00:00:00',
    updatedAt: '2026-11-03 00:00:00',
    sheetCount: 0,
    rowCount: 0,
    ...extra,
  };
}

/** The QA/QC table's first stages, as the chili template makes them (src-tauri/src/template.rs). */
export function qaQcColumns(): Column[] {
  const s1 = '1 · Transplant (0 DAT)';
  const s2 = '2 · Establishment (7 DAT)';
  return [
    { key: 'c1', name: 'Date', type: 'date', required: true },
    { key: 'c2', name: 'Zone', type: 'link', source: "'Zones'[Plot]", required: true },
    { key: 'c3', name: 'Plant batch', type: 'text', box: 'QC record' },
    { key: 'c4', name: 'Date', type: 'formula', box: s1, formula: '=IF([Date]="","",IF([Date]+0>TODAY()+3,"",[Date]+0))' },
    { key: 'c5', name: 'Days after transplant', type: 'formula', box: s1, formula: `=IF([${s1} › Date]="","",DAYS([${s1} › Date],[Date]))` },
    { key: 'c6', name: 'Disease', type: 'number', box: s1, group: 'Seedling Leaf Stage (No.)' },
    { key: 'c7', name: 'Date', type: 'formula', box: s2, formula: '=IF([Date]="","",IF([Date]+7>TODAY()+3,"",[Date]+7))' },
    { key: 'c8', name: 'Days after transplant', type: 'formula', box: s2, formula: `=IF([${s2} › Date]="","",DAYS([${s2} › Date],[Date]))` },
    { key: 'c9', name: 'Live plant', type: 'number', box: s2, group: 'Plant Survival (No.)' },
    { key: 'c10', name: 'Dead plant', type: 'formula', box: s2, group: 'Plant Survival (No.)', formula: '=IF([Live plant]="","",20-[Live plant])' },
  ];
}
