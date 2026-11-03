import { useRef, useState } from 'react';
import type { RestChain, RestChainStep } from '@kedalion/server-core/protocol';
import { type ApiError, Button, ContextMenu, Empty, ErrorBanner, errorOf, IconButton, useAsync, useCommand, useRovingList } from '@kedalion/ui';
import type { useDialogs } from '@kedalion/ui';
import { restCommands } from '../commands';
import { restApi as api } from '../client';
import { t } from '../i18n';
import type { SavedRequest } from '../settings';
import { chainStore, useChainState } from './chain-store';
import { restTabs } from './tabs-store';

type At = { x: number; y: number };
const at = (e: { currentTarget: HTMLElement }): At => {
  const r = e.currentTarget.getBoundingClientRect();
  return { x: r.left, y: r.bottom + 4 };
};

interface Props {
  saved: SavedRequest[] | undefined;
  environment: string | undefined;
  /** Saved request of the active tab, for `rest.addStep`. */
  activeSavedId: string | undefined;
  prompt: ReturnType<typeof useDialogs>['prompt'];
  confirm: ReturnType<typeof useDialogs>['confirm'];
}

/** The chain strip: chain picker and Run chain, the ordered steps with their status, and the selected step's captures. */
export function ChainStrip({ saved, environment, activeSavedId, prompt, confirm }: Props) {
  const chains = useAsync(() => api.chains(), []);
  const run = useChainState();
  const [selected, setSelected] = useState(0);
  const [menu, setMenu] = useState<{ kind: 'chains' | 'add'; at: At }>();
  const [error, setError] = useState<ApiError>();
  const strip = useRef<HTMLOListElement>(null);
  useRovingList(strip, '.chain-step');

  const chain = chains.data?.find((c) => c.id === run.chainId) ?? chains.data?.[0];
  const nameOf = (requestId: string) => saved?.find((r) => r.id === requestId)?.name ?? t('rest.chain.stepMissing');
  const nameRule = (v: string) => (v.trim() ? null : t('error.badChainName'));

  const guard = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setError(undefined);
    try {
      return await fn();
    } catch (err) {
      setError(errorOf(err));
      return undefined;
    } finally {
      chains.reload();
    }
  };

  const edit = (next: RestChainStep[]) => chain && guard(() => api.updateChain(chain.id, { name: chain.name, steps: next }));
  const addStep = (requestId: string) => {
    if (!chain) return;
    void edit([...chain.steps, { requestId, captures: [] }]);
    setSelected(chain.steps.length);
  };
  const createChain = async () => {
    const name = await prompt({ title: t('rest.chain.newTitle'), label: t('rest.name'), value: '', validate: nameRule });
    if (!name) return;
    const created = await guard(() => api.createChain({ name, steps: [] }));
    if (created) chainStore.select(created.id);
  };
  const renameChain = async (c: RestChain) => {
    const name = await prompt({ title: t('rest.chain.renameTitle'), label: t('rest.name'), value: c.name, validate: nameRule });
    if (name && name.trim() !== c.name) void guard(() => api.updateChain(c.id, { name, steps: c.steps }));
  };
  const deleteChain = async (c: RestChain) => {
    if (!(await confirm({ title: t('rest.chain.deleteTitle', { name: c.name }), okLabel: t('rest.delete'), danger: true }))) return;
    await guard(() => api.deleteChain(c.id));
    chainStore.select(undefined);
  };
  const addCapture = async () => {
    const step = chain?.steps[selected];
    if (!chain || !step) return;
    const name = await prompt({ title: t('rest.chain.captureTitle'), label: t('rest.chain.captureName'), value: '', validate: (v) => (/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(v.trim()) ? null : t('rest.chain.captureNameBad')) });
    if (!name) return;
    const path = await prompt({ title: t('rest.chain.captureTitle'), label: t('rest.chain.capturePath'), value: '$.', validate: (v) => (v.trim() ? null : t('rest.chain.capturePathBad')) });
    if (!path) return;
    const from = path.trim().startsWith('$') ? 'body' : 'header';
    const steps = chain.steps.map((s, i) => (i === selected ? { ...s, captures: [...s.captures, { name: name.trim(), from: from as 'body' | 'header', path: path.trim() }] } : s));
    void edit(steps);
  };
  const removeCapture = (index: number) => {
    if (!chain) return;
    void edit(chain.steps.map((s, i) => (i === selected ? { ...s, captures: s.captures.filter((_, j) => j !== index) } : s)));
  };
  const removeStep = (index: number) => {
    if (!chain) return;
    void edit(chain.steps.filter((_, i) => i !== index));
    setSelected(Math.max(0, Math.min(selected, chain.steps.length - 2)));
    chainStore.clearResults();
  };
  const runChain = (from = 0) => chain && saved && void chainStore.run(chain, saved, environment, from);

  useCommand(restCommands()[3]!, () => !run.running && runChain());
  useCommand(restCommands()[4]!, () => activeSavedId && addStep(activeSavedId));

  const openStep = (i: number) => {
    setSelected(i);
    const item = saved?.find((r) => r.id === chain?.steps[i]?.requestId);
    if (item) restTabs.openSaved(item);
  };

  const step = chain?.steps[selected];
  const failed = run.failedAt !== undefined ? run.results[run.failedAt] : undefined;

  return (
    <div className="chain" role="group" aria-label={t('rest.chain.label')}>
      <div className="chain-head">
        <span className="mono-label">{t('rest.chain.label')}</span>
        <Button size="sm" variant="ghost" icon="chevron" onClick={(e) => setMenu({ kind: 'chains', at: at(e) })}>{chain?.name ?? t('rest.chain.none')}</Button>
        <span className="chain-spacer" />
        {run.running ? (
          <Button size="sm" icon="square" onClick={chainStore.cancel}>{t('rest.chain.cancel')}</Button>
        ) : (
          <Button size="sm" icon="play" disabled={!chain || !chain.steps.length || !saved} onClick={() => runChain()} title={t('rest.chain.runTitle')}>{t('rest.chain.run')}</Button>
        )}
      </div>
      {chains.error && <ErrorBanner error={chains.error} onRetry={chains.reload} compact />}
      {error && <ErrorBanner error={error} compact />}
      {!chain && !chains.loading && (
        <Empty title={t('rest.chain.empty')}>
          <Button size="sm" icon="plus" onClick={() => void createChain()}>{t('rest.chain.new')}</Button>
        </Empty>
      )}
      {chain && chain.steps.length === 0 && (
        <Empty title={t('rest.chain.addFirst')}>
          <Button size="sm" icon="plus" onClick={(e) => setMenu({ kind: 'add', at: at(e) })}>{t('rest.chain.addStep')}</Button>
        </Empty>
      )}
      {chain && chain.steps.length > 0 && (
        <ol className="chain-strip" ref={strip} aria-label={t('rest.chain.steps')}>
          {chain.steps.map((s, i) => {
            const result = run.results[i];
            const prev = chain.steps[i - 1];
            const flow = prev?.captures.map((c) => `{{${c.name}}}`).join(' ');
            return (
              <li className="chain-item" key={`${s.requestId}-${i}`}>
                {i > 0 && <span className="chain-link" aria-hidden="true">──<em>{flow || ''}</em>──▶</span>}
                <Button
                  size="sm"
                  variant="ghost"
                  className="chain-step"
                  pressed={i === selected}
                  onClick={() => openStep(i)}
                  title={`${nameOf(s.requestId)}${result?.status ? ` ${result.status}` : ''}`}
                >
                  {result && <span className={`chain-dot${result.error || (result.status ?? 0) >= 400 ? ' err' : ' ok'}`} aria-hidden="true" />}
                  {nameOf(s.requestId)}
                  {result?.status ? ` ${result.status}` : ''}
                </Button>
                {i === selected && <IconButton size="xs" icon="close" label={t('rest.chain.removeStep')} onClick={() => removeStep(i)} />}
              </li>
            );
          })}
          <li className="chain-item">
            <IconButton size="xs" icon="plus" label={t('rest.chain.addStep')} onClick={(e) => setMenu({ kind: 'add', at: at(e) })} />
          </li>
        </ol>
      )}
      {run.failedAt !== undefined && failed?.error && chain && (
        <ErrorBanner error={failed.error} compact onRetry={() => runChain(run.failedAt)} />
      )}
      {step && (
        <div className="chain-capture">
          <span className="mono-label">{t('rest.chain.captures')}</span>
          {step.captures.map((c, i) => (
            <span className="chain-chip" key={`${c.name}-${i}`} title={`${c.from}: ${c.path}`}>
              {c.name} = {c.path}
              <IconButton size="xs" icon="close" label={t('rest.chain.removeCapture')} onClick={() => removeCapture(i)} />
            </span>
          ))}
          <Button size="xs" icon="plus" onClick={() => void addCapture()} title={t('rest.chain.addCaptureTitle')}>{t('rest.chain.addCapture')}</Button>
        </div>
      )}
      {menu?.kind === 'chains' && (
        <ContextMenu
          at={menu.at}
          onClose={() => setMenu(undefined)}
          items={[
            ...(chains.data ?? []).map((c) => ({ id: c.id, label: c.name, radio: true, checked: c.id === chain?.id, run: () => { chainStore.select(c.id); setSelected(0); } })),
            ...(chains.data?.length ? (['sep'] as const) : []),
            { id: 'new', label: t('rest.chain.new'), icon: 'plus' as const, run: () => void createChain() },
            ...(chain
              ? [
                  { id: 'rename', label: t('rest.rename'), icon: 'edit' as const, run: () => void renameChain(chain) },
                  { id: 'delete', label: t('rest.delete'), icon: 'trash' as const, danger: true, run: () => void deleteChain(chain) },
                ]
              : []),
          ]}
        />
      )}
      {menu?.kind === 'add' && (
        <ContextMenu
          at={menu.at}
          onClose={() => setMenu(undefined)}
          items={(saved ?? []).length ? (saved ?? []).map((r) => ({ id: r.id, label: r.name, run: () => addStep(r.id) })) : [{ id: 'none', label: t('rest.none'), disabled: true, run: () => {} }]}
        />
      )}
    </div>
  );
}
