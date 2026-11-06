import { join } from 'node:path';
import { defineServerView, type Routes } from '@kedalion/server-core';
import { connectionRoutes } from '../connections/routes';
import { callbackRoutes, checkSources, kindSpecsOf, sourceRoutes, type DataSource, type GridNotifications, type GridPanelSpec, type SourceContext } from '../server';
import { validDashboardLayouts, validDashboardPresets, type DashboardLayouts, type DashboardPreset } from './model';

/** The part of the server settings the Dashboard view owns; the app's `Settings` extends it. */
export interface DashboardServerSettings {
  /** Named layouts and the active one, checked by `validDashboardLayouts`. */
  dashboardLayouts?: DashboardLayouts;
  /** Saved panel presets, checked by `validDashboardPresets`. */
  dashboardPresets?: DashboardPreset[];
}

export interface DashboardServerOptions {
  /** Every panel kind the dashboard can hold. */
  panels: readonly GridPanelSpec[];
  /** Data sources behind `POST /api/grid/source/<id>`. */
  sources?: readonly DataSource<any>[];
  /** Toasts for sources (`ctx.notify`). */
  notifications?: GridNotifications;
}

/** Server half of the Dashboard view: validates `dashboardLayouts` and `dashboardPresets` and serves the data sources. */
export function dashboardServerView({ panels, sources = [], notifications }: DashboardServerOptions) {
  const specs = kindSpecsOf(panels);
  checkSources(sources, 'dashboard');
  return defineServerView<DashboardServerSettings>({
    id: 'dashboard',
    icon: 'cube',
    routes: (ctx): Routes => ({ ...sourceRoutes(sources, ctx.dataDir, notifications, ctx.stores.projectRoots as SourceContext['projectRoots'], typeof ctx.stores.home === 'string' ? join(ctx.stores.home, 'tickets') : undefined), ...connectionRoutes(ctx.dataDir) }),
    unauthenticated: (ctx): Routes => callbackRoutes(sources, ctx.dataDir),
    settings: {
      validate: {
        dashboardLayouts: (raw) => validDashboardLayouts(raw, specs),
        dashboardPresets: (raw) => validDashboardPresets(raw, specs),
      },
    },
  });
}
