import { describe, expect, test } from 'bun:test';
import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { setFileAssociations } from '@kedalion/ui/file-associations';
import { columnCompletion, langOfFile, languageFor, parserOf, previewKind } from '../src/languages.ts';

describe('langOfFile', () => {
  test('maps extensions case-insensitively', () => {
    expect(langOfFile('a.curl')).toBe('shell');
    expect(langOfFile('run.sh')).toBe('shell');
    expect(langOfFile('README.MD')).toBe('markdown');
    expect(langOfFile('q.sql')).toBe('sql');
    expect(langOfFile('data.json')).toBe('json');
  });

  test('maps aliases and dotfiles', () => {
    for (const n of ['a.mts', 'a.cts']) expect(langOfFile(n)).toBe('typescript');
    for (const n of ['a.mjs', 'a.cjs']) expect(langOfFile(n)).toBe('javascript');
    for (const n of ['a.pgsql', 'a.mssql', 'a.tsql']) expect(langOfFile(n)).toBe('sql');
    expect(langOfFile('prod.tfvars')).toBe('properties');
    expect(langOfFile('.envrc')).toBe('shell');
    expect(langOfFile('.env')).toBe('properties');
  });

  test('falls back to text', () => {
    expect(langOfFile('x.bin')).toBe('text');
    expect(langOfFile('Makefile')).toBe('text');
  });
});

describe('previewKind', () => {
  test('sorts files into preview kinds', () => {
    expect(previewKind('notes.markdown')).toBe('markdown');
    expect(previewKind('a.json')).toBe('json');
    expect(previewKind('req.http')).toBe('code');
    expect(previewKind('logo.SVG')).toBe('svg');
    expect(previewKind('a.txt')).toBe('text');
  });

  test('sorts the viewer kinds', () => {
    expect(previewKind('a.csv')).toBe('table');
    expect(previewKind('a.TSV')).toBe('table');
    expect(previewKind('a.ipynb')).toBe('notebook');
    expect(previewKind('a.har')).toBe('har');
    expect(previewKind('a.mp3')).toBe('audio');
    expect(previewKind('a.mp4')).toBe('video');
    expect(previewKind('a.woff2')).toBe('font');
    expect(previewKind('Foo.class')).toBe('hex');
    expect(previewKind('app.sqlite')).toBe('sqlite');
    expect(previewKind('.env.local')).toBe('env');
    expect(previewKind('a.docx')).toBe('archive');
    expect(previewKind('a.ts')).toBe('code');
    expect(previewKind('a.diff')).toBe('code');
    expect(previewKind('Dockerfile')).toBe('code');
    expect(previewKind('pom.xml')).toBe('code');
  });

  test('applies the file associations', () => {
    setFileAssociations([{ pattern: 'log.*', as: 'log' }, { pattern: '*.conf.d', as: 'yaml' }]);
    try {
      expect(previewKind('log.7')).toBe('log');
      expect(previewKind('x.conf.d')).toBe('code');
      expect(langOfFile('x.conf.d')).toBe('yaml');
    } finally {
      setFileAssociations([]);
    }
    expect(previewKind('log.7')).toBe('text');
  });

  test('sees log files, rotated ones included', () => {
    expect(previewKind('app.log')).toBe('log');
    expect(previewKind('server.log.1')).toBe('log');
    expect(previewKind('server.log.2026-10-08')).toBe('log');
    expect(previewKind('catalog.txt')).toBe('text');
    expect(previewKind('logo.png')).toBe('image');
    expect(previewKind('blog.md')).toBe('markdown');
  });
});

describe('parserOf', () => {
  test('gives parsers for highlighted languages only', () => {
    expect(parserOf('sql')).not.toBeNull();
    expect(parserOf('json')).not.toBeNull();
    expect(parserOf('shell')).not.toBeNull();
    expect(parserOf('text')).toBeNull();
    for (const lang of ['typescript', 'python', 'yaml', 'css', 'html', 'diff', 'rust'] as const) expect(parserOf(lang)).not.toBeNull();
  });
});

describe('columnCompletion', () => {
  const source = columnCompletion({ CUSTOMER: ['ID', 'NAME'], ORDERS: ['ORDER_ID'] });
  const labels = (doc: string, explicit = false) => {
    const result = source(new CompletionContext(EditorState.create({ doc }), doc.length, explicit)) as CompletionResult | null;
    return result?.options.map((o) => `${o.detail}.${o.label}`) ?? null;
  };

  test('offers the columns of tables named in the text', () => {
    expect(labels('select na from dual')).toBeNull();
    expect(labels('select * from customer where na')).toEqual(['CUSTOMER.ID', 'CUSTOMER.NAME']);
    expect(labels('select * from Customer c join orders o on o')).toEqual(['CUSTOMER.ID', 'CUSTOMER.NAME', 'ORDERS.ORDER_ID']);
  });

  test('stays out after a dot and without a typed word', () => {
    expect(labels('select * from customer c where c.')).toBeNull();
    expect(labels('select * from customer where ')).toBeNull();
    expect(labels('select * from customer where ', true)).toEqual(['CUSTOMER.ID', 'CUSTOMER.NAME']);
  });
});

test('plsql completes upper-case tables without quotes', async () => {
  const doc = 'select * from cust';
  const state = EditorState.create({ doc, extensions: [languageFor('sql', { sqlDialect: 'plsql', sqlSchema: { CUSTOMER: ['ID'] } })] });
  const options = [];
  for (const source of state.languageDataAt<(ctx: CompletionContext) => Promise<CompletionResult | null> | CompletionResult | null>('autocomplete', doc.length)) {
    options.push(...((await source(new CompletionContext(state, doc.length, false)))?.options ?? []));
  }
  const customer = options.find((o) => o.label === 'CUSTOMER');
  expect(customer).toBeDefined();
  expect(customer!.apply).toBeUndefined();
});
