export interface ColumnsFormat {
  /** Between the cells of a row; a space when absent (any run of whitespace splits). */
  join?: string;
  /** Between the rows; a new line when absent. */
  separator?: string;
}

/** A URL the form accepts: http or https with a host. */
export function isHttpUrl(text: string): boolean {
  try {
    const u = new URL(text.trim());
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname !== '';
  } catch {
    return false;
  }
}

/** The rows of `text`, each as exactly `count` cells (missing ones empty); extra text stays in the last cell. */
export function splitColumns(text: string, count: number, { join = ' ', separator = '\n' }: ColumnsFormat = {}): string[][] {
  const rows = separator === '\n' ? text.split(/\r?\n/) : text.split(separator.trim());
  const out: string[][] = [];
  for (const raw of rows) {
    const row = raw.trim();
    if (!row) continue;
    const cells = join === ' ' ? row.split(/\s+/) : row.split(join).map((c) => c.trim());
    const head = cells.slice(0, count - 1);
    const tail = cells.slice(count - 1).join(join);
    out.push([...head, tail].concat(Array(Math.max(0, count - head.length - 1)).fill('')));
  }
  return out;
}

const clean = (cell: string, join: string, separator: string): string => {
  let c = cell.replace(/[\r\n]+/g, ' ');
  if (join === ' ') c = c.replace(/\s+/g, '');
  else c = c.split(join).join('');
  if (separator !== '\n') c = c.split(separator.trim()).join('');
  return c.trim();
};

/** The text of `rows`: cells joined by `join`, rows by `separator`; a row with an empty cell is left out. */
export function joinColumns(rows: readonly (readonly string[])[], { join = ' ', separator = '\n' }: ColumnsFormat = {}): string {
  return rows
    .map((r) => r.map((c) => clean(c, join, separator)))
    .filter((r) => r.length > 0 && r.every((c) => c !== ''))
    .map((r) => r.join(join))
    .join(separator);
}
