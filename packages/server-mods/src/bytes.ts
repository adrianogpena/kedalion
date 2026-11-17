const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

/** True when the first 8 KiB holds a NUL byte, which text files don't, or the bytes start a PDF. */
export const isBinary = (bytes: Uint8Array) =>
  PDF_MAGIC.every((b, i) => bytes[i] === b) || bytes.subarray(0, 8192).includes(0);
