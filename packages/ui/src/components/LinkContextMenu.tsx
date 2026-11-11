import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { linkAt, routableUrl, type LinkTarget } from '../links';
import { ContextMenu } from './ContextMenu';

const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/** The routable URL of the closest `data-context-link` element around `target` (a row that stands for a link). */
function linkRowAt(target: EventTarget | null): string | null {
  const el = target instanceof Element ? target.closest('[data-context-link]') : null;
  return el ? routableUrl(el.getAttribute('data-context-link'), window.location.href) : null;
}

/** True when the right-click lands on selected text, where the browser menu offers Copy. */
function onSelection(target: EventTarget | null): boolean {
  const sel = window.getSelection();
  return !!sel && !sel.isCollapsed && target instanceof Node && sel.containsNode(target, true);
}

/**
 * Right-click menu on external links (and `data-context-link` rows): open in the Kedalion browser, in the default
 * browser, or copy the address. Also hides the browser's own menu wherever no component opened one, except in
 * editable fields and on selected text.
 */
export function LinkContextMenu({ open }: { open: (url: string, target: LinkTarget) => void }) {
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; url: string } | null>(null);

  useEffect(() => {
    const onContext = (e: MouseEvent) => {
      const url = linkAt(e.target)?.url ?? linkRowAt(e.target);
      if (!url) return;
      e.preventDefault();
      setMenu({ at: { x: e.clientX, y: e.clientY }, url });
    };
    // Bubble phase, after React's handlers: a component that opened its own menu has prevented the default.
    const guard = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest(EDITABLE) || onSelection(e.target)) return;
      e.preventDefault();
    };
    window.addEventListener('contextmenu', onContext, true);
    window.addEventListener('contextmenu', guard);
    return () => {
      window.removeEventListener('contextmenu', onContext, true);
      window.removeEventListener('contextmenu', guard);
    };
  }, []);

  if (!menu) return null;
  return (
    <ContextMenu
      at={menu.at}
      onClose={() => setMenu(null)}
      items={[
        { id: 'internal', label: t('link.openInternal'), icon: 'globe', run: () => open(menu.url, 'internal') },
        { id: 'external', label: t('link.openExternal'), icon: 'popout', run: () => open(menu.url, 'external') },
        'sep',
        { id: 'copy', label: t('link.copy'), icon: 'copy', run: () => void navigator.clipboard.writeText(menu.url) },
      ]}
    />
  );
}
