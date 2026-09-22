// Finds the word under the mouse pointer and extracts sentence / paragraph context.
// Classic content script: exposes a single global `ReadLexLocator` used by main.js.

const ReadLexLocator = (() => {
  const hasSegmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function';
  const wordSegmenter = hasSegmenter ? new Intl.Segmenter('en', { granularity: 'word' }) : null;
  const sentenceSegmenter = hasSegmenter ? new Intl.Segmenter('en', { granularity: 'sentence' }) : null;
  const sentenceSegmenterJa = hasSegmenter ? new Intl.Segmenter('ja', { granularity: 'sentence' }) : null;
  const JA_CHAR_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f\u3005\u30fc]/;
  const hasJapanese = (text) => JA_CHAR_RE.test(String(text || ''));
  const segmenterFor = (text) => (hasJapanese(text) ? sentenceSegmenterJa : sentenceSegmenter);

  const BLOCK_TAGS = new Set([
    'P', 'DIV', 'LI', 'TD', 'TH', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'ARTICLE',
    'SECTION', 'MAIN', 'ASIDE', 'HEADER', 'FOOTER', 'FIGCAPTION', 'DD', 'DT', 'PRE', 'BODY', 'UL',
    'OL', 'TABLE', 'FORM', 'NAV', 'SUMMARY', 'DETAILS', 'CAPTION',
  ]);
  const WORD_FALLBACK_RE = /[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ'’-]*/g;

  function normalize(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function isEditable(node) {
    const el = node && node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    if (el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]')) return true;
    return !!el.isContentEditable;
  }

  function caretFromPoint(x, y) {
    if (typeof document.caretPositionFromPoint === 'function') {
      const pos = document.caretPositionFromPoint(x, y);
      if (!pos) return null;
      return { node: pos.offsetNode, offset: pos.offset };
    }
    if (typeof document.caretRangeFromPoint === 'function') {
      const r = document.caretRangeFromPoint(x, y);
      if (!r) return null;
      return { node: r.startContainer, offset: r.startOffset };
    }
    return null;
  }

  function segmentAt(text, offset) {
    if (wordSegmenter) {
      const seg = wordSegmenter.segment(text).containing(offset);
      if (!seg || !seg.isWordLike) return null;
      return { text: seg.segment, start: seg.index, end: seg.index + seg.segment.length };
    }
    WORD_FALLBACK_RE.lastIndex = 0;
    let m;
    while ((m = WORD_FALLBACK_RE.exec(text))) {
      if (offset >= m.index && offset < m.index + m[0].length) {
        return { text: m[0], start: m.index, end: m.index + m[0].length };
      }
      if (m.index > offset) break;
    }
    return null;
  }

  // Returns { text, node, start, end, range, rect } or null when the pointer is not over a word.
  function wordAtPoint(x, y) {
    const caret = caretFromPoint(x, y);
    if (!caret || !caret.node || caret.node.nodeType !== Node.TEXT_NODE) return null;
    const node = caret.node;
    const text = node.data || '';
    if (!text.trim()) return null;
    if (isEditable(node)) return null;
    const parent = node.parentElement;
    if (parent && parent.closest('script, style, noscript, svg, math')) return null;

    let seg = null;
    const candidates = [caret.offset, caret.offset - 1];
    for (const off of candidates) {
      if (off < 0 || off >= text.length) continue;
      seg = segmentAt(text, off);
      if (seg) break;
    }
    if (!seg) return null;
    if (!/[A-Za-zÀ-ɏ]/.test(seg.text)) return null;

    const range = document.createRange();
    range.setStart(node, seg.start);
    range.setEnd(node, seg.end);
    const rects = Array.from(range.getClientRects());
    if (!rects.length) return null;
    const hit = rects.find((r) => x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2);
    if (!hit) return null;
    return { type: 'word', text: seg.text, node, start: seg.start, end: seg.end, range, rect: hit };
  }

  function findBlock(node) {
    let el = node && node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    while (el && el !== document.body && el !== document.documentElement) {
      if (BLOCK_TAGS.has(el.tagName)) return el;
      try {
        const d = getComputedStyle(el).display;
        if (d === 'block' || d === 'list-item' || d === 'table-cell' || d === 'flex' || d === 'grid' || d === 'flow-root') return el;
      } catch (_) { /* detached */ }
      el = el.parentElement;
    }
    return el || document.body;
  }

  function sentenceAround(fullText, start, end) {
    let sentence = null;
    const segmenter = segmenterFor(fullText);
    if (segmenter && fullText.length <= 20000) {
      const seg = segmenter.segment(fullText).containing(Math.min(start, Math.max(0, fullText.length - 1)));
      if (seg) sentence = seg.segment;
    }
    if (sentence === null) {
      // regex fallback: split on sentence punctuation followed by whitespace
      let s = start;
      while (s > 0 && !/[.!?。\n]/.test(fullText[s - 1])) s--;
      let e = end;
      while (e < fullText.length && !/[.!?。\n]/.test(fullText[e])) e++;
      sentence = fullText.slice(s, e + 1);
    }
    sentence = normalize(sentence);
    if (sentence.length > 400) {
      const rel = Math.max(0, Math.min(sentence.length, normalize(fullText.slice(0, start)).length));
      const from = Math.max(0, rel - 200);
      sentence = (from > 0 ? '…' : '') + sentence.slice(from, from + 400) + (from + 400 < sentence.length ? '…' : '');
    }
    return sentence;
  }

  // Map [start, end) character offsets of block.textContent back to a DOM Range.
  function rangeFromOffsets(block, start, end) {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let acc = 0;
    let node;
    let startSet = false;
    while ((node = walker.nextNode())) {
      const len = node.data.length;
      if (!startSet && start < acc + len) { range.setStart(node, start - acc); startSet = true; }
      if (startSet && end <= acc + len) { range.setEnd(node, Math.max(0, end - acc)); return range; }
      acc += len;
    }
    if (startSet) { range.setEnd(block, block.childNodes.length); return range; }
    return null;
  }

  const sentenceCache = { block: null, text: '', segments: null };

  // Returns the sentence under the pointer: { type:'sentence', text, range, rect, rects, block, start, end, wordCount }.
  function sentenceAtPoint(x, y) {
    const caret = caretFromPoint(x, y);
    if (!caret || !caret.node || caret.node.nodeType !== Node.TEXT_NODE) return null;
    const node = caret.node;
    if (!(node.data || '').trim() || isEditable(node)) return null;
    const parent = node.parentElement;
    if (parent && parent.closest('script, style, noscript, svg, math, textarea, code, pre')) return null;
    const block = findBlock(node);
    const full = block.textContent || '';
    if (!full.trim()) return null;

    let start;
    let end;
    const segmenter = segmenterFor(full);
    if (segmenter && full.length <= 20000) {
      const pre = document.createRange();
      pre.setStart(block, 0);
      pre.setEnd(node, caret.offset);
      const offset = pre.toString().length;
      if (sentenceCache.block !== block || sentenceCache.text !== full) {
        sentenceCache.block = block;
        sentenceCache.text = full;
        sentenceCache.segments = segmenter.segment(full);
      }
      const seg = sentenceCache.segments.containing(Math.min(offset, Math.max(0, full.length - 1)));
      if (!seg) return null;
      const lead = seg.segment.length - seg.segment.trimStart().length;
      const trail = seg.segment.length - seg.segment.trimEnd().length;
      start = seg.index + lead;
      end = seg.index + seg.segment.length - trail;
    } else {
      // huge block or no segmenter: split the text node itself on sentence punctuation
      const text = node.data;
      let s = Math.min(caret.offset, text.length - 1);
      let e = s;
      while (s > 0 && !/[.!?。！？\n]/.test(text[s - 1])) s--;
      while (e < text.length && !/[.!?。！？\n]/.test(text[e])) e++;
      const pre = document.createRange();
      pre.setStart(block, 0);
      pre.setEnd(node, 0);
      const base = pre.toString().length;
      start = base + s;
      end = base + Math.min(text.length, e + 1);
    }
    if (end <= start) return null;
    const range = rangeFromOffsets(block, start, end);
    if (!range) return null;
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
    if (!rects.length) return null;
    const hit = rects.find((r) => x >= r.left - 3 && x <= r.right + 3 && y >= r.top - 3 && y <= r.bottom + 3);
    if (!hit) return null;
    const text = normalize(range.toString());
    const japanese = hasJapanese(text);
    if (!japanese && !/[A-Za-zÀ-ɏ]/.test(text)) return null;
    const wordCount = japanese ? Math.max(1, Math.round(text.length / 2)) : text.split(' ').length;
    return { type: 'sentence', text, range, rect: hit, rects, block, start, end, wordCount, lang: japanese ? 'ja' : 'en' };
  }

  // Japanese run of text starting under the pointer (no spaces between words: the dictionary
  // decides where the word ends). Returns { type:'ja', node, offset, text, rect } or null.
  function jaTextAtPoint(x, y) {
    const caret = caretFromPoint(x, y);
    if (!caret || !caret.node || caret.node.nodeType !== Node.TEXT_NODE) return null;
    const node = caret.node;
    const text = node.data || '';
    if (!text.trim() || isEditable(node)) return null;
    const parent = node.parentElement;
    if (parent && parent.closest('script, style, noscript, svg, math, rt')) return null;
    for (const off of [caret.offset, caret.offset - 1]) {
      if (off < 0 || off >= text.length) continue;
      if (!JA_CHAR_RE.test(text[off])) continue;
      const r = document.createRange();
      r.setStart(node, off);
      r.setEnd(node, off + 1);
      const rect = r.getBoundingClientRect();
      if (!(x >= rect.left - 2 && x <= rect.right + 2 && y >= rect.top - 2 && y <= rect.bottom + 2)) continue;
      let run = '';
      for (let i = off; i < text.length && run.length < 20 && JA_CHAR_RE.test(text[i]); i++) run += text[i];
      return { type: 'ja', node, offset: off, text: run, rect, range: r };
    }
    return null;
  }

  // Word (English) or Japanese run under the pointer.
  function tokenAtPoint(x, y) {
    return jaTextAtPoint(x, y) || wordAtPoint(x, y);
  }

  // Sentence and paragraph text around a Range (a hovered word or the user's selection).
  function contextForRange(range) {
    try {
      const block = findBlock(range.startContainer);
      const full = block.textContent || '';
      const pre = document.createRange();
      pre.setStart(block, 0);
      pre.setEnd(range.startContainer, range.startOffset);
      const start = pre.toString().length;
      const end = start + range.toString().length;
      return {
        sentence: sentenceAround(full, start, end),
        paragraph: normalize(full).slice(0, 1200),
      };
    } catch (_) {
      return { sentence: normalize(range.toString()), paragraph: '' };
    }
  }

  // Current user selection: { text, range, rect } or null.
  function selectionInfo() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    const text = normalize(sel.toString());
    if (!text) return null;
    if (isEditable(range.startContainer) || isEditable(range.endContainer)) return null;
    const rects = Array.from(range.getClientRects());
    const rect = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
    return { text, range: range.cloneRange(), rect, firstRect: rects[0] || rect };
  }

  return { wordAtPoint, jaTextAtPoint, tokenAtPoint, sentenceAtPoint, contextForRange, selectionInfo, isEditable, normalize, hasJapanese };
})();
