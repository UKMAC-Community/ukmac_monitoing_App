import type { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('@features/home/home-page').then((m) => m.HomePage), title: 'MACs' },
  { path: 'settings', loadComponent: () => import('@features/settings/settings-page').then((m) => m.SettingsPage), title: 'Settings' },
  {
    path: 'mac/:macId',
    loadComponent: () => import('@features/mac/mac-layout').then((m) => m.MacLayout),
    children: [
      { path: '', loadComponent: () => import('@features/mac/mac-page').then((m) => m.MacPage) },
      { path: 'data-check', loadComponent: () => import('@features/data-check/data-check-page').then((m) => m.DataCheckPage), title: 'Data Check' },
      { path: 'zone-map', loadComponent: () => import('@features/zone-map/zone-map-page').then((m) => m.ZoneMapPage), title: 'Zone Map', canDeactivate: [(page: { canLeave(): Promise<boolean> | boolean }) => page.canLeave()] },
      { path: 'table/:sheetId', loadComponent: () => import('@features/tables/sheet-page').then((m) => m.SheetPage) },
      { path: 'google', loadComponent: () => import('@features/google/google-connect-page').then((m) => m.GoogleConnectPage), title: 'Connect a Google Sheet' },
    ],
  },
  { path: '**', redirectTo: '' },
];
