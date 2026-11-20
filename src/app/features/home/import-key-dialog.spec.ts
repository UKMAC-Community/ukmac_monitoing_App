import { TestBed } from '@angular/core/testing';

import { ImportKeyDialog } from './import-key-dialog';

describe('ImportKeyDialog', () => {
  beforeAll(() => {
    // jsdom has no modal dialogs.
    const dialog = HTMLDialogElement.prototype as { showModal?: () => void; close?: () => void };
    dialog.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    dialog.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  });

  function make(inputs: { open?: boolean; error?: string; busy?: boolean } = {}) {
    const fixture = TestBed.createComponent(ImportKeyDialog);
    for (const [name, value] of Object.entries({ open: true, ...inputs })) fixture.componentRef.setInput(name, value);
    fixture.detectChanges();
    const sent: string[] = [];
    fixture.componentInstance.submitted.subscribe((key) => sent.push(key));
    return { fixture, sent, root: fixture.nativeElement as HTMLElement };
  }

  it('sends the pasted key without the spaces around it', () => {
    const { fixture, sent } = make();
    fixture.componentInstance.key.set('  UKMAC1-abc\n');
    fixture.componentInstance.submit();
    expect(sent).toEqual(['UKMAC1-abc']);
  });

  it('sends nothing for an empty box, or while it is already working', () => {
    const { fixture, sent } = make();
    fixture.componentInstance.submit();
    fixture.componentInstance.key.set('   ');
    fixture.componentInstance.submit();
    expect(sent).toEqual([]);
    const busy = make({ busy: true });
    busy.fixture.componentInstance.key.set('UKMAC1-abc');
    busy.fixture.componentInstance.submit();
    expect(busy.sent).toEqual([]);
  });

  it('says why a key was refused, in the dialog', () => {
    const { root } = make({ error: 'No access. The Google account a@b.com can’t open the Google Sheet “Farm”, so this key adds nothing.' });
    expect(root.querySelector('.alert-box.error')?.textContent).toContain('No access.');
  });

  it('the Add button waits for a key', () => {
    const { fixture, root } = make();
    const add = () => root.querySelector<HTMLButtonElement>('button[type=submit]')!;
    expect(add().disabled).toBe(true);
    fixture.componentInstance.key.set('UKMAC1-abc');
    fixture.detectChanges();
    expect(add().disabled).toBe(false);
  });
});
