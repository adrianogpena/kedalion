import { type IconName, IMAGE_ICONS, type ImageIconName, iconSetById } from '../icons';
import { useLayout } from '../layout';
import { VIEW_ICON_SVGS } from '../view-icons';

/** Icon of a view entry in the Navigation: the view's mythology icon when the navIcons setting asks for it, else the icon set's `name`. */
export function NavIcon({ viewId, name, size = 16 }: { viewId: string; name: IconName; size?: number }) {
  const { navIcons } = useLayout();
  const svg = navIcons === 'mythology' ? VIEW_ICON_SVGS[viewId] : undefined;
  if (!svg) return <Icon name={name} size={size} />;
  return <span className="icon nav-view-icon" style={{ '--s': `${size}px` } as React.CSSProperties} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg.replace('width="24" height="24"', 'width="100%" height="100%"') }} />;
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
