// Real waveform + BPM, decoded from the actual stream — computed lazily, only
// for whichever track is currently loaded (decoding a full MP3 up front for
// every track in the grid would be wasteful). One fetch + one decode per
// track serves both the scrobbler's waveform and the BPM column, so adding
// BPM doesn't double the network/CPU cost.

const BUCKETS = 64;

export interface AudioAnalysis {
  peaks: number[];
  /** null when confident beat detection failed (e.g. ambient/non-rhythmic track) */
  bpm: number | null;
}

const cache = new Map<string, AudioAnalysis>();
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

// ponytail: a simple energy-based beat picker (low-pass -> windowed energy ->
// peak-pick -> mode of the interval histogram), not a real tempo-tracking
// algorithm (e.g. autocorrelation/dynamic programming). Good enough for a
// rough BPM label on typical 4/4 tracks; upgrade if accuracy complaints show up.
function estimateBpm(channel: Float32Array, sampleRate: number): number | null {
  // One-pole low-pass (~150Hz) to emphasize kick/bass over everything else.
  const cutoffHz = 150;
  const dt = 1 / sampleRate;
  const alpha = dt / (1 / (2 * Math.PI * cutoffHz) + dt);
  const filtered = new Float32Array(channel.length);
  let prev = 0;
  for (let i = 0; i < channel.length; i++) {
    prev += alpha * (channel[i] - prev);
    filtered[i] = prev;
  }

  // Energy per 50ms window.
  const windowSize = Math.max(1, Math.floor(sampleRate * 0.05));
  const windowCount = Math.floor(filtered.length / windowSize);
  const energies = new Float32Array(windowCount);
  for (let i = 0; i < windowCount; i++) {
    let sum = 0;
    const start = i * windowSize;
    const end = start + windowSize;
    for (let j = start; j < end; j++) sum += filtered[j] * filtered[j];
    energies[i] = sum / windowSize;
  }

  // Local maxima above a threshold, at least 250ms apart (caps detection at 240bpm).
  let avg = 0;
  for (let i = 0; i < energies.length; i++) avg += energies[i];
  avg /= energies.length || 1;
  const threshold = avg * 1.3;
  const minGapWindows = Math.ceil(0.25 / 0.05);

  const peakTimes: number[] = [];
  let lastPeak = -minGapWindows;
  for (let i = 1; i < energies.length - 1; i++) {
    if (
      energies[i] > threshold &&
      energies[i] > energies[i - 1] &&
      energies[i] >= energies[i + 1] &&
      i - lastPeak >= minGapWindows
    ) {
      peakTimes.push((i * windowSize) / sampleRate);
      lastPeak = i;
    }
  }
  if (peakTimes.length < 4) return null; // too few beats detected to be confident

  const bpmCandidates: number[] = [];
  for (let i = 1; i < peakTimes.length; i++) {
    const bpm = 60 / (peakTimes[i] - peakTimes[i - 1]);
    if (bpm >= 60 && bpm <= 200) bpmCandidates.push(bpm);
  }
  if (bpmCandidates.length === 0) return null;

  // Mode of the rounded-bpm histogram — more robust than averaging against outliers.
  const buckets = new Map<number, number>();
  for (const bpm of bpmCandidates) {
    const rounded = Math.round(bpm);
    buckets.set(rounded, (buckets.get(rounded) ?? 0) + 1);
  }
  let bestBpm: number | null = null;
  let bestCount = 0;
  for (const [bpm, count] of buckets) {
    if (count > bestCount) {
      bestCount = count;
      bestBpm = bpm;
    }
  }
  return bestBpm;
}

export function getCachedAnalysis(trackId: string): AudioAnalysis | null {
  return cache.get(trackId) ?? null;
}

/** Fetches + decodes the track's audio once, computing both peaks and BPM. No-ops if already cached/in flight. */
export function computeAnalysis(trackId: string, streamUrl: string, onReady: (result: AudioAnalysis) => void): void {
  if (cache.has(trackId) || inFlight.has(trackId)) return;
  inFlight.add(trackId);

  (async () => {
    try {
      // Low priority: this competes on the same host/connection as the <audio>
      // element actually streaming the track — playback must win that race.
      const res = await fetch(streamUrl, { priority: "low" } as RequestInit);
      const arrayBuffer = await res.arrayBuffer();
      const audioBuffer = await getContext().decodeAudioData(arrayBuffer);
      const channel = audioBuffer.getChannelData(0);
      const result: AudioAnalysis = {
        peaks: downsample(channel),
        bpm: estimateBpm(channel, audioBuffer.sampleRate),
      };
      cache.set(trackId, result);
      onReady(result);
    } catch {
      // leave uncached — the scrobbler stays flat and the BPM column stays blank for this track
    } finally {
      inFlight.delete(trackId);
    }
  })();
}
