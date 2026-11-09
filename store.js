// Everything is saved only in this browser (localStorage) on your phone.
const K = { settings: 'charla.settings', sessions: 'charla.sessions', words: 'charla.words' };

export const DEFAULT_SETTINGS = {
  apiKey: '',
  liveModel: '',
  coachModel: '',
  voice: 'Aoede',
  region: 'AR',
  level: 'intermediate',
  turnMode: 'handsfree', // 'handsfree' | 'tap'
  silenceMs: 1200,
  muteWhilePartner: true,
  showEnglish: false,
};

function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch (_) {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (_) {
    return false;
  }
}

export const Store = {
  settings() { return { ...DEFAULT_SETTINGS, ...read(K.settings, {}) }; },
  saveSettings(s) { write(K.settings, s); },

  sessions() { return read(K.sessions, []); },
  session(id) { return this.sessions().find((s) => s.id === id) || null; },
  saveSession(session) {
    const all = this.sessions().filter((s) => s.id !== session.id);
    all.unshift(session);
    all.sort((a, b) => b.startedAt - a.startedAt);
    if (!write(K.sessions, all)) {
      // storage full: drop the oldest conversations until it fits
      while (all.length > 1) {
        all.pop();
        if (write(K.sessions, all)) break;
      }
    }
  },
  deleteSession(id) { write(K.sessions, this.sessions().filter((s) => s.id !== id)); },

  words() { return read(K.words, []); },
  saveWords(w) { write(K.words, w); },
  addWord(item) {
    const words = this.words();
    const key = (item.spanish || '').trim().toLowerCase();
    if (!key || words.some((w) => w.spanish.trim().toLowerCase() === key)) return false;
    words.unshift({
      id: uid(),
      spanish: item.spanish.trim(),
      english: (item.english || '').trim(),
      example: item.example || '',
      exampleEnglish: item.exampleEnglish || '',
      note: item.note || '',
      region: item.region || '',
      addedAt: Date.now(),
      practiced: 0,
    });
    this.saveWords(words);
    return true;
  },
  hasWord(spanish) {
    const key = (spanish || '').trim().toLowerCase();
    return this.words().some((w) => w.spanish.trim().toLowerCase() === key);
  },

  exportAll() {
    return { exportedAt: new Date().toISOString(), settings: { ...this.settings(), apiKey: '' }, sessions: this.sessions(), words: this.words() };
  },
  importAll(data) {
    if (Array.isArray(data.sessions)) write(K.sessions, data.sessions);
    if (Array.isArray(data.words)) write(K.words, data.words);
  },
  clearHistory() { write(K.sessions, []); },
};

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
