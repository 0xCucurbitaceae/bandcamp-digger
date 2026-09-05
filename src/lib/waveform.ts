// Real waveform peaks, decoded from the actual stream — computed lazily, only
// for whichever track is currently loaded (decoding a full MP3 up front for
// every track in the grid would be wasteful; this only ever does it once per
// track, on demand, and caches the result for the rest of the session).

const BUCKETS = 64;

const cache = new Map<string, number[]>();
const inFlight = new Set<string>();

let sharedContext: AudioContext | null = null;
function getContext(): AudioContext {
  if (!sharedContext) sharedContext = new AudioContext();
  return sharedContext;
}

function downsample(channel: Float32Array): number[] {
  const step = Math.max(1, Math.floor(channel.length / BUCKETS));
  const peaks: number[] = [];
  for (let i = 0; i < BUCKETS; i++) {
    const start = i * step;
    const end = Math.min(start + step, channel.length);
    let max = 0;
    for (let j = start; j < end; j++) {
      const v = Math.abs(channel[j]);
      if (v > max) max = v;
    }
    peaks.push(max);
  }
  const loudest = Math.max(...peaks, 0.0001);
  return peaks.map((p) => p / loudest);
}

export function getCachedWaveform(trackId: string): number[] | null {
  return cache.get(trackId) ?? null;
}

/** Fetches + decodes the track's audio and reports peaks via `onReady`. No-ops if already cached/in flight. */
export function computeWaveform(trackId: string, streamUrl: string, onReady: (peaks: number[]) => void): void {
  if (cache.has(trackId) || inFlight.has(trackId)) return;
  inFlight.add(trackId);

  (async () => {
    try {
      const res = await fetch(streamUrl);
      const arrayBuffer = await res.arrayBuffer();
      const audioBuffer = await getContext().decodeAudioData(arrayBuffer);
      const peaks = downsample(audioBuffer.getChannelData(0));
      cache.set(trackId, peaks);
      onReady(peaks);
    } catch {
      // leave uncached — the scrobbler just stays flat for this track
    } finally {
      inFlight.delete(trackId);
    }
  })();
}
