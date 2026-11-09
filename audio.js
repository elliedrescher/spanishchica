// Mic capture (16 kHz PCM16) and gapless playback of the partner's audio (24 kHz PCM16).

export function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return btoa(bin);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.nextTime = 0;
    this.sources = new Set();
  }

  // Call synchronously from a tap handler (iOS requires a user gesture).
  init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.out = this.ctx.createGain();
    this.out.connect(this.ctx.destination);
    const resumed = this.ctx.resume();
    const loaded = this.ctx.audioWorklet.addModule(new URL('./capture-worklet.js', import.meta.url).href);
    return Promise.all([resumed, loaded]);
  }

  async startMic(onChunk) {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    await this.ctx.resume();
    this.src = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'pcm-capture', { processorOptions: { targetRate: 16000 } });
    this.node.port.onmessage = (e) => onChunk(e.data);
    const sink = this.ctx.createGain();
    sink.gain.value = 0;
    this.src.connect(this.node);
    this.node.connect(sink);
    sink.connect(this.ctx.destination);
  }

  play(b64, mimeType = '') {
    if (!this.ctx) return;
    const m = /rate=(\d+)/.exec(mimeType);
    const rate = m ? parseInt(m[1], 10) : 24000;
    const bytes = base64ToBytes(b64);
    const i16 = new Int16Array(bytes.buffer, 0, bytes.length >> 1);
    const f = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) f[i] = i16[i] / 32768;
    const buf = this.ctx.createBuffer(1, f.length, rate);
    buf.copyToChannel(f, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.out);
    const t = Math.max(this.ctx.currentTime + 0.04, this.nextTime);
    src.start(t);
    this.nextTime = t + buf.duration;
    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
  }

  stopPlayback() {
    for (const s of this.sources) {
      try { s.stop(); } catch (_) { /* already stopped */ }
    }
    this.sources.clear();
    this.nextTime = 0;
  }

  // True while partner audio is playing (plus a short tail so echo doesn't leak back).
  isPlaying(tail = 0) {
    return !!this.ctx && this.ctx.currentTime < this.nextTime + tail;
  }

  async close() {
    this.stopPlayback();
    try { this.stream && this.stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
    try { this.node && this.node.disconnect(); } catch (_) {}
    try { this.ctx && (await this.ctx.close()); } catch (_) {}
    this.ctx = null;
  }
}
