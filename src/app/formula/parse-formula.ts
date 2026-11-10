/** A formula column's formula, read into a tree — Excel's operators and
 * functions, with columns named Power BI's way: `[Quantity]` is this row's
 * Quantity; `'Seed stock'[Price]` (or `Harvest[Weight]`, a one-word name)
 * is another table's whole Price column, for LOOKUP, SUMIF and the rest.
 *
 *   =[Quantity] * [Price]
 *   =IF([Dead] > 5, "Check", "OK")
 *   =LOOKUP('Seed stock'[Price], 'Seed stock'[Variety], [Variety])
 *   =SUMIF('Harvest'[Weight], 'Harvest'[Zone], [Zone]) */

export type FormulaNode =
  | { type: "number"; value: number }
  | { type: "string"; value: string }
  | { type: "boolean"; value: boolean }
  | { type: "column"; name: string }
  | { type: "tableColumn"; table: string; name: string }
  | { type: "call"; name: string; args: FormulaNode[] }
  | { type: "unary"; op: "-" | "+"; operand: FormulaNode }
  | { type: "percent"; operand: FormulaNode }
  | { type: "binary"; op: BinaryOp; left: FormulaNode; right: FormulaNode };

export type BinaryOp =
  "+" | "-" | "*" | "/" | "^" | "&" | "=" | "<>" | "<" | ">" | "<=" | ">=";

/** What's wrong with a formula, and where (a character index). */
export class FormulaSyntaxError extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(message);
  }
}

type Token =
  | { kind: "number"; value: number; at: number }
  | { kind: "string"; value: string; at: number }
  | { kind: "column"; name: string; at: number }
  | { kind: "tableColumn"; table: string; name: string; at: number }
  | { kind: "name"; value: string; at: number }
  | { kind: "op"; value: string; at: number }
  | { kind: "end"; at: number };

const OPERATORS = [
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
  ";",
];

function readBracket(text: string, start: number) {
  // `[Name]`: everything up to the closing bracket.
  const end = text.indexOf("]", start + 1);
  if (end === -1)
    throw new FormulaSyntaxError("A column name is missing its ]", start);
  const name = text.slice(start + 1, end).trim();
  if (!name) throw new FormulaSyntaxError("A column name is empty: []", start);
  return { end: end + 1, name };
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(char)) {
      const match = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(text.slice(i));
      if (!match) throw new FormulaSyntaxError(`Unexpected “${char}”`, i);
      tokens.push({ at: i, kind: "number", value: Number(match[0]) });
      i += match[0].length;
      continue;
    }
    if (char === '"') {
      // "Text", with "" for a quote inside.
      let value = "";
      let j = i + 1;
      for (;;) {
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
      // 'Table name'[Column], with '' for a quote inside the name.
      let table = "";
      let j = i + 1;
      for (;;) {
        if (j >= text.length)
          throw new FormulaSyntaxError(
            "A table name is missing its closing '",
            i,
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
          i,
        );
      const { end, name } = readBracket(text, k);
      tokens.push({ at: i, kind: "tableColumn", name, table: table.trim() });
      i = end;
      continue;
    }
    if (/[A-Za-z_\u0080-￿]/.test(char)) {
      const match = /^[A-Za-z_\u0080-￿][A-Za-z0-9_.\u0080-￿]*/.exec(
        text.slice(i),
      )!;
      const word = match[0];
      const after = i + word.length;
      // Harvest[Weight]: a one-word table name, then its column.
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
    if (!op) throw new FormulaSyntaxError(`Unexpected “${char}”`, i);
    tokens.push({ at: i, kind: "op", value: op === ";" ? "," : op });
    i += op.length;
  }
  tokens.push({ at: text.length, kind: "end" });
  return tokens;
}

/** Reads a formula ("=" in front or not) into its tree; throws a
 * `FormulaSyntaxError` saying what's wrong. */
export function parseFormula(formula: string): FormulaNode {
  const source = formula.trim().replace(/^=/, "");
  if (!source.trim())
    throw new FormulaSyntaxError("Write the formula after =", 0);
  // Positions in messages count from the formula as written.
  const offset = formula.indexOf(source);
  let tokens: Token[];
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
  const isOp = (value: string) => {
    const token = peek();
    return token.kind === "op" && token.value === value;
  };
  const fail = (message: string, token = peek()): never => {
    throw new FormulaSyntaxError(message, token.at + offset);
  };
  const describe = (token: Token) =>
    token.kind === "end"
      ? "the end"
      : token.kind === "op"
        ? `“${token.value}”`
        : "a value";

  // Lowest first: comparison, &, + -, * /, ^, unary - +, %, a value.
  function comparison(): FormulaNode {
    let left = concat();
    for (;;) {
      const token = peek();
      if (
        token.kind === "op" &&
        ["=", "<>", "<", ">", "<=", ">="].includes(token.value)
      ) {
        next();
        left = {
          left,
          op: token.value as BinaryOp,
          right: concat(),
          type: "binary",
        };
      } else return left;
    }
  }
  function concat(): FormulaNode {
    let left = additive();
    while (isOp("&")) {
      next();
      left = { left, op: "&", right: additive(), type: "binary" };
    }
    return left;
  }
  function additive(): FormulaNode {
    let left = multiplicative();
    while (isOp("+") || isOp("-")) {
      const op = next() as { value: "+" | "-" };
      left = { left, op: op.value, right: multiplicative(), type: "binary" };
    }
    return left;
  }
  function multiplicative(): FormulaNode {
    let left = power();
    while (isOp("*") || isOp("/")) {
      const op = next() as { value: "*" | "/" };
      left = { left, op: op.value, right: power(), type: "binary" };
    }
    return left;
  }
  function power(): FormulaNode {
    let left = unary();
    while (isOp("^")) {
      next();
      left = { left, op: "^", right: unary(), type: "binary" };
    }
    return left;
  }
  function unary(): FormulaNode {
    if (isOp("-") || isOp("+")) {
      const op = next() as { value: "-" | "+" };
      return { op: op.value, operand: unary(), type: "unary" };
    }
    return percent();
  }
  function percent(): FormulaNode {
    let operand = primary();
    while (isOp("%")) {
      next();
      operand = { operand, type: "percent" };
    }
    return operand;
  }
  function primary(): FormulaNode {
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
          const args: FormulaNode[] = [];
          if (!isOp(")")) {
            for (;;) {
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
          `“${token.value}” isn't a column — put a column's name in brackets: [${token.value}]`,
          token,
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

/** Every column and other table a formula names (to check them, and to
 * load the tables it reads). */
export function formulaReferences(tree: FormulaNode) {
  const columns = new Set<string>();
  const tables = new Map<string, Set<string>>();
  const functions = new Set<string>();
  const walk = (node: FormulaNode) => {
    switch (node.type) {
      case "column":
        columns.add(node.name);
        break;
      case "tableColumn": {
        const names = tables.get(node.table) ?? new Set<string>();
        names.add(node.name);
        tables.set(node.table, names);
        break;
      }
      case "call":
        functions.add(node.name);
        node.args.forEach(walk);
        break;
      case "unary":
      case "percent":
        walk(node.operand);
        break;
      case "binary":
        walk(node.left);
        walk(node.right);
        break;
    }
  };
  walk(tree);
  return { columns, functions, tables };
}
