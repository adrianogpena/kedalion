import type { Lang } from './languages';
import { effectiveName, LOG_NAME } from '@kedalion/ui/file-associations';

const extOf = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
};

const LANG_BY_EXT: Record<string, Lang> = {
  sql: 'sql', pls: 'sql', pkb: 'sql', pks: 'sql', json: 'json', jsonc: 'json', java: 'java', sh: 'shell', bash: 'shell', curl: 'shell', http: 'shell',
  md: 'markdown', markdown: 'markdown',
  xml: 'xml', xsd: 'xml', xsl: 'xml', xslt: 'xml', wsdl: 'xml', pom: 'xml', plist: 'xml', csproj: 'xml', fxml: 'xml',
  html: 'html', htm: 'html', xhtml: 'html',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'typescript',
  css: 'css', py: 'python', yaml: 'yaml', yml: 'yaml', toml: 'toml', properties: 'properties', ini: 'properties', cfg: 'properties', conf: 'properties',
  rs: 'rust', go: 'go', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp', kt: 'kotlin', kts: 'kotlin',
  diff: 'diff', patch: 'diff', dockerfile: 'dockerfile',
  pgsql: 'sql', mssql: 'sql', tsql: 'sql', tfvars: 'properties', envrc: 'shell',
};

/** The editor language for a file name, by extension. */
export function langOfFile(name: string): Lang {
  return langOfEffective(effectiveName(name));
}

function langOfEffective(name: string): Lang {
  const lower = name.toLowerCase();
  if (lower === 'dockerfile' || lower.startsWith('dockerfile.')) return 'dockerfile';
  if (lower === '.env' || lower.startsWith('.env.')) return 'properties';
  return LANG_BY_EXT[extOf(name)] ?? 'text';
}

export type PreviewKind =
  | 'markdown' | 'json' | 'html' | 'code' | 'image' | 'svg' | 'pdf' | 'archive' | 'log' | 'text'
  | 'audio' | 'video' | 'table' | 'font' | 'notebook' | 'har' | 'sqlite' | 'hex' | 'env';

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico']);
const ARCHIVE_EXTS = new Set([
  'zip', '7z', 'rar', 'tar', 'gz', 'tgz', 'bz2', 'tbz2', 'xz', 'txz', 'lzma', 'zst', 'iso', 'cab', 'jar', 'war', 'whl', 'nupkg', 'apk',
  'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'epub',
]);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus']);
const VIDEO_EXTS = new Set(['mp4', 'm4v', 'webm', 'mov', 'mkv', 'avi']);
const FONT_EXTS = new Set(['ttf', 'otf', 'woff', 'woff2']);
const HEX_EXTS = new Set(['class', 'exe', 'dll', 'so', 'dylib', 'bin', 'msi', 'o', 'obj', 'dat', 'pyc']);
const SQLITE_EXTS = new Set(['sqlite', 'sqlite3', 'db', 'db3']);

/** How FilePreview shows a file: images need its bytes (`/api/fs/raw`), the rest its text. */
export function previewKind(original: string): PreviewKind {
  const name = effectiveName(original);
  if (LOG_NAME.test(name)) return 'log';
  const lower = name.toLowerCase();
  if (lower === '.env' || lower.startsWith('.env.') || lower.endsWith('.env')) return 'env';
  const ext = extOf(name);
  if (ext === 'csv' || ext === 'tsv') return 'table';
  if (ext === 'ipynb') return 'notebook';
  if (ext === 'har') return 'har';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (FONT_EXTS.has(ext)) return 'font';
  if (HEX_EXTS.has(ext)) return 'hex';
  if (SQLITE_EXTS.has(ext)) return 'sqlite';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (ext === 'svg') return 'svg';
  if (ext === 'pdf') return 'pdf';
  if (ARCHIVE_EXTS.has(ext)) return 'archive';
  const lang = langOfEffective(name);
  if (lang === 'markdown' || lang === 'json' || lang === 'html') return lang;
  return lang === 'text' ? 'text' : 'code';
}
