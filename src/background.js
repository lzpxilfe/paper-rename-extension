if (typeof importScripts === "function") {
  importScripts("constants.js", "citation.js", "filename.js", "metadata.js");
} else if (typeof require === "function") {
  globalThis.PaperRenameConstants = globalThis.PaperRenameConstants || require("./constants.js");
  globalThis.PaperRenameCitation = globalThis.PaperRenameCitation || require("./citation.js");
  globalThis.PaperRenameFilename = globalThis.PaperRenameFilename || require("./filename.js");
  globalThis.PaperRenameMetadata = globalThis.PaperRenameMetadata || require("./metadata.js");
}

const constants = globalThis.PaperRenameConstants;
const filenameModule = globalThis.PaperRenameFilename;
const metadataModule = globalThis.PaperRenameMetadata;

let settingsCache = filenameModule.safeSettings();
let pendingContexts = [];
let recentDiagnostics = [];
let diagnosticsEnabled = false;
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

function persistDiagnostics() {
  if (!hasChromeApi(["storage", "local", "set"])) {
    return;
  }
  chrome.storage.local.set({
    [constants.DOWNLOAD_DIAGNOSTICS_STORAGE_KEY]: recentDiagnostics
  }, () => {
    consumeLastError();
  });
}

function loadDiagnosticsEnabled(callback) {
  const done = typeof callback === "function" ? callback : () => {};
  if (!hasChromeApi(["storage", "local", "get"])) {
    done(diagnosticsEnabled);
    return;
  }
  chrome.storage.local.get(constants.DIAGNOSTICS_ENABLED_STORAGE_KEY, (result) => {
    diagnosticsEnabled = Boolean(result && result[constants.DIAGNOSTICS_ENABLED_STORAGE_KEY]);
    done(diagnosticsEnabled);
  });
}

function setDiagnosticsEnabled(enabled, callback) {
  diagnosticsEnabled = Boolean(enabled);
  if (!diagnosticsEnabled) {
    recentDiagnostics = [];
  }
  if (!hasChromeApi(["storage", "local", "set"])) {
    if (typeof callback === "function") callback(diagnosticsEnabled);
    return;
  }
  chrome.storage.local.set({
    [constants.DIAGNOSTICS_ENABLED_STORAGE_KEY]: diagnosticsEnabled,
    [constants.DOWNLOAD_DIAGNOSTICS_STORAGE_KEY]: recentDiagnostics
  }, () => {
    consumeLastError();
    if (typeof callback === "function") callback(diagnosticsEnabled);
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

function loadDiagnostics(callback) {
  const done = typeof callback === "function" ? callback : () => {};
  if (!diagnosticsEnabled) {
    done([]);
    return;
  }
  if (!hasChromeApi(["storage", "local", "get"])) {
    done(recentDiagnostics.slice());
    return;
  }
  chrome.storage.local.get(constants.DOWNLOAD_DIAGNOSTICS_STORAGE_KEY, (result) => {
    const stored = result && Array.isArray(result[constants.DOWNLOAD_DIAGNOSTICS_STORAGE_KEY])
      ? result[constants.DOWNLOAD_DIAGNOSTICS_STORAGE_KEY]
      : [];
    if (stored.length) {
      recentDiagnostics = stored.slice(0, constants.MAX_DOWNLOAD_DIAGNOSTICS || 20);
    }
    done(recentDiagnostics.slice());
  });
}

function clearDownloadDiagnostics(callback) {
  recentDiagnostics = [];
  if (!hasChromeApi(["storage", "local", "set"])) {
    if (typeof callback === "function") callback();
    return;
  }
  chrome.storage.local.set({
    [constants.DOWNLOAD_DIAGNOSTICS_STORAGE_KEY]: []
  }, () => {
    consumeLastError();
    if (typeof callback === "function") callback();
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

function truncateDiagnosticValue(value, maxLength) {
  const text = String(value || "");
  const max = maxLength || 240;
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function downloadItemSummary(downloadItem) {
  return {
    id: downloadItem && downloadItem.id,
    tabId: downloadItem && downloadItem.tabId,
    url: truncateDiagnosticValue(downloadItem && downloadItem.url),
    finalUrl: truncateDiagnosticValue(downloadItem && downloadItem.finalUrl),
    referrer: truncateDiagnosticValue(downloadItem && downloadItem.referrer),
    tabUrl: truncateDiagnosticValue(downloadItem && downloadItem.tabUrl),
    filename: truncateDiagnosticValue(downloadItem && downloadItem.filename, 180),
    byExtensionName: truncateDiagnosticValue(downloadItem && downloadItem.byExtensionName, 120)
  };
}

function metadataSummary(metadata) {
  return {
    source: truncateDiagnosticValue(metadata && metadata.source, 80),
    titleMain: truncateDiagnosticValue(metadata && metadata.titleMain, 180),
    authors: Array.isArray(metadata && metadata.authors)
      ? metadata.authors.slice(0, 4).map((name) => truncateDiagnosticValue(name, 60))
      : [],
    year: truncateDiagnosticValue(metadata && metadata.year, 20),
    journalName: truncateDiagnosticValue(metadata && metadata.journalName, 120),
    publisher: truncateDiagnosticValue(metadata && metadata.publisher, 120)
  };
}

function contextDiagnosticSummary(entry, score) {
  if (!entry || !entry.context) {
    return null;
  }
  return {
    tabId: entry.tabId,
    frameId: entry.frameId,
    score,
    pageUrl: truncateDiagnosticValue(entry.context.pageUrl),
    downloadUrl: truncateDiagnosticValue(entry.context.downloadUrl),
    contextId: extractPaperId(entry.context.pageUrl) || extractPaperId(entry.context.downloadUrl),
    metadata: metadataSummary(entry.context.metadata)
  };
}

function skipReason(downloadItem) {
  if (settingsCache.enabled === false) {
    return "disabled";
  }
  if (isBlacklistedDownload(downloadItem)) {
    return "blacklisted";
  }
  if (!downloadValues(downloadItem).some((value) => constants.isAcademicSite(value))) {
    return "not-academic";
  }
  return "not-candidate";
}

function recordDownloadDiagnostic(detail) {
  if (!diagnosticsEnabled) {
    return null;
  }
  const downloadItem = detail && detail.downloadItem;
  const entry = detail && detail.entry;
  const match = detail && detail.match || entry && entry.diagnosticMatch || null;
  const itemId = downloadItem
    ? extractPaperId(downloadItem.finalUrl || downloadItem.url || "") ||
      extractPaperId(downloadItem.referrer || downloadItem.tabUrl || "")
    : "";
  const diagnostic = {
    capturedAt: Date.now(),
    status: detail && detail.status || "unknown",
    reason: detail && detail.reason || "",
    download: downloadItemSummary(downloadItem),
    itemId,
    match,
    context: contextDiagnosticSummary(entry, match && match.score),
    suggestedFilename: truncateDiagnosticValue(detail && detail.suggestedFilename, 220),
    contextCount: pendingContexts.length
  };
  recentDiagnostics.unshift(diagnostic);
  recentDiagnostics = recentDiagnostics.slice(0, constants.MAX_DOWNLOAD_DIAGNOSTICS || 20);
  persistDiagnostics();
  return diagnostic;
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

function extractDcollectionId(urlText) {
  if (!urlText) {
    return "";
  }
  const raw = String(urlText);
  const inlineMatch = raw.match(/(?:streamdocsId|sItemId)[=;:'"]+([A-Za-z0-9_-]+)/i) ||
    raw.match(/orgView\(\s*['"]?([A-Za-z0-9_-]+)/i) ||
    raw.match(/\/public_resource\/pdf\/([A-Za-z0-9_-]+?)(?:[_\.]|$)/i) ||
    raw.match(/\/(?:srch\/srchDetail|common\/orgView|search\/detail|public_resource\/detail)\/([A-Za-z0-9_-]+)/i) ||
    raw.match(/\/handler\/[^/]+\/([A-Za-z0-9_-]+)/i);
  if (inlineMatch) {
    return inlineMatch[1];
  }
  return "";
}

function extractPaperId(urlText) {
  if (!urlText) {
    return "";
  }
  const dcollectionId = extractDcollectionId(urlText);
  if (dcollectionId) {
    return `dcollection:${dcollectionId}`;
  }
  try {
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

function dcollectionDetailInfo(downloadItem) {
  for (const value of downloadValues(downloadItem)) {
    const itemId = extractDcollectionId(value);
    if (!itemId) {
      continue;
    }
    try {
      const parsed = new URL(String(value));
      if (/dcollection/i.test(parsed.hostname) && !/^viewer\.dcollection\.net$/i.test(parsed.hostname)) {
        return {
          itemId,
          url: `${parsed.origin}/srch/srchDetail/${itemId}`
        };
      }
    } catch (_error) {}
  }
  return null;
}

function fetchDcollectionContext(downloadItem, callback) {
  const detail = dcollectionDetailInfo(downloadItem);
  if (!detail || !metadataModule || typeof metadataModule.parseFixtureHtml !== "function" || typeof fetch !== "function") {
    callback(null);
    return;
  }
  fetch(detail.url, { credentials: "include" })
    .then((response) => response && response.ok ? response.text() : "")
    .then((html) => {
      if (!html) {
        callback(null);
        return;
      }
      const metadata = metadataModule.parseFixtureHtml(html, detail.url);
      const context = {
        metadata: Object.assign({}, metadata, {
          originalFilename: metadata.originalFilename || filenameModule.filenameFromUrl(downloadItem && downloadItem.filename)
        }),
        pageUrl: detail.url,
        downloadUrl: downloadItem && (downloadItem.finalUrl || downloadItem.url) || "",
        originalFilename: filenameModule.filenameFromUrl(downloadItem && downloadItem.filename),
        source: constants.SOURCES.DCOLLECTION,
        capturedAt: Date.now()
      };
      callback(hasContextMetadata(context) ? {
        context,
        tabId: downloadItem && downloadItem.tabId,
        frameId: 0,
        diagnosticMatch: {
          score: 12,
          reason: "dcollection-detail-fetch",
          itemId: `dcollection:${detail.itemId}`,
          contextId: `dcollection:${detail.itemId}`
        }
      } : null);
    })
    .catch(() => callback(null));
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

function contextIdForEntry(entry) {
  if (!entry || !entry.context) {
    return "";
  }
  return extractPaperId(entry.context.pageUrl) || extractPaperId(entry.context.downloadUrl);
}

function itemIdForDownload(downloadItem) {
  return extractPaperId(downloadItem && (downloadItem.finalUrl || downloadItem.url) || "") ||
    extractPaperId(downloadItem && (downloadItem.referrer || downloadItem.tabUrl) || "");
}

function selectContextMatch(downloadItem, nowValue) {
  const now = Number(nowValue) || Date.now();
  cleanupContexts(now);
  let best = null;
  for (const entry of pendingContexts) {
    const score = contextScore(entry, downloadItem, now);
    if (!best || score > best.score || (score === best.score && entry.context.capturedAt > best.entry.context.capturedAt)) {
      best = { entry, score, reason: "best-score" };
    }
  }
  if ((!best || best.score < 4) && pendingContexts.length === 1) {
    const only = pendingContexts[0];
    if (isFreshContextEntry(only, now) && only.context.metadata && only.context.metadata.titleMain) {
      best = { entry: only, score: best ? best.score : 0, reason: "single-fresh-context" };
    }
  }
  if ((!best || best.score < 3) && isLikelyViewerDownload(downloadItem)) {
    const recent = pendingContexts
      .filter((entry) => {
        return isFreshContextEntry(entry, now) && entry.context.metadata && entry.context.metadata.titleMain;
      })
      .sort((left, right) => right.context.capturedAt - left.context.capturedAt)[0];
    if (recent) {
      best = { entry: recent, score: 3, reason: "recent-viewer-context" };
    }
  }
  if (!best || best.score < 3) {
    return null;
  }
  return Object.assign(best, {
    itemId: itemIdForDownload(downloadItem),
    contextId: contextIdForEntry(best.entry)
  });
}

function selectContextEntry(downloadItem, nowValue) {
  const match = selectContextMatch(downloadItem, nowValue);
  return match ? match.entry : null;
}

function chooseContextEntry(downloadItem, nowValue) {
  const match = selectContextMatch(downloadItem, nowValue);
  if (!match || !match.entry) {
    return null;
  }
  const bestEntry = match.entry;
  bestEntry.diagnosticMatch = {
    score: match.score,
    reason: match.reason,
    itemId: match.itemId,
    contextId: match.contextId
  };
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
  const finish = (entry) => {
    if (entry) {
      callback(entry);
      return;
    }
    fetchDcollectionContext(downloadItem, callback);
  };
  const now = Date.now();
  const first = selectContextEntry(downloadItem, now);
  if (shouldWaitForRissEnrichment(first, downloadItem, now)) {
    setTimeout(() => chooseAfterRestore(downloadItem, finish), constants.CONTEXT_SETTLE_DELAY_MS);
    return;
  }
  chooseAfterRestore(downloadItem, finish);
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
  loadDiagnosticsEnabled();
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
      if (areaName === "local" && changes[constants.DIAGNOSTICS_ENABLED_STORAGE_KEY]) {
        diagnosticsEnabled = Boolean(changes[constants.DIAGNOSTICS_ENABLED_STORAGE_KEY].newValue);
        if (!diagnosticsEnabled) {
          recentDiagnostics = [];
        }
        return;
      }
      if (areaName !== "sync" || !changes[constants.SETTINGS_STORAGE_KEY]) {
        return;
      }
      settingsCache = filenameModule.safeSettings(changes[constants.SETTINGS_STORAGE_KEY].newValue);
      updateActionState(settingsCache);
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === constants.MESSAGES.DOWNLOAD_CONTEXT) {
      rememberContext(message.context, sender);
      return false;
    }
    if (message && message.type === constants.MESSAGES.GET_DOWNLOAD_DIAGNOSTICS) {
      loadDiagnostics((diagnostics) => {
        sendResponse({ success: true, enabled: diagnosticsEnabled, diagnostics });
      });
      return true;
    }
    if (message && message.type === constants.MESSAGES.CLEAR_DOWNLOAD_DIAGNOSTICS) {
      clearDownloadDiagnostics(() => {
        sendResponse({ success: true, enabled: diagnosticsEnabled });
      });
      return true;
    }
    if (message && message.type === constants.MESSAGES.SET_DOWNLOAD_DIAGNOSTICS_ENABLED) {
      setDiagnosticsEnabled(message.enabled, (enabled) => {
        sendResponse({ success: true, enabled });
      });
      return true;
    }
    return false;
  });

  if (hasChromeApi(["downloads", "onDeterminingFilename"])) {
    chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
      if (settingsCache.enabled === false || !isPotentialPaperDownload(downloadItem)) {
        recordDownloadDiagnostic({
          status: "skipped",
          reason: skipReason(downloadItem),
          downloadItem
        });
        return false;
      }
      findContextEntry(downloadItem, (entry) => {
        if (!entry || !entry.context || !entry.context.metadata) {
          recordDownloadDiagnostic({
            status: "no-context",
            reason: "no-matching-metadata",
            downloadItem
          });
          suggest();
          return;
        }
        const metadata = Object.assign({}, entry.context.metadata, {
          originalFilename: entry.context.metadata.originalFilename || entry.context.originalFilename
        });
        const filename = filenameModule.renderFilename(metadata, settingsCache, downloadItem);
        recordDownloadDiagnostic({
          status: "renamed",
          reason: entry.diagnosticMatch && entry.diagnosticMatch.reason || "matched-context",
          downloadItem,
          entry,
          suggestedFilename: filename
        });
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
      get recentDiagnostics() {
        return recentDiagnostics;
      },
      reset() {
        pendingContexts = [];
        recentDiagnostics = [];
        diagnosticsEnabled = false;
        settingsCache = filenameModule.safeSettings();
      },
      setDiagnosticsEnabled(enabled) {
        diagnosticsEnabled = Boolean(enabled);
      },
      setSettings(settings) {
        settingsCache = filenameModule.safeSettings(settings);
      }
    },
    chooseContextEntry,
    clearDownloadDiagnostics,
    cleanupContexts,
    contextScore,
    dcollectionDetailInfo,
    extractDcollectionId,
    extractPaperId,
    fetchDcollectionContext,
    findContextEntry,
    handleTabRelation,
    hasContextMetadata,
    isBlacklistedDownload,
    isPotentialPaperDownload,
    loadDiagnostics,
    loadSettings,
    rememberContext,
    recordDownloadDiagnostic,
    restoreContexts,
    selectContextEntry,
    selectContextMatch,
    shouldWaitForRissEnrichment,
    updateActionState
  };
}
