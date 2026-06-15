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
const OPENER_CONTEXT_COPY_WINDOW_MS = 5000;

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
  const title = String(metadata.titleMain || "");
  const hasPaperIdentity = Boolean(
    title ||
    authors.length ||
    metadata.journalName ||
    metadata.publisher ||
    metadata.pageFirst
  );
  if (!hasPaperIdentity) {
    return false;
  }
  if ((metadata.source || context.source) === constants.SOURCES.DCOLLECTION &&
      /(?:dCollection\s*디지털\s*학술정보\s*유통시스템|디지털\s*학술정보\s*유통시스템)/i.test(title)) {
    return false;
  }

  const totalAuthorLength = authors.reduce((sum, name) => sum + String(name || "").length, 0);
  if (totalAuthorLength > 40) {
    return false;
  }
  if (authors.some((name) => String(name || "").length > 20)) {
    return false;
  }

  const orgKeywords = /(?:관리소|박물관|연구소|대학교|대학원|유산원|연구원|기획단|문화재|유산청)/;
  const orgMatchCount = authors.filter(name => orgKeywords.test(String(name || ""))).length;
  if (orgMatchCount >= 2) {
    return false;
  }

  return Boolean(
    metadata.titleMain ||
    authors.length ||
    metadata.journalName ||
    metadata.publisher ||
    metadata.year ||
    metadata.pageFirst
  );
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

function hostnameOf(value) {
  try {
    return new URL(String(value || "")).hostname.toLowerCase();
  } catch (_error) {
    return "";
  }
}

function downloadValues(downloadItem) {
  return [
    downloadItem && downloadItem.url,
    downloadItem && downloadItem.finalUrl,
    downloadItem && downloadItem.referrer,
    downloadItem && downloadItem.tabUrl,
    downloadItem && downloadItem.filename
  ].filter(Boolean);
}

function isBlacklistedDownload(downloadItem) {
  if (!downloadItem || !constants || typeof constants.isBlacklistedSite !== "function") {
    return false;
  }
  if (downloadValues(downloadItem).some((value) => constants.isBlacklistedSite(value))) {
    return true;
  }
  const extensionName = String(downloadItem.byExtensionName || "");
  return /국가유산\s*보고서\s*파일명\s*정리|archreport/i.test(extensionName);
}

function isPotentialPaperDownload(downloadItem) {
  if (!downloadItem || isBlacklistedDownload(downloadItem)) {
    return false;
  }
  if (pendingContexts.length > 0) {
    return true;
  }
  return Boolean(constants && typeof constants.isAcademicSite === "function" &&
    downloadValues(downloadItem).some((value) => constants.isAcademicSite(value)));
}

function sameKnownPaperHost(left, right) {
  const leftHost = hostnameOf(left);
  const rightHost = hostnameOf(right);
  if (!leftHost || !rightHost) {
    return false;
  }
  const knownHosts = constants.KNOWN_HOST_PATTERNS || [];
  return knownHosts.some((pattern) => pattern.test(leftHost) && pattern.test(rightHost));
}

function isLikelyViewerDownload(downloadItem) {
  const text = normalizeUrl(downloadValues(downloadItem).join(" "));
  return /(?:viewer|view|download|down|file|pdf|riss|kci|원문|다운로드)/i.test(text);
}

function extractPaperId(urlText) {
  if (!urlText) {
    return "";
  }
  try {
    const sdMatch = urlText.match(/(?:streamdocsId|sItemId)[=;:'"]+([A-Za-z0-9_-]+)/i);
    if (sdMatch) {
      return `dcollection:${sdMatch[1]}`;
    }

    const parsed = new URL(urlText);
    const keys = ["cn", "artiId", "key", "nodeId", "p_mat_type", "artId", "articleId", "sItemId", "streamdocsId"];
    for (const key of keys) {
      const val = parsed.searchParams.get(key);
      if (val) {
        return `${key}:${val}`;
      }
    }
    const earticleMatch = parsed.pathname.match(/\/Article\/([A-Za-z0-9]+)/i);
    if (earticleMatch) {
      return `earticle:${earticleMatch[1]}`;
    }
    const scholarMatch = parsed.pathname.match(/\/article\/detail\/([A-Za-z0-9]+)/i);
    if (scholarMatch) {
      return `scholar:${scholarMatch[1]}`;
    }
  } catch (_error) {
    const match = urlText.match(/(?:cn|artiId|key|nodeId|p_mat_type|sItemId|streamdocsId)[=;:'"]+([A-Za-z0-9_-]+)/i);
    if (match) {
      return match[1];
    }
  }
  return "";
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
  const age = now - context.capturedAt;
  const sameTab = Number.isInteger(downloadItem.tabId) && downloadItem.tabId >= 0 && entry.tabId === downloadItem.tabId;
  const freshContext = age >= 0 && age <= OPENER_CONTEXT_COPY_WINDOW_MS;

  const itemId = extractPaperId(itemUrl) || extractPaperId(itemReferrer);
  const contextId = extractPaperId(pageUrl) || extractPaperId(contextUrl);
  if (itemId && contextId && itemId === contextId) {
    score += 12;
  }

  if (sameTab) {
    score += 8;
  }
  if (contextUrl && itemUrl && (itemUrl === contextUrl || itemUrl.includes(contextUrl) || contextUrl.includes(itemUrl))) {
    score += 8;
  }
  if (pageUrl && itemReferrer && (itemReferrer === pageUrl || itemReferrer.includes(pageUrl) || pageUrl.includes(itemReferrer))) {
    score += 6;
  }
  if ((sameTab || freshContext) && pageUrl && itemUrl && sameKnownPaperHost(pageUrl, itemUrl)) {
    score += 5;
  }
  if ((sameTab || freshContext) && contextUrl && itemUrl && sameKnownPaperHost(contextUrl, itemUrl)) {
    score += 5;
  }
  if (contextUrl && itemUrl && basename(contextUrl) && itemUrl.includes(basename(contextUrl))) {
    score += 4;
  }
  if (originalFilename && itemFilename && itemFilename.includes(originalFilename)) {
    score += 4;
  }

  if (freshContext) {
    score += 3;
  } else if (age >= 0 && age < constants.CONTEXT_TTL_MS) {
    score += 1;
  }
  return score;
}

function contextAge(entry, now) {
  return now - (entry && entry.context ? entry.context.capturedAt : 0);
}

function isFreshContextEntry(entry, now) {
  const age = contextAge(entry, now);
  return age >= 0 && age <= OPENER_CONTEXT_COPY_WINDOW_MS;
}

function selectContextEntry(downloadItem, nowValue) {
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
    if (isFreshContextEntry(only, now) && only.context.metadata && only.context.metadata.titleMain) {
      best = { entry: only, score: best ? best.score : 0 };
    }
  }
  if ((!best || best.score < 3) && isLikelyViewerDownload(downloadItem)) {
    const recent = pendingContexts
      .filter((entry) => {
        return isFreshContextEntry(entry, now) && entry.context.metadata && entry.context.metadata.titleMain;
      })
      .sort((left, right) => right.context.capturedAt - left.context.capturedAt)[0];
    if (recent) {
      best = { entry: recent, score: 3 };
    }
  }
  if (!best || best.score < 3) {
    return null;
  }
  return best.entry;
}

function chooseContextEntry(downloadItem, nowValue) {
  const bestEntry = selectContextEntry(downloadItem, nowValue);
  if (!bestEntry) {
    return null;
  }
  pendingContexts = pendingContexts.filter((entry) => entry !== bestEntry);
  persistContexts();
  return bestEntry;
}

function isRissSearchContext(entry) {
  const context = entry && entry.context;
  const source = context && (context.source || (context.metadata && context.metadata.source));
  const pageUrl = context && context.pageUrl;
  return source === constants.SOURCES.RISS && /\/search\/(?:Search|search|result|Result)/i.test(pageUrl || "");
}

function shouldWaitForRissEnrichment(entry, downloadItem, nowValue) {
  if (!entry || !isLikelyViewerDownload(downloadItem) || !isRissSearchContext(entry)) {
    return false;
  }
  const now = Number(nowValue) || Date.now();
  const age = contextAge(entry, now);
  return age >= 0 && age < 5000;
}

function chooseAfterRestore(downloadItem, callback) {
  const entry = chooseContextEntry(downloadItem);
  if (entry || !hasChromeApi(["storage", "local", "get"])) {
    callback(entry);
    return;
  }
  restoreContexts(() => {
    callback(chooseContextEntry(downloadItem));
  });
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
  if (isBlacklistedDownload(downloadItem)) {
    callback(null);
    return;
  }
  const now = Date.now();
  const first = selectContextEntry(downloadItem, now);
  if (shouldWaitForRissEnrichment(first, downloadItem, now)) {
    setTimeout(() => chooseAfterRestore(downloadItem, callback), constants.CONTEXT_SETTLE_DELAY_MS);
    return;
  }
  chooseAfterRestore(downloadItem, callback);
}

function handleTabRelation(tab) {
  if (!tab || !tab.id || !tab.url) {
    return;
  }
  const urlText = normalizeUrl(tab.url).toLowerCase();
  const isViewer = /(?:viewer|view|originalview|poporiginal|vieworiginal)/i.test(urlText) ||
                   /(?:viewer|view|originalview|poporiginal|vieworiginal)/i.test(filenameModule.filenameFromUrl(urlText));
  if (!isViewer) {
    return;
  }
  const openerId = tab.openerTabId;
  if (!Number.isInteger(openerId) || openerId < 0) {
    return;
  }
  const now = Date.now();
  const parentEntry = pendingContexts
    .filter((entry) => entry && entry.tabId === openerId && entry.context && entry.context.metadata)
    .sort((a, b) => b.context.capturedAt - a.context.capturedAt)[0];
  if (!parentEntry) {
    return;
  }
  const parentAge = now - parentEntry.context.capturedAt;
  if (parentAge < 0 || parentAge > OPENER_CONTEXT_COPY_WINDOW_MS) {
    return;
  }
  const exists = pendingContexts.some((entry) => entry && entry.tabId === tab.id && entry.context && entry.context.metadata);
  if (exists) {
    return;
  }
  const clonedContext = Object.assign({}, parentEntry.context, {
    capturedAt: now
  });
  pendingContexts.push({
    context: clonedContext,
    tabId: tab.id,
    frameId: 0
  });
  cleanupContexts(now);
  persistContexts();
}

function registerChromeListeners() {
  if (!hasChromeApi(["runtime"])) {
    return;
  }

  chrome.runtime.onInstalled.addListener(() => loadSettings());
  chrome.runtime.onStartup.addListener(() => loadSettings());
  loadSettings();
  restoreContexts();

  if (hasChromeApi(["tabs", "onCreated"])) {
    chrome.tabs.onCreated.addListener(handleTabRelation);
  }
  if (hasChromeApi(["tabs", "onUpdated"])) {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.url) {
        handleTabRelation(tab);
      }
    });
  }

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
      if (settingsCache.enabled === false || !isPotentialPaperDownload(downloadItem)) {
        return false;
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
      return true;
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
    handleTabRelation,
    hasContextMetadata,
    isBlacklistedDownload,
    isPotentialPaperDownload,
    loadSettings,
    rememberContext,
    restoreContexts,
    selectContextEntry,
    shouldWaitForRissEnrichment,
    updateActionState
  };
}
