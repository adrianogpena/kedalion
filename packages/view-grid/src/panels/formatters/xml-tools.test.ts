import { describe, expect, test } from 'bun:test';
import { formatXml, minifyXml, validateXml } from './xml-tools';

describe('xml-tools', () => {
  test('format indents and keeps text-only elements inline', () => {
    expect(formatXml('<?xml version="1.0"?><a x="1"><b>hi</b><c/><!-- n --></a>')).toEqual({
      ok: true,
      text: '<?xml version="1.0"?>\n<a x="1">\n  <b>hi</b>\n  <c/>\n  <!-- n -->\n</a>',
    });
  });

  test('minify drops whitespace between tags', () => {
    expect(minifyXml('<a>\n  <b> hi </b>\n</a>')).toEqual({ ok: true, text: '<a><b>hi</b></a>' });
  });

  test('validate reports the position of a mismatch', () => {
    const r = validateXml('<a>\n<b></a>');
    expect(r).toMatchObject({ ok: false, line: 2, col: 4 });
  });

  test('validate rejects a second root and unquoted attributes', () => {
    expect(validateXml('<a/><b/>').ok).toBe(false);
    expect(validateXml('<a x=1/>').ok).toBe(false);
    expect(validateXml('<a x="1"/>').ok).toBe(true);
  });
});
