import { expect, test } from 'bun:test';
import { createFakeClient } from './fake.ts';
import { answerDialog, applyCertPolicy, chooseOption, isLocalHost, selectAt, setFiles, watchDownloads, watchPage } from './page.ts';

test('selectAt returns the select node and its options', async () => {
  const options = [{ value: 'a', label: 'A', selected: true, disabled: false }];
  const client = createFakeClient({
    'DOM.getNodeForLocation': () => ({ backendNodeId: 4 }),
    'DOM.resolveNode': () => ({ object: { objectId: 'o1' } }),
    'Runtime.callFunctionOn': (p) => (p.returnByValue ? { result: { value: options } } : { result: { objectId: 'sel' } }),
  });
  const r = await selectAt(client.session('s'), 10.4, 20.6);
  expect(r).toEqual({ nodeRef: 'sel', options });
  expect(client.calls[0]!.params).toMatchObject({ x: 10, y: 21 });
});

test('selectAt returns null when the node is not inside a select', async () => {
  const client = createFakeClient({
    'DOM.getNodeForLocation': () => ({ backendNodeId: 4 }),
    'DOM.resolveNode': () => ({ object: { objectId: 'o1' } }),
    'Runtime.callFunctionOn': () => ({ result: { type: 'object', subtype: 'null', value: null } }),
  });
  expect(await selectAt(client.session('s'), 1, 1)).toBeNull();
});

test('selectAt falls back to elementFromPoint when getNodeForLocation fails', async () => {
  const client = createFakeClient({
    'DOM.getNodeForLocation': () => {
      throw new Error('no node');
    },
    'Runtime.evaluate': () => ({ result: { objectId: 'el' } }),
    'Runtime.callFunctionOn': () => ({ result: {} }),
  });
  expect(await selectAt(client.session('s'), 1, 2)).toBeNull();
  expect(client.calls.find((c) => c.method === 'Runtime.evaluate')!.params.expression).toContain('elementFromPoint(1, 2)');
  expect(client.calls.find((c) => c.method === 'Runtime.callFunctionOn')!.params.objectId).toBe('el');
});

test('chooseOption sets the value and dispatches input and change', async () => {
  const client = createFakeClient();
  await chooseOption(client.session('s'), 'sel', 'b');
  const p = client.calls[0]!.params;
  expect(p).toMatchObject({ objectId: 'sel', arguments: [{ value: 'b' }] });
  expect(p.functionDeclaration).toContain("'input'");
  expect(p.functionDeclaration).toContain("'change'");
});

test('dialogs and files map to the CDP calls', async () => {
  const client = createFakeClient();
  await answerDialog(client.session('s'), true, 'hi');
  await answerDialog(client.session('s'), false);
  await setFiles(client.session('s'), 9, ['C:/a.txt']);
  expect(client.calls[0]).toMatchObject({ method: 'Page.handleJavaScriptDialog', params: { accept: true, promptText: 'hi' } });
  expect(client.calls[1]!.params).toEqual({ accept: false });
  expect(client.calls[2]).toMatchObject({ method: 'DOM.setFileInputFiles', params: { files: ['C:/a.txt'], backendNodeId: 9 } });
});

test('watchPage forwards dialog and file chooser events', () => {
  const client = createFakeClient();
  const seen: any[] = [];
  const off = watchPage(client.session('s'), { onDialog: (d) => seen.push(d), onFileChooser: (f) => seen.push(f) });
  expect(client.calls[0]).toMatchObject({ method: 'Page.setInterceptFileChooserDialog', params: { enabled: true } });
  client.emit('Page.javascriptDialogOpening', { type: 'prompt', message: 'm', url: 'u', defaultPrompt: 'd' }, 's');
  client.emit('Page.fileChooserOpened', { backendNodeId: 3, mode: 'selectMultiple' }, 's');
  expect(seen).toEqual([
    { type: 'prompt', message: 'm', url: 'u', defaultPrompt: 'd' },
    { backendNodeId: 3, multiple: true },
  ]);
  off();
  client.emit('Page.fileChooserOpened', { backendNodeId: 4, mode: 'selectSingle' }, 's');
  expect(seen).toHaveLength(2);
});

test('watchDownloads sets allowAndName and reports lifecycle', async () => {
  const client = createFakeClient();
  const seen: any[] = [];
  await watchDownloads(client, { downloadPath: 'C:/dl' }, (e) => seen.push(e));
  expect(client.calls[0]).toMatchObject({ method: 'Browser.setDownloadBehavior', params: { behavior: 'allowAndName', downloadPath: 'C:/dl', eventsEnabled: true } });
  client.emit('Browser.downloadWillBegin', { guid: 'g', url: 'http://x/f.zip', suggestedFilename: 'f.zip' });
  client.emit('Browser.downloadProgress', { guid: 'g', state: 'completed', receivedBytes: 5, totalBytes: 5 });
  expect(seen.map((e) => e.state)).toEqual(['started', 'completed']);
  expect(seen[1]).toMatchObject({ suggestedFilename: 'f.zip', receivedBytes: 5 });
});

test('certificate errors are ignored only for local hosts when enabled', async () => {
  const client = createFakeClient();
  expect(isLocalHost('https://localhost:5173/x')).toBe(true);
  expect(isLocalHost('https://127.0.0.1/')).toBe(true);
  expect(isLocalHost('https://example.com/')).toBe(false);
  expect(isLocalHost('not a url')).toBe(false);
  expect(await applyCertPolicy(client, 'https://localhost/', true)).toBe(true);
  expect(await applyCertPolicy(client, 'https://localhost/', false)).toBe(false);
  expect(await applyCertPolicy(client, 'https://example.com/', true)).toBe(false);
  expect(client.calls.map((c) => c.params.ignore)).toEqual([true, false, false]);
});
