// Wires page events (hover, selection, context menu) to the locator, the UI and the background.

(() => {
  if (window.__readlexLoaded) return;
  window.__readlexLoaded = true;

  const DEFAULTS = {
    enabled: true, hoverMode: 'hover', hoverTarget: 'sentence', hoverDelay: 300, selectionMode: 'auto', skipCommonWords: true,
    showIpa: true, showDefinition: true, popupTheme: 'auto', disabledSites: [],
  };

  const STOPWORDS = new Set(('a an the and or but of to in on at by for with from as is are was were be been being ' +
    'have has had do does did will would can could should may might must shall this that these those it its he she they ' +
    'them his her their we us our you your i me my mine who whom whose which what when where why how not no yes if then than ' +
    'so such there here all any some each every both few more most other another much many own same too very just also only ' +
    'even still yet again ever never now up down out over under into onto off about after before between through during ' +
    'without within against among around because while until since although though whether either neither nor one two three ' +
    'four five six seven eight nine ten first second last new old good bad big small long short high low get got go went make ' +
    'made take took come came see saw know knew say said think thought want like look use find give tell work call try ask need ' +
    'feel become leave put mean keep let begin seem help show hear play run move live believe bring happen write sit stand lose ' +
    'pay meet include continue set learn change lead understand watch follow stop create speak read spend grow open walk win ' +
    'teach offer remember consider appear buy serve die send build stay fall cut reach kill raise pass sell decide return ' +
    'people time year years day days way thing things man woman world life hand part child children eye place week case point ' +
    'number group problem fact home water room mother father area money story month lot right study book job word business ' +
    'side kind head house service friend power hour game line end member law car city name team minute idea body information ' +
    'back parent face level office door health person art war history party result morning reason girl guy moment air ' +
    'am pm mr mrs ms dr etc vs ok okay oh ah hi hello well really very much more less least far near away back down up ' +
    'said says told asked according also however therefore thus meanwhile instead already almost always often sometimes ' +
    'usually rarely never today tomorrow yesterday tonight week weeks month months year years ago later soon early late ' +
    'above below across along behind beside beyond despite except inside outside toward towards upon via per').split(/\s+/));

  const ui = new ReadLexUI();
  ui.audioFallback = async (url) => {
    const resp = await send('FETCH_AUDIO', { url });
    return resp.ok ? resp.data.dataUrl : null;
  };
  let settings = { ...DEFAULTS };
  let siteDisabled = false;

  const PREFETCH_DELAY = 120;  // start the lookup this early; show it after settings.hoverDelay
  const NEAR_PX = 28;          // still show the popup if the mouse drifted this far from the word
  let hoverTimer = null;
  let prefetchTimer = null;
  let hideTimer = null;
  let pendingItem = null;     // word / sentence waiting for the hover delay
  let shownItem = null;       // word / sentence currently displayed by the hover popup
  let shownWordText = '';     // word line inside a sentence popup ("both" mode)
  let wordLineTimer = null;
  let hoverToken = 0;
  let lookupToken = 0;
  const pageCache = new Map(); // "kind:text" -> Promise<LOOKUP response>
  let lastMove = 0;
  let lastMouse = { x: 0, y: 0 };
  let mouseDown = false;
  const lookedUpOnPage = new Set();

  function send(type, payload = {}) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type, ...payload }, (resp) => {
          if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
          else resolve(resp || { ok: false, error: 'No response from the extension' });
        });
      } catch (err) {
        resolve({ ok: false, error: err.message || 'The extension was reloaded. Refresh this page' });
      }
    });
  }

  async function loadSettings() {
    try {
      const { settings: stored } = await chrome.storage.local.get('settings');
      settings = { ...DEFAULTS, ...(stored || {}) };
    } catch (_) {
      settings = { ...DEFAULTS };
    }
    siteDisabled = !settings.enabled || (settings.disabledSites || []).includes(location.hostname);
    ui.setTheme(settings.popupTheme);
    if (siteDisabled) ui.hideAll();
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.settings) loadSettings();
    });
  } catch (_) { /* ignore */ }

  function lookupCached(text, kind) {
    const key = `${kind}:${text.toLowerCase()}`;
    if (!pageCache.has(key)) {
      const countLookup = kind === 'word' && !lookedUpOnPage.has(text.toLowerCase());
      if (kind === 'word') lookedUpOnPage.add(text.toLowerCase());
      const promise = send('LOOKUP', { text, kind, countLookup, url: location.href, title: document.title })
        .then((resp) => { if (!resp.ok) pageCache.delete(key); return resp; });
      pageCache.set(key, promise);
      if (pageCache.size > 500) pageCache.delete(pageCache.keys().next().value);
    }
    return pageCache.get(key);
  }

  function nearWord(word) {
    const r = word.rect;
    return lastMouse.x >= r.left - NEAR_PX && lastMouse.x <= r.right + NEAR_PX && lastMouse.y >= r.top - NEAR_PX && lastMouse.y <= r.bottom + NEAR_PX;
  }

  function hoverable(text) {
    if (text.length < 2 || !/[A-Za-zÀ-ɏ]/.test(text)) return false;
    if (settings.hoverMode === 'hover' && settings.skipCommonWords && STOPWORDS.has(text.toLowerCase())) return false;
    return true;
  }

  function cleanWord(text) {
    return String(text || '')
      .replace(/[’']s$/i, '')
      .replace(/^[^A-Za-zÀ-ɏ]+|[^A-Za-zÀ-ɏ]+$/g, '');
  }

  function hoverAllowed(e) {
    if (siteDisabled) return false;
    switch (settings.hoverMode) {
      case 'hover': return true;
      case 'alt': return !!e.altKey;
      case 'ctrl': return !!(e.ctrlKey || e.metaKey);
      default: return false;
    }
  }

  function sameItem(a, b) {
    if (!a || !b || a.type !== b.type) return false;
    if (a.type === 'sentence') return a.block === b.block && a.start === b.start && a.end === b.end;
    if (a.type === 'ja') return a.node === b.node && a.offset >= b.offset && a.offset < b.offset + (b.matchedLength || 1);
    return a.node === b.node && a.start === b.start && a.end === b.end;
  }

  function scheduleHide(delay = 250) {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!ui.pinned) { ui.hidePopup(); shownItem = null; }
    }, delay);
  }

  function cancelHover() {
    clearTimeout(hoverTimer);
    clearTimeout(prefetchTimer);
    clearTimeout(wordLineTimer);
    pendingItem = null;
    hoverToken += 1;
  }

  // What hover translates: the sentence under the pointer (tudienjp style), the word, or both.
  // Holding Shift temporarily switches between sentence and word.
  function hoverTargetFor(e) {
    const base = settings.hoverTarget || 'sentence';
    if (!e || !e.shiftKey) return base;
    return base === 'word' ? 'sentence' : 'word';
  }

  function itemAtPoint(x, y, target) {
    if (target === 'word') return ReadLexLocator.tokenAtPoint(x, y);
    const sentence = ReadLexLocator.sentenceAtPoint(x, y);
    if (!sentence) return null;
    if (sentence.wordCount <= 2) return ReadLexLocator.tokenAtPoint(x, y); // headings like "Subjects:"
    return sentence;
  }

  function nearItem(item) {
    if (item.type === 'sentence') {
      const m = 12;
      return item.rects.some((r) => lastMouse.x >= r.left - m && lastMouse.x <= r.right + m && lastMouse.y >= r.top - m && lastMouse.y <= r.bottom + m);
    }
    return nearWord(item);
  }

  function anchorFor(item) {
    if (item.type === 'sentence') {
      return { left: lastMouse.x - 24, right: lastMouse.x + 24, top: item.rect.top, bottom: item.rect.bottom };
    }
    return item.rect;
  }

  // ---- hover ----

  function onMouseMove(e) {
    lastMouse = { x: e.clientX, y: e.clientY };
    const now = Date.now();
    if (now - lastMove < 40) return;
    lastMove = now;

    if (ui.isEventInside(e)) { clearTimeout(hideTimer); return; }
    if (ui.pinned || mouseDown || (e.buttons & 1)) return;
    if (!hoverAllowed(e)) {
      cancelHover();
      if (ui.visible) scheduleHide();
      return;
    }
    const target = hoverTargetFor(e);
    const item = itemAtPoint(e.clientX, e.clientY, target === 'both' ? 'sentence' : target);
    if (!item) {
      cancelHover();
      if (ui.visible) scheduleHide();
      return;
    }
    if (ui.visible && sameItem(item, shownItem)) {
      clearTimeout(hideTimer);
      cancelHover();
      if (item.type === 'sentence' && target === 'both') refreshWordLine();
      return;
    }
    if (sameItem(item, pendingItem)) return;
    cancelHover();
    if (ui.visible) scheduleHide();
    startHover(item, { delay: Math.max(100, settings.hoverDelay || 300), both: target === 'both' });
  }

  // Start the lookup early (PREFETCH_DELAY) and show the popup once both the delay has passed
  // and the answer is in. Dictionary words are instant; sentences need one Google call (cached).
  function tokenLookup(token) {
    if (!token) return null;
    if (token.type === 'ja') return lookupCached(token.text, 'scan');
    const text = cleanWord(token.text);
    return hoverable(text) ? lookupCached(text, 'word') : null;
  }

  function tokenSurface(token) {
    return token.type === 'ja' ? token.text : cleanWord(token.text);
  }

  function startHover(item, { delay, both = false }) {
    const isJa = item.type === 'ja';
    const isWord = item.type === 'word' || isJa;
    const text = isJa ? item.text : isWord ? cleanWord(item.text) : item.text;
    if (item.type === 'word' && !hoverable(text)) return;
    if (!isWord && text.length < 3) return;
    pendingItem = item;
    const token = ++hoverToken;
    const wordUnder = both ? ReadLexLocator.tokenAtPoint(lastMouse.x, lastMouse.y) : null;
    const wordText = wordUnder ? tokenSurface(wordUnder) : '';
    let promise = null;
    let wordPromise = null;
    const kick = () => {
      if (!promise) promise = lookupCached(text, isJa ? 'scan' : isWord ? 'word' : 'sentence');
      if (both && wordUnder && !wordPromise) wordPromise = tokenLookup(wordUnder);
    };
    prefetchTimer = setTimeout(kick, Math.min(PREFETCH_DELAY, delay));
    hoverTimer = setTimeout(async () => {
      kick();
      const loadingTimer = setTimeout(() => {
        if (token === hoverToken && !ui.pinned && nearItem(item)) ui.showLoading(anchorFor(item));
      }, 150);
      const resp = await promise;
      clearTimeout(loadingTimer);
      if (token !== hoverToken || ui.pinned) return;
      if (!nearItem(item)) { if (ui.visible && !shownItem) ui.hidePopup(); return; }
      pendingItem = null;
      if (!resp.ok) {
        console.debug('ReadLex lookup failed:', resp.error);
        if (ui.visible && !shownItem) ui.hidePopup();
        return;
      }
      clearTimeout(hideTimer);
      if (isJa) {
        const len = resp.data.matchedLength || 0;
        if (!len) { if (ui.visible && !shownItem) ui.hidePopup(); return; }
        const range = document.createRange();
        try {
          range.setStart(item.node, item.offset);
          range.setEnd(item.node, Math.min(item.node.data.length, item.offset + len));
        } catch (_) { return; }
        const rects = Array.from(range.getClientRects());
        item.matchedLength = len;
        item.range = range;
        item.rect = rects.find((r) => lastMouse.y >= r.top - 2 && lastMouse.y <= r.bottom + 2) || rects[0] || item.rect;
        shownItem = item;
        ui.highlightRange(range);
        const ctx = ReadLexLocator.contextForRange(range);
        ui.showPopup(item.rect, resp.data, {
          pinned: false,
          showIpa: settings.showIpa,
          showDefinition: settings.showDefinition,
          onSave: () => saveWord(jaSaveFields(resp.data), ctx, resp.data),
        });
        return;
      }
      if (isWord) {
        shownItem = item;
        ui.highlightRange(item.range);
        const ctx = ReadLexLocator.contextForRange(item.range);
        ui.showPopup(item.rect, resp.data, {
          pinned: false,
          showIpa: settings.showIpa,
          showDefinition: settings.showDefinition,
          onSave: () => saveWord(text, ctx, resp.data),
        });
        return;
      }
      const wordResp = wordPromise ? await wordPromise : null;
      if (token !== hoverToken || ui.pinned) return;
      shownItem = item;
      const wordData = wordResp && wordResp.ok && (wordResp.data.matchedLength !== 0) ? wordResp.data : null;
      shownWordText = wordData ? wordText : '';
      ui.showSentence(anchorFor(item), { translation: resp.data.translation, error: resp.data.error, word: wordData }, {
        showIpa: settings.showIpa,
        shiftHint: (settings.hoverTarget || 'sentence') !== 'word', // in "word" mode this box is already the Shift view
        onSaveWord: wordData ? () => saveWord(wordUnder.type === 'ja' ? jaSaveFields(wordData) : wordText, ReadLexLocator.contextForRange(wordUnder.range), wordData) : null,
      });
    }, delay);
  }

  // "both" mode: the mouse moved to another word inside the sentence that is already shown.
  function refreshWordLine() {
    const word = ReadLexLocator.tokenAtPoint(lastMouse.x, lastMouse.y);
    const text = word ? tokenSurface(word) : '';
    if (!text || text.toLowerCase() === shownWordText.toLowerCase()) return;
    if (word.type === 'word' && !hoverable(text)) return;
    clearTimeout(wordLineTimer);
    const sentence = shownItem;
    wordLineTimer = setTimeout(async () => {
      const resp = await tokenLookup(word);
      if (!resp || !ui.visible || shownItem !== sentence || ui.pinned) return;
      if (!resp.ok || resp.data.matchedLength === 0) return;
      shownWordText = text;
      ui.updateSentenceWord(resp.data, {
        showIpa: settings.showIpa,
        onSaveWord: () => saveWord(word.type === 'ja' ? jaSaveFields(resp.data) : text, ReadLexLocator.contextForRange(word.range), resp.data),
      });
    }, 120);
  }

  // Fields the background needs to store a Japanese word (dictionary form + reading).
  function jaSaveFields(data) {
    const r = data.ja && data.ja.results && data.ja.results[0];
    if (r) return { surface: data.ja.matched || data.text, language: 'ja', lemma: r.headword, reading: r.reading || '' };
    if (data.ja && data.ja.kanji) return { surface: data.ja.kanji.literal, language: 'ja', lemma: data.ja.kanji.literal, reading: '' };
    return { surface: data.text, language: 'ja', lemma: data.text, reading: '' };
  }

  // ---- selection ----

  function onMouseUp(e) {
    mouseDown = false;
    if (ui.isEventInside(e)) return;
    if (siteDisabled || settings.selectionMode === 'off') return;
    setTimeout(() => handleSelection(), 10);
  }

  function handleSelection() {
    const sel = ReadLexLocator.selectionInfo();
    if (!sel) return;
    if (sel.text.length > 600) return;
    if (!/[A-Za-zÀ-ɏ]/.test(sel.text)) return;
    cancelHover();
    if (settings.selectionMode === 'button') {
      ui.showSelectionButton(sel.rect, () => translateSelection(sel));
    } else {
      translateSelection(sel);
    }
  }

  async function translateSelection(sel) {
    const japanese = ReadLexLocator.hasJapanese(sel.text);
    const isWord = !japanese && !/\s/.test(sel.text);
    const text = japanese ? sel.text.replace(/\s+/g, '') : isWord ? cleanWord(sel.text) : sel.text;
    if (!text) return;
    const token = ++lookupToken;
    cancelHover();
    const ctx = ReadLexLocator.contextForRange(sel.range);
    ui.pinned = true;
    const loadingTimer = setTimeout(() => { if (token === lookupToken) ui.showLoading(sel.rect); }, 150);
    const resp = await lookupCached(text, japanese ? 'ja-phrase' : isWord ? 'word' : 'phrase');
    clearTimeout(loadingTimer);
    if (token !== lookupToken) return;
    if (!resp.ok) {
      ui.showPopup(sel.rect, { text, isWord, error: resp.error, translation: null }, { pinned: true, onSave: () => saveWord(text, ctx, null) });
      return;
    }
    shownItem = null;
    const saveArg = resp.data.ja ? jaSaveFields(resp.data) : text;
    ui.showPopup(sel.rect, resp.data, {
      pinned: true,
      showIpa: settings.showIpa,
      showDefinition: settings.showDefinition,
      onSave: () => saveWord(saveArg, ctx, resp.data),
    });
  }

  // ---- save ----

  async function saveWord(surfaceOrFields, ctx, lookupResult) {
    const fields = typeof surfaceOrFields === 'string' ? { surface: surfaceOrFields } : surfaceOrFields;
    const resp = await send('SAVE_VOCABULARY', {
      ...fields,
      sentence: ctx?.sentence || '',
      paragraph: ctx?.paragraph || '',
      url: location.href,
      pageTitle: document.title,
      lookupResult: lookupResult && !lookupResult.error ? lookupResult : null,
    });
    if (!resp.ok) {
      ui.showToast(`Could not save: ${resp.error}`);
      return null;
    }
    const { vocabulary, exposure, created, duplicateExposure } = resp.data;
    if (lookupResult) lookupResult.saved = { id: vocabulary.id, lemma: vocabulary.lemma, status: vocabulary.status, exposureCount: vocabulary.exposureCount };
    const label = vocabulary.lemma;
    const text = created
      ? (ctx?.sentence ? `Saved “${label}” with this sentence` : `Saved “${label}” to ReadLex`)
      : duplicateExposure ? `“${label}” is already saved with this sentence` : `Added a new sentence for “${label}”`;
    ui.showToast(text, {
      kind: 'ok',
      actionLabel: duplicateExposure ? '' : 'Undo',
      onAction: () => send('UNDO_SAVE', { vocabularyId: vocabulary.id, exposureId: exposure?.id, created }),
    });
    return resp.data;
  }

  // ---- context menu / background messages ----

  async function handleContextMenu(msg) {
    const sel = ReadLexLocator.selectionInfo();
    const surface = sel ? sel.text : String(msg.text || '').trim();
    if (!surface) return { handled: false };
    const ctx = sel ? ReadLexLocator.contextForRange(sel.range) : { sentence: surface, paragraph: '' };
    if (msg.action === 'save') {
      if (ReadLexLocator.hasJapanese(surface)) {
        const text = surface.replace(/\s+/g, '');
        const resp = await lookupCached(text, 'ja-phrase');
        await saveWord(resp.ok && resp.data.ja ? jaSaveFields(resp.data) : { surface: text, language: 'ja', lemma: text }, ctx, resp.ok ? resp.data : null);
        return { handled: true };
      }
      const isWord = !/\s/.test(surface);
      await saveWord(isWord ? cleanWord(surface) : surface, ctx, null);
      return { handled: true };
    }
    if (msg.action === 'translate') {
      const fake = sel || { text: surface, range: null, rect: { left: lastMouse.x, right: lastMouse.x, top: lastMouse.y, bottom: lastMouse.y } };
      if (!fake.range) {
        const r = document.createRange();
        r.setStart(document.body, 0);
        r.collapse(true);
        fake.range = r;
      }
      await translateSelection(fake);
      return { handled: true };
    }
    return { handled: false };
  }

  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || typeof msg.type !== 'string') return false;
      if (msg.type === 'CONTEXT_MENU') {
        handleContextMenu(msg).then((r) => sendResponse({ ok: true, ...r })).catch((err) => sendResponse({ ok: false, error: err.message }));
        return true;
      }
      if (msg.type === 'SHOW_TOAST') { ui.showToast(msg.text || ''); sendResponse({ ok: true }); return false; }
      if (msg.type === 'PING') { sendResponse({ ok: true }); return false; }
      return false;
    });
  } catch (_) { /* ignore */ }

  // ---- global listeners ----

  document.addEventListener('mousemove', onMouseMove, { passive: true, capture: true });
  document.addEventListener('mousedown', (e) => {
    if (ui.isEventInside(e)) return;
    mouseDown = true;
    cancelHover();
    ui.hidePopup();
    ui.hideSelectionButton();
    shownItem = null;
  }, { capture: true });
  document.addEventListener('mouseup', onMouseUp, { capture: true });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { cancelHover(); ui.hideAll(); shownItem = null; return; }
    if (e.repeat || siteDisabled || ui.pinned) return;
    const trigger = (e.key === 'Alt' && settings.hoverMode === 'alt') || ((e.key === 'Control' || e.key === 'Meta') && settings.hoverMode === 'ctrl');
    const toggle = e.key === 'Shift' && hoverAllowed(e);
    if (trigger || toggle) {
      const target = hoverTargetFor(e);
      const item = itemAtPoint(lastMouse.x, lastMouse.y, target === 'both' ? 'sentence' : target);
      if (item && !sameItem(item, shownItem)) { cancelHover(); startHover(item, { delay: 0, both: target === 'both' }); }
    }
  }, { capture: true });
  window.addEventListener('scroll', () => {
    cancelHover();
    if (ui.visible || ui.pinned) { ui.hidePopup(); shownItem = null; }
    ui.hideSelectionButton();
  }, { passive: true, capture: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelHover(); ui.hideAll(); shownItem = null; } });
  window.addEventListener('blur', () => { cancelHover(); if (!ui.pinned) { ui.hidePopup(); shownItem = null; } });

  loadSettings();
})();
