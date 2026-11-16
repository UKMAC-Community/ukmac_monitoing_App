import {
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  input,
  output,
  viewChild,
} from '@angular/core';

import { Icon } from './icon';

/** The system's dialog (its .modal-dialog look) on the native <dialog>: Esc, ✕ or the scrim close it. */
@Component({
  selector: 'app-modal',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog
      #dialog
      class="modal-dialog"
      [class.is-wide]="size() === 'wide'"
      [class.is-xwide]="size() === 'xwide'"
      [class.is-full]="size() === 'full'"
      (cancel)="$event.preventDefault(); closed.emit()"
      (mousedown)="backdrop($event)"
    >
      <header class="modal-header">
        <div>
          <h2 class="modal-title">{{ title() }}</h2>
          @if (subtitle()) {
            <p class="modal-sub">{{ subtitle() }}</p>
          }
        </div>
        <button type="button" class="modal-close" aria-label="Close" (click)="closed.emit()">
          <app-icon name="x" [size]="14" />
        </button>
      </header>
      <div class="modal-body">
        <ng-content />
      </div>
      <footer class="modal-footer">
        <ng-content select="[footer]" />
      </footer>
    </dialog>
  `,
  styles: `
    .modal-footer:empty { display: none; }
  `,
})
export class Modal {
  readonly open = input(false);
  readonly title = input('');
  readonly subtitle = input('');
  readonly size = input<'normal' | 'wide' | 'xwide' | 'full'>('normal');
  readonly closed = output<void>();
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    effect(() => {
      const element = this.dialog().nativeElement;
      if (this.open() && !element.open) element.showModal();
      if (!this.open() && element.open) element.close();
    });
  }

  backdrop(event: MouseEvent) {
    if (event.target === this.dialog().nativeElement) this.closed.emit();
  }
}
