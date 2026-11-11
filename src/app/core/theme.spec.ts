import { TestBed } from '@angular/core/testing';

import { readTheme, Theme, THEME_DEFAULTS, THEME_KEY } from './theme';

describe('Settings → Theme', () => {
  beforeEach(() => {
    localStorage.clear();
    const root = document.documentElement;
    delete root.dataset['accent'];
    delete root.dataset['density'];
    root.style.removeProperty('--cell-px');
  });

  it('starts with the defaults and puts them on the page', () => {
    const theme = TestBed.inject(Theme);
    TestBed.flushEffects();
    expect([theme.accent(), theme.rowHeight(), theme.columnSpacing()]).toEqual(['blue', 'default', 'normal']);
    expect(document.documentElement.dataset['accent']).toBe('blue');
    expect(document.documentElement.dataset['density']).toBe('default');
    expect(document.documentElement.style.getPropertyValue('--cell-px')).toBe('16px');
  });

  it('changes the page at once and keeps the choices for next time', () => {
    const theme = TestBed.inject(Theme);
    theme.update({ accent: 'sage', rowHeight: 'compact', columnSpacing: 'wide' });
    TestBed.flushEffects();
    expect(document.documentElement.dataset['accent']).toBe('sage');
    expect(document.documentElement.dataset['density']).toBe('compact');
    expect(document.documentElement.style.getPropertyValue('--cell-px')).toBe('24px');
    expect(JSON.parse(localStorage.getItem(THEME_KEY)!)).toEqual({ accent: 'sage', rowHeight: 'compact', columnSpacing: 'wide' });
    // Changing one choice leaves the others.
    theme.update({ accent: 'peach' });
    expect(JSON.parse(localStorage.getItem(THEME_KEY)!)).toEqual({ accent: 'peach', rowHeight: 'compact', columnSpacing: 'wide' });
  });

  it('reads what was kept at the next start', () => {
    localStorage.setItem(THEME_KEY, JSON.stringify({ accent: 'lavender', rowHeight: 'comfortable', columnSpacing: 'narrow' }));
    const theme = TestBed.inject(Theme);
    expect([theme.accent(), theme.rowHeight(), theme.columnSpacing()]).toEqual(['lavender', 'comfortable', 'narrow']);
  });

  it('goes back to the defaults', () => {
    const theme = TestBed.inject(Theme);
    theme.update({ accent: 'teal', rowHeight: 'compact' });
    theme.reset();
    expect([theme.accent(), theme.rowHeight(), theme.columnSpacing()]).toEqual(['blue', 'default', 'normal']);
  });

  it('reads anything damaged or unknown as the default', () => {
    expect(readTheme(null)).toEqual(THEME_DEFAULTS);
    expect(readTheme('not json')).toEqual(THEME_DEFAULTS);
    expect(readTheme(JSON.stringify({ accent: 'hotpink', rowHeight: 'huge', columnSpacing: 3 }))).toEqual(THEME_DEFAULTS);
    expect(readTheme(JSON.stringify({ accent: 'teal' }))).toEqual({ ...THEME_DEFAULTS, accent: 'teal' });
  });
});
