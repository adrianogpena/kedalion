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

  test('stays within the budget and drops text before links before fields', () => {
    const links = Array.from({ length: 50 }, (_, i) => ({ text: `link ${i}`, href: `http://x/${i}` }));
    const out = renderSnapshot(snap({ links, text: 'T'.repeat(5000) }), 400);
    expect(out.length).toBeLessThanOrEqual(400);
    expect(out).toContain('# Welcome');
    expect(out).toContain('#q');
    expect(out).toContain('more not shown');
    expect(out).not.toContain('Text:');
  });

  test('truncates the visible text to what is left', () => {
    const out = renderSnapshot(snap({ text: 'W'.repeat(5000) }), 600);
    expect(out.length).toBeLessThanOrEqual(600);
    expect(out).toContain('Text:');
    expect(out.endsWith('...')).toBe(true);
  });
});
