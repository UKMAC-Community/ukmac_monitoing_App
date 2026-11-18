import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Icon } from '@shared/ui/icon';
import { WorkbookStore } from '@core/workbook-store';
import { DataGaps } from '@features/dashboard/data-gaps-panel';
import { QaQcCheck } from './qa-qc-check-panel';

/** Data Check: for each table of the MAC, which columns have nothing entered (and which are only partly filled); under it, the QA/QC Check. */
@Component({
  selector: 'app-data-check-page',
  imports: [RouterLink, Icon, DataGaps, QaQcCheck],
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
        <app-qa-qc-check [sheets]="store.sheets()" />
      </div>
    }
  `,
})
export class DataCheckPage {
  readonly store = inject(WorkbookStore);
}
