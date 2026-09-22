// Settings live in chrome.storage.local under the key "settings".
// Content scripts and extension pages read the same key directly and listen to storage changes.

// Fill this in after deploying the Worker so users only have to log in.
export const DEFAULT_BACKEND_URL = '';

export const DEFAULT_SETTINGS = {
  enabled: true,
  hoverMode: 'hover',        // hover | alt | ctrl | off
  hoverTarget: 'sentence',   // sentence | word | both  (what the hover popup translates)
  hoverDelay: 300,           // ms before the hover popup appears (lookup starts earlier)
  selectionMode: 'auto',     // auto | button | off
  skipCommonWords: true,     // do not pop up for "the", "and", ...
  showIpa: true,
  showDefinition: true,      // English definition line (Free Dictionary API)
  targetLang: 'vi',
  popupTheme: 'auto',        // auto | light | dark
  geminiApiKey: '',
  geminiModel: 'gemini-2.5-flash',
  autoEnrich: true,
  disabledSites: [],
  lastHoverMode: 'hover',
  backendUrl: DEFAULT_BACKEND_URL,
  backendToken: '',          // session token from login (never typed by hand)
  backendEmail: '',
  serverEnrich: true,        // when a backend is configured, let the server call Gemini
};

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

export async function setSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}
