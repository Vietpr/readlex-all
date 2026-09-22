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
    return `
      :host { all: initial; }
      *, *::before, *::after { box-sizing: border-box; }
      .rl { --bg: #ffffff; --fg: #1f2937; --muted: #6b7280; --border: #e5e7eb; --accent: #4f46e5;
            --accent-fg: #ffffff; --accent-soft: #eef2ff; --shadow: 0 10px 30px rgba(15, 23, 42, .18);
            font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            color: var(--fg); -webkit-font-smoothing: antialiased; }
      .rl[data-theme="dark"] { --bg: #1e2230; --fg: #e5e7eb; --muted: #9ca3af; --border: #363c4e; --accent: #8b8cf8;
            --accent-fg: #0f1020; --accent-soft: #2b2f57; --shadow: 0 10px 30px rgba(0, 0, 0, .5); }
      @media (prefers-color-scheme: dark) {
        .rl[data-theme="auto"] { --bg: #1e2230; --fg: #e5e7eb; --muted: #9ca3af; --border: #363c4e; --accent: #8b8cf8;
            --accent-fg: #0f1020; --accent-soft: #2b2f57; --shadow: 0 10px 30px rgba(0, 0, 0, .5); }
      }
      .rl-popup { position: fixed; z-index: 2147483647; min-width: 200px; max-width: 360px; background: var(--bg);
            border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); padding: 10px 12px 9px;
            animation: rl-in .12s ease-out; }
      .rl-popup[hidden] { display: none; }
      .rl { --sent-bg: #e9f4fc; --sent-border: #bcdcf2; }
      .rl[data-theme="dark"] { --sent-bg: #1b2a3a; --sent-border: #2f4a64; }
      @media (prefers-color-scheme: dark) { .rl[data-theme="auto"] { --sent-bg: #1b2a3a; --sent-border: #2f4a64; } }
      .rl-popup.rl-sent { max-width: 460px; background: var(--sent-bg); border-color: var(--sent-border); }
      .rl-sent-text { font-size: 14.5px; line-height: 1.55; white-space: pre-wrap; }
      .rl-sent-word { margin-top: 8px; padding-top: 7px; border-top: 1px dashed var(--sent-border); display: flex; gap: 6px 8px;
            align-items: baseline; flex-wrap: wrap; font-size: 13px; }
      .rl-sent-word .rl-word { font-size: 14px; }
      .rl-sent-word .rl-meaning { flex: 1 1 100%; }
      .rl-sent-word .rl-save { margin-left: auto; }
      @keyframes rl-in { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
      .rl-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .rl-word { font-weight: 700; font-size: 16px; color: var(--accent); word-break: break-word; }
      .rl-word.rl-phrase { font-size: 14px; color: var(--fg); font-weight: 600; }
      .rl-ipa { color: var(--muted); font-size: 13px; }
      .rl-spacer { flex: 1; }
      .rl-icon { border: 0; background: transparent; cursor: pointer; padding: 2px 4px; border-radius: 6px;
            color: var(--muted); display: inline-flex; align-items: center; font: inherit; line-height: 1; }
      .rl-icon:hover { background: var(--accent-soft); color: var(--accent); }
      .rl-icon svg { width: 16px; height: 16px; fill: currentColor; }
      .rl-save { border: 1px solid var(--border); background: transparent; color: var(--fg); border-radius: 999px;
            padding: 3px 10px; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; }
      .rl-save:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
      .rl-save.rl-saved { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
      .rl-trans { margin-top: 6px; font-size: 15px; font-weight: 600; word-break: break-word; }
      .rl-dict { margin-top: 6px; display: flex; flex-direction: column; gap: 3px; }
      .rl-row { display: flex; gap: 8px; font-size: 13px; }
      .rl-pos { color: var(--muted); font-style: italic; min-width: 34px; max-width: 110px; flex-shrink: 0; }
      .rl-pos.rl-field { color: var(--accent); font-style: normal; font-size: 12px; }
      .rl-base { color: var(--muted); font-size: 12.5px; margin-top: 2px; }
      .rl-def { margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--border); color: var(--muted);
            font-size: 12.5px; }
      .rl-foot { margin-top: 6px; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; font-size: 11.5px;
            color: var(--muted); }
      .rl-foot .rl-ok { color: var(--accent); font-weight: 600; }
      .rl-error { color: #dc2626; font-size: 13px; margin-top: 4px; }
      .rl-reading { color: var(--muted); font-size: 13.5px; }
      .rl-trail { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
      .rl-trail span { font-size: 11px; background: var(--accent-soft); color: var(--accent); border-radius: 999px; padding: 1px 7px; }
      .rl-vi { margin-top: 6px; font-size: 15px; font-weight: 600; }
      .rl-sense { display: flex; gap: 8px; font-size: 13px; margin-top: 3px; }
      .rl-sense .rl-pos { min-width: 0; }
      .rl-entry + .rl-entry { margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border); }
      .rl-entry .rl-hw { font-weight: 700; color: var(--accent); }
      .rl-kanji { margin-top: 8px; padding-top: 6px; border-top: 1px dashed var(--border); font-size: 12.5px; color: var(--muted); }
      .rl-kanji b { color: var(--fg); font-size: 15px; margin-right: 6px; }
      .rl-loading { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 13px; }
      .rl-spin { width: 14px; height: 14px; border: 2px solid var(--border); border-top-color: var(--accent);
            border-radius: 50%; animation: rl-spin .7s linear infinite; }
      @keyframes rl-spin { to { transform: rotate(360deg); } }
      .rl-btn { position: fixed; z-index: 2147483647; width: 30px; height: 30px; border-radius: 50%; border: 1px solid var(--border);
            background: var(--bg); color: var(--accent); box-shadow: var(--shadow); cursor: pointer; display: flex;
            align-items: center; justify-content: center; padding: 0; }
      .rl-btn[hidden] { display: none; }
      .rl-btn svg { width: 18px; height: 18px; fill: currentColor; }
      .rl-btn:hover { background: var(--accent-soft); }
      .rl-toast { position: fixed; z-index: 2147483647; right: 16px; bottom: 16px; background: var(--fg); color: var(--bg);
            padding: 10px 14px; border-radius: 10px; box-shadow: var(--shadow); font-size: 13px; display: flex; gap: 12px;
            align-items: center; max-width: 360px; animation: rl-in .15s ease-out; }
      .rl[data-theme="dark"] .rl-toast { background: #f3f4f6; color: #111827; }
      @media (prefers-color-scheme: dark) { .rl[data-theme="auto"] .rl-toast { background: #f3f4f6; color: #111827; } }
      .rl-toast[hidden] { display: none; }
      .rl-toast button { border: 0; background: transparent; color: inherit; font: inherit; font-weight: 700; cursor: pointer;
            text-decoration: underline; padding: 0; }
    `;
  }

  static icon(name) {
    const paths = {
      audio: 'M3 9v6h4l5 4V5L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4.03v8.05A4.47 4.47 0 0 0 16.5 12zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06A9 9 0 0 0 14 3.23z',
      translate: 'M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0 0 14.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z',
    };
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', paths[name]);
    svg.appendChild(path);
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
    this.wrap.dataset.theme = this.theme;
    this.popup = document.createElement('div');
    this.popup.className = 'rl-popup';
    this.popup.hidden = true;
    this.button = document.createElement('button');
    this.button.className = 'rl-btn';
    this.button.title = 'Dịch đoạn đã chọn (ReadLex)';
    this.button.hidden = true;
    this.button.appendChild(ReadLexUI.icon('translate'));
    this.toast = document.createElement('div');
    this.toast.className = 'rl-toast';
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

  showLoading(rect) {
    this.ensure();
    this.hideSelectionButton();
    this.popup.classList.remove('rl-sent');
    this.popup.replaceChildren();
    const box = document.createElement('div');
    box.className = 'rl-loading';
    const spin = document.createElement('div');
    spin.className = 'rl-spin';
    box.append(spin, document.createTextNode('Đang dịch…'));
    this.popup.appendChild(box);
    this.place(this.popup, rect);
    this.visible = true;
  }

  // data: LOOKUP result from the background; options: { pinned, showIpa, showDefinition, onSave, saved }
  showPopup(rect, data, options = {}) {
    this.ensure();
    this.hideSelectionButton();
    this.pinned = !!options.pinned;
    this.popup.classList.remove('rl-sent');
    this.popup.replaceChildren();
    const p = this.popup;

    const head = document.createElement('div');
    head.className = 'rl-head';
    const word = document.createElement('span');
    word.className = 'rl-word' + (data.isWord ? '' : ' rl-phrase');
    const jaFirst = data.ja && data.ja.results && data.ja.results[0];
    word.textContent = jaFirst ? jaFirst.headword : (data.ja && data.ja.kanji ? data.ja.kanji.literal : data.text);
    head.appendChild(word);
    if (jaFirst && jaFirst.reading) {
      const rd = document.createElement('span');
      rd.className = 'rl-reading';
      rd.textContent = `【${jaFirst.reading}】`;
      head.appendChild(rd);
    }
    if (data.isWord && options.showIpa !== false && data.ipa) {
      const ipa = document.createElement('span');
      ipa.className = 'rl-ipa';
      ipa.textContent = data.ipa;
      head.appendChild(ipa);
    }
    if (data.isWord && data.audio) {
      const btn = document.createElement('button');
      btn.className = 'rl-icon';
      btn.title = 'Nghe phát âm';
      btn.appendChild(ReadLexUI.icon('audio'));
      btn.addEventListener('click', (e) => { e.stopPropagation(); this.play(data.audio); });
      head.appendChild(btn);
    }
    const spacer = document.createElement('span');
    spacer.className = 'rl-spacer';
    head.appendChild(spacer);
    if (options.onSave) head.appendChild(this.saveButton(data.saved, options.onSave));
    p.appendChild(head);

    if (data.ja) {
      this.renderJapanese(p, data, head);
    } else if (data.error && !data.translation && !data.offline) {
      const err = document.createElement('div');
      err.className = 'rl-error';
      err.textContent = `Không dịch được: ${data.error}`;
      p.appendChild(err);
    } else if (data.offline && data.offline.lines.length) {
      // offline dictionary entry: "loại từ: nghĩa; nghĩa; nghĩa" per line
      if (!data.isWord && data.translation) {
        const trans = document.createElement('div');
        trans.className = 'rl-trans';
        trans.textContent = data.translation;
        p.appendChild(trans);
      }
      if (data.offline.viaLemma && data.offline.headword !== data.text.toLowerCase()) {
        const base = document.createElement('div');
        base.className = 'rl-base';
        base.textContent = `→ ${data.offline.headword}`;
        p.appendChild(base);
      }
      const dict = document.createElement('div');
      dict.className = 'rl-dict';
      for (const line of data.offline.lines.slice(0, 4)) {
        const row = document.createElement('div');
        row.className = 'rl-row';
        const pos = document.createElement('span');
        pos.className = 'rl-pos' + (line.field ? ' rl-field' : '');
        pos.textContent = line.label || '';
        const text = document.createElement('span');
        text.textContent = line.text;
        row.append(pos, text);
        dict.appendChild(row);
      }
      p.appendChild(dict);
      if (data.offline.example && options.showDefinition !== false) {
        const ex = document.createElement('div');
        ex.className = 'rl-def';
        ex.textContent = data.offline.example.vi ? `${data.offline.example.en} → ${data.offline.example.vi}` : data.offline.example.en;
        p.appendChild(ex);
      }
    } else {
      const trans = document.createElement('div');
      trans.className = 'rl-trans';
      trans.textContent = data.translation || '—';
      p.appendChild(trans);
      const dictRows = (data.dict || []).filter((d) => d.terms && d.terms.length);
      if (dictRows.length) {
        const dict = document.createElement('div');
        dict.className = 'rl-dict';
        for (const d of dictRows.slice(0, 4)) {
          const row = document.createElement('div');
          row.className = 'rl-row';
          const pos = document.createElement('span');
          pos.className = 'rl-pos';
          pos.textContent = ReadLexUI.shortPos(d.pos);
          const terms = document.createElement('span');
          terms.textContent = d.terms.slice(0, 5).join(', ');
          row.append(pos, terms);
          dict.appendChild(row);
        }
        p.appendChild(dict);
      }
    }

    if (!data.offline && options.showDefinition !== false && data.definitions && data.definitions.length) {
      const def = document.createElement('div');
      def.className = 'rl-def';
      const d = data.definitions[0];
      def.textContent = `${d.partOfSpeech ? d.partOfSpeech + ' · ' : ''}${d.definition}`;
      p.appendChild(def);
    }

    const footParts = [];
    if (data.lookupCount > 1) footParts.push(`Đã tra ${data.lookupCount} lần`);
    if (data.saved) footParts.push(`✓ Trong kho (${data.saved.exposureCount || 1} ngữ cảnh)`);
    else if (data.lookupCount >= 3) footParts.push('Gặp nhiều rồi, lưu lại nhé?');
    if (footParts.length) {
      const foot = document.createElement('div');
      foot.className = 'rl-foot';
      footParts.forEach((t, i) => {
        const s = document.createElement('span');
        s.textContent = (i ? '· ' : '') + t;
        if (t.startsWith('✓')) s.className = 'rl-ok';
        foot.appendChild(s);
      });
      p.appendChild(foot);
    }

    this.place(p, rect);
    this.visible = true;
  }

  saveButton(saved, onSave) {
    const save = document.createElement('button');
    save.className = 'rl-save' + (saved ? ' rl-saved' : '');
    save.textContent = saved ? '★ Đã lưu' : '☆ Lưu';
    save.title = saved ? 'Đã có trong kho. Bấm để lưu thêm ngữ cảnh này.' : 'Lưu vào kho từ vựng (kèm câu này)';
    save.addEventListener('click', async (e) => {
      e.stopPropagation();
      save.disabled = true;
      save.textContent = '…';
      try {
        const result = await onSave();
        save.classList.toggle('rl-saved', !!result || !!saved);
        save.textContent = result || saved ? '★ Đã lưu' : '☆ Lưu';
      } finally {
        save.disabled = false;
      }
    });
    return save;
  }

  // Sentence translation box (tudienjp-style). data: { translation, error, word? (LOOKUP result of the hovered word) }
  showSentence(rect, data, options = {}) {
    this.ensure();
    this.hideSelectionButton();
    this.pinned = !!options.pinned;
    const p = this.popup;
    p.classList.add('rl-sent');
    p.replaceChildren();
    if (data.error && !data.translation) {
      const err = document.createElement('div');
      err.className = 'rl-error';
      err.textContent = `Không dịch được: ${data.error}`;
      p.appendChild(err);
    } else {
      const t = document.createElement('div');
      t.className = 'rl-sent-text';
      t.textContent = data.translation || '—';
      p.appendChild(t);
    }
    if (data.word) p.appendChild(this.wordLine(data.word, options));
    this.place(p, rect);
    this.visible = true;
  }

  wordLine(word, options = {}) {
    const line = document.createElement('div');
    line.className = 'rl-sent-word';
    const w = document.createElement('span');
    w.className = 'rl-word';
    const jaFirst = word.ja && word.ja.results && word.ja.results[0];
    w.textContent = jaFirst ? jaFirst.headword : (word.ja && word.ja.kanji ? word.ja.kanji.literal : word.text);
    line.appendChild(w);
    if (jaFirst && jaFirst.reading) {
      const rd = document.createElement('span');
      rd.className = 'rl-reading';
      rd.textContent = `【${jaFirst.reading}】`;
      line.appendChild(rd);
    }
    if (options.showIpa !== false && word.ipa) {
      const ipa = document.createElement('span');
      ipa.className = 'rl-ipa';
      ipa.textContent = word.ipa;
      line.appendChild(ipa);
    }
    if (word.audio) {
      const btn = document.createElement('button');
      btn.className = 'rl-icon';
      btn.title = 'Nghe phát âm';
      btn.appendChild(ReadLexUI.icon('audio'));
      btn.addEventListener('click', (e) => { e.stopPropagation(); this.play(word.audio); });
      line.appendChild(btn);
    }
    if (options.onSaveWord) line.appendChild(this.saveButton(word.saved, options.onSaveWord));
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
      line.appendChild(m);
    }
    return line;
  }

  // Replace the word line of a visible sentence popup (mouse moved to another word in the same sentence).
  updateSentenceWord(word, options = {}) {
    if (!this.visible || !this.popup.classList.contains('rl-sent')) return;
    const old = this.popup.querySelector('.rl-sent-word');
    const line = word ? this.wordLine(word, options) : null;
    if (old && line) old.replaceWith(line);
    else if (old) old.remove();
    else if (line) this.popup.appendChild(line);
    if (this.lastRect) this.place(this.popup, this.lastRect);
  }

  renderJapanese(p, data, head) {
    const ja = data.ja;
    const results = ja.results || [];
    if (data.ja.matched && results[0] && data.ja.matched !== results[0].headword && data.ja.matched !== results[0].reading) {
      const base = document.createElement('div');
      base.className = 'rl-base';
      base.textContent = `${data.ja.matched} → ${results[0].headword}`;
      p.appendChild(base);
    }
    if (results[0] && results[0].trail.length) {
      const trail = document.createElement('div');
      trail.className = 'rl-trail';
      for (const t of results[0].trail.slice(0, 4)) {
        const b = document.createElement('span');
        b.textContent = t;
        trail.appendChild(b);
      }
      p.appendChild(trail);
    }
    results.slice(0, 3).forEach((r, i) => {
      const box = document.createElement('div');
      box.className = 'rl-entry';
      if (i > 0) {
        const hw = document.createElement('div');
        hw.className = 'rl-hw';
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
      b.textContent = k.literal;
      box.appendChild(b);
      const parts = [];
      if (k.meanings.length) parts.push(k.meanings.slice(0, 4).join(', '));
      if (k.on.length) parts.push(`on: ${k.on.join(' ')}`);
      if (k.kun.length) parts.push(`kun: ${k.kun.slice(0, 3).join(' ')}`);
      const meta = [k.jlpt ? `JLPT N${k.jlpt}` : '', k.grade ? `lớp ${k.grade}` : '', k.strokes ? `${k.strokes} nét` : ''].filter(Boolean).join(' · ');
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
    if (left + 34 > vw) left = vw - 40;
    if (top + 34 > vh) top = rect.top - 36;
    btn.style.left = `${Math.round(Math.max(4, left))}px`;
    btn.style.top = `${Math.round(Math.max(4, top))}px`;
  }

  hideSelectionButton() {
    if (this.button) this.button.hidden = true;
  }

  showToast(text, { actionLabel = '', onAction = null, duration = 4000 } = {}) {
    this.ensure();
    clearTimeout(this.toastTimer);
    this.toast.replaceChildren();
    const span = document.createElement('span');
    span.textContent = text;
    this.toast.appendChild(span);
    if (actionLabel && onAction) {
      const btn = document.createElement('button');
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
        style.textContent = '::highlight(readlex-word) { background-color: rgba(79, 70, 229, .22); }';
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
