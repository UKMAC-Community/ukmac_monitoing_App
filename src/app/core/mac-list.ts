import { inject, Injectable, signal } from '@angular/core';

import { Api, errorText } from './api';
import type { ImportedMac, Mac, MacInput } from './models';
import { PowerBi } from './powerbi';
import { Toasts } from './toast';

/** Every MAC on this Mac, for the sidebar and the home page. */
@Injectable({ providedIn: 'root' })
export class MacList {
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  private readonly powerBi = inject(PowerBi);

  readonly macs = signal<Mac[]>([]);
  readonly loaded = signal(false);

  async refresh() {
    try {
      this.macs.set(await this.api.listMacs());
    } catch (error) {
      this.toasts.error(errorText(error));
    } finally {
      this.loaded.set(true);
    }
  }

  async create(input: MacInput) {
    const mac = await this.api.createMac(input);
    await this.refresh();
    this.powerBi.changed();
    return mac;
  }

  async update(macId: number, input: MacInput) {
    const mac = await this.api.updateMac(macId, input);
    await this.refresh();
    this.powerBi.changed();
    return mac;
  }

  /** Adds the MAC saved in a `.ukmac` file (`replace`: in place of the same MAC here). */
  async importFile(path: string, replace: boolean): Promise<ImportedMac> {
    const done = await this.api.importMacFile(path, replace);
    await this.refresh();
    this.powerBi.changed();
    return done;
  }

  async remove(macId: number) {
    await this.api.deleteMac(macId);
    await this.refresh();
    this.powerBi.changed();
  }
}
