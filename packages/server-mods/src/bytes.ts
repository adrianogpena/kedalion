const MAGICS = [
  [0x25, 0x50, 0x44, 0x46, 0x2d], // "%PDF-"
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], // PNG
  [0x50, 0x4b, 0x03, 0x04], // ZIP
  [0x1f, 0x8b], // GZIP
  [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], // 7z
];

/** True when the first 8 KiB holds a NUL byte, which text files don't, or the bytes start a known binary format (PDF, PNG, ZIP, GZIP, 7z). */
export const isBinary = (bytes: Uint8Array) =>
  MAGICS.some((magic) => magic.every((b, i) => bytes[i] === b)) || bytes.subarray(0, 8192).includes(0);
