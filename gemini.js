// Gemini REST helpers: model discovery and text/JSON generation (coach, translations, explanations).
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

async function apiError(r) {
  let detail = '';
  try {
    const j = await r.json();
    detail = (j.error && j.error.message) || '';
  } catch (_) {}
  const err = new Error(detail || `Request failed (${r.status})`);
  err.status = r.status;
  return err;
}

export async function listModels(key) {
  const all = [];
  let token = '';
  do {
    const url = `${BASE}/models?pageSize=1000&key=${encodeURIComponent(key)}${token ? `&pageToken=${token}` : ''}`;
    const r = await fetch(url);
    if (!r.ok) throw await apiError(r);
    const j = await r.json();
    all.push(...(j.models || []));
    token = j.nextPageToken || '';
  } while (token);
  return all;
}

function ver(name) {
  const m = /gemini-(\d+(?:\.\d+)?)/.exec(name);
  return m ? parseFloat(m[1]) : 0;
}

export function liveModels(models) {
  const score = (n) => ver(n) * 10 + (/flash/.test(n) ? 3 : 0) + (/native-audio|live/.test(n) ? 2 : 0) - (/exp/.test(n) ? 1 : 0);
  return models
    .filter((m) => (m.supportedGenerationMethods || []).includes('bidiGenerateContent'))
    .filter((m) => !/translat|transcri|tts|image/i.test(m.name))
    .sort((a, b) => score(b.name) - score(a.name));
}

export function textModels(models) {
  const score = (n) => {
    if (/gemini-flash-latest$/.test(n)) return 1000;
    return ver(n) * 10 + (/flash/.test(n) ? 5 : 0) - (/lite/.test(n) ? 3 : 0) - (/preview|exp/.test(n) ? 1.5 : 0);
  };
  return models
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .filter((m) => /^models\/gemini/.test(m.name))
    .filter((m) => !/image|tts|audio|live|embed|vision|robotics|computer|learnlm|nano|thinking-exp/i.test(m.name))
    .sort((a, b) => score(b.name) - score(a.name));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function generate(key, model, { system, prompt, json = false, temperature = 0.4 }) {
  const name = model.startsWith('models/') ? model : `models/${model}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature, ...(json ? { responseMimeType: 'application/json' } : {}) },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  const waits = [2000, 6000];
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`${BASE}/${name}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.ok) {
      const j = await r.json();
      const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
      const text = parts.filter((p) => !p.thought && p.text).map((p) => p.text).join('');
      if (!json) return text.trim();
      return parseJSON(text);
    }
    if ((r.status === 429 || r.status >= 500) && attempt < waits.length) {
      await sleep(waits[attempt]);
      continue;
    }
    throw await apiError(r);
  }
}

function parseJSON(text) {
  const cleaned = text.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (_) {
    const s = cleaned.indexOf('{');
    const e = cleaned.lastIndexOf('}');
    if (s >= 0 && e > s) return JSON.parse(cleaned.slice(s, e + 1));
    throw new Error('The coach returned an unreadable answer.');
  }
}
