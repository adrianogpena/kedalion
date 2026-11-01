import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { linkAt, type LinkTarget } from '../links';
import { ContextMenu } from './ContextMenu';

/** Right-click menu on external links: open in the Kedalion browser, in the default browser, or copy the address. */
export function LinkContextMenu({ open }: { open: (url: string, target: LinkTarget) => void }) {
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; url: string } | null>(null);

  useEffect(() => {
    const onContext = (e: MouseEvent) => {
      const hit = linkAt(e.target);
      if (!hit) return;
      e.preventDefault();
      setMenu({ at: { x: e.clientX, y: e.clientY }, url: hit.url });
    };
    window.addEventListener('contextmenu', onContext, true);
    return () => window.removeEventListener('contextmenu', onContext, true);
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
