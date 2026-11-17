import type { Completion, CompletionSource } from '@codemirror/autocomplete';
import { json, jsonLanguage } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { MSSQL, MySQL, PLSQL, PostgreSQL, sql, SQLDialect, SQLite, StandardSQL } from '@codemirror/lang-sql';
import { type Language, StreamLanguage } from '@codemirror/language';
import { c, cpp, csharp, java, kotlin } from '@codemirror/legacy-modes/mode/clike';
import { css } from '@codemirror/legacy-modes/mode/css';
import { diff } from '@codemirror/legacy-modes/mode/diff';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { go } from '@codemirror/legacy-modes/mode/go';
import { javascript, typescript } from '@codemirror/legacy-modes/mode/javascript';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { python } from '@codemirror/legacy-modes/mode/python';
import { rust } from '@codemirror/legacy-modes/mode/rust';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { html, xml } from '@codemirror/legacy-modes/mode/xml';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import type { Extension } from '@codemirror/state';

export type Lang =
  | 'sql' | 'json' | 'shell' | 'java' | 'markdown' | 'xml' | 'text'
  | 'javascript' | 'typescript' | 'css' | 'html' | 'python' | 'yaml' | 'toml' | 'properties'
  | 'rust' | 'go' | 'c' | 'cpp' | 'csharp' | 'kotlin' | 'diff' | 'dockerfile';
/** Display names, as VS Code's language picker shows them. */
const LANG_LABELS: Record<Lang, string> = {
  sql: 'SQL', json: 'JSON', shell: 'Shell Script', java: 'Java', markdown: 'Markdown', xml: 'XML', text: 'Plain Text',
  javascript: 'JavaScript', typescript: 'TypeScript', css: 'CSS', html: 'HTML', python: 'Python', yaml: 'YAML', toml: 'TOML', properties: 'Properties',
  rust: 'Rust', go: 'Go', c: 'C', cpp: 'C++', csharp: 'C#', kotlin: 'Kotlin', diff: 'Diff', dockerfile: 'Dockerfile',
};

export const langLabel = (lang: Lang) => LANG_LABELS[lang];

export type SqlDialect = 'postgres' | 'mysql' | 'sqlite' | 'mssql' | 'plsql' | 'standard';
/** Table name → column names, for SQL completion. */
export type SqlSchema = Record<string, string[]>;

// Oracle's unquoted names are case-insensitive: without this, completing an upper-case table inserts it in "quotes".
const OracleSQL = SQLDialect.define({ ...PLSQL.spec, caseInsensitiveIdentifiers: true });

const DIALECTS = { postgres: PostgreSQL, mysql: MySQL, sqlite: SQLite, mssql: MSSQL, plsql: OracleSQL, standard: StandardSQL };

const STREAM_MODES = { shell, java, xml, html, javascript, typescript, css, python, yaml, toml, properties, rust, go, c, cpp, csharp, kotlin, diff, dockerfile: dockerFile };
type StreamLang = keyof typeof STREAM_MODES;
const streamLanguages = new Map<string, Language>();
/** The language of a legacy stream mode, defined once per mode. */
const streamLanguage = (lang: StreamLang): Language => {
  let language = streamLanguages.get(lang);
  if (!language) {
    language = StreamLanguage.define(STREAM_MODES[lang]);
    streamLanguages.set(lang, language);
  }
  return language;
};
const isStreamLang = (lang: Lang): lang is StreamLang => lang in STREAM_MODES;

export function languageFor(lang: Lang, opts: { sqlDialect?: SqlDialect; sqlSchema?: SqlSchema } = {}): Extension {
  switch (lang) {
    case 'sql': {
      const support = sql({ dialect: DIALECTS[opts.sqlDialect ?? 'standard'], schema: opts.sqlSchema });
      return opts.sqlSchema ? [support, support.language.data.of({ autocomplete: columnCompletion(opts.sqlSchema) })] : support;
    }
    case 'json': return json();
    case 'markdown': return markdown({ extensions: GFM });
    default: return isStreamLang(lang) ? streamLanguage(lang) : [];
  }
}

const IDENT = /[A-Za-z_][\w$#]*/g;
/** Most text scanned for table names; a longer document gets no column completions. */
const MAX_SCAN = 200_000;

/**
 * Columns of the schema's tables named anywhere in the text, without a `table.` prefix (lang-sql
 * only completes columns after one). Table names match case-insensitively, as Oracle's unquoted ones do.
 */
export function columnCompletion(schema: SqlSchema): CompletionSource {
  const tables = new Map(Object.keys(schema).map((name) => [name.toUpperCase(), name]));
  return (ctx) => {
    const word = ctx.matchBefore(/[\w$#]*/);
    if (!word || (word.from === word.to && !ctx.explicit)) return null;
    if (ctx.state.sliceDoc(word.from - 1, word.from) === '.' || ctx.state.doc.length > MAX_SCAN) return null;
    const named = new Set<string>();
    for (const [ident] of ctx.state.doc.toString().matchAll(IDENT)) {
      const table = tables.get(ident.toUpperCase());
      if (table) named.add(table);
    }
    const options: Completion[] = [];
    for (const table of named) for (const label of schema[table]!) options.push({ label, type: 'property', detail: table, boost: -1 });
    return options.length ? { from: word.from, options, validFor: /^[\w$#]*$/ } : null;
  };
}

export type Parser = Language['parser'];

/** The parser behind a language, for highlighting text outside an editor; null when there is none. */
export function parserOf(lang: Lang): Parser | null {
  switch (lang) {
    case 'sql': return StandardSQL.language.parser;
    case 'json': return jsonLanguage.parser;
    default: return isStreamLang(lang) ? streamLanguage(lang).parser : null;
  }
}


export { langOfContent, langOfFile, previewKind, type PreviewKind } from './fileKinds';
