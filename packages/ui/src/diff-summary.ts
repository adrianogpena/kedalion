const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'tif', 'tiff', 'avif', 'heic', 'psd',
  'pdf', 'zip', '7z', 'rar', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'jar', 'war', 'whl', 'nupkg', 'apk',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'epub',
  'mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus', 'mp4', 'm4v', 'webm', 'mov', 'mkv', 'avi',
  'ttf', 'otf', 'woff', 'woff2', 'eot',
  'exe', 'dll', 'so', 'dylib', 'bin', 'msi', 'o', 'obj', 'a', 'lib', 'class', 'pyc', 'wasm',
  'sqlite', 'sqlite3', 'db', 'db3', 'iso', 'dat',
]);

/** True when the file name's extension is one of a known binary format. */
export function isBinaryExtension(path: string): boolean {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 && BINARY_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

export type FileStatus = 'A' | 'D' | 'R' | 'M';

export interface FileSummary {
  path: string;
  /** Previous path of a rename. */
  oldPath?: string;
  status: FileStatus;
  added: number;
  deleted: number;
  binary: boolean;
}

function headerPath(rest: string): string {
  const len = (rest.length - 3) / 2;
  if (Number.isInteger(len) && len > 0 && rest.slice(len, len + 3) === ' b/') return rest.slice(0, len);
  const i = rest.indexOf(' b/');
  return i < 0 ? rest : rest.slice(0, i);
}

/** One summary per file of a multi-file unified diff (A/D/R/M, +/- line counts); hunk bodies are counted by position, not by `---`/`+++` text. */
export function summarizeDiff(text: string): FileSummary[] {
  const out: FileSummary[] = [];
  let cur: FileSummary | null = null;
  let oldLeft = 0;
  let newLeft = 0;
  let inHunk = false;
  let renameTo: string | undefined;
  for (const raw of text.split('\n')) {
    if (inHunk && (oldLeft > 0 || newLeft > 0) && cur) {
      if (raw.startsWith('+')) {
        cur.added++;
        newLeft--;
        continue;
      }
      if (raw.startsWith('-')) {
        cur.deleted++;
        oldLeft--;
        continue;
      }
      if (raw.startsWith(' ') || raw === '') {
        oldLeft--;
        newLeft--;
        continue;
      }
      if (raw.startsWith('\\')) continue;
    }
    if (raw.startsWith('diff --git a/')) {
      const path = headerPath(raw.slice('diff --git a/'.length));
      cur = { path, status: 'M', added: 0, deleted: 0, binary: isBinaryExtension(path) };
      out.push(cur);
      inHunk = false;
      renameTo = undefined;
      continue;
    }
    if (!cur) continue;
    if (raw.startsWith('@@')) {
      const h = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(raw);
      if (h) {
        oldLeft = h[1] === undefined ? 1 : Number(h[1]);
        newLeft = h[2] === undefined ? 1 : Number(h[2]);
        inHunk = true;
      }
    } else if (!inHunk) {
      if (raw.startsWith('new file mode')) cur.status = 'A';
      else if (raw.startsWith('deleted file mode')) cur.status = 'D';
      else if (raw.startsWith('rename from ')) {
        cur.status = 'R';
        cur.oldPath = raw.slice('rename from '.length);
      } else if (raw.startsWith('rename to ')) {
        renameTo = raw.slice('rename to '.length);
        cur.path = renameTo;
      } else if (raw.startsWith('Binary files ') || raw.startsWith('GIT binary patch')) cur.binary = true;
    }
  }
  return out;
}
