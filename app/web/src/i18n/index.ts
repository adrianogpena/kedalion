import { sqlEn, sqlPtBR } from '@kedalion/sql-ui';
import { addMessages, createT } from '@kedalion/ui';
import type { BrowserMessageKey } from '@kedalion/view-browser/web';
import type { ExplorerMessageKey } from '@kedalion/view-explorer/web';
import type { GitMessageKey } from '@kedalion/view-git/web';
import type { GridMessageKey } from '@kedalion/view-grid/web';
import type { RestMessageKey } from '@kedalion/view-rest/web';
import type { TerminalMessageKey } from '@kedalion/view-terminal/web';
import type { WorkbenchMessageKey } from '@kedalion/view-workbench/web';
import { en } from './en';
import { ptBR } from './pt-BR';

// The views add their own messages in views.ts; terminal ones are typed here for the Settings modal.
addMessages({ en, 'pt-BR': ptBR });
addMessages({ en: sqlEn, 'pt-BR': sqlPtBR });

export type MessageKey = keyof typeof en | TerminalMessageKey | WorkbenchMessageKey | RestMessageKey | GitMessageKey | GridMessageKey | ExplorerMessageKey | BrowserMessageKey;
export const t = createT<MessageKey>();
