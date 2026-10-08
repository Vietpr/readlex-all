// Background service worker: message router, context menus, alarms, badge.

import { getSettings, setSettings } from './settings.js';
import { lookup, pruneCache, clearCache, fetchAudioDataUrl } from './translate.js';
import { dictionaryInfo } from './offline-dict.js';
import { dictionaryInfo as jaDictionaryInfo } from './ja-dict.js';
import * as vocab from './vocabulary.js';
import { processQueue, enrichOne, testGemini } from './enrich.js';

const MENU_SAVE = 'readlex-save';
const MENU_TRANSLATE = 'readlex-translate';

function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_SAVE, title: 'Save "%s" to ReadLex', contexts: ['selection'] });
    chrome.contextMenus.create({ id: MENU_TRANSLATE, title: 'Translate "%s" (ReadLex)', contexts: ['selection'] });
  });
}

function setupAlarms() {
  chrome.alarms.get('readlex-enrich', (a) => { if (!a) chrome.alarms.create('readlex-enrich', { periodInMinutes: 1 }); });
  chrome.alarms.get('readlex-maintenance', (a) => { if (!a) chrome.alarms.create('readlex-maintenance', { periodInMinutes: 360 }); });
}

chrome.runtime.onInstalled.addListener(() => {
  setupContextMenus();
  setupAlarms();
  vocab.updateBadge().catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  setupAlarms();
  vocab.updateBadge().catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'readlex-enrich') {
    processQueue().catch(() => {});
    vocab.flushOutbox().then(() => vocab.pullEnriched()).catch(() => {});
  }
  if (alarm.name === 'readlex-maintenance') {
    pruneCache().catch(() => {});
    vocab.flushOutbox().catch(() => {});
  }
});

async function sendToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (_) {
    return null;
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  const text = (info.selectionText || '').trim();
  if (!text) return;
  if (info.menuItemId === MENU_SAVE) {
    const handled = await sendToTab(tab.id, { type: 'CONTEXT_MENU', action: 'save', text });
    if (!handled?.ok) {
      // Content script not available on this page: save with what we know.
      try {
        await vocab.saveVocabulary({ surface: text, sentence: text, url: info.pageUrl || tab.url || '', pageTitle: tab.title || '' });
        processQueue().catch(() => {});
      } catch (err) {
        console.warn('ReadLex save failed', err);
      }
    }
  } else if (info.menuItemId === MENU_TRANSLATE) {
    await sendToTab(tab.id, { type: 'CONTEXT_MENU', action: 'translate', text });
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-hover') return;
  const s = await getSettings();
  let next;
  if (s.hoverMode === 'off') next = await setSettings({ hoverMode: s.lastHoverMode || 'hover' });
  else next = await setSettings({ hoverMode: 'off', lastHoverMode: s.hoverMode });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) sendToTab(tab.id, { type: 'SHOW_TOAST', text: next.hoverMode === 'off' ? 'ReadLex: hover translation is off' : 'ReadLex: hover translation is on' });
});

async function handleMessage(msg, sender) {
  switch (msg.type) {
    case 'PING':
      return { pong: true };

    case 'LOOKUP': {
      const text = msg.kind === 'scan' ? String(msg.text || '') : String(msg.text || '').trim();
      const settings = await getSettings();
      const result = await lookup(text, { target: settings.targetLang || 'vi', kind: msg.kind || 'word', source: msg.source || 'auto' });
      const keyText = result.headword || text;
      let lookups = null;
      if (result.isWord && (result.matchedLength !== 0)) {
        lookups = msg.countLookup
          ? await vocab.recordLookup(keyText, { url: msg.url || sender?.url || '', title: msg.title || '', language: result.source })
          : await vocab.getLookup(keyText, result.source);
      }
      const saved = msg.kind === 'sentence' || result.matchedLength === 0 ? null : await vocab.findBySurface(keyText, result.source);
      return {
        ...result,
        lookupCount: lookups?.count || 0,
        saved: saved ? { id: saved.id, lemma: saved.lemma, status: saved.status, exposureCount: saved.exposureCount } : null,
      };
    }

    case 'SAVE_VOCABULARY': {
      const result = await vocab.saveVocabulary({
        surface: msg.surface,
        language: msg.language || 'en',
        lemma: msg.lemma || null,
        reading: msg.reading || '',
        sentence: msg.sentence,
        paragraph: msg.paragraph,
        url: msg.url || sender?.url || '',
        pageTitle: msg.pageTitle || '',
        lookupResult: msg.lookupResult || null,
      });
      if (result.created) processQueue().catch(() => {});
      return result;
    }

    case 'UNDO_SAVE':
      return vocab.undoSave(msg);

    case 'GET_SETTINGS':
      return getSettings();

    case 'SET_SETTINGS':
      return setSettings(msg.patch || {});

    case 'LIST_VOCABULARY':
      return vocab.listVocabulary(msg.params || {});

    case 'GET_VOCABULARY':
      return vocab.getVocabularyDetail(msg.id);

    case 'UPDATE_VOCABULARY':
      return vocab.updateVocabulary(msg.id, msg.patch || {});

    case 'DELETE_VOCABULARY':
      await vocab.deleteVocabulary(msg.id);
      return { deleted: true };

    case 'DELETE_EXPOSURE':
      await vocab.deleteExposure(msg.id);
      return { deleted: true };

    case 'ENRICH_ONE': {
      const settings = await getSettings();
      const row = await enrichOne(msg.id, settings, { force: true });
      return { vocabulary: row };
    }

    case 'PROCESS_QUEUE':
      return processQueue({ max: msg.max || 25 });

    case 'TEST_GEMINI': {
      const settings = await getSettings();
      return testGemini({ apiKey: msg.apiKey ?? settings.geminiApiKey, model: msg.model || settings.geminiModel });
    }

    case 'STATS':
      return vocab.stats();

    case 'FREQUENT_LOOKUPS':
      return vocab.frequentLookups(msg.params || {});

    case 'EXPORT':
      return vocab.exportAll();

    case 'IMPORT':
      return vocab.importAll(msg.data);

    case 'FETCH_AUDIO':
      return { dataUrl: await fetchAudioDataUrl(String(msg.url || '')) };

    case 'DICT_INFO':
      return { en: await dictionaryInfo(), ja: await jaDictionaryInfo() };

    case 'CLEAR_CACHE':
      await clearCache();
      return { cleared: true };

    case 'CLEAR_ALL_DATA':
      await vocab.clearAllData();
      return { cleared: true };

    case 'FLUSH_OUTBOX':
      return vocab.flushOutbox();

    case 'SYNC_STATE':
      return vocab.syncState();

    case 'BACKEND_HEALTH':
      return vocab.backendHealth(msg.url || null);

    case 'BACKEND_LOGIN':
      return vocab.backendLogin(msg);

    case 'BACKEND_LOGOUT':
      return vocab.backendLogout();

    case 'BACKEND_ME':
      return vocab.backendMe();

    case 'BACKEND_SET_GEMINI':
      return vocab.backendSetGemini(msg);

    case 'BACKEND_IMPORT':
      return vocab.backendImport();

    case 'PULL_ENRICHED':
      return vocab.pullEnriched({ max: 50 });

    default:
      throw new Error(`Unknown message type: ${msg.type}`);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return false;
  if (msg.type === 'VOCABULARY_CHANGED') return false; // broadcast, not for us
  handleMessage(msg, sender)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
  return true;
});

setupAlarms();
