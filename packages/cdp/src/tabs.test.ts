import { expect, test } from 'bun:test';
import { createFakeClient } from './fake.ts';
import { createTabs } from './tabs.ts';

const setup = () => {
  let n = 0;
  const client = createFakeClient({
    'Target.attachToTarget': (p) => ({ sessionId: `s-${p.targetId}` }),
    'Target.createTarget': () => ({ targetId: `t${++n}` }),
    'Page.getNavigationHistory': () => ({ currentIndex: 1, entries: [{ id: 10 }, { id: 11 }, { id: 12 }] }),
  });
  return client;
};

test('attaches existing page targets and enables domains', async () => {
  const client = setup();
  client.handlers['Target.setDiscoverTargets'] = () => {
    client.emit('Target.targetCreated', { targetInfo: { targetId: 'a', type: 'page', url: 'about:blank', title: '' } });
    client.emit('Target.targetCreated', { targetInfo: { targetId: 'w', type: 'service_worker', url: '' } });
  };
  const tabs = await createTabs(client);
  expect(tabs.list().map((t) => t.id)).toEqual(['a']);
  expect(tabs.active()).toBe('a');
  expect(client.methods('s-a')).toEqual(expect.arrayContaining(['Page.enable', 'Runtime.enable', 'Network.enable', 'Log.enable', 'DOM.enable']));
  expect(tabs.list()[0]!.canGoBack).toBe(true);
  expect(tabs.list()[0]!.canGoForward).toBe(true);
});

test('open creates, attaches once and activates', async () => {
  const client = setup();
  const tabs = await createTabs(client);
  const seen: string[] = [];
  tabs.on('activated', (id) => seen.push(id));
  const tab = await tabs.open('https://a.test');
  expect(tab.id).toBe('t1');
  expect(client.methods().filter((m) => m === 'Target.attachToTarget')).toHaveLength(1);
  expect(client.calls.some((c) => c.method === 'Target.activateTarget')).toBe(true);
  expect(seen).toEqual(['t1']);
});

test('popups with an opener become tabs and active', async () => {
  const client = setup();
  const tabs = await createTabs(client);
  await tabs.open('https://a.test');
  const added: string[] = [];
  tabs.on('tab', (t) => added.push(t.id));
  client.emit('Target.targetCreated', { targetInfo: { targetId: 'pop', type: 'page', url: 'x', openerId: 't1' } });
  await new Promise((r) => setTimeout(r, 5));
  expect(added).toContain('pop');
  expect(tabs.active()).toBe('pop');
  expect(tabs.list().find((t) => t.id === 'pop')!.openerId).toBe('t1');
});

test('close removes the tab and moves the active one', async () => {
  const client = setup();
  const tabs = await createTabs(client);
  await tabs.open('https://a.test');
  await tabs.open('https://b.test');
  const closed: string[] = [];
  tabs.on('closed', (id) => closed.push(id));
  await tabs.close('t2');
  expect(closed).toEqual(['t2']);
  expect(tabs.active()).toBe('t1');
  client.emit('Target.targetDestroyed', { targetId: 't2' });
  expect(closed).toEqual(['t2']);
});

test('loading, url and title updates are pushed', async () => {
  const client = setup();
  const tabs = await createTabs(client);
  await tabs.open('https://a.test');
  client.emit('Page.frameStartedLoading', { frameId: 'f' }, 's-t1');
  expect(tabs.list()[0]!.loading).toBe(true);
  client.emit('Page.frameNavigated', { frame: { url: 'https://b.test' } }, 's-t1');
  client.emit('Page.frameNavigated', { frame: { url: 'https://sub.test', parentId: 'p' } }, 's-t1');
  client.emit('Target.targetInfoChanged', { targetInfo: { targetId: 't1', url: 'https://b.test', title: 'B' } });
  client.emit('Page.frameStoppedLoading', { frameId: 'f' }, 's-t1');
  expect(tabs.list()[0]).toMatchObject({ loading: false, url: 'https://b.test', title: 'B' });
});

test('back, forward and navigation use the history', async () => {
  const client = setup();
  const tabs = await createTabs(client);
  await tabs.open('https://a.test');
  await tabs.back('t1');
  await tabs.forward('t1');
  await tabs.navigate('t1', 'https://c.test');
  await tabs.reload('t1');
  await tabs.stop('t1');
  const entries = client.calls.filter((c) => c.method === 'Page.navigateToHistoryEntry').map((c) => c.params.entryId);
  expect(entries).toEqual([10, 12]);
  expect(client.calls.find((c) => c.method === 'Page.navigate')).toMatchObject({ params: { url: 'https://c.test' }, sessionId: 's-t1' });
  expect(client.methods()).toEqual(expect.arrayContaining(['Page.reload', 'Page.stopLoading']));
});

test('unknown tab ids throw', async () => {
  const tabs = await createTabs(setup());
  expect(() => tabs.session('nope')).toThrow();
});
