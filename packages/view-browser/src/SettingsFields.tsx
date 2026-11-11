import { useState } from 'react';
import { Button, SettingItem, type SettingsFieldProps } from '@kedalion/ui';
import { browserApi } from './client';
import { t } from './i18n';
import type { BrowserViewSettings } from './settings';

/** The row of `browser.regenerateSecret`: replaces the MCP bearer secret, so MCP configs written earlier stop working. */
export function RegenerateSecretField({ def }: SettingsFieldProps<BrowserViewSettings>) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const run = async () => {
    setBusy(true);
    setDone(false);
    try {
      await browserApi.regenerateMcpSecret();
      setDone(true);
    } catch {
      setDone(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingItem id={def.id} modified={false}>
      <div className="field">
        <span className="mono-label">{t('settings.browser.regenerateSecret')}</span>
        <span className="muted">{t(done ? 'settings.browser.regenerateSecret.done' : 'settings.browser.regenerateSecret.hint')}</span>
        <Button size="xs" disabled={busy} onClick={() => void run()}>{t('settings.browser.regenerateSecret.button')}</Button>
      </div>
    </SettingItem>
  );
}
