import { effect, Injectable, signal } from '@angular/core';

export type ThemeAccent = 'blue' | 'teal' | 'peach' | 'sage' | 'lavender';
export type RowHeight = 'compact' | 'default' | 'comfortable';
export type ColumnSpacing = 'narrow' | 'normal' | 'wide';

export interface ThemePreferences {
  accent: ThemeAccent;
  rowHeight: RowHeight;
  columnSpacing: ColumnSpacing;
}

/** Each accent's colour for its swatch (the full palettes, light and dark, are in styles/ukmac/tokens.css, picked by `data-accent`). */
export const ACCENTS: { value: ThemeAccent; label: string; swatch: string }[] = [
  { value: 'blue', label: 'Blue', swatch: '#0066d9' },
  { value: 'teal', label: 'Teal', swatch: '#0f766e' },
  { value: 'peach', label: 'Peach', swatch: '#c96a4d' },
  { value: 'sage', label: 'Sage', swatch: '#5f9a72' },
  { value: 'lavender', label: 'Lavender', swatch: '#7c67b0' },
];

export const ROW_HEIGHTS: { value: RowHeight; label: string }[] = [
  { value: 'compact', label: 'Compact' },
  { value: 'default', label: 'Default' },
  { value: 'comfortable', label: 'Comfortable' },
];

export const COLUMN_SPACINGS: { value: ColumnSpacing; label: string }[] = [
  { value: 'narrow', label: 'Narrow' },
  { value: 'normal', label: 'Normal' },
  { value: 'wide', label: 'Wide' },
];

/** The cells' side padding for each spacing (the tables read it as `--cell-px`). */
export const CELL_PADDING: Record<ColumnSpacing, string> = { narrow: '10px', normal: '16px', wide: '24px' };

export const THEME_KEY = 'ukmac.theme.v2';
export const THEME_DEFAULTS: ThemePreferences = { accent: 'blue', rowHeight: 'default', columnSpacing: 'normal' };

/** Anything not one of the known choices (a damaged or older value) reads as the default. */
export function readTheme(raw: string | null): ThemePreferences {
  try {
    const saved = JSON.parse(raw ?? '') as Partial<ThemePreferences>;
    return {
      accent: ACCENTS.some((item) => item.value === saved?.accent) ? saved.accent! : THEME_DEFAULTS.accent,
      rowHeight: ROW_HEIGHTS.some((item) => item.value === saved?.rowHeight) ? saved.rowHeight! : THEME_DEFAULTS.rowHeight,
      columnSpacing: COLUMN_SPACINGS.some((item) => item.value === saved?.columnSpacing) ? saved.columnSpacing! : THEME_DEFAULTS.columnSpacing,
    };
  } catch {
    return { ...THEME_DEFAULTS };
  }
}

/**
 * How the app looks, as the person chose it in Settings → Theme, as the system's settings do: the accent colour
 * and how tall and how wide a table's rows and cells are. Kept on this computer; applied to the page as
 * `data-accent` and `data-density` on <html> and `--cell-px` (styles/ukmac/tokens.css and components.css do the rest).
 */
@Injectable({ providedIn: 'root' })
export class Theme {
  readonly accent = signal<ThemeAccent>(THEME_DEFAULTS.accent);
  readonly rowHeight = signal<RowHeight>(THEME_DEFAULTS.rowHeight);
  readonly columnSpacing = signal<ColumnSpacing>(THEME_DEFAULTS.columnSpacing);

  constructor() {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(THEME_KEY);
    } catch {
      /* the defaults */
    }
    const prefs = readTheme(saved);
    this.accent.set(prefs.accent);
    this.rowHeight.set(prefs.rowHeight);
    this.columnSpacing.set(prefs.columnSpacing);
    effect(() => {
      const root = document.documentElement;
      root.dataset['accent'] = this.accent();
      root.dataset['density'] = this.rowHeight();
      root.style.setProperty('--cell-px', CELL_PADDING[this.columnSpacing()]);
    });
  }

  /** Changes one or more choices, and keeps them. */
  update(patch: Partial<ThemePreferences>) {
    if (patch.accent) this.accent.set(patch.accent);
    if (patch.rowHeight) this.rowHeight.set(patch.rowHeight);
    if (patch.columnSpacing) this.columnSpacing.set(patch.columnSpacing);
    try {
      localStorage.setItem(
        THEME_KEY,
        JSON.stringify({ accent: this.accent(), rowHeight: this.rowHeight(), columnSpacing: this.columnSpacing() }),
      );
    } catch {
      /* kept for this run only */
    }
  }

  /** Back to the defaults. */
  reset() {
    this.update({ ...THEME_DEFAULTS });
  }
}
