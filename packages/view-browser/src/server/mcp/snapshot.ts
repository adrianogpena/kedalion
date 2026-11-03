export interface PageSnapshot {
  title: string;
  url: string;
  headings: Array<{ level: number; text: string }>;
  links: Array<{ text: string; href: string }>;
  fields: Array<{ tag: string; type?: string; name?: string; label?: string; value?: string; selector: string; ref?: string }>;
  clickable?: Array<{ ref: string; tag: string; text: string; state?: string }>;
  text: string;
}

export const DEFAULT_SNAPSHOT_CHARS = 8000;
export const DEFAULT_LINK_LIMIT = 30;
export const DEFAULT_CLICKABLE_LIMIT = 60;

export type SnapshotSection = 'headings' | 'fields' | 'clickable' | 'links' | 'text';
export const SNAPSHOT_SECTIONS: readonly SnapshotSection[] = ['headings', 'fields', 'clickable', 'links', 'text'];

export interface RenderOptions {
  maxChars?: number;
  /** Only these sections; default all. */
  sections?: readonly SnapshotSection[];
  /** Cap of the Clickable and Links lists. */
  limit?: number;
  /** Items to skip in the Clickable and Links lists. */
  offset?: number;
}

const heading = (h: PageSnapshot['headings'][number]) => `${'#'.repeat(Math.min(Math.max(h.level, 1), 6))} ${h.text}`;
const field = (f: PageSnapshot['fields'][number]) =>
  `- ${f.tag}${f.type ? `[${f.type}]` : ''} ${f.label || f.name || ''} ${f.selector}${f.value !== undefined ? ` = ${JSON.stringify(f.type === 'password' && f.value ? '***' : f.value)}` : ''}${f.ref ? ` ${f.ref}` : ''}`.replace(/ {2,}/g, ' ');
const link = (l: PageSnapshot['links'][number]) => `- ${l.text || '(no text)'} -> ${l.href}`;
const clickable = (c: NonNullable<PageSnapshot['clickable']>[number]) => `- ${c.ref} <${c.tag}> ${c.text || '(no text)'}${c.state ? ` [${c.state}]` : ''}`;

/**
 * Renders the snapshot as text within the budget, pruned by priority: title and url, headings,
 * form fields, clickable elements, links, then the visible text takes what is left. Clickable
 * and Links are capped by `limit` and paged by `offset`.
 */
export function renderSnapshot(s: PageSnapshot, options: number | RenderOptions = DEFAULT_SNAPSHOT_CHARS): string {
  const o: RenderOptions = typeof options === 'number' ? { maxChars: options } : options;
  const maxChars = o.maxChars ?? DEFAULT_SNAPSHOT_CHARS;
  const wanted = (x: SnapshotSection) => !o.sections?.length || o.sections.includes(x);
  const offset = Math.max(o.offset ?? 0, 0);
  const head = `Title: ${s.title}\nURL: ${s.url}`;
  // Reserve room for the separators and the "more not shown" lines.
  let left = maxChars - head.length - 110;
  const sections = new Map<string, { lines: string[]; more: string }>();
  const add = <T>(key: SnapshotSection, title: string, all: T[] | undefined, render: (t: T) => string, cap?: number) => {
    if (!wanted(key) || !all?.length) return;
    const from = cap === undefined ? 0 : offset;
    const slice = all.slice(from, cap === undefined ? undefined : from + cap);
    left -= title.length + 2;
    const lines: string[] = [];
    for (const item of slice) {
      const line = render(item);
      if (left < line.length + 1) break;
      left -= line.length + 1;
      lines.push(line);
    }
    const rest = all.length - from - lines.length;
    const next = from + lines.length;
    sections.set(title, { lines, more: rest > 0 ? `... +${rest} more not shown; pass offset=${next}${cap === undefined ? '' : ' (limit sets the page size)'}` : '' });
  };
  add('headings', 'Headings', s.headings, heading);
  add('fields', 'Form fields', s.fields, field);
  add('clickable', 'Clickable', s.clickable, clickable, o.limit ?? DEFAULT_CLICKABLE_LIMIT);
  add('links', 'Links', s.links, link, o.limit ?? DEFAULT_LINK_LIMIT);

  const parts = [head];
  for (const title of ['Headings', 'Form fields', 'Clickable', 'Links']) {
    const x = sections.get(title);
    if (!x) continue;
    parts.push(`${title}:\n${[...x.lines, ...(x.more ? [x.more] : [])].join('\n')}`);
  }
  const room = Math.max(0, left - 'Text:\n'.length - 1);
  if (wanted('text') && s.text && room > 20) parts.push(`Text:\n${s.text.length > room ? `${s.text.slice(0, room - 3)}...` : s.text}`);
  return parts.join('\n\n');
}
