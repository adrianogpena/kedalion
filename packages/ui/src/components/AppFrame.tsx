import type { ReactNode } from 'react';
import { useLayout } from '../layout';
import { BrandMark } from './ui';

export interface AppFrameProps {
  zen?: boolean;
  /** Pop-out window: renders only `children` and `tools`, no sidebar or header nav. */
  popout?: boolean;
  sidebar: ReactNode;
  /** Global tools; the base frame ignores them (the sidebar footer already shows them). */
  tools?: ReactNode;
  children: ReactNode;
}

export function BaseAppFrame({ zen, sidebar, children }: AppFrameProps) {
  const { structure } = useLayout();
  if (structure.navPlacement === 'header') {
    // No sidebar column: `sidebar` renders the header nav (see `Sidebar`), stacked above the content.
    return (
      <div className={`app nav-header${zen ? ' zen' : ''}`}>
        {sidebar}
        {children}
      </div>
    );
  }
  const collapsed = structure.sidebarMode === 'collapsed';
  const right = structure.sidebarSide === 'right';
  return (
    <div className={`app${collapsed ? ' nav-collapsed' : ''}${zen ? ' zen' : ''}${right ? ' sidebar-right' : ''}`}>
      {sidebar}
      {children}
    </div>
  );
}

/** Islands: the frame is the darker background; the brand sits above the rail island, level with the tab row. */
export function IslandsAppFrame({ zen, sidebar, children }: AppFrameProps) {
  const { structure } = useLayout();
  const collapsed = structure.sidebarMode === 'collapsed';
  const right = structure.sidebarSide === 'right';
  return (
    <div className={`app islands-frame${collapsed ? ' nav-collapsed' : ''}${zen ? ' zen' : ''}${right ? ' sidebar-right' : ''}`}>
      <div className="islands-rail">
        <div className="islands-brand">
          <BrandMark size={22} />
        </div>
        {sidebar}
      </div>
      {children}
    </div>
  );
}

/** Atlas: the global tools move from the sidebar footer to the right end of a frame-wide status row.
 *  The row is the frame's own, so it stays when the per-file status bar (`statusBar`) is off. */
export function AtlasAppFrame({ tools, children, ...rest }: AppFrameProps) {
  return (
    <BaseAppFrame {...rest}>
      {children}
      {tools && (
        <footer className="atlas-statusbar">
          <span className="spacer" />
          {tools}
        </footer>
      )}
    </BaseAppFrame>
  );
}

/** Pop-out window: only the view, with the global tools in a slim strip at the top right. */
export function PopoutAppFrame({ tools, children }: AppFrameProps) {
  return (
    <div className="app popout-frame">
      {tools && <div className="popout-tools">{tools}</div>}
      {children}
    </div>
  );
}

export function AppFrame(props: AppFrameProps) {
  const { Frame } = useLayout().navParts;
  if (props.popout) return <PopoutAppFrame {...props} />;
  return <Frame {...props} />;
}
