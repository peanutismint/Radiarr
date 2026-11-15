// Synthesized demo audio. Each track is a gentle chord-progression loop in its own key and tempo,
// generated on the fly as a WAV file. Any byte range can be produced directly, so seeking to the
// "live" position is instant and nothing large is ever held in memory.

const SAMPLE_RATE = 22050;
const HEADER_BYTES = 44;
const MAX_CHUNK_BYTES = 1024 * 1024;

const PROGRESSIONS = [
  [0, 7, 9, 5], // I V vi IV
  [0, 5, 7, 5], // I IV V IV
  [9, 5, 0, 7], // vi IV I V
  [0, 9, 5, 7], // I vi IV V
];

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

interface Voice {
  rootMidi: number;
  bpm: number;
  progression: number[];
  pattern: number[];
  brightness: number;
}

function voiceFor(trackId: string): Voice {
  const h = hash(trackId);
  return {
    rootMidi: 45 + (h % 12),
    bpm: 72 + ((h >>> 4) % 48),
    progression: PROGRESSIONS[(h >>> 10) % PROGRESSIONS.length],
    pattern: [
      [0, 1, 2, 3, 2, 1, 0, 1],
      [0, 2, 1, 3, 0, 2, 1, 2],
      [3, 2, 1, 0, 1, 2, 3, 2],
    ][(h >>> 14) % 3],
    brightness: 0.15 + ((h >>> 18) % 10) / 40,
  };
}

const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

function chordTones(rootOffset: number, rootMidi: number): number[] {
  const minor = rootOffset === 9 || rootOffset === 2 || rootOffset === 4;
  const r = rootMidi + rootOffset;
  return [r, r + (minor ? 3 : 4), r + 7, r + 12];
}

function sampleAt(v: Voice, i: number, totalSamples: number): number {
  const t = i / SAMPLE_RATE;
  const beat = (t * v.bpm) / 60;
  const bar = Math.floor(beat / 4);
  const chord = chordTones(v.progression[bar % v.progression.length], v.rootMidi);

  // Soft pad: the chord, quietly sustained.
  let s = 0;
  for (let k = 0; k < 3; k++) s += Math.sin(2 * Math.PI * midiToHz(chord[k] + 12) * t) * 0.045;
  // Bass on the root.
  s += Math.sin(2 * Math.PI * midiToHz(chord[0] - 12) * t) * 0.09;

  // Plucked arpeggio, eighth notes.
  const eighth = beat * 2;
  const step = Math.floor(eighth);
  const since = (eighth - step) * (60 / v.bpm / 2);
  const note = chord[v.pattern[step % v.pattern.length]] + 24;
  const f = midiToHz(note);
  const env = Math.exp(-since * 6);
  s += (Math.sin(2 * Math.PI * f * t) + v.brightness * Math.sin(4 * Math.PI * f * t)) * env * 0.16;

  // Fade in and out so crossfades between tracks sound natural.
  const fadeIn = Math.min(1, t / 1.5);
  const fadeOut = Math.min(1, (totalSamples - i) / (SAMPLE_RATE * 2));
  return s * fadeIn * fadeOut * 1.6;
}

function wavHeader(dataBytes: number): Uint8Array {
  const b = new ArrayBuffer(HEADER_BYTES);
  const d = new DataView(b);
  const w = (o: number, s: string) => [...s].forEach((c, k) => d.setUint8(o + k, c.charCodeAt(0)));
  w(0, 'RIFF');
  d.setUint32(4, 36 + dataBytes, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  d.setUint32(16, 16, true);
  d.setUint16(20, 1, true); // PCM
  d.setUint16(22, 1, true); // mono
  d.setUint32(24, SAMPLE_RATE, true);
  d.setUint32(28, SAMPLE_RATE * 2, true);
  d.setUint16(32, 2, true);
  d.setUint16(34, 16, true);
  w(36, 'data');
  d.setUint32(40, dataBytes, true);
  return new Uint8Array(b);
}

/** Serve a synthesized track, honouring HTTP Range requests as browsers expect for audio. */
export function synthesizeTrackResponse(trackId: string, durationMs: number, rangeHeader: string | null): Response {
  const totalSamples = Math.floor((durationMs / 1000) * SAMPLE_RATE);
  const totalBytes = HEADER_BYTES + totalSamples * 2;

  let start = 0;
  let end = totalBytes - 1;
  let partial = false;
  const m = rangeHeader?.match(/bytes=(\d*)-(\d*)/);
  if (m) {
    partial = true;
    if (m[1] === '' && m[2] !== '') {
      start = Math.max(0, totalBytes - Number(m[2]));
    } else {
      start = Number(m[1] || 0);
      if (m[2] !== '') end = Math.min(Number(m[2]), totalBytes - 1);
    }
    if (start >= totalBytes) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${totalBytes}` } });
    }
    end = Math.min(end, start + MAX_CHUNK_BYTES - 1);
  } else {
    end = Math.min(end, MAX_CHUNK_BYTES * 16);
  }

  // Build the samples that cover [start, end], then cut out exactly the requested bytes.
  const voice = voiceFor(trackId);
  const firstSample = Math.max(0, Math.floor((start - HEADER_BYTES) / 2));
  const lastSample = Math.min(totalSamples - 1, Math.floor((end - HEADER_BYTES) / 2));
  const includeHeader = start < HEADER_BYTES;
  const tempStart = includeHeader ? 0 : HEADER_BYTES + firstSample * 2;
  const sampleCount = Math.max(0, lastSample - firstSample + 1);
  const temp = new Uint8Array((includeHeader ? HEADER_BYTES : 0) + sampleCount * 2);
  if (includeHeader) temp.set(wavHeader(totalSamples * 2), 0);
  const view = new DataView(temp.buffer);
  const base = includeHeader ? HEADER_BYTES : 0;
  for (let k = 0; k < sampleCount; k++) {
    const v = Math.max(-1, Math.min(1, sampleAt(voice, firstSample + k, totalSamples)));
    view.setInt16(base + k * 2, Math.round(v * 32767), true);
  }
  const out = temp.slice(start - tempStart, start - tempStart + (end - start + 1));

  const headers = new Headers({
    'Content-Type': 'audio/wav',
    'Accept-Ranges': 'bytes',
    'Content-Length': String(out.length),
    'Cache-Control': 'no-store',
  });
  if (partial) headers.set('Content-Range', `bytes ${start}-${end}/${totalBytes}`);
  return new Response(out, { status: partial ? 206 : 200, headers });
}
