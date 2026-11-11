import { TestBed } from '@angular/core/testing';

import { baseName } from './paths';
import { Toasts } from './toast';
import { AppUpdater, type PendingUpdate, type UpdateEvent, type UpdaterBackend } from './updater';

function pending(run: (onEvent: (event: UpdateEvent) => void) => Promise<void> = async () => {}): PendingUpdate {
  return { version: '0.2.0', currentVersion: '0.1.0', body: 'Faster tables', downloadAndInstall: async (onEvent) => run(onEvent ?? (() => {})) };
}

function setup(found: PendingUpdate | null | Error, quietly = false) {
  const relaunch = vi.fn(async () => {});
  const backend: UpdaterBackend = {
    ...(quietly ? { installsQuietly: () => true } : {}),
    version: async () => '0.1.0',
    check: async () => {
      if (found instanceof Error) throw found;
      return found;
    },
    relaunch,
  };
  const updater = TestBed.inject(AppUpdater);
  updater.backend = backend;
  return { updater, relaunch, toasts: TestBed.inject(Toasts) };
}

describe('AppUpdater', () => {
  it('reads the running version', async () => {
    const { updater } = setup(null);
    await updater.loadVersion();
    expect(updater.version()).toBe('0.1.0');
  });

  it('says so when this is the newest version', async () => {
    const { updater } = setup(null);
    await updater.check();
    expect(updater.state()).toBe('current');
    expect(updater.update()).toBeNull();
    expect(updater.lastChecked()).not.toBeNull();
  });

  it('keeps the new version found, with its notes', async () => {
    const { updater } = setup(pending());
    await updater.check();
    expect(updater.state()).toBe('available');
    expect(updater.update()?.version).toBe('0.2.0');
    expect(updater.update()?.body).toBe('Faster tables');
  });

  it('shows a plain error when the check fails by hand, and none when it runs by itself', async () => {
    const loud = setup(new Error('error sending request for url'));
    await loud.updater.check();
    expect(loud.updater.state()).toBe('error');
    expect(loud.updater.error()).toContain('Check the internet connection');

    TestBed.resetTestingModule();
    const quiet = setup(new Error('error sending request for url'));
    await quiet.updater.check(true);
    expect(quiet.updater.state()).toBe('idle');
    expect(quiet.updater.error()).toBeNull();
  });

  it('downloads with progress, installs, and then restarts', async () => {
    const seen: (number | null)[] = [];
    let updater!: AppUpdater;
    const found = pending(async (onEvent) => {
      onEvent({ event: 'Started', data: { contentLength: 200 } });
      onEvent({ event: 'Progress', data: { chunkLength: 50 } });
      seen.push(updater.percent());
      onEvent({ event: 'Progress', data: { chunkLength: 150 } });
      seen.push(updater.percent());
      onEvent({ event: 'Finished' });
    });
    const made = setup(found);
    updater = made.updater;
    await updater.check();
    await updater.install();
    expect(seen).toEqual([25, 100]);
    expect(updater.state()).toBe('installed');
    expect(made.relaunch).toHaveBeenCalledTimes(1);
  });

  it('does not restart when the install fails, and says why', async () => {
    const made = setup(
      pending(async () => {
        throw new Error('signature verification failed');
      }),
    );
    await made.updater.check();
    await made.updater.install();
    expect(made.updater.state()).toBe('error');
    expect(made.updater.error()).toContain('not installed');
    expect(made.relaunch).not.toHaveBeenCalled();
  });

  it('offers the update in a message at start, once', async () => {
    vi.useFakeTimers();
    try {
      const made = setup(pending());
      const first = made.updater.checkOnStart(10);
      await vi.advanceTimersByTimeAsync(20);
      await first;
      expect(made.toasts.items().map((toast) => toast.text)).toEqual(['Version 0.2.0 is ready.']);
      expect(made.toasts.items()[0].action?.label).toBe('Update');
      await made.updater.checkOnStart(10); // already looked this run
      expect(made.toasts.items()).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(20000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a version already found when a later quiet look fails', async () => {
    let answer: PendingUpdate | Error = pending();
    const made = setup(null);
    made.updater.backend = {
      version: async () => '0.1.0',
      check: async () => {
        if (answer instanceof Error) throw answer;
        return answer;
      },
      relaunch: made.relaunch,
    };
    await made.updater.check(true);
    expect(made.updater.offered()).toBe(true);
    answer = new Error('error sending request for url');
    await made.updater.check(true);
    expect(made.updater.offered()).toBe(true);
    expect(made.updater.state()).toBe('available');
    expect(made.updater.error()).toBeNull();
    await made.updater.check(); // asked for by hand: now it says so
    expect(made.updater.state()).toBe('error');
    expect(made.updater.offered()).toBe(false);
  });

  it('looks again while the app stays open, and says so once per version', async () => {
    vi.useFakeTimers();
    try {
      let version = '0.2.0';
      const made = setup(null);
      made.updater.backend = {
        version: async () => '0.1.0',
        check: async () => ({ ...pending(), version }),
        relaunch: made.relaunch,
      };
      const first = made.updater.checkOnStart(10, 1000);
      await vi.advanceTimersByTimeAsync(20);
      await first;
      expect(made.toasts.items()).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1000); // the same version again: no second message
      expect(made.toasts.items()).toHaveLength(1);
      version = '0.3.0';
      await vi.advanceTimersByTimeAsync(1000);
      expect(made.toasts.items().map((toast) => toast.text)).toEqual(['Version 0.2.0 is ready.', 'Version 0.3.0 is ready.']);
      expect(made.updater.update()?.version).toBe('0.3.0');
      await vi.advanceTimersByTimeAsync(20000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for a save to finish before it restarts', async () => {
    let writing = true;
    const made = setup(pending());
    made.updater.writing = () => writing;
    await made.updater.check();
    const done = made.updater.install();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(made.relaunch).not.toHaveBeenCalled();
    expect(made.updater.state()).toBe('installed');
    writing = false;
    await done;
    expect(made.relaunch).toHaveBeenCalledTimes(1);
  });
});

describe('baseName', () => {
  it('takes the file name from a Mac or a Windows path', () => {
    expect(baseName('/Users/a/Farm A.ukmac')).toBe('Farm A.ukmac');
    expect(baseName('C:\\Users\\a\\Farm A.ukmac')).toBe('Farm A.ukmac');
    expect(baseName('plain.xlsx')).toBe('plain.xlsx');
  });

  describe('where it can be put in place while the app runs (the Mac)', () => {
    it('installs the new version by itself, with no restart and no click, and says it starts next time', async () => {
      vi.useFakeTimers();
      try {
        const made = setup(pending(), true);
        const first = made.updater.checkOnStart(10);
        await vi.advanceTimersByTimeAsync(20);
        await first;
        expect(made.updater.state()).toBe('ready');
        expect(made.updater.installedVersion()).toBe('0.2.0');
        // Nothing is offered any more, and the app was not restarted.
        expect(made.updater.offered()).toBe(false);
        expect(made.relaunch).not.toHaveBeenCalled();
        expect(made.toasts.items().map((toast) => toast.text)).toEqual(['Version 0.2.0 is installed. It starts the next time you open the app.']);
        expect(made.toasts.items()[0].action?.label).toBe('Restart now');
        // The next look finds the same version (this copy is still the old one): it is not downloaded again or offered again.
        await made.updater.check(true);
        expect(made.updater.state()).toBe('ready');
        expect(made.updater.offered()).toBe(false);
        await vi.advanceTimersByTimeAsync(20000);
      } finally {
        vi.useRealTimers();
      }
    });

    it('opens the installed version when asked to', async () => {
      const made = setup(pending(), true);
      await made.updater.check();
      // (the quiet install runs from the start-up look; here it is driven the way the start-up look does)
      vi.useFakeTimers();
      try {
        const first = made.updater.checkOnStart(1);
        await vi.advanceTimersByTimeAsync(10);
        await first;
        await made.updater.restartNow();
        expect(made.relaunch).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(20000);
      } finally {
        vi.useRealTimers();
      }
    });

    it('leaves the Update button to try again when the quiet install fails', async () => {
      vi.useFakeTimers();
      try {
        const made = setup(pending(async () => { throw new Error('signature verification failed'); }), true);
        const first = made.updater.checkOnStart(10);
        await vi.advanceTimersByTimeAsync(20);
        await first;
        expect(made.updater.state()).toBe('available');
        expect(made.updater.offered()).toBe(true);
        expect(made.relaunch).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(20000);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
