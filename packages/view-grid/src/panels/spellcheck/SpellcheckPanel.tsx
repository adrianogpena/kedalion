import { useRef, useState, type ComponentProps } from 'react';
import { Button, ContextMenu, copyNotify } from '@kedalion/ui';
import { tKey } from '../../i18n';
import { runAction } from '../../source';
import { applyAll, applyIssue, AUTO, MAX_TEXT, parseLanguages, type Issue, type SpellResult } from './model';
import './spellcheck.css';

const STORE_KEY = 'kedalion.spellcheck.language';

const storedLanguage = (): string => {
  try {
    return localStorage.getItem(STORE_KEY) ?? AUTO;
  } catch {
    return AUTO;
  }
};

export function SpellcheckPanel({ config }: { config: Record<string, unknown> }) {
  const languages = parseLanguages(String(config.languages ?? ''));
  const [chosen, setChosen] = useState(storedLanguage);
  const language = chosen === AUTO || languages.some((l) => l.code === chosen) ? chosen : AUTO;
  const labelOf = (code: string) => languages.find((l) => l.code === code)?.label ?? code;
  const pick = (code: string) => {
    setChosen(code);
    run.current++;
    setResult(null);
    setBusy(false);
    try {
      localStorage.setItem(STORE_KEY, code);
    } catch {
      /* the choice then lasts for this session only */
    }
  };
  const [text, setText] = useState('');
  const [result, setResult] = useState<SpellResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: ComponentProps<typeof ContextMenu>['items'] } | null>(null);
  const run = useRef(0);

  const check = async () => {
    const id = ++run.current;
    setBusy(true);
    setError(false);
    try {
      const r = await runAction<SpellResult>('spellcheck', 'check', config, { text, language });
      if (id === run.current) setResult(r);
    } catch {
      if (id === run.current) setError(true);
    } finally {
      if (id === run.current) setBusy(false);
    }
  };

  const edit = (next: string) => {
    run.current++;
    setText(next);
    setResult(null);
    setBusy(false);
  };
  const apply = (issue: Issue, fix: string) => {
    if (!result) return;
    const next = applyIssue(text, result.issues, issue, fix);
    setText(next.text);
    setResult({ ...result, issues: next.issues });
  };

  const fixable = result?.issues.some((i) => i.fix);

  return (
    <div className="spell">
      {menu && <ContextMenu at={menu.at} items={menu.items} onClose={() => setMenu(null)} />}
      <textarea
        className="spell-input"
        maxLength={MAX_TEXT}
        value={text}
        spellCheck={false}
        placeholder={tKey('dash.spell.placeholder')}
        aria-label={tKey('dash.spell.panel')}
        onChange={(e) => edit(e.target.value)}
      />
      <div className="spell-head">
        <Button onClick={() => void check()} disabled={busy || !text.trim()}>{tKey(busy ? 'dash.spell.checking' : 'dash.spell.check')}</Button>
        <select value={language} aria-label={tKey('dash.spell.language')} onChange={(e) => pick(e.target.value)}>
          <option value={AUTO}>{tKey('dash.spell.lang.auto')}</option>
          {languages.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
        {result && language === AUTO && result.language && <span className="spell-lang">{tKey('dash.spell.detected', { language: labelOf(result.language) })}</span>}
        {result && fixable && <Button onClick={() => edit(applyAll(text, result.issues))}>{tKey('dash.spell.applyAll')}</Button>}
      </div>
      {error && <p className="spell-note err" role="alert">{tKey('dash.spell.failed')}</p>}
      {result && result.issues.length === 0 && <p className="spell-note">{tKey('dash.spell.clean')}</p>}
      <ul className="spell-list">
        {result?.issues.map((issue) => (
          <li
            key={`${issue.offset}-${issue.text}`}
            className="spell-issue"
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const fixes = [...new Set([...(issue.fix ? [issue.fix] : []), ...issue.alternatives])];
              setMenu({
                at: { x: e.clientX, y: e.clientY },
                items: [
                  ...fixes.map((fix) => ({ id: `fix-${fix}`, label: fix, icon: 'check' as const, run: () => apply(issue, fix) })),
                  ...(fixes.length ? ['sep' as const] : []),
                  { id: 'copy-word', label: tKey('dash.spell.copyWord'), icon: 'copy' as const, run: () => void copyNotify(issue.text) },
                ],
              });
            }}
          >
            <span className={`spell-kind ${issue.kind}`}>{tKey(`dash.spell.kind.${issue.kind}`)}</span>
            <span className="spell-fix">
              <s>{issue.text}</s>
              {issue.fix && <> → <strong>{issue.fix}</strong></>}
            </span>
            {issue.fix && <Button onClick={() => apply(issue, issue.fix)}>{tKey('dash.spell.apply')}</Button>}
            {issue.reason && <span className="spell-reason">{issue.reason}</span>}
            {issue.alternatives.length > 0 && (
              <span className="spell-alts">
                {issue.alternatives.map((alt) => (
                  <Button key={alt} onClick={() => apply(issue, alt)}>{alt}</Button>
                ))}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
