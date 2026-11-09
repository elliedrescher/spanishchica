# Charla

Personal Spanish conversation practice with a live AI voice partner (Gemini Live API).
Argentine (Buenos Aires) or Colombian (Bogotá) Spanish. Runs as a web app saved to your iPhone Home Screen.

## What it does
- **Live voice conversation**: the partner speaks only Spanish and understands English.
- **English on demand**: tap **EN** for translations of everything, or tap any message.
- **Coach**: after each thing you say you get conjugation, grammar and word-choice fixes, plus a more natural version.
- **"How do I say ___?"**: say it mid-conversation. The partner answers in Spanish and the coach shows the English → Spanish card.
- **"Más despacio"**: ask in Spanish and the partner slows down for the rest of the conversation.
- **Explain**: tap a message and choose **Explain this** for meaning, slang and grammar.
- **Review**: past conversations with a summary, patterns to work on and new vocab.
- **Learn**: build a lesson on a topic or from exact phrases, save words, then practice them in a conversation (target chips light up as you use them).

## One-time setup

### 1. Get a free Gemini API key
Go to https://aistudio.google.com/apikey and choose **Create API key**. Free tier: Google may use free-tier data to improve its products.

### 2. Put the app on GitHub Pages
1. Create a new **public** repo on GitHub (e.g. `charla`). Pages on private repos needs a paid plan. Your key is never in the code.
2. Upload all the files in this folder to the repo root.
3. In the repo, go to **Settings → Pages → Build and deployment**. Choose **Deploy from a branch**, branch `main`, folder `/ (root)`, then **Save**.
4. After about a minute the site is live at `https://<your-username>.github.io/charla/`.

### 3. Add it to your iPhone
1. Open that URL in **Safari**.
2. Tap **Share → Add to Home Screen**.
3. Open Charla from the Home Screen. Go to **Settings**, paste your key and tap **Save & check key**.
4. When asked, allow microphone access.

## Tips
- **Headphones work best.** With the speaker, keep "Mute my mic while partner is talking" on (the default) so the partner doesn't hear itself.
- **If the partner jumps in while you're thinking**, raise "Wait __s of silence" in Settings, or switch to **Tap to talk**.
- The accent comes from instructions to the voice model. Words and grammar (voseo, porteño/Bogotá slang) are reliable; the accent itself varies by voice. Try different voices in Settings.
- Your data (conversations, words, key) lives only in Safari's storage on your phone. Use **Export backup** occasionally.

## Files
- `js/prompts.js`: every prompt (persona, dialect, coach, lessons). Tweak freely.
- `js/live.js`: Gemini Live WebSocket client.
- `js/audio.js`, `js/capture-worklet.js`: mic capture (16 kHz) and playback (24 kHz).
- `js/gemini.js`: model discovery and coach/translation calls.
- `js/app.js`: UI.
