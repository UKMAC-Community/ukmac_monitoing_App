import { TestBed } from '@angular/core/testing';

import { AppUpdater, type PendingUpdate, type UpdateEvent, type UpdaterBackend } from '../core/updater';
import { UpdateButton } from './update-button';

function pending(run: (onEvent: (event: UpdateEvent) => void) => Promise<void> = async () => {}): PendingUpdate {
  return { version: '0.1.2', currentVersion: '0.1.1', downloadAndInstall: async (onEvent) => run(onEvent ?? (() => {})) };
}

function mount(found: PendingUpdate | null) {
  const relaunch = vi.fn(async () => {});
  const backend: UpdaterBackend = { version: async () => '0.1.1', check: async () => found, relaunch };
  const updater = TestBed.inject(AppUpdater);
  updater.backend = backend;
  const fixture = TestBed.createComponent(UpdateButton);
  fixture.detectChanges();
  const button = () => fixture.nativeElement.querySelector('button') as HTMLButtonElement | null;
  return { updater, fixture, button, relaunch };
}

describe('UpdateButton', () => {
  it('is not there when this is the newest version', async () => {
    const { updater, fixture, button } = mount(null);
    await updater.check();
    fixture.detectChanges();
    expect(button()).toBeNull();
  });

  it('shows the new version, and installing it restarts the app', async () => {
    const { updater, fixture, button, relaunch } = mount(pending());
    await updater.check();
    fixture.detectChanges();
    expect(button()?.textContent).toContain('Update to v0.1.2');
    expect(button()?.disabled).toBe(false);
    button()?.click();
    await fixture.whenStable();
    expect(relaunch).toHaveBeenCalledTimes(1);
  });

  it('shows how far the download is, and cannot be pressed twice', async () => {
    let release!: () => void;
    const { updater, fixture, button } = mount(
      pending(async (onEvent) => {
        onEvent({ event: 'Started', data: { contentLength: 200 } });
        onEvent({ event: 'Progress', data: { chunkLength: 50 } });
        await new Promise<void>((resolve) => (release = resolve));
      }),
    );
    await updater.check();
    fixture.detectChanges();
    const running = updater.install();
    fixture.detectChanges();
    expect(button()?.textContent).toContain('Updating… 25%');
    expect(button()?.disabled).toBe(true);
    release();
    await running;
  });

  it('says why when the install fails, and stays for another try', async () => {
    const { updater, fixture, button } = mount(
      pending(async () => {
        throw new Error('signature verification failed');
      }),
    );
    await updater.check();
    fixture.detectChanges();
    button()?.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(button()?.textContent).toContain('Update to v0.1.2');
    expect(button()?.disabled).toBe(false);
  });
});
