import { describe, expect, test } from 'bun:test';
import { type PageSnapshot, renderSnapshot } from './snapshot.ts';

const snap = (over: Partial<PageSnapshot> = {}): PageSnapshot => ({
  title: 'Home',
  url: 'http://x/',
  headings: [{ level: 1, text: 'Welcome' }],
  links: [{ text: 'About', href: 'http://x/about' }],
  fields: [{ tag: 'input', type: 'text', name: 'q', value: 'abc', selector: '#q' }],
  text: 'Hello world, this is the visible text of the page.',
  ...over,
});

describe('renderSnapshot', () => {
  test('renders every section within a large budget', () => {
    const out = renderSnapshot(snap(), 5000);
    expect(out).toContain('Title: Home');
    expect(out).toContain('# Welcome');
    expect(out).toContain('input[text] q #q = "abc"');
    expect(out).toContain('- About -> http://x/about');
    expect(out).toContain('Hello world');
  });

  test('masks password fields whatever the type casing', () => {
    const out = renderSnapshot(snap({ fields: [{ tag: 'input', type: 'PASSWORD', name: 'p', value: 'secret', selector: '#p' }] }), 5000);
    expect(out).toContain('= "***"');
    expect(out).not.toContain('secret');
  });

  test('stays within the budget and drops text before links before fields', () => {
    const links = Array.from({ length: 50 }, (_, i) => ({ text: `link ${i}`, href: `http://x/${i}` }));
    const out = renderSnapshot(snap({ links, text: 'T'.repeat(5000) }), 400);
    expect(out.length).toBeLessThanOrEqual(400);
    expect(out).toContain('# Welcome');
    expect(out).toContain('#q');
    expect(out).toContain('more not shown');
    expect(out).not.toContain('Text:');
  });

  test('lists sprites and images, previewing a few unless section=images', () => {
    const images = Array.from({ length: 12 }, (_, i) => ({ ref: `e${i + 1}`, name: `pic_${i}.png`, alt: `pic ${i}.png`, src: `http://x/pic_${i}.png`, w: 56, h: 56, loaded: i > 0, near: 'Intro' }));
    const sprites = [{ sheet: 'http://x/Sheet.png', name: 'Sheet.png', count: 1052, cells: [{ ref: 'e99', name: 'Beet', pos: '-72px -360px', w: 34, h: 34 }] }];
    const s = snap({ images: { images, sprites } });
    const full = renderSnapshot(s, 5000);
    expect(full).toContain('- sprite Sheet.png: 1052 cells (34x34), e.g. e99 Beet @ -72px -360px -> http://x/Sheet.png');
    expect(full).toContain('- e1 pic_0.png 56x56 [not loaded] near "Intro" -> http://x/pic_0.png');
    expect(full).toContain('pass section=images for all');
    const only = renderSnapshot(s, { maxChars: 5000, sections: ['images'] });
    expect(only).toContain('pic_11.png');
    expect(only).not.toContain('Text:');
  });

  test('flags a bot check', () => {
    expect(renderSnapshot(snap({ challenge: 'Cloudflare' }), 5000)).toContain('Bot check: the page shows a Cloudflare check');
  });

  test('truncates the visible text to what is left', () => {
    const out = renderSnapshot(snap({ text: 'W'.repeat(5000) }), 600);
    expect(out.length).toBeLessThanOrEqual(600);
    expect(out).toContain('Text:');
    expect(out.endsWith('...')).toBe(true);
  });
});
