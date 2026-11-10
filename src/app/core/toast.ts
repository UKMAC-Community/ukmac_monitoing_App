import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  text: string;
  tone: 'ok' | 'error' | 'info';
  action?: { label: string; run: () => void };
}

/** Short messages at the bottom of the window: "120 rows saved". */
@Injectable({ providedIn: 'root' })
export class Toasts {
  readonly items = signal<Toast[]>([]);
  private next = 1;

  show(text: string, tone: Toast['tone'] = 'ok', action?: Toast['action'], ms = 5000) {
    const id = this.next++;
    this.items.update((items) => [...items.slice(-3), { id, text, tone, action }]);
    setTimeout(() => this.dismiss(id), tone === 'error' ? Math.max(ms, 8000) : ms);
  }

  error(text: string) {
    this.show(text, 'error');
  }

  dismiss(id: number) {
    this.items.update((items) => items.filter((item) => item.id !== id));
  }
}
