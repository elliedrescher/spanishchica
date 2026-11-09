// Captures mic audio, low-pass filters, resamples to 16 kHz mono PCM16,
// and posts ~100 ms chunks to the main thread.
class PcmCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.target = (options.processorOptions && options.processorOptions.targetRate) || 16000;
    this.ratio = sampleRate / this.target;
    this.pos = 0;
    this.chunk = Math.round(this.target / 10);
    this.buf = new Int16Array(this.chunk);
    this.n = 0;
    this.sumsq = 0;
    // one-pole low-pass (~7 kHz) to reduce aliasing before decimation
    this.alpha = 1 - Math.exp((-2 * Math.PI * 7000) / sampleRate);
    this.lp = 0;
    this.prev = 0;
  }

  process(inputs) {
    const input = inputs[0];
    const ch = input && input[0];
    if (!ch) return true;

    const f = new Float32Array(ch.length);
    for (let i = 0; i < ch.length; i++) {
      this.lp += this.alpha * (ch[i] - this.lp);
      f[i] = this.lp;
    }

    while (this.pos < f.length) {
      const i = Math.floor(this.pos);
      const frac = this.pos - i;
      const a = i >= 0 ? f[i] : this.prev;
      const b = i + 1 < f.length ? f[i + 1] : a;
      let s = a + (b - a) * frac;
      if (s > 1) s = 1; else if (s < -1) s = -1;
      this.sumsq += s * s;
      this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.n === this.chunk) {
        const rms = Math.sqrt(this.sumsq / this.chunk);
        this.port.postMessage({ pcm: this.buf.buffer, rms }, [this.buf.buffer]);
        this.buf = new Int16Array(this.chunk);
        this.n = 0;
        this.sumsq = 0;
      }
      this.pos += this.ratio;
    }
    this.pos -= f.length;
    this.prev = f[f.length - 1];
    return true;
  }
}

registerProcessor('pcm-capture', PcmCapture);
