import { useCallback, useEffect, useRef, useState } from 'react';
import { GAME_LABELS, identifyCard } from '../games';
import { cardPrice, formatMoney } from '../lib/collection';
import { cropCard, guideToVideoRect, loadImageFile } from '../ocr/image';
import { parseScan } from '../ocr/parse';
import { scanCardImage, scanPhoto, type ScanOutput } from '../ocr/scan';
import type { CardInfo, GameFilter, GameId, ScanHints } from '../types';
import { AddCardSheet, CardGrid, CardImage, cardSubtitle, GameChips, type AddOptions } from './common';

type CameraState = 'off' | 'starting' | 'on' | 'error';

interface ScanResult {
  preview: string;
  hints: ScanHints;
  game: GameId | null;
  candidates: CardInfo[];
  errors: string[];
  confident: boolean;
}

interface Props {
  filter: GameFilter;
  onFilterChange: (f: GameFilter) => void;
  onAdd: (card: CardInfo, opts: AddOptions) => void;
  onSearchInstead: (query: string) => void;
}

function progressLabel(status: string, progress: number): string {
  if (/recogniz/i.test(status)) return `Reading card… ${Math.round(progress * 100)}%`;
  if (/load|initializ/i.test(status)) return 'Getting the scanner ready (only slow the first time)…';
  return 'Reading card…';
}

export function Scanner({ filter, onFilterChange, onAdd, onSearchInstead }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [camera, setCamera] = useState<CameraState>('off');
  const [cameraError, setCameraError] = useState('');
  const [torch, setTorch] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [selected, setSelected] = useState<CardInfo | null>(null);

  // Bumped whenever the camera is stopped, so a start that finishes afterwards
  // (e.g. the user switched tabs mid-permission-prompt) releases its stream.
  const cameraSession = useRef(0);

  const stopCamera = useCallback(() => {
    cameraSession.current++;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamera('off');
    setTorch(null);
  }, []);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera('error');
      setCameraError('This browser can’t use the camera here. Use “Scan a photo” instead.');
      return;
    }
    const session = ++cameraSession.current;
    setCamera('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      if (session !== cameraSession.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      // Continuous autofocus where supported (mostly Android).
      track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => {});
      const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
      setTorch(caps.torch ? false : null);
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => {});
      }
      setCamera('on');
    } catch (err) {
      setCamera('error');
      const name = err instanceof DOMException ? err.name : '';
      setCameraError(
        name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow camera access in your browser settings, or use “Scan a photo”.'
          : name === 'NotFoundError'
            ? 'No camera found. Use “Scan a photo” instead.'
            : 'Couldn’t start the camera. Use “Scan a photo” instead.',
      );
    }
  }, []);

  // Start straight away if the user already granted camera access before.
  useEffect(() => {
    let cancelled = false;
    try {
      navigator.permissions
        ?.query({ name: 'camera' as PermissionName })
        .then((p) => {
          if (!cancelled && p.state === 'granted') void startCamera();
        })
        .catch(() => {});
    } catch {
      // Older browsers throw for unknown permission names; they get the button.
    }
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  // Release the camera while the app is in the background.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && streamRef.current) stopCamera();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [stopCamera]);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || torch === null) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
      setTorch(!torch);
    } catch {
      setTorch(null);
    }
  };

  const run = async (read: () => Promise<ScanOutput>) => {
    setBusy(true);
    setResult(null);
    setStatus('Reading card…');
    try {
      const { hints, preview } = await read();
      setStatus('Looking up card…');
      const { game, candidates, errors, confident } = await identifyCard(filter, hints);
      setResult({ preview, hints, game, candidates, errors, confident });
    } catch (err) {
      setResult({
        preview: '',
        hints: parseScan('', ''),
        game: null,
        candidates: [],
        errors: [err instanceof Error ? err.message : String(err)],
        confident: false,
      });
    } finally {
      setBusy(false);
      setStatus('');
    }
  };

  const scanFromCamera = () => {
    const video = videoRef.current;
    const guide = guideRef.current;
    if (!video || !guide || !video.videoWidth) return;
    const vr = video.getBoundingClientRect();
    const gr = guide.getBoundingClientRect();
    const rect = guideToVideoRect(
      video,
      { width: vr.width, height: vr.height },
      { x: gr.left - vr.left, y: gr.top - vr.top, w: gr.width, h: gr.height },
    );
    const card = cropCard(video, rect);
    void run(() => scanCardImage(card, filter, (s, p) => setStatus(progressLabel(s, p))));
  };

  const scanFromFile = (file: File | undefined) => {
    if (!file) return;
    void run(async () => {
      const image = await loadImageFile(file);
      try {
        return await scanPhoto(image, filter, (s, p) => setStatus(progressLabel(s, p)));
      } finally {
        image.close();
      }
    });
  };

  const best = result?.candidates[0];
  const others = result?.candidates.slice(1) ?? [];

  return (
    <section className="scanner">
      <GameChips value={filter} onChange={onFilterChange} />

      <div className={`viewfinder ${camera === 'on' ? 'live' : ''}`}>
        <video ref={videoRef} playsInline muted autoPlay />
        <div className="guide" ref={guideRef} aria-hidden="true">
          <span className="guide-hint">{camera === 'on' ? 'Fit the card inside the frame' : ''}</span>
        </div>
        {camera !== 'on' && (
          <div className="viewfinder-overlay">
            {camera === 'error' ? (
              <p>{cameraError}</p>
            ) : (
              <>
                <p>Point your camera at a card. Everything runs on your phone — nothing is uploaded.</p>
                <button type="button" className="btn btn-primary" onClick={startCamera} disabled={camera === 'starting'}>
                  {camera === 'starting' ? 'Starting camera…' : 'Start camera'}
                </button>
              </>
            )}
          </div>
        )}
        {torch !== null && (
          <button type="button" className={`torch ${torch ? 'on' : ''}`} onClick={toggleTorch} aria-label="Flashlight">
            ⚡
          </button>
        )}
      </div>

      <div className="scan-actions">
        <button type="button" className="btn btn-secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
          Scan a photo
        </button>
        <button
          type="button"
          className="shutter"
          onClick={scanFromCamera}
          disabled={busy || camera !== 'on'}
          aria-label="Scan card"
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            scanFromFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <span className="scan-actions-spacer" />
      </div>

      {busy && (
        <p className="status" role="status">
          <span className="spinner" /> {status}
        </p>
      )}

      {result && (
        <div className="results">
          {best ? (
            <>
              <h2>{!result.confident ? 'Possible match' : result.candidates.length > 1 ? 'Best match' : 'Found it'}</h2>
              {!result.confident && (
                <p className="muted small">
                  The card number couldn’t be read, so this is a best guess from the name. Check it — or retake the
                  photo closer with the bottom edge in focus, or pick the game above.
                </p>
              )}
              <div className="best">
                <button type="button" className="best-img" onClick={() => setSelected(best)}>
                  <CardImage card={best} />
                </button>
                <div className="best-body">
                  <div className="best-name">{best.name}</div>
                  <div className="muted">{cardSubtitle(best)}</div>
                  {!result.confident && <div className="muted">{GAME_LABELS[best.game]}</div>}
                  {best.variant && <div className="muted">{best.variant}</div>}
                  <div className="best-price">{formatMoney(cardPrice(best))}</div>
                  <div className="best-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => onAdd(best, { quantity: 1, foil: false, condition: 'NM' })}
                    >
                      + Add
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => setSelected(best)}>
                      Details
                    </button>
                  </div>
                </div>
              </div>
              {others.length > 0 && (
                <>
                  <h3>Not quite? Other printings and matches</h3>
                  <CardGrid cards={others} onSelect={setSelected} />
                </>
              )}
            </>
          ) : (
            <div className="no-match">
              <h2>Couldn’t identify that card</h2>
              <p className="muted">
                Tips: fill the frame with the card, avoid glare on foils, and make sure the bottom edge (where the card
                number is printed) is sharp. Picking the game above also helps.
              </p>
              <button type="button" className="btn btn-secondary" onClick={() => onSearchInstead(result.hints.names[0] ?? '')}>
                Search by name instead
              </button>
            </div>
          )}

          <details className="debug">
            <summary>What the scanner read</summary>
            {result.preview && <img src={result.preview} alt="Scanned card" className="debug-img" />}
            <ul>
              {result.game && <li>Game: {GAME_LABELS[result.game]}</li>}
              {result.hints.onePieceIds.length > 0 && <li>One Piece id: {result.hints.onePieceIds.join(', ')}</li>}
              {result.hints.pokemonNumbers.length > 0 && (
                <li>Number: {result.hints.pokemonNumbers.map((n) => (n.total ? `${n.number}/${n.total}` : n.number)).join(', ')}</li>
              )}
              {result.hints.magicPrints.length > 0 && (
                <li>
                  Set / number:{' '}
                  {result.hints.magicPrints.map((p) => [p.set?.toUpperCase(), p.number].filter(Boolean).join(' ')).join(', ')}
                </li>
              )}
              {result.hints.yugiohSetCodes.length > 0 && <li>Yu-Gi-Oh! set code: {result.hints.yugiohSetCodes.join(', ')}</li>}
              {result.hints.yugiohPasscodes.length > 0 && <li>Passcode: {result.hints.yugiohPasscodes.join(', ')}</li>}
              {result.hints.lorcanaPrints.length > 0 && (
                <li>
                  Lorcana: {result.hints.lorcanaPrints.map((p) => `set ${p.set} #${p.number}/${p.total}`).join(', ')}
                </li>
              )}
              {result.hints.names.length > 0 && <li>Names: {result.hints.names.slice(0, 3).join(' | ')}</li>}
              {result.errors.map((e) => (
                <li key={e} className="error">
                  {e}
                </li>
              ))}
            </ul>
            <pre>{result.hints.rawText.trim() || '(no text found)'}</pre>
          </details>
        </div>
      )}

      {selected && <AddCardSheet card={selected} onAdd={onAdd} onClose={() => setSelected(null)} />}
    </section>
  );
}
