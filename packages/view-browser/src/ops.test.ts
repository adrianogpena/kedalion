import { expect, test } from 'bun:test';
import { diffRuns, type Step } from './server/mcp/steps.ts';
import { decodeOperations, prettyBody, summarizeRequest } from './ops.ts';

const xml =
  '<transaction xsi:type="xsd:Object" xmlns:xsi="http://www.w3.org/2000/10/XMLSchema-instance"><transactionNum>3</transactionNum><operations xsi:type="xsd:List">' +
  '<elem xsi:type="xsd:Object"><operation>ISystemRepositoryOutpost.getConfigurationProperties</operation><values xsi:type="xsd:Object"><scope>GLOBAL</scope><limit>20</limit></values></elem>' +
  '<elem xsi:type="xsd:Object"><operation>IUserOutpost.getCurrentUser</operation><values xsi:type="xsd:Object"></values></elem>' +
  '</operations></transaction>';
const body = `_transaction=${encodeURIComponent(xml)}`;
const url = 'https://miles.test/app/sc/IDACall?isc_rpc=1&isc_v=1';

test('decodeOperations lists operations and args', () => {
  expect(decodeOperations(body)).toEqual([
    { operation: 'ISystemRepositoryOutpost.getConfigurationProperties', args: 'scope=GLOBAL, limit=20' },
    { operation: 'IUserOutpost.getCurrentUser', args: '' },
  ]);
});

test('decodeOperations caps long args and handles plain XML', () => {
  const long = `<operation>A.b</operation><values><x>${'y'.repeat(500)}</x></values>`;
  const [op] = decodeOperations(long);
  expect(op!.args.length).toBeLessThanOrEqual(160);
  expect(decodeOperations('nothing here')).toEqual([]);
});

test('summarizeRequest', () => {
  expect(summarizeRequest({ method: 'POST', url, postData: body })).toBe('IDACall: ISystemRepositoryOutpost.getConfigurationProperties +1');
  expect(summarizeRequest({ url, postData: '' })).toBe('');
});

test('prettyBody decodes form XML and indents', () => {
  const out = prettyBody(body, 'application/x-www-form-urlencoded');
  expect(out.startsWith('_transaction=\n<transaction')).toBe(true);
  expect(out).toContain('\n      <operation>IUserOutpost.getCurrentUser</operation>');
  expect(out).toContain('<scope>GLOBAL</scope>');
});

test('prettyBody json and passthrough', () => {
  expect(prettyBody('{"a":1}', 'application/json')).toBe('{\n  "a": 1\n}');
  expect(prettyBody('{bad', 'application/json')).toBe('{bad');
  expect(prettyBody('plain', 'text/plain')).toBe('plain');
});

const step = (n: number, over: Partial<Step> = {}): Step => ({ n, tool: 'browser_click', args: '{"selector":"#a"}', ok: true, ms: 5, at: '', result: 'Clicked', requests: ['POST 200 /x'], consoleErrors: 0, ...over });

test('diffRuns reports differing results, requests and extra steps', () => {
  expect(diffRuns([step(1)], [step(2)])).toBe('No differences in 1 step.');
  const out = diffRuns([step(1), step(2)], [step(3, { result: 'Failed', requests: ['POST 500 /x'], consoleErrors: 2 })]);
  expect(out).toContain('result a="Clicked" b="Failed"');
  expect(out).toContain('console errors a=0 b=2');
  expect(out).toContain('request only in a: POST 200 /x');
  expect(out).toContain('request only in b: POST 500 /x');
  expect(out).toContain('step 2: only in a');
});
