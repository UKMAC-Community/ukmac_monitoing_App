import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal } from '@angular/core';

import { errorText } from '../core/api';
import { MacList } from '../core/mac-list';
import type { Mac, MacInput } from '../core/models';
import { Modal } from './modal';

const CHILI_TABLES =
  'Zones, Chili Varieties, Nursery Batches, Zone Records, Soil Preparation, Irrigation, Fertigation, Pruning, Pesticides, Harvest, QA/QC Management (the 10-stage QC form), Planting Date, Inventory Management, Finance & Accounting';

/** Makes a MAC (a farm), or changes one. */
@Component({
  selector: 'app-mac-dialog',
  imports: [Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal
      [open]="open()"
      [title]="mac() ? 'Edit MAC' : 'New MAC'"
      [subtitle]="mac() ? mac()!.macName : 'A chili farm. Its tables are kept on this Mac.'"
      (closed)="closed.emit()"
    >
      <form id="mac-form" class="form-stack" (submit)="$event.preventDefault(); save()">
        <div class="form-grid">
          <label class="form-group">
            <span class="form-label">Name *</span>
            <input class="input-field" [value]="name()" (input)="name.set(value($event))" placeholder="Battambang - Tmor Kol" />
          </label>
          <label class="form-group">
            <span class="form-label">Code *</span>
            <input class="input-field" [value]="code()" (input)="code.set(value($event))" placeholder="BTB-1022" />
            <small class="form-hint">Each MAC's own. Shown on every row in Power BI.</small>
          </label>
        </div>
        <label class="form-group">
          <span class="form-label">Location</span>
          <input class="input-field" [value]="location()" (input)="location.set(value($event))" placeholder="Province, district, village" />
        </label>
        <div class="form-grid">
          <label class="form-group">
            <span class="form-label">Latitude</span>
            <input class="input-field" inputmode="decimal" [value]="latitude()" (input)="latitude.set(value($event))" placeholder="13.0957" />
          </label>
          <label class="form-group">
            <span class="form-label">Longitude</span>
            <input class="input-field" inputmode="decimal" [value]="longitude()" (input)="longitude.set(value($event))" placeholder="103.2022" />
          </label>
        </div>
        <div class="form-grid">
          <label class="form-group">
            <span class="form-label">Start date</span>
            <input class="input-field" type="date" [value]="startDate()" (input)="startDate.set(value($event))" />
          </label>
          <label class="form-group">
            <span class="form-label">End date</span>
            <input class="input-field" type="date" [value]="endDate()" (input)="endDate.set(value($event))" />
          </label>
        </div>
        <label class="form-group">
          <span class="form-label">Note</span>
          <textarea class="input-field" rows="2" [value]="note()" (input)="note.set(value($event))"></textarea>
        </label>
        @if (!mac()) {
          <label class="check-label template">
            <input type="checkbox" class="checkbox" [checked]="useTemplate()" (change)="useTemplate.set(checked($event))" />
            <span>
              <strong>Start with the chili tables</strong>
              <small class="muted">{{ tables }}. Every one can be renamed, changed or deleted.</small>
            </span>
          </label>
        }
        @if (error()) {
          <div class="alert-box error">{{ error() }}</div>
        }
      </form>
      <ng-container footer>
        <button type="button" class="btn btn-secondary" (click)="closed.emit()">Cancel</button>
        <button type="submit" form="mac-form" class="btn btn-primary" [disabled]="busy()">
          {{ mac() ? 'Save' : 'Create MAC' }}
        </button>
      </ng-container>
    </app-modal>
  `,
  styles: `
    .template { align-items: flex-start; padding: 12px; border-radius: 10px; background: var(--accent-soft); margin-bottom: 12px; }
    .template span { display: flex; flex-direction: column; gap: 3px; }
    .template small { font-size: 12px; line-height: 1.45; }
    .alert { margin-top: 4px; }
  `,
})
export class MacDialog {
  private readonly macs = inject(MacList);
  readonly open = input(false);
  readonly mac = input<Mac | null>(null);
  readonly closed = output<void>();
  readonly saved = output<Mac>();

  readonly tables = CHILI_TABLES;
  readonly name = signal('');
  readonly code = signal('');
  readonly location = signal('');
  readonly latitude = signal('');
  readonly longitude = signal('');
  readonly startDate = signal('');
  readonly endDate = signal('');
  readonly note = signal('');
  readonly useTemplate = signal(true);
  readonly error = signal('');
  readonly busy = signal(false);

  constructor() {
    effect(() => {
      if (!this.open()) return;
      const mac = this.mac();
      this.name.set(mac?.macName ?? '');
      this.code.set(mac?.macCode ?? '');
      this.location.set(mac?.macLocation ?? '');
      this.latitude.set(mac?.latitude?.toString() ?? '');
      this.longitude.set(mac?.longitude?.toString() ?? '');
      this.startDate.set(mac?.startDate ?? '');
      this.endDate.set(mac?.endDate ?? '');
      this.note.set(mac?.note ?? '');
      this.useTemplate.set(true);
      this.error.set('');
    });
  }

  value(event: Event) {
    return (event.target as HTMLInputElement).value;
  }

  checked(event: Event) {
    return (event.target as HTMLInputElement).checked;
  }

  private coordinate(text: string, label: string): number | null {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const number = Number(trimmed);
    if (!Number.isFinite(number)) throw new Error(`${label}: use a number like 13.0957`);
    return number;
  }

  async save() {
    this.error.set('');
    let input: MacInput;
    try {
      input = {
        macName: this.name(),
        macCode: this.code(),
        macLocation: this.location(),
        latitude: this.coordinate(this.latitude(), 'Latitude'),
        longitude: this.coordinate(this.longitude(), 'Longitude'),
        startDate: this.startDate() || null,
        endDate: this.endDate() || null,
        note: this.note(),
        crop: 'chili',
        useTemplate: this.useTemplate(),
      };
    } catch (error) {
      this.error.set(errorText(error));
      return;
    }
    this.busy.set(true);
    try {
      const mac = this.mac();
      const saved = mac ? await this.macs.update(mac.macId, input) : await this.macs.create(input);
      this.saved.emit(saved);
    } catch (error) {
      this.error.set(errorText(error));
    } finally {
      this.busy.set(false);
    }
  }
}
