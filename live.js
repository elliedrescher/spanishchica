// Minimal Gemini Live API (BidiGenerateContent) WebSocket client.
const WS_URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

export class LiveSession {
  /**
   * @param {object} o
   * @param {string} o.apiKey
   * @param {string} o.model           e.g. "models/gemini-..."
   * @param {string} o.systemInstruction
   * @param {string} o.voiceName
   * @param {boolean} o.manualTurns     true = tap-to-talk (activityStart/End), false = automatic voice detection
   * @param {number} o.silenceMs        how long a pause ends your turn (hands-free)
   * @param {object} o.on               callbacks: audio, inputText, outputText, interrupted, turnComplete, status, error, closed
   */
  constructor(o) {
    this.o = o;
    this.on = o.on || {};
    this.ws = null;
    this.ready = false;
    this.ended = false;
    this.resumeHandle = null;
    this.reconnects = 0;
  }

  setup() {
    const o = this.o;
    const setup = {
      model: o.model.startsWith('models/') ? o.model : `models/${o.model}`,
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: o.voiceName } } },
      },
      systemInstruction: { parts: [{ text: o.systemInstruction }] },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      contextWindowCompression: { slidingWindow: {} },
      sessionResumption: this.resumeHandle ? { handle: this.resumeHandle } : {},
      realtimeInputConfig: o.manualTurns
        ? { automaticActivityDetection: { disabled: true } }
        : {
            automaticActivityDetection: {
              disabled: false,
              endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
              prefixPaddingMs: 200,
              silenceDurationMs: o.silenceMs || 1200,
            },
          },
    };
    return setup;
  }

  connect() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(`${WS_URL}?key=${encodeURIComponent(this.o.apiKey)}`);
      this.ws = ws;
      this.ready = false;

      ws.onopen = () => ws.send(JSON.stringify({ setup: this.setup() }));

      ws.onmessage = async (ev) => {
        let text = ev.data;
        if (typeof text !== 'string') text = await ev.data.text();
        let msg;
        try { msg = JSON.parse(text); } catch (_) { return; }
        if (msg.setupComplete) {
          this.ready = true;
          this.reconnects = 0;
          if (!settled) { settled = true; resolve(); }
        }
        this.handle(msg);
      };

      ws.onerror = () => {};

      ws.onclose = (ev) => {
        const wasReady = this.ready;
        this.ready = false;
        if (this.ws !== ws) return; // replaced by a newer socket
        if (!settled) {
          settled = true;
          reject(new Error(ev.reason || `Connection closed (code ${ev.code})`));
          return;
        }
        if (!this.ended && wasReady && this.resumeHandle && this.reconnects < 3) {
          this.reconnect();
        } else if (!this.ended) {
          this.on.closed && this.on.closed(ev.reason || `Connection closed (code ${ev.code})`);
        }
      };
    });
  }

  async reconnect() {
    this.reconnects++;
    this.on.status && this.on.status('reconnecting');
    const old = this.ws;
    this.ws = null;
    try { old && old.close(); } catch (_) {}
    try {
      await this.connect();
      this.on.status && this.on.status('reconnected');
    } catch (e) {
      this.on.closed && this.on.closed(e.message);
    }
  }

  handle(msg) {
    const sc = msg.serverContent;
    if (sc) {
      const parts = (sc.modelTurn && sc.modelTurn.parts) || [];
      for (const p of parts) {
        if (p.inlineData && p.inlineData.data) this.on.audio && this.on.audio(p.inlineData.data, p.inlineData.mimeType);
      }
      if (sc.inputTranscription && sc.inputTranscription.text) this.on.inputText && this.on.inputText(sc.inputTranscription.text);
      if (sc.outputTranscription && sc.outputTranscription.text) this.on.outputText && this.on.outputText(sc.outputTranscription.text);
      if (sc.interrupted) this.on.interrupted && this.on.interrupted();
      if (sc.turnComplete) this.on.turnComplete && this.on.turnComplete();
    }
    const upd = msg.sessionResumptionUpdate;
    if (upd && upd.resumable && upd.newHandle) this.resumeHandle = upd.newHandle;
    if (msg.goAway && !this.ended && this.resumeHandle) this.reconnect();
    if (msg.error) this.on.error && this.on.error(msg.error.message || JSON.stringify(msg.error));
  }

  send(obj) {
    if (this.ws && this.ready && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }

  sendAudio(b64) {
    return this.send({ realtimeInput: { audio: { data: b64, mimeType: 'audio/pcm;rate=16000' } } });
  }

  sendText(text) {
    return this.send({ realtimeInput: { text } });
  }

  activityStart() { return this.send({ realtimeInput: { activityStart: {} } }); }
  activityEnd() { return this.send({ realtimeInput: { activityEnd: {} } }); }

  close() {
    this.ended = true;
    this.ready = false;
    try { this.ws && this.ws.close(); } catch (_) {}
  }
}
