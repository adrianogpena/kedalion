import type { Emulation } from '@kedalion/cdp';

export interface DevicePreset {
  id: string;
  name: string;
  width: number;
  height: number;
  dpr: number;
  mobile: boolean;
  userAgent?: string;
}

export const DEVICE_PRESETS: readonly DevicePreset[] = [
  {
    id: 'iphone-14',
    name: 'iPhone 14',
    width: 390,
    height: 844,
    dpr: 3,
    mobile: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  },
  {
    id: 'pixel-7',
    name: 'Pixel 7',
    width: 412,
    height: 915,
    dpr: 2.625,
    mobile: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  },
  {
    id: 'ipad-air',
    name: 'iPad Air',
    width: 820,
    height: 1180,
    dpr: 2,
    mobile: true,
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  },
  { id: 'laptop', name: 'Laptop 1280×800', width: 1280, height: 800, dpr: 1, mobile: false },
];

/** The emulation of a preset. */
export function presetEmulation(p: DevicePreset): Emulation {
  return { preset: p.id, width: p.width, height: p.height, dpr: p.dpr, mobile: p.mobile, ...(p.userAgent ? { userAgent: p.userAgent } : {}) };
}

export const isEmulating = (e: Emulation | undefined): boolean => !!e && Object.values(e).some((v) => v !== undefined && v !== '');
