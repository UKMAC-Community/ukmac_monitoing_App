var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __decorateClass = (decorators, target, key, kind) => {
  var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc(target, key) : target;
  for (var i = decorators.length - 1, decorator; i >= 0; i--)
    if (decorator = decorators[i])
      result = (kind ? decorator(target, key, result) : decorator(result)) || result;
  if (kind && result) __defProp(target, key, result);
  return result;
};

// .pm/verification/store-failure-repro.ts
import "@angular/compiler";
import { createEnvironmentInjector, Injector, runInInjectionContext } from "@angular/core";
import assert from "node:assert/strict";

// src/app/core/api.ts
import { Injectable } from "@angular/core";
import { invoke } from "@tauri-apps/api/core";
import { open, save, ask, message } from "@tauri-apps/plugin-dialog";
var Api = class {
  listMacs() {
    return invoke("list_macs");
  }
  createMac(input) {
    return invoke("create_mac", { input });
  }
  updateMac(macId, input) {
    return invoke("update_mac", { macId, input });
  }
  deleteMac(macId) {
    return invoke("delete_mac", { macId });
  }
  getWorkbook(macId) {
    return invoke("get_workbook", { macId });
  }
  getAllWorkbooks() {
    return invoke("get_all_workbooks");
  }
  // ------------------------------------------- a MAC saved to / read from a file
  /** Writes the MAC, its tables and rows to a `.ukmac` file. */
  exportMacFile(macId, path) {
    return invoke("export_mac_file", { macId, path });
  }
  /** What a `.ukmac` file holds, and whether this computer has that MAC already. */
  peekMacFile(path) {
    return invoke("peek_mac_file", { path });
  }
  /** Adds the file's MAC (`replace`: in place of the same MAC here). */
  importMacFile(path, replace) {
    return invoke("import_mac_file", { path, replace });
  }
  createSheet(macId, input) {
    return invoke("create_sheet", { macId, ...input });
  }
  updateSheet(sheetId, input) {
    return invoke("update_sheet", { sheetId, ...input });
  }
  saveColumns(sheetId, columns) {
    return invoke("save_columns", { sheetId, columns });
  }
  saveDashboard(sheetId, dashboard) {
    return invoke("save_dashboard", { sheetId, dashboard });
  }
  deleteSheet(sheetId) {
    return invoke("delete_sheet", { sheetId });
  }
  reorderSheets(macId, sheetIds) {
    return invoke("reorder_sheets", { macId, sheetIds });
  }
  addRows(sheetId, rows, options = {}) {
    return invoke("add_rows", {
      sheetId,
      rows,
      afterRowId: options.afterRowId ?? null,
      import: options.import ?? null
    });
  }
  updateCells(sheetId, changes) {
    return invoke("update_cells", { sheetId, changes });
  }
  deleteRows(sheetId, rowIds) {
    return invoke("delete_rows", { sheetId, rowIds });
  }
  /** The rows in this order (a sort or a move in the sheet). */
  reorderRows(sheetId, rowIds) {
    return invoke("reorder_rows", { sheetId, rowIds });
  }
  listImports(sheetId) {
    return invoke("list_imports", { sheetId });
  }
  undoImport(importId) {
    return invoke("undo_import", { importId });
  }
  getSetting(key) {
    return invoke("get_setting", { key });
  }
  setSetting(key, value) {
    return invoke("set_setting", { key, value });
  }
  databaseInfo() {
    return invoke("database_info");
  }
  backupDatabase(path) {
    return invoke("backup_database", { path });
  }
  // ------------------------------------------------------- Google Sheets
  googleStatus() {
    return invoke("google_status");
  }
  googleSaveClient(clientId, clientSecret) {
    return invoke("google_save_client", { clientId, clientSecret });
  }
  /** Opens Google in the browser and waits for the answer (up to 5 minutes). */
  googleSignIn() {
    return invoke("google_sign_in");
  }
  googleCancelSignIn() {
    return invoke("google_cancel_sign_in");
  }
  /** Log out; with `forgetClient` the saved Client ID and secret are removed too. */
  googleSignOut(forgetClient = false) {
    return invoke("google_sign_out", { forgetClient });
  }
  googleListSpreadsheets(query) {
    return invoke("google_list_spreadsheets", { query });
  }
  /** A sheet's name and kind, from its link or id. */
  googleFileInfo(file) {
    return invoke("google_file_info", { file });
  }
  /** A sheet as an .xlsx workbook, from its link or id. */
  googleDownload(file) {
    return invoke("google_download", { file });
  }
  /** A Google page in the browser (only Google's own addresses). */
  openLink(url) {
    return invoke("open_link", { url });
  }
  listGoogleLinks(macId = null) {
    return invoke("list_google_links", { macId });
  }
  saveGoogleLink(input) {
    return invoke("save_google_link", { input });
  }
  googleLinkSynced(sheetId, rowCount, headerMap) {
    return invoke("google_link_synced", { sheetId, rowCount, headerMap });
  }
  deleteGoogleLink(sheetId) {
    return invoke("delete_google_link", { sheetId });
  }
  // --------------------------------------------------------------- files
  async readFile(path) {
    return invoke("read_file", { path });
  }
  async writeFile(path, bytes) {
    const body = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    await invoke("write_file", body, { headers: { path: encodeURIComponent(path) } });
  }
  async pickExcelFile() {
    const picked = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Excel workbook", extensions: ["xlsx"] }]
    });
    return typeof picked === "string" ? picked : null;
  }
  async pickMacFile() {
    const picked = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "UKMAC MAC file", extensions: ["ukmac"] }]
    });
    return typeof picked === "string" ? picked : null;
  }
  /**
   * A question with three answers. `yes` is the first button, the one Return picks, so give it the safe
   * answer. Returns which of the two was clicked, or null (Cancel, or the dialog closed). The dialog
   * answers with the button's label, or Yes/No, depending on the system: both are taken.
   */
  async choose(text, title, yes, no) {
    const answer = await message(text, { title, kind: "warning", buttons: { yes, no, cancel: "Cancel" } });
    if (answer === yes || answer === "Yes") return "yes";
    if (answer === no || answer === "No") return "no";
    return null;
  }
  async pickSavePath(defaultPath, name = "Excel workbook", extensions = ["xlsx"]) {
    return save({ defaultPath, filters: [{ name, extensions }] });
  }
  confirm(text, title = "UKMAC Monitoring", okLabel = "OK") {
    return ask(text, { title, kind: "warning", okLabel, cancelLabel: "Cancel" });
  }
  alert(text, title = "UKMAC Monitoring") {
    return message(text, { title, kind: "error" });
  }
};
Api = __decorateClass([
  Injectable({ providedIn: "root" })
], Api);
function errorText(error) {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}

// src/app/core/toast.ts
import { Injectable as Injectable2, signal } from "@angular/core";
var Toasts = class {
  items = signal([]);
  next = 1;
  show(text, tone = "ok", action, ms = 5e3) {
    const id = this.next++;
    this.items.update((items) => [...items.slice(-3), { id, text, tone, action }]);
    setTimeout(() => this.dismiss(id), tone === "error" ? Math.max(ms, 8e3) : ms);
  }
  error(text) {
    this.show(text, "error");
  }
  dismiss(id) {
    this.items.update((items) => items.filter((item) => item.id !== id));
  }
};
Toasts = __decorateClass([
  Injectable2({ providedIn: "root" })
], Toasts);

// src/app/core/workbook-store.ts
import { computed, inject, Injectable as Injectable3, signal as signal2 } from "@angular/core";

// src/app/sheet/columns.ts
var clean = (text) => (text ?? "").trim().replace(/\s+/g, " ").toLowerCase();
function shownUnit(name, unit) {
  const text = unit?.trim() ?? "";
  if (!text) return "";
  return name.trim().toLowerCase().endsWith(`(${text.toLowerCase()})`) ? "" : text;
}
function columnLabel(column) {
  const unit = shownUnit(column.name, column.unit);
  return unit ? `${column.name} (${unit})` : column.name;
}
function parseLinkSource(source) {
  const text = (source ?? "").trim();
  const quoted = /^'((?:[^']|'')+)'\s*\[([^\]]+)\]$/.exec(text);
  if (quoted) return { table: quoted[1].replace(/''/g, "'").trim(), column: quoted[2].trim() };
  const bare = /^([A-Za-z0-9_\u0080-￿]+)\s*\[([^\]]+)\]$/.exec(text);
  return bare ? { table: bare[1], column: bare[2].trim() } : null;
}
function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = /* @__PURE__ */ new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
var two = (n) => String(n).padStart(2, "0");
function excelSerialToIso(serial, date1904 = false) {
  if (!Number.isFinite(serial)) return null;
  const whole = Math.floor(serial);
  if (whole < (date1904 ? 0 : 1) || whole > 2958465) return null;
  const adjusted = date1904 ? whole : whole - (whole > 60 ? 1 : 0);
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31);
  const date = new Date(epoch + adjusted * 864e5);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}
function parseDateText(text) {
  const value = text.trim();
  if (!value) return null;
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(value);
  if (match) {
    const iso = `${match[1]}-${two(+match[2])}-${two(+match[3])}`;
    return isIsoDate(iso) ? iso : null;
  }
  match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(value);
  if (match) {
    const year = match[3].length === 2 ? 2e3 + +match[3] : +match[3];
    const iso = `${year}-${two(+match[2])}-${two(+match[1])}`;
    return isIsoDate(iso) ? iso : null;
  }
  if (/^\d{4,6}(\.\d+)?$/.test(value)) return excelSerialToIso(Number(value));
  return null;
}
function todayIso() {
  const now = /* @__PURE__ */ new Date();
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}
var NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
function checkCell(column, raw, linkOptions = []) {
  const value = raw.trim();
  if (!value) return { value: "", error: column.required ? "This column needs a value" : void 0 };
  switch (column.type) {
    case "number":
    case "percentage": {
      let text = value.replace(/,/g, "").replace(/\s+/g, "");
      if (column.type === "percentage") text = text.replace(/%$/, "");
      if (!NUMBER.test(text) || !Number.isFinite(Number(text))) return { value, error: "Use a number" };
      return { value: String(Number(text)) };
    }
    case "date": {
      const iso = parseDateText(value);
      return iso ? { value: iso } : { value, error: "Use a date: 16/06/2026 or 2026-06-16" };
    }
    case "yesno": {
      const text = value.toLowerCase();
      if (["yes", "y", "true", "1", "ok", "\u2713"].includes(text)) return { value: "true" };
      if (["no", "n", "false", "0"].includes(text)) return { value: "false" };
      return { value, error: "Use Yes or No" };
    }
    case "choice": {
      const found = (column.options ?? []).find((option) => clean(option) === clean(value));
      return found ? { value: found } : { value, error: `Not in the list: ${(column.options ?? []).join(", ")}` };
    }
    case "link": {
      const found = linkOptions.find((option) => clean(option) === clean(value));
      const source = parseLinkSource(column.source);
      return found ? { value: found } : { value, error: source ? `Not in ${source.table} \u203A ${source.column}` : "Pick a value from the linked table" };
    }
    default:
      return { value };
  }
}

// src/app/formula/evaluate-formula.ts
var FormulaError = class {
  constructor(code, reason) {
    this.code = code;
    this.reason = reason;
  }
  code;
  reason;
};
var isError = (value) => value instanceof FormulaError;
var isBlank = (value) => value === null || value === "";
function firstError(values) {
  for (const value of values) {
    if (isError(value)) return value;
    if (Array.isArray(value)) {
      const inner = value.find(isError);
      if (inner) return inner;
    }
  }
  return null;
}
function toNumber(value) {
  if (isError(value)) return value;
  if (value === null || value === "") return 0;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  const number = Number(value.trim().replace(/,/g, ""));
  return Number.isFinite(number) ? number : new FormulaError("#VALUE!", `\u201C${value}\u201D isn't a number`);
}
function toText(value) {
  if (isError(value)) return value;
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return formatFormulaNumber(value);
  return value;
}
function toBoolean(value) {
  if (isError(value)) return value;
  if (value === null) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const text = value.trim().toLowerCase();
  if (["true", "yes"].includes(text)) return true;
  if (["false", "no", ""].includes(text)) return false;
  return new FormulaError("#VALUE!", `\u201C${value}\u201D isn't Yes or No`);
}
function formatFormulaNumber(value) {
  if (!Number.isFinite(value)) return String(value);
  return String(Number(value.toPrecision(12)));
}
var DATE = /^(\d{4})-(\d{2})-(\d{2})/;
function toDay(value) {
  if (isError(value)) return value;
  if (typeof value === "string") {
    const match = DATE.exec(value.trim());
    if (match)
      return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 864e5;
  }
  return new FormulaError("#VALUE!", `\u201C${String(value ?? "")}\u201D isn't a date`);
}
function sameValue(a, b) {
  if (isError(a) || isError(b)) return false;
  if (isBlank(a) || isBlank(b)) return isBlank(a) && isBlank(b);
  const na = typeof a === "number" ? a : Number(a);
  const nb = typeof b === "number" ? b : Number(b);
  if ((typeof a === "number" || typeof b === "number") && Number.isFinite(na) && Number.isFinite(nb))
    return na === nb;
  const ta = toText(a);
  const tb = toText(b);
  return typeof ta === "string" && typeof tb === "string" && ta.trim().toLowerCase() === tb.trim().toLowerCase();
}
function compare(a, b) {
  const numeric = (value) => typeof value === "number" || typeof value === "boolean" || value === null || typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value));
  if (numeric(a) && numeric(b)) {
    const na = toNumber(a);
    const nb = toNumber(b);
    return na === nb ? 0 : na < nb ? -1 : 1;
  }
  const ta = String(toText(a)).toLowerCase();
  const tb = String(toText(b)).toLowerCase();
  return ta === tb ? 0 : ta < tb ? -1 : 1;
}
function numbersIn(values) {
  const numbers = [];
  for (const value of values) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isError(item)) return item;
        if (typeof item === "number") numbers.push(item);
        else if (typeof item === "string" && item.trim() !== "") {
          const number = Number(item);
          if (Number.isFinite(number)) numbers.push(number);
        }
      }
    } else {
      if (isBlank(value)) continue;
      const number = toNumber(value);
      if (isError(number)) return number;
      numbers.push(number);
    }
  }
  return numbers;
}
var scalar = (value) => Array.isArray(value) ? new FormulaError("#VALUE!", "A whole table's column can't go here") : value;
function aggregate(pick) {
  return {
    arity: [1, Infinity],
    columns: Array.from({ length: 30 }, (_, index) => index),
    run: (args) => {
      const numbers = numbersIn(args);
      return isError(numbers) ? numbers : pick(numbers);
    }
  };
}
function matching(results, keys, value) {
  if (!Array.isArray(keys) || !Array.isArray(results))
    return new FormulaError(
      "#VALUE!",
      "Name another table's columns here: 'Table'[Column]"
    );
  const wanted = scalar(value);
  if (isError(wanted)) return wanted;
  if (keys.length !== results.length)
    return new FormulaError(
      "#VALUE!",
      "Both columns must be from the same table"
    );
  return results.filter((_, index) => sameValue(keys[index], wanted));
}
function matchingAll(results, conditions, name) {
  if (isError(results)) return results;
  if (!Array.isArray(results) || conditions.length % 2 !== 0)
    return new FormulaError(
      "#VALUE!",
      `${name} needs a value column followed by matching column/value pairs`
    );
  const pairs = [];
  for (let at = 0; at < conditions.length; at += 2) {
    const keys = conditions[at];
    const wanted = scalar(conditions[at + 1]);
    if (isError(keys)) return keys;
    if (isError(wanted)) return wanted;
    if (!Array.isArray(keys) || keys.length !== results.length)
      return new FormulaError(
        "#VALUE!",
        `${name} columns must have the same number of records`
      );
    pairs.push({ keys, wanted });
  }
  return results.filter(
    (_, at) => pairs.every(({ keys, wanted }) => sameValue(keys[at], wanted))
  );
}
var FUNCTIONS = {
  ABS: { arity: [1, 1], run: ([x]) => math(x, Math.abs) },
  AND: {
    arity: [1, Infinity],
    run: (args) => {
      for (const arg of args) {
        const value = toBoolean(scalar(arg));
        if (isError(value)) return value;
        if (!value) return false;
      }
      return true;
    }
  },
  AVERAGE: aggregate(
    (numbers) => numbers.length ? numbers.reduce((sum, number) => sum + number, 0) / numbers.length : new FormulaError("#DIV/0!", "Nothing to average")
  ),
  AVERAGEIF: {
    arity: [3, 3],
    columns: [0, 1],
    run: ([results, keys, value]) => {
      const rows = matching(results, keys, value);
      if (isError(rows)) return rows;
      const numbers = numbersIn([rows]);
      if (isError(numbers)) return numbers;
      return numbers.length ? numbers.reduce((sum, number) => sum + number, 0) / numbers.length : new FormulaError("#DIV/0!", "No rows match, so nothing to average");
    }
  },
  BLANK: { arity: [0, 0], run: () => null },
  CONCAT: {
    arity: [1, Infinity],
    run: (args) => {
      let text = "";
      for (const arg of args) {
        const part = toText(scalar(arg));
        if (isError(part)) return part;
        text += part;
      }
      return text;
    }
  },
  COUNT: {
    arity: [1, Infinity],
    columns: Array.from({ length: 30 }, (_, index) => index),
    run: (args) => {
      const numbers = numbersIn(args);
      return isError(numbers) ? numbers : numbers.length;
    }
  },
  COUNTA: {
    arity: [1, Infinity],
    columns: Array.from({ length: 30 }, (_, index) => index),
    run: (args) => args.flatMap((arg) => Array.isArray(arg) ? arg : [arg]).filter((value) => !isBlank(value)).length
  },
  COUNTIF: {
    arity: [2, 2],
    columns: [0],
    run: ([keys, value]) => {
      const rows = matching(keys, keys, value);
      return isError(rows) ? rows : rows.length;
    }
  },
  DAY: { arity: [1, 1], run: ([date]) => datePart(date, 3) },
  DAYS: {
    arity: [2, 2],
    run: ([end, start]) => {
      const a = toDay(scalar(end));
      const b = toDay(scalar(start));
      if (isError(a)) return a;
      if (isError(b)) return b;
      return a - b;
    }
  },
  DIVIDE: {
    // Power BI's: the alternative (blank by default) instead of #DIV/0!.
    arity: [2, 3],
    run: ([a, b, alternative = null]) => {
      const x = toNumber(scalar(a));
      const y = toNumber(scalar(b));
      if (isError(x)) return x;
      if (isError(y)) return y;
      return y === 0 ? scalar(alternative) : x / y;
    }
  },
  IF: {
    arity: [2, 3],
    lazy: true,
    run: (_args, _scope, nodes, evaluate) => {
      const test = toBoolean(scalar(evaluate(nodes[0])));
      if (isError(test)) return test;
      if (test) return evaluate(nodes[1]);
      return nodes[2] ? evaluate(nodes[2]) : false;
    }
  },
  IFERROR: {
    arity: [2, 2],
    lazy: true,
    run: (_args, _scope, nodes, evaluate) => {
      const value = evaluate(nodes[0]);
      return isError(value) ? evaluate(nodes[1]) : value;
    }
  },
  INT: { arity: [1, 1], run: ([x]) => math(x, Math.floor) },
  ISBLANK: {
    arity: [1, 1],
    run: ([value]) => {
      const item = scalar(value);
      return !isError(item) && isBlank(item);
    }
  },
  LEFT: { arity: [1, 2], run: ([text, count]) => slice(text, count, "left") },
  LEN: {
    arity: [1, 1],
    run: ([text]) => {
      const value = toText(scalar(text));
      return isError(value) ? value : value.length;
    }
  },
  LOOKUP: {
    // XLOOKUP / Power BI's LOOKUPVALUE: the result column's value on the
    // first row whose key column matches; not found, the 4th (else #N/A).
    arity: [3, 4],
    columns: [0, 1],
    run: ([results, keys, value, notFound]) => {
      if (!Array.isArray(keys) || !Array.isArray(results))
        return new FormulaError(
          "#VALUE!",
          "Name another table's columns here: 'Table'[Column]"
        );
      const wanted = scalar(value);
      if (isError(wanted)) return wanted;
      const at = keys.findIndex((key) => sameValue(key, wanted));
      if (at !== -1) return results[at] ?? null;
      return notFound === void 0 ? new FormulaError("#N/A", `No row matches \u201C${String(toText(wanted))}\u201D`) : scalar(notFound);
    }
  },
  LOWER: {
    arity: [1, 1],
    run: ([text]) => mapText(text, (t) => t.toLowerCase())
  },
  MAX: aggregate((numbers) => numbers.length ? Math.max(...numbers) : 0),
  MIN: aggregate((numbers) => numbers.length ? Math.min(...numbers) : 0),
  MOD: {
    arity: [2, 2],
    run: ([a, b]) => {
      const x = toNumber(scalar(a));
      const y = toNumber(scalar(b));
      if (isError(x)) return x;
      if (isError(y)) return y;
      if (y === 0) return new FormulaError("#DIV/0!", "MOD by 0");
      return x - y * Math.floor(x / y);
    }
  },
  MONTH: { arity: [1, 1], run: ([date]) => datePart(date, 2) },
  NOT: {
    arity: [1, 1],
    run: ([value]) => {
      const test = toBoolean(scalar(value));
      return isError(test) ? test : !test;
    }
  },
  OR: {
    arity: [1, Infinity],
    run: (args) => {
      for (const arg of args) {
        const value = toBoolean(scalar(arg));
        if (isError(value)) return value;
        if (value) return true;
      }
      return false;
    }
  },
  POWER: {
    arity: [2, 2],
    run: ([a, b]) => {
      const x = toNumber(scalar(a));
      const y = toNumber(scalar(b));
      if (isError(x)) return x;
      if (isError(y)) return y;
      return x ** y;
    }
  },
  RIGHT: { arity: [1, 2], run: ([text, count]) => slice(text, count, "right") },
  ROUND: { arity: [1, 2], run: ([x, places]) => round(x, places, Math.round) },
  ROUNDDOWN: {
    arity: [1, 2],
    run: ([x, places]) => round(x, places, Math.trunc)
  },
  ROUNDUP: {
    arity: [1, 2],
    run: ([x, places]) => round(x, places, (n) => n < 0 ? -Math.ceil(-n) : Math.ceil(n))
  },
  SQRT: {
    arity: [1, 1],
    run: ([x]) => {
      const number = toNumber(scalar(x));
      if (isError(number)) return number;
      return number < 0 ? new FormulaError("#VALUE!", "No square root of a negative number") : Math.sqrt(number);
    }
  },
  SUM: aggregate((numbers) => numbers.reduce((sum, number) => sum + number, 0)),
  SUMIF: {
    // SUMIFS' order: what to add up, the column to match, what it must be.
    arity: [3, 3],
    columns: [0, 1],
    run: ([results, keys, value]) => {
      const rows = matching(results, keys, value);
      if (isError(rows)) return rows;
      const numbers = numbersIn([rows]);
      return isError(numbers) ? numbers : numbers.reduce((sum, number) => sum + number, 0);
    }
  },
  SUMIFS: {
    arity: [3, 255],
    columns: [0, ...Array.from({ length: 127 }, (_, at) => 1 + at * 2)],
    run: ([results, ...conditions]) => {
      const rows = matchingAll(results, conditions, "SUMIFS");
      if (isError(rows)) return rows;
      const numbers = numbersIn([rows]);
      return isError(numbers) ? numbers : numbers.reduce((sum, number) => sum + number, 0);
    }
  },
  TODAY: { arity: [0, 0], run: (_args, scope) => scope.today },
  TRIM: {
    arity: [1, 1],
    run: ([text]) => mapText(text, (t) => t.trim().replace(/\s+/g, " "))
  },
  UNIQUEJOIN: {
    arity: [1, 255],
    columns: [0, ...Array.from({ length: 127 }, (_, at) => 1 + at * 2)],
    run: ([results, ...conditions]) => {
      const rows = matchingAll(results, conditions, "UNIQUEJOIN");
      if (isError(rows)) return rows;
      const unique = /* @__PURE__ */ new Map();
      for (const value of rows) {
        const text = toText(value);
        if (isError(text)) return text;
        const label = text.trim();
        const key = label.toLowerCase();
        if (label && !unique.has(key)) unique.set(key, label);
      }
      return [...unique.values()].sort(
        (a, b) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" })
      ).join(", ");
    }
  },
  UPPER: {
    arity: [1, 1],
    run: ([text]) => mapText(text, (t) => t.toUpperCase())
  },
  YEAR: { arity: [1, 1], run: ([date]) => datePart(date, 1) }
};
FUNCTIONS["CONCATENATE"] = FUNCTIONS["CONCAT"];
FUNCTIONS["XLOOKUP"] = FUNCTIONS["LOOKUP"];
FUNCTIONS["LOOKUPVALUE"] = FUNCTIONS["LOOKUP"];
var FORMULA_FUNCTIONS = Object.keys(FUNCTIONS).sort();
function math(value, fn) {
  const number = toNumber(scalar(value));
  return isError(number) ? number : fn(number);
}
function round(value, places = 0, fn) {
  const number = toNumber(scalar(value));
  const digits = toNumber(scalar(places));
  if (isError(number)) return number;
  if (isError(digits)) return digits;
  const shift = (n, by2) => {
    const [mantissa, exponent = "0"] = String(n).split("e");
    return Number(`${mantissa}e${Number(exponent) + by2}`);
  };
  const by = Math.trunc(digits);
  return shift(fn(shift(number, by)), -by);
}
function slice(value, count = 1, side) {
  const text = toText(scalar(value));
  const length = toNumber(scalar(count));
  if (isError(text)) return text;
  if (isError(length)) return length;
  const n = Math.max(0, Math.trunc(length));
  return side === "left" ? text.slice(0, n) : n ? text.slice(-n) : "";
}
function mapText(value, fn) {
  const text = toText(scalar(value));
  return isError(text) ? text : fn(text);
}
function datePart(value, part) {
  const item = scalar(value);
  if (isError(item)) return item;
  const match = typeof item === "string" ? DATE.exec(item.trim()) : null;
  return match ? Number(match[part]) : new FormulaError("#VALUE!", `\u201C${String(item ?? "")}\u201D isn't a date`);
}
function evaluateFormula(tree, scope) {
  const evaluate = (node) => {
    switch (node.type) {
      case "number":
      case "string":
      case "boolean":
        return node.value;
      case "column":
        return scope.column(node.name);
      case "tableColumn":
        return scope.tableColumn(node.table, node.name);
      case "unary": {
        const value = toNumber(scalar(evaluate(node.operand)));
        return isError(value) ? value : node.op === "-" ? -value : value;
      }
      case "percent": {
        const value = toNumber(scalar(evaluate(node.operand)));
        return isError(value) ? value : value / 100;
      }
      case "binary":
        return binary(
          node.op,
          scalar(evaluate(node.left)),
          scalar(evaluate(node.right))
        );
      case "call": {
        const spec = FUNCTIONS[node.name];
        if (!spec)
          return new FormulaError("#NAME?", `There's no function ${node.name}`);
        const [fewest, most] = spec.arity;
        if (node.args.length < fewest || node.args.length > most)
          return new FormulaError(
            "#VALUE!",
            fewest === most ? `${node.name} takes ${fewest} value${fewest === 1 ? "" : "s"}` : most === Infinity ? `${node.name} takes at least ${fewest}` : `${node.name} takes ${fewest} to ${most} values`
          );
        if (spec.lazy) return spec.run([], scope, node.args, evaluate);
        const args = node.args.map((arg, index) => {
          const value = evaluate(arg);
          return Array.isArray(value) && !spec.columns?.includes(index) ? new FormulaError(
            "#VALUE!",
            `${node.name} can't take a whole table's column there`
          ) : value;
        });
        const error = spec.columns ? null : firstError(args);
        return error ?? spec.run(args, scope, node.args, evaluate);
      }
    }
  };
  return scalar(evaluate(tree));
}
function dayOf(value) {
  return typeof value === "string" && DATE.test(value.trim()) ? toDay(value) : null;
}
function dateOfDay(day) {
  return new Date(Math.floor(day) * 864e5).toISOString().slice(0, 10);
}
function dateMaths(op, left, right) {
  if (op !== "+" && op !== "-") return null;
  const from = dayOf(left);
  const to = dayOf(right);
  if (from !== null && to !== null) return op === "-" ? from - to : null;
  if (from !== null && to === null) {
    const days = toNumber(right);
    if (isError(days)) return days;
    return dateOfDay(op === "+" ? from + days : from - days);
  }
  if (from === null && to !== null && op === "+") {
    const days = toNumber(left);
    if (isError(days)) return days;
    return dateOfDay(to + days);
  }
  return null;
}
function binary(op, left, right) {
  if (isError(left)) return left;
  if (isError(right)) return right;
  if (op === "&") return `${toText(left)}${toText(right)}`;
  const dated = dateMaths(op, left, right);
  if (dated !== null) return dated;
  if (["=", "<>", "<", ">", "<=", ">="].includes(op)) {
    const order = compare(left, right);
    switch (op) {
      case "=":
        return order === 0;
      case "<>":
        return order !== 0;
      case "<":
        return order < 0;
      case ">":
        return order > 0;
      case "<=":
        return order <= 0;
      default:
        return order >= 0;
    }
  }
  const a = toNumber(left);
  const b = toNumber(right);
  if (isError(a)) return a;
  if (isError(b)) return b;
  switch (op) {
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "*":
      return a * b;
    case "/":
      return b === 0 ? new FormulaError("#DIV/0!", "Divided by 0") : a / b;
    default:
      return a ** b;
  }
}

// src/app/formula/parse-formula.ts
var FormulaSyntaxError = class extends Error {
  constructor(message2, position) {
    super(message2);
    this.position = position;
  }
  position;
};
var OPERATORS = [
  "<>",
  "<=",
  ">=",
  "+",
  "-",
  "*",
  "/",
  "^",
  "&",
  "=",
  "<",
  ">",
  "%",
  "(",
  ")",
  ",",
  ";"
];
function readBracket(text, start) {
  const end = text.indexOf("]", start + 1);
  if (end === -1)
    throw new FormulaSyntaxError("A column name is missing its ]", start);
  const name = text.slice(start + 1, end).trim();
  if (!name) throw new FormulaSyntaxError("A column name is empty: []", start);
  return { end: end + 1, name };
}
function tokenize(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(char)) {
      const match = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(text.slice(i));
      if (!match) throw new FormulaSyntaxError(`Unexpected \u201C${char}\u201D`, i);
      tokens.push({ at: i, kind: "number", value: Number(match[0]) });
      i += match[0].length;
      continue;
    }
    if (char === '"') {
      let value = "";
      let j = i + 1;
      for (; ; ) {
        if (j >= text.length)
          throw new FormulaSyntaxError('A text is missing its closing "', i);
        if (text[j] === '"') {
          if (text[j + 1] === '"') {
            value += '"';
            j += 2;
            continue;
          }
          break;
        }
        value += text[j];
        j += 1;
      }
      tokens.push({ at: i, kind: "string", value });
      i = j + 1;
      continue;
    }
    if (char === "[") {
      const { end, name } = readBracket(text, i);
      tokens.push({ at: i, kind: "column", name });
      i = end;
      continue;
    }
    if (char === "'") {
      let table = "";
      let j = i + 1;
      for (; ; ) {
        if (j >= text.length)
          throw new FormulaSyntaxError(
            "A table name is missing its closing '",
            i
          );
        if (text[j] === "'") {
          if (text[j + 1] === "'") {
            table += "'";
            j += 2;
            continue;
          }
          break;
        }
        table += text[j];
        j += 1;
      }
      let k = j + 1;
      while (k < text.length && /\s/.test(text[k])) k += 1;
      if (text[k] !== "[")
        throw new FormulaSyntaxError(
          `After '${table}' name one of its columns: '${table}'[Column]`,
          i
        );
      const { end, name } = readBracket(text, k);
      tokens.push({ at: i, kind: "tableColumn", name, table: table.trim() });
      i = end;
      continue;
    }
    if (/[A-Za-z_\u0080-￿]/.test(char)) {
      const match = /^[A-Za-z_\u0080-￿][A-Za-z0-9_.\u0080-￿]*/.exec(
        text.slice(i)
      );
      const word = match[0];
      const after = i + word.length;
      if (text[after] === "[") {
        const { end, name } = readBracket(text, after);
        tokens.push({ at: i, kind: "tableColumn", name, table: word });
        i = end;
        continue;
      }
      tokens.push({ at: i, kind: "name", value: word });
      i = after;
      continue;
    }
    const op = OPERATORS.find((candidate) => text.startsWith(candidate, i));
    if (!op) throw new FormulaSyntaxError(`Unexpected \u201C${char}\u201D`, i);
    tokens.push({ at: i, kind: "op", value: op === ";" ? "," : op });
    i += op.length;
  }
  tokens.push({ at: text.length, kind: "end" });
  return tokens;
}
function parseFormula(formula) {
  const source = formula.trim().replace(/^=/, "");
  if (!source.trim())
    throw new FormulaSyntaxError("Write the formula after =", 0);
  const offset = formula.indexOf(source);
  let tokens;
  try {
    tokens = tokenize(source);
  } catch (error) {
    if (error instanceof FormulaSyntaxError)
      throw new FormulaSyntaxError(error.message, error.position + offset);
    throw error;
  }
  let index = 0;
  const peek = () => tokens[index];
  const next = () => tokens[index++];
  const isOp = (value) => {
    const token = peek();
    return token.kind === "op" && token.value === value;
  };
  const fail = (message2, token = peek()) => {
    throw new FormulaSyntaxError(message2, token.at + offset);
  };
  const describe = (token) => token.kind === "end" ? "the end" : token.kind === "op" ? `\u201C${token.value}\u201D` : "a value";
  function comparison() {
    let left = concat();
    for (; ; ) {
      const token = peek();
      if (token.kind === "op" && ["=", "<>", "<", ">", "<=", ">="].includes(token.value)) {
        next();
        left = {
          left,
          op: token.value,
          right: concat(),
          type: "binary"
        };
      } else return left;
    }
  }
  function concat() {
    let left = additive();
    while (isOp("&")) {
      next();
      left = { left, op: "&", right: additive(), type: "binary" };
    }
    return left;
  }
  function additive() {
    let left = multiplicative();
    while (isOp("+") || isOp("-")) {
      const op = next();
      left = { left, op: op.value, right: multiplicative(), type: "binary" };
    }
    return left;
  }
  function multiplicative() {
    let left = power();
    while (isOp("*") || isOp("/")) {
      const op = next();
      left = { left, op: op.value, right: power(), type: "binary" };
    }
    return left;
  }
  function power() {
    let left = unary();
    while (isOp("^")) {
      next();
      left = { left, op: "^", right: unary(), type: "binary" };
    }
    return left;
  }
  function unary() {
    if (isOp("-") || isOp("+")) {
      const op = next();
      return { op: op.value, operand: unary(), type: "unary" };
    }
    return percent();
  }
  function percent() {
    let operand = primary();
    while (isOp("%")) {
      next();
      operand = { operand, type: "percent" };
    }
    return operand;
  }
  function primary() {
    const token = next();
    switch (token.kind) {
      case "number":
        return { type: "number", value: token.value };
      case "string":
        return { type: "string", value: token.value };
      case "column":
        return { name: token.name, type: "column" };
      case "tableColumn":
        return { name: token.name, table: token.table, type: "tableColumn" };
      case "name": {
        const upper = token.value.toUpperCase();
        if (isOp("(")) {
          next();
          const args = [];
          if (!isOp(")")) {
            for (; ; ) {
              args.push(comparison());
              if (isOp(",")) {
                next();
                continue;
              }
              break;
            }
          }
          if (!isOp(")")) fail(`${upper}( is missing its )`);
          next();
          return { args, name: upper, type: "call" };
        }
        if (upper === "TRUE" || upper === "FALSE")
          return { type: "boolean", value: upper === "TRUE" };
        return fail(
          `\u201C${token.value}\u201D isn't a column \u2014 put a column's name in brackets: [${token.value}]`,
          token
        );
      }
      case "op":
        if (token.value === "(") {
          const inner = comparison();
          if (!isOp(")")) fail("A ( is missing its )");
          next();
          return inner;
        }
        return fail(`Unexpected ${describe(token)}`, token);
      case "end":
        return fail("The formula ends too soon", token);
    }
  }
  const tree = comparison();
  if (peek().kind !== "end") fail(`Unexpected ${describe(peek())}`);
  return tree;
}

// src/app/formula/sheet-formulas.ts
var clean2 = (name) => (name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
function storedScalar(column, raw) {
  if (raw === void 0 || raw === "") return null;
  switch (column.type) {
    case "number":
    case "percentage": {
      const value = Number(raw);
      return Number.isFinite(value) ? value : raw;
    }
    case "yesno":
      return raw === "true";
    default:
      return raw;
  }
}
var WorkbookFormulas = class {
  constructor(sheets, today) {
    this.sheets = sheets;
    this.today = today;
    for (const sheet of sheets) this.byName.set(clean2(sheet.title), sheet);
  }
  sheets;
  today;
  cache = /* @__PURE__ */ new Map();
  columnCache = /* @__PURE__ */ new Map();
  trees = /* @__PURE__ */ new Map();
  visiting = /* @__PURE__ */ new Set();
  byName = /* @__PURE__ */ new Map();
  table(name) {
    return this.byName.get(clean2(name));
  }
  /** A formula column's value on one of `sheet`'s rows. */
  value(sheet, row2, column) {
    const key = `${sheet.sheetId}:${row2.rowId}:${column.key}`;
    const known = this.cache.get(key);
    if (known !== void 0) return known;
    if (this.visiting.has(key)) return new FormulaError("#CYCLE!", `${column.name} leads back to itself`);
    const tree = this.tree(column.formula ?? "");
    if (tree instanceof FormulaSyntaxError) return new FormulaError("#NAME?", tree.message);
    this.visiting.add(key);
    try {
      const value = evaluateFormula(tree, {
        column: (name) => this.rowValue(sheet, row2, name, column),
        tableColumn: (table, name) => this.tableColumn(table, name),
        today: this.today
      });
      this.cache.set(key, value);
      return value;
    } finally {
      this.visiting.delete(key);
    }
  }
  /** Any column's value on a row, as a formula sees it. */
  cell(sheet, row2, column) {
    return column.type === "formula" ? this.value(sheet, row2, column) : storedScalar(column, row2.data[column.key]);
  }
  /** What's wrong with a cell: a formula's error, or a value that doesn't fit its column (null: nothing). */
  problem(sheet, row2, column, linkOptions = []) {
    if (column.type === "formula") {
      const value2 = this.value(sheet, row2, column);
      return isError(value2) ? value2.reason : null;
    }
    const value = row2.data[column.key];
    if (!value) return null;
    return checkCell(column, value, linkOptions).error ?? null;
  }
  /** What's wrong with a formula as written (null: nothing). */
  check(formula) {
    const tree = this.tree(formula);
    return tree instanceof FormulaSyntaxError ? tree.message : null;
  }
  tree(formula) {
    let tree = this.trees.get(formula);
    if (!tree) {
      try {
        tree = parseFormula(formula);
      } catch (error) {
        tree = error instanceof FormulaSyntaxError ? error : new FormulaSyntaxError("This formula can't be read", 0);
      }
      this.trees.set(formula, tree);
    }
    return tree;
  }
  /** Each table's columns' names as found (the same name read again for every row). */
  resolved = /* @__PURE__ */ new WeakMap();
  /** The column `name` means, from `from`'s formula. */
  resolve(columns, name, from) {
    let known = this.resolved.get(columns);
    if (!known) this.resolved.set(columns, known = /* @__PURE__ */ new Map());
    const key = `${from?.key ?? ""}\0${from?.box ?? ""}\0${name}`;
    if (known.has(key)) return known.get(key);
    const found = this.find(columns, name, from);
    known.set(key, found);
    return found;
  }
  find(columns, name, from) {
    const parts = name.split(/\s*›\s*/);
    const qualified = parts.length > 1;
    const wanted = clean2(parts.at(-1));
    const box = qualified ? clean2(parts[0]) : "";
    const group = parts.length > 2 ? clean2(parts[1]) : "";
    const candidates = columns.filter(
      (column) => column.key !== from?.key && (clean2(column.name) === wanted || clean2(columnLabel(column)) === wanted) && (!qualified || clean2(column.box) === box && (!group || clean2(column.group) === group))
    );
    if (candidates.length <= 1) return candidates[0] ?? null;
    return candidates.find((column) => !column.box) ?? candidates.find((column) => from?.box && clean2(column.box) === clean2(from.box)) ?? candidates.find((column) => column.type !== "formula") ?? candidates[0];
  }
  rowValue(sheet, row2, name, from) {
    const column = this.resolve(sheet.columns, name, from);
    if (!column) return new FormulaError("#NAME?", `No column \u201C${name}\u201D in ${sheet.title}`);
    return this.cell(sheet, row2, column);
  }
  /** Every row's value of a table's column (formula ones worked out). */
  tableColumn(tableName, name) {
    const key = `${clean2(tableName)}\0${clean2(name)}`;
    const known = this.columnCache.get(key);
    if (known) return known;
    const sheet = this.table(tableName);
    if (!sheet) return new FormulaError("#REF!", `No table \u201C${tableName}\u201D`);
    const column = this.resolve(sheet.columns, name);
    if (!column) return new FormulaError("#REF!", `No column \u201C${name}\u201D in ${sheet.title}`);
    const values = sheet.rows.map((row2) => this.cell(sheet, row2, column));
    this.columnCache.set(key, values);
    return values;
  }
  /** The values a link column picks from: its source column's, each once. */
  linkOptions(source) {
    if (!source) return [];
    const values = this.tableColumn(source.table, source.column);
    if (isError(values)) return [];
    const seen = /* @__PURE__ */ new Set();
    const options = [];
    for (const value of values) {
      if (value === null || value === "" || isError(value)) continue;
      const text = String(value).trim();
      const key = text.toLowerCase();
      if (text && !seen.has(key)) {
        seen.add(key);
        options.push(text);
      }
    }
    return options;
  }
};

// src/app/core/workbook-store.ts
var WorkbookStore = class {
  api = inject(Api);
  toasts = inject(Toasts);
  workbook = signal2(null);
  loading = signal2(false);
  saving = signal2(0);
  /** Goes up on every saved change (the Power BI file follows it). */
  version = signal2(0);
  mac = computed(() => this.workbook()?.mac ?? null);
  sheets = computed(() => this.workbook()?.sheets ?? []);
  formulas = computed(() => new WorkbookFormulas(this.sheets(), todayIso()));
  /** The tables under their headings, in order. */
  headings = computed(() => {
    const groups = /* @__PURE__ */ new Map();
    for (const sheet of this.sheets()) {
      const list = groups.get(sheet.heading) ?? [];
      list.push(sheet);
      groups.set(sheet.heading, list);
    }
    return [...groups.entries()].map(([heading, sheets]) => ({ heading, sheets }));
  });
  async load(macId) {
    if (this.workbook()?.mac.macId !== macId) this.workbook.set(null);
    this.loading.set(true);
    try {
      this.workbook.set(await this.api.getWorkbook(macId));
    } catch (error) {
      this.toasts.error(errorText(error));
      this.workbook.set(null);
    } finally {
      this.loading.set(false);
    }
  }
  async reload() {
    const mac = this.mac();
    if (mac) await this.load(mac.macId);
  }
  sheet(sheetId) {
    return this.sheets().find((sheet) => sheet.sheetId === sheetId) ?? null;
  }
  linkOptions(column) {
    return column.type === "link" ? this.formulas().linkOptions(parseLinkSource(column.source)) : [];
  }
  // ------------------------------------------------------------ helpers
  async run(work) {
    this.saving.update((n) => n + 1);
    try {
      const result = await work();
      this.version.update((n) => n + 1);
      return result;
    } finally {
      this.saving.update((n) => n - 1);
    }
  }
  patchSheets(update) {
    this.workbook.update((book) => book ? { ...book, sheets: update(book.sheets) } : book);
  }
  patchSheet(sheetId, update) {
    this.patchSheets((sheets) => sheets.map((sheet) => sheet.sheetId === sheetId ? update(sheet) : sheet));
  }
  withMeta(sheet, meta) {
    return { ...sheet, ...meta, rows: sheet.rows, rowCount: sheet.rows.length };
  }
  // ------------------------------------------------------------- tables
  async createSheet(input) {
    const mac = this.mac();
    if (!mac) throw new Error("No MAC is open");
    const sheet = await this.run(() => this.api.createSheet(mac.macId, input));
    this.patchSheets((sheets) => [...sheets, sheet]);
    return sheet;
  }
  async updateSheet(sheetId, input) {
    const before = this.sheet(sheetId);
    const meta = await this.run(() => this.api.updateSheet(sheetId, input));
    this.patchSheet(sheetId, (sheet) => this.withMeta(sheet, meta));
    if (before && before.title !== meta.title) await this.reload();
    return meta;
  }
  async saveColumns(sheetId, columns) {
    const before = this.sheet(sheetId);
    const meta = await this.run(() => this.api.saveColumns(sheetId, columns));
    const removed = (before?.columns ?? []).filter((old) => !meta.columns.some((column) => column.key === old.key));
    const renamed = (before?.columns ?? []).some(
      (old) => meta.columns.some((column) => column.key === old.key && column.name !== old.name)
    );
    if (renamed) {
      await this.reload();
    } else {
      this.patchSheet(sheetId, (sheet) => {
        const rows = removed.length ? sheet.rows.map((row2) => {
          const data = { ...row2.data };
          for (const column of removed) delete data[column.key];
          return { ...row2, data };
        }) : sheet.rows;
        return { ...this.withMeta(sheet, meta), rows };
      });
    }
    return meta;
  }
  async saveDashboard(sheetId, dashboard) {
    const meta = await this.run(() => this.api.saveDashboard(sheetId, dashboard));
    this.patchSheet(sheetId, (sheet) => this.withMeta(sheet, meta));
    return meta;
  }
  async deleteSheet(sheetId) {
    await this.run(() => this.api.deleteSheet(sheetId));
    this.patchSheets((sheets) => sheets.filter((sheet) => sheet.sheetId !== sheetId));
  }
  async reorderSheets(sheetIds) {
    const mac = this.mac();
    if (!mac) return;
    this.patchSheets(
      (sheets) => sheetIds.map((id, order) => {
        const sheet = sheets.find((item) => item.sheetId === id);
        return sheet ? { ...sheet, displayOrder: order } : null;
      }).filter((sheet) => sheet !== null)
    );
    await this.run(() => this.api.reorderSheets(mac.macId, sheetIds));
  }
  // --------------------------------------------------------------- rows
  /** A new row's stand-in id (below 0) until it's saved. */
  nextTempId = -1;
  /** Edits and deletes made to a row before it was saved, sent once it is. */
  heldEdits = /* @__PURE__ */ new Map();
  heldDeletes = /* @__PURE__ */ new Set();
  async addRows(sheetId, rows, options = {}) {
    if (options.import || options.afterRowId !== void 0 && options.afterRowId !== null) {
      const added = await this.run(() => this.api.addRows(sheetId, rows, options));
      this.patchSheet(sheetId, (sheet2) => {
        const kept = options.import?.mode === "replace" ? [] : sheet2.rows;
        const all = [...kept, ...added].sort((a, b) => a.position - b.position || a.rowId - b.rowId);
        return { ...sheet2, rows: all, rowCount: all.length };
      });
      return added;
    }
    const sheet = this.sheet(sheetId);
    if (!sheet) return [];
    const last = sheet.rows.reduce((max, row2) => Math.max(max, row2.position), 0);
    const temps = rows.map((data, index) => ({
      rowId: this.nextTempId--,
      sheetId,
      position: last + index + 1,
      data: Object.fromEntries(Object.entries(data).filter(([, value]) => value.trim())),
      importId: null,
      createdAt: "",
      updatedAt: ""
    }));
    this.patchSheet(sheetId, (current) => {
      const all = [...current.rows, ...temps];
      return { ...current, rows: all, rowCount: all.length };
    });
    try {
      const saved = await this.run(() => this.api.addRows(sheetId, rows));
      const real = new Map(temps.map((temp, index) => [temp.rowId, saved[index]]));
      this.patchSheet(sheetId, (current) => ({
        ...current,
        rows: current.rows.map((row2) => {
          const savedRow = real.get(row2.rowId);
          return savedRow ? { ...savedRow, data: row2.data } : row2;
        })
      }));
      const edits = [];
      const deletes = [];
      for (const temp of temps) {
        const id = real.get(temp.rowId).rowId;
        for (const edit of this.heldEdits.get(temp.rowId) ?? []) edits.push({ ...edit, rowId: id });
        if (this.heldDeletes.has(temp.rowId)) deletes.push(id);
        this.heldEdits.delete(temp.rowId);
        this.heldDeletes.delete(temp.rowId);
      }
      if (edits.length) await this.updateCells(sheetId, edits);
      if (deletes.length) await this.deleteRows(sheetId, deletes);
      return saved;
    } catch (error) {
      const gone = new Set(temps.map((temp) => temp.rowId));
      for (const id of gone) {
        this.heldEdits.delete(id);
        this.heldDeletes.delete(id);
      }
      this.patchSheet(sheetId, (current) => {
        const kept = current.rows.filter((row2) => !gone.has(row2.rowId));
        return { ...current, rows: kept, rowCount: kept.length };
      });
      throw error;
    }
  }
  /** Cell edits: shown at once, saved behind; put back if saving fails. */
  async updateCells(sheetId, changes) {
    if (!changes.length) return;
    const sheet = this.sheet(sheetId);
    if (!sheet) return;
    const before = sheet.rows;
    const byRow = /* @__PURE__ */ new Map();
    for (const change of changes) byRow.set(change.rowId, [...byRow.get(change.rowId) ?? [], change]);
    this.patchSheet(sheetId, (current) => ({
      ...current,
      rows: current.rows.map((row2) => {
        const edits = byRow.get(row2.rowId);
        if (!edits) return row2;
        const data = { ...row2.data };
        for (const edit of edits) {
          const value = (edit.value ?? "").trim();
          if (value) data[edit.key] = value;
          else delete data[edit.key];
        }
        return { ...row2, data };
      })
    }));
    const held = changes.filter((change) => change.rowId < 0);
    for (const change of held) this.heldEdits.set(change.rowId, [...this.heldEdits.get(change.rowId) ?? [], change]);
    const sending = changes.filter((change) => change.rowId > 0);
    if (!sending.length) return;
    try {
      const saved = await this.run(() => this.api.updateCells(sheetId, sending));
      const byId = new Map(saved.map((row2) => [row2.rowId, row2]));
      this.patchSheet(sheetId, (current) => ({
        ...current,
        rows: current.rows.map((row2) => byId.get(row2.rowId) ?? row2)
      }));
    } catch (error) {
      this.patchSheet(sheetId, (current) => ({ ...current, rows: before }));
      this.toasts.error(`Not saved: ${errorText(error)}`);
    }
  }
  async deleteRows(sheetId, rowIds) {
    if (!rowIds.length) return;
    for (const id of rowIds) if (id < 0) this.heldDeletes.add(id);
    const saved = rowIds.filter((id) => id > 0);
    if (saved.length) await this.run(() => this.api.deleteRows(sheetId, saved));
    const gone = new Set(rowIds);
    this.patchSheet(sheetId, (sheet) => {
      const rows = sheet.rows.filter((row2) => !gone.has(row2.rowId));
      return { ...sheet, rows, rowCount: rows.length };
    });
  }
  /** The rows in the order given (sorted or moved in the sheet): shown so at once, saved behind. */
  async reorderRows(sheetId, rowIds) {
    const sheet = this.sheet(sheetId);
    if (!sheet) return;
    const at = new Map(rowIds.map((id, index) => [id, index]));
    const named = sheet.rows.filter((row2) => at.has(row2.rowId)).sort((a, b) => at.get(a.rowId) - at.get(b.rowId));
    const rest = sheet.rows.filter((row2) => !at.has(row2.rowId));
    const rows = [...named, ...rest].map((row2, index) => ({ ...row2, position: index + 1 }));
    this.patchSheet(sheetId, (current) => ({ ...current, rows }));
    const saved = rowIds.filter((id) => id > 0);
    if (saved.length) await this.run(() => this.api.reorderRows(sheetId, saved));
  }
  async undoImport(sheetId, importId) {
    const removed = await this.run(() => this.api.undoImport(importId));
    this.patchSheet(sheetId, (sheet) => {
      const rows = sheet.rows.filter((row2) => row2.importId !== importId);
      return { ...sheet, rows, rowCount: rows.length };
    });
    return removed;
  }
};
WorkbookStore = __decorateClass([
  Injectable3({ providedIn: "root" })
], WorkbookStore);

// .pm/verification/store-failure-repro.ts
function row(id, value) {
  return { rowId: id, sheetId: 1, position: id, data: { c1: value }, importId: null, createdAt: "", updatedAt: "" };
}
function fixture() {
  return {
    mac: { macId: 1, macUuid: "pm-fixture", macName: "PM disposable fixture", macCode: "PM-TEST", macLocation: null, latitude: null, longitude: null, startDate: null, endDate: null, crop: "chili", note: null, createdAt: "", updatedAt: "", sheetCount: 1, rowCount: 2 },
    sheets: [{ sheetId: 1, macId: 1, title: "Fixture", heading: "Fixture", about: "", icon: null, templateKey: null, columns: [{ key: "c1", name: "Value", type: "text" }], dashboard: null, displayOrder: 0, rowCount: 2, createdAt: "", updatedAt: "", rows: [row(1, "first-original"), row(2, "second-original")] }]
  };
}
function storeWith(api) {
  const errors = [];
  const injector = createEnvironmentInjector([
    { provide: Api, useValue: api },
    { provide: Toasts, useValue: { error: (message2) => errors.push(message2) } }
  ], Injector.NULL);
  const store = runInInjectionContext(injector, () => new WorkbookStore());
  store.workbook.set(fixture());
  return { store, errors, injector };
}
async function failedCellSave() {
  const { store, errors, injector } = storeWith({ updateCells: async () => {
    throw new Error("PM simulated write failure");
  } });
  let rejected = false;
  try {
    await store.updateCells(1, [{ rowId: 1, key: "c1", value: "new value" }]);
  } catch {
    rejected = true;
  }
  const evidence = { scenario: "failed cell save", promiseRejected: rejected, pendingCount: store.saving(), displayedValue: store.sheet(1).rows[0].data.c1, errorToastCount: errors.length };
  assert.equal(rejected, false, "Current defect reproduction expects rejection to be swallowed");
  assert.equal(store.saving(), 0);
  assert.equal(errors.length, 1);
  console.log(JSON.stringify(evidence));
  injector.destroy();
}
async function failedReorder() {
  const { store, errors, injector } = storeWith({ reorderRows: async () => {
    throw new Error("PM simulated reorder failure");
  } });
  let rejected = false;
  try {
    await store.reorderRows(1, [2, 1]);
  } catch {
    rejected = true;
  }
  const displayedOrder = store.sheet(1).rows.map((r) => r.rowId);
  assert.equal(rejected, true);
  assert.deepEqual(displayedOrder, [2, 1], "Current defect reproduction expects failed optimistic order to remain");
  console.log(JSON.stringify({ scenario: "failed row reorder", promiseRejected: rejected, pendingCount: store.saving(), displayedOrder, persistedFixtureOrder: [1, 2], storeErrorToastCount: errors.length }));
  injector.destroy();
}
async function overlappingSaves() {
  const pending = [];
  const { store, injector } = storeWith({ updateCells: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) });
  const first = store.updateCells(1, [{ rowId: 1, key: "c1", value: "first-edit" }]);
  const second = store.updateCells(1, [{ rowId: 2, key: "c1", value: "second-saved" }]);
  assert.equal(pending.length, 2);
  pending[1].resolve([row(2, "second-saved")]);
  await second;
  assert.equal(store.sheet(1).rows.find((r) => r.rowId === 2).data.c1, "second-saved");
  pending[0].reject(new Error("PM first write fails after the second succeeds"));
  await first;
  const displayedValue = store.sheet(1).rows.find((r) => r.rowId === 2).data.c1;
  assert.equal(displayedValue, "second-original", "Current defect reproduction expects unrelated successful edit to be reverted in memory");
  console.log(JSON.stringify({ scenario: "overlapping saves, first fails after second succeeds", pendingCount: store.saving(), displayedSecondRow: displayedValue, persistedFixtureSecondRow: "second-saved" }));
  injector.destroy();
}
await failedCellSave();
await failedReorder();
await overlappingSaves();
