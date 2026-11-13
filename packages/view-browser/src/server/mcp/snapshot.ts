export interface PageImage {
  ref: string;
  name: string;
  alt: string;
  src: string;
  w: number;
  h: number;
  loaded: boolean;
  near?: string;
  link?: string;
  /** A CSS background image, not an <img>. */
  css?: boolean;
}

export interface PageSprite {
  sheet: string;
  name: string;
  count: number;
  cells: Array<{ ref: string; name: string; pos: string; w: number; h: number }>;
}

export interface PageImages {
  images: PageImage[];
  sprites: PageSprite[];
}

export interface PageSnapshot {
  title: string;
  url: string;
  headings: Array<{ level: number; text: string }>;
  links: Array<{ text: string; href: string }>;
  fields: Array<{ tag: string; type?: string; name?: string; label?: string; value?: string; selector: string; ref?: string }>;
  clickable?: Array<{ ref: string; tag: string; text: string; state?: string }>;
  images?: PageImages;
  /** Name of the bot check covering the page (Cloudflare, hCaptcha), if any. */
  challenge?: string;
  text: string;
}

export const DEFAULT_SNAPSHOT_CHARS = 8000;
export const DEFAULT_LINK_LIMIT = 30;
export const DEFAULT_CLICKABLE_LIMIT = 60;
/** Images shown in a full snapshot; section=images shows DEFAULT_LINK_LIMIT per page. */
export const DEFAULT_IMAGE_PREVIEW = 8;

export type SnapshotSection = 'headings' | 'fields' | 'clickable' | 'links' | 'images' | 'text';
export const SNAPSHOT_SECTIONS: readonly SnapshotSection[] = ['headings', 'fields', 'clickable', 'links', 'images', 'text'];

export interface RenderOptions {
  maxChars?: number;
  /** Only these sections; default all. */
  sections?: readonly SnapshotSection[];
  /** Cap of the Clickable, Links and Images lists. */
  limit?: number;
  /** Items to skip in the Clickable, Links and Images lists. */
  offset?: number;
}

export const challengeNote = (name: string) =>
  `Bot check: the page shows a ${name} check, not its content. Ask the user to complete it in the Browser view, then browser_wait_for idle=true and snapshot again.`;

const heading = (h: PageSnapshot['headings'][number]) => `${'#'.repeat(Math.min(Math.max(h.level, 1), 6))} ${h.text}`;
const field = (f: PageSnapshot['fields'][number]) =>
  `- ${f.tag}${f.type ? `[${f.type}]` : ''} ${f.label || f.name || ''} ${f.selector}${f.value !== undefined ? ` = ${JSON.stringify(f.type?.toLowerCase() === 'password' && f.value ? '***' : f.value)}` : ''}${f.ref ? ` ${f.ref}` : ''}`.replace(/ {2,}/g, ' ');
const link = (l: PageSnapshot['links'][number]) => `- ${l.text || '(no text)'} -> ${l.href}`;
const clickable = (c: NonNullable<PageSnapshot['clickable']>[number]) => `- ${c.ref} <${c.tag}> ${c.text || '(no text)'}${c.state ? ` [${c.state}]` : ''}`;
export const imageLine = (i: PageImage) =>
  `- ${i.ref} ${i.name}${i.alt && i.alt !== i.name.replace(/_/g, ' ') ? ` "${i.alt}"` : ''} ${i.w && i.h ? `${i.w}x${i.h}` : '?x?'}${i.css ? ' [css]' : ''}${i.loaded ? '' : ' [not loaded]'}${i.near ? ` near "${i.near}"` : ''} -> ${i.src}${i.link && i.link !== i.src ? ` (links to ${i.link})` : ''}`;
export const spriteLine = (s: PageSprite, cells = 6) =>
  `- sprite ${s.name}: ${s.count} cells${s.cells[0] ? ` (${s.cells[0].w}x${s.cells[0].h})` : ''}, e.g. ${s.cells
    .slice(0, cells)
    .map((c) => `${c.ref} ${c.name || '?'} @ ${c.pos}`)
    .join(', ')} -> ${s.sheet}`;

/**
 * Renders the snapshot as text within the budget, pruned by priority: title and url, headings,
 * form fields, clickable elements, links, images, then the visible text takes what is left.
 * Clickable, Links and Images are capped by `limit` and paged by `offset`.
 */
export function renderSnapshot(s: PageSnapshot, options: number | RenderOptions = DEFAULT_SNAPSHOT_CHARS): string {
  const o: RenderOptions = typeof options === 'number' ? { maxChars: options } : options;
  const maxChars = o.maxChars ?? DEFAULT_SNAPSHOT_CHARS;
  const wanted = (x: SnapshotSection) => !o.sections?.length || o.sections.includes(x);
  const offset = Math.max(o.offset ?? 0, 0);
  const head = `Title: ${s.title}\nURL: ${s.url}${s.challenge ? `\n${challengeNote(s.challenge)}` : ''}`;
  // Reserve room for the separators and the "more not shown" lines.
  let left = maxChars - head.length - 140;
  const sections = new Map<string, { lines: string[]; more: string }>();
  const add = <T>(key: SnapshotSection, title: string, all: T[] | undefined, render: (t: T) => string, cap?: number, moreHint?: string) => {
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
    sections.set(title, { lines, more: rest > 0 ? `... +${rest} more not shown; ${moreHint ?? `pass offset=${next}${cap === undefined ? '' : ' (limit sets the page size)'}`}` : '' });
  };
  add('headings', 'Headings', s.headings, heading);
  add('fields', 'Form fields', s.fields, field);
  add('clickable', 'Clickable', s.clickable, clickable, o.limit ?? DEFAULT_CLICKABLE_LIMIT);
  add('links', 'Links', s.links, link, o.limit ?? DEFAULT_LINK_LIMIT);
  const onlyImages = o.sections?.length === 1 && o.sections[0] === 'images';
  const imgs: Array<PageImage | PageSprite> = [...(s.images?.sprites ?? []), ...(s.images?.images ?? [])];
  add(
    'images',
    'Images',
    imgs,
    (x) => ('sheet' in x ? spriteLine(x) : imageLine(x)),
    onlyImages ? (o.limit ?? DEFAULT_LINK_LIMIT) : DEFAULT_IMAGE_PREVIEW,
    onlyImages ? undefined : 'pass section=images for all',
  );

  const parts = [head];
  for (const title of ['Headings', 'Form fields', 'Clickable', 'Links', 'Images']) {
    const x = sections.get(title);
    if (!x) continue;
    parts.push(`${title}:\n${[...x.lines, ...(x.more ? [x.more] : [])].join('\n')}`);
  }
  const room = Math.max(0, left - 'Text:\n'.length - 1);
  if (wanted('text') && s.text && room > 20) parts.push(`Text:\n${s.text.length > room ? `${s.text.slice(0, room - 3)}...` : s.text}`);
  return parts.join('\n\n');
}
