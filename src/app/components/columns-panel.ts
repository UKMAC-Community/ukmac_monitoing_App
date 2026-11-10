import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, effect, input, output, signal } from '@angular/core';

import type { Column } from '../core/models';
import { columnLabel, typeLabel } from '../sheet/columns';
import { Icon } from './icon';
import { Modal } from './modal';

/** Every column of a table: drag them into order, open one to change it, or delete it. */
@Component({
  selector: 'app-columns-panel',
  imports: [Modal, Icon, CdkDropList, CdkDrag, CdkDragHandle],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal [open]="open()" title="Columns" [subtitle]="title() + ' · drag to change the order'" size="wide" (closed)="closed.emit()">
      <div class="list" cdkDropList (cdkDropListDropped)="drop($event)">
        @for (column of order(); track column.key; let i = $index) {
          <div class="item" cdkDrag cdkDragPreviewContainer="parent" [cdkDragData]="column">
            <span class="grip" cdkDragHandle><app-icon name="grip" /></span>
            <span class="index">{{ i + 1 }}</span>
            <div class="what">
              <strong>{{ label(column) }}</strong>
              @if (column.box || column.group) {
                <small class="muted">{{ column.box }}{{ column.box && column.group ? ' › ' : '' }}{{ column.group }}</small>
              }
            </div>
            <span class="badge neutral" [class.info]="column.type === 'formula'">{{ type(column) }}</span>
            @if (column.required) {
              <span class="badge neutral">required</span>
            }
            <button type="button" class="icon-btn is-quiet" title="Edit" (click)="edit.emit(column)"><app-icon name="edit" /></button>
            <button type="button" class="icon-btn is-quiet" title="Delete" (click)="remove.emit(column)"><app-icon name="trash" /></button>
          </div>
        } @empty {
          <p class="empty">No columns yet.</p>
        }
      </div>
      <ng-container footer>
        <button type="button" class="btn btn-secondary" (click)="add.emit()"><app-icon name="plus" /> Add column</button>
        <span class="spacer"></span>
        <button type="button" class="btn btn-secondary" (click)="closed.emit()">Close</button>
        <button type="button" class="btn btn-primary" [disabled]="!moved()" (click)="reordered.emit(order())">Save order</button>
      </ng-container>
    </app-modal>
  `,
  styles: `
    .list { display: flex; flex-direction: column; gap: 4px; }
    .item {
      display: flex; align-items: center; gap: 10px; padding: 6px 8px; border: 1px solid var(--line);
      border-radius: 8px; background: #fff;
    }
    .grip { cursor: grab; color: var(--faint); display: inline-flex; }
    .index { width: 26px; color: var(--faint); font-size: 12px; text-align: right; font-variant-numeric: tabular-nums; }
    .what { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    .what strong { font-weight: 600; font-size: 13px; }
    .what small { font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .spacer { flex: 1; }
    .cdk-drag-preview { box-shadow: 0 8px 24px rgb(0 0 0 / 0.18); border-radius: 8px; }
    .cdk-drag-placeholder { opacity: 0.3; }
    .cdk-drag-animating, .list.cdk-drop-list-dragging .item:not(.cdk-drag-placeholder) { transition: transform 200ms ease; }
  `,
})
export class ColumnsPanel {
  readonly open = input(false);
  readonly title = input('');
  readonly columns = input.required<Column[]>();
  readonly closed = output<void>();
  readonly edit = output<Column>();
  readonly remove = output<Column>();
  readonly add = output<void>();
  readonly reordered = output<Column[]>();


  readonly order = signal<Column[]>([]);
  readonly moved = signal(false);

  constructor() {
    effect(() => {
      this.order.set([...this.columns()]);
      this.moved.set(false);
    });
  }

  label(column: Column) {
    return columnLabel(column);
  }

  type(column: Column) {
    return typeLabel(column.type);
  }

  drop(event: CdkDragDrop<Column[]>) {
    if (event.previousIndex === event.currentIndex) return;
    const next = [...this.order()];
    moveItemInArray(next, event.previousIndex, event.currentIndex);
    this.order.set(next);
    this.moved.set(true);
  }
}
