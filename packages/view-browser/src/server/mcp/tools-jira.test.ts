import { expect, test } from 'bun:test';
import { deflateRawSync } from 'node:zlib';
import { attachmentFamily, type Attachment, docxText, newestPerFamily } from './tools-jira.ts';

const att = (id: string, filename: string, created: string, mimeType = 'application/octet-stream'): Attachment => ({ id, filename, mimeType, size: 1, created });

test('versions, copies and reviewed variants of one document share a family', () => {
  const names = ['FA_PCR#115_Late Payment_V.1.docx', 'FA_PCR115_Late Payment_V.3 Reviewed VWFS.docx', 'FA_PCR115_Late Payment_V.4 (1).docx', 'FA_PCR115_Late Payment_V.4 (56db76af-3e45-48f4-849e-db7ac26c28a7).docx', 'FA_PCR115_Late Payment_V.5-1.docx'];
  expect(new Set(names.map(attachmentFamily)).size).toBe(1);
  expect(attachmentFamily('FA_PCR115_Late Payment_V.5.pdf')).not.toBe(attachmentFamily('FA_PCR115_Late Payment_V.5.docx'));
  expect(attachmentFamily('Feature Draft Bulk Changes_v1.pdf')).not.toBe(attachmentFamily('FAL GEA - Feature_Draft.pdf'));
});

test('the newest upload of a family wins, by date then id; images stay apart', () => {
  const list = [att('1', 'Spec_V.1.docx', '2026-05-20T14:31'), att('3', 'Spec_V.4 (1).docx', '2026-10-05T15:47'), att('2', 'Spec_V.5.docx', '2026-10-06T11:40'), att('4', 'a.png', '2026-02-20T09:21', 'image/png'), att('5', 'b.png', '2026-10-05T11:46', 'image/png')];
  const fams = newestPerFamily(list);
  expect(fams.map((f) => f.newest.id)).toEqual(['2', '5', '4']);
  expect(fams[0]!.older.map((o) => o.id)).toEqual(['3', '1']);
});

test('docxText reads paragraphs and table cells from the zip', () => {
  const xml = '<w:document><w:p><w:r><w:t>Title</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:t>A &amp; B</w:t></w:p></w:tc><w:tc><w:p><w:t>C</w:t></w:p></w:tc></w:tr></w:tbl></w:document>';
  const name = Buffer.from('word/document.xml');
  const data = deflateRawSync(Buffer.from(xml));
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(local.length + name.length + data.length, 16);
  const zip = Buffer.concat([local, name, data, central, name, end]);
  expect(docxText(zip)).toBe('Title\nA & B | C');
});
