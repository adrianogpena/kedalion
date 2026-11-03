import type { CSSProperties, ReactNode } from 'react';
import type { ResolvedLayouts } from '@kedalion/server-core/layouts';
import './layout-preview.css';

const DENSITY_SCALE = { normal: 1, compact: 0.8, roomy: 1.25 } as const;

function Pills({ count, active = 0 }: { count: number; active?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={`lp-pill${i === active ? ' lp-active' : ''}`} />
      ))}
    </>
  );
}

function Rail({ resolved }: { resolved: ResolvedLayouts }) {
  const { navigation, nav } = resolved;
  const atlas = navigation === 'atlas';
  return (
    <div className={`lp-rail lp-rail-${nav.dock}${nav.labels ? ' lp-rail-wide' : ''}${atlas ? ' lp-rail-atlas' : ''}`}>
      {nav.brand && navigation === 'sidebar' && <span className="lp-brand" />}
      {atlas && <span className="lp-section" />}
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={`lp-item${i === 0 ? ' lp-active' : ''}`}>
          <span className="lp-dot" />
          {nav.labels && <span className="lp-bar" />}
        </span>
      ))}
      {atlas && <span className="lp-section" />}
      {!atlas && navigation === 'sidebar' && (
        <span className="lp-tools">
          <span className="lp-dot" />
          <span className="lp-dot" />
        </span>
      )}
    </div>
  );
}

function TabBar({ position }: { position: 'top' | 'bottom' }) {
  return (
    <div className={`lp-tabbar lp-tabbar-${position}`}>
      <Pills count={3} />
    </div>
  );
}

function Frame({ resolved, compact, children }: { resolved: ResolvedLayouts; compact?: boolean; children: ReactNode }) {
  const { navigation, nav } = resolved;
  const header = navigation === 'header' || navigation === 'header-command';
  const atlas = navigation === 'atlas';
  const style = { '--lp-d': DENSITY_SCALE[resolved.density] } as CSSProperties;
  const tabs = <TabBar position={nav.tabBar} />;
  return (
    <div
      className={`lp-root lp-nav-${navigation} lp-density-${resolved.density}${compact ? ' lp-compact' : ''}`}
      data-skin={resolved.skin}
      style={style}
      aria-hidden="true"
    >
      {navigation === 'header-command' && (
        <div className="lp-command">
          <span className="lp-cmdbar" />
        </div>
      )}
      {header && (
        <div className="lp-header">
          <Pills count={6} />
        </div>
      )}
      <div className="lp-mid">
        {!header && nav.dock === 'left' && <Rail resolved={resolved} />}
        <div className="lp-main">
          {nav.tabBar === 'top' && tabs}
          <div className="lp-content">{children}</div>
          {nav.tabBar === 'bottom' && tabs}
        </div>
        {!header && nav.dock === 'right' && <Rail resolved={resolved} />}
      </div>
      {navigation === 'header-command' && <div className="lp-activity" />}
      {nav.statusBar && (
        <div className={`lp-status${atlas ? ' lp-status-atlas' : ''}`}>
          <span className="lp-bar" />
          {atlas && (
            <span className="lp-tools">
              <span className="lp-dot" />
              <span className="lp-dot" />
              <span className="lp-dot" />
            </span>
          )}
        </div>
      )}
    </div>
  );
}

const Block = ({ cls = '' }: { cls?: string }) => <div className={`lp-block ${cls}`.trim()} />;

export function NavigationPreview({ resolved }: { resolved: ResolvedLayouts }) {
  return (
    <Frame resolved={resolved}>
      <div className="lp-view lp-view-nav">
        <Block />
        <Block />
        <Block cls="lp-block-small" />
      </div>
    </Frame>
  );
}

function WorkbenchBase() {
  return (
    <div className="lp-view lp-wb-base">
      <div className="lp-col lp-grow">
        <Block cls="lp-grow" />
        <Block cls="lp-block-small" />
      </div>
      <div className="lp-col lp-side">
        <Block />
        <Block />
      </div>
    </div>
  );
}

function WorkbenchOne() {
  return (
    <div className="lp-view lp-wb-one">
      <div className="lp-toolbar">
        <span className="lp-bar" />
        <span className="lp-chip" />
      </div>
      <Block cls="lp-grow" />
    </div>
  );
}

function RestBase() {
  return (
    <div className="lp-view lp-rest-base">
      <div className="lp-col lp-list">
        <span className="lp-bar" />
        <span className="lp-bar" />
        <span className="lp-bar" />
      </div>
      <div className="lp-col lp-grow">
        <Block cls="lp-grow" />
        <Block cls="lp-grow" />
      </div>
    </div>
  );
}

function RestPanes() {
  return (
    <div className="lp-view lp-rest-panes">
      {[0, 1, 2].map((i) => (
        <div key={i} className="lp-pane">
          <div className="lp-grip">
            <span className="lp-dot" />
          </div>
          <Block cls="lp-grow" />
        </div>
      ))}
    </div>
  );
}

function GitBase() {
  return (
    <div className="lp-view lp-git-base">
      <div className="lp-col lp-list">
        <span className="lp-bar" />
        <span className="lp-bar" />
        <span className="lp-bar" />
      </div>
      <Block cls="lp-grow" />
    </div>
  );
}

function GitReadThrough() {
  return (
    <div className="lp-view lp-git-rt">
      <div className="lp-col lp-index">
        <span className="lp-bar" />
        <span className="lp-bar" />
      </div>
      <div className="lp-col lp-grow lp-cards">
        <div className="lp-card lp-card-open">
          <span className="lp-bar" />
          <Block cls="lp-grow" />
        </div>
        <div className="lp-card">
          <span className="lp-bar" />
        </div>
        <div className="lp-card">
          <span className="lp-bar" />
        </div>
      </div>
      <div className="lp-drawer" />
    </div>
  );
}

export function ViewLayoutPreview({ view, layout, resolved }: { view: 'git' | 'workbench' | 'rest'; layout: string; resolved: ResolvedLayouts }) {
  let body: ReactNode;
  if (view === 'workbench') body = layout === 'one-surface' ? <WorkbenchOne /> : <WorkbenchBase />;
  else if (view === 'rest') body = layout === 'panes' ? <RestPanes /> : <RestBase />;
  else body = layout === 'read-through' ? <GitReadThrough /> : <GitBase />;
  return (
    <Frame resolved={resolved} compact>
      {body}
    </Frame>
  );
}
