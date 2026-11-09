import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { emptySidebar, type SidebarData, validSidebar } from './sidebar-types.ts';

export interface SidebarStore {
  read(): SidebarData;
  /** False when the data is invalid or the write failed. */
  write(d: SidebarData): boolean;
}

/** The Terminal sidebar lists (saved paths and commands) kept in one JSON file. */
export function createSidebarStore(file: string): SidebarStore {
  return {
    read() {
      try {
        return validSidebar(JSON.parse(readFileSync(file, 'utf8'))) ?? emptySidebar();
      } catch {
        return emptySidebar();
      }
    },
    write(d) {
      const valid = validSidebar(d);
      if (!valid) return false;
      try {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify(valid, null, 2));
        return true;
      } catch {
        return false;
      }
    },
  };
}
