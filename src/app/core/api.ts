import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { open, save, ask, message } from '@tauri-apps/plugin-dialog';
import type { AiConnectionInput, AiConnectionTest, AiStatus, AiVisualInput } from './ai-models';

import type {
  CellChange,
  Cells,
  Column,
  Dashboard,
  DatabaseInfo,
  DriveFile,
  GoogleLink,
  GoogleLinkInput,
  GoogleStatus,
  ImportRecord,
  ImportedMac,
  Mac,
  MacFilePeek,
  MacInput,
  Row,
  SavedMacFile,
  Sheet,
  SheetWithRows,
  Workbook,
  TemplateColumns,
  UnownedMac,
} from './models';

/** The local backend (src-tauri/src/commands.rs): the SQLite file on this Mac. */
@Injectable({ providedIn: 'root' })
export class Api {
  /** The name this computer has (empty when it can't be read). */
  computerName() { return invoke<string>('computer_name'); }
  aiStatus() { return invoke<AiStatus>('ai_status'); }
  aiSaveConnection(input: AiConnectionInput) { return invoke<AiStatus>('ai_save_connection', { input }); }
  aiClearConnection() { return invoke<AiStatus>('ai_clear_connection'); }
  aiTestConnection() { return invoke<AiConnectionTest>('ai_test_connection'); }
  aiGenerateVisuals(input: AiVisualInput) { return invoke<string>('ai_generate_visuals', { input }); }
  aiCancelGeneration(requestId: string) { return invoke<void>('ai_cancel_generation', { requestId }); }

  listMacs() {
    return invoke<Mac[]>('list_macs');
  }
  createMac(input: MacInput) {
    return invoke<Mac>('create_mac', { input });
  }
  updateMac(macId: number, input: MacInput) {
    return invoke<Mac>('update_mac', { macId, input });
  }
  deleteMac(macId: number) {
    return invoke<void>('delete_mac', { macId });
  }
  getWorkbook(macId: number) {
    return invoke<Workbook>('get_workbook', { macId });
  }
  getAllWorkbooks() {
    return invoke<Workbook[]>('get_all_workbooks');
  }

  // ------------------------------------------- a MAC saved to / read from a file

  /** Writes the MAC, its tables and rows to a `.ukmac` file. */
  exportMacFile(macId: number, path: string) {
    return invoke<SavedMacFile>('export_mac_file', { macId, path });
  }
  /** What a `.ukmac` file holds, and whether this computer has that MAC already. */
  peekMacFile(path: string) {
    return invoke<MacFilePeek>('peek_mac_file', { path });
  }
  /** Adds the file's MAC (`replace`: in place of the same MAC here). */
  importMacFile(path: string, replace: boolean) {
    return invoke<ImportedMac>('import_mac_file', { path, replace });
  }
  /** MACs nobody has yet (made before accounts), with the Google Sheets they are linked to. */
  unownedMacs() {
    return invoke<UnownedMac[]>('unowned_macs');
  }
  /** The signed-in account takes these MACs, where nobody has them yet. */
  claimMacs(macIds: number[]) {
    return invoke<number>('claim_macs', { macIds });
  }

  createSheet(
    macId: number,
    input: { title: string; heading?: string; about?: string; icon?: string; columns?: Column[]; rows?: Cells[] },
  ) {
    return invoke<SheetWithRows>('create_sheet', { macId, ...input });
  }
  updateSheet(sheetId: number, input: { title: string; heading?: string; about?: string; icon?: string }) {
    return invoke<Sheet>('update_sheet', { sheetId, ...input });
  }
  saveColumns(sheetId: number, columns: Column[]) {
    return invoke<Sheet>('save_columns', { sheetId, columns });
  }
  /** What the template gives a table made from it (by its `templateKey`): its columns now and those it dropped: what an older table can be brought up to date with. */
  templateColumns(templateKey: string) {
    return invoke<TemplateColumns>('template_columns', { templateKey });
  }
  saveDashboard(sheetId: number, dashboard: Dashboard | null) {
    return invoke<Sheet>('save_dashboard', { sheetId, dashboard });
  }
  deleteSheet(sheetId: number) {
    return invoke<void>('delete_sheet', { sheetId });
  }
  reorderSheets(macId: number, sheetIds: number[]) {
    return invoke<void>('reorder_sheets', { macId, sheetIds });
  }

  addRows(
    sheetId: number,
    rows: Cells[],
    options: { afterRowId?: number | null; import?: { fileName: string; mode: 'append' | 'replace' } } = {},
  ) {
    return invoke<Row[]>('add_rows', {
      sheetId,
      rows,
      afterRowId: options.afterRowId ?? null,
      import: options.import ?? null,
    });
  }
  updateCells(sheetId: number, changes: CellChange[]) {
    return invoke<Row[]>('update_cells', { sheetId, changes });
  }
  deleteRows(sheetId: number, rowIds: number[]) {
    return invoke<void>('delete_rows', { sheetId, rowIds });
  }
  /** The rows in this order (a sort or a move in the sheet). */
  reorderRows(sheetId: number, rowIds: number[]) {
    return invoke<void>('reorder_rows', { sheetId, rowIds });
  }
  listImports(sheetId: number) {
    return invoke<ImportRecord[]>('list_imports', { sheetId });
  }
  undoImport(importId: number) {
    return invoke<number>('undo_import', { importId });
  }

  getSetting(key: string) {
    return invoke<string | null>('get_setting', { key });
  }
  setSetting(key: string, value: string | null) {
    return invoke<void>('set_setting', { key, value });
  }
  databaseInfo() {
    return invoke<DatabaseInfo>('database_info');
  }
  backupDatabase(path: string) {
    return invoke<void>('backup_database', { path });
  }

  // ------------------------------------------------------- Google Sheets

  googleStatus() {
    return invoke<GoogleStatus>('google_status');
  }
  googleSaveClient(clientId: string, clientSecret: string) {
    return invoke<GoogleStatus>('google_save_client', { clientId, clientSecret });
  }
  /** Opens Google in the browser and waits for the answer (up to 5 minutes). */
  googleSignIn() {
    return invoke<GoogleStatus>('google_sign_in');
  }
  googleCancelSignIn() {
    return invoke<void>('google_cancel_sign_in');
  }
  /** Log out; with `forgetClient` the saved Client ID and secret are removed too. */
  googleSignOut(forgetClient = false) {
    return invoke<GoogleStatus>('google_sign_out', { forgetClient });
  }
  googleListSpreadsheets(query: string | null) {
    return invoke<DriveFile[]>('google_list_spreadsheets', { query });
  }
  /** A sheet's name and kind, from its link or id. */
  googleFileInfo(file: string) {
    return invoke<DriveFile>('google_file_info', { file });
  }
  /** A sheet as an .xlsx workbook, from its link or id. */
  googleDownload(file: string) {
    return invoke<ArrayBuffer>('google_download', { file });
  }
  /** A Google page in the browser (only Google's own addresses). */
  openLink(url: string) {
    return invoke<void>('open_link', { url });
  }
  listGoogleLinks(macId: number | null = null) {
    return invoke<GoogleLink[]>('list_google_links', { macId });
  }
  saveGoogleLink(input: GoogleLinkInput) {
    return invoke<GoogleLink>('save_google_link', { input });
  }
  googleLinkSynced(sheetId: number, rowCount: number, headerMap: Record<string, string>) {
    return invoke<GoogleLink>('google_link_synced', { sheetId, rowCount, headerMap });
  }
  deleteGoogleLink(sheetId: number) {
    return invoke<void>('delete_google_link', { sheetId });
  }

  // --------------------------------------------------------------- files

  async readFile(path: string): Promise<ArrayBuffer> {
    return invoke<ArrayBuffer>('read_file', { path });
  }

  async writeFile(path: string, bytes: ArrayBuffer | Uint8Array) {
    const body = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    await invoke('write_file', body, { headers: { path: encodeURIComponent(path) } });
  }

  async pickExcelFile(): Promise<string | null> {
    const picked = await open({
      multiple: false,
      directory: false,
      filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }],
    });
    return typeof picked === 'string' ? picked : null;
  }

  async pickMacFile(): Promise<string | null> {
    const picked = await open({
      multiple: false,
      directory: false,
      filters: [{ name: 'UKMAC MAC file', extensions: ['ukmac'] }],
    });
    return typeof picked === 'string' ? picked : null;
  }

  async pickDashboardFile(): Promise<string | null> {
    const picked = await open({
      multiple: false,
      directory: false,
      filters: [{ name: 'UKMAC dashboard', extensions: ['ukdash'] }],
    });
    return typeof picked === 'string' ? picked : null;
  }

  /**
   * A question with three answers. `yes` is the first button, the one Return picks, so give it the safe
   * answer. Returns which of the two was clicked, or null (Cancel, or the dialog closed). The dialog
   * answers with the button's label, or Yes/No, depending on the system: both are taken.
   */
  async choose(text: string, title: string, yes: string, no: string): Promise<'yes' | 'no' | null> {
    const answer = await message(text, { title, kind: 'warning', buttons: { yes, no, cancel: 'Cancel' } });
    if (answer === yes || answer === 'Yes') return 'yes';
    if (answer === no || answer === 'No') return 'no';
    return null;
  }

  async pickSavePath(defaultPath: string, name = 'Excel workbook', extensions = ['xlsx']) {
    return save({ defaultPath, filters: [{ name, extensions }] });
  }

  confirm(text: string, title = 'UKMAC Monitoring', okLabel = 'OK') {
    return ask(text, { title, kind: 'warning', okLabel, cancelLabel: 'Cancel' });
  }

  alert(text: string, title = 'UKMAC Monitoring') {
    return message(text, { title, kind: 'error' });
  }
}

/** A backend error as a sentence. */
export function errorText(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Please try again.';
}
