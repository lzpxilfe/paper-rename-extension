if (typeof importScripts === "function") {
  importScripts("constants.js", "citation.js", "filename.js");
} else if (typeof require === "function") {
  globalThis.PaperRenameConstants = globalThis.PaperRenameConstants || require("./constants.js");
  globalThis.PaperRenameCitation = globalThis.PaperRenameCitation || require("./citation.js");
  globalThis.PaperRenameFilename = globalThis.PaperRenameFilename || require("./filename.js");
}

const constants = globalThis.PaperRenameConstants;
const filenameModule = globalThis.PaperRenameFilename;

let settingsCache = filenameModule.safeSettings();
let pendingContexts = [];
const RECENT_CONTEXTS_STORAGE_KEY = "paperRenameRecentContexts";

function hasChromeApi(path) {
  let current = typeof chrome !== "undefined" ? chrome : null;
  for (const key of path) {
    current = current && current[key];
  }
  return Boolean(current);
}

function consumeLastError() {
  return typeof chrome !== "undefined" && chrome.runtime ? chrome.runtime.lastError : null;
}

function updateActionState(settings) {
  if (!hasChromeApi(["action"])) {
    return;
  }
  const enabled = filenameModule.safeSettings(settings).enabled !== false;
  if (chrome.action.setBadgeText) {
    chrome.action.setBadgeText({ text: enabled ? "" : constants.ACTION.OFF_BADGE_TEXT });
  }
  if (chrome.action.setBadgeBackgroundColor) {
    chrome.action.setBadgeBackgroundColor({ color: constants.ACTION.OFF_BADGE_COLOR });
  }
  if (chrome.action.setTitle) {
    chrome.action.setTitle({
      title: enabled ? constants.ACTION.DEFAULT_TITLE : constants.ACTION.DISABLED_TITLE
    });
  }
}

function loadSettings(callback) {
  const done = typeof callback === "function" ? callback : () => {};
  if (!hasChromeApi(["storage", "sync", "get"])) {
    settingsCache = filenameModule.safeSettings(settingsCache);
    updateActionState(settingsCache);
    done(settingsCache);
    return;
  }
  chrome.storage.sync.get(constants.SETTINGS_STORAGE_KEY, (result) => {
    settingsCache = filenameModule.safeSettings(result && result[constants.SETTINGS_STORAGE_KEY]);
    updateActionState(settingsCache);
    done(settingsCache);
  });
}

function cleanupContexts(now) {
  const currentTime = Number(now) || Date.now();
  pendingContexts = pendingContexts
    .filter((entry) => entry && entry.context && currentTime - entry.context.capturedAt < constants.CONTEXT_TTL_MS)
    .slice(-constants.MAX_CONTEXTS);
}

function hasContextMetadata(context) {
  const metadata = context && context.metadata;
  if (!metadata) {
    return false;
  }
  const authors = Array.isArray(metadata.authors) ? metadata.authors : [];
  return Boolean(metadata.titleMain && (authors.length || metadata.journalName || metadata.publisher || metadata.year));
}

function persistContexts() {
  if (!hasChromeApi(["storage", "local", "set"])) {
    return;
  }
  chrome.storage.local.set({
    [RECENT_CONTEXTS_STORAGE_KEY]: pendingContexts
  }, () => {
    consumeLastError();
  });
}

function restoreContexts(callback) {
  const done = typeof callback === "function" ? callback : () => {};
  if (!hasChromeApi(["storage", "local", "get"])) {
    done();
    return;
  }
  chrome.storage.local.get(RECENT_CONTEXTS_STORAGE_KEY, (result) => {
    const stored = result && Array.isArray(result[RECENT_CONTEXTS_STORAGE_KEY])
      ? result[RECENT_CONTEXTS_STORAGE_KEY]
      : [];
    if (stored.length) {
      pendingContexts = stored.concat(pendingContexts).slice(-constants.MAX_CONTEXTS);
      cleanupContexts(Date.now());
    }
    done();
  });
}

function normalizeUrl(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch (_error) {
    return String(value || "");
  }
}

function basename(value) {
  return filenameModule.filenameFromUrl(value || "");
}

function contextScore(entry, downloadItem, now) {
  if (!entry || !entry.context || !downloadItem) {
    return 0;
  }
  const context = entry.context;
  const itemUrl = normalizeUrl(downloadItem.finalUrl || downloadItem.url || "");
  const itemReferrer = normalizeUrl(downloadItem.referrer || downloadItem.tabUrl || "");
  const contextUrl = normalizeUrl(context.downloadUrl || "");
  const pageUrl = normalizeUrl(context.pageUrl || "");
  const originalFilename = normalizeUrl(context.originalFilename || (context.metadata && context.metadata.originalFilename) || "");
  const itemFilename = normalizeUrl(downloadItem.filename || "");
  let score = 0;

  if (Number.isInteger(downloadItem.tabId) && downloadItem.tabId >= 0 && entry.tabId === downloadItem.tabId) {
    score += 8;
  }
  if (contextUrl && itemUrl && (itemUrl === contextUrl || itemUrl.includes(contextUrl) || contextUrl.includes(itemUrl))) {
    score += 8;
  }
  if (pageUrl && itemReferrer && (itemReferrer === pageUrl || itemReferrer.includes(pageUrl) || pageUrl.includes(itemReferrer))) {
    score += 6;
  }
  if (contextUrl && itemUrl && basename(contextUrl) && itemUrl.includes(basename(contextUrl))) {
    score += 4;
  }
  if (originalFilename && itemFilename && itemFilename.includes(originalFilename)) {
    score += 4;
  }

  const age = now - context.capturedAt;
  if (age >= 0 && age < 5000) {
    score += 3;
  } else if (age >= 0 && age < constants.CONTEXT_TTL_MS) {
    score += 1;
  }
  return score;
}

function chooseContextEntry(downloadItem, nowValue) {
  const now = Number(nowValue) || Date.now();
  cleanupContexts(now);
  let best = null;
  for (const entry of pendingContexts) {
    const score = contextScore(entry, downloadItem, now);
    if (!best || score > best.score || (score === best.score && entry.context.capturedAt > best.entry.context.capturedAt)) {
      best = { entry, score };
    }
  }
  if ((!best || best.score < 4) && pendingContexts.length === 1) {
    const only = pendingContexts[0];
    const age = now - only.context.capturedAt;
    if (age >= 0 && age < 2 * 60 * 1000 && only.context.metadata && only.context.metadata.titleMain) {
      best = { entry: only, score: best ? best.score : 0 };
    }
  }
  if (!best || best.score < 3) {
    return null;
  }
  pendingContexts = pendingContexts.filter((entry) => entry !== best.entry);
  persistContexts();
  return best.entry;
}

function rememberContext(context, sender) {
  if (!context || !hasContextMetadata(context)) {
    return;
  }
  const tabId = sender && sender.tab && Number.isInteger(sender.tab.id) ? sender.tab.id : -1;
  const frameId = sender && Number.isInteger(sender.frameId) ? sender.frameId : 0;
  const next = Object.assign({}, context, {
    capturedAt: Number(context.capturedAt) || Date.now()
  });
  pendingContexts.push({ context: next, tabId, frameId });
  cleanupContexts(Date.now());
  persistContexts();
}

function findContextEntry(downloadItem, callback) {
  const first = chooseContextEntry(downloadItem);
  if (first || !hasChromeApi(["storage", "local", "get"])) {
    callback(first);
    return;
  }
  restoreContexts(() => {
    callback(chooseContextEntry(downloadItem));
  });
}

function registerChromeListeners() {
  if (!hasChromeApi(["runtime"])) {
    return;
  }

  chrome.runtime.onInstalled.addListener(() => loadSettings());
  chrome.runtime.onStartup.addListener(() => loadSettings());
  loadSettings();
  restoreContexts();

  if (hasChromeApi(["storage", "onChanged"])) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "sync" || !changes[constants.SETTINGS_STORAGE_KEY]) {
        return;
      }
      settingsCache = filenameModule.safeSettings(changes[constants.SETTINGS_STORAGE_KEY].newValue);
      updateActionState(settingsCache);
    });
  }

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message && message.type === constants.MESSAGES.DOWNLOAD_CONTEXT) {
      rememberContext(message.context, sender);
    }
  });

  if (hasChromeApi(["downloads", "onDeterminingFilename"])) {
    chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
      if (settingsCache.enabled === false) {
        suggest();
        return;
      }
      findContextEntry(downloadItem, (entry) => {
        if (!entry || !entry.context || !entry.context.metadata) {
          suggest();
          return;
        }
        const metadata = Object.assign({}, entry.context.metadata, {
          originalFilename: entry.context.metadata.originalFilename || entry.context.originalFilename
        });
        const filename = filenameModule.renderFilename(metadata, settingsCache, downloadItem);
        suggest({
          filename,
          conflictAction: "uniquify"
        });
      });
    });
  }
}

registerChromeListeners();

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    _state: {
      get pendingContexts() {
        return pendingContexts;
      },
      reset() {
        pendingContexts = [];
        settingsCache = filenameModule.safeSettings();
      },
      setSettings(settings) {
        settingsCache = filenameModule.safeSettings(settings);
      }
    },
    chooseContextEntry,
    cleanupContexts,
    contextScore,
    findContextEntry,
    hasContextMetadata,
    loadSettings,
    rememberContext,
    restoreContexts,
    updateActionState
  };
}
