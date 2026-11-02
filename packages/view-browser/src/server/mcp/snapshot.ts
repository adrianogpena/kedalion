export interface PageSnapshot {
  title: string;
  url: string;
  headings: Array<{ level: number; text: string }>;
  links: Array<{ text: string; href: string }>;
  fields: Array<{ tag: string; type?: string; name?: string; label?: string; value?: string; selector: string }>;
  text: string;
}

export const DEFAULT_SNAPSHOT_CHARS = 8000;

const heading = (h: PageSnapshot['headings'][number]) => `${'#'.repeat(Math.min(Math.max(h.level, 1), 6))} ${h.text}`;
const field = (f: PageSnapshot['fields'][number]) =>
  `- ${f.tag}${f.type ? `[${f.type}]` : ''} ${f.label || f.name || ''} ${f.selector}${f.value !== undefined ? ` = ${JSON.stringify(f.value)}` : ''}`.replace(/ {2,}/g, ' ');
const link = (l: PageSnapshot['links'][number]) => `- ${l.text || '(no text)'} -> ${l.href}`;

/**
 * Renders the snapshot as text within `maxChars`, pruned by priority: title and url, headings,
 * form fields, links, then the visible text takes what is left.
 */
export function renderSnapshot(s: PageSnapshot, maxChars = DEFAULT_SNAPSHOT_CHARS): string {
  const head = `Title: ${s.title}\nURL: ${s.url}`;
  // Reserve room for the separators and the "more not shown" lines.
  let left = maxChars - head.length - 48;
  const take = <T>(items: T[], render: (t: T) => string): string[] => {
    const out: string[] = [];
    for (const item of items) {
      const line = render(item);
      if (left < line.length + 1) break;
      left -= line.length + 1;
      out.push(line);
    }
    return out;
  };
  const sections: Array<{ title: string; lines: string[]; total: number }> = [];
  const add = <T>(title: string, items: T[], render: (t: T) => string) => {
    if (items.length === 0) return;
    left -= title.length + 2;
    sections.push({ title, lines: take(items, render), total: items.length });
  };
  add('Headings', s.headings, heading);
  add('Form fields', s.fields, field);
  add('Links', s.links, link);

  const parts = [head];
  const byTitle = new Map(sections.map((x) => [x.title, x]));
  for (const title of ['Headings', 'Form fields', 'Links']) {
    const x = byTitle.get(title);
    if (!x) continue;
    const more = x.total > x.lines.length ? [`... ${x.total - x.lines.length} more not shown`] : [];
    parts.push(`${title}:\n${[...x.lines, ...more].join('\n')}`);
  }
  const room = Math.max(0, left - 'Text:\n'.length - 1);
  if (s.text && room > 20) parts.push(`Text:\n${s.text.length > room ? `${s.text.slice(0, room - 3)}...` : s.text}`);
  return parts.join('\n\n');
}
