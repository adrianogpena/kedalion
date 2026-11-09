import { useCallback, useEffect, useRef, useState } from 'react';
import { getSidebar, putSidebar } from './sidebar-api';
import { emptySidebar, type SavedCommand, type SavedPath, type SidebarData } from './sidebar-types';

const newId = () => crypto.randomUUID().slice(0, 8);

export interface SidebarHook {
  data: SidebarData;
  loading: boolean;
  error?: unknown;
  add(kind: 'paths' | 'commands', item: Omit<SavedPath, 'id'> | Omit<SavedCommand, 'id'>): void;
  update(next: SidebarData): void;
}

/** The Terminal sidebar's saved paths and commands: loaded once, saved on every change. */
export function useSidebarData(): SidebarHook {
  const [data, setData] = useState<SidebarData>(emptySidebar);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const latest = useRef(data);

  const load = useCallback(() => {
    return getSidebar().then(
      (d) => {
        latest.current = d;
        setData(d);
      },
      (e) => setError(e),
    );
  }, []);

  useEffect(() => {
    void load().finally(() => setLoading(false));
  }, [load]);

  const update = useCallback(
    (next: SidebarData) => {
      latest.current = next;
      setData(next);
      setError(undefined);
      putSidebar(next).then(
        (r) => {
          if (!r.ok) {
            setError(new Error('save failed'));
            void load();
          }
        },
        (e) => {
          setError(e);
          void load();
        },
      );
    },
    [load],
  );

  const add = useCallback<SidebarHook['add']>(
    (kind, item) => {
      const cur = latest.current;
      update({ ...cur, [kind]: [...cur[kind], { ...item, id: newId() }] } as SidebarData);
    },
    [update],
  );

  return { data, loading, error, add, update };
}
