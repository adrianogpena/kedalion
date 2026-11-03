import type { CommandDef } from '@kedalion/ui';
import { t } from './i18n';

export const restCommands = (): CommandDef[] => [
  { id: 'rest.save', scope: 'rest', label: t('keys.rest.save'), keys: ['Ctrl+S'], inInput: true },
  { id: 'rest.pinBaseline', scope: 'rest', label: t('keys.rest.pinBaseline'), keys: [] },
  { id: 'rest.toggleDiff', scope: 'rest', label: t('keys.rest.toggleDiff'), keys: [] },
];
