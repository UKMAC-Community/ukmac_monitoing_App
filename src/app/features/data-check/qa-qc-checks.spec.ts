import type { Column, Cells } from '@core/models';
import { makeSheet } from '@shared/testing/test-helpers';
import { qaqcChecks, type CheckLine, type TableCheck } from './qa-qc-checks';

const col = (key: string, name: string, type: Column['type'] = 'text', extra: Partial<Column> = {}) => ({ key, name, type, ...extra }) as Column;

const TODAY = '2026-11-18';

const plants = (rows: Cells[]) =>
  makeSheet(
    4,
    'Plant Progress',
    [col('c1', 'Zone plot', 'link'), col('c2', 'Record date', 'date'), col('c4', 'Plant count', 'number'), col('c9', 'Replant count', 'number'), col('c10', 'Dead plant', 'number')],
    rows,
    'zone-records',
  );
const harvest = (rows: Cells[]) =>
  makeSheet(10, 'Harvest', [col('c5', 'Zone plot', 'link'), col('c6', 'Chili type', 'choice'), col('c7', 'Date harvest', 'date'), col('c8', 'Harvest yield', 'number')], rows, 'harvest');
const fertigation = (rows: Cells[]) =>
  makeSheet(7, 'Fertigation', [col('c1', 'Date', 'date'), col('c2', 'Zone', 'link'), col('c5', 'Application'), col('c7', 'Quantity', 'number')], rows, 'fertigation');
const pruning = (rows: Cells[]) =>
  makeSheet(
    8,
    'Pruning',
    [col('c2', 'Zone', 'link'), col('c7', 'Round name'), col('c9', 'Applicable', 'yesno'), col('c10', 'Planned date', 'date'), col('c11', 'Date', 'date', { aliases: ['actual_date'] })],
    rows,
    'pruning',
  );
// QA/QC's columns, the farm sheet's way: a plant total and the 1st, 2nd … harvest in one section, then the same names again lower down.
const qaqc = (rows: Cells[]) =>
  makeSheet(
    11,
    'QA/QC Management',
    [
      col('c2', 'Zone', 'link'),
      col('c10', 'Healthy', 'number'),
      col('c11', 'Medium', 'number'),
      col('c12', 'Wilt', 'number'),
      col('c15', 'Live plant', 'number'),
      col('c16', 'Dead plant', 'number'),
      col('c62', 'Total plant', 'number'),
      col('c269', '1st Date', 'date'),
      col('c270', '1st Harvest', 'number'),
      col('c271', '2nd Date', 'date'),
      col('c272', '2nd Harvest', 'number'),
      col('c71', 'Total plant', 'number'),
      col('c323', '1st Date', 'date'),
      col('c324', '1st Harvest', 'number'),
    ],
    rows,
    'qa-qc-management',
  );

const line = (boxes: TableCheck[], table: string, id: string) => boxes.find((box) => box.title === table)!.lines.find((item) => item.id === id)!;
const texts = (item: CheckLine) => item.findings.map((finding) => `${finding.plot}: ${finding.text}`);
const said = (item: CheckLine) => (item.cannot ? `can't: ${item.cannot}` : item.findings.length ? item.bad : item.good);

describe('qaqcChecks', () => {
  it('makes a box for each table of the farm’s work, each check under what it is checked with', () => {
    const boxes = qaqcChecks(
      [
        plants([{ c1: 'A1', c2: '2026-06-08', c4: '100' }]),
        fertigation([]),
        pruning([]),
        harvest([]),
        qaqc([]),
      ],
      TODAY,
    );
    expect(boxes.map((box) => [box.title, box.lines.map((item) => `${item.against}: ${item.id}`)])).toEqual([
      ['Plant Progress', ['QA/QC Management: plants', 'QA/QC Management: dead', "today's date: future"]],
      ['Fertigation', ['Plant Progress: before-planting', 'its own rounds: skipped', "today's date: future"]],
      ['Pruning', ['Plant Progress: before-planting', 'its own rounds: skipped', 'its planned dates: late', "today's date: future"]],
      ['Harvest', ['Plant Progress: no-planting', 'Plant Progress: too-soon', 'QA/QC Management: harvest', "today's date: future"]],
    ]);
    // Nothing to check yet says so, and counts as no problem.
    expect(said(line(boxes, 'Harvest', 'future'))).toBe("can't: No dates in it yet");
    expect(boxes.every((box) => box.problems === 0)).toBe(true);
  });

  it('finds work dated after today, a plot at a time, and work done before the plot was planted', () => {
    const boxes = qaqcChecks(
      [
        plants([{ c1: 'A1', c2: '2026-06-08', c4: '100' }]),
        harvest([
          { c5: 'A1', c7: '2026-08-22', c8: '10' },
          { c5: 'A1', c7: '2026-12-01', c8: '12' },
          { c5: 'A1', c7: '2027-01-10', c8: '9' },
        ]),
        fertigation([{ c1: '2026-06-01', c2: 'A1', c5: '1st Application' }]),
      ],
      TODAY,
    );
    const future = line(boxes, 'Harvest', 'future');
    expect(texts(future)).toEqual(['A1: 2 records dated after today, the last on 10/01/2027']);
    expect(future.checked).toBe(3);
    expect(said(future)).toBe('1 plot has a date after today');
    expect(said(line(boxes, 'Plant Progress', 'future'))).toBe('No date after today');
    expect(texts(line(boxes, 'Fertigation', 'before-planting'))).toEqual(['A1: 1st Application on 01/06/2026, but planted on 08/06/2026']);
    expect(boxes.find((box) => box.title === 'Harvest')!.problems).toBe(1);
  });

  it('finds a harvest too soon after planting, and a harvested plot never planted', () => {
    const boxes = qaqcChecks(
      [
        plants([
          { c1: 'A1', c2: '2026-06-08', c4: '100' },
          { c1: 'A2', c2: '2026-06-08', c4: '100' },
        ]),
        harvest([
          { c5: 'A1', c7: '2026-07-01', c8: '5' },
          { c5: 'A2', c7: '2026-08-22', c8: '10' },
          { c5: 'B37', c7: '2026-09-01', c8: '1,200.5' },
          { c5: 'B37', c7: '2026-09-15', c8: '30' },
        ]),
      ],
      TODAY,
    );
    expect(texts(line(boxes, 'Harvest', 'too-soon'))).toEqual(['A1: First harvest 01/07/2026, only 23 days after planting (08/06/2026)']);
    const never = line(boxes, 'Harvest', 'no-planting');
    expect(texts(never)).toEqual(['B37: 2 harvests (1,230.5 kg), but no planting in Plant Progress']);
    expect(said(never)).toBe('1 plot harvested but never planted');
  });

  it('finds a round with no date while a later one is done, and a pruning past its plan (not one already skipped)', () => {
    const boxes = qaqcChecks(
      [
        fertigation([
          { c1: '2026-06-15', c2: 'A1', c5: '1st Application' },
          { c1: '', c2: 'A1', c5: '2nd Application' },
          { c1: '2026-07-15', c2: 'A1', c5: '3rd Application' },
          // Not come to yet: nothing after it is done.
          { c1: '', c2: 'A1', c5: '4th Application' },
        ]),
        pruning([
          { c2: 'A12', c7: '1st Pruning', c9: 'true', c10: '2026-07-12', c11: '' },
          { c2: 'A12', c7: '2nd Pruning', c9: 'true', c10: '2026-08-12', c11: '2026-08-12' },
          { c2: 'B8', c7: '1st Pruning', c9: 'true', c10: '2026-10-22', c11: '' },
          // Not to be done, or not due yet.
          { c2: 'A5', c7: '3rd Pruning', c9: 'false', c10: '2026-09-01', c11: '' },
          { c2: 'A6', c7: '1st Pruning', c9: 'true', c10: '2026-12-01', c11: '' },
        ]),
      ],
      TODAY,
    );
    expect(texts(line(boxes, 'Fertigation', 'skipped'))).toEqual(['A1: 2nd Application not done, but the 3rd Application is (15/07/2026)']);
    expect(texts(line(boxes, 'Pruning', 'skipped'))).toEqual(['A12: 1st Pruning not done, but the 2nd Pruning is (12/08/2026)']);
    const late = line(boxes, 'Pruning', 'late');
    expect(texts(late)).toEqual(['B8: 1st Pruning planned for 22/10/2026, 27 days ago, not done']);
    expect(late.checked).toBe(3);
    expect(said(late)).toBe('1 round is past the planned date and not done');
  });

  it('compares the plants left with QA/QC’s Total plant, and says when a value can’t be read', () => {
    const boxes = qaqcChecks(
      [
        plants([
          { c1: 'A1', c2: '2026-06-08', c4: '1615', c10: '73', c9: '53' },
          { c1: 'A2', c2: '2026-06-08', c4: '1558', c10: '29', c9: '' },
          { c1: 'A3', c2: '2026-06-08', c4: '1592', c10: '79', c9: '2026-06-19' },
        ]),
        qaqc([
          { c2: 'A1', c62: '1595' },
          { c2: 'A2', c62: '1500' },
          { c2: 'A3', c62: '1580' },
        ]),
      ],
      TODAY,
    );
    const plantsLine = line(boxes, 'Plant Progress', 'plants');
    expect(plantsLine.checked).toBe(3);
    expect(plantsLine.same).toBe(false);
    expect(texts(plantsLine)).toEqual([
      'A2: 1,558 planted − 29 dead + 0 replanted = 1,529, but QA/QC Management says 1,500',
      'A3: Can\'t compare: Replant count is "2026-06-19", not a number',
    ]);
    expect(plantsLine.findings[1].unreadable).toBe(true);
    expect(said(plantsLine)).toBe("1 plot differs from QA/QC Management's Total plant · 1 plot can't be compared: Replant count isn't a number");
  });

  it('compares each QA/QC harvest with the Harvest table’s kg that day (ripe and unripe together), and says when every one is the same', () => {
    const sheets = (secondKg: string) => [
      harvest([
        { c5: 'A1', c6: 'ripe', c7: '2026-08-22', c8: '117.9' },
        { c5: 'A1', c6: 'unripe', c7: '2026-08-22', c8: '28' },
        { c5: 'A1', c6: 'ripe', c7: '2026-09-06', c8: '259.5' },
      ]),
      qaqc([{ c2: 'A1', c269: '2026-08-22', c270: '145.9', c271: '2026-09-06', c272: secondKg, c323: '2026-08-22', c324: '145.9' }]),
    ];
    const same = line(qaqcChecks(sheets('259.5'), TODAY), 'Harvest', 'harvest');
    expect(same.checked).toBe(2);
    expect(same.findings).toEqual([]);
    expect(same.same).toBe(true);
    expect(said(same)).toBe('Same kg as QA/QC Management on every harvest day');

    const off = line(qaqcChecks(sheets('300'), TODAY), 'Harvest', 'harvest');
    expect(texts(off)).toEqual(['A1: 06/09/2026: 259.5 kg here, but 300 kg in QA/QC Management']);
    expect(off.same).toBe(false);

    const missing = line(qaqcChecks([harvest([]), qaqc([{ c2: 'A9', c269: '2026-10-31', c270: '133.5' }])], TODAY), 'Harvest', 'harvest');
    expect(texts(missing)).toEqual(['A9: 31/10/2026: QA/QC Management has 133.5 kg, but no harvest here that day']);
  });

  it('finds a big gap between the dead plants reported and QA/QC’s sample, the sample being the plants looked at when planted', () => {
    const boxes = qaqcChecks(
      [
        plants([
          { c1: 'A1', c2: '2026-06-08', c4: '1615', c10: '73' },
          { c1: 'A2', c2: '2026-06-08', c4: '1000', c10: '10' },
        ]),
        qaqc([
          { c2: 'A1', c10: '15', c11: '4', c12: '1', c15: '19' },
          { c2: 'A2', c15: '14', c16: '6' },
        ]),
      ],
      TODAY,
    );
    const dead = line(boxes, 'Plant Progress', 'dead');
    expect(dead.checked).toBe(2);
    expect(texts(dead)).toEqual(["A2: 1% dead here (10 of 1,000), but 30% in QA/QC Management's sample (6 of 20)"]);
  });
});
