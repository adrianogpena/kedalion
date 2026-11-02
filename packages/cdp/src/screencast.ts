import type { CdpSession } from './client.ts';

export interface ScreencastSize {
  width: number;
  height: number;
  dpr: number;
  mobile?: boolean;
}

export interface FrameMeta {
  offsetTop: number;
  pageScaleFactor: number;
  deviceWidth: number;
  deviceHeight: number;
  scrollOffsetX: number;
  scrollOffsetY: number;
  timestamp?: number;
}

export type FrameHandler = (base64Jpeg: string, meta: FrameMeta) => void;

/** Starts a JPEG screencast sized to the viewport; every frame is acked. Returns stop(). */
export function startScreencast(session: CdpSession, size: ScreencastSize, onFrame: FrameHandler): () => void {
  let stopped = false;
  const off = session.on('Page.screencastFrame', (p) => {
    if (stopped) return;
    onFrame(p.data, p.metadata);
    void session.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => undefined);
  });
  void session
    .send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: size.dpr, mobile: size.mobile ?? false })
    .catch(() => undefined);
  void session
    .send('Page.startScreencast', {
      format: 'jpeg',
      quality: 80,
      maxWidth: Math.round(size.width * size.dpr),
      maxHeight: Math.round(size.height * size.dpr),
      everyNthFrame: 1,
    })
    .catch(() => undefined);
  return () => {
    if (stopped) return;
    stopped = true;
    off();
    void session.send('Page.stopScreencast').catch(() => undefined);
  };
}
