import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ColumnMatcher } from '@features/import/column-matcher';
import { ImportLayout } from '@features/import/import-layout';
import { GoogleSignIn } from '@core/layout/google-sign-in';
import { Icon } from '@shared/ui/icon';
import { Api, errorText } from '@core/api';
import { Google, sheetUrl, type OpenedSheet, type SyncOutcome } from '@core/google/google';
import { MacList } from '@core/mac-list';
import type { Column, DriveFile, SheetWithRows } from '@core/models';
import { Toasts } from '@core/toast';
import { WorkbookStore } from '@core/workbook-store';
import { loadImportBook, readImportFrom, type ImportPreview } from '@shared/excel/excel-template';
import type { ExcelJS } from '@shared/excel/exceljs';
import { plainLayout, type FileLayout } from '@shared/excel/file-layout';
import { defaultTab, linkChanged, linkHeaderMap, linkLayout } from '@core/google/connect-plan';
import { mappingFromLink } from '@core/google/sheet-sync';
import { columnLabel, isEntryColumn } from '@shared/sheet/columns';

type Step = 1 | 2 | 3;

/** One table's tab, read as the table would read it, and how its columns are matched. */
interface Matching {
  tab: string;
  /** The row Sync finds the tab's names on by itself (what the link's layout is measured against). */
  headerRow: number;
  preview: ImportPreview;
  /** What the names say: "Match by name" goes back to it. */
  auto: Record<string, number>;
  /** Each table column's key → the tab's column (worksheet position) that fills it. */
  mapping: Record<string, number>;
  /** The matches are the person's (or the link's), not only what the names say: a new layout keeps them by position. */
  touched: boolean;
}

/** What connecting did for one table: read (rows), not read (null: connected only), or what went wrong. */
interface Outcome {
  sheetId: number;
  title: string;
  tab: string;
  result: SyncOutcome | Error | null;
}

/**
 * A MAC connected to one Google Sheet in one go: paste the sheet's link (or pick it), say which tab each table reads,
 * then match each table's columns to its tab's, as the per-table import does. Every table is then linked to its tab,
 * and Sync (or importing the MAC's file) reads all of them from that one sheet.
 */
@Component({
  selector: 'app-google-connect-page',
  imports: [RouterLink, Icon, GoogleSignIn, ColumnMatcher, ImportLayout],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.mac(); as mac) {
      <div class="page">
        <header class="page-header">
          <a class="page-back-icon" [routerLink]="['/mac', mac.macId]" title="Back to the MAC" aria-label="Back"><app-icon name="arrow-left" [size]="16" /></a>
          <div class="page-header-text">
            <h1 class="page-title">Connect a Google Sheet <span class="badge neutral">{{ mac.macCode }}</span></h1>
            <p class="page-desc">One sheet for every table of {{ mac.macName }}.</p>
          </div>
        </header>

        <section class="card wizard">
          @if (!google.status()) {
            <p class="muted">Checking Google…</p>
          } @else if (!google.status()!.configured) {
            <div class="alert-box info">
              <app-icon name="info" />
              <div class="grow"><strong>Google sign-in isn't set up yet.</strong> It needs a Client ID from your Google Cloud project, once. The steps are in Settings.</div>
              <a class="btn btn-secondary btn-sm" routerLink="/settings">Open Settings</a>
            </div>
          } @else if (!google.signedIn()) {
            <div class="center">
              <h3>Sign in to open a Google Sheet</h3>
              <app-google-sign-in />
            </div>
          } @else if (done(); as outcomes) {
            <div class="done">
              <h2 class="card-title">{{ connectedCount() }} table{{ connectedCount() === 1 ? '' : 's' }} connected to “{{ opened()?.file?.name }}”</h2>
              <ul class="results">
                @for (item of outcomes; track item.sheetId) {
                  <li class="result" [class.bad]="isError(item.result)">
                    <app-icon [name]="isError(item.result) ? 'alert' : 'check'" [size]="15" />
                    <span class="name">{{ item.title }}</span>
                    <small class="muted">tab “{{ item.tab }}”</small>
                    <span class="what">{{ outcomeText(item.result) }}</span>
                  </li>
                }
              </ul>
              <p class="muted small">Sync and the MAC's file now read from this sheet.</p>
              <div class="actions">
                <button type="button" class="btn btn-secondary" (click)="done.set(null); step.set(2)">Connect more</button>
                <a class="btn btn-primary" [routerLink]="['/mac', mac.macId]">Back to {{ mac.macName }}</a>
              </div>
            </div>
          } @else {
            <nav class="steps" aria-label="Steps">
              @for (item of stepNames; track item.n) {
                <button
                  type="button"
                  class="stp"
                  [class.is-on]="step() === item.n"
                  [class.is-done]="step() > item.n"
                  [disabled]="!canGo(item.n)"
                  [attr.aria-current]="step() === item.n ? 'step' : null"
                  (click)="go(item.n)"
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

            @switch (step()) {
              @case (1) {
                <form class="paste" (submit)="$event.preventDefault(); choose(link())">
                  <label class="form-group">
                    <span class="form-label">Google Sheet link</span>
                    <span class="paste-row">
                      <input class="input-field" placeholder="https://docs.google.com/spreadsheets/d/…" [value]="link()" (input)="link.set($any($event.target).value)" />
                      <button type="submit" class="btn btn-primary" [disabled]="!link().trim() || !!reading()">
                        @if (reading() && reading() === link().trim()) {
                          <span class="spinner-sm"></span> Opening…
                        } @else {
                          Open
                        }
                      </button>
                    </span>
                  </label>
                  <p class="muted small">Opened as {{ google.status()?.email || 'you' }}</p>
                </form>

                @if (linkedSheets().length) {
                  <div class="current">
                    <span class="form-label">Connected now</span>
                    @for (item of linkedSheets(); track item.id) {
                      <button type="button" class="file" [disabled]="!!reading()" (click)="choose(item.id)">
                        <span class="file-icon"><app-icon name="table" [size]="16" /></span>
                        <span class="file-text"><strong>{{ item.title }}</strong><small class="muted">{{ item.tables }} table{{ item.tables === 1 ? '' : 's' }}</small></span>
                        @if (reading() === item.id) {
                          <span class="spinner-sm"></span>
                        } @else {
                          <app-icon name="chevron-right" [size]="15" />
                        }
                      </button>
                    }
                  </div>
                }

                <span class="form-label or">Your Google Sheets</span>
                <label class="input-wrap search">
                  <span class="input-prefix"><app-icon name="search" [size]="15" /></span>
                  <input class="input-field has-prefix" type="search" placeholder="Search your Google Sheets" [value]="query()" (input)="search($any($event.target).value)" />
                </label>
                <div class="files" role="listbox" aria-label="Your Google Sheets">
                  @if (loading()) {
                    <p class="muted none">Looking…</p>
                  } @else if (listError()) {
                    <div class="alert-box error"><app-icon name="alert" /> {{ listError() }}</div>
                  } @else {
                    @for (file of files(); track file.id) {
                      <button type="button" class="file" role="option" [disabled]="!!reading()" (click)="choose(file.id)">
                        <span class="file-icon"><app-icon name="table" [size]="16" /></span>
                        <span class="file-text"><strong>{{ file.name }}</strong><small class="muted">{{ file.owner ? file.owner + ' · ' : '' }}{{ modified(file) }}</small></span>
                        @if (reading() === file.id) {
                          <span class="spinner-sm"></span>
                        } @else {
                          <app-icon name="chevron-right" [size]="15" />
                        }
                      </button>
                    } @empty {
                      <p class="muted none">{{ query().trim() ? 'No Google Sheet by that name.' : 'No Google Sheets in this account yet.' }}</p>
                    }
                  }
                </div>
              }

              @case (2) {
                @if (opened(); as sheet) {
                  <div class="file-head">
                    <span class="file-icon"><app-icon name="table" [size]="18" /></span>
                    <strong class="file-name">{{ sheet.file.name }}</strong>
                    <span class="count-chip" [title]="tabNames()">{{ sheet.tabs.length }} tab{{ sheet.tabs.length === 1 ? '' : 's' }}</span>
                    <span class="grow"></span>
                    <button type="button" class="icon-btn" title="Open in Google" aria-label="Open in Google" (click)="openInGoogle()"><app-icon name="external-link" /></button>
                    <button type="button" class="icon-btn" title="Another sheet" aria-label="Another sheet" (click)="restart()"><app-icon name="refresh" /></button>
                  </div>
                  <div class="groups">
                    @for (group of store.headings(); track group.heading) {
                      <section class="grp">
                        <h3 class="group">{{ group.heading }}</h3>
                        <div class="cards">
                          @for (table of group.sheets; track table.sheetId) {
                            @let state = pairState(table);
                            <div class="pair" [class.on]="!!choices()[table.sheetId]">
                              <app-icon class="t-icon" [name]="table.icon || 'table'" [size]="16" />
                              <span class="title" [title]="table.title + ' · ' + table.rows.length + ' rows in the app'">{{ table.title }}</span>
                              <span class="pick">
                                <app-icon class="pk-ic" name="table" [size]="13" />
                                <select (change)="setTab(table.sheetId, $any($event.target).value)" [attr.aria-label]="'The tab ' + table.title + ' reads'">
                                  <option value="" [selected]="!choices()[table.sheetId]">{{ google.linkOf(table.sheetId) ? 'Keep its link' : '—' }}</option>
                                  @for (tab of sheet.tabs; track tab.name) {
                                    <option [value]="tab.name" [selected]="choices()[table.sheetId] === tab.name">{{ tab.name }}</option>
                                  }
                                </select>
                                <app-icon class="pk-chev" name="chevron-down" [size]="13" />
                              </span>
                              <span class="state" [class]="'state ' + state.kind" [title]="state.tip" [attr.aria-label]="state.tip || null">
                                @if (state.icon) {
                                  <app-icon [name]="state.icon" [size]="15" />
                                }
                              </span>
                            </div>
                          }
                        </div>
                      </section>
                    }
                  </div>
                  @if (unusedTabs().length) {
                    <div class="unused" title="Import from Google Sheets on the MAC's page makes a new table from a tab">
                      <span class="muted">Unused tabs</span>
                      @for (name of unusedTabs(); track name) {
                        <span class="tab-chip">{{ name }}</span>
                      }
                    </div>
                  }
                }
              }

              @case (3) {
                <div class="match">
                  <ul class="match-list" aria-label="Tables to match">
                    @for (row of matchRows(); track row.table.sheetId) {
                      <li>
                        <button type="button" class="match-item" [class.on]="current() === row.table.sheetId" (click)="current.set(row.table.sheetId)">
                          <span class="mi-top">
                            <span class="title">{{ row.table.title }}</span>
                            @if (row.failed) {
                              <span class="score bad" title="This tab can't be read: the table is left out"><app-icon name="alert" [size]="12" /></span>
                            } @else if (row.matched === null) {
                              <span class="spinner-sm"></span>
                            } @else {
                              <span
                                class="score"
                                [class.full]="row.matched === row.total"
                                [class.warn]="row.required.length || !row.matched"
                                [title]="row.matched + ' of ' + row.total + ' columns matched' + (row.required.length ? '; needs ' + row.required.join(', ') : '')"
                                >{{ row.matched }}/{{ row.total }}</span
                              >
                            }
                          </span>
                          <small class="muted"><app-icon name="table" [size]="11" /> {{ row.tab }}</small>
                        </button>
                      </li>
                    }
                  </ul>
                  <div class="match-main">
                    @if (preparing()) {
                      <p class="muted"><span class="spinner-sm"></span> {{ preparing() }}</p>
                    }
                    @for (id of currentList(); track id) {
                      @if (matchings().get(id); as m) {
                        @if (tableOf(id); as table) {
                          <div class="lead">
                            <span class="flow">
                              <span class="end"><app-icon name="table" [size]="14" /> {{ m.tab }}</span>
                              <app-icon class="to" name="arrow-right" [size]="14" />
                              <span class="end"><app-icon [name]="table.icon || 'table'" [size]="14" /> {{ table.title }}</span>
                            </span>
                            <span class="muted small">{{ layoutNote(m) }}</span>
                            <span class="grow"></span>
                            <button type="button" class="btn btn-plain btn-sm" [class.on]="defining()" [attr.aria-expanded]="defining()" (click)="defining.set(!defining())" title="Say which rows hold the column names and where the data starts, for a tab whose names take more than one row">
                              <app-icon name="ruler" /> {{ defining() ? 'Done defining' : 'Define the tab' }}
                            </button>
                          </div>
                          @if (defining()) {
                            <app-import-layout
                              class="define"
                              [peek]="m.preview.peek"
                              [layout]="m.preview.layout"
                              [detected]="m.preview.detected"
                              [columns]="m.preview.fileColumns.length"
                              [rows]="m.preview.rows.length"
                              (layoutChange)="relayout(id, $event)"
                            />
                          }
                          <app-column-matcher
                            class="matcher"
                            [fileColumns]="m.preview.fileColumns"
                            [targets]="targets(table)"
                            [mapping]="m.mapping"
                            [tableTitle]="table.title"
                            (mappingChange)="remap(id, $event)"
                            (auto)="remap(id, m.auto)"
                          />
                          @if (requiredLeft(table, m); as left) {
                            @if (left.length) {
                              <div class="alert-box warning">
                                <app-icon name="alert" />
                                <div>Needed, not matched: {{ left.join(', ') }}</div>
                              </div>
                            }
                          }
                        }
                      } @else if (failureOf(id); as failure) {
                        <div class="alert-box error">
                          <app-icon name="alert" />
                          <div>{{ failure }} It is left out; pick another tab in step 2.</div>
                        </div>
                      }
                    }
                  </div>
                </div>
              }
            }

            @if (error()) {
              <div class="alert-box error"><app-icon name="alert" /> {{ error() }}</div>
            }

            @if (step() > 1) {
            <footer class="bar">
              <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="go(step() === 3 ? 2 : 1)"><app-icon name="arrow-left" /> Back</button>
              <span class="grow"></span>
              @if (step() === 2) {
                <button type="button" class="btn btn-primary" [disabled]="!chosen().length" (click)="go(3)">
                  Match columns <span class="n">{{ chosen().length }}</span> <app-icon name="arrow-right" />
                </button>
              }
              @if (step() === 3) {
                <button type="button" class="btn btn-secondary" [disabled]="busy() || !ready()" (click)="connect(false)" title="Connect the tables; nothing is read until Sync or an import">Connect only</button>
                <button type="button" class="btn btn-primary" [disabled]="busy() || !ready()" (click)="connect(true)" title="Connect them, then read each tab: the rows in the app are replaced by the tab's">
                  @if (busy()) {
                    <span class="spinner-sm"></span> Connecting…
                  } @else {
                    <app-icon name="refresh" /> Connect and read {{ connectable().length }} table{{ connectable().length === 1 ? '' : 's' }}
                  }
                </button>
              }
            </footer>
            }
          }
        </section>
      </div>
    }
  `,
  styles: `
    /* Fills the space under the top bar, so its .page scrolls (as the other routed pages do in styles.css). */
    :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    .wizard { display: flex; flex-direction: column; gap: 16px; padding: 20px 22px; }
    .grow { flex: 1; }
    .center { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 32px 8px; text-align: center; }
    .center h3 { margin: 4px 0 0; font-size: 1rem; }
    .steps { display: flex; align-items: center; gap: 10px; flex: none; }
    .stp { display: inline-flex; align-items: center; gap: 8px; padding: 0; border: 0; background: none; color: var(--text-muted); font: inherit; font-size: 0.875rem; font-weight: 500; cursor: default; }
    .stp:not(:disabled) { cursor: pointer; }
    .stp .num { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; border: var(--hairline) solid var(--border-strong); font-size: 0.75rem; font-weight: 600; font-variant-numeric: tabular-nums; }
    .stp.is-on { color: var(--text); }
    .stp.is-on .num { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
    .stp.is-done .num { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }
    .join { flex: none; width: 36px; height: 1px; background: var(--border-strong); }
    .lead { margin: 0; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 0.9375rem; }
    .small { font-size: 0.75rem; line-height: 1.5; }
    small { font-size: 0.75rem; }
    .paste .form-group { margin: 0; }
    .paste p { margin: 6px 0 0; }
    .paste-row { display: flex; gap: 8px; }
    .paste-row .input-field { flex: 1; }
    .paste-row .btn { min-width: 96px; justify-content: center; }
    .current { display: flex; flex-direction: column; gap: 6px; }
    .or { margin-top: 4px; }
    .search { display: block; }
    .files { display: flex; flex-direction: column; gap: 4px; max-height: 320px; overflow: auto; padding: 2px; margin: -6px -2px 0; }
    .file { display: flex; align-items: center; gap: 12px; width: 100%; padding: 9px 12px; border: var(--hairline) solid var(--border); border-radius: var(--radius-md); background: var(--surface-solid); color: var(--text); font: inherit; text-align: left; cursor: pointer; }
    button.file:hover:not(:disabled) { background: var(--accent-soft); border-color: var(--accent); }
    button.file:disabled { opacity: 0.6; cursor: default; }
    .file-icon { flex: none; width: 32px; height: 32px; border-radius: 9px; background: var(--accent-soft); color: var(--accent); display: inline-flex; align-items: center; justify-content: center; }
    .file-text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
    .file-text strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    .none { padding: 14px 4px; margin: 0; }
    .file-head { display: flex; align-items: center; gap: 10px; }
    .file-name { font-size: 1rem; font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .count-chip { flex: none; padding: 2px 9px; border-radius: 999px; background: var(--fill); color: var(--text-muted); font-size: 0.75rem; font-weight: 500; cursor: default; }
    .groups { display: flex; flex-direction: column; gap: 14px; }
    .group { margin: 0 0 6px 2px; font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); }
    .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 400px), 1fr)); gap: 8px; }
    .pair {
      display: flex; align-items: center; gap: 10px; min-width: 0; padding: 7px 10px 7px 12px;
      border: var(--hairline) solid var(--border); border-radius: var(--radius-md); background: var(--surface-solid);
      transition: border-color var(--dur-fast, 0.15s) var(--ease, ease), box-shadow var(--dur-fast, 0.15s) var(--ease, ease);
    }
    .pair:hover { border-color: var(--border-strong); }
    .pair.on { border-color: color-mix(in srgb, var(--accent) 45%, transparent); box-shadow: inset 3px 0 0 var(--accent); }
    .t-icon { flex: none; color: var(--text-muted); }
    .pair.on .t-icon { color: var(--accent); }
    .pair .title { flex: 1; min-width: 0; font-size: 0.875rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pick { position: relative; flex: none; width: 196px; display: inline-flex; align-items: center; }
    .pick select {
      appearance: none; -webkit-appearance: none; width: 100%; height: 30px; padding: 0 28px 0 28px; margin: 0;
      border: var(--hairline) dashed var(--border-strong); border-radius: 999px; background: transparent;
      color: var(--text-muted); font: inherit; font-size: 0.8125rem; text-overflow: ellipsis; white-space: nowrap; cursor: pointer;
    }
    .pick select:hover { border-color: var(--accent); }
    .pick select:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    .pair.on .pick select { border: var(--hairline) solid transparent; background: var(--accent-soft); color: var(--accent); font-weight: 600; }
    .pick .pk-ic, .pick .pk-chev { position: absolute; top: 50%; transform: translateY(-50%); pointer-events: none; color: var(--text-muted); }
    .pick .pk-ic { left: 10px; }
    .pick .pk-chev { right: 10px; }
    .pair.on .pick .pk-ic, .pair.on .pick .pk-chev { color: var(--accent); }
    .state { flex: none; width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center; cursor: default; }
    .state.ok { color: var(--success); }
    .state.warn { color: var(--warning); }
    .state.muted { color: var(--text-muted); }
    .unused { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 0.75rem; }
    .unused .muted { margin-right: 2px; }
    .tab-chip { padding: 2px 9px; border-radius: 999px; border: var(--hairline) dashed var(--border-strong); color: var(--text-muted); }
    .warn { color: var(--warning); }
    .btn .n { min-width: 20px; height: 18px; padding: 0 6px; border-radius: 999px; background: rgba(255, 255, 255, 0.25); font-size: 0.75rem; display: inline-flex; align-items: center; justify-content: center; }
    .match { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 16px; min-height: 0; }
    .match-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; max-height: clamp(420px, 64vh, 760px); overflow: auto; }
    .match-item { display: flex; flex-direction: column; align-items: stretch; gap: 2px; width: 100%; padding: 8px 12px; border: var(--hairline) solid var(--border); border-radius: var(--radius-md); background: var(--surface-solid); color: var(--text); font: inherit; text-align: left; cursor: pointer; }
    .match-item:hover { border-color: var(--accent); }
    .match-item.on { border-color: var(--accent); background: var(--accent-soft); }
    .match-item .title { flex: 1; min-width: 0; font-weight: 600; font-size: 0.875rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .match-item small { display: inline-flex; align-items: center; gap: 4px; overflow: hidden; white-space: nowrap; }
    .mi-top { display: flex; align-items: center; gap: 8px; }
    .score { flex: none; padding: 1px 7px; border-radius: 999px; background: var(--fill); color: var(--text-muted); font-size: 0.6875rem; font-weight: 600; font-variant-numeric: tabular-nums; display: inline-flex; align-items: center; }
    .score.full { background: var(--success-soft); color: var(--success); }
    .score.warn { background: var(--warning-soft); color: var(--warning); }
    .score.bad { background: var(--danger-soft); color: var(--danger); }
    .flow { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; }
    .flow .end { display: inline-flex; align-items: center; gap: 5px; }
    .flow .end app-icon, .flow .to { color: var(--accent); }
    .match-main { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
    .matcher { height: clamp(380px, 58vh, 700px); }
    .define { height: clamp(280px, 40vh, 460px); }
    .lead .btn.on { color: var(--accent); }
    .bad { color: var(--danger); }
    .bar { display: flex; align-items: center; gap: 10px; padding-top: 14px; border-top: var(--hairline) solid var(--border); }
    .done { display: flex; flex-direction: column; gap: 12px; }
    .results { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .result { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border: var(--hairline) solid var(--border); border-radius: var(--radius-md); background: var(--surface-solid); }
    .result app-icon { color: var(--accent); }
    .result.bad app-icon, .result.bad .what { color: var(--danger); }
    .result .name { font-weight: 600; }
    .result .what { margin-left: auto; font-size: 0.8125rem; }
    .actions { display: flex; justify-content: flex-end; gap: 10px; }
  `,
})
export class GoogleConnectPage {
  readonly store = inject(WorkbookStore);
  readonly google = inject(Google);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  private readonly macList = inject(MacList);

  readonly stepNames = [
    { n: 1, label: 'Google Sheet' },
    { n: 2, label: 'Tabs to tables' },
    { n: 3, label: 'Match columns' },
  ] as const;
  readonly step = signal<Step>(1);

  readonly link = signal('');
  readonly query = signal('');
  readonly files = signal<DriveFile[]>([]);
  readonly loading = signal(false);
  readonly listError = signal('');
  /** The sheet being opened (its id or link). */
  readonly reading = signal('');
  readonly error = signal('');
  readonly busy = signal(false);

  readonly opened = signal<OpenedSheet | null>(null);
  /** The opened sheet as a workbook, loaded once for every table's matching. */
  private book: ExcelJS.Workbook | null = null;
  /** The tab each table reads (by sheet id); none or '': not connected here. */
  readonly choices = signal<Record<number, string>>({});
  readonly matchings = signal<ReadonlyMap<number, Matching>>(new Map());
  /** A table whose tab couldn't be read: which tab, and why. */
  readonly failed = signal<ReadonlyMap<number, { tab: string; message: string }>>(new Map());
  /** The tab's rows of names and of data are shown, to say where they are. */
  readonly defining = signal(false);
  readonly preparing = signal('');
  /** The table whose columns are shown. */
  readonly current = signal<number | null>(null);
  readonly done = signal<Outcome[] | null>(null);
  /** How many tables the last Connect linked. */
  readonly connectedCount = signal(0);

  private timer: ReturnType<typeof setTimeout> | null = null;
  private triedLinked = false;

  /** The tables given a tab, in the MAC's order. */
  readonly chosen = computed(() => {
    const choices = this.choices();
    return this.store.sheets().filter((sheet) => !!choices[sheet.sheetId]);
  });
  /** The chosen tables whose tab is read, with how their columns are matched (a tab that can't be read is left out). */
  readonly connectable = computed(() => {
    const matchings = this.matchings();
    const choices = this.choices();
    return this.chosen().flatMap((table) => {
      const m = matchings.get(table.sheetId);
      return m && m.tab === choices[table.sheetId] ? [{ table, m }] : [];
    });
  });
  /** Every chosen table's tab has been read (or couldn't be), and at least one can be connected. */
  readonly ready = computed(() => {
    const choices = this.choices();
    const failed = this.failed();
    const done = this.chosen().every((table) => this.matchings().get(table.sheetId)?.tab === choices[table.sheetId] || failed.get(table.sheetId)?.tab === choices[table.sheetId]);
    return done && this.connectable().length > 0;
  });
  /** The Google Sheets this MAC's tables read now, the most used first. */
  readonly linkedSheets = computed(() => {
    const macId = this.store.mac()?.macId;
    const counts = new Map<string, { id: string; title: string; tables: number }>();
    for (const link of this.google.links()) {
      if (link.macId !== macId) continue;
      const item = counts.get(link.spreadsheetId) ?? { id: link.spreadsheetId, title: link.spreadsheetTitle, tables: 0 };
      item.tables += 1;
      counts.set(link.spreadsheetId, item);
    }
    return [...counts.values()].sort((a, b) => b.tables - a.tables);
  });
  readonly tabNames = computed(() => (this.opened()?.tabs ?? []).map((tab) => tab.name).join(', '));
  readonly unusedTabs = computed(() => {
    const used = new Set(Object.values(this.choices()).filter(Boolean));
    return (this.opened()?.tabs ?? []).map((tab) => tab.name).filter((name) => !used.has(name));
  });
  /** The left list of the matching step: each chosen table, its tab and how many of its columns are filled. */
  readonly matchRows = computed(() => {
    const matchings = this.matchings();
    const choices = this.choices();
    return this.chosen().map((table) => {
      const m = matchings.get(table.sheetId);
      const fresh = m && m.tab === choices[table.sheetId] ? m : null;
      const targets = this.targets(table);
      return {
        table,
        tab: choices[table.sheetId],
        failed: this.failed().get(table.sheetId)?.tab === choices[table.sheetId],
        matched: fresh ? targets.filter((column) => fresh.mapping[column.key] !== undefined).length : null,
        total: targets.length,
        required: fresh ? this.requiredLeft(table, fresh) : [],
      };
    });
  });
  /** The table shown, as a list of one (so its matcher is made anew for each table). */
  readonly currentList = computed(() => {
    const id = this.current();
    return id !== null && this.chosen().some((sheet) => sheet.sheetId === id) ? [id] : [];
  });

  constructor() {
    effect(() => {
      if (!this.google.signedIn()) return;
      untracked(() => {
        void this.load(this.query());
        // The sheet this MAC reads already is opened at once: its tables are shown as they are connected.
        const first = this.linkedSheets()[0];
        if (!this.triedLinked && first && !this.opened()) {
          this.triedLinked = true;
          void this.choose(first.id);
        }
      });
    });
    void this.google.init().then(async () => {
      await this.google.refreshStatus();
      await this.google.refreshLinks();
      // Links come after sign-in was seen: open the linked sheet now.
      const first = this.linkedSheets()[0];
      if (this.google.signedIn() && !this.triedLinked && first && !this.opened()) {
        this.triedLinked = true;
        void this.choose(first.id);
      }
    });
  }

  // ------------------------------------------------------------------ step 1

  search(text: string) {
    this.query.set(text);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.load(text), 300);
  }

  private async load(text: string) {
    this.loading.set(true);
    this.listError.set('');
    try {
      const files = await this.google.listSheets(text);
      if (text === this.query()) this.files.set(files);
    } catch (error) {
      this.listError.set(errorText(error));
      this.files.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  modified(file: DriveFile) {
    if (!file.modifiedTime) return '';
    const date = new Date(file.modifiedTime);
    return Number.isFinite(date.getTime()) ? `edited ${date.toLocaleDateString('en-GB', { timeZone: 'Asia/Phnom_Penh' })}` : '';
  }

  /** Opens a Google Sheet (picked, or its link pasted) and pairs each table with its tab. */
  async choose(file: string) {
    const target = file.trim();
    if (!target || this.reading()) return;
    this.reading.set(target);
    this.error.set('');
    try {
      const opened = await this.google.open(target);
      if (!opened.tabs.length) throw new Error(`“${opened.file.name}” has no tab with anything in it.`);
      this.book = await loadImportBook(opened.bytes);
      const choices: Record<number, string> = {};
      for (const table of this.store.sheets()) {
        const tab = defaultTab(table, opened.tabs, this.google.linkOf(table.sheetId), opened.file.id);
        if (tab) choices[table.sheetId] = tab;
      }
      this.opened.set(opened);
      this.choices.set(choices);
      this.matchings.set(new Map());
      this.failed.set(new Map());
      this.current.set(null);
      this.step.set(2);
    } catch (error) {
      this.error.set(errorText(error));
    } finally {
      this.reading.set('');
    }
  }

  restart() {
    this.opened.set(null);
    this.book = null;
    this.choices.set({});
    this.matchings.set(new Map());
    this.failed.set(new Map());
    this.error.set('');
    this.step.set(1);
  }

  openInGoogle() {
    const opened = this.opened();
    if (opened) void this.api.openLink(sheetUrl(opened.file.id)).catch((error) => this.toasts.error(errorText(error)));
  }

  // ------------------------------------------------------------------ step 2

  setTab(sheetId: number, tab: string) {
    this.choices.update((choices) => {
      const next = { ...choices };
      if (tab) next[sheetId] = tab;
      else delete next[sheetId];
      return next;
    });
  }

  /** The small mark beside a table's tab, with what it means on hover: connected now, moving, or the map. */
  pairState(table: SheetWithRows): { kind: 'ok' | 'warn' | 'muted' | 'none'; icon: string | null; tip: string } {
    const tab = this.choices()[table.sheetId];
    const link = this.google.linkOf(table.sheetId);
    const opened = this.opened();
    const zones = table.templateKey === 'zones';
    if (tab) {
      if (zones) return { kind: 'warn', icon: 'alert', tip: 'Its rows and the map’s plot outlines will come from this tab' };
      if (link && (link.spreadsheetId !== opened?.file.id || link.tabTitle !== tab)) return { kind: 'warn', icon: 'alert', tip: `Moves from “${link.spreadsheetTitle} › ${link.tabTitle}”` };
      if (link) return { kind: 'ok', icon: 'cloud-check', tip: 'Connected now' };
      return { kind: 'none', icon: null, tip: '' };
    }
    if (link) return { kind: 'muted', icon: 'cloud-check', tip: `Reads “${link.spreadsheetTitle} › ${link.tabTitle}”` };
    if (zones) return { kind: 'muted', icon: 'map', tip: 'The map stays in the MAC’s file' };
    return { kind: 'none', icon: null, tip: '' };
  }

  canGo(step: Step) {
    if (step === 1) return !this.busy();
    if (step === 2) return !!this.opened() && !this.busy();
    return !!this.opened() && this.chosen().length > 0 && !this.busy();
  }

  go(step: Step) {
    if (!this.canGo(step)) return;
    this.error.set('');
    this.step.set(step);
    if (step === 3) {
      const ids = this.chosen().map((sheet) => sheet.sheetId);
      if (!ids.includes(this.current() ?? -1)) this.current.set(ids[0] ?? null);
      void this.prepareAll();
    }
  }

  // ------------------------------------------------------------------ step 3

  tableOf(sheetId: number) {
    return this.store.sheets().find((sheet) => sheet.sheetId === sheetId) ?? null;
  }

  targets(table: SheetWithRows): Column[] {
    return table.columns.filter(isEntryColumn);
  }

  /** The table's columns every row needs that no column of the tab fills. */
  requiredLeft(table: SheetWithRows, m: Matching): string[] {
    return this.targets(table)
      .filter((column) => column.required && m.mapping[column.key] === undefined)
      .map((column) => columnLabel(column));
  }

  layoutNote(m: Matching) {
    const layout = m.preview.layout;
    const names = layout.headerFrom === layout.headerTo ? `${layout.headerFrom}` : `${layout.headerFrom}–${layout.headerTo}`;
    return `names row ${names} · data from ${layout.dataFrom} · ${m.preview.rows.length} rows`;
  }

  remap(sheetId: number, mapping: Record<string, number>) {
    this.matchings.update((all) => {
      const m = all.get(sheetId);
      if (!m) return all;
      const next = new Map(all);
      next.set(sheetId, { ...m, mapping: { ...mapping }, touched: mapping !== m.auto });
      return next;
    });
  }

  /** Why a table's tab couldn't be read, while it is still the tab picked for it. */
  failureOf(sheetId: number) {
    const failure = this.failed().get(sheetId);
    return failure && failure.tab === this.choices()[sheetId] ? failure.message : null;
  }

  /**
   * The person said where a tab's names and data are: it is read again with that. Matches the person made stay by the
   * tab's column (as the import does); matches only by name are found again from the new names.
   */
  relayout(sheetId: number, layout: FileLayout) {
    const opened = this.opened();
    const table = this.tableOf(sheetId);
    const m = this.matchings().get(sheetId);
    if (!opened || !this.book || !table || !m) return;
    try {
      const preview = this.readTab(this.book, opened, table, m.tab, layout);
      const auto = Object.fromEntries(preview.matched.map((item) => [item.key, item.position]));
      const there = new Set(preview.fileColumns.map((column) => column.position));
      const mapping = m.touched ? Object.fromEntries(Object.entries(m.mapping).filter(([, position]) => there.has(position))) : auto;
      this.matchings.update((all) => new Map(all).set(sheetId, { ...m, preview, auto, mapping }));
    } catch (error) {
      this.toasts.error(errorText(error));
    }
  }

  /**
   * Reads each chosen table's tab as that table (the one shown first), so its columns can be matched. A table connected to
   * the same tab already starts from the matches it has; another starts from what the names say. A tab picked again
   * while this runs is read too: each turn takes the next table whose tab isn't read yet.
   */
  private async prepareAll() {
    if (this.preparing()) return;
    const opened = this.opened();
    const book = this.book;
    if (!opened || !book) return;
    try {
      for (;;) {
        if (this.opened() !== opened) return;
        const choices = this.choices();
        const waiting = this.chosen().filter(
          (table) => this.matchings().get(table.sheetId)?.tab !== choices[table.sheetId] && this.failed().get(table.sheetId)?.tab !== choices[table.sheetId],
        );
        const table = waiting.find((item) => item.sheetId === this.current()) ?? waiting[0];
        if (!table) return;
        const tab = choices[table.sheetId];
        this.preparing.set(`Reading the tab “${tab}” for ${table.title}…`);
        // Lets the screen show it before the reading holds the page.
        await new Promise((resolve) => setTimeout(resolve, 0));
        try {
          const m = this.read(book, opened, table, tab);
          this.matchings.update((all) => new Map(all).set(table.sheetId, m));
        } catch (error) {
          this.failed.update((all) => new Map(all).set(table.sheetId, { tab, message: `The tab “${tab}” can't be read for ${table.title}: ${errorText(error)}` }));
        }
      }
    } finally {
      this.preparing.set('');
    }
  }

  /** A tab read as the table: with `layout`, where the person (or the link) said the names and data are; else they are found from the table's names. */
  private readTab(book: ExcelJS.Workbook, opened: OpenedSheet, table: SheetWithRows, tab: string, layout?: FileLayout): ImportPreview {
    return readImportFrom(book, `${opened.file.name} › ${tab}.xlsx`, table, { linkOptions: (column) => this.store.linkOptions(column) }, { tab, layout });
  }

  private read(book: ExcelJS.Workbook, opened: OpenedSheet, table: SheetWithRows, tab: string): Matching {
    const data = opened.tabs.find((item) => item.name === tab);
    if (!data) throw new Error(`The sheet has no tab “${tab}”.`);
    const link = this.google.linkOf(table.sheetId);
    const same = !!link && link.spreadsheetId === opened.file.id && link.tabTitle === tab;
    const headerRow = data.auto.headerFrom;
    // Connected to this tab already: read where Sync reads it, so the link comes back as it is. Else the names are looked for.
    const preview = this.readTab(book, opened, table, tab, same ? (link.layout ?? plainLayout(headerRow)) : undefined);
    const auto = Object.fromEntries(preview.matched.map((item) => [item.key, item.position]));
    const kept = same ? mappingFromLink(table.columns, preview.sync.headers, preview.sync.positions, link.headerMap) : {};
    const touched = Object.keys(kept).length > 0;
    return { tab, headerRow, preview, auto, mapping: touched ? kept : auto, touched };
  }

  // ------------------------------------------------------------------ connect

  /** Links every chosen table to its tab with the matches made; with `readNow`, reads each of them right after. */
  async connect(readNow: boolean) {
    const opened = this.opened();
    if (!opened || this.busy() || !this.ready()) return;
    const items = this.connectable();
    const unread = this.chosen().filter((table) => !items.some((item) => item.table.sheetId === table.sheetId));
    if (readNow) {
      const replaced = items.filter(({ table }) => table.rows.length > 0);
      if (replaced.length) {
        const text = [
          `The rows in the app are replaced by the tab's, for:`,
          replaced.map(({ table, m }) => `• ${table.title}: ${table.rows.length} row${table.rows.length === 1 ? '' : 's'} here → ${m.preview.rows.length} in “${m.tab}”`).join('\n'),
          'A tab with no rows leaves its table as it is. Undo import does not bring replaced rows back.',
        ].join('\n\n');
        if (!(await this.api.confirm(text, 'Connect and read', 'Connect and read'))) return;
      }
    }
    this.busy.set(true);
    this.error.set('');
    try {
      for (const { table, m } of items) {
        const next = {
          spreadsheetId: opened.file.id,
          spreadsheetTitle: opened.file.name,
          tabTitle: m.tab,
          headerMap: linkHeaderMap(m.preview.sync, m.mapping),
          layout: linkLayout(m.preview.layout, m.headerRow),
        };
        const link = this.google.linkOf(table.sheetId);
        if (linkChanged(link, next) || link?.spreadsheetTitle !== opened.file.name) await this.api.saveGoogleLink({ sheetId: table.sheetId, ...next });
      }
      await this.google.refreshLinks();
      const ids = items.map(({ table }) => table.sheetId);
      const results = readNow ? await this.google.syncMany(ids) : new Map<number, SyncOutcome | Error>();
      const outcomes: Outcome[] = [
        ...items.map(({ table, m }) => ({ sheetId: table.sheetId, title: table.title, tab: m.tab, result: results.get(table.sheetId) ?? null })),
        ...unread.map((table) => ({
          sheetId: table.sheetId,
          title: table.title,
          tab: this.choices()[table.sheetId],
          result: new Error(`Not connected: ${this.failureOf(table.sheetId) ?? 'its tab could not be read.'}`),
        })),
      ];
      this.connectedCount.set(items.length);
      this.done.set(outcomes);
      const bad = outcomes.filter((item) => item.result instanceof Error).length;
      const rows = outcomes.reduce((sum, item) => sum + (item.result && !(item.result instanceof Error) ? item.result.rows : 0), 0);
      this.toasts.show(
        `${items.length} table${items.length === 1 ? '' : 's'} connected to “${opened.file.name}”${readNow ? `, ${rows} rows read` : ''}${bad ? ` · ${bad} not read` : ''}`,
        bad ? 'info' : 'ok',
      );
      void this.macList.refresh();
    } catch (error) {
      this.error.set(errorText(error));
      void this.google.refreshLinks();
    } finally {
      this.busy.set(false);
    }
  }

  isError(result: Outcome['result']) {
    return result instanceof Error;
  }

  outcomeText(result: Outcome['result']) {
    if (result === null) return 'Connected · read by Sync';
    if (result instanceof Error) return result.message;
    const parts = [`${result.rows} row${result.rows === 1 ? '' : 's'} read`];
    if (result.added.length) parts.push(`new column${result.added.length === 1 ? '' : 's'}: ${result.added.join(', ')}`);
    if (result.problems) parts.push(`${result.problems} cell${result.problems === 1 ? '' : 's'} to check`);
    if (result.skipped) parts.push(`${result.skipped} without a zone plot left out`);
    if (result.truncated) parts.push('first 5000 only');
    return parts.join(' · ');
  }
}
