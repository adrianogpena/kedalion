import { request } from '@kedalion/ui';
import type { SidebarData } from './sidebar-types.ts';

export const getSidebar = (): Promise<SidebarData> => request<SidebarData>('GET', '/api/terminal/sidebar');

export const putSidebar = (d: SidebarData): Promise<{ ok: boolean }> =>
  request<{ ok: boolean }>('PUT', '/api/terminal/sidebar', {}, d);
