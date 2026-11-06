import { useEffect, useRef, useState } from 'react';
import { CodeEditor, langOfFile, SqlSteps, type SqlStepsTab } from '@kedalion/editor';
import { IconButton, request, useDialogs } from '@kedalion/ui';
import '../explorer.css';
import { t } from '../i18n';
import type { ExplorerSettings, ExplorerViewSettings } from '../settings';
import { useExplorerCurl } from './CurlPanel';
import { type ExplorerSqlProps, useExplorerSql } from './SqlPanel';

export interface ExplorerFileRunnerProps {
  /** Explorer project id of the file. */
  project: string;
  /** Path of the file inside the project; `.sql` and `.curl` files get run actions. */
  path: string;
  value: string;
  onChange(value: string): void;
}

/**
 * An editor with the Explorer's run actions for a `.sql` or `.curl` file, for screens outside the Explorer (the Dashboard).
 * It reads the Explorer settings (connections, workbench, REST environment) from the server and saves connection changes back.
 */
export function ExplorerFileRunner({ project, path, value, onChange }: ExplorerFileRunnerProps) {
  const name = path.split('/').pop() ?? path;
  const [settings, setSettings] = useState<ExplorerViewSettings>({});
  const [sizes, setSizes] = useState<[number, number] | undefined>();
  const [stepsOpen, setStepsOpen] = useState(false);
  const [stepsTab, setStepsTab] = useState<SqlStepsTab>('steps');
  const [selection, setSelection] = useState(0);
  const { confirm, element } = useDialogs();
  const latest = useRef(settings);
  latest.current = settings;

  useEffect(() => {
    let live = true;
    request<ExplorerViewSettings>('GET', '/api/settings').then((s) => live && setSettings(s), () => {});
    return () => {
      live = false;
    };
  }, []);

  const sql: ExplorerSqlProps = {
    workbench: settings.workbench,
    onWorkbenchChange: () => {},
    connections: settings.explorer?.connections,
    onConnectionsChange: (connections) => {
      const base = latest.current.explorer;
      if (!base) {
        setSettings({ ...latest.current, explorer: { connections } as ExplorerSettings });
        return;
      }
      const explorer = { ...base, connections };
      setSettings({ ...latest.current, explorer });
      void request('PUT', '/api/settings', {}, { explorer }).catch(() => {});
    },
    sizes,
    onSizesChange: setSizes,
    restEnvironment: settings.rest?.environment ?? '',
  };
  const isSql = langOfFile(name) === 'sql';
  const sqlUi = useExplorerSql({ project, name, path, active: true, focused: true, draft: value, sql, confirm, onRunStart: () => setStepsOpen(false) });
  const curlUi = useExplorerCurl({ name, active: true, draft: value, cursor: selection, sql });

  const actions = [...sqlUi.actions, ...curlUi.actions];
  if (isSql) {
    actions.push({
      id: 'sql.steps',
      group: 'primary',
      icon: 'list-flat',
      label: t('explorer.sql.steps'),
      checked: stepsOpen,
      run: () => {
        if (!stepsOpen) sqlUi.closeResults();
        setStepsOpen(!stepsOpen);
      },
    });
  }

  const editor = curlUi.enabled
    ? curlUi.layout(<CodeEditor ref={curlUi.editor} value={value} lang={langOfFile(name)} onChange={onChange} height="100%" wrap onSelection={(s) => setSelection(s.pos)} {...curlUi.editorProps} />)
    : sqlUi.layout(
        <CodeEditor ref={sqlUi.editor} value={value} lang={langOfFile(name)} onChange={onChange} height="100%" wrap onSelection={(s) => setSelection(s.pos)} sqlLint={isSql} {...sqlUi.editorProps} />,
        isSql && stepsOpen ? (
          <SqlSteps
            bottom
            text={value}
            cursor={selection}
            onJump={(from, to) => sqlUi.editor.current?.reveal(from, to)}
            onClose={() => setStepsOpen(false)}
            tab={stepsTab}
            onTab={setStepsTab}
            paramValues={sqlUi.paramValues}
            onParamValue={sqlUi.setParamValue}
          />
        ) : undefined,
      );

  return (
    <div className="ex-file-runner" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="ex-file-runner-bar" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', paddingBottom: 'var(--space-4)' }}>
        {actions.filter((a) => a.group === 'primary').map((a) => a.options ? (
          <select key={a.id} className="tabbar-select" value={a.value ?? ''} onChange={(e) => a.run(e.target.value)} disabled={a.disabled} title={a.label} aria-label={a.label}>
            {a.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : (
          <IconButton key={a.id} icon={a.icon ?? 'more'} label={a.label} title={a.hint ? `${a.label} (${a.hint})` : a.label} pressed={a.checked} disabled={a.disabled} onClick={() => a.run()} />
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{editor}</div>
      {element}
    </div>
  );
}
