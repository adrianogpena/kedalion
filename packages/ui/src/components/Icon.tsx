import { type IconName, IMAGE_ICONS, type ImageIconName, iconSetById } from '../icons';
import { useLayout } from '../layout';
import { useViewBusy } from '../view-busy';
import { VIEW_ICON_SVGS } from '../view-icons';

/** Charon's wave line, and the same line (period 9) stretched past the icon edges so it can slide right without gaps. */
const WAVE = 'M3 21.5q2-1.3 4.5 0t4.5 0 4.5 0 4.5 0';
const WAVE_LONG = `M-15 21.5q2-1.3 4.5 0${'t4.5 0'.repeat(9)}`;

/** Icon of a view entry in the Navigation: the view's mythology icon when the navIcons setting asks for it, else the icon set's `name`. */
export function NavIcon({ viewId, name, size = 16 }: { viewId: string; name: IconName; size?: number }) {
  const { navIcons } = useLayout();
  const busy = useViewBusy(viewId);
  const svg = navIcons === 'mythology' ? VIEW_ICON_SVGS[viewId] : undefined;
  if (!svg) return <Icon name={name} size={size} />;
  return <span className={`icon nav-view-icon${busy ? ' busy' : ''}`} style={{ '--s': `${size}px` } as React.CSSProperties} aria-hidden="true" dangerouslySetInnerHTML={{ __html: (busy ? svg.replace(WAVE, WAVE_LONG) : svg).replace('width="24" height="24"', 'width="100%" height="100%"') }} />;
}

export function Icon({ name, size = 16 }: { name: IconName | ImageIconName; size?: number }) {
  const set = iconSetById(useLayout().iconSet);
  if (name in IMAGE_ICONS) return <img className="icon" width={size} height={size} src={IMAGE_ICONS[name as ImageIconName]} alt="" aria-hidden="true" />;
  // `<icon>:<ext>` names come from fileIconOf under a set with fileVariants; other sets draw `<icon>`.
  const variant = set.fileVariants?.[name];
  const path = set.paths[name.split(':')[0] as IconName];
  if (set.markup) {
    return (
      <svg className="icon" width={size} height={size} viewBox={set.viewBox} fill="currentColor" aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: variant ?? path }} />
    );
  }
  if (set.mode === 'fill') {
    return (
      <svg className="icon" width={size} height={size} viewBox={set.viewBox} fill="currentColor" aria-hidden="true">
        <path d={path} />
      </svg>
    );
  }
  return (
    <svg className="icon" width={size} height={size} viewBox={set.viewBox} fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}
