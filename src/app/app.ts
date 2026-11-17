import { ChangeDetectionStrategy, Component, computed, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';

import { Icon } from '@shared/ui/icon';
import { NavPillGlide } from '@core/layout/nav-pill-glide';
import { SignInGate } from '@core/layout/sign-in-gate';
import { UpdateButton } from '@core/layout/update-button';
import { Api, errorText } from '@core/api';
import { Google } from '@core/google/google';
import { AutoSync } from '@core/auto-sync';
import { MacList } from '@core/mac-list';
import { PowerBi } from '@core/powerbi';
import { HEADING_ICONS } from '@core/headings';
import { Shell } from '@core/shell';
import { Theme } from '@core/theme';
import { Toasts } from '@core/toast';
import { AppUpdater } from '@core/updater';
import { WorkbookStore } from '@core/workbook-store';
import { tableGaps } from '@features/dashboard/data-gaps';

interface Crumb {
  label: string;
  link?: unknown[];
}

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, NavPillGlide, SignInGate, UpdateButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  readonly macs = inject(MacList);
  readonly store = inject(WorkbookStore);
  readonly toasts = inject(Toasts);
  readonly powerBi = inject(PowerBi);
  readonly google = inject(Google);
  private readonly autoSync = inject(AutoSync);
  private readonly api = inject(Api);
  private readonly updater = inject(AppUpdater);
  readonly shell = inject(Shell);
  /** Applies the accent colour and table sizing the person chose in Settings (it works on creation). */
  private readonly theme = inject(Theme);
  private readonly router = inject(Router);

  /** The name this computer has, for the sidebar's foot (empty until it is read, or when it can't be). */
  readonly computer = signal('');

  /** Who the sidebar's foot names: the Google account signed in (its name, else its email), else this computer by its own name. */
  readonly who = computed(() => {
    const status = this.google.status();
    const account = status?.signedIn ? (status.name || status.email || '').trim() : '';
    if (account) return { name: account, initial: account[0].toUpperCase(), sub: status?.email && status.email !== account ? status.email : 'Signed in with Google' };
    return { name: this.computer() || 'This Mac', initial: '', sub: 'Everything saved here' };
  });

  /** Who is signed in; undefined until Google has been asked. */
  private account: string | null | undefined;

  /** Until the sign-in is known nothing is shown; signed out, only the sign-in screen (Settings stays reachable to set Google up). */
  readonly ready = computed(() => this.google.status() !== null);
  readonly gated = computed(() => this.ready() && !this.google.signedIn() && !this.url().startsWith('/settings'));

  readonly find = signal('');
  readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  /** The UKMAC overview stands alone: no sidebar, no top bar. */
  readonly onHome = computed(() => ['/', '/settings'].includes(this.url().split(/[?#]/)[0]));

  /** Inside a MAC the menu is just that MAC's tables. */
  readonly inMac = computed(() => this.url().startsWith('/mac/'));

  readonly openMacId = computed(() => (/^\/mac\/(\d+)/.exec(this.url()) ? (this.store.mac()?.macId ?? null) : null));

  /** The MACs, as the find box narrows them. */
  readonly shownMacs = computed(() => {
    const words = this.find().trim().toLowerCase();
    return this.macs
      .macs()
      .filter(
        (mac) =>
          (!this.inMac() || this.openMacId() === mac.macId) &&
          (!words ||
          `${mac.macName} ${mac.macCode} ${mac.macLocation ?? ''}`.toLowerCase().includes(words) ||
          (this.openMacId() === mac.macId && this.shownHeadings().length > 0)),
      );
  });

  /** The open MAC's tables under their headings, as the search narrows them. */
  readonly shownHeadings = computed(() => {
    const words = this.find().trim().toLowerCase();
    if (!words) return this.store.headings();
    return this.store
      .headings()
      .map((group) => ({ ...group, sheets: group.sheets.filter((sheet) => `${group.heading} ${sheet.title}`.toLowerCase().includes(words)) }))
      .filter((group) => group.sheets.length);
  });

  /** Where the farm sits (the system's "Farm Layout"): the Setup tables, shown as plain links. */
  readonly layoutGroup = computed(() => this.shownHeadings().find((group) => group.heading === 'Setup') ?? null);

  /** The Zone Map page, unless the menu search leaves it out. */
  readonly showZoneMap = computed(() => {
    const words = this.find().trim().toLowerCase();
    return !words || 'zone map farm layout'.includes(words);
  });

  /** The Data Check page, unless the menu search leaves it out. */
  readonly showDataCheck = computed(() => {
    const words = this.find().trim().toLowerCase();
    return !words || 'data check missing empty columns records'.includes(words);
  });

  /** How many columns, over the open MAC's tables with records, still need input: what the Data Check link counts. */
  readonly dataToFill = computed(() =>
    this.store.sheets().reduce((sum, sheet) => {
      if (!sheet.rows.length) return sum;
      const gaps = tableGaps(sheet);
      return sum + gaps.none + gaps.partly;
    }, 0),
  );

  /** Everything else, as the system's "Farm Progress" groups. */
  readonly progressGroups = computed(() => this.shownHeadings().filter((group) => group.heading !== 'Setup'));

  /** Groups are open unless folded by hand; what's folded or opened is remembered on this Mac, between pages and launches. */
  private readonly manual = signal<ReadonlyMap<string, boolean>>(readNavGroups());

  isOpen(heading: string) {
    if (this.find().trim()) return true;
    return this.manual().get(heading) ?? true;
  }

  toggleHeading(heading: string) {
    const open = !this.isOpen(heading);
    this.manual.update((map) => new Map(map).set(heading, open));
    try {
      localStorage.setItem(NAV_GROUPS_KEY, JSON.stringify([...this.manual()]));
    } catch {
      /* kept for this run only */
    }
  }

  /** Where you are, for the top bar. */
  readonly crumbs = computed<Crumb[]>(() => {
    const url = this.url();
    const crumbs: Crumb[] = [{ label: 'UKMAC', link: ['/'] }];
    if (url.startsWith('/settings')) crumbs.push({ label: 'Settings' });
    const mac = this.store.mac();
    const match = /^\/mac\/(\d+)(?:\/table\/(\d+))?/.exec(url);
    if (match && mac) {
      crumbs.push({ label: mac.macName, link: ['/mac', mac.macId] });
      if (url.includes('/zone-map')) crumbs.push({ label: 'Zone Map' });
      if (url.includes('/weather')) crumbs.push({ label: 'Weather' });
      if (url.includes('/data-check')) crumbs.push({ label: 'Data Check' });
      const sheet = match[2] ? this.store.sheet(Number(match[2])) : null;
      if (sheet) crumbs.push({ label: sheet.heading }, { label: sheet.title });
    }
    return crumbs;
  });

  /** The Google Sheet the open table reads (not while its dashboard is being edited). */
  readonly tableLink = computed(() => {
    const url = this.url();
    const match = /^\/mac\/\d+\/table\/(\d+)/.exec(url);
    if (!match || /[?&]view=dashboard\b/.test(url)) return null;
    return this.google.linkOf(Number(match[1]));
  });

  /** A table's page is open (its rows or its sheet, not its dashboard): the top bar shows its Columns button. */
  readonly onTable = computed(() => {
    const url = this.url();
    return /^\/mac\/\d+\/table\/\d+/.test(url) && !/[?&]view=dashboard\b/.test(url);
  });

  /** The MAC's own page is open: the top bar shows Connect Google Sheet for it (its id). */
  readonly onMacPage = computed(() => {
    const match = /^\/mac\/(\d+)\/?(?:[?#].*)?$/.exec(this.url());
    return match ? Number(match[1]) : null;
  });

  constructor() {
    // Another account (or none) sees another set of MACs: nothing of the last one stays on screen.
    effect(() => {
      const status = this.google.status();
      if (!status) return;
      const account = status.signedIn ? (status.email ?? '').trim().toLowerCase() || null : null;
      untracked(() => this.accountChanged(account));
    });
  }

  private accountChanged(account: string | null) {
    if (this.account === account) return;
    const first = this.account === undefined;
    this.account = account;
    this.store.workbook.set(null);
    void this.macs.refresh();
    void this.google.refreshLinks();
    if (account) void this.google.claimUnowned();
    if (!first && !this.onHome()) void this.router.navigate(['/']);
  }

  ngOnInit() {
    void this.api.computerName().then((name) => this.computer.set(name.trim())).catch(() => undefined);
    void this.macs.refresh();
    void this.powerBi.init();
    void this.google.init().then(() => this.autoSync.init());
    // A restart for an update waits while an edit is being saved or a Google sheet is being read.
    this.updater.writing = () => this.store.saving() > 0 || this.google.syncing().size > 0;
    void this.updater.checkOnStart();
  }

  /** Every table linked to a Google Sheet, for the top bar's Sync. */
  readonly linked = computed(() => this.google.links().length);
  /** How far Sync (all) is: tables read of tables to read; null when it isn't reading. */
  readonly progress = signal<{ done: number; total: number } | null>(null);
  /** Whether Sync (all) is reading now (a table's own read counts too, so the button doesn't offer a second one). */
  readonly syncingAll = computed(() => this.progress() !== null || this.google.syncing().size > 0);

  /**
   * Reads every table linked to a Google Sheet (each sheet downloaded once). A table open in Open in sheet is left out:
   * a read replaces its rows, which would race the spreadsheet's own saves.
   */
  async syncAll() {
    if (this.syncingAll()) return;
    const held = this.autoSync.held();
    const links = this.google.links();
    const ids = links.filter((link) => !held.has(link.sheetId)).map((link) => link.sheetId);
    const left = links.length - ids.length;
    if (!ids.length) {
      this.toasts.show('Close the sheet view to sync that table.', 'info');
      return;
    }
    this.progress.set({ done: 0, total: ids.length });
    let outcomes: Awaited<ReturnType<Google['syncMany']>>;
    try {
      outcomes = await this.google.syncMany(ids, (done, total) => this.progress.set({ done, total }));
    } finally {
      this.progress.set(null);
    }
    const failed = [...outcomes.values()].filter((outcome): outcome is Error => outcome instanceof Error);
    const read = outcomes.size - failed.length;
    if (failed.length) {
      this.toasts.error(`${read} of ${outcomes.size} tables read. ${errorText(failed[0])}`);
    } else {
      this.toasts.show(`${read} table${read === 1 ? '' : 's'} read from Google${left ? ` · ${left} open in sheet view left for now` : ''}`, 'ok');
    }
  }

  headingIcon(heading: string) {
    return HEADING_ICONS[heading] ?? 'table';
  }

  initial(name: string) {
    return (name.trim()[0] ?? '?').toUpperCase();
  }
}

const NAV_GROUPS_KEY = 'ukmac.nav-groups';

/** The sidebar groups folded or opened by hand, as last left. */
function readNavGroups(): ReadonlyMap<string, boolean> {
  try {
    const saved = JSON.parse(localStorage.getItem(NAV_GROUPS_KEY) ?? '[]');
    return new Map(Array.isArray(saved) ? saved.filter((entry) => Array.isArray(entry) && typeof entry[1] === 'boolean') : []);
  } catch {
    return new Map();
  }
}
