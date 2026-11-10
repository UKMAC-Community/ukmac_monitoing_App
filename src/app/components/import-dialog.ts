import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';

import { errorText } from '../core/api';
import type { Column, SheetWithRows } from '../core/models';
import { Toasts } from '../core/toast';
import { WorkbookStore } from '../core/workbook-store';
import { readImport, type ImportPreview } from '../excel/excel-template';
import { plainLayout, sameLayout, type FileLayout } from '../excel/file-layout';
import { columnLabel, displayCell, isEntryColumn, normalizeHeader, parseLinkSource } from '../sheet/columns';
import { ColumnMatcher } from './column-matcher';
import { ImportLayout } from './import-layout';
import { Icon } from './icon';
import { Modal } from './modal';

export interface ImportFile {
  fileName: string;
  bytes: ArrayBuffer;
  /** Which tab of the workbook to read (a Google Sheet's); else the template's Data sheet or the first. */
  tab?: string;
  /** The row the headers are on, when the reader of the source already found it (a Google tab's): where Sync would look for them. */
  headerRow?: number;
  /** Where the names and the data are, when they're known (the layout a connected table was read with): the wizard starts from it. */
  layout?: FileLayout;
  /** The step the wizard opens on (2: the matching, when the person only wants to see how the columns connect). */
  startStep?: 1 | 2;
  /** The matches the table already has (its column's key → the file's column), when it's being imported again: the wizard starts from them. */
  matches?: Record<string, number>;
  /** A Google Sheet tab it came from, which the table can stay connected to once imported (Sync reads it again). */
  connect?: { spreadsheetId: string; spreadsheetTitle: string; tabTitle: string };
}

/** What an import did: the rows brought in, and, for a tab the table is to stay connected to, what each of its headers fills. */
export interface ImportDone {
  count: number;
  headerMap: Record<string, string> | null;
  /** For a connected tab: where its names and data are, when that isn't where Sync would look anyway (else null). */
  layout: FileLayout | null;
}

/** An Excel file's rows, shown before they're saved: what matched, what didn't, every problem — then imported in one go. */
@Component({
  selector: 'app-import-dialog',
  imports: [Modal, Icon, ColumnMatcher, ImportLayout],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal [open]="!!file()" [title]="file()?.connect ? 'Import from Google Sheets' : 'Import Excel'" [subtitle]="sheet().title" size="full" (closed)="closed.emit()">
      @if (reading()) {
        <p class="muted">Reading {{ file()?.fileName }}…</p>
      } @else if (failure()) {
        <div class="alert-box error"><app-icon name="alert" /> {{ failure() }}</div>
      } @else if (preview(); as p) {
        <div class="wizard">
          <nav class="steps" aria-label="Steps">
            @for (item of stepNames; track item.n) {
              <button
                type="button"
                class="stp"
                [class.is-on]="step() === item.n"
                [class.is-done]="step() > item.n"
                [disabled]="item.n > step()"
                [attr.aria-current]="step() === item.n ? 'step' : null"
                (click)="step.set(item.n)"
              >
                <span class="num">
                  @if (step() > item.n) {
                    <app-icon name="check" [size]="12" />
                  } @else {
                    {{ item.n }}
                  }
                </span>
                {{ item.label }}
              </button>
              @if (!$last) {
                <span class="join"></span>
              }
            }
          </nav>

          <div class="stage">
            @switch (step()) {
              @case (1) {
                <p class="lead">
                  <span>Say which rows hold the <strong>column names</strong> and where the <strong>raw data</strong> starts.</span>
                  <span class="file muted"><app-icon name="file" /> {{ p.fileName }}{{ p.sheetName ? ' › ' + p.sheetName : '' }}</span>
                </p>
                <app-import-layout
                  class="grow"
                  [peek]="p.peek"
                  [layout]="p.layout"
                  [detected]="p.detected"
                  [columns]="p.fileColumns.length"
                  [rows]="p.rows.length"
                  (layoutChange)="relayout($event)"
                />
              }

              @case (2) {
                <p class="lead">
                  <span>Say which column of the file fills each column of <strong>{{ sheet().title }}</strong>.</span>
                  <span class="file muted"><app-icon name="file" /> {{ p.fileName }} · {{ layoutNote(p.layout) }}</span>
                </p>
                @if (p.fileColumns.length) {
                  <app-column-matcher
                    class="grow"
                    [fileColumns]="p.fileColumns"
                    [targets]="targets()"
                    [mapping]="mapping()"
                    [tableTitle]="sheet().title"
                    (mappingChange)="remap($event)"
                    (auto)="remap(null)"
                  />
                }
                @if (p.repeated.length) {
                  <div class="alert-box info">
                    <app-icon name="alert" />
                    <div>
                      The file has {{ repeatedNames(p) }} more than once. The first fills the table's column and the others are left out. If another one should, drag it onto the column.
                    </div>
                  </div>
                }
                @if (p.issues.length) {
                  <div class="alert-box error">
                    <app-icon name="alert" />
                    <div>
                      <strong>This file can't be imported yet:</strong>
                      <ul>
                        @for (issue of p.issues; track $index) {
                          <li>{{ issue }}</li>
                        }
                      </ul>
                    </div>
                  </div>
                }
              }

              @case (3) {
                <div class="summary">
                  <div class="stat">
                    <span class="big">{{ p.rows.length }}</span>
                    <span class="muted">rows in “{{ p.sheetName }}”</span>
                  </div>
                  <div class="stat">
                    <span class="big ok">{{ p.rows.length - p.errorRows }}</span>
                    <span class="muted">ready</span>
                  </div>
                  <div class="stat">
                    <span class="big" [class.bad]="p.errorRows">{{ p.errorRows }}</span>
                    <span class="muted">with problems</span>
                  </div>
                </div>

                @if (p.missingRequired.length) {
                  <div class="alert-box warning">
                    <app-icon name="alert" />
                    <div>
                      <strong>No column of the file fills {{ requiredNames(p) }}, which every row needs.</strong>
                      Those cells are empty (red). Go back to match {{ p.missingRequired.length === 1 ? 'it' : 'them' }}, or import the rows anyway and fill {{ p.missingRequired.length === 1 ? 'it' : 'them' }} in after.
                    </div>
                  </div>
                }

                @for (miss of p.missingLinks; track miss.column.key) {
                  <div class="alert-box warning">
                    <app-icon name="info" />
                    <div class="grow">
                      <strong>{{ miss.values.length }} {{ miss.header }} value{{ miss.values.length === 1 ? '' : 's' }} not in {{ linkTarget(miss.column) }} yet:</strong>
                      {{ miss.values.slice(0, 12).join(', ') }}{{ miss.values.length > 12 ? '…' : '' }}
                    </div>
                    @if (canAddLinks(miss.column)) {
                      <button type="button" class="btn btn-secondary btn-sm" [disabled]="busy()" (click)="addLinks(miss.column, miss.values)">
                        <app-icon name="plus" /> Add them to {{ linkTable(miss.column) }}
                      </button>
                    }
                  </div>
                }

                @if (p.workedOut.length) {
                  <div class="alert-box info">
                    <app-icon name="info" />
                    <div>Worked out by the app (the file's values aren't used): {{ p.workedOut.join(', ') }}.</div>
                  </div>
                }

                @if (problems().length) {
                  <details class="problems">
                    <summary>{{ problemCount() }} problem{{ problemCount() === 1 ? '' : 's' }} in {{ listedErrorRows() }} row{{ listedErrorRows() === 1 ? '' : 's' }}</summary>
                    <ul>
                      @for (problem of problems(); track $index) {
                        <li><strong>Row {{ problem.row }}</strong> · {{ problem.header }}: {{ problem.message }}</li>
                      }
                      @if (problemCount() > problems().length) {
                        <li class="muted">and {{ problemCount() - problems().length }} more…</li>
                      }
                    </ul>
                  </details>
                }

                @if (p.rows.length) {
                  <div class="table-wrap grow">
                    <table class="preview">
                      <thead>
                        <tr>
                          <th>Row</th>
                          @for (head of previewHeads(); track head.key) {
                            <th [title]="head.title" [class.is-missing]="head.missing">{{ head.header }}</th>
                          }
                        </tr>
                      </thead>
                      <tbody>
                        @for (row of p.rows.slice(0, 100); track row.rowNumber) {
                          <tr [class.has-error]="row.errors.length">
                            <td class="rownum">{{ row.rowNumber }}</td>
                            @for (head of previewHeads(); track head.key) {
                              <td [class.bad-cell]="hasError(row.errors, head.key)" [attr.title]="errorFor(row.errors, head.key)">
                                {{ show(head.column, row.cells[head.key]) }}
                              </td>
                            }
                          </tr>
                        }
                      </tbody>
                    </table>
                    @if (p.rows.length > 100) {
                      <p class="muted more">The first 100 of {{ p.rows.length }} rows.</p>
                    }
                  </div>
                }
              }

              @case (4) {
                <div class="final">
                  <h3>Ready to import into {{ sheet().title }}</h3>
                  <p class="muted">
                    {{ p.rows.length - p.errorRows }} row{{ p.rows.length - p.errorRows === 1 ? ' is' : 's are' }} ready{{ p.errorRows ? ', ' + p.errorRows + ' with problems' : '' }}.
                  </p>

                  <div class="choices" role="radiogroup" aria-label="Where the rows go">
                    <label class="choice" [class.is-on]="mode() === 'append'">
                      <input type="radio" name="mode" [checked]="mode() === 'append'" (change)="mode.set('append')" />
                      <span>
                        <strong>Add after the rows there now</strong>
                        <small class="muted">{{ sheet().rows.length }} row{{ sheet().rows.length === 1 ? '' : 's' }} stay in the table.</small>
                      </span>
                    </label>
                    <label class="choice" [class.is-on]="mode() === 'replace'">
                      <input type="radio" name="mode" [checked]="mode() === 'replace'" (change)="mode.set('replace')" />
                      <span>
                        <strong>Replace them</strong>
                        <small class="muted">{{ sheet().rows.length ? 'The ' + sheet().rows.length + ' rows there now are deleted.' : 'The table is empty now, so nothing is deleted.' }}</small>
                      </span>
                    </label>
                  </div>

                  @if (file()?.connect; as connect) {
                    <label class="choice" [class.is-on]="keepConnected()">
                      <input type="checkbox" class="checkbox" [checked]="keepConnected()" (change)="keepConnected.set($any($event.target).checked)" />
                      <span>
                        <strong>Keep this table connected to “{{ connect.spreadsheetTitle }} › {{ connect.tabTitle }}”</strong>
                        <small class="muted">Sync on the table's page then reads the tab again, with these matches, and replaces the table's rows with the tab's.</small>
                      </span>
                    </label>
                  }

                  @if (p.errorRows) {
                    <label class="choice" [class.is-on]="includeProblems()">
                      <input type="checkbox" class="checkbox" [checked]="includeProblems()" (change)="includeProblems.set($any($event.target).checked)" />
                      <span>
                        <strong>Import the {{ p.errorRows === 1 ? 'row' : p.errorRows + ' rows' }} with problems too</strong>
                        <small class="muted">They're marked red in the table, to fix.</small>
                      </span>
                    </label>
                  }
                </div>
              }
            }
          </div>
        </div>
      }

      <ng-container footer>
        @if (preview() && !reading() && step() > 1) {
          <button type="button" class="btn btn-secondary back" (click)="step.set(step() === 4 ? 3 : step() === 3 ? 2 : 1)"><app-icon name="arrow-left" /> Back</button>
        }
        @if (remapping()) {
          <span class="updating muted"><span class="spinner-sm"></span> Updating the preview…</span>
        }
        <button type="button" class="btn btn-secondary" (click)="closed.emit()">Cancel</button>
        @if (preview(); as p) {
          @if (step() === 1) {
            <button type="button" class="btn btn-primary" [disabled]="!p.fileColumns.length || remapping()" (click)="step.set(2)">
              Next: match columns <app-icon name="arrow-right" />
            </button>
          } @else if (step() === 2) {
            <button type="button" class="btn btn-primary" [disabled]="!!p.issues.length || !p.matched.length || remapping()" (click)="step.set(3)">
              Next: check the rows <app-icon name="arrow-right" />
            </button>
          } @else if (step() === 3) {
            <button type="button" class="btn btn-primary" [disabled]="!p.rows.length" (click)="step.set(4)">
              Next: import <app-icon name="arrow-right" />
            </button>
          } @else {
            <button type="button" class="btn btn-primary" [disabled]="!importCount() || busy() || remapping()" (click)="run()">
              <app-icon name="upload" /> Import {{ importCount() }} row{{ importCount() === 1 ? '' : 's' }}
            </button>
          }
        }
      </ng-container>
    </app-modal>
  `,
  styles: `
    .wizard { display: flex; flex-direction: column; gap: 16px; height: 100%; min-height: 0; }
    .stage { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 10px; }
    .grow { flex: 1; min-height: 0; }
    .steps { display: flex; align-items: center; gap: 10px; flex: none; }
    .stp { display: inline-flex; align-items: center; gap: 8px; padding: 0; border: 0; background: none; color: var(--text-muted); font: inherit; font-size: 0.875rem; font-weight: 500; cursor: default; }
    .stp:not(:disabled) { cursor: pointer; }
    .stp .num { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; border: var(--hairline) solid var(--border-strong); font-size: 0.75rem; font-weight: 600; font-variant-numeric: tabular-nums; }
    .stp.is-on { color: var(--text); }
    .stp.is-on .num { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
    .stp.is-done .num { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }
    .join { flex: none; width: 36px; height: 1px; background: var(--border-strong); }
    .lead { margin: 0; display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; font-size: 0.9375rem; }
    .file { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; font-size: 12px; }
    .summary { display: flex; align-items: flex-end; gap: 28px; flex-wrap: wrap; }
    .stat { display: flex; flex-direction: column; }
    .stat .big { font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.1; }
    .stat .ok { color: var(--accent); }
    .stat .bad { color: var(--danger); }
    .stat .muted { font-size: 12px; }
    .alert-box .grow { flex: 1; min-height: 0; }
    .alert-box ul { list-style: disc; margin: 4px 0 0; padding-left: 18px; }
    .problems { font-size: 13px; }
    .problems summary { cursor: pointer; font-weight: 600; color: var(--danger); }
    .problems ul { list-style: disc; margin: 6px 0 0; padding-left: 18px; max-height: 140px; overflow: auto; line-height: 1.6; }
    .table-wrap { border: 1px solid var(--line); border-radius: 8px; overflow: auto; min-height: 120px; }
    .preview { border-collapse: separate; border-spacing: 0; font-size: 12.5px; }
    .preview th { position: sticky; top: 0; background: #f4f6f5; text-align: left; font-weight: 600; padding: 6px 8px; border-bottom: 1px solid var(--line-strong); white-space: nowrap; max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
    .preview td { padding: 5px 8px; border-bottom: 1px solid #eef1ef; white-space: nowrap; max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
    .preview th.is-missing { color: var(--danger); }
    .preview .rownum { color: var(--faint); font-variant-numeric: tabular-nums; }
    .preview tr.has-error .rownum { color: var(--danger); font-weight: 600; }
    .preview td.bad-cell { background: var(--danger-soft); color: var(--danger); }
    .more { padding: 8px 10px; margin: 0; font-size: 12px; }
    .final { max-width: 640px; margin: 8px auto 0; display: flex; flex-direction: column; gap: 10px; width: 100%; }
    .final h3 { margin: 0; font-size: 1.125rem; }
    .final p { margin: 0 0 6px; }
    .choices { display: flex; flex-direction: column; gap: 8px; }
    .choice { display: flex; align-items: flex-start; gap: 12px; padding: 12px 14px; border: var(--hairline) solid var(--border); border-radius: var(--radius-md); background: var(--surface-solid); cursor: pointer; }
    .choice.is-on { border-color: var(--accent); background: var(--accent-soft); }
    .choice input { margin-top: 3px; }
    .choice > span { display: flex; flex-direction: column; gap: 2px; }
    .choice small { font-size: 0.75rem; line-height: 1.45; }
    .back { margin-right: auto; }
    .updating { display: inline-flex; align-items: center; gap: 8px; font-size: 0.8125rem; }
  `,
})
export class ImportDialog {
  private readonly store = inject(WorkbookStore);
  private readonly toasts = inject(Toasts);

  readonly file = input<ImportFile | null>(null);
  readonly sheet = input.required<SheetWithRows>();
  readonly closed = output<void>();
  readonly imported = output<ImportDone>();

  readonly preview = signal<ImportPreview | null>(null);
  readonly reading = signal(false);
  readonly failure = signal('');
  readonly busy = signal(false);
  readonly mode = signal<'append' | 'replace'>('append');
  readonly includeProblems = signal(false);
  /** The user's own matches (table column key → the file's column), once they've changed them; else the names decide. */
  readonly override = signal<Record<string, number> | null>(null);
  /** For a Google tab: stay connected to it after the import. */
  readonly keepConnected = signal(true);
  /** The file is being read again with changed matches: what's shown is the answer to the earlier ones. */
  readonly remapping = signal(false);
  /** Where the names and the data are, once the person has said (else the file's own layout is found each time). */
  readonly layoutOverride = signal<FileLayout | null>(null);
  /** Which of the four screens: say where the names and data are, match the columns, check the rows, import. */
  readonly step = signal<1 | 2 | 3 | 4>(1);
  readonly stepNames = [
    { n: 1, label: 'Define the file' },
    { n: 2, label: 'Match columns' },
    { n: 3, label: 'Check the rows' },
    { n: 4, label: 'Import' },
  ] as const;
  private reads = 0;

  readonly targets = computed(() => this.sheet().columns.filter(isEntryColumn));
  /** What the file is read with now: each table column's key → the file's column. */
  readonly mapping = computed<Record<string, number>>(() =>
    Object.fromEntries((this.preview()?.matched ?? []).map((item) => [item.key, item.position])),
  );

  readonly entryCount = computed(() => this.sheet().columns.filter((column) => column.type !== 'formula').length);
  /** The columns shown: those found in the file, then the required ones it hasn't (empty, red). */
  readonly previewHeads = computed(() => {
    const p = this.preview();
    if (!p) return [];
    const heads = [
      ...p.matched.map((item) => ({ key: item.key, header: item.header, title: item.fileHeader, missing: false })),
      ...p.missingRequired.map((item) => ({ key: item.key, header: item.header, title: 'Not in the file', missing: true })),
    ];
    return heads.flatMap((head) => {
      const column = this.sheet().columns.find((item) => item.key === head.key);
      return column ? [{ ...head, column }] : [];
    });
  });
  /** A required column the file hasn't is said once above, not once per row. */
  private readonly listedErrors = computed(() => {
    const p = this.preview();
    const skip = new Set((p?.missingRequired ?? []).map((item) => item.key));
    return (p?.rows ?? []).flatMap((row) =>
      row.errors.filter((error) => !skip.has(error.key)).map((error) => ({ row: row.rowNumber, header: error.header, message: error.message })),
    );
  });
  readonly problemCount = computed(() => this.listedErrors().length);
  readonly problems = computed(() => this.listedErrors().slice(0, 60));
  /** Rows with a problem other than the missing column (those are listed). */
  readonly listedErrorRows = computed(() => new Set(this.listedErrors().map((error) => error.row)).size);
  readonly importCount = computed(() => {
    const p = this.preview();
    if (!p || p.issues.length) return 0;
    return this.includeProblems() ? p.rows.length : p.rows.length - p.errorRows;
  });

  constructor() {
    // Only a new file starts it over: reading it looks at the matches, which must not restart it.
    effect(() => {
      const file = this.file();
      untracked(() => {
        this.preview.set(null);
        this.failure.set('');
        // A table kept connected to a Google tab has its rows replaced by the tab's on every Sync.
        this.mode.set(file?.connect ? 'replace' : 'append');
        this.includeProblems.set(false);
        this.override.set(file?.matches && Object.keys(file.matches).length ? file.matches : null);
        this.layoutOverride.set(file?.layout ?? null);
        this.keepConnected.set(true);
        this.remapping.set(false);
        this.step.set(file?.startStep ?? 1);
        if (file) void this.parse(file);
      });
    });
  }

  /** Reads the file; `quiet`: again after a match changed, so the screen stays as it is until the answer comes. */
  private async parse(file: ImportFile, quiet = false) {
    const read = ++this.reads;
    if (!quiet) this.reading.set(true);
    try {
      const sheet = this.store.sheet(this.sheet().sheetId) ?? this.sheet();
      const override = this.override();
      const preview = await readImport(
        file.bytes,
        file.fileName,
        sheet,
        { linkOptions: (column) => this.store.linkOptions(column) },
        { tab: file.tab, columns: override ?? undefined, headerRow: file.headerRow, layout: this.layoutOverride() ?? undefined },
      );
      // An answer for matches changed since is stale.
      if (read !== this.reads) return;
      this.preview.set(preview);
      this.failure.set('');
    } catch (error) {
      if (read === this.reads) this.failure.set(errorText(error));
    } finally {
      // Only the latest read ends the wait (an older answer arriving first doesn't).
      if (read === this.reads) {
        this.remapping.set(false);
        if (!quiet) this.reading.set(false);
      }
    }
  }

  /** The user changed the matches (null: back to what the names say): the file is read with them. */
  remap(columns: Record<string, number> | null) {
    this.override.set(columns);
    this.remapping.set(true);
    const file = this.file();
    if (file) void this.parse(file, true);
  }

  /** The person said where the names and the data are: the file is read with that (the matches by position stay). */
  relayout(layout: FileLayout) {
    this.layoutOverride.set(layout);
    this.remapping.set(true);
    const file = this.file();
    if (file) void this.parse(file, true);
  }

  /** Where the names and the data are, in words. */
  layoutNote(layout: FileLayout) {
    const names = layout.headerFrom === layout.headerTo ? `names on row ${layout.headerFrom}` : `names on rows ${layout.headerFrom}–${layout.headerTo}`;
    return `${names} · data from row ${layout.dataFrom}`;
  }

  repeatedNames(preview: ImportPreview) {
    return preview.repeated.map((name) => `“${name}”`).join(', ');
  }

  /** What each header of a Google tab fills, as the link remembers it (a header that fills nothing: left out on purpose). */
  private connectionMap(preview: ImportPreview) {
    const keyAt = new Map(preview.matched.map((item) => [item.position, item.key]));
    const map: Record<string, string> = {};
    preview.sync.headers.forEach((header, index) => {
      map[normalizeHeader(header)] = keyAt.get(preview.sync.positions[index]) ?? '';
    });
    return map;
  }

  /** What the link keeps of where the names and data are: nothing, when Sync would look in the same place anyway. */
  private layoutForLink(preview: ImportPreview, file: ImportFile) {
    return file.headerRow && sameLayout(preview.layout, plainLayout(file.headerRow)) ? null : preview.layout;
  }

  header(column: Column) {
    return columnLabel(column);
  }

  show(column: Column, value: string | undefined) {
    return displayCell(column, value);
  }

  hasError(errors: { key: string }[], key: string) {
    return errors.some((error) => error.key === key);
  }

  errorFor(errors: { key: string; message: string }[], key: string) {
    return errors.find((error) => error.key === key)?.message ?? null;
  }

  /** The columns the file hasn't that no row needs. */
  leftBlank(preview: ImportPreview) {
    return preview.missing.filter((column) => !column.required);
  }

  requiredNames(preview: ImportPreview) {
    return preview.missingRequired.map((item) => `“${item.header}”`).join(', ');
  }

  missingNames(preview: ImportPreview) {
    const names = this.leftBlank(preview).map((column) => columnLabel(column));
    return names.length > 15 ? `${names.slice(0, 15).join(', ')} and ${names.length - 15} more` : names.join(', ');
  }

  linkTable(column: Column) {
    return parseLinkSource(column.source)?.table ?? 'the linked table';
  }

  linkTarget(column: Column) {
    const source = parseLinkSource(column.source);
    return source ? `${source.table} › ${source.column}` : 'the linked table';
  }

  private targetOf(column: Column) {
    const source = parseLinkSource(column.source);
    if (!source) return null;
    const table = this.store.formulas().table(source.table);
    const target = table ? this.store.formulas().resolve(table.columns, source.column) : null;
    return table && target && target.type !== 'formula' ? { table, target } : null;
  }

  canAddLinks(column: Column) {
    return this.targetOf(column) !== null;
  }

  async addLinks(column: Column, values: string[]) {
    const found = this.targetOf(column);
    const file = this.file();
    if (!found || !file) return;
    this.busy.set(true);
    try {
      await this.store.addRows(
        found.table.sheetId,
        values.map((value) => ({ [found.target.key]: value })),
      );
      this.toasts.show(`${values.length} added to ${found.table.title}`);
      await this.parse(file);
    } catch (error) {
      this.toasts.error(errorText(error));
    } finally {
      this.busy.set(false);
    }
  }

  async run() {
    const p = this.preview();
    if (!p || !this.importCount() || this.remapping()) return;
    const rows = p.rows.filter((row) => this.includeProblems() || !row.errors.length).map((row) => row.cells);
    this.busy.set(true);
    try {
      await this.store.addRows(this.sheet().sheetId, rows, { import: { fileName: p.fileName, mode: this.mode() } });
      const file = this.file();
      const connecting = !!file?.connect && this.keepConnected();
      this.imported.emit({
        count: rows.length,
        headerMap: connecting ? this.connectionMap(p) : null,
        layout: connecting && file ? this.layoutForLink(p, file) : null,
      });
    } catch (error) {
      this.toasts.error(`Not imported: ${errorText(error)}`);
    } finally {
      this.busy.set(false);
    }
  }
}
