import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, copyText, errorMessage, errorOf, formatBytes, Modal, useToast } from '@kedalion/ui';
import { explorerApi as api, type FsDuProgress, type FsInfo } from '../client';
import { t } from '../i18n';

const GRID = { display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 16px', alignItems: 'center', margin: 0 } as const;
const WRAP = { overflowWrap: 'anywhere', margin: 0 } as const;
const ROW = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } as const;

const when = (ms: number | null) => (ms === null ? '—' : new Date(ms).toLocaleString());
const sized = (bytes: number) => t('explorer.props.bytes', { size: formatBytes(bytes), bytes: bytes.toLocaleString() });

/** Properties of one Explorer entry; a folder can count its size, a file can show its SHA-256. */
export function PropertiesDialog({ root, path, onClose }: { root: string; path: string; onClose: () => void }) {
  const toast = useToast();
  const [info, setInfo] = useState<FsInfo>();
  const [error, setError] = useState<string>();
  const [du, setDu] = useState<FsDuProgress>();
  const [counting, setCounting] = useState(false);
  const [hash, setHash] = useState<string>();
  const [hashing, setHashing] = useState(false);
  const abort = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    let live = true;
    api.fsInfo(root, path).then(
      (i) => live && setInfo(i),
      (err) => live && setError(errorMessage(errorOf(err))),
    );
    return () => {
      live = false;
      abort.current?.abort();
    };
  }, [root, path]);

  const copy = (text: string) =>
    void copyText(text).then((ok) => toast(ok ? { message: t('explorer.props.copied') } : { message: t('explorer.copyFailed'), kind: 'error' }));

  const count = () => {
    const ac = new AbortController();
    abort.current = ac;
    setCounting(true);
    setDu(undefined);
    api
      .fsDu(root, path, setDu, ac.signal)
      .catch((err) => !ac.signal.aborted && setError(errorMessage(errorOf(err))))
      .finally(() => {
        if (abort.current === ac) setCounting(false);
      });
  };
  const cancel = () => {
    abort.current?.abort();
    abort.current = undefined;
    setCounting(false);
  };

  const hashIt = () => {
    setHashing(true);
    api
      .fsHash(root, path)
      .then((h) => setHash(h.sha256), (err) => setError(errorMessage(errorOf(err))))
      .finally(() => setHashing(false));
  };

  const row = (label: string, value: ReactNode) => (
    <>
      <dt>{label}</dt>
      <dd style={WRAP}>{value}</dd>
    </>
  );

  return (
    <Modal
      title={t('explorer.properties')}
      onClose={onClose}
      footer={
        <Button onClick={onClose} title={t('explorer.props.close')}>
          {t('explorer.props.close')}
        </Button>
      }
    >
      {error && <p className="error">{error}</p>}
      {info && (
        <dl style={GRID}>
          {row(t('explorer.props.name'), info.name)}
          {row(
            t('explorer.props.path'),
            <span style={ROW}>
              <span style={WRAP}>{info.fullPath}</span>
              <Button size="xs" variant="ghost" icon="copy" onClick={() => copy(info.fullPath)} title={t('explorer.props.copy')}>
                {t('explorer.props.copy')}
              </Button>
            </span>,
          )}
          {row(t('explorer.props.type'), t(`explorer.props.${info.type}`))}
          {info.type === 'dir'
            ? row(
                t('explorer.props.size'),
                <span style={ROW}>
                  {du && (
                    <span>
                      {sized(du.bytes)} · {t('explorer.props.contains', { files: du.files.toLocaleString(), dirs: du.dirs.toLocaleString() })}
                      {counting && ` · ${t('explorer.props.counting')}`}
                    </span>
                  )}
                  {counting ? (
                    <Button size="xs" variant="danger" icon="square" onClick={cancel} title={t('explorer.props.cancel')}>
                      {t('explorer.props.cancel')}
                    </Button>
                  ) : (
                    <Button size="xs" onClick={count} title={t('explorer.props.calcSize')}>
                      {t('explorer.props.calcSize')}
                    </Button>
                  )}
                </span>,
              )
            : row(t('explorer.props.size'), sized(info.size))}
          {row(t('explorer.props.created'), when(info.created))}
          {row(t('explorer.props.modified'), when(info.modified))}
          {row(t('explorer.props.accessed'), when(info.accessed))}
          {row(t('explorer.props.readOnly'), t(info.readOnly ? 'explorer.props.yes' : 'explorer.props.no'))}
          {info.volume && row(t('explorer.props.volume'), t('explorer.props.volumeFree', { free: formatBytes(info.volume.free), total: formatBytes(info.volume.total) }))}
          {info.type === 'file' &&
            row(
              t('explorer.props.sha256'),
              <span style={ROW}>
                {hash ? (
                  <>
                    <code style={WRAP}>{hash}</code>
                    <Button size="xs" variant="ghost" icon="copy" onClick={() => copy(hash)} title={t('explorer.props.copy')}>
                      {t('explorer.props.copy')}
                    </Button>
                  </>
                ) : (
                  <Button size="xs" disabled={hashing} onClick={hashIt} title={t('explorer.props.sha256')}>
                    {hashing ? t('explorer.props.hashing') : t('explorer.props.sha256')}
                  </Button>
                )}
              </span>,
            )}
        </dl>
      )}
    </Modal>
  );
}
