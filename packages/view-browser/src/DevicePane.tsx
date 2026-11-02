import { useEffect, useState } from 'react';
import type { Emulation } from '@kedalion/cdp';
import { Button } from '@kedalion/ui';
import { browserApi } from './client';
import { DEVICE_PRESETS, isEmulating, presetEmulation } from './devices';
import { t } from './i18n';

export interface DevicePaneProps {
  tab: string;
  emulation: Emulation;
}

const num = (s: string): number | undefined => {
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** Device size, pixel ratio, user agent, locale and timezone of the tab. */
export function DevicePane({ tab, emulation }: DevicePaneProps) {
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [dpr, setDpr] = useState('');
  const [mobile, setMobile] = useState(false);
  const [userAgent, setUserAgent] = useState('');
  const [locale, setLocale] = useState('');
  const [timezone, setTimezone] = useState('');

  useEffect(() => {
    setWidth(emulation.width ? String(emulation.width) : '');
    setHeight(emulation.height ? String(emulation.height) : '');
    setDpr(emulation.dpr ? String(emulation.dpr) : '');
    setMobile(!!emulation.mobile);
    setUserAgent(emulation.userAgent ?? '');
    setLocale(emulation.locale ?? '');
    setTimezone(emulation.timezone ?? '');
  }, [emulation]);

  const send = (e: Emulation) => void browserApi.setEmulation(tab, e).catch(() => {});
  const apply = () => {
    const w = num(width);
    const h = num(height);
    send({
      ...(emulation.preset && w === emulation.width && h === emulation.height ? { preset: emulation.preset } : {}),
      ...(w && h ? { width: w, height: h, dpr: num(dpr) ?? 1, mobile } : {}),
      ...(userAgent.trim() ? { userAgent: userAgent.trim() } : {}),
      ...(locale.trim() ? { locale: locale.trim() } : {}),
      ...(timezone.trim() ? { timezone: timezone.trim() } : {}),
    });
  };

  return (
    <div className="browser-pane">
      <div className="browser-pane-bar">
        <div className="browser-chips" role="group" aria-label={t('browser.device.presets')}>
          <Button size="xs" pressed={!isEmulating(emulation)} onClick={() => send({})}>{t('browser.device.none')}</Button>
          {DEVICE_PRESETS.map((p) => (
            <Button key={p.id} size="xs" pressed={emulation.preset === p.id} onClick={() => send(presetEmulation(p))}>{p.name}</Button>
          ))}
        </div>
      </div>
      <div className="device-form">
        <label>{t('browser.device.width')}<input type="text" inputMode="numeric" value={width} onChange={(e) => setWidth(e.target.value)} /></label>
        <label>{t('browser.device.height')}<input type="text" inputMode="numeric" value={height} onChange={(e) => setHeight(e.target.value)} /></label>
        <label>{t('browser.device.dpr')}<input type="text" inputMode="decimal" value={dpr} onChange={(e) => setDpr(e.target.value)} /></label>
        <label className="cookie-check"><input type="checkbox" checked={mobile} onChange={(e) => setMobile(e.target.checked)} />{t('browser.device.mobile')}</label>
        <label className="device-wide">{t('browser.device.userAgent')}<input type="text" spellCheck={false} value={userAgent} onChange={(e) => setUserAgent(e.target.value)} /></label>
        <label>{t('browser.device.locale')}<input type="text" spellCheck={false} placeholder="pt-BR" value={locale} onChange={(e) => setLocale(e.target.value)} /></label>
        <label>{t('browser.device.timezone')}<input type="text" spellCheck={false} placeholder="America/Sao_Paulo" value={timezone} onChange={(e) => setTimezone(e.target.value)} /></label>
        <Button size="sm" variant="primary" onClick={apply}>{t('browser.device.apply')}</Button>
        <Button size="sm" disabled={!isEmulating(emulation)} onClick={() => send({})}>{t('browser.device.reset')}</Button>
      </div>
    </div>
  );
}
