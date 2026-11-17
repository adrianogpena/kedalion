// Idea from filebrowser's CheckWindowsHidden (https://github.com/gtsteffaniak/filebrowser,
// backend/pkg/indexing/windows.go), Apache-2.0. Changes: TypeScript over bun:ffi, kernel32 opened once.

const FILE_ATTRIBUTE_HIDDEN = 0x2;
const FILE_ATTRIBUTE_SYSTEM = 0x4;
const INVALID_FILE_ATTRIBUTES = 0xffffffff;

type GetAttributes = (path: Buffer) => number;
let getAttributes: GetAttributes | null | undefined;

function attributesFn(): GetAttributes | null {
  if (getAttributes !== undefined) return getAttributes;
  try {
    const { dlopen, FFIType } = require('bun:ffi') as typeof import('bun:ffi');
    const kernel32 = dlopen('kernel32.dll', { GetFileAttributesW: { args: [FFIType.ptr], returns: FFIType.u32 } });
    getAttributes = (path) => kernel32.symbols.GetFileAttributesW(path) as number;
  } catch {
    getAttributes = null;
  }
  return getAttributes;
}

/** True on Windows when the entry has the Hidden or System attribute (what Explorer hides); false elsewhere or on error. */
export function isWindowsHidden(path: string): boolean {
  if (process.platform !== 'win32') return false;
  const fn = attributesFn();
  if (!fn) return false;
  const attrs = fn(Buffer.from(`${path}\0`, 'utf16le')) >>> 0;
  return attrs !== INVALID_FILE_ATTRIBUTES && (attrs & (FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM)) !== 0;
}
