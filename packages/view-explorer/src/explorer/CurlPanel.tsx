import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { type CodeEditorHandle, type CodeEditorProps, curlAt, curlFolding, curlHighlight, draftToSpec, variableAutocomplete, variableHighlight, type HttpHeaderDraft, type ImportedRequest, parseCurl, ResponseView, warningText } from '@kedalion/editor';
import type { HttpResponseInfo, RestEnvironment, RestEnvVarInput } from '@kedalion/server-core/protocol';
import { type ApiError, Button, dialogs, errorOf, Icon, IconButton, PanelBanner, request as apiRequest, SplitView, type TabAction, useViewLink } from '@kedalion/ui';
import { explorerApi as api } from '../client';
import { httpClient } from '../client';
import { t } from '../i18n';
import { CurlSide } from './CurlSide';
import type { ExplorerSqlProps } from './SqlPanel';

const DEFAULT_SPLIT: [number, number] = [0.6, 0.4];
const SIDE_SPLIT: [number, number] = [0.72, 0.28];
const NO_ENVS: RestEnvironment[] = [];

interface Options {
  name: string;
  /** The text editor shows (not a preview). */
  active: boolean;
  draft: string;
  /** Offset of the editor cursor. */
  cursor?: number;
  /** Shares the SQL props: split size and `go`. */
  sql?: ExplorerSqlProps;
}

const withAuth = (request: ImportedRequest): ImportedRequest['draft'] => {
  const { draft, auth } = request;
  if (!auth || draft.headers.some((h) => h.enabled && h.name.trim().toLowerCase() === 'authorization')) return draft;
  const header: HttpHeaderDraft = { name: 'Authorization', value: auth, enabled: true };
  return { ...draft, headers: [...draft.headers, header] };
};

/**
 * Curl commands of an Explorer `.curl` file: Run (selection or the command at the cursor) with the response in a panel below the editor,
 * and Open in REST. Only `.curl` files; the rest get nothing.
 */
export function useExplorerCurl({ name, active, draft, cursor = 0, sql }: Options) {
  const enabled = !!sql && active && /\.curl$/i.test(name);
  const toRest = useViewLink<ImportedRequest>('rest');
  const editor = useRef<CodeEditorHandle>(null);
  const abort = useRef<AbortController>();
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState<HttpResponseInfo>();
  const [error, setError] = useState<ApiError>();
  const [side, setSide] = useState(true);
  const [sideSizes, setSideSizes] = useState<[number, number]>(SIDE_SPLIT);
  const [environments, setEnvironments] = useState<RestEnvironment[]>(NO_ENVS);
  const [notice, setNotice] = useState<{ tone: 'warn' | 'err'; text: string }>();

  useEffect(() => () => abort.current?.abort(), []);

  const loadEnvironments = async () => {
    try {
      setEnvironments(await apiRequest<RestEnvironment[]>('GET', '/api/rest/environments'));
    } catch {
      setEnvironments(NO_ENVS);
    }
  };
  useEffect(() => {
    if (enabled) void loadEnvironments();
  }, [enabled, sql?.restEnvironment]);

  const environment = environments.find((e) => e.id === sql?.restEnvironment);
  const vars = environment?.vars ?? [];
  const extensions = useMemo(() => [curlHighlight(), curlFolding(), variableHighlight(vars), variableAutocomplete(vars)], [environment]);

  const setVar = environment ? async (varName: string, value: string) => {
    const next: RestEnvVarInput[] = environment.vars.map((v) => ({ name: v.name, enabled: v.enabled, secret: v.secret, ...(v.secret ? {} : { value: v.value }) }));
    const existing = next.find((v) => v.name === varName);
    if (existing) Object.assign(existing, { value, enabled: true });
    else next.push({ name: varName, value, secret: false, enabled: true });
    await apiRequest('PUT', '/api/rest/environments', { id: environment.id }, { name: environment.name, vars: next });
    await loadEnvironments();
  } : undefined;

  const writeBody = (from: number, to: number, text: string) => editor.current?.replaceRange(from, to, text);

  const resolve = (): ImportedRequest | undefined => {
    const handle = editor.current;
    const selected = handle?.getSelectionText() ?? '';
    const source = selected.trim() !== '' ? selected : curlAt(draft, handle?.view?.state.selection.main.head ?? 0)?.text;
    try {
      if (source === undefined) throw new Error('notCurl');
      const request = parseCurl(source);
      setNotice(request.warnings.length > 0 ? { tone: 'warn', text: request.warnings.map(warningText).join(' ') } : undefined);
      return request;
    } catch (err) {
      setNotice({ tone: 'err', text: err instanceof Error && err.message === 'notCurl' ? t('explorer.curl.notCurl') : errorOf(err).message });
      setOpen(true);
      return undefined;
    }
  };

  const run = async () => {
    if (sending) return;
    const request = resolve();
    if (!request) return;
    const controller = new AbortController();
    abort.current = controller;
    setOpen(true);
    setSending(true);
    setError(undefined);
    setResponse(undefined);
    try {
      const result = await httpClient.send(draftToSpec(withAuth(request)), undefined, controller.signal, { environment: sql?.restEnvironment || undefined });
      if (!controller.signal.aborted) setResponse(result);
    } catch (err) {
      if (!controller.signal.aborted) setError(errorOf(err));
    } finally {
      if (abort.current === controller) {
        abort.current = undefined;
        setSending(false);
      }
    }
  };

  const cancel = () => {
    abort.current?.abort();
    abort.current = undefined;
    setSending(false);
  };

  const saveResponse = async (info: HttpResponseInfo) => {
    try {
      const target = await dialogs.saveAs({ purpose: 'rest-response', suggestedName: info.fileName });
      if (target === null) return;
      await api.httpSave(info.id, target);
    } catch (err) {
      setNotice({ tone: 'err', text: errorOf(err).message });
    }
  };

  const openInRest = () => {
    if (!sql || !toRest) return;
    const request = resolve();
    if (request) toRest(request);
  };

  const actions: TabAction[] = enabled ? [
    { id: 'curl.run', group: 'primary', icon: 'play', label: t('explorer.shared.run'), hint: 'Ctrl+Enter', disabled: sending, run: () => void run() },
    { id: 'curl.panel', group: 'primary', icon: 'panel-right', label: t('explorer.curl.panel'), checked: side, run: () => setSide(!side) },
    ...(toRest ? [{ id: 'curl.openRest', group: 'primary' as const, icon: 'send' as const, label: t('explorer.curl.openRest'), run: openInRest }] : []),
  ] : [];

  const editorProps: Pick<CodeEditorProps, 'onRun' | 'extensions'> = enabled ? { onRun: () => void run(), extensions } : {};

  /** `editorNode` alone, or for `.curl` files with the response panel below. */
  const layout = (editorNode: ReactNode): ReactNode => {
    if (!enabled || !sql) return editorNode;
    const sizes = open ? (sql.sizes ?? DEFAULT_SPLIT) : [1];
    const stack = (
      <SplitView
        direction="column"
        sizes={sizes}
        defaultSizes={open ? DEFAULT_SPLIT : undefined}
        onResize={(s) => s.length === 2 && sql.onSizesChange([s[0], s[1]])}
      >
        <div key="editor" className="ex-pane">
          <div className="xp-sql-editor">{editorNode}</div>
        </div>
        {open && (
          <div key="response" className="ex-pane">
            <div className="xp-bar">
              <Icon name="send" size={12} />
              <span className="spacer" />
              {sending && <Button size="sm" variant="danger" icon="square" onClick={cancel} title={t('explorer.shared.cancel')}>{t('explorer.shared.cancel')}</Button>}
              <IconButton icon="close" onClick={() => setOpen(false)} label={t('explorer.curl.close')} />
            </div>
            {notice && <PanelBanner tone={notice.tone}>{notice.text}</PanelBanner>}
            <ResponseView response={response} error={error} sending={sending} onSave={response ? () => void saveResponse(response) : undefined} />
          </div>
        )}
      </SplitView>
    );
    if (!side) return stack;
    return (
      <SplitView direction="row" sizes={sideSizes} defaultSizes={SIDE_SPLIT} min={[0.3, 0.16]} onResize={(s) => s.length === 2 && setSideSizes([s[0]!, s[1]!])}>
        <div key="main" className="ex-pane">{stack}</div>
        <div key="side" className="ex-pane">
          <CurlSide
            text={draft}
            cursor={cursor}
            vars={vars}
            envName={environment?.name}
            onJump={(from, to) => editor.current?.reveal(from, to)}
            onRun={() => void run()}
            onOpenRest={toRest ? openInRest : undefined}
            onBody={writeBody}
            onSetVar={setVar}
            onClose={() => setSide(false)}
          />
        </div>
      </SplitView>
    );
  };

  return { enabled, editor, editorProps, actions, layout };
}
