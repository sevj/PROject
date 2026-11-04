/** What a query returned, as the browser gets it: text cells, and null for a NULL. */
export type QueryResult = {
  columns: string[];
  rows: (string | null)[][];
  /** More rows existed than the limit allows. */
  truncated: boolean;
};

export const ROW_LIMIT = 1000;

/** Stands for NULL in the CSV that psql writes: it cannot be mistaken for text. */
export const PG_NULL = "\u0001NULL\u0001";

/** RFC 4180, as psql writes it: quoted fields hold commas, quotes and line breaks. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
    i += 1;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function capRows(result: QueryResult, limit = ROW_LIMIT): QueryResult {
  return result.rows.length > limit ? { ...result, rows: result.rows.slice(0, limit), truncated: true } : result;
}

/** `psql --csv` with `PG_NULL` as its null string. The first line holds the column names. */
export function parsePgCsv(output: string): QueryResult {
  const [header = [], ...rows] = parseCsv(output);
  return capRows({
    columns: header,
    rows: rows.map((row) => row.map((cell) => (cell === PG_NULL ? null : cell))),
    truncated: false,
  });
}

const MYSQL_ESCAPES: Record<string, string> = { n: "\n", t: "\t", "\\": "\\", "0": "\0" };

/** `mysql --batch`: tab-separated, with `\n`, `\t` and `\\` escaped. A NULL reads as the word NULL. */
export function parseMysqlBatch(output: string): QueryResult {
  const lines = output.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const [header = "", ...body] = lines;
  const cell = (text: string) => (text === "NULL" ? null : text.replace(/\\([nt\\0])/g, (_, letter: string) => MYSQL_ESCAPES[letter]));
  return capRows({
    columns: header === "" && body.length === 0 ? [] : header.split("\t"),
    rows: body.map((line) => line.split("\t").map(cell)),
    truncated: false,
  });
}

const MAX_MONGO_COLUMNS = 60;

const asCell = (value: unknown): string | null =>
  value === null || value === undefined ? null : typeof value === "string" ? value : JSON.stringify(value);

/** A JSON array of documents. Columns are the keys met, in the order they appear. */
export function parseMongoDocuments(output: string): QueryResult {
  let documents: unknown;
  try {
    documents = JSON.parse(output);
  } catch {
    return { columns: [], rows: [], truncated: false };
  }
  if (!Array.isArray(documents)) return { columns: [], rows: [], truncated: false };
  const columns: string[] = [];
  for (const document of documents) {
    for (const key of Object.keys(document && typeof document === "object" ? document : {})) {
      if (!columns.includes(key) && columns.length < MAX_MONGO_COLUMNS) columns.push(key);
    }
  }
  return capRows({
    columns,
    rows: documents.map((document: Record<string, unknown>) => columns.map((column) => asCell(document?.[column]))),
    truncated: false,
  });
}
