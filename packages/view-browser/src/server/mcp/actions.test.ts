import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Candidate, describeCandidates, isRef, matchCandidates } from './candidates.ts';
import { diffTexts, formatEffect } from './effects.ts';
import { renderSnapshot } from './snapshot.ts';
import { getTarget, loadTargets, removeTarget, setTarget } from './targets.ts';

const cand = (i: number, text: string, texts = [text]): Candidate => ({ i, tag: 'td', text, texts, x: i, y: i });

describe('matchCandidates', () => {
  test('exact beats contains', () => {
    const m = matchCandidates([cand(0, 'Save'), cand(1, 'Save and close')], 'save');
    expect(m.tier).toBe('exact');
    expect(m.hits.map((h) => h.i)).toEqual([0]);
  });

  test('falls back to contains and reports ambiguity as several hits', () => {
    const m = matchCandidates([cand(0, 'Save and close'), cand(1, 'Save as')], 'Save');
    expect(m.tier).toBe('contains');
    expect(m.hits).toHaveLength(2);
  });

  test('ignores a trailing colon and whitespace, matches any of the texts', () => {
    expect(matchCandidates([cand(0, 'x', ['Customer  name:'])], 'customer name').tier).toBe('exact');
  });

  test('no match', () => {
    expect(matchCandidates([cand(0, 'Save')], 'Delete').tier).toBe('none');
    expect(matchCandidates([cand(0, 'Save')], '  ').tier).toBe('none');
  });

  test('describes candidates with refs and caps the list', () => {
    const hits = Array.from({ length: 10 }, (_, i) => cand(i, `b${i}`));
    const out = describeCandidates(hits, hits.map((_, i) => `e${i + 1}`));
    expect(out).toContain('- e1 <td> "b0" at 0,0');
    expect(out).toContain('+2 more');
  });

  test('ref syntax', () => {
    expect(isRef('e12')).toBe(true);
    expect(isRef('e0')).toBe(false);
    expect(isRef('#isc_US')).toBe(false);
  });
});

describe('diffTexts', () => {
  test('reports appeared and disappeared texts as a multiset', () => {
    const d = diffTexts(['Loading...', 'Save', 'x', 'x'], ['Save', 'Done', 'x']);
    expect(d.appeared).toEqual(['Done']);
    expect(d.disappeared).toEqual(['Loading...', 'x']);
  });

  test('formatEffect caps lists and shows requests and errors', () => {
    const many = Array.from({ length: 9 }, (_, i) => `t${i}`);
    const out = formatEffect({ focus: '<input#a> = "1"', diff: { appeared: many, disappeared: [] }, requests: 2, errors: ['boom'] });
    expect(out).toContain('Focus: <input#a> = "1"');
    expect(out).toContain('(+3 more)');
    expect(out).toContain('Requests started: 2');
    expect(out).toContain('Console errors (1): boom');
    expect(out).not.toContain('Disappeared');
  });
});

describe('snapshot clickable and links paging', () => {
  const snap = (n: number) => ({
    title: 'T',
    url: 'http://x/',
    headings: [],
    links: Array.from({ length: n }, (_, i) => ({ text: `l${i}`, href: `http://x/${i}` })),
    fields: [{ tag: 'input', type: 'password', value: 'secret', selector: '#p', ref: 'e1' }],
    clickable: [{ ref: 'e2', tag: 'td', text: 'Save', state: 'disabled' }],
    text: '',
  });

  test('caps links at 30 and pages with offset', () => {
    const first = renderSnapshot(snap(40), 10_000);
    expect(first).toContain('l29');
    expect(first).not.toContain('l30');
    expect(first).toContain('+10 more not shown; pass offset=30');
    expect(renderSnapshot(snap(40), { maxChars: 10_000, offset: 30 })).toContain('l30');
  });

  test('lists clickable with ref and state, masks passwords', () => {
    const out = renderSnapshot(snap(0), 5000);
    expect(out).toContain('- e2 <td> Save [disabled]');
    expect(out).toContain('= "***"');
    expect(out).not.toContain('secret');
  });

  test('section filter', () => {
    const out = renderSnapshot(snap(3), { sections: ['links'] });
    expect(out).toContain('Links:');
    expect(out).not.toContain('Clickable');
    expect(out).not.toContain('Form fields');
  });
});

describe('saved targets', () => {
  test('set, get, list and remove per origin', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'kd-targets-')), 'targets.json');
    expect(loadTargets(file)).toEqual({});
    setTarget(file, 'http://a', 'save', { text: 'Save' });
    setTarget(file, 'http://b', 'save', { label: 'Name' });
    expect(getTarget(file, 'http://a', 'save')).toEqual({ text: 'Save' });
    expect(getTarget(file, 'http://b', 'save')).toEqual({ label: 'Name' });
    expect(removeTarget(file, 'http://a', 'save')).toBe(true);
    expect(removeTarget(file, 'http://a', 'save')).toBe(false);
    expect(Object.keys(loadTargets(file))).toEqual(['http://b']);
  });
});
