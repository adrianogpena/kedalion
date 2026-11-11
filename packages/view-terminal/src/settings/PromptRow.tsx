import { type CSSProperties, lazy, type ReactNode, Suspense, useRef, useState } from 'react';
import { DEFAULT_PROMPT_STYLE, PROMPT_COLORS, PROMPT_SEGMENT_KINDS, parsePromptScript, promptPreview, promptScript, type PromptColor, type PromptStyle } from '@kedalion/terminal';
import { Button, deepEqual, Modal, SettingItem, type SettingsCardProps } from '@kedalion/ui';
import { t, type TerminalMessageKey } from '../i18n';
import type { TerminalViewSettings } from '../settings';
import { colorsOfTheme } from '../TerminalSchemes';

const msg = (key: string) => t(key as TerminalMessageKey);
const msg2 = (key: string, params: Record<string, string | number>) => t(key as TerminalMessageKey, params as never);
const PALETTE_KEYS: Record<string, string> = { magenta: 'purple', brightMagenta: 'brightPurple' };

const CodeEditor = lazy(() => import('@kedalion/editor').then((m) => ({ default: m.CodeEditor })));

const time = (): string => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title={t('settings.terminal.promptStyle.help.title')} onClose={onClose} footer={<Button title={t('settings.terminal.promptStyle.help.close')} onClick={onClose}>{t('settings.terminal.promptStyle.help.close')}</Button>}>
      <div className="form">
        <span className="muted">{t('settings.terminal.promptStyle.help.intro')}</span>
        <h4 className="mono-label">{t('settings.terminal.promptStyle.help.segments')}</h4>
        <ul>
          {PROMPT_SEGMENT_KINDS.map((k) => <li key={k}><code>{k}</code> <span className="muted">{msg(`settings.terminal.promptStyle.help.kind.${k}`)}</span></li>)}
          <li><code>name</code> <span className="muted">{t('settings.terminal.promptStyle.help.custom')}</span></li>
        </ul>
        <h4 className="mono-label">{t('settings.terminal.promptStyle.help.colors')}</h4>
        <span className="muted">{t('settings.terminal.promptStyle.help.colorsHint')}</span>
        <div><code>{PROMPT_COLORS.join(' ')}</code> <code>bold</code></div>
        <h4 className="mono-label">{t('settings.terminal.promptStyle.help.empty')}</h4>
        <span className="muted">{t('settings.terminal.promptStyle.help.emptyHint')}</span>
      </div>
    </Modal>
  );
}

/** The `terminal.promptStyle` row: the prompt script with a toolbar that rewrites it, and a live preview beside it. */
function PromptStyleEditor({ settings, onChange, prompt }: { settings: TerminalViewSettings; onChange: (patch: Partial<TerminalViewSettings>) => void; prompt?: ReactNode }) {
  const saved = settings.terminal?.promptStyle ?? DEFAULT_PROMPT_STYLE;
  const [draftText, setDraftText] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const baseText = promptScript(saved);
  const text = draftText ?? baseText;
  const parsed = parsePromptScript(text);
  const current = parsed.errors.length === 0 ? parsed.style : null;
  const lastGood = useRef<PromptStyle>(saved);
  if (current) lastGood.current = current;
  const scriptDirty = draftText !== null && draftText !== baseText;

  const saveScript = () => {
    if (draftText === null || draftText === baseText || !current) return;
    setDraftText(null);
    onChange({ terminal: { ...settings.terminal, promptStyle: current } });
  };

  const colors = colorsOfTheme(settings.terminal?.theme ?? 'app', settings.terminal?.schemes ?? []);
  const colorOf = (c: PromptColor): string => (c === 'default' ? colors.foreground : (colors as Record<string, string>)[PALETTE_KEYS[c] ?? c]);
  const frame: CSSProperties = { background: colors.background, color: colors.foreground, fontFamily: settings.terminal?.fontFamily || 'var(--font-mono)' };
  const sample = { cwd: '~/projects/kedalion', folder: 'kedalion', branch: 'main', user: 'you', host: 'pc', time: time(), gitstatus: '* ↑1', os: 'Windows', shell: 'bash', date: new Date().toISOString().slice(0, 10), duration: '3s', jobs: '1', venv: '.venv', node: 'node 22.1.0', java: 'jdk-21' };
  const previews = [0, 1].map((status) => ({ status, lines: promptPreview(lastGood.current, { ...sample, status }) }));

  return (
    <div className="settings-format">
      <aside className="settings-format-preview">
        <h4 className="mono-label">{t('settings.terminal.promptStyle.preview')}</h4>
        <span className="muted">{t('settings.terminal.promptStyle.preview.hint')}</span>
        <div className="prompt-preview" style={frame}>
          {previews.map(({ status, lines }) => (
            <div key={status} className="prompt-preview-block">
              <span className="prompt-preview-label" style={{ color: colors.foreground }}>{t(status === 0 ? 'settings.terminal.promptStyle.afterSuccess' : 'settings.terminal.promptStyle.afterFailure')}</span>
              {lines.map((spans, li) => (
                <div key={li} className="prompt-preview-line">
                  {spans.map((sp, si) => <span key={si} style={{ color: colorOf(sp.color), fontWeight: sp.bold ? 700 : undefined }}>{sp.text}</span>)}
                </div>
              ))}
            </div>
          ))}
        </div>
      </aside>
      <div className="settings-format-options">
        {prompt && (
          <section className="section">
            <h4 className="mono-label">{t('settings.terminal.promptStyle.group.prompt')}</h4>
            <div className="card form">{prompt}</div>
          </section>
        )}
        <section className="section">
          <h4 className="mono-label">{t('settings.terminal.promptStyle.group.script')}</h4>
          <div className="card form">
            <SettingItem id="terminal.promptStyle" modified={!deepEqual(saved, DEFAULT_PROMPT_STYLE)}>
              <div className="field" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) saveScript(); }} onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                  e.preventDefault();
                  saveScript();
                }
              }}>
                <span className="muted">{t('settings.terminal.promptStyle.script.hint')}</span>
                <div className="prompt-script">
                  <Suspense fallback={null}><CodeEditor value={text} lang="shell" onChange={(v) => setDraftText(v)} /></Suspense>
                </div>
                {parsed.errors.map((er, i) => (
                  <span key={i} className="req-hint tone-warn">{t('settings.terminal.promptStyle.script.line', { line: er.line, message: msg2(`settings.terminal.promptStyle.script.error.${er.code}`, { value: er.value ?? '' }) })}</span>
                ))}
                <div className="row">
                  <Button title={t('settings.terminal.promptStyle.help.open')} size="sm" onClick={() => setHelp(true)}>{t('settings.terminal.promptStyle.help.open')}</Button>
                  <Button title={t('settings.terminal.promptStyle.script.revert')} size="sm" icon="rotate-ccw" disabled={!scriptDirty} onClick={() => setDraftText(null)}>{t('settings.terminal.promptStyle.script.revert')}</Button>
                </div>
              </div>
            </SettingItem>
          </div>
        </section>
      </div>
      {help && <HelpModal onClose={() => setHelp(false)} />}
    </div>
  );
}

/** The `terminal.promptStyle` field (search results): the style editor without the Prompt select. */
export function PromptRow(props: { settings: TerminalViewSettings; onChange: (patch: Partial<TerminalViewSettings>) => void }) {
  return <PromptStyleEditor {...props} />;
}

/** The Terminal > Prompt page: the style editor beside a live preview. */
export function PromptCard({ settings, onChange }: SettingsCardProps<TerminalViewSettings>) {
  return <PromptStyleEditor settings={settings} onChange={onChange} />;
}
