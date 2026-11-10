import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';

import { Icon } from './components/icon';
import { UpdateButton } from './components/update-button';
import { Google } from './core/google';
import { MacList } from './core/mac-list';
import { PowerBi } from './core/powerbi';
import { Shell } from './core/shell';
import { Toasts } from './core/toast';
import { AppUpdater } from './core/updater';
import { WorkbookStore } from './core/workbook-store';

const HEADING_ICONS: Record<string, string> = {
  Setup: 'map',
  Nursery: 'seedling',
  Planting: 'sprout',
  'QA/QC': 'check',
  Inventory: 'package',
  Operational: 'wallet',
};

interface Crumb {
  label: string;
  link?: unknown[];
}

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, UpdateButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  readonly macs = inject(MacList);
  readonly store = inject(WorkbookStore);
  readonly toasts = inject(Toasts);
  readonly powerBi = inject(PowerBi);
  private readonly google = inject(Google);
  private readonly updater = inject(AppUpdater);
  readonly shell = inject(Shell);
  private readonly router = inject(Router);

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
    if (url.startsWith('/settings')) crumbs.push({ label: 'Connections & backup' });
    const mac = this.store.mac();
    const match = /^\/mac\/(\d+)(?:\/table\/(\d+))?/.exec(url);
    if (match && mac) {
      crumbs.push({ label: mac.macName, link: ['/mac', mac.macId] });
      if (url.includes('/zone-map')) crumbs.push({ label: 'Zone Map' });
      const sheet = match[2] ? this.store.sheet(Number(match[2])) : null;
      if (sheet) crumbs.push({ label: sheet.heading }, { label: sheet.title });
    }
    return crumbs;
  });

  ngOnInit() {
    void this.macs.refresh();
    void this.powerBi.init();
    void this.google.init();
    // A restart for an update waits while an edit is being saved or a Google sheet is being read.
    this.updater.writing = () => this.store.saving() > 0 || this.google.syncing().size > 0;
    void this.updater.checkOnStart();
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
