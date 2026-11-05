import { useState } from 'react';
import { Button, copyNotify, JsonTree, Tabs } from '@kedalion/ui';
import { tKey } from '../../i18n';
import { format, minify, validate, type JsonFailure } from './json-tools';
import { formatXml, minifyXml, validateXml } from './xml-tools';
import './formatters.css';

type Mode = 'json' | 'xml';
type Status = { kind: 'none' } | { kind: 'valid' } | { kind: 'error'; message: string; line: number; col: number };
type Edit = { ok: true; text: string } | JsonFailure;

const TOOLS: Record<Mode, { format(text: string): Edit; minify(text: string): Edit; validate(text: string): { ok: true } | JsonFailure }> = {
  json: { format, minify, validate },
  xml: { format: formatXml, minify: minifyXml, validate: validateXml },
};

const failed = (r: JsonFailure): Status => ({ kind: 'error', message: r.message, line: r.line, col: r.col });

/** Paste JSON or XML, then Format (2 spaces), Minify or Validate (error with line:col); JSON also shows a tree. */
export function FormattersPanel() {
  const [mode, setMode] = useState<Mode>('json');
  const [texts, setTexts] = useState<Record<Mode, string>>({ json: '', xml: '' });
  const [status, setStatus] = useState<Status>({ kind: 'none' });
  const text = texts[mode];
  const tools = TOOLS[mode];
  const parsed = mode === 'json' && text.trim() ? validate(text) : undefined;
  const setText = (next: string) => setTexts({ ...texts, [mode]: next });
  const apply = (fn: (t: string) => Edit) => {
    const r = fn(text);
    if (r.ok) {
      setText(r.text);
      setStatus({ kind: 'valid' });
    } else setStatus(failed(r));
  };
  return (
    <div className="fmt">
      <Tabs
        idPrefix="fmt"
        active={mode}
        tabs={[{ id: 'json', label: 'JSON' }, { id: 'xml', label: 'XML' }]}
        onChange={(id) => {
          setMode(id as Mode);
          setStatus({ kind: 'none' });
        }}
      />
      <div className="fmt-bar">
        <Button size="sm" onClick={() => apply(tools.format)}>{tKey('dash.fmt.format')}</Button>
        <Button size="sm" onClick={() => apply(tools.minify)}>{tKey('dash.fmt.minify')}</Button>
        <Button
          size="sm"
          onClick={() => {
            const r = tools.validate(text);
            setStatus(r.ok ? { kind: 'valid' } : failed(r));
          }}
        >
          {tKey('dash.fmt.validate')}
        </Button>
        <Button size="sm" icon="copy" onClick={() => void copyNotify(text)}>{tKey('dash.fmt.copy')}</Button>
        <span className={`fmt-status${status.kind === 'error' ? ' error' : ''}`} role="status">
          {status.kind === 'valid' && tKey('dash.fmt.valid', { mode: mode.toUpperCase() })}
          {status.kind === 'error' && tKey('dash.fmt.error', { line: status.line, col: status.col, message: status.message })}
        </span>
      </div>
      <textarea
        className="fmt-input mono"
        value={text}
        spellCheck={false}
        placeholder={tKey(mode === 'json' ? 'dash.fmt.placeholder.json' : 'dash.fmt.placeholder.xml')}
        onChange={(e) => {
          setText(e.target.value);
          setStatus({ kind: 'none' });
        }}
      />
      {mode === 'json' && <div className="fmt-tree">{parsed?.ok && <JsonTree value={parsed.value} />}</div>}
    </div>
  );
}
