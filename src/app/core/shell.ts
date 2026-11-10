import { Injectable, signal } from '@angular/core';

/** The sidebar: open, or folded to its icon rail (folded only while a table is open as a spreadsheet, as the system's sheet view does). */
@Injectable({ providedIn: 'root' })
export class Shell {
  readonly collapsed = signal(false);
  private before: boolean | null = null;

  toggle() {
    this.collapsed.update((value) => !value);
    this.before = null;
  }

  /** A table opened: fold the sidebar, remembering how it was. */
  enterSheet() {
    if (this.before === null) this.before = this.collapsed();
    this.collapsed.set(true);
  }

  /** Off the table: back to how it was. */
  leaveSheet() {
    if (this.before !== null) this.collapsed.set(this.before);
    this.before = null;
  }
}
