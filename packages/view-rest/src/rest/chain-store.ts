import { useSyncExternalStore } from 'react';
import type { RestChain } from '@kedalion/server-core/protocol';
import type { ApiError } from '@kedalion/ui';
import { t } from '../i18n';
import type { SavedRequest } from '../settings';
import { evalCapture } from './capture';
import { restTabs, runtimeOf, tabOfSaved } from './tabs-store';

export interface StepResult {
  status?: number;
  error?: ApiError;
}

interface ChainState {
  /** The strip is shown. */
  open: boolean;
  /** Selected chain. */
  chainId?: string;
  running: boolean;
  /** Step index to result, for the last run. */
  results: Record<number, StepResult>;
  failedAt?: number;
  /** Captured values of the last run. */
  vars: Record<string, string>;
}

let state: ChainState = { open: false, running: false, results: {}, vars: {} };
const listeners = new Set<() => void>();
let cancelled = false;
let current: string | undefined;

function set(patch: Partial<ChainState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export const chainStore = {
  setOpen: (open: boolean) => set({ open }),
  select: (chainId: string | undefined) => set({ chainId, results: {}, failedAt: undefined, vars: {} }),
  clearResults: () => set({ results: {}, failedAt: undefined, vars: {} }),
  cancel() {
    cancelled = true;
    if (current) restTabs.cancel(current);
  },
  /** Runs `chain` from step `from` in order; stops at the first failure (status >= 400, error or missing capture). */
  async run(chain: RestChain, saved: SavedRequest[], environment: string | undefined, from = 0) {
    if (state.running) return;
    cancelled = false;
    const vars = from > 0 ? { ...state.vars } : {};
    const results: Record<number, StepResult> = {};
    for (const [i, r] of Object.entries(state.results)) if (Number(i) < from) results[Number(i)] = r;
    set({ running: true, results, failedAt: undefined, vars });
    const fail = (i: number, error: ApiError, status?: number) => {
      results[i] = { error, ...(status !== undefined ? { status } : {}) };
      set({ results: { ...results }, failedAt: i, vars: { ...vars } });
    };
    try {
      for (let i = from; i < chain.steps.length; i++) {
        const step = chain.steps[i]!;
        const item = saved.find((r) => r.id === step.requestId);
        if (!item) return fail(i, { message: t('rest.chain.stepMissing') } as ApiError);
        restTabs.openSaved(item);
        const tabId = tabOfSaved(item.id);
        if (!tabId) return fail(i, { message: t('rest.tab.full') } as ApiError);
        current = tabId;
        await restTabs.send(tabId, undefined, environment, vars);
        current = undefined;
        if (cancelled) return;
        const { response, error } = runtimeOf(tabId);
        if (error || !response) return fail(i, error ?? ({ message: t('rest.chain.noResponse') } as ApiError));
        results[i] = { status: response.status };
        if (response.status >= 400) return fail(i, { message: t('rest.chain.stepFailed', { name: item.name, status: String(response.status) }) } as ApiError, response.status);
        for (const capture of step.captures) {
          const value = evalCapture(response, capture);
          if (value === undefined) return fail(i, { message: t('rest.chain.captureMissing', { var: `{{${capture.name}}}`, path: capture.path }) } as ApiError, response.status);
          vars[capture.name] = value;
        }
        set({ results: { ...results }, vars: { ...vars } });
      }
    } finally {
      current = undefined;
      set({ running: false });
    }
  },
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useChainState(): ChainState {
  return useSyncExternalStore(subscribe, () => state);
}
