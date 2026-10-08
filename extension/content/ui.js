// Shadow-DOM UI for the content script: translation popup, selection button, toast.

class ReadLexUI {
  constructor() {
    this.host = null;
    this.root = null;
    this.popup = null;
    this.button = null;
    this.toast = null;
    this.pinned = false;
    this.visible = false;
    this.theme = 'auto';
    this.toastTimer = null;
    this.audio = null;
  }

  static get CSS() {
    // "Highlighter" look. No web fonts here: this runs inside arbitrary pages.
    const dark = `--paper: #1D232B; --fg: #EEF0EA; --muted: #A9B1BA; --line: #333B45; --edge: #3D4651; --ground: #2A313B;
            --control: #4A5461; --danger: #FF9BAC; --shadow: 0 14px 36px rgba(0, 0, 0, .55);`;
    return `
      :host { all: initial; }
      *, *::before, *::after { box-sizing: border-box; }
      .rl { --paper: #FFFFFF; --fg: #17202B; --muted: #515C69; --line: #E2E5DE; --edge: #D5D9D0; --ground: #F3F4EF;
            --control: #C9CEC3; --danger: #A8243D; --shadow: 0 14px 36px rgba(23, 32, 43, .2);
            --serif: Georgia, "Times New Roman", serif;
            font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
            color: var(--fg); text-align: left; -webkit-font-smoothing: antialiased; }
      .rl[data-theme="dark"] { ${dark} }
      @media (prefers-color-scheme: dark) { .rl[data-theme="auto"] { ${dark} } }

      .rl-popup { position: fixed; z-index: 2147483647; display: flex; flex-direction: column; gap: 12px; width: max-content;
            max-width: min(380px, calc(100vw - 16px)); padding: 16px 18px 14px; background: var(--paper);
            border: 1px solid var(--edge); border-radius: 16px; box-shadow: var(--shadow); animation: rl-in .12s ease-out; }
      .rl-popup[hidden] { display: none; }
      .rl-popup.rl-card { min-width: min(300px, calc(100vw - 16px)); }
      .rl-popup.rl-sent { max-width: min(460px, calc(100vw - 16px)); padding: 16px 18px; font-size: 16px; line-height: 1.55; }
      @keyframes rl-in { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }

      .rl-head { display: flex; flex-direction: column; gap: 2px; }
      .rl-headrow { display: flex; align-items: center; gap: 10px; }
      .rl-title { flex: 1; min-width: 0; display: flex; align-items: baseline; flex-wrap: wrap; gap: 2px 8px; }
      .rl-word { min-width: 0; font-family: var(--serif); font-size: 25px; line-height: 1.25; font-weight: 600; overflow-wrap: anywhere; }
      .rl-word.rl-phrase { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; overflow: hidden;
            font-size: 17px; line-height: 1.45; font-weight: 400; }
      .rl-reading { color: var(--muted); font-size: 15px; }
      .rl-sub { color: var(--muted); font-size: 13.5px; overflow-wrap: anywhere; }
      .rl-icon { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px;
            padding: 0; border: 0; border-radius: 50%; background: var(--ground); color: var(--fg); cursor: pointer; }
      .rl-icon:hover { background: var(--line); }

      .rl-body { display: flex; flex-direction: column; gap: 8px; }
      .rl-trans, .rl-vi { font-size: 19px; line-height: 1.35; font-weight: 700; overflow-wrap: anywhere; }
      .rl-trans.rl-long { font-size: 16px; line-height: 1.45; font-weight: 600; }
      .rl-dict { display: flex; flex-direction: column; gap: 4px; font-size: 14.5px; }
      .rl-row, .rl-sense { display: flex; gap: 10px; font-size: 14.5px; }
      .rl-pos { flex: none; min-width: 62px; max-width: 110px; color: var(--muted); font-style: italic; }
      .rl-pos:empty { display: none; }
      .rl-pos.rl-field { font-style: normal; font-size: 13px; }
      .rl-def { padding-top: 12px; border-top: 1px solid var(--line); color: var(--muted); font-size: 13.5px; }
      .rl-error { color: var(--danger); font-size: 14px; }

      .rl-trail { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
      .rl-trail span { padding: 1px 8px; border-radius: 999px; background: var(--ground); color: var(--fg); font-size: 12px; font-weight: 600; }
      .rl-entry { display: flex; flex-direction: column; gap: 4px; }
      .rl-entry + .rl-entry { padding-top: 10px; border-top: 1px solid var(--line); }
      .rl-entry .rl-hw { font-family: var(--serif); font-size: 17px; font-weight: 600; }
      .rl-entry + .rl-entry .rl-vi { font-size: 16px; }
      .rl-sense .rl-pos { min-width: 0; }
      .rl-kanji { padding-top: 10px; border-top: 1px solid var(--line); color: var(--muted); font-size: 13.5px; }
      .rl-kanji b { margin-right: 8px; color: var(--fg); font-size: 18px; font-weight: 600; }

      .rl-actions { display: flex; flex-direction: column; gap: 8px; }
      .rl-foot { color: var(--muted); font-size: 12.5px; text-align: center; }
      .rl-save { display: inline-flex; align-items: center; justify-content: center; gap: 8px; border: 0; border-radius: 12px;
            background: #FFE45C; box-shadow: inset 0 -3px 0 #E3C22B; color: #17202B; font: inherit; font-weight: 700;
            white-space: nowrap; cursor: pointer; }
      .rl-save.rl-block { width: 100%; min-height: 46px; font-size: 16px; }
      .rl-save.rl-pill { flex: none; gap: 6px; min-height: 38px; padding: 0 14px; font-size: 14px; }
      .rl-save:hover { background: #FFEB85; }
      .rl-save.rl-saved { border: 1.5px solid var(--fg); background: var(--paper); box-shadow: none; color: var(--fg); font-weight: 600; }
      .rl-save.rl-saved:hover { background: var(--ground); }
      .rl-save:disabled { opacity: .6; cursor: default; }
      .rl-save:focus-visible, .rl-icon:focus-visible, .rl-btn:focus-visible { outline: 3px solid var(--fg); outline-offset: 2px; }

      .rl-sent-text { white-space: pre-wrap; overflow-wrap: anywhere; text-wrap: pretty; }
      .rl-sent-word { display: flex; align-items: center; gap: 12px; padding-top: 12px; border-top: 1px solid var(--line); }
      .rl-sent-info { flex: 1; min-width: 0; display: flex; align-items: baseline; flex-wrap: wrap; gap: 2px 10px; }
      .rl-sent-word .rl-word { font-size: 18px; line-height: 1.35; }
      .rl-sent-word .rl-reading, .rl-ipa { color: var(--muted); font-size: 13.5px; }
      .rl-sent-word .rl-meaning { font-size: 15px; line-height: 1.45; }
      .rl-sent-word .rl-icon { width: 36px; height: 36px; }
      .rl-shift { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 13px; line-height: 1.5; }
      .rl-shift kbd { padding: 0 7px; border: 1px solid var(--control); border-radius: 6px; background: var(--ground);
            color: var(--fg); font: inherit; font-size: 12px; font-weight: 600; }

      .rl-loading { display: flex; align-items: center; gap: 10px; color: var(--muted); font-size: 14px; }
      .rl-spin { width: 16px; height: 16px; border: 2px solid var(--line); border-top-color: var(--fg);
            border-radius: 50%; animation: rl-spin .7s linear infinite; }
      @keyframes rl-spin { to { transform: rotate(360deg); } }

      .rl-btn { position: fixed; z-index: 2147483647; display: flex; align-items: center; justify-content: center;
            width: 40px; height: 40px; padding: 0; border: 1px solid var(--edge); border-radius: 50%; background: var(--paper);
            color: var(--fg); box-shadow: 0 6px 18px rgba(23, 32, 43, .22); cursor: pointer; }
      .rl-btn[hidden] { display: none; }
      .rl-btn:hover { background: #FFE45C; border-color: #E3C22B; color: #17202B; }

      .rl-toast { position: fixed; z-index: 2147483647; right: 16px; bottom: 16px; display: flex; align-items: center; gap: 12px;
            min-height: 48px; max-width: min(420px, calc(100vw - 32px)); padding: 6px 14px;
            border: 1px solid rgba(255, 255, 255, .16); border-radius: 14px; background: #17202B; color: #FFFFFF;
            box-shadow: 0 10px 28px rgba(23, 32, 43, .3); font-size: 14px; line-height: 1.4; animation: rl-in .15s ease-out; }
      .rl-toast[hidden] { display: none; }
      .rl-toast.rl-has-action { padding-right: 8px; }
      .rl-toast svg { flex: none; color: #FFE45C; }
      .rl-toast button { flex: none; min-height: 36px; padding: 0 10px; border: 0; border-radius: 10px; background: none;
            color: #FFE45C; font: inherit; font-weight: 700; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
      .rl-toast button:focus-visible { outline: 3px solid #FFE45C; outline-offset: 1px; }
      @media (prefers-reduced-motion: reduce) { .rl-popup, .rl-toast { animation: none; } }
    `;
  }

  // Inline stroke icons (24px grid, currentColor).
  static icon(name, size = 18, strokeWidth = 2) {
    const paths = {
      audio: ['M11 5 6 9H3v6h3l5 4z', 'M15.5 8.5a5 5 0 0 1 0 7', 'M18.5 5.5a9 9 0 0 1 0 13'],
      translate: ['M5 8l6 6', 'M4 14l6-6 2-3', 'M2 5h12', 'M7 2h1', 'M22 22l-5-10-5 10', 'M14 18h6'],
      bookmark: ['M6 3h12v18l-6-4.5L6 21z'],
      check: ['M5 12.5l4.5 4.5L19 7.5'],
    };
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    const attrs = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': strokeWidth, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' };
    for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
    for (const d of paths[name] || []) {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d);
      svg.appendChild(path);
    }
    return svg;
  }

  ensure() {
    if (this.host && this.host.isConnected) return;
    this.host = document.createElement('div');
    this.host.id = 'readlex-host';
    this.host.style.cssText = 'all:initial;position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;';
    this.root = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = ReadLexUI.CSS;
    this.wrap = document.createElement('div');
    this.wrap.className = 'rl';
    this.wrap.lang = 'en';
    this.wrap.dataset.theme = this.theme;
    this.popup = document.createElement('div');
    this.popup.className = 'rl-popup';
    this.popup.setAttribute('role', 'dialog');
    this.popup.setAttribute('aria-label', 'ReadLex');
    this.popup.hidden = true;
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'rl-btn';
    this.button.title = 'Translate selection (ReadLex)';
    this.button.setAttribute('aria-label', 'Translate selection (ReadLex)');
    this.button.hidden = true;
    this.button.appendChild(ReadLexUI.icon('translate', 20));
    this.toast = document.createElement('div');
    this.toast.className = 'rl-toast';
    this.toast.setAttribute('role', 'status');
    this.toast.hidden = true;
    this.wrap.append(this.popup, this.button, this.toast);
    this.root.append(style, this.wrap);
    (document.body || document.documentElement).appendChild(this.host);
  }

  setTheme(theme) {
    this.theme = theme || 'auto';
    if (this.wrap) this.wrap.dataset.theme = this.theme;
  }

  isEventInside(event) {
    if (!this.host) return false;
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    return path.includes(this.host) || event.target === this.host;
  }

  place(el, rect) {
    if (el === this.popup) this.lastRect = rect;
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    el.style.visibility = 'hidden';
    el.hidden = false;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = rect.left;
    if (left + w > vw - margin) left = vw - w - margin;
    if (left < margin) left = margin;
    let top = rect.bottom + 8;
    if (top + h > vh - margin) top = rect.top - h - 8;
    if (top < margin) top = margin;
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    el.style.visibility = '';
  }

  // kind: '' (loading) | 'card' (word popup) | 'sent' (sentence box)
  resetPopup(kind, label) {
    this.popup.classList.toggle('rl-card', kind === 'card');
    this.popup.classList.toggle('rl-sent', kind === 'sent');
    this.popup.setAttribute('aria-label', label);
    this.popup.replaceChildren();
    return this.popup;
  }

  showLoading(rect) {
    this.ensure();
    this.hideSelectionButton();
    this.resetPopup('', 'ReadLex');
    const box = document.createElement('div');
    box.className = 'rl-loading';
    const spin = document.createElement('div');
    spin.className = 'rl-spin';
    box.append(spin, document.createTextNode('Translating…'));
    this.popup.appendChild(box);
    this.place(this.popup, rect);
    this.visible = true;
  }

  audioButton(url) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rl-icon';
    btn.title = 'Play pronunciation';
    btn.setAttribute('aria-label', 'Play pronunciation');
    btn.appendChild(ReadLexUI.icon('audio', 19));
    btn.addEventListener('click', (e) => { e.stopPropagation(); this.play(url); });
    return btn;
  }

  // data: LOOKUP result from the background; options: { pinned, showIpa, showDefinition, onSave, saved }
  showPopup(rect, data, options = {}) {
    this.ensure();
    this.hideSelectionButton();
    this.pinned = !!options.pinned;
    const p = this.resetPopup('card', 'ReadLex word lookup');

    // Headword: the dictionary form when the page shows an inflected one ("contemplating" -> contemplate).
    const jaFirst = data.ja && data.ja.results && data.ja.results[0];
    const viaLemma = !data.ja && !!data.offline && !!data.offline.viaLemma && data.offline.headword !== String(data.text || '').toLowerCase();
    const head = document.createElement('div');
    head.className = 'rl-head';
    const headRow = document.createElement('div');
    headRow.className = 'rl-headrow';
    const title = document.createElement('div');
    title.className = 'rl-title';
    const word = document.createElement('span');
    word.className = 'rl-word' + (data.isWord ? '' : ' rl-phrase');
    word.lang = data.ja ? 'ja' : 'en';
    word.textContent = jaFirst ? jaFirst.headword
      : (data.ja && data.ja.kanji ? data.ja.kanji.literal : (viaLemma && data.isWord ? data.offline.headword : data.text));
    title.appendChild(word);
    if (jaFirst && jaFirst.reading) {
      const rd = document.createElement('span');
      rd.className = 'rl-reading';
      rd.lang = 'ja';
      rd.textContent = `【${jaFirst.reading}】`;
      title.appendChild(rd);
    }
    headRow.appendChild(title);
    if (data.isWord && data.audio) headRow.appendChild(this.audioButton(data.audio));
    head.appendChild(headRow);

    const sub = [];
    if (data.isWord && options.showIpa !== false && data.ipa) {
      const ipa = document.createElement('span');
      ipa.className = 'rl-ipa';
      ipa.textContent = data.ipa;
      sub.push(ipa);
    }
    if (viaLemma) {
      const base = document.createElement('span');
      base.className = 'rl-base';
      base.textContent = data.isWord ? `base form of “${data.text}”` : `base form: ${data.offline.headword}`;
      sub.push(base);
    }
    if (sub.length) {
      const line = document.createElement('div');
      line.className = 'rl-sub';
      sub.forEach((node, i) => { if (i) line.appendChild(document.createTextNode(' · ')); line.appendChild(node); });
      head.appendChild(line);
    }
    p.appendChild(head);

    const dictRow = (label, text, isField) => {
      const row = document.createElement('div');
      row.className = 'rl-row';
      const pos = document.createElement('span');
      pos.className = 'rl-pos' + (isField ? ' rl-field' : '');
      pos.textContent = label || '';
      const terms = document.createElement('span');
      terms.textContent = text;
      row.append(pos, terms);
      return row;
    };

    if (data.ja) {
      this.renderJapanese(p, data, head);
    } else if (data.error && !data.translation && !data.offline) {
      const err = document.createElement('div');
      err.className = 'rl-error';
      err.textContent = `Could not translate: ${data.error}`;
      p.appendChild(err);
    } else if (data.offline && data.offline.lines.length) {
      // offline dictionary entry: the first meaning large, then "loại từ: nghĩa; nghĩa; nghĩa" per line
      const body = document.createElement('div');
      body.className = 'rl-body';
      if (data.translation) {
        const trans = document.createElement('div');
        trans.className = 'rl-trans' + (data.translation.length > 60 ? ' rl-long' : '');
        trans.textContent = data.translation;
        body.appendChild(trans);
      }
      const dict = document.createElement('div');
      dict.className = 'rl-dict';
      const lines = data.offline.lines.slice(0, 4);
      // A lone sense that only repeats the headline: keep just its part of speech.
      const lone = lines.length === 1 && data.translation && lines[0].text === data.translation;
      for (const line of lines) dict.appendChild(dictRow(line.label, lone ? '' : line.text, line.field));
      if (!lone || lines[0].label) body.appendChild(dict);
      p.appendChild(body);
      if (data.offline.example && options.showDefinition !== false) {
        const ex = document.createElement('div');
        ex.className = 'rl-def';
        const en = document.createElement('div');
        en.lang = 'en';
        en.textContent = data.offline.example.en;
        ex.appendChild(en);
        if (data.offline.example.vi) {
          const vi = document.createElement('div');
          vi.textContent = data.offline.example.vi;
          ex.appendChild(vi);
        }
        p.appendChild(ex);
      }
    } else {
      const body = document.createElement('div');
      body.className = 'rl-body';
      const trans = document.createElement('div');
      trans.className = 'rl-trans' + ((data.translation || '').length > 60 ? ' rl-long' : '');
      trans.textContent = data.translation || '—';
      body.appendChild(trans);
      const dictRows = (data.dict || []).filter((d) => d.terms && d.terms.length);
      if (dictRows.length) {
        const dict = document.createElement('div');
        dict.className = 'rl-dict';
        for (const d of dictRows.slice(0, 4)) dict.appendChild(dictRow(ReadLexUI.shortPos(d.pos), d.terms.slice(0, 5).join(', '), false));
        body.appendChild(dict);
      }
      p.appendChild(body);
    }

    if (!data.offline && options.showDefinition !== false && data.definitions && data.definitions.length) {
      const def = document.createElement('div');
      def.className = 'rl-def';
      def.lang = 'en';
      const d = data.definitions[0];
      def.textContent = `${d.partOfSpeech ? d.partOfSpeech + ' · ' : ''}${d.definition}`;
      p.appendChild(def);
    }

    // Full-width save button with one line underneath: what saving does, or what we already know about this word.
    const count = data.lookupCount || 0;
    const what = data.isWord ? 'word' : 'phrase';
    const kept = data.saved ? (data.saved.exposureCount || 1) : 0;
    let hint = 'Saves it with the sentence you are reading.';
    if (data.saved) hint = `Already saved (${kept} ${kept === 1 ? 'sentence' : 'sentences'}). Press to add this one.`;
    else if (count >= 3) hint = `Looked up ${count} times already. Save this ${what} to review?`;
    else if (count > 1) hint = `Looked up ${count} times. Saves it with this sentence.`;
    if (options.onSave || data.saved || count > 1) {
      const actions = document.createElement('div');
      actions.className = 'rl-actions';
      const foot = document.createElement('div');
      foot.className = 'rl-foot';
      foot.textContent = hint;
      if (options.onSave) {
        actions.appendChild(this.saveButton(data.saved, options.onSave, {
          block: true,
          label: data.isWord ? 'Save word' : 'Save phrase',
          onSaved: () => { foot.textContent = 'Saved with the sentence you are reading.'; },
        }));
      }
      actions.appendChild(foot);
      p.appendChild(actions);
    }

    this.place(p, rect);
    this.visible = true;
  }

  // Save control. Word popup: full-width yellow button. Sentence box: compact pill.
  // Saved state: outlined "Saved" with a check (still clickable: it adds the current sentence as a new context).
  saveButton(saved, onSave, { block = false, label = '', onSaved = null } = {}) {
    const save = document.createElement('button');
    save.type = 'button';
    const render = (state) => {
      const isSaved = state === 'saved';
      save.className = `rl-save ${block ? 'rl-block' : 'rl-pill'}${isSaved ? ' rl-saved' : ''}`;
      save.setAttribute('aria-pressed', String(isSaved));
      save.title = isSaved ? 'Already in your vocabulary. Press to add this sentence.' : 'Save to your vocabulary with this sentence';
      save.replaceChildren(
        isSaved ? ReadLexUI.icon('check', block ? 18 : 16, 3) : ReadLexUI.icon('bookmark', block ? 18 : 16, 2.2),
        document.createTextNode(isSaved ? 'Saved' : (label || 'Save word')),
      );
    };
    render(saved ? 'saved' : 'idle');
    save.addEventListener('click', async (e) => {
      e.stopPropagation();
      save.disabled = true;
      save.textContent = 'Saving…';
      let result = null;
      try {
        result = await onSave();
      } finally {
        save.disabled = false;
        render(result || saved ? 'saved' : 'idle');
      }
      if (result && onSaved) onSaved(result);
    });
    return save;
  }

  // Sentence translation box (tudienjp-style). data: { translation, error, word? (LOOKUP result of the hovered word) }
  // options: { pinned, showIpa, onSaveWord, shiftHint }
  showSentence(rect, data, options = {}) {
    this.ensure();
    this.hideSelectionButton();
    this.pinned = !!options.pinned;
    const p = this.resetPopup('sent', 'ReadLex sentence translation');
    if (data.error && !data.translation) {
      const err = document.createElement('div');
      err.className = 'rl-error';
      err.textContent = `Could not translate: ${data.error}`;
      p.appendChild(err);
    } else {
      const t = document.createElement('div');
      t.className = 'rl-sent-text';
      t.textContent = data.translation || '—';
      p.appendChild(t);
    }
    if (data.word) p.appendChild(this.wordLine(data.word, options));
    if (options.shiftHint) {
      const hint = document.createElement('div');
      hint.className = 'rl-shift';
      const kbd = document.createElement('kbd');
      kbd.textContent = 'Shift';
      const before = document.createElement('span');
      before.textContent = 'Hold';
      const after = document.createElement('span');
      after.textContent = 'to look up single words';
      hint.append(before, kbd, after);
      p.appendChild(hint);
    }
    this.place(p, rect);
    this.visible = true;
  }

  wordLine(word, options = {}) {
    const line = document.createElement('div');
    line.className = 'rl-sent-word';
    const info = document.createElement('div');
    info.className = 'rl-sent-info';
    const w = document.createElement('span');
    w.className = 'rl-word';
    w.lang = word.ja ? 'ja' : 'en';
    const jaFirst = word.ja && word.ja.results && word.ja.results[0];
    w.textContent = jaFirst ? jaFirst.headword : (word.ja && word.ja.kanji ? word.ja.kanji.literal : word.text);
    info.appendChild(w);
    if (jaFirst && jaFirst.reading) {
      const rd = document.createElement('span');
      rd.className = 'rl-reading';
      rd.lang = 'ja';
      rd.textContent = `【${jaFirst.reading}】`;
      info.appendChild(rd);
    }
    if (options.showIpa !== false && word.ipa) {
      const ipa = document.createElement('span');
      ipa.className = 'rl-ipa';
      ipa.textContent = word.ipa;
      info.appendChild(ipa);
    }
    const first = word.offline && word.offline.lines && word.offline.lines[0];
    let meaning = first ? `${first.label ? first.label + ': ' : ''}${first.text}` : (word.translation || '');
    if (jaFirst) {
      const sense = jaFirst.senses[0];
      meaning = [jaFirst.trail.length ? `(${jaFirst.trail.slice(0, 2).join(', ')})` : '', jaFirst.vi || (sense ? sense.gloss.slice(0, 3).join('; ') : '')].filter(Boolean).join(' ');
    } else if (word.ja && word.ja.kanji) {
      meaning = word.ja.kanji.meanings.slice(0, 3).join(', ');
    }
    if (meaning.length > 140) meaning = meaning.slice(0, 138).replace(/[,;\s]+\S*$/, '') + '…';
    if (meaning) {
      const m = document.createElement('span');
      m.className = 'rl-meaning';
      m.textContent = meaning;
      info.appendChild(m);
    }
    line.appendChild(info);
    if (word.audio) line.appendChild(this.audioButton(word.audio));
    if (options.onSaveWord) line.appendChild(this.saveButton(word.saved, options.onSaveWord));
    return line;
  }

  // Replace the word line of a visible sentence popup (mouse moved to another word in the same sentence).
  updateSentenceWord(word, options = {}) {
    if (!this.visible || !this.popup.classList.contains('rl-sent')) return;
    const old = this.popup.querySelector('.rl-sent-word');
    const line = word ? this.wordLine(word, options) : null;
    if (old && line) old.replaceWith(line);
    else if (old) old.remove();
    else if (line) this.popup.insertBefore(line, this.popup.querySelector('.rl-shift'));
    if (this.lastRect) this.place(this.popup, this.lastRect);
  }

  renderJapanese(p, data, head) {
    const ja = data.ja;
    const results = ja.results || [];
    if (data.ja.matched && results[0] && data.ja.matched !== results[0].headword && data.ja.matched !== results[0].reading) {
      const base = document.createElement('div');
      base.className = 'rl-sub rl-base';
      base.textContent = `base form of “${data.ja.matched}”`;
      head.appendChild(base);
    }
    if (results[0] && results[0].trail.length) {
      const trail = document.createElement('div');
      trail.className = 'rl-trail';
      for (const t of results[0].trail.slice(0, 4)) {
        const b = document.createElement('span');
        b.textContent = t;
        trail.appendChild(b);
      }
      head.appendChild(trail);
    }
    results.slice(0, 3).forEach((r, i) => {
      const box = document.createElement('div');
      box.className = 'rl-entry';
      if (i > 0) {
        const hw = document.createElement('div');
        hw.className = 'rl-hw';
        hw.lang = 'ja';
        hw.textContent = r.reading ? `${r.headword}【${r.reading}】` : r.headword;
        box.appendChild(hw);
      }
      if (r.vi) {
        const vi = document.createElement('div');
        vi.className = 'rl-vi';
        vi.textContent = r.vi;
        box.appendChild(vi);
      }
      for (const sense of r.senses.slice(0, i === 0 ? 3 : 2)) {
        const row = document.createElement('div');
        row.className = 'rl-sense';
        const pos = document.createElement('span');
        pos.className = 'rl-pos';
        pos.textContent = sense.posLabel || '';
        const g = document.createElement('span');
        g.textContent = sense.gloss.slice(0, 4).join('; ') + (sense.misc.length ? ` (${sense.misc.join(', ')})` : '');
        row.append(pos, g);
        box.appendChild(row);
      }
      p.appendChild(box);
    });
    if (ja.kanji && (results.length === 0 || (results[0].headword.length === 1))) {
      const k = ja.kanji;
      const box = document.createElement('div');
      box.className = 'rl-kanji';
      const b = document.createElement('b');
      b.lang = 'ja';
      b.textContent = k.literal;
      box.appendChild(b);
      const parts = [];
      if (k.meanings.length) parts.push(k.meanings.slice(0, 4).join(', '));
      if (k.on.length) parts.push(`on: ${k.on.join(' ')}`);
      if (k.kun.length) parts.push(`kun: ${k.kun.slice(0, 3).join(' ')}`);
      const meta = [k.jlpt ? `JLPT N${k.jlpt}` : '', k.grade ? `grade ${k.grade}` : '', k.strokes ? `${k.strokes} ${k.strokes === 1 ? 'stroke' : 'strokes'}` : ''].filter(Boolean).join(' · ');
      if (meta) parts.push(meta);
      box.appendChild(document.createTextNode(parts.join(' · ')));
      p.appendChild(box);
    }
    if (!results.length && !ja.kanji) {
      const t = document.createElement('div');
      t.className = 'rl-trans';
      t.textContent = data.translation || '—';
      p.appendChild(t);
    }
  }

  static shortPos(pos) {
    const map = { noun: 'n.', verb: 'v.', adjective: 'adj.', adverb: 'adv.', preposition: 'prep.', conjunction: 'conj.', pronoun: 'pron.', interjection: 'interj.', abbreviation: 'abbr.', 'auxiliary verb': 'aux.', article: 'art.', prefix: 'prefix', suffix: 'suffix', phrase: 'phr.' };
    return map[pos] || pos || '';
  }

  play(url) {
    try {
      if (this.audio) { this.audio.pause(); }
      const audio = new Audio(url);
      this.audio = audio;
      const fallback = () => {
        if (!this.audioFallback || audio.__fellBack) return;
        audio.__fellBack = true;
        this.audioFallback(url).then((dataUrl) => {
          if (!dataUrl) return;
          this.audio = new Audio(dataUrl);
          this.audio.play().catch(() => {});
        }).catch(() => {});
      };
      audio.addEventListener('error', fallback, { once: true });
      audio.play().catch(fallback);
    } catch (_) { /* blocked by page CSP */ }
  }

  hidePopup() {
    if (this.popup) this.popup.hidden = true;
    this.visible = false;
    this.pinned = false;
    this.clearHighlight();
  }

  showSelectionButton(rect, onClick) {
    this.ensure();
    const btn = this.button;
    btn.onclick = (e) => { e.stopPropagation(); e.preventDefault(); onClick(); };
    btn.hidden = false;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = rect.right + 6;
    let top = rect.bottom + 6;
    if (left + 44 > vw) left = vw - 48;   // the button is 40px wide
    if (top + 44 > vh) top = rect.top - 46;
    btn.style.left = `${Math.round(Math.max(4, left))}px`;
    btn.style.top = `${Math.round(Math.max(4, top))}px`;
  }

  hideSelectionButton() {
    if (this.button) this.button.hidden = true;
  }

  // kind: 'ok' adds the yellow check (used for "saved" confirmations).
  showToast(text, { actionLabel = '', onAction = null, duration = 4000, kind = '' } = {}) {
    this.ensure();
    clearTimeout(this.toastTimer);
    this.toast.replaceChildren();
    if (kind === 'ok') this.toast.appendChild(ReadLexUI.icon('check', 18, 3));
    const span = document.createElement('span');
    span.textContent = text;
    this.toast.appendChild(span);
    this.toast.classList.toggle('rl-has-action', !!(actionLabel && onAction));
    if (actionLabel && onAction) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = actionLabel;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.hideToast();
        onAction();
      });
      this.toast.appendChild(btn);
    }
    this.toast.hidden = false;
    this.toastTimer = setTimeout(() => this.hideToast(), duration);
  }

  hideToast() {
    if (this.toast) this.toast.hidden = true;
  }

  highlightRange(range) {
    try {
      if (!('highlights' in CSS) || typeof Highlight === 'undefined') return;
      if (!document.getElementById('readlex-highlight-style')) {
        const style = document.createElement('style');
        style.id = 'readlex-highlight-style';
        style.textContent = '::highlight(readlex-word) { background-color: #FFE45C; color: #17202B; }';
        (document.head || document.documentElement).appendChild(style);
      }
      CSS.highlights.set('readlex-word', new Highlight(range));
    } catch (_) { /* unsupported */ }
  }

  clearHighlight() {
    try { if ('highlights' in CSS) CSS.highlights.delete('readlex-word'); } catch (_) { /* ignore */ }
  }

  hideAll() {
    this.hidePopup();
    this.hideSelectionButton();
  }
}
