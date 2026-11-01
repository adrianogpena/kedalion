// Manual discovery tool: `bun packages/cdp/scripts/discover.ts`. Not a test.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findAppBrowser } from '@kedalion/platform';
import { connectCdp } from '../src/client.ts';
import { launchBrowser } from '../src/launch.ts';

const exe = findAppBrowser();
console.log('exe:', exe);
const profileDir = mkdtempSync(join(tmpdir(), 'kedalion-cdp-'));
const allowOrigin = 'http://127.0.0.1:1234';
const t0 = Date.now();
const browser = await launchBrowser({ profileDir, allowOrigin });
console.log('port:', browser.port, `(port file after ${Date.now() - t0} ms)`);
try {
  const version = await (await fetch(`http://127.0.0.1:${browser.port}/json/version`)).json();
  console.log('version:', (version as any).Browser, (version as any).webSocketDebuggerUrl);

  const originWs = new (WebSocket as any)(browser.wsUrl, { headers: { Origin: allowOrigin } }) as WebSocket;
  const originOk = await new Promise<boolean>((resolve) => {
    originWs.addEventListener('open', () => resolve(true));
    originWs.addEventListener('error', () => resolve(false));
  });
  console.log('ws with allowed Origin accepted:', originOk);
  originWs.close();
  const badWs = new (WebSocket as any)(browser.wsUrl, { headers: { Origin: 'http://evil.example' } }) as WebSocket;
  const badOk = await new Promise<boolean>((resolve) => {
    badWs.addEventListener('open', () => resolve(true));
    badWs.addEventListener('error', () => resolve(false));
  });
  console.log('ws with other Origin accepted:', badOk);
  badWs.close();

  const cdp = await connectCdp(browser.wsUrl);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'data:text/html,<h1>hi</h1>' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const session = cdp.session(sessionId);
  let frames = 0;
  session.on('Page.screencastFrame', (p) => {
    frames++;
    void session.send('Page.screencastFrameAck', { sessionId: p.sessionId });
  });
  await session.send('Page.enable');
  await session.send('Page.startScreencast', { format: 'jpeg', quality: 60 });
  await Bun.sleep(3000);
  await session.send('Page.stopScreencast').catch(() => {});
  console.log('screencast frames in 3 s:', frames);
  cdp.close();

  const res = await fetch(`http://127.0.0.1:${browser.port}/devtools/inspector.html`);
  console.log('inspector.html status:', res.status);
  console.log('X-Frame-Options:', res.headers.get('x-frame-options'));
  console.log('Content-Security-Policy:', res.headers.get('content-security-policy'));
} finally {
  browser.kill();
  await Promise.race([browser.exited, Bun.sleep(3000)]);
  await Bun.sleep(500);
  rmSync(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
