import { type ReactNode, useEffect, useRef, useState } from 'react';
import { PanesLayout } from './layouts/PanesLayout';
import { draftToSpec, hasAuthHeader, type HttpRequestDraft, type ImportedRequest, RequestEditor, ResponseView, toCurl } from '@kedalion/editor';
import type { HttpResponseInfo, RestEnvVar } from '@kedalion/server-core/protocol';
import { type ApiError, Button, dialogs, ErrorBanner, errorOf, IconButton, PageHead, SplitView, useAsync, useCommand, useViewLayout,useDebouncedSave, useDialogs, useShortcutTip, useViewRequest } from '@kedalion/ui';
import { restCommands } from './commands';
import { restApi as api } from './client';
import type { RestSettings, RestViewSettings, SavedRequest } from './settings';
import { t } from './i18n';
import './rest.css';
import { ImportDialog, requestLabel } from './rest/ImportDialog';
import { CurlDialog } from './rest/CurlDialog';
import { HistoryPanel } from './rest/HistoryPanel';
import { EnvironmentsDialog } from './rest/EnvironmentsDialog';
import { RestTabBar } from './rest/RestTabBar';
import { openRestTab, restTabs, runtimeOf, useRestTabs } from './rest/tabs-store';

const NO_VARS: RestEnvVar[] = [];
const MAX_NAME = 80;

/** `name`, or `name (2)`, `name (3)`… when taken; the result stays within the name limit. */
function uniqueName(name: string, taken: Set<string>): string {
  const base = name.trim().slice(0, MAX_NAME) || 'Request';
  let candidate = base;
  for (let n = 2; taken.has(candidate); n++) {
    const suffix = ` (${n})`;
    candidate = base.slice(0, MAX_NAME - suffix.length) + suffix;
  }
  return candidate;
}

const DEFAULT_MAIN: [number, number] = [0.5, 0.5];

export function RestScreen({ settings, onSave }: { settings: RestViewSettings; onSave: (patch: Partial<RestViewSettings>) => void }) {
  const bridge = useViewLayout('rest') === 'panes';
  const saved = useAsync(() => api.requests(), []);
  const { confirm, prompt, element } = useDialogs();
  const [state, setState] = useState<RestSettings>(settings.rest ?? {});
  const { tabs, active, full } = useRestTabs();
  useEffect(() => restTabs.setSaved(saved.data), [saved.data]);
  const tab = tabs.find((t) => t.id === active) ?? tabs[0]!;
  const draft = tab.draft;
  const loaded = tab.savedId ? saved.data?.find((r) => r.id === tab.savedId) : undefined;
  const { auth, imported, response, error, sending, savedPath } = runtimeOf(tab.id);
  const [importing, setImporting] = useState(false);
  const [curl, setCurl] = useState<string>();
  const [actionError, setActionError] = useState<ApiError>();
  const { request: incoming, take: takeIncoming } = useViewRequest<ImportedRequest>('rest');
  useEffect(() => {
    if (!incoming) return;
    const request = takeIncoming();
    if (request && openRestTab(request.draft, request.auth, request.name) === null) setActionError({ message: t('rest.tab.full') } as ApiError);
  }, [incoming]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const environments = useAsync(() => api.environments(), []);
  const [managing, setManaging] = useState(false);
  /** Active environment id ('' = none); only sent while it still exists. */
  const environment = settings.rest?.environment ?? '';
  const activeEnv = environments.data?.find((e) => e.id === environment);
  const setEnvironment = (id: string) => onSave({ rest: { ...settings.rest, environment: id } });

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyTick, setHistoryTick] = useState(0);
  const historyOpenRef = useRef(historyOpen);
  historyOpenRef.current = historyOpen;

  const persist = useDebouncedSave((next: RestSettings) => onSave({ rest: { ...settings.rest, sizes: next.sizes } }));
  const sizes = state.sizes?.main ?? DEFAULT_MAIN;

  const setDraft = (next: HttpRequestDraft) => restTabs.update(tab.id, { draft: next });
  const setAuth = (value: string) => restTabs.setRuntime(tab.id, { auth: value });
  const send = () =>
    void restTabs
      .send(tab.id, auth && !hasAuthHeader(draft.headers) ? [['Authorization', auth]] : undefined, environments.data ? activeEnv?.id : environment || undefined)
      .then(() => historyOpenRef.current && setHistoryTick((n) => n + 1));
  const cancel = () => restTabs.cancel(tab.id);

  const loadImported = (item: ImportedRequest) => restTabs.loadImported(tab.id, item.draft, item.name ?? '', item.auth);

  const saveImported = async (items: ImportedRequest[]) => {
    const taken = new Set((saved.data ?? []).map((r) => r.name));
    try {
      for (const item of items) {
        const name = uniqueName(requestLabel(item), taken);
        taken.add(name);
        await api.createRequest({ name, request: item.draft, ...(item.auth ? { auth: item.auth } : {}) });
      }
    } finally {
      saved.reload();
    }
  };

  const save = async (asNew: boolean) => {
    const { id, savedId } = tab;
    setActionError(undefined);
    try {
      let name = loaded?.name ?? tab.title;
      if (asNew || !savedId || !name) {
        name =
          (await prompt({
            title: t('rest.saveAsTitle'),
            label: t('rest.name'),
            value: name ?? imported?.name ?? '',
            validate: (v) => (v.trim() ? null : t('error.badRequestName')),
          })) ?? undefined;
        if (!name) return;
      }
      // Switching a saved request from Basic/Bearer to None clears its secret ('' removes it).
      const cleared = !auth && !draft.authKind && !!loaded?.request.authKind && !asNew;
      const input = { name, request: draft, ...(auth ? { auth } : cleared ? { auth: '' } : {}) };
      const record = asNew || !savedId ? await api.createRequest(input) : await api.updateRequest(savedId, input);
      restTabs.markSaved(id, record);
      saved.reload();
    } catch (err) {
      setActionError(errorOf(err));
    }
  };
  useCommand(restCommands()[0]!, () => void save(false));
  const tip = useShortcutTip();

  const remove = async (item: SavedRequest) => {
    if (!(await confirm({ title: t('rest.deleteTitle', { name: item.name }), okLabel: t('rest.delete'), danger: true }))) return;
    setActionError(undefined);
    try {
      await api.deleteRequest(item.id);
      restTabs.savedChanged(item.id);
      saved.reload();
    } catch (err) {
      setActionError(errorOf(err));
    }
  };

  const rename = async (item: SavedRequest) => {
    const name = await prompt({
      title: t('rest.renameTitle'),
      label: t('rest.name'),
      value: item.name,
      validate: (v) => (v.trim() ? null : t('error.badRequestName')),
    });
    if (!name || name.trim() === item.name) return;
    setActionError(undefined);
    try {
      const record = await api.updateRequest(item.id, { name, request: item.request });
      restTabs.savedChanged(item.id, record);
      saved.reload();
    } catch (err) {
      setActionError(errorOf(err));
    }
  };

  const moveTo = async (fromId: string, toId: string) => {
    const ids = (saved.data ?? []).map((r) => r.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from < 0 || to < 0 || from === to) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    setActionError(undefined);
    try {
      await api.reorderRequests(ids);
    } catch (err) {
      setActionError(errorOf(err));
    } finally {
      saved.reload();
    }
  };

  const showCurl = async () => {
    const spec = draftToSpec(draft);
    let value = auth || undefined;
    if (!value && tab.savedId && loaded?.auth?.hasSecret && !hasAuthHeader(draft.headers)) {
      setActionError(undefined);
      try {
        value = (await api.requestAuth(tab.savedId)).value ?? undefined;
      } catch (err) {
        setActionError(errorOf(err));
        return;
      }
    }
    setCurl(toCurl(spec, value));
  };

  const saveResponse = async (info: HttpResponseInfo) => {
    const id = tab.id;
    setActionError(undefined);
    try {
      const target = await dialogs.saveAs({ purpose: 'rest-response', suggestedName: info.fileName });
      if (target === null) return;
      const { path } = await api.httpSave(info.id, target);
      restTabs.setRuntime(id, { savedPath: path });
    } catch (err) {
      setActionError(errorOf(err));
    }
  };

  const actions = (
        <div className="row">
          <Button size="sm" icon="download" onClick={() => setImporting(true)} title={t('rest.import')}>{t('rest.import')}</Button>
          <Button size="sm" variant="ghost" icon="code" onClick={() => void showCurl()} title={t('rest.code')}>{t('rest.code')}</Button>
          <Button size="sm" variant="primary" icon="check" onClick={() => save(false)} title={tip(t('rest.save'), 'rest.save')}>{t('rest.save')}</Button>
          <Button size="sm" onClick={() => save(true)} title={t('rest.saveAs')}>{t('rest.saveAs')}</Button>
        </div>
  );
  const banners = (
    <>
      {actionError && <ErrorBanner error={actionError} compact />}
      {full && <p className="muted" role="status">{t('rest.tab.full')}</p>}
    </>
  );
  const list = (
        <aside className="rest-list">
          <div className="rest-list-head">
            <span className="mono-label">{t('rest.saved')}</span>
            <Button size="sm" icon="plus" onClick={restTabs.newTab} title={t('rest.new')}>{t('rest.new')}</Button>
          </div>
          {saved.error && <ErrorBanner error={saved.error} onRetry={saved.reload} compact />}
          {saved.data?.length === 0 && <p className="muted">{t('rest.none')}</p>}
          {saved.data?.map((item) => (
            <div
              key={item.id}
              className={`rest-item${item.id === tab.savedId ? ' active' : ''}${item.id === dragOver ? ' drop-target' : ''}`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', item.id);
                setDragId(item.id);
              }}
              onDragOver={(e) => {
                if (dragId === null) return;
                e.preventDefault();
                setDragOver(item.id);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId !== null) void moveTo(dragId, item.id);
                setDragId(null);
                setDragOver(null);
              }}
              onDragEnd={() => {
                setDragId(null);
                setDragOver(null);
              }}
            >
              <button className="rest-item-main" onClick={() => restTabs.openSaved(item)} title={item.request.url}>
                <span className="rest-method">{item.request.method}</span>
                <span className="rest-item-name">{item.name}</span>
              </button>
              <span className="rest-item-actions">
                <IconButton size="xs" icon="edit" onClick={() => rename(item)} label={t('rest.rename')} />
                <IconButton size="xs" icon="trash" onClick={() => remove(item)} label={t('rest.delete')} />
              </span>
            </div>
          ))}
        </aside>
  );
  const tabBar = (
        <RestTabBar
          tabs={tabs}
          active={tab.id}
          saved={saved.data}
          env={{ environments: environments.data, environment, onEnvironment: setEnvironment, onManage: () => setManaging(true), history: historyOpen, onHistory: () => setHistoryOpen((v) => !v) }}
        />
  );
  const split = (req: ReactNode, res: ReactNode) => (
        <SplitView
          direction="column"
          sizes={[sizes[0], sizes[1]]}
          defaultSizes={DEFAULT_MAIN}
          onResize={(s) => {
            const next = { ...state, sizes: { main: [s[0], s[1]] as [number, number] } };
            setState(next);
            persist(next);
          }}
        >
          {req}
          {res}
        </SplitView>
  );
  const request = (
          <div key="request" className="rest-pane">
            <RequestEditor
              key={tab.id}
              value={draft}
              onChange={setDraft}
              onSend={send}
              onCancel={cancel}
              sending={sending}
              variables={activeEnv?.vars ?? NO_VARS}
              auth={{
                value: auth,
                onChange: setAuth,
                disabled: !tab.savedId && !imported?.auth,
                placeholder: loaded?.auth?.hasSecret ? t('rest.authSaved') : undefined,
                hasSaved: !!loaded?.auth?.hasSecret,
                hint: tab.savedId ? t('rest.authHint') : imported?.auth ? t('rest.authImported') : t('rest.authNeedsSave'),
              }}
            />
          </div>
  );
  const response_ = (
          <div key="response" className="rest-pane">
            {savedPath && <p className="muted">{t('rest.responseSaved', { path: savedPath })}</p>}
            <ResponseView response={response} error={error} sending={sending} onSave={response ? () => saveResponse(response) : undefined} />
          </div>
  );
  const history = historyOpen ? <HistoryPanel refresh={historyTick} confirm={confirm} onClose={() => setHistoryOpen(false)} /> : null;
  const dialogsEl = (
    <>
      {importing && <ImportDialog onLoad={loadImported} onSaveMany={saveImported} onClose={() => setImporting(false)} />}
      {managing && (
        <EnvironmentsDialog
          environments={environments.data}
          onChanged={environments.reload}
          onDeleted={(id) => id === environment && setEnvironment('')}
          onClose={() => setManaging(false)}
        />
      )}
      {curl !== undefined && <CurlDialog curl={curl} onClose={() => setCurl(undefined)} />}
      {element}
    </>
  );

  if (bridge) {
    return <PanesLayout actions={actions} banners={banners} list={list} tabBar={tabBar} request={request} response={response_} history={history} dialogs={dialogsEl} />;
  }

  return (
    <div className="content screen-edges">
      <PageHead title={t('nav.rest')}>{actions}</PageHead>
      {banners}
      <div className="rest-body">
        {list}
        <div className="rest-main">
          {tabBar}
          {split(request, response_)}
        </div>
        {history}
      </div>
      {dialogsEl}
    </div>
  );
}
