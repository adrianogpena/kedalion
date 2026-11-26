import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';
import { defineSource, SourceError } from '../../server';

export interface FolderList {
  /** The listed folder, absolute. */
  path: string;
  /** Its parent; empty at a filesystem root. */
  parent: string;
  /** Names of the subfolders, sorted. */
  dirs: string[];
}

/** The subfolders of an absolute `path` (the home folder when empty): names only, no file contents. */
export async function listFolders(path: string): Promise<FolderList> {
  const dir = path.trim() === '' ? homedir() : path.trim();
  if (!isAbsolute(dir)) throw SourceError('upstream', 'The path must be absolute.');
  const abs = resolve(dir);
  let entries;
  try {
    entries = await readdir(abs, { withFileTypes: true });
  } catch {
    throw SourceError('upstream', 'Could not read the folder.');
  }
  const parent = dirname(abs);
  return {
    path: abs,
    parent: parent === abs ? '' : parent,
    dirs: entries.filter((e) => e.isDirectory()).map((e) => e.name).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
  };
}

export const foldersSource = defineSource<{ path: string }>({
  id: 'folders',
  fields: [{ key: 'path', kind: 'string', label: 'grid.field.folder.pick', default: '', maxLength: 500 }],
  fetch: (config) => listFolders(typeof config.path === 'string' ? config.path : ''),
});
