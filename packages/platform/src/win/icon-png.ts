import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PATHS } from '@kedalion/ui/icons';

export const DEFAULT_ICON_COLOR = '#4f6bed';
const SIZE = 96;

let embedded: Record<string, string> = {};

/** Registers PNG badges (default colour) packed into the exe by the build, by icon name; used when `sharp` is not available. */
export function setEmbeddedToastIcons(icons: Record<string, string>): void {
  embedded = icons;
}

export interface IconPngOptions {
  /** Icon name of the original set (`PATHS`); with `svg`, only the cache name. */
  name: string;
  /** Source of a 24 px line icon (`currentColor` strokes, `var(--icon-accent, #rrggbb)` accents); wins over the `PATHS` entry. */
  svg?: string;
  /** Badge colour, `#rrggbb`. */
  color?: string;
  /** Cache folder; created when missing. */
  dir: string;
}

/** SVG of a rounded-square badge with the icon stroked in white (white alone is invisible on light toasts). */
export function iconBadgeSvg(path: string, color: string): string {
  return badge(`<path d="${path}"/>`, color, 2);
}

/** Inner markup of an icon file recoloured for the badge: white strokes, the accent kept as its fallback colour. */
export function svgBody(svg: string): string {
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  return inner.replace(/var\(--icon-accent,\s*(#[0-9a-f]{3,8})\)/gi, '$1').replace(/currentColor/g, '#fff');
}

function badge(body: string, color: string, strokeWidth: number): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
    `<rect width="${SIZE}" height="${SIZE}" rx="20" fill="${color}"/>` +
    `<g transform="translate(${SIZE / 4} ${SIZE / 4}) scale(2)" fill="none" stroke="#fff" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">` +
    `${body}</g></svg>`
  );
}

/**
 * Path of the PNG badge for an icon, rendered once with `sharp` and cached in `dir` by name and
 * colour. Undefined for an unknown name or when rendering fails (sharp missing, folder unwritable):
 * the toast then shows without a logo.
 */
export async function iconPng(opts: IconPngOptions): Promise<string | undefined> {
  const path = (PATHS as Record<string, string | undefined>)[opts.name];
  const color = /^#[0-9a-f]{6}$/i.test(opts.color ?? '') ? opts.color! : DEFAULT_ICON_COLOR;
  if (!path && !opts.svg) return undefined;
  const tag = opts.svg ? `${opts.name}-${Bun.hash(opts.svg).toString(36)}` : opts.name;
  const file = join(opts.dir, `${tag}-${color.slice(1).toLowerCase()}-${SIZE}.png`);
  if (existsSync(file)) return file;
  const packed = opts.svg && color.toLowerCase() === DEFAULT_ICON_COLOR ? embedded[opts.name] : undefined;
  if (packed) {
    try {
      await mkdir(opts.dir, { recursive: true });
      await Bun.write(file, Bun.file(packed));
      return file;
    } catch {
      return packed;
    }
  }
  try {
    const sharp = (await import('sharp')).default;
    const png = await sharp(Buffer.from(opts.svg ? badge(svgBody(opts.svg), color, 1.6) : iconBadgeSvg(path!, color)), { density: 144 }).resize(SIZE, SIZE).png().toBuffer();
    await mkdir(opts.dir, { recursive: true });
    await Bun.write(file, png);
    return file;
  } catch {
    return undefined;
  }
}
