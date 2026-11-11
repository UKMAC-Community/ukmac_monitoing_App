import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Icon } from '../components/icon';
import { WorkbookStore } from '../core/workbook-store';
import { DataGaps } from '../dashboard/data-gaps-panel';

/** Data Check: for each table of the MAC, which columns have nothing entered (and which are only partly filled). */
@Component({
  selector: 'app-data-check-page',
  imports: [RouterLink, Icon, DataGaps],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.mac(); as mac) {
      <div class="page">
        <header class="page-header">
          <a class="page-back-icon" [routerLink]="['/mac', mac.macId]" title="Back to the dashboard" aria-label="Back"><app-icon name="arrow-left" [size]="16" /></a>
          <div class="page-header-text">
            <h1 class="page-title">Data Check <span class="badge neutral">{{ mac.macCode }}</span></h1>
            <p class="page-desc">What each table of {{ mac.macName }} still lacks: the columns with no input, and how many records have them filled in.</p>
          </div>
        </header>
        <app-data-gaps [sheets]="store.sheets()" />
      </div>
    }
  `,
})
export class DataCheckPage {
  readonly store = inject(WorkbookStore);
}
