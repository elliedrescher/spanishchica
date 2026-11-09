import { Store, uid } from './store.js';
import { AudioEngine, bytesToBase64 } from './audio.js';
import { LiveSession } from './live.js';
import * as G from './gemini.js';
import * as P from './prompts.js';

/* ---------------- utilities ---------------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

function md(s) {
  let out = '';
  let inList = false;
  for (const raw of String(s || '').split('\n')) {
    let l = esc(raw).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
    if (/^\s*[-*•]\s+/.test(raw)) {
      if (!inList) { out += '<ul>'; inList = true; }
      out += `<li>${l.replace(/^\s*(?:[-•]|\*(?!\*))\s+/, '')}</li>`;
    } else {
      if (inList) { out += '</ul>'; inList = false; }
      if (l.trim()) out += `<p>${l.replace(/^#+\s*/, '')}</p>`;
    }
  }
  if (inList) out += '</ul>';
  return out;
}

let toastTimer;
function toast(msg, ms = 2800) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

function fmtDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// Device text-to-speech, used only for flashcards / "Hear" buttons (not the live partner).
function speak(text, region) {
  try {
    if (!('speechSynthesis' in window)) return toast('Speech not available on this device');
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices();
    const want = region === 'CO' ? ['es-CO', 'es-MX', 'es-US'] : ['es-AR', 'es-MX', 'es-US'];
    const v = want.map((l) => voices.find((x) => x.lang.replace('_', '-') === l)).find(Boolean) || voices.find((x) => x.lang.startsWith('es'));
    if (v) u.voice = v;
    u.lang = v ? v.lang : 'es-MX';
    u.rate = 0.9;
    speechSynthesis.speak(u);
  } catch (_) {}
}

const ICON = {
  mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-2.1a7 7 0 0 0 6-6.9h-2z"/></svg>',
  micOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19 12h-2c0 .7-.2 1.4-.4 2l1.5 1.5c.6-1 .9-2.2.9-3.5zm-4 .2V6a3 3 0 0 0-5.9-.8L15 11.1v1.1zM4.3 3 3 4.3l6 6V12a3 3 0 0 0 4.4 2.6l1.6 1.6A5 5 0 0 1 7 12H5a7 7 0 0 0 6 6.9V21h2v-2.1c1-.1 1.9-.5 2.7-1l3.9 3.9 1.3-1.3L4.3 3z"/></svg>',
  speaker: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m9 16.2-4.2-4.2-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg>',
};

/* ---------------- state ---------------- */
const S = {
  settings: Store.settings(),
  view: 'talk',
  reviewId: null,
  talk: { scenarioId: 'free', custom: '', targets: [], targetSource: '' },
  learn: loadLesson(),
  models: loadModelCache(),
  convo: null,
  busy: {},
};

function saveSettings(patch) {
  Object.assign(S.settings, patch);
  Store.saveSettings(S.settings);
}
function loadLesson() {
  try { return JSON.parse(localStorage.getItem('charla.lesson')) || null; } catch (_) { return null; }
}
function saveLesson() {
  try { localStorage.setItem('charla.lesson', JSON.stringify(S.learn)); } catch (_) {}
}
function loadModelCache() {
  try { return JSON.parse(localStorage.getItem('charla.models')) || null; } catch (_) { return null; }
}

function hasKey() { return !!S.settings.apiKey; }
function coachModel() { return S.settings.coachModel || 'gemini-flash-latest'; }

/* ---------------- navigation ---------------- */
function go(view, opts = {}) {
  S.view = view;
  if (opts.reviewId !== undefined) S.reviewId = opts.reviewId;
  render();
  window.scrollTo(0, 0);
}

function render() {
  const main = $('#main');
  const views = { talk: renderTalk, learn: renderLearn, words: renderWords, history: renderHistory, review: renderReview, settings: renderSettings };
  main.innerHTML = (views[S.view] || renderTalk)();
  const tabView = S.view === 'review' ? 'history' : S.view;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === tabView));
  afterRender();
}

function afterRender() {
  if (S.view === 'review') maybeSummarize();
}

/* ---------------- Talk (setup) ---------------- */
function scenarioText() {
  const t = S.talk;
  if (t.scenarioId === 'custom') return clean(t.custom) || 'Just chatting naturally as friends.';
  const sc = P.SCENARIOS.find((s) => s.id === t.scenarioId) || P.SCENARIOS[0];
  return sc.desc;
}

function keyBanner() {
  return hasKey() ? '' : `<div class="banner">First, add your free Gemini API key in <a href="#" data-act="go" data-view="settings">Settings</a>. It takes about a minute.</div>`;
}

function renderTalk() {
  const s = S.settings;
  const p = P.persona(s.region, s.voice);
  const t = S.talk;
  return `
    <h2>¡Hola!</h2>
    <p class="lede">Choose who you're talking with, then just talk.</p>
    ${keyBanner()}
    <h3>Accent</h3>
    <div class="seg">
      ${Object.entries(P.REGIONS).map(([k, r]) => `<button data-act="region" data-v="${k}" class="${s.region === k ? 'on' : ''}">${r.flag} ${r.label}</button>`).join('')}
    </div>
    <h3>Your level</h3>
    <div class="seg">
      ${Object.entries(P.LEVELS).map(([k, l]) => `<button data-act="level" data-v="${k}" class="${s.level === k ? 'on' : ''}">${l.label}</button>`).join('')}
    </div>
    <h3>Situation</h3>
    <div class="chips">
      ${P.SCENARIOS.map((sc) => `<button class="chip ${t.scenarioId === sc.id ? 'on' : ''}" data-act="scenario" data-v="${sc.id}">${esc(sc.label)}</button>`).join('')}
      <button class="chip ${t.scenarioId === 'custom' ? 'on' : ''}" data-act="scenario" data-v="custom">Custom…</button>
    </div>
    ${t.scenarioId === 'custom' ? `<div style="margin-top:10px"><textarea id="customScenario" placeholder="e.g. You're my landlord and I'm calling about a broken heater">${esc(t.custom)}</textarea></div>` : ''}
    ${t.targets.length ? `
      <h3>Practicing</h3>
      <div class="card">
        <div class="chips">${t.targets.map((x) => `<span class="target">${esc(x)}</span>`).join('')}</div>
        <div class="row" style="margin-top:10px"><span class="muted small">${esc(p.name)} will steer the chat so you can use these.</span><span class="spacer"></span><button class="btn sm ghost" data-act="clear-targets">Clear</button></div>
      </div>` : ''}
    <div style="margin-top:22px">
      <button class="btn primary block big" data-act="start" ${hasKey() ? '' : 'disabled'}>Talk with ${esc(p.name)}</button>
    </div>
    <div class="card stack" style="margin-top:16px">
      <div class="small"><b>Mid-conversation you can say:</b></div>
      <div class="small">🐢 <i>"Más despacio, por favor"</i> to slow down</div>
      <div class="small">🤔 <i>"How do I say ___?"</i> to get the Spanish</div>
      <div class="small">💬 Tap any message for English or an explanation.</div>
    </div>`;
}

/* ---------------- Learn ---------------- */
const LEARN_TOPICS = ['Ordering food & drinks', 'Small talk & how I feel', 'Making plans with friends', 'Talking about my job', 'Getting around the city', 'Slang friends actually use'];

function vocabCard(item, i, opts = {}) {
  const saved = Store.hasWord(item.spanish);
  return `
    <div class="card vocab">
      <div class="main">
        <div class="es">${esc(item.spanish)}</div>
        <div class="enx">${esc(item.english)}</div>
        ${item.example ? `<div class="ex">${esc(item.example)}${item.exampleEnglish ? `<div class="exen">${esc(item.exampleEnglish)}</div>` : ''}</div>` : ''}
        ${item.note ? `<div class="note">${esc(item.note)}</div>` : ''}
      </div>
      <div class="stack">
        <button class="round" data-act="speak" data-text="${esc(item.spanish)}" aria-label="Hear it">${ICON.speaker}</button>
        ${opts.noSave ? '' : `<button class="round ${saved ? 'on' : ''}" data-act="save-lesson-item" data-i="${i}" aria-label="Save to my words">${saved ? ICON.check : ICON.plus}</button>`}
      </div>
    </div>`;
}

function renderLearn() {
  const L = S.learn;
  const loading = S.busy.learn;
  return `
    <h2>Learn</h2>
    <p class="lede">Learn new words and phrases, then use them in a real conversation.</p>
    ${keyBanner()}
    <label class="field" style="margin-top:12px">
      <span>What do you want to learn?</span>
      <textarea id="learnInput" placeholder="A topic (like &quot;talking about my weekend&quot;) or the exact things you want to say, like &quot;I'm running late&quot;, &quot;it's my treat&quot;">${esc(L && L.request ? L.request : '')}</textarea>
    </label>
    <div class="chips" style="margin-top:10px">
      ${LEARN_TOPICS.map((x) => `<button class="chip" data-act="learn-topic" data-v="${esc(x)}">${esc(x)}</button>`).join('')}
    </div>
    <div style="margin-top:14px">
      <button class="btn primary block" data-act="learn-go" ${loading || !hasKey() ? 'disabled' : ''}>${loading ? '<span class="spinner"></span> Building your lesson…' : `Make my ${P.REGIONS[S.settings.region].label} lesson`}</button>
    </div>
    ${L && L.items && L.items.length ? `
      <h3>${esc(L.title || 'Your lesson')} · ${P.REGIONS[L.region || S.settings.region].flag}</h3>
      <div class="stack">${L.items.map((it, i) => vocabCard(it, i)).join('')}</div>
      <div class="stack" style="margin-top:16px">
        <button class="btn primary block big" data-act="practice-lesson">Practice these in a conversation</button>
        <button class="btn block" data-act="save-lesson-all">Save all to My words</button>
      </div>` : ''}`;
}

async function makeLesson() {
  const input = $('#learnInput');
  const request = clean(input && input.value);
  if (!request) return toast('Type a topic or some phrases first');
  S.busy.learn = true;
  S.learn = { ...(S.learn || {}), request };
  render();
  try {
    const res = await G.generate(S.settings.apiKey, coachModel(), {
      prompt: P.learnPrompt({ region: S.settings.region, level: S.settings.level, request }),
      json: true,
      temperature: 0.6,
    });
    S.learn = { request, title: res.title, items: (res.items || []).filter((x) => x && x.spanish), region: S.settings.region };
    saveLesson();
  } catch (e) {
    toast('Couldn\'t make the lesson: ' + e.message, 5000);
  } finally {
    S.busy.learn = false;
    if (S.view === 'learn') render();
  }
}

/* ---------------- My words ---------------- */
function renderWords() {
  const words = Store.words();
  return `
    <h2>My words</h2>
    <p class="lede">Words and phrases you've saved from lessons and conversations.</p>
    ${words.length ? `
      <button class="btn primary block" data-act="practice-words" style="margin:10px 0 6px">Practice some in a conversation</button>
      <p class="hint" style="margin-bottom:14px">Picks up to 8 you've used the least.</p>
      <div class="stack">
        ${words.map((w) => `
          <div class="card vocab">
            <div class="main">
              <div class="es">${esc(w.spanish)}</div>
              <div class="enx">${esc(w.english)}</div>
              ${w.example ? `<div class="ex">${esc(w.example)}${w.exampleEnglish ? `<div class="exen">${esc(w.exampleEnglish)}</div>` : ''}</div>` : ''}
              ${w.note ? `<div class="note">${esc(w.note)}</div>` : ''}
              <div class="hint">${w.region ? P.REGIONS[w.region].flag + ' ' : ''}Used in conversation ${w.practiced || 0}×</div>
            </div>
            <div class="stack">
              <button class="round" data-act="speak" data-text="${esc(w.spanish)}" data-region="${esc(w.region)}" aria-label="Hear it">${ICON.speaker}</button>
              <button class="round" data-act="delete-word" data-id="${w.id}" aria-label="Remove">${ICON.x}</button>
            </div>
          </div>`).join('')}
      </div>` : `<div class="card muted" style="margin-top:14px">Nothing saved yet. Tap <b>＋</b> on a lesson card, a "How to say it" tip, or new vocab in a conversation review.</div>`}`;
}

/* ---------------- History / Review ---------------- */
function renderHistory() {
  const sessions = Store.sessions();
  return `
    <h2>Review</h2>
    <p class="lede">Look back at past conversations, your corrections, and new vocab.</p>
    <div class="stack" style="margin-top:14px">
      ${sessions.length ? sessions.map((s) => {
        const userTurns = s.turns.filter((t) => t.role === 'user' && clean(t.text));
        const fixes = userTurns.reduce((n, t) => n + ((t.coach && t.coach.corrections && t.coach.corrections.length) || 0), 0);
        return `<button class="list-item" data-act="open-review" data-id="${s.id}">
          <span class="avatar">${P.REGIONS[s.region].flag}</span>
          <span style="flex:1;min-width:0">
            <span class="t">${esc(s.personaName)} · ${esc(s.scenarioLabel)}</span><br>
            <span class="s">${fmtDate(s.startedAt)} · ${userTurns.length} turns · ${fixes} corrections</span>
          </span>
        </button>`;
      }).join('') : '<div class="card muted">No conversations yet. Go to <b>Talk</b> and start one.</div>'}
    </div>`;
}

function turnHTML(t, opts) {
  const text = clean(t.text);
  if (!text && !opts.live) return '';
  const showEn = opts.showEnglish && t.role === 'partner';
  const en = showEn ? (t.translation ? `<span class="en">${esc(t.translation)}</span>` : (t.done ? `<span class="en muted">translating…</span>` : '')) : '';
  return `
    <div class="turn ${t.role}">
      <button class="bubble ${t.done ? '' : 'live'}" data-act="turn" data-id="${t.id}">
        ${text ? esc(text) : '<span class="typing"></span>'}${t.interrupted ? ' <span class="cut">(cut off)</span>' : ''}
        ${en}
      </button>
      ${t.role === 'user' ? coachHTML(t, opts) : ''}
    </div>`;
}

function coachHTML(t, opts) {
  if (!clean(t.text)) return '';
  if (t.coachPending) return `<div class="coach pending"><span class="spinner"></span> coach is checking…</div>`;
  if (t.coachError) return `<div class="coach pending">Coach couldn't check this (${esc(t.coachError)}).${opts.live ? ` <button class="mini" data-act="recoach" data-id="${t.id}">Retry</button>` : ''}</div>`;
  const c = t.coach;
  if (!c) return '';
  const region = opts.region;
  let out = '';
  const h = c.howToSay;
  if (h && h.spanish) {
    const saved = Store.hasWord(h.spanish);
    out += `<div class="coach say">
      <div class="lbl">How to say it</div>
      ${h.english ? `<div class="muted small">"${esc(h.english)}"</div>` : ''}
      <div class="say-es">${esc(h.spanish)}</div>
      ${h.note ? `<div class="small muted">${esc(h.note)}</div>` : ''}
      <div class="actions">
        <button class="mini" data-act="speak" data-text="${esc(h.spanish)}" data-region="${region}">🔊 Hear</button>
        <button class="mini" data-act="save-word" data-es="${esc(h.spanish)}" data-en="${esc(h.english)}" data-region="${region}">${saved ? '✓ Saved' : '＋ Save'}</button>
      </div>
    </div>`;
  }
  const fixes = (c.corrections || []).filter((f) => f && (f.said || f.better));
  if (fixes.length) {
    out += `<div class="coach fix">
      <div class="lbl">Coach</div>
      ${fixes.map((f) => `<div class="fix-item">
        ${f.type ? `<div class="fix-type">${esc(f.type)}</div>` : ''}
        <s>${esc(f.said)}</s> → <b>${esc(f.better)}</b>
        ${f.why ? `<div class="why">${esc(f.why)}</div>` : ''}
      </div>`).join('')}
      ${c.betterVersion ? `<div class="better small"><span class="muted">Natural version:</span> ${esc(c.betterVersion)}</div>` : ''}
    </div>`;
  } else if (c.betterVersion && !(h && h.spanish)) {
    out += `<div class="coach fix"><div class="lbl">Sounds more natural</div><div>${esc(c.betterVersion)}</div></div>`;
  } else if (c.nice) {
    out += `<div class="coach ok">✓ ${esc(c.nice)}</div>`;
  }
  return out;
}

function renderReview() {
  const s = Store.session(S.reviewId);
  if (!s) return `<p>Conversation not found.</p><button class="btn" data-act="go" data-view="history">Back</button>`;
  const mins = s.endedAt ? Math.max(1, Math.round((s.endedAt - s.startedAt) / 60000)) : null;
  return `
    <div class="row" style="margin-top:6px"><button class="btn sm ghost" data-act="go" data-view="history">‹ All conversations</button></div>
    <h2>${P.REGIONS[s.region].flag} ${esc(s.personaName)}</h2>
    <p class="lede">${esc(s.scenarioLabel)} · ${fmtDate(s.startedAt)}${mins ? ` · ${mins} min` : ''}</p>
    ${summaryHTML(s)}
    <h3>Conversation</h3>
    <p class="hint" style="margin-top:-4px">Tap any message for an explanation.</p>
    <div style="margin-top:10px">${s.turns.map((t) => turnHTML({ ...t, done: true }, { showEnglish: true, region: s.region })).join('')}</div>
    <div class="stack" style="margin-top:20px">
      <button class="btn primary block" data-act="again" data-id="${s.id}">Talk with ${esc(s.personaName)} again</button>
      <button class="btn block ghost danger" data-act="delete-session" data-id="${s.id}">Delete this conversation</button>
    </div>`;
}

function summaryHTML(s) {
  const hasUser = s.turns.some((t) => t.role === 'user' && clean(t.text));
  if (!hasUser) return '';
  if (S.busy['sum-' + s.id]) return `<div class="card"><span class="spinner"></span> Writing your review…</div>`;
  if (!s.summary) {
    return `<div class="card">${s.summaryError ? `<div class="muted small">Couldn't write the review: ${esc(s.summaryError)}</div>` : ''}<button class="btn primary block" data-act="summarize" data-id="${s.id}" style="margin-top:8px">Write my review</button></div>`;
  }
  const m = s.summary;
  const targets = s.targets && s.targets.length
    ? `<div style="margin-top:12px"><div class="small"><b>Target phrases</b></div><div class="chips" style="margin-top:6px">${s.targets.map((x) => `<span class="target ${(s.targetsUsed || []).includes(x) ? 'done' : ''}">${esc(x)}</span>`).join('')}</div></div>`
    : '';
  return `
    <div class="card">
      <div class="sum-head">${esc(m.headline)}</div>
      ${m.wentWell && m.wentWell.length ? `<div style="margin-top:12px"><div class="small"><b>✓ Went well</b></div><ul class="pill-list small">${m.wentWell.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${targets}
    </div>
    ${m.focusOn && m.focusOn.length ? `<h3>Work on</h3><div class="card">${m.focusOn.map((f) => `
      <div class="focus">
        <div class="ft">${esc(f.topic)}</div>
        <div class="small">${esc(f.explanation)}</div>
        ${(f.examples || []).map((e) => `<div class="small" style="margin-top:4px"><s class="muted">${esc(e.said)}</s> → <b>${esc(e.better)}</b></div>`).join('')}
      </div>`).join('')}</div>` : ''}
    ${m.newVocab && m.newVocab.length ? `<h3>New vocab</h3><div class="stack">${m.newVocab.map((v) => {
      const saved = Store.hasWord(v.spanish);
      return `<div class="card vocab"><div class="main"><div class="es">${esc(v.spanish)}</div><div class="enx">${esc(v.english)}</div></div>
        <div class="row"><button class="round" data-act="speak" data-text="${esc(v.spanish)}" data-region="${s.region}">${ICON.speaker}</button>
        <button class="round ${saved ? 'on' : ''}" data-act="save-word" data-es="${esc(v.spanish)}" data-en="${esc(v.english)}" data-region="${s.region}">${saved ? ICON.check : ICON.plus}</button></div></div>`;
    }).join('')}</div>` : ''}`;
}

function maybeSummarize() {
  const s = Store.session(S.reviewId);
  if (!s || s.summary || s.summaryError || S.busy['sum-' + s.id] || !hasKey()) return;
  if (!s.turns.some((t) => t.role === 'user' && clean(t.text))) return;
  summarize(s.id);
}

function transcriptForAI(turns, limit) {
  const list = limit ? turns.slice(-limit) : turns;
  return list.filter((t) => clean(t.text)).map((t) => {
    let line = `${t.role === 'user' ? 'LEARNER' : 'PARTNER'}: ${clean(t.text)}`;
    if (t.role === 'user' && t.coach && t.coach.corrections && t.coach.corrections.length) {
      line += `\n   [coach: ${t.coach.corrections.map((c) => `"${c.said}" → "${c.better}" (${c.type || ''})`).join('; ')}]`;
    }
    return line;
  }).join('\n');
}

async function summarize(id) {
  const s = Store.session(id);
  if (!s) return;
  S.busy['sum-' + id] = true;
  delete s.summaryError;
  Store.saveSession(s);
  if (S.view === 'review') render();
  try {
    const res = await G.generate(S.settings.apiKey, coachModel(), {
      prompt: P.summaryPrompt({ region: s.region, transcript: transcriptForAI(s.turns), targets: s.targets }),
      json: true,
    });
    const fresh = Store.session(id);
    fresh.summary = res;
    Store.saveSession(fresh);
  } catch (e) {
    const fresh = Store.session(id);
    fresh.summaryError = e.message;
    Store.saveSession(fresh);
  } finally {
    delete S.busy['sum-' + id];
    if (S.view === 'review' && S.reviewId === id) render();
  }
}

/* ---------------- Settings ---------------- */
function modelOptions(list, current, fallbackLabel) {
  if (!list || !list.length) {
    return `<option value="${esc(current)}">${esc(current || fallbackLabel)}</option>`;
  }
  const has = list.some((m) => m.name === current);
  return (has ? '' : `<option value="" ${current ? '' : 'selected'}>Auto (best available)</option>`) +
    list.map((m) => `<option value="${esc(m.name)}" ${m.name === current ? 'selected' : ''}>${esc(m.displayName || m.name)} — ${esc(m.name.replace('models/', ''))}</option>`).join('');
}

function renderSettings() {
  const s = S.settings;
  const M = S.models;
  return `
    <h2>Settings</h2>
    <h3>Gemini API key</h3>
    <div class="card stack">
      <label class="field">
        <span>Your key</span>
        <input type="password" id="apiKey" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="AIza…" value="${esc(s.apiKey)}">
      </label>
      <div class="row wrap">
        <button class="btn primary sm" data-act="save-key">${S.busy.key ? '<span class="spinner"></span> Checking…' : 'Save & check key'}</button>
        <button class="btn sm ghost" data-act="toggle-key">Show</button>
      </div>
      <div class="hint">Get a free key at <b>aistudio.google.com/apikey</b>. It's stored only on this phone and sent only to Google.</div>
    </div>

    <h3>Models</h3>
    <div class="card stack">
      <label class="field"><span>Live voice model</span>
        <select id="liveModel">${modelOptions(M && M.live, s.liveModel, 'Check your key to load models')}</select>
      </label>
      <label class="field"><span>Coach model (corrections, translations, lessons)</span>
        <select id="coachModel">${modelOptions(M && M.text, s.coachModel, 'gemini-flash-latest')}</select>
      </label>
      <div class="hint">"Save & check key" loads the models your key can use and picks the best ones.</div>
    </div>

    <h3>Conversation partner</h3>
    <div class="card stack">
      <label class="field"><span>Voice</span>
        <select id="voice">
          <optgroup label="Female">${P.VOICES.female.map((v) => `<option ${v === s.voice ? 'selected' : ''}>${v}</option>`).join('')}</optgroup>
          <optgroup label="Male">${P.VOICES.male.map((v) => `<option ${v === s.voice ? 'selected' : ''}>${v}</option>`).join('')}</optgroup>
        </select>
      </label>
      <div class="hint">Female voices talk as ${P.persona('AR', 'Aoede').name} (🇦🇷) or ${P.persona('CO', 'Aoede').name} (🇨🇴); male voices as ${P.persona('AR', 'Puck').name} or ${P.persona('CO', 'Puck').name}.</div>
    </div>

    <h3>How turns work</h3>
    <div class="card stack">
      <div class="seg">
        <button data-act="turnmode" data-v="handsfree" class="${s.turnMode === 'handsfree' ? 'on' : ''}">Hands-free</button>
        <button data-act="turnmode" data-v="tap" class="${s.turnMode === 'tap' ? 'on' : ''}">Tap to talk</button>
      </div>
      <div class="hint">${s.turnMode === 'tap' ? 'Tap the mic, say everything, tap again when you\'re done. Pause as long as you need to think.' : 'Just talk. Your partner replies when you pause.'}</div>
      ${s.turnMode === 'handsfree' ? `
        <label class="field" style="margin-top:6px"><span>Wait <span id="silenceVal">${(s.silenceMs / 1000).toFixed(1)}</span>s of silence before replying</span>
          <input type="range" id="silenceMs" min="600" max="3000" step="100" value="${s.silenceMs}">
        </label>
        <div class="hint">Raise this if your partner jumps in while you're still thinking.</div>
        <label class="toggle"><span>Mute my mic while partner is talking<div class="hint">Stops the speaker's sound from interrupting. Turn off with headphones if you want to interrupt.</div></span>
          <input type="checkbox" id="muteWhilePartner" ${s.muteWhilePartner ? 'checked' : ''}></label>` : ''}
      <label class="toggle"><span>Show English under every message</span><input type="checkbox" id="showEnglish" ${s.showEnglish ? 'checked' : ''}></label>
    </div>

    <h3>Your data</h3>
    <div class="card stack">
      <div class="small muted">Conversations and words are saved only in this browser on this phone.</div>
      <div class="row wrap">
        <button class="btn sm" data-act="export">Export backup</button>
        <button class="btn sm" data-act="import">Import backup</button>
        <button class="btn sm ghost danger" data-act="clear-history">Delete all conversations</button>
      </div>
      <input type="file" id="importFile" accept="application/json" hidden>
    </div>
    <p class="hint" style="text-align:center;margin-top:20px">Charla · personal Spanish practice</p>`;
}

async function saveKey() {
  const key = clean($('#apiKey').value);
  if (!key) return toast('Paste your key first');
  S.busy.key = true;
  saveSettings({ apiKey: key });
  render();
  try {
    const all = await G.listModels(key);
    const live = G.liveModels(all).map((m) => ({ name: m.name, displayName: m.displayName }));
    const text = G.textModels(all).map((m) => ({ name: m.name, displayName: m.displayName }));
    S.models = { live, text };
    try { localStorage.setItem('charla.models', JSON.stringify(S.models)); } catch (_) {}
    const patch = {};
    if (!live.some((m) => m.name === S.settings.liveModel) && live[0]) patch.liveModel = live[0].name;
    if (!text.some((m) => m.name === S.settings.coachModel) && text[0]) patch.coachModel = text[0].name;
    saveSettings(patch);
    toast(live.length ? 'Key works! You\'re ready to talk.' : 'Key works, but no live voice models were found for it.', 4000);
  } catch (e) {
    toast('That key didn\'t work: ' + e.message, 6000);
  } finally {
    S.busy.key = false;
    if (S.view === 'settings') render();
  }
}

/* ---------------- Live conversation ---------------- */
class Conversation {
  constructor({ scenarioLabel, scenario, targets, targetSource }) {
    const st = S.settings;
    const p = P.persona(st.region, st.voice);
    this.session = {
      id: uid(),
      startedAt: Date.now(),
      region: st.region,
      level: st.level,
      voice: st.voice,
      personaName: p.name,
      scenarioLabel,
      scenario,
      targets: targets || [],
      targetSource: targetSource || '',
      targetsUsed: [],
      turns: [],
    };
    this.showEnglish = st.showEnglish;
    this.mode = st.turnMode;
    this.muted = false;
    this.talking = false;
    this.dropAudio = false;
    this.state = 'connecting';
    this.curUser = null;
    this.curPartner = null;
    this.coachChain = Promise.resolve();
    this.level = 0;
  }

  // Must be called directly from a tap (iOS audio unlock).
  async start() {
    this.audio = new AudioEngine();
    const audioReady = this.audio.init();
    this.mount();
    try {
      await audioReady;
      await this.audio.startMic((c) => this.onMic(c));
    } catch (e) {
      this.fail(e && e.name === 'NotAllowedError'
        ? 'Microphone access was blocked. Allow it in iPhone Settings › Safari › Microphone (or the site settings), then try again.'
        : 'Couldn\'t start the microphone: ' + (e && e.message));
      return;
    }
    if (!S.settings.liveModel) {
      this.fail('No live voice model selected. Open Settings and tap "Save & check key".');
      return;
    }
    this.baseInstruction = P.systemInstruction({
      region: this.session.region,
      level: this.session.level,
      voice: this.session.voice,
      scenario: this.session.scenario,
      targets: this.session.targets,
    });
    this.live = new LiveSession({
      apiKey: S.settings.apiKey,
      model: S.settings.liveModel,
      systemInstruction: this.baseInstruction,
      voiceName: this.session.voice,
      manualTurns: this.mode === 'tap',
      silenceMs: S.settings.silenceMs,
      on: {
        audio: (b64, mime) => this.onAudio(b64, mime),
        inputText: (t) => this.onInputText(t),
        outputText: (t) => this.onOutputText(t),
        interrupted: () => this.onInterrupted(),
        turnComplete: () => this.finalize(),
        status: (s) => { if (s === 'reconnecting') this.setState('reconnecting'); if (s === 'reconnected') this.setState('live'); },
        error: (m) => toast(m, 5000),
        closed: (reason) => this.onClosed(reason),
      },
    });
    try {
      await this.live.connect();
    } catch (e) {
      this.fail('Couldn\'t connect to Gemini: ' + e.message);
      return;
    }
    this.setState('live');
    this.live.sendText(P.KICKOFF);
    this.wake();
    this.timer = setInterval(() => this.updateDock(), 150);
  }

  async wake() {
    try { this.wakeLock = await navigator.wakeLock.request('screen'); } catch (_) {}
  }

  mount() {
    const el = $('#convo');
    const R = P.REGIONS[this.session.region];
    el.innerHTML = `
      <div class="convo-head">
        <span class="avatar">${R.flag}</span>
        <div class="who">
          <div class="name">${esc(this.session.personaName)}</div>
          <div class="meta">${esc(R.city)} · ${esc(this.session.scenarioLabel)}</div>
        </div>
        <button class="en-toggle ${this.showEnglish ? 'on' : ''}" data-act="en-all">EN</button>
        <button class="end-btn" data-act="end">End</button>
      </div>
      ${this.session.targets.length ? `<div class="targets" id="targets"></div>` : ''}
      <div class="transcript" id="transcript"></div>
      <div class="dock">
        <div class="status" id="status">Connecting…</div>
        <button class="mic wait" id="micBtn" data-act="mic" aria-label="Microphone">${ICON.mic}</button>
        <div class="tip" id="tip"></div>
      </div>`;
    el.hidden = false;
    document.body.style.overflow = 'hidden';
    this.renderTranscript();
    this.renderTargets();
    this.updateDock();
  }

  setState(s) {
    this.state = s;
    this.updateDock();
  }

  fail(msg) {
    this.state = 'error';
    this.errorMsg = msg;
    this.updateDock();
  }

  updateDock() {
    const btn = $('#micBtn');
    const status = $('#status');
    const tip = $('#tip');
    if (!btn) return;
    const name = this.session.personaName;
    let cls = 'mic';
    let icon = ICON.mic;
    let msg = '';
    let tipText = '';
    const playing = this.audio && this.audio.isPlaying();
    if (this.state === 'connecting') { cls += ' wait'; msg = 'Connecting…'; }
    else if (this.state === 'reconnecting') { cls += ' wait'; msg = 'Reconnecting…'; }
    else if (this.state === 'error') { cls += ' off'; icon = ICON.micOff; msg = this.errorMsg; tipText = 'Tap End to go back.'; }
    else if (this.state === 'closed') { cls += ' off'; icon = ICON.micOff; msg = 'Disconnected.'; tipText = 'Tap the mic to reconnect, or End to finish.'; }
    else if (this.mode === 'tap') {
      if (this.talking) { msg = 'Listening… tap when you\'re done'; }
      else if (playing) { cls += ' partner'; icon = ICON.speaker; msg = `${name} is talking…`; tipText = 'Tap to interrupt'; }
      else { cls += ' off'; msg = 'Tap to talk'; }
    } else {
      if (this.muted) { cls += ' off'; icon = ICON.micOff; msg = 'Muted'; tipText = 'Tap to unmute'; }
      else if (playing) { cls += ' partner'; icon = ICON.speaker; msg = `${name} is talking…`; }
      else { msg = 'Listening… just talk'; tipText = 'Say "más despacio" or "how do I say…?" anytime'; }
    }
    if (btn.className !== cls) btn.className = cls;
    if (btn.dataset.icon !== icon) { btn.innerHTML = icon; btn.dataset.icon = icon; }
    if (status.textContent !== msg) status.textContent = msg;
    if (tip.textContent !== tipText) tip.textContent = tipText;
    const lvl = cls === 'mic' ? Math.min(1, this.level * 6) : 0;
    btn.style.setProperty('--lvl', lvl.toFixed(2));
  }

  onMic({ pcm, rms }) {
    this.level = rms;
    if (!this.live || !this.live.ready) return;
    if (this.mode === 'tap') {
      if (!this.talking) return;
    } else {
      if (this.muted) return;
      if (S.settings.muteWhilePartner && this.audio.isPlaying(0.35)) return;
    }
    this.live.sendAudio(bytesToBase64(pcm));
  }

  async onMicTap() {
    if (this.state === 'closed') return this.reconnect();
    if (this.state !== 'live') return;
    if (this.mode === 'tap') {
      if (!this.talking) {
        if (this.audio.isPlaying() || this.curPartner) {
          this.audio.stopPlayback();
          if (this.curPartner) this.dropAudio = true;
        }
        this.talking = true;
        this.live.activityStart();
      } else {
        this.talking = false;
        this.live.activityEnd();
      }
    } else {
      this.muted = !this.muted;
    }
    this.updateDock();
  }

  async reconnect() {
    // Fresh connection with a recap so the partner picks up where you left off.
    const recap = transcriptForAI(this.session.turns, 16);
    this.live.o.systemInstruction = this.baseInstruction + (recap
      ? `\n\nCONVERSATION SO FAR (continue it naturally from here, don't greet again):\n${recap.replace(/LEARNER/g, 'FRIEND').replace(/PARTNER/g, 'YOU')}`
      : '');
    this.live.ended = false;
    this.live.reconnects = 0;
    this.setState('reconnecting');
    try {
      await this.live.connect();
      this.setState('live');
    } catch (e) {
      this.setState('closed');
      toast('Couldn\'t reconnect: ' + e.message, 5000);
    }
  }

  onClosed(reason) {
    if (this.ending) return;
    this.talking = false;
    this.setState('closed');
    if (reason) toast('Connection closed: ' + reason, 5000);
  }

  addTurn(role, beforeTurn) {
    const t = { id: uid(), role, text: '', done: false };
    const turns = this.session.turns;
    const idx = beforeTurn ? turns.indexOf(beforeTurn) : -1;
    if (idx >= 0) turns.splice(idx, 0, t); else turns.push(t);
    return t;
  }

  onAudio(b64, mime) {
    if (this.dropAudio) return;
    if (!this.curPartner) this.curPartner = this.addTurn('partner');
    this.audio.play(b64, mime);
  }

  onOutputText(t) {
    if (this.dropAudio) return;
    if (!this.curPartner) this.curPartner = this.addTurn('partner');
    this.curPartner.text += t;
    this.scheduleRender();
  }

  onInputText(t) {
    if (!this.curUser) this.curUser = this.addTurn('user', this.curPartner);
    this.curUser.text += t;
    this.scheduleRender();
  }

  onInterrupted() {
    this.audio.stopPlayback();
    if (this.curPartner) this.curPartner.interrupted = true;
    this.finalize();
  }

  finalize() {
    const u = this.curUser;
    const p = this.curPartner;
    this.curUser = null;
    this.curPartner = null;
    this.dropAudio = false;
    if (u) u.done = true;
    if (p) p.done = true;
    if (u && clean(u.text)) u.coachPending = true;
    if ((u && clean(u.text)) || (p && clean(p.text))) this.queueCoach(u, p);
    this.scheduleRender();
    this.save();
  }

  queueCoach(u, p) {
    this.coachChain = this.coachChain.then(() => this.coach(u, p)).catch(() => {});
  }

  async coach(u, p) {
    const turns = this.session.turns;
    const idx = turns.indexOf(u || p);
    const context = transcriptForAI(turns.slice(Math.max(0, idx - 8), Math.max(0, idx)));
    const learner = u && clean(u.text);
    const partner = p && clean(p.text);
    try {
      const res = await G.generate(S.settings.apiKey, coachModel(), {
        system: P.coachSystem(this.session.region),
        prompt: P.coachPrompt({ context, learner, partner, targets: this.session.targets }),
        json: true,
        temperature: 0.2,
      });
      if (p && partner && res.translation) p.translation = res.translation;
      if (u && learner) {
        u.coach = {
          corrections: Array.isArray(res.corrections) ? res.corrections : [],
          betterVersion: res.betterVersion || null,
          howToSay: res.howToSay && res.howToSay.spanish ? res.howToSay : null,
          nice: res.nice || null,
        };
        delete u.coachError;
      }
      for (const x of res.targetsUsed || []) {
        const match = this.session.targets.find((t) => t.toLowerCase() === String(x).toLowerCase());
        if (match && !this.session.targetsUsed.includes(match)) this.session.targetsUsed.push(match);
      }
    } catch (e) {
      if (u && learner) u.coachError = e.status === 429 ? 'rate limit — wait a moment' : e.message;
    } finally {
      if (u) delete u.coachPending;
      this.scheduleRender();
      this.renderTargets();
      this.save();
    }
  }

  recoach(id) {
    const turns = this.session.turns;
    const u = turns.find((t) => t.id === id);
    if (!u) return;
    const i = turns.indexOf(u);
    const p = turns.slice(i + 1).find((t) => t.role === 'partner') || null;
    u.coachPending = true;
    delete u.coachError;
    this.scheduleRender();
    this.queueCoach(u, p);
  }

  scheduleRender() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = null;
      this.renderTranscript();
    });
  }

  renderTranscript() {
    const box = $('#transcript');
    if (!box) return;
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    const turns = this.session.turns.filter((t) => clean(t.text) || (!t.done && t.role === 'partner'));
    box.innerHTML = turns.length
      ? turns.map((t) => turnHTML(t, { showEnglish: this.showEnglish, live: true, region: this.session.region })).join('')
      : `<div class="empty">${this.state === 'connecting' ? 'Connecting…' : `${esc(this.session.personaName)} will say hi in a second…`}</div>`;
    if (nearBottom) box.scrollTop = box.scrollHeight;
  }

  renderTargets() {
    const el = $('#targets');
    if (!el) return;
    el.innerHTML = this.session.targets.map((x) => `<span class="target ${this.session.targetsUsed.includes(x) ? 'done' : ''}">${esc(x)}</span>`).join('');
  }

  toggleEnglish() {
    this.showEnglish = !this.showEnglish;
    $('.en-toggle').classList.toggle('on', this.showEnglish);
    if (this.showEnglish) {
      for (const t of this.session.turns) if (t.role === 'partner' && t.done && clean(t.text) && !t.translation) ensureTranslation(this.session, t);
    }
    this.renderTranscript();
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.persist(), 400);
  }

  persist() {
    if (this.session.turns.some((t) => clean(t.text))) {
      const copy = JSON.parse(JSON.stringify(this.session));
      copy.turns = copy.turns.filter((t) => clean(t.text)).map((t) => { delete t.coachPending; delete t.done; return t; });
      Store.saveSession(copy);
    }
  }

  async end() {
    if (this.ending) return;
    this.ending = true;
    clearInterval(this.timer);
    try { this.live && this.live.close(); } catch (_) {}
    try { this.wakeLock && this.wakeLock.release(); } catch (_) {}
    await (this.audio && this.audio.close());
    if (this.curUser || this.curPartner) this.finalize();
    $('#status') && ($('#status').textContent = 'Saving…');
    await Promise.race([this.coachChain, new Promise((r) => setTimeout(r, 12000))]);
    this.session.endedAt = Date.now();
    this.persist();
    // count practiced words
    if (this.session.targetSource === 'words' && this.session.targetsUsed.length) {
      const words = Store.words();
      for (const w of words) if (this.session.targetsUsed.includes(w.spanish)) w.practiced = (w.practiced || 0) + 1;
      Store.saveWords(words);
    }
    $('#convo').hidden = true;
    $('#convo').innerHTML = '';
    document.body.style.overflow = '';
    S.convo = null;
    const saved = Store.session(this.session.id);
    if (saved) go('review', { reviewId: saved.id }); else go('talk');
  }
}

async function ensureTranslation(session, t) {
  if (t.translation || t.translating) return;
  t.translating = true;
  try {
    t.translation = await G.generate(S.settings.apiKey, coachModel(), { system: P.translateSystem(session.region), prompt: clean(t.text), temperature: 0.2 });
  } catch (e) {
    toast('Translation failed: ' + e.message);
  } finally {
    delete t.translating;
    persistTurnChange(session);
  }
}

function persistTurnChange(session) {
  if (S.convo && S.convo.session === session) {
    S.convo.scheduleRender();
    S.convo.save();
  } else {
    Store.saveSession(session);
    if (S.view === 'review') render();
  }
}

function startConversation({ scenarioLabel, scenario, targets, targetSource } = {}) {
  if (!hasKey()) { go('settings'); return toast('Add your API key first'); }
  const sc = P.SCENARIOS.find((x) => x.id === S.talk.scenarioId);
  const convo = new Conversation({
    scenarioLabel: scenarioLabel || (S.talk.scenarioId === 'custom' ? 'Custom' : (sc ? sc.label : 'Just chatting')),
    scenario: scenario || scenarioText(),
    targets: targets || S.talk.targets,
    targetSource: targetSource || S.talk.targetSource,
  });
  S.convo = convo;
  convo.start();
}

/* ---------------- Turn sheet (English / Explain) ---------------- */
function findSession(id) {
  if (S.convo && S.convo.session.turns.some((t) => t.id === id)) return S.convo.session;
  return Store.sessions().find((s) => s.turns.some((t) => t.id === id)) || null;
}

let sheetTurn = null;
function openTurnSheet(turnId) {
  const session = findSession(turnId);
  if (!session) return;
  const t = session.turns.find((x) => x.id === turnId);
  if (!t || !clean(t.text)) return;
  sheetTurn = { session, turn: t };
  renderSheet();
  $('#sheet').hidden = false;
  $('#sheetBackdrop').hidden = false;
  if (t.role === 'partner' && !t.translation) {
    ensureTranslation(session, t).then(() => sheetTurn && sheetTurn.turn === t && renderSheet());
  }
}

function renderSheet() {
  if (!sheetTurn) return;
  const { session, turn: t } = sheetTurn;
  const loading = S.busy['exp-' + t.id];
  $('#sheet').innerHTML = `
    <div class="grab"></div>
    <div class="small muted" style="margin-bottom:6px">${t.role === 'user' ? 'You said' : esc(session.personaName) + ' said'}</div>
    <div class="quote">${esc(clean(t.text))}</div>
    ${t.role === 'partner' ? `<div style="margin-top:10px;color:var(--info)">${t.translation ? esc(t.translation) : '<span class="spinner"></span> translating…'}</div>` : ''}
    ${t.explanation ? `<div class="md" style="margin-top:12px">${md(t.explanation)}</div>` : ''}
    <div class="sheet-actions">
      ${t.explanation ? '' : `<button class="btn primary block" data-act="explain" ${loading ? 'disabled' : ''}>${loading ? '<span class="spinner"></span> Explaining…' : 'Explain this'}</button>`}
      <button class="btn block" data-act="speak" data-text="${esc(clean(t.text))}" data-region="${session.region}">🔊 Hear it slowly (phone voice)</button>
      <button class="btn block ghost" data-act="close-sheet">Close</button>
    </div>`;
}

function closeSheet() {
  sheetTurn = null;
  $('#sheet').hidden = true;
  $('#sheetBackdrop').hidden = true;
}

async function explain() {
  if (!sheetTurn) return;
  const { session, turn: t } = sheetTurn;
  S.busy['exp-' + t.id] = true;
  renderSheet();
  try {
    const i = session.turns.indexOf(t);
    const context = transcriptForAI(session.turns.slice(Math.max(0, i - 6), i + 2));
    t.explanation = await G.generate(S.settings.apiKey, coachModel(), {
      prompt: P.explainPrompt({ region: session.region, role: t.role, text: clean(t.text), translation: t.translation, context, coach: t.coach }),
      temperature: 0.3,
    });
    persistTurnChange(session);
  } catch (e) {
    toast('Couldn\'t explain: ' + e.message, 5000);
  } finally {
    delete S.busy['exp-' + t.id];
    if (sheetTurn && sheetTurn.turn === t) renderSheet();
  }
}

/* ---------------- events ---------------- */
document.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (tab) return go(tab.dataset.view);
  if (e.target.closest('#settingsBtn')) return go('settings');
  if (e.target.id === 'sheetBackdrop') return closeSheet();

  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const v = el.dataset.v;

  switch (act) {
    case 'go': e.preventDefault(); return go(el.dataset.view);
    case 'region': saveSettings({ region: v }); return render();
    case 'level': saveSettings({ level: v }); return render();
    case 'scenario': S.talk.scenarioId = v; return render();
    case 'clear-targets': S.talk.targets = []; S.talk.targetSource = ''; return render();
    case 'start': return startConversation();

    case 'learn-topic': $('#learnInput').value = v; return;
    case 'learn-go': return makeLesson();
    case 'save-lesson-item': {
      const it = S.learn.items[+el.dataset.i];
      if (Store.hasWord(it.spanish)) {
        Store.saveWords(Store.words().filter((w) => w.spanish.trim().toLowerCase() !== it.spanish.trim().toLowerCase()));
      } else {
        Store.addWord({ ...it, region: S.learn.region });
      }
      return render();
    }
    case 'save-lesson-all': {
      let n = 0;
      for (const it of S.learn.items) if (Store.addWord({ ...it, region: S.learn.region })) n++;
      toast(n ? `Saved ${n} to My words` : 'Already saved');
      return render();
    }
    case 'practice-lesson': {
      const L = S.learn;
      if (L.region) saveSettings({ region: L.region });
      return startConversation({
        scenarioLabel: L.title || 'Lesson practice',
        scenario: `Chat naturally as friends in a situation where these come up: ${L.request}`,
        targets: L.items.map((x) => x.spanish),
        targetSource: 'lesson',
      });
    }
    case 'practice-words': {
      const words = Store.words().slice().sort((a, b) => (a.practiced || 0) - (b.practiced || 0) || a.addedAt - b.addedAt).slice(0, 8);
      return startConversation({
        scenarioLabel: 'My words practice',
        scenario: 'Catching up as friends; let the conversation wander naturally through everyday topics where the target phrases fit.',
        targets: words.map((w) => w.spanish),
        targetSource: 'words',
      });
    }
    case 'delete-word': Store.saveWords(Store.words().filter((w) => w.id !== el.dataset.id)); return render();
    case 'save-word': {
      const added = Store.addWord({ spanish: el.dataset.es, english: el.dataset.en, region: el.dataset.region });
      toast(added ? 'Saved to My words' : 'Already in My words');
      if (S.convo) S.convo.renderTranscript(); else render();
      return;
    }
    case 'speak': return speak(el.dataset.text, el.dataset.region || S.settings.region);

    case 'open-review': return go('review', { reviewId: el.dataset.id });
    case 'summarize': return summarize(el.dataset.id);
    case 'again': {
      const s = Store.session(el.dataset.id);
      saveSettings({ region: s.region, level: s.level, voice: s.voice });
      return startConversation({ scenarioLabel: s.scenarioLabel, scenario: s.scenario, targets: s.targets, targetSource: s.targetSource });
    }
    case 'delete-session':
      if (confirm('Delete this conversation?')) { Store.deleteSession(el.dataset.id); go('history'); }
      return;

    case 'save-key': return saveKey();
    case 'toggle-key': {
      const i = $('#apiKey');
      i.type = i.type === 'password' ? 'text' : 'password';
      el.textContent = i.type === 'password' ? 'Show' : 'Hide';
      return;
    }
    case 'turnmode': saveSettings({ turnMode: v }); return render();
    case 'export': {
      const blob = new Blob([JSON.stringify(Store.exportAll(), null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `charla-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      return;
    }
    case 'import': return $('#importFile').click();
    case 'clear-history':
      if (confirm('Delete all saved conversations? Your words are kept.')) { Store.clearHistory(); toast('Conversations deleted'); }
      return;

    // conversation
    case 'mic': return S.convo && S.convo.onMicTap();
    case 'end': return S.convo && S.convo.end();
    case 'en-all': return S.convo && S.convo.toggleEnglish();
    case 'turn': return openTurnSheet(el.dataset.id);
    case 'recoach': return S.convo && S.convo.recoach(el.dataset.id);
    case 'explain': return explain();
    case 'close-sheet': return closeSheet();
  }
});

document.addEventListener('input', (e) => {
  const id = e.target.id;
  if (id === 'customScenario') S.talk.custom = e.target.value;
  if (id === 'silenceMs') {
    const ms = +e.target.value;
    saveSettings({ silenceMs: ms });
    const lbl = $('#silenceVal');
    if (lbl) lbl.textContent = (ms / 1000).toFixed(1);
  }
});

document.addEventListener('change', (e) => {
  const id = e.target.id;
  if (id === 'liveModel') saveSettings({ liveModel: e.target.value });
  if (id === 'coachModel') saveSettings({ coachModel: e.target.value });
  if (id === 'voice') saveSettings({ voice: e.target.value });
  if (id === 'muteWhilePartner') saveSettings({ muteWhilePartner: e.target.checked });
  if (id === 'showEnglish') saveSettings({ showEnglish: e.target.checked });
  if (id === 'importFile' && e.target.files[0]) {
    e.target.files[0].text().then((txt) => {
      Store.importAll(JSON.parse(txt));
      toast('Backup imported');
    }).catch(() => toast('That file isn\'t a Charla backup'));
  }
});

document.addEventListener('visibilitychange', () => {
  const c = S.convo;
  if (!c || document.visibilityState !== 'visible') return;
  try { c.audio && c.audio.ctx && c.audio.ctx.resume(); } catch (_) {}
  if (!c.ending && c.state === 'live') c.wake();
});

// iOS loads speech voices lazily
try { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = () => {}; } catch (_) {}

if (!hasKey()) S.view = 'settings';
render();
