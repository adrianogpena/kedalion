import { type MutableRefObject, useEffect, useState } from 'react';
import { ContextMenu, dialogs, useViewToast } from '@kedalion/ui';
import { browserApi } from './client';
import { t } from './i18n';
import type { SelectOptionInfo } from './protocol';
import type { BrowserSocket } from './web/useBrowserSocket';

interface SelectState {
  id: string;
  options: SelectOptionInfo[];
  at: { x: number; y: number };
}

/** What the page asks the user for: select popups, JS dialogs, file choosers; plus the download toast. */
export function BrowserOverlays({ socket, pointer }: { socket: BrowserSocket; pointer: MutableRefObject<{ x: number; y: number }> }) {
  const { subscribe, send } = socket;
  const toast = useViewToast('globe');
  const [select, setSelect] = useState<SelectState | null>(null);

  useEffect(
    () =>
      subscribe((msg) => {
        switch (msg.type) {
          case 'select':
            setSelect({ id: msg.id, options: msg.options, at: { ...pointer.current } });
            break;
          case 'dialog': {
            const tab = msg.tab;
            const answer = async () => {
              if (msg.kind === 'prompt') {
                const text = await dialogs.prompt({ title: t('browser.dialog.prompt'), label: msg.message, value: msg.defaultPrompt ?? '' });
                send({ type: 'dialogAnswer', tab, accept: text !== null, ...(text !== null ? { text } : {}) });
              } else if (msg.kind === 'alert') {
                await dialogs.confirm({ title: t('browser.dialog.alert'), body: msg.message });
                send({ type: 'dialogAnswer', tab, accept: true });
              } else {
                const beforeUnload = msg.kind === 'beforeunload';
                const ok = await dialogs.confirm({
                  title: t(beforeUnload ? 'browser.dialog.beforeunload' : 'browser.dialog.confirm'),
                  body: beforeUnload ? undefined : msg.message,
                  okLabel: beforeUnload ? t('browser.dialog.leave') : undefined,
                });
                send({ type: 'dialogAnswer', tab, accept: ok });
              }
            };
            void answer();
            break;
          }
          case 'fileChooser': {
            const { tab, id } = msg;
            void dialogs.pickFile().then((path) => browserApi.setFiles(tab, id, path ? [path] : []));
            break;
          }
          case 'download':
            toast({ message: t(msg.done ? 'browser.download.done' : 'browser.download.started', { name: msg.name }), icon: 'globe', timeout: msg.done ? 4000 : 2000, key: `download:${msg.path}` });
            break;
          case 'error':
            toast({ message: msg.message, kind: 'error' });
            break;
        }
      }),
    [subscribe, send, pointer, toast],
  );

  if (!select) return null;
  return (
    <ContextMenu
      at={select.at}
      onClose={() => setSelect(null)}
      items={select.options.map((o, i) => ({
        id: `${i}`,
        label: o.label || o.value,
        checked: o.selected,
        radio: true,
        disabled: o.disabled,
        run: () => send({ type: 'selectChoice', id: select.id, value: o.value }),
      }))}
    />
  );
}
