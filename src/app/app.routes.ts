import type { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/home-page').then((m) => m.HomePage), title: 'MACs' },
  { path: 'settings', loadComponent: () => import('./pages/settings-page').then((m) => m.SettingsPage), title: 'Settings' },
  {
    path: 'mac/:macId',
    loadComponent: () => import('./pages/mac-layout').then((m) => m.MacLayout),
    children: [
      { path: '', loadComponent: () => import('./pages/mac-page').then((m) => m.MacPage) },
      { path: 'data-check', loadComponent: () => import('./pages/data-check-page').then((m) => m.DataCheckPage), title: 'Data Check' },
      { path: 'zone-map', loadComponent: () => import('./pages/zone-map-page').then((m) => m.ZoneMapPage), title: 'Zone Map', canDeactivate: [(page: { canLeave(): Promise<boolean> | boolean }) => page.canLeave()] },
      { path: 'table/:sheetId', loadComponent: () => import('./pages/sheet-page').then((m) => m.SheetPage) },
    ],
  },
  { path: '**', redirectTo: '' },
];
