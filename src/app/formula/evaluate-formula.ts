import { formatPattern } from "./number-format";
import type { FormulaNode } from "./parse-formula";

/** A value a formula works with or gives: a number, text, Yes / No, a
 * blank, or an error (Excel's codes). A date is its "YYYY-MM-DD" text. */
export type FormulaScalar = number | string | boolean | null | FormulaError;
/** Another table's whole column (only LOOKUP, SUMIF and the like, and
 * SUM, COUNT, … take one). */
type FormulaValue = FormulaScalar | FormulaScalar[];

type FormulaErrorCode =
  "#CYCLE!" | "#DIV/0!" | "#N/A" | "#NAME?" | "#REF!" | "#VALUE!";

export class FormulaError {
  constructor(
    readonly code: FormulaErrorCode,
    /** Why, for the cell's tooltip. */
    readonly reason: string,
  ) {}
}

/** Where a formula reads its columns from. */
type FormulaScope = {
  /** This row's value of a column, by its name — or an error (#NAME?: no
   * such column). */
  column: (name: string) => FormulaScalar;
  /** Every row's value of another table's column — or an error (#REF!: no
   * such table or column). */
  tableColumn: (table: string, name: string) => FormulaScalar[] | FormulaError;
  /** Today, "YYYY-MM-DD". */
  today: string;
};

const isError = (value: unknown): value is FormulaError =>
  value instanceof FormulaError;
const isBlank = (value: FormulaScalar) => value === null || value === "";

function firstError(values: readonly FormulaValue[]) {
  for (const value of values) {
    if (isError(value)) return value;
    if (Array.isArray(value)) {
      const inner = value.find(isError);
      if (inner) return inner;
    }
  }
  return null;
}

function toNumber(value: FormulaScalar): number | FormulaError {
  if (isError(value)) return value;
  if (value === null || value === "") return 0;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  const number = Number(value.trim().replace(/,/g, ""));
  return Number.isFinite(number)
    ? number
    : new FormulaError("#VALUE!", `“${value}” isn't a number`);
}

function toText(value: FormulaScalar): string | FormulaError {
  if (isError(value)) return value;
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return formatFormulaNumber(value);
  return value;
}

function toBoolean(value: FormulaScalar): boolean | FormulaError {
  if (isError(value)) return value;
  if (value === null) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const text = value.trim().toLowerCase();
  if (["true", "yes"].includes(text)) return true;
  if (["false", "no", ""].includes(text)) return false;
  return new FormulaError("#VALUE!", `“${value}” isn't Yes or No`);
}

/** A number as a cell shows it: no floating-point noise (0.1 + 0.2 is 0.3). */
function formatFormulaNumber(value: number) {
  if (!Number.isFinite(value)) return String(value);
  return String(Number(value.toPrecision(12)));
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})/;
function toDay(value: FormulaScalar): number | FormulaError {
  // Days since 1970, for DAYS and date maths.
  if (isError(value)) return value;
  if (typeof value === "string") {
    const match = DATE.exec(value.trim());
    if (match)
      return (
        Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) /
        86_400_000
      );
  }
  return new FormulaError("#VALUE!", `“${String(value ?? "")}” isn't a date`);
}

/** Two values the same for LOOKUP and the …IF functions: numbers by value,
 * text without minding case or the spaces around it. */
function sameValue(a: FormulaScalar, b: FormulaScalar) {
  if (isError(a) || isError(b)) return false;
  if (isBlank(a) || isBlank(b)) return isBlank(a) && isBlank(b);
  const na = typeof a === "number" ? a : Number(a);
  const nb = typeof b === "number" ? b : Number(b);
  if (
    (typeof a === "number" || typeof b === "number") &&
    Number.isFinite(na) &&
    Number.isFinite(nb)
  )
    return na === nb;
  const ta = toText(a);
  const tb = toText(b);
  return (
    typeof ta === "string" &&
    typeof tb === "string" &&
    ta.trim().toLowerCase() === tb.trim().toLowerCase()
  );
}

function compare(a: FormulaScalar, b: FormulaScalar): number {
  // Numbers by value when both are numbers (a blank counts as 0); else as
  // text, without minding case.
  const numeric = (value: FormulaScalar) =>
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null ||
    (typeof value === "string" &&
      value.trim() !== "" &&
      Number.isFinite(Number(value)));
  if (numeric(a) && numeric(b)) {
    const na = toNumber(a) as number;
    const nb = toNumber(b) as number;
    return na === nb ? 0 : na < nb ? -1 : 1;
  }
  const ta = String(toText(a)).toLowerCase();
  const tb = String(toText(b)).toLowerCase();
  return ta === tb ? 0 : ta < tb ? -1 : 1;
}

/** The numbers among a function's arguments (a table's column counts each
 * of its numbers; blanks and text in it are skipped, as Excel does). */
function numbersIn(values: readonly FormulaValue[]): number[] | FormulaError {
  const numbers: number[] = [];
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

type FunctionSpec = {
  /** Fewest and most arguments (Infinity: any number). */
  arity: [number, number];
  /** Takes another table's column ('Table'[Column]) at these places. */
  columns?: readonly number[];
  /** Arguments it works out only when needed (IF, IFERROR). */
  lazy?: boolean;
  run: (
    args: FormulaValue[],
    scope: FormulaScope,
    nodes: FormulaNode[],
    evaluate: (node: FormulaNode) => FormulaValue,
  ) => FormulaValue;
};

const scalar = (value: FormulaValue): FormulaScalar =>
  Array.isArray(value)
    ? new FormulaError("#VALUE!", "A whole table's column can't go here")
    : value;

function aggregate(
  pick: (numbers: number[]) => number | FormulaError,
): FunctionSpec {
  return {
    arity: [1, Infinity],
    columns: Array.from({ length: 30 }, (_, index) => index),
    run: (args) => {
      const numbers = numbersIn(args);
      return isError(numbers) ? numbers : pick(numbers);
    },
  };
}

/** The rows of a table's column that match `value` in another column of it
 * (SUMIF, COUNTIF, AVERAGEIF): the same table, the same number of rows. */
function matching(
  results: FormulaValue,
  keys: FormulaValue,
  value: FormulaValue,
): FormulaScalar[] | FormulaError {
  if (!Array.isArray(keys) || !Array.isArray(results))
    return new FormulaError(
      "#VALUE!",
      "Name another table's columns here: 'Table'[Column]",
    );
  const wanted = scalar(value);
  if (isError(wanted)) return wanted;
  if (keys.length !== results.length)
    return new FormulaError(
      "#VALUE!",
      "Both columns must be from the same table",
    );
  return results.filter((_, index) => sameValue(keys[index], wanted));
}

/** A column filtered by any number of column/value pairs. */
function matchingAll(
  results: FormulaValue,
  conditions: FormulaValue[],
  name: string,
): FormulaScalar[] | FormulaError {
  if (isError(results)) return results;
  if (!Array.isArray(results) || conditions.length % 2 !== 0)
    return new FormulaError(
      "#VALUE!",
      `${name} needs a value column followed by matching column/value pairs`,
    );
  const pairs: { keys: FormulaScalar[]; wanted: FormulaScalar }[] = [];
  for (let at = 0; at < conditions.length; at += 2) {
    const keys = conditions[at];
    const wanted = scalar(conditions[at + 1]);
    if (isError(keys)) return keys;
    if (isError(wanted)) return wanted;
    if (!Array.isArray(keys) || keys.length !== results.length)
      return new FormulaError(
        "#VALUE!",
        `${name} columns must have the same number of records`,
      );
    pairs.push({ keys, wanted });
  }
  return results.filter((_, at) =>
    pairs.every(({ keys, wanted }) => sameValue(keys[at], wanted)),
  );
}

const FUNCTIONS: Record<string, FunctionSpec> = {
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
    },
  },
  AVERAGE: aggregate((numbers) =>
    numbers.length
      ? numbers.reduce((sum, number) => sum + number, 0) / numbers.length
      : new FormulaError("#DIV/0!", "Nothing to average"),
  ),
  AVERAGEIF: {
    arity: [3, 3],
    columns: [0, 1],
    run: ([results, keys, value]) => {
      const rows = matching(results, keys, value);
      if (isError(rows)) return rows;
      const numbers = numbersIn([rows]);
      if (isError(numbers)) return numbers;
      return numbers.length
        ? numbers.reduce((sum, number) => sum + number, 0) / numbers.length
        : new FormulaError("#DIV/0!", "No rows match, so nothing to average");
    },
  },
  AVERAGEIFS: {
    arity: [3, 255],
    columns: [0, ...Array.from({ length: 127 }, (_, at) => 1 + at * 2)],
    run: ([results, ...conditions]) => {
      const rows = matchingAll(results, conditions, "AVERAGEIFS");
      if (isError(rows)) return rows;
      const numbers = numbersIn([rows]);
      if (isError(numbers)) return numbers;
      return numbers.length
        ? numbers.reduce((sum, number) => sum + number, 0) / numbers.length
        : new FormulaError("#DIV/0!", "No rows match, so nothing to average");
    },
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
    },
  },
  COUNT: {
    arity: [1, Infinity],
    columns: Array.from({ length: 30 }, (_, index) => index),
    run: (args) => {
      const numbers = numbersIn(args);
      return isError(numbers) ? numbers : numbers.length;
    },
  },
  COUNTA: {
    arity: [1, Infinity],
    columns: Array.from({ length: 30 }, (_, index) => index),
    run: (args) =>
      args
        .flatMap((arg) => (Array.isArray(arg) ? arg : [arg]))
        .filter((value) => !isBlank(value)).length,
  },
  COUNTIF: {
    arity: [2, 2],
    columns: [0],
    run: ([keys, value]) => {
      const rows = matching(keys, keys, value);
      return isError(rows) ? rows : rows.length;
    },
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
    },
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
    },
  },
  IF: {
    arity: [2, 3],
    lazy: true,
    run: (_args, _scope, nodes, evaluate) => {
      const test = toBoolean(scalar(evaluate(nodes[0])));
      if (isError(test)) return test;
      if (test) return evaluate(nodes[1]);
      return nodes[2] ? evaluate(nodes[2]) : false;
    },
  },
  IFERROR: {
    arity: [2, 2],
    lazy: true,
    run: (_args, _scope, nodes, evaluate) => {
      const value = evaluate(nodes[0]);
      return isError(value) ? evaluate(nodes[1]) : value;
    },
  },
  IFS: {
    // Condition / value pairs, the first condition that holds gives its value (TRUE last: the rest); none: #N/A.
    arity: [2, Infinity],
    lazy: true,
    run: (_args, _scope, nodes, evaluate) => {
      if (nodes.length % 2 !== 0)
        return new FormulaError("#VALUE!", "IFS takes a condition and a value, in pairs");
      for (let at = 0; at < nodes.length; at += 2) {
        const test = toBoolean(scalar(evaluate(nodes[at])));
        if (isError(test)) return test;
        if (test) return evaluate(nodes[at + 1]);
      }
      return new FormulaError("#N/A", "No condition of IFS holds");
    },
  },
  INT: { arity: [1, 1], run: ([x]) => math(x, Math.floor) },
  ISBLANK: {
    arity: [1, 1],
    run: ([value]) => {
      const item = scalar(value);
      return !isError(item) && isBlank(item);
    },
  },
  LEFT: { arity: [1, 2], run: ([text, count]) => slice(text, count, "left") },
  LEN: {
    arity: [1, 1],
    run: ([text]) => {
      const value = toText(scalar(text));
      return isError(value) ? value : value.length;
    },
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
          "Name another table's columns here: 'Table'[Column]",
        );
      const wanted = scalar(value);
      if (isError(wanted)) return wanted;
      const at = keys.findIndex((key) => sameValue(key, wanted));
      if (at !== -1) return results[at] ?? null;
      return notFound === undefined
        ? new FormulaError("#N/A", `No row matches “${String(toText(wanted))}”`)
        : scalar(notFound);
    },
  },
  LOWER: {
    arity: [1, 1],
    run: ([text]) => mapText(text, (t) => t.toLowerCase()),
  },
  MAX: aggregate((numbers) => (numbers.length ? Math.max(...numbers) : 0)),
  MIN: aggregate((numbers) => (numbers.length ? Math.min(...numbers) : 0)),
  MOD: {
    arity: [2, 2],
    run: ([a, b]) => {
      const x = toNumber(scalar(a));
      const y = toNumber(scalar(b));
      if (isError(x)) return x;
      if (isError(y)) return y;
      if (y === 0) return new FormulaError("#DIV/0!", "MOD by 0");
      return x - y * Math.floor(x / y);
    },
  },
  MONTH: { arity: [1, 1], run: ([date]) => datePart(date, 2) },
  N: {
    // A number as a number, a Yes as 1, anything else (text, a blank) as 0.
    arity: [1, 1],
    run: ([value]) => {
      const item = scalar(value);
      if (isError(item)) return item;
      if (typeof item === "number") return item;
      if (typeof item === "boolean") return item ? 1 : 0;
      return 0;
    },
  },
  NOT: {
    arity: [1, 1],
    run: ([value]) => {
      const test = toBoolean(scalar(value));
      return isError(test) ? test : !test;
    },
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
    },
  },
  POWER: {
    arity: [2, 2],
    run: ([a, b]) => {
      const x = toNumber(scalar(a));
      const y = toNumber(scalar(b));
      if (isError(x)) return x;
      if (isError(y)) return y;
      return x ** y;
    },
  },
  RIGHT: { arity: [1, 2], run: ([text, count]) => slice(text, count, "right") },
  ROUND: { arity: [1, 2], run: ([x, places]) => round(x, places, Math.round) },
  ROUNDDOWN: {
    arity: [1, 2],
    run: ([x, places]) => round(x, places, Math.trunc),
  },
  ROUNDUP: {
    arity: [1, 2],
    run: ([x, places]) =>
      round(x, places, (n) => (n < 0 ? -Math.ceil(-n) : Math.ceil(n))),
  },
  SQRT: {
    arity: [1, 1],
    run: ([x]) => {
      const number = toNumber(scalar(x));
      if (isError(number)) return number;
      return number < 0
        ? new FormulaError("#VALUE!", "No square root of a negative number")
        : Math.sqrt(number);
    },
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
      return isError(numbers)
        ? numbers
        : numbers.reduce((sum, number) => sum + number, 0);
    },
  },
  SUMIFS: {
    arity: [3, 255],
    columns: [0, ...Array.from({ length: 127 }, (_, at) => 1 + at * 2)],
    run: ([results, ...conditions]) => {
      const rows = matchingAll(results, conditions, "SUMIFS");
      if (isError(rows)) return rows;
      const numbers = numbersIn([rows]);
      return isError(numbers)
        ? numbers
        : numbers.reduce((sum, number) => sum + number, 0);
    },
  },
  TEXT: {
    // A number as its format writes it ("0%", "0.00", "0.0%"); text and blanks as they are.
    arity: [2, 2],
    run: ([value, pattern]) => {
      const item = scalar(value);
      const format = toText(scalar(pattern));
      if (isError(item)) return item;
      if (isError(format)) return format;
      if (typeof item === "number") return formatPattern(item, format);
      if (typeof item === "string" && item.trim() !== "" && Number.isFinite(Number(item)))
        return formatPattern(Number(item), format);
      return toText(item);
    },
  },
  TODAY: { arity: [0, 0], run: (_args, scope) => scope.today },
  TRIM: {
    arity: [1, 1],
    run: ([text]) => mapText(text, (t) => t.trim().replace(/\s+/g, " ")),
  },
  UNIQUEJOIN: {
    arity: [1, 255],
    columns: [0, ...Array.from({ length: 127 }, (_, at) => 1 + at * 2)],
    run: ([results, ...conditions]) => {
      const rows = matchingAll(results, conditions, "UNIQUEJOIN");
      if (isError(rows)) return rows;
      const unique = new Map<string, string>();
      for (const value of rows) {
        const text = toText(value);
        if (isError(text)) return text;
        const label = text.trim();
        const key = label.toLowerCase();
        if (label && !unique.has(key)) unique.set(key, label);
      }
      return [...unique.values()]
        .sort((a, b) =>
          a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }),
        )
        .join(", ");
    },
  },
  UPPER: {
    arity: [1, 1],
    run: ([text]) => mapText(text, (t) => t.toUpperCase()),
  },
  YEAR: { arity: [1, 1], run: ([date]) => datePart(date, 1) },
};
FUNCTIONS['CONCATENATE'] = FUNCTIONS['CONCAT'];
FUNCTIONS['XLOOKUP'] = FUNCTIONS['LOOKUP'];
FUNCTIONS['LOOKUPVALUE'] = FUNCTIONS['LOOKUP'];

/** The functions a formula can use, for the editor's help. */
export const FORMULA_FUNCTIONS = Object.keys(FUNCTIONS).sort();

function math(value: FormulaValue, fn: (n: number) => number) {
  const number = toNumber(scalar(value));
  return isError(number) ? number : fn(number);
}

function round(
  value: FormulaValue,
  places: FormulaValue = 0,
  fn: (n: number) => number,
) {
  const number = toNumber(scalar(value));
  const digits = toNumber(scalar(places));
  if (isError(number)) return number;
  if (isError(digits)) return digits;
  // Shifted through its written exponent, so 1.005 rounds the way it reads
  // (1.01), not the way it's stored (1.00499…).
  const shift = (n: number, by: number) => {
    const [mantissa, exponent = "0"] = String(n).split("e");
    return Number(`${mantissa}e${Number(exponent) + by}`);
  };
  const by = Math.trunc(digits);
  return shift(fn(shift(number, by)), -by);
}

function slice(
  value: FormulaValue,
  count: FormulaValue = 1,
  side: "left" | "right",
) {
  const text = toText(scalar(value));
  const length = toNumber(scalar(count));
  if (isError(text)) return text;
  if (isError(length)) return length;
  const n = Math.max(0, Math.trunc(length));
  return side === "left" ? text.slice(0, n) : n ? text.slice(-n) : "";
}

function mapText(value: FormulaValue, fn: (text: string) => string) {
  const text = toText(scalar(value));
  return isError(text) ? text : fn(text);
}

function datePart(value: FormulaValue, part: 1 | 2 | 3) {
  const item = scalar(value);
  if (isError(item)) return item;
  const match = typeof item === "string" ? DATE.exec(item.trim()) : null;
  return match
    ? Number(match[part])
    : new FormulaError("#VALUE!", `“${String(item ?? "")}” isn't a date`);
}

/** Works out a formula's tree in `scope`. Never throws: what goes wrong is
 * an error value (#NAME?, #DIV/0!, …). */
export function evaluateFormula(
  tree: FormulaNode,
  scope: FormulaScope,
): FormulaScalar {
  const evaluate = (node: FormulaNode): FormulaValue => {
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
          scalar(evaluate(node.right)),
        );
      case "call": {
        const spec = FUNCTIONS[node.name];
        if (!spec)
          return new FormulaError("#NAME?", `There's no function ${node.name}`);
        const [fewest, most] = spec.arity;
        if (node.args.length < fewest || node.args.length > most)
          return new FormulaError(
            "#VALUE!",
            fewest === most
              ? `${node.name} takes ${fewest} value${fewest === 1 ? "" : "s"}`
              : most === Infinity
                ? `${node.name} takes at least ${fewest}`
                : `${node.name} takes ${fewest} to ${most} values`,
          );
        if (spec.lazy) return spec.run([], scope, node.args, evaluate);
        const args = node.args.map((arg, index) => {
          const value = evaluate(arg);
          // A table's whole column only where the function takes one.
          return Array.isArray(value) && !spec.columns?.includes(index)
            ? new FormulaError(
                "#VALUE!",
                `${node.name} can't take a whole table's column there`,
              )
            : value;
        });
        // LOOKUP and the …IF functions look past a column's own errors.
        const error = spec.columns ? null : firstError(args);
        return error ?? spec.run(args, scope, node.args, evaluate);
      }
    }
  };
  return scalar(evaluate(tree));
}

/** A date's days since 1970, or null for anything else. */
function dayOf(value: FormulaScalar) {
  return typeof value === "string" && DATE.test(value.trim())
    ? (toDay(value) as number)
    : null;
}

/** Days since 1970 as a date ("yyyy-mm-dd"). */
function dateOfDay(day: number) {
  return new Date(Math.floor(day) * 86_400_000).toISOString().slice(0, 10);
}

/** A date with days added or taken off is a date, and one date taken from
 * another the days between them — as a sheet does (the old QC sheet's
 * stage dates: planting date + 7). Null: not date maths. */
function dateMaths(op: string, left: FormulaScalar, right: FormulaScalar) {
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

function binary(
  op: string,
  left: FormulaScalar,
  right: FormulaScalar,
): FormulaScalar {
  if (isError(left)) return left;
  if (isError(right)) return right;
  if (op === "&") return `${toText(left) as string}${toText(right) as string}`;
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

/** A result as a cell shows it: an error's code, Yes / No, a number
 * without noise, a blank as nothing. */
export function formatFormulaValue(value: FormulaScalar): string {
  if (isError(value)) return value.code;
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return formatFormulaNumber(value);
  return value;
}

export { isError as isFormulaError };
