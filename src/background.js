if (typeof importScripts === "function") {
  importScripts("site-policy.js", "coop.js", "constants.js", "citation.js", "filename.js", "metadata.js");
} else if (typeof require === "function") {
  globalThis.DownloadFilenameCoop = globalThis.DownloadFilenameCoop || require("./coop.js");
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
let pageContexts = [];
// 탭 계보: 원문보기/뷰어가 새 탭·팝업으로 열려도 "어느 논문 페이지에서 열었는지"를 추적한다.
// { [childTabId]: { parent: tabId, at: ms } }
let tabParents = {};
// 탭의 최상위 문서 URL이 마지막으로 바뀐 시각. 같은 탭에서 다른 페이지로 옮긴 뒤 받은
// 파일에 이전 논문 이름이 붙는 것을 막는 데 쓴다. { [tabId]: { url, at } }
let tabTops = {};
// 최근 탭 이동 기록. 크롬의 DownloadItem에는 탭 ID가 없으므로, "어느 탭에서 이 주소로 이동했는가"로
// 다운로드가 시작된 탭을 알아낸다(주소 직접 입력, JS 이동, 숨은 iframe 등). [{ tabId, url, at }]
let recentNavigations = [];
const NAVIGATION_TTL_MS = 2 * 60 * 1000;
const MAX_NAVIGATIONS = 60;
let recentDiagnostics = [];
let diagnosticsEnabled = false;
const RECENT_CONTEXTS_STORAGE_KEY = "paperRenameRecentContexts";
const PAGE_CONTEXTS_STORAGE_KEY = "paperRenamePageContexts";
const TAB_GRAPH_STORAGE_KEY = "paperRenameTabGraph";
const TAB_GRAPH_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_TAB_GRAPH_ENTRIES = 200;
const MAX_LINEAGE_DEPTH = 4;
const OPENER_CONTEXT_COPY_WINDOW_MS = 5000;
// onDeterminingFilename 안에서 fetch가 다운로드를 붙잡고 있지 않도록 상한을 둔다.
const DCOLLECTION_FETCH_TIMEOUT_MS = 1800;
// 포커스/활성 탭 조회가 응답하지 않아도 다운로드가 멈추지 않도록 하는 상한.
const FOCUS_INFO_TIMEOUT_MS = 700;
// 파일명 한 조각의 UTF-8 바이트 상한을 OS에 맞춰 정한다.
// Windows(NTFS)는 255 UTF-16 단위라 사용자의 문자 수 설정이 먼저 걸리므로 상한이 필요 없고,
// macOS(APFS)/리눅스(ext4 등)는 255바이트라 한글 제목이 쉽게 넘쳐 별도 상한이 필요하다.
// navigator는 서비스 워커에서 동기로 읽히므로 getPlatformInfo의 비동기 경합이 없다.
function detectFilenameByteLimit() {
  const cap = Number(constants.MAX_FILENAME_BYTES) || 235;
  try {
    if (typeof navigator === "undefined") {
      return cap;
    }
    const platform = String(
      (navigator.userAgentData && navigator.userAgentData.platform) ||
      navigator.platform ||
      navigator.userAgent ||
      ""
    );
    return /^win|windows/i.test(platform) ? 0 : cap;
  } catch (_error) {
    return cap;
  }
}

const filenameByteLimit = detectFilenameByteLimit();

function renderDownloadFilename(entry, downloadItem) {
  const metadata = Object.assign({}, entry.context.metadata, {
    originalFilename: entry.context.metadata.originalFilename || entry.context.originalFilename
  });
  return filenameModule.renderFilename(metadata, settingsCache, downloadItem, {
    maxBytes: filenameByteLimit
  });
}

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

// 서비스 워커는 30초만 쉬어도 내려가며 메모리를 잃는다. 수집한 논문 정보는
// storage.session(브라우저를 닫으면 사라짐, 디스크에 남지 않음)에 두고, 없으면 local을 쓴다.
function contextArea() {
  if (hasChromeApi(["storage", "session", "set"])) return chrome.storage.session;
  if (hasChromeApi(["storage", "local", "set"])) return chrome.storage.local;
  return null;
}

function pruneTabGraph(now) {
  const currentTime = Number(now) || Date.now();
  const keep = (map) => Object.fromEntries(Object.entries(map)
    .filter(([, value]) => value && currentTime - value.at < TAB_GRAPH_TTL_MS)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, MAX_TAB_GRAPH_ENTRIES));
  tabParents = keep(tabParents);
  tabTops = keep(tabTops);
}

function persistContexts() {
  const area = contextArea();
  if (!area) {
    return;
  }
  area.set({
    [RECENT_CONTEXTS_STORAGE_KEY]: pendingContexts,
    [PAGE_CONTEXTS_STORAGE_KEY]: pageContexts,
    [TAB_GRAPH_STORAGE_KEY]: { parents: tabParents, tops: tabTops, navigations: recentNavigations }
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
  const area = contextArea();
  if (!area || typeof area.get !== "function") {
    done();
    return;
  }
  area.get([RECENT_CONTEXTS_STORAGE_KEY, PAGE_CONTEXTS_STORAGE_KEY, TAB_GRAPH_STORAGE_KEY], (result) => {
    consumeLastError();
    const graph = result && result[TAB_GRAPH_STORAGE_KEY];
    if (graph && typeof graph === "object") {
      // 메모리에 있는 최신 관계가 저장본보다 우선한다.
      tabParents = Object.assign({}, graph.parents || {}, tabParents);
      tabTops = Object.assign({}, graph.tops || {}, tabTops);
      if (Array.isArray(graph.navigations)) {
        const now = Date.now();
        const known = new Set(recentNavigations.map(nav => `${nav.tabId} ${nav.url} ${nav.at}`));
        recentNavigations = graph.navigations.filter(nav => nav && !known.has(`${nav.tabId} ${nav.url} ${nav.at}`))
          .concat(recentNavigations).filter(nav => now - nav.at < NAVIGATION_TTL_MS).slice(-MAX_NAVIGATIONS);
      }
      pruneTabGraph(Date.now());
    }
    const stored = result && Array.isArray(result[RECENT_CONTEXTS_STORAGE_KEY])
      ? result[RECENT_CONTEXTS_STORAGE_KEY]
      : [];
    if (stored.length) {
      const key = entry => JSON.stringify([entry.tabId, entry.frameId, entry.context && entry.context.pageUrl,
        entry.context && entry.context.downloadUrl, entry.context && entry.context.capturedAt]);
      pendingContexts = Array.from(new Map(stored.concat(pendingContexts).map(entry => [key(entry), entry])).values())
        .slice(-constants.MAX_CONTEXTS);
    }
    const storedPages = result && Array.isArray(result[PAGE_CONTEXTS_STORAGE_KEY]) ? result[PAGE_CONTEXTS_STORAGE_KEY] : [];
    pageContexts = Array.from(new Map(storedPages.concat(pageContexts).map(entry =>
      [`${entry.tabId}:${entry.frameId}`, entry])).values()).slice(-constants.MAX_CONTEXTS);
    cleanupContexts(Date.now());
    pageContexts = pageContexts.filter(entry => entry.context && Date.now() - entry.context.capturedAt < constants.CONTEXT_TTL_MS);
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

function hasExplicitContextMatch(context, item) {
  if (!context || !item) return false;
  const same = constants.sitePolicy.sameUrl;
  return [item.url, item.finalUrl].some(url => same(context.downloadUrl, url)) ||
    [item.referrer, item.tabUrl].some(url => same(context.pageUrl, url));
}

function isTrustedPaperContext(context) {
  return context && !constants.isBlacklistedSite(context.pageUrl) &&
    (constants.isAcademicSite(context.pageUrl) || context.scholarly === true) &&
    hasContextMetadata(context) && Boolean(context.metadata.titleMain);
}

function isPotentialPaperDownload(downloadItem) {
  if (!downloadItem || isBlacklistedDownload(downloadItem)) {
    return false;
  }
  // 팝업의 .bib/.ris 내보내기처럼 우리가 직접 시작한 다운로드에는 개입하지 않는다.
  // 이름은 이미 그쪽에서 정했고, 여기서 다시 논문 파일명을 씌우면 확장자가 어긋난다.
  const ownId = typeof chrome !== "undefined" && chrome.runtime ? chrome.runtime.id : "";
  if (ownId && downloadItem.byExtensionId === ownId) {
    return false;
  }
  return Boolean(constants && typeof constants.isAcademicSite === "function" &&
    downloadValues(downloadItem).some((value) => constants.isAcademicSite(value))) ||
    pendingContexts.some(entry => isTrustedPaperContext(entry.context) && hasExplicitContextMatch(entry.context, downloadItem)) ||
    // 학교 프록시나 출판사 서버처럼 처음 보는 호스트라도, 논문 페이지(또는 그 페이지가 연
    // 뷰어 탭)에서 받은 문서 파일이면 논문으로 본다.
    (isDocumentDownload(downloadItem) && hasRelatedTrustedContext(downloadItem));
}

function sameKnownPaperHost(left, right) {
  const leftHost = hostnameOf(constants.sitePolicy.academicSourceUrl(left));
  const rightHost = hostnameOf(constants.sitePolicy.academicSourceUrl(right));
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
  // 경로 패턴은 dCollection 주소에서만 본다. RISS 상세(/search/detail/DetailView.do)까지
  // "DetailView"라는 같은 ID로 묶여 서로 다른 논문이 섞이던 문제가 있었다.
  let host = "";
  try { host = new URL(raw).hostname; } catch (_error) {}
  const dcollectionHost = !host || /dcollection|dcoll/i.test(host);
  const inlineMatch = raw.match(/(?:streamdocsId|sItemId)[=;:'"]+([A-Za-z0-9_-]+)/i) ||
    raw.match(/orgView\(\s*['"]?([A-Za-z0-9_-]+)/i) ||
    raw.match(/\/public_resource\/pdf\/([A-Za-z0-9_-]+?)(?:[_\.]|$)/i) ||
    (dcollectionHost && raw.match(/\/(?:srch\/srchDetail|common\/orgView|search\/detail|public_resource\/detail)\/([A-Za-z0-9_-]+)/i)) ||
    (dcollectionHost && raw.match(/\/handler\/[^/]+\/([A-Za-z0-9_-]+)/i));
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
    // RISS의 p_mat_type은 자료 유형 코드(학술지논문·학위논문 등)라 논문을 구분하지 못한다.
    // control_no가 RISS의 실제 논문 번호다.
    const keys = ["control_no", "controlNo", "cn", "artiId", "key", "nodeId", "artId", "articleId", "sItemId",
      "streamdocsId", "docId", "thesisId", "articleSeq"];
    // KCI처럼 "sereArticleSearchBean.artiId" 형태로 감싼 이름도 같은 ID로 본다.
    const params = new Map();
    for (const [name, value] of parsed.searchParams.entries()) {
      const shortName = String(name).split(".").pop().toLowerCase();
      if (value && !params.has(shortName)) params.set(shortName, value);
    }
    for (const key of keys) {
      const val = params.get(key.toLowerCase());
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
    const match = urlText.match(/(?:control_no|cn|artiId|key|nodeId|sItemId|streamdocsId)[=;:'"]+([A-Za-z0-9_-]+)/i);
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
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), DCOLLECTION_FETCH_TIMEOUT_MS)
    : null;
  const clearFetchTimeout = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  };
  fetch(detail.url, { credentials: "include", signal: controller ? controller.signal : undefined })
    .then((response) => response && response.ok ? response.text() : "")
    .then((html) => {
      clearFetchTimeout();
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
    .catch(() => {
      clearFetchTimeout();
      callback(null);
    });
}

// 다운로드 시점에 "지금 사용자가 보고 있는 창/탭"을 확인한다.
// tabId가 -1인 다운로드(팝업 창, window.open으로 연 원문 뷰어)에서는 sameTab 가산점이
// 통째로 빠지기 때문에, 이 정보가 없으면 다른 창에 열어둔 논문 이름이 넘어올 수 있다.
function collectFocusInfo(callback) {
  // onDeterminingFilename은 suggest()를 부를 때까지 다운로드를 붙잡는다.
  // 콜백이 오지 않는 상황에서 다운로드가 멈추지 않도록, 한 번만 진행하고
  // 짧은 상한을 둔 뒤에는 포커스 정보 없이(기존 동작으로) 이어간다.
  let settled = false;
  const done = (info) => {
    if (settled) {
      return;
    }
    settled = true;
    callback(info || null);
  };
  if (!hasChromeApi(["tabs", "query"])) {
    done(null);
    return;
  }
  setTimeout(() => done(null), FOCUS_INFO_TIMEOUT_MS);
  try {
    chrome.tabs.query({ active: true }, (tabs) => {
      consumeLastError();
      const activeTabs = Array.isArray(tabs) ? tabs : [];
      const activeTabIds = activeTabs
        .map((tab) => tab && tab.id)
        .filter((id) => Number.isInteger(id) && id >= 0);
      if (!hasChromeApi(["windows", "getLastFocused"])) {
        done({ activeTabIds, focusedTabId: -1 });
        return;
      }
      chrome.windows.getLastFocused({}, (focusedWindow) => {
        consumeLastError();
        const focusedWindowId = focusedWindow && Number.isInteger(focusedWindow.id)
          ? focusedWindow.id
          : -1;
        const focusedTab = activeTabs.find((tab) => tab && tab.windowId === focusedWindowId);
        done({
          activeTabIds,
          focusedTabId: focusedTab && Number.isInteger(focusedTab.id) ? focusedTab.id : -1
        });
      });
    });
  } catch (_error) {
    done(null);
  }
}

// 저신뢰 폴백은 지금 보고 있는 창의 활성 탭에서 온 컨텍스트만 쓴다.
// 탭 정보를 못 얻었거나(포커스 정보 없음) 탭에 매이지 않은 컨텍스트는 기존대로 허용해
// 예기치 못한 회귀를 만들지 않는다.
function isActiveTabEntry(entry, focusInfo) {
  if (!focusInfo || !Array.isArray(focusInfo.activeTabIds)) {
    return true;
  }
  const tabId = entry && entry.tabId;
  if (!Number.isInteger(tabId) || tabId < 0) {
    return true;
  }
  return focusInfo.activeTabIds.includes(tabId);
}

function validTabId(value) {
  return Number.isInteger(value) && value >= 0;
}

function recordTabParent(childTabId, parentTabId, at) {
  if (!validTabId(childTabId) || !validTabId(parentTabId) || childTabId === parentTabId) {
    return;
  }
  // 순환을 만들지 않는다.
  if (lineageLink(parentTabId, childTabId)) {
    return;
  }
  // 같은 관계를 다시 알려 와도(탭 정보에 openerTabId가 계속 남아 있다) 처음 열린 시각을 지킨다.
  const existing = tabParents[String(childTabId)];
  if (existing && existing.parent === parentTabId) {
    return;
  }
  tabParents[String(childTabId)] = { parent: parentTabId, at: Number(at) || Date.now() };
  pruneTabGraph(Date.now());
  persistContexts();
}

function recordTabTop(tabId, url, at) {
  if (!validTabId(tabId) || !/^https?:/i.test(String(url || ""))) {
    return;
  }
  const previous = tabTops[String(tabId)];
  if (previous && constants.sitePolicy.sameUrl(previous.url, url)) {
    return;
  }
  // 탭이 처음 도착한 사이트를 기억해 둔다. 뷰어가 쪽을 넘기며 주소를 바꾸는 것(같은 사이트)과
  // 사용자가 다른 사이트로 옮겨 간 것(방황)을 구분하는 데 쓴다.
  const firstSite = previous && previous.firstSite ? previous.firstSite : siteKey(url);
  const firstUrl = previous && previous.firstUrl ? previous.firstUrl : String(url);
  tabTops[String(tabId)] = { url: String(url), at: Number(at) || Date.now(), firstSite, firstUrl };
  persistContexts();
}

// childTabId에서 부모 쪽으로 올라가며 ancestorTabId를 찾는다.
// 찾으면 { depth, at }을 돌려준다. at은 ancestor 바로 아래 탭이 열린 시각이다.
function lineageLink(childTabId, ancestorTabId) {
  if (!validTabId(childTabId) || !validTabId(ancestorTabId) || childTabId === ancestorTabId) {
    return null;
  }
  let current = childTabId;
  for (let depth = 1; depth <= MAX_LINEAGE_DEPTH; depth++) {
    const link = tabParents[String(current)];
    if (!link || !validTabId(link.parent)) {
      return null;
    }
    if (link.parent === ancestorTabId) {
      return { depth, at: link.at };
    }
    current = link.parent;
  }
  return null;
}

function keyedPaperIdParts(value) {
  const id = String(value || "");
  const index = id.indexOf(":");
  return index > 0 ? { key: id.slice(0, index).toLowerCase(), value: id.slice(index + 1) } : null;
}

// 같은 종류의 논문 ID가 서로 다르면 확실히 다른 논문이다.
// (dCollection의 sItemId/streamdocsId처럼 서로 다른 ID 체계는 비교하지 않는다.)
function conflictingPaperIds(itemId, contextId) {
  const left = keyedPaperIdParts(itemId);
  const right = keyedPaperIdParts(contextId);
  return Boolean(left && right && left.key === right.key && left.key !== "dcollection" && left.value !== right.value);
}

// 같은 탭이 그 컨텍스트를 담은 뒤 다른 페이지로 옮겨 갔고, 다운로드가 그 새 페이지에서
// 시작됐다면(referrer가 탭의 현재 주소) 예전 논문 정보는 이 다운로드와 무관하다.
function navigatedAwayFrom(entry, downloadItem) {
  if (!entry || !entry.context || !downloadItem || !validTabId(downloadItem.tabId)) {
    return false;
  }
  const top = tabTops[String(downloadItem.tabId)];
  const referrer = downloadItem.referrer || "";
  const same = constants.sitePolicy.sameUrl;
  if (!top || entry.context.capturedAt >= top.at || same(top.url, entry.context.pageUrl)) {
    return false;
  }
  // 탭이 그 PDF 자체를 띄우고 있다(상세페이지 → PDF로 이동 → 저장). 이건 같은 논문이다.
  if (same(top.url, downloadItem.url) || same(top.url, downloadItem.finalUrl)) {
    return false;
  }
  if (referrer) {
    return same(referrer, top.url);
  }
  // 출처가 비어 있으면, 탭이 다른 사이트로 옮겨 갔는지로 판단한다.
  return siteKey(top.url) !== siteKey(entry.context.pageUrl) && !constants.isAcademicSite(top.url);
}

function recordNavigation(tabId, url, at) {
  if (!validTabId(tabId) || !/^https?:/i.test(String(url || ""))) return;
  const now = Number(at) || Date.now();
  recentNavigations = recentNavigations.filter(nav => now - nav.at < NAVIGATION_TTL_MS);
  recentNavigations.push({ tabId, url: String(url), at: now });
  recentNavigations = recentNavigations.slice(-MAX_NAVIGATIONS);
}

// 크롬의 DownloadItem에는 탭 ID가 없다. 다운로드가 어느 탭에서 시작됐는지 알아낸다.
//   1) referrer(다운로드를 시작한 페이지)가 지금 어느 탭의 주소이거나, 어느 탭에서 담은 페이지인가
//   2) 다운로드 주소로 막 이동한 탭이 있는가(링크·JS 이동·주소 입력이 다운로드로 바뀐 경우)
//   3) 그 PDF를 띄워 둔 탭이 있는가(PDF 뷰어에서 저장)
function resolveDownloadTabId(downloadItem) {
  if (!downloadItem) return -1;
  if (validTabId(downloadItem.tabId)) return downloadItem.tabId;
  const same = constants.sitePolicy.sameUrl;
  const newest = (list) => list.sort((a, b) => b.at - a.at)[0];
  const referrer = downloadItem.referrer || "";
  if (referrer) {
    const byTop = newest(Object.entries(tabTops)
      .filter(([, top]) => top && same(top.url, referrer))
      .map(([tabId, top]) => ({ tabId: Number(tabId), at: top.at })));
    if (byTop) return byTop.tabId;
    const byContext = newest(pendingContexts.concat(pageContexts)
      .filter(entry => entry && entry.context && validTabId(entry.tabId) && same(entry.context.pageUrl, referrer))
      .map(entry => ({ tabId: entry.tabId, at: entry.context.capturedAt })));
    if (byContext) return byContext.tabId;
    const byNav = newest(recentNavigations.filter(nav => same(nav.url, referrer)).map(nav => Object.assign({}, nav)));
    if (byNav) return byNav.tabId;
  }
  const urls = [downloadItem.url, downloadItem.finalUrl].filter(Boolean);
  const now = Date.now();
  const byDownloadNav = newest(recentNavigations
    .filter(nav => now - nav.at < 60000 && urls.some(url => same(nav.url, url)))
    .map(nav => Object.assign({}, nav)));
  if (byDownloadNav) return byDownloadNav.tabId;
  const byViewer = newest(Object.entries(tabTops)
    .filter(([, top]) => top && urls.some(url => same(top.url, url)))
    .map(([tabId, top]) => ({ tabId: Number(tabId), at: top.at })));
  return byViewer ? byViewer.tabId : -1;
}

function withResolvedTab(downloadItem) {
  if (!downloadItem || validTabId(downloadItem.tabId)) return downloadItem;
  const tabId = resolveDownloadTabId(downloadItem);
  return validTabId(tabId) ? Object.assign({}, downloadItem, { tabId, tabIdResolved: true }) : downloadItem;
}

const DOCUMENT_DOWNLOAD_PATTERN = /\.(?:pdf|hwp|hwpx|doc|docx|epub|djvu|zip)(?:$|[?#])/i;

function isDocumentDownload(downloadItem) {
  if (!downloadItem) return false;
  if (/^application\/(?:x-)?pdf\b|hwp|msword|wordprocessingml|epub/i.test(String(downloadItem.mime || ""))) return true;
  return DOCUMENT_DOWNLOAD_PATTERN.test(String(downloadItem.filename || "")) ||
    DOCUMENT_DOWNLOAD_PATTERN.test(String(downloadItem.finalUrl || downloadItem.url || ""));
}

function siteKey(value) {
  const host = hostnameOf(value);
  if (!host) return "";
  const labels = host.split(".");
  const secondLevel = labels[labels.length - 2] || "";
  const take = labels.length >= 3 && /^(?:ac|co|go|or|re|ne|pe|ed|es|hs|ms|kg|mil|com|net|org|edu|gov)$/i.test(secondLevel) ? 3 : 2;
  return labels.slice(-take).join(".");
}

// 다운로드가 그 논문 페이지에서 시작됐다고 볼 수 있는가(같은 사이트에서 시작했거나 출처를 모름).
function referrerFitsContext(entry, downloadItem) {
  const referrer = downloadItem && downloadItem.referrer;
  if (!referrer) return true;
  const pageUrl = entry && entry.context && entry.context.pageUrl;
  if (constants.sitePolicy.sameUrl(referrer, pageUrl)) return true;
  if (constants.isAcademicSite(referrer)) return true;
  const left = siteKey(referrer);
  return Boolean(left && left === siteKey(pageUrl));
}

// 새 탭이 열린 뒤 곧바로(리디렉션 포함) 도착한 페이지에서 받은 것인가. 자식 탭에서 한참 뒤
// 다른 사이트로 옮겨 다니다 받은 파일까지 부모 논문 이름을 붙이지 않기 위한 조건이다.
function childStayedOnViewer(downloadItem, link) {
  const top = tabTops[String(downloadItem && downloadItem.tabId)];
  if (!top || !link || top.at - link.at <= 15000) return true;
  // 같은 사이트 안에서 주소만 바뀐 것(뷰어의 쪽 넘김 등)이거나 학술 사이트면 계속 뷰어로 본다.
  return siteKey(top.url) === top.firstSite || constants.isAcademicSite(top.url);
}

// 자식 탭이 부모 논문의 원문을 띄운 창으로 보이는가. 학술 사이트이거나, 부모와 같은 사이트이거나,
// 주소가 뷰어·원문·PDF 모양일 때만 부모 논문 이름을 물려준다(아무 새 탭에나 붙이지 않도록).
const VIEWER_LIKE_PATTERN = /view|viewer|pdf|down|original|orte|fulltext|full_text|full-text|원문|stream|ebook|doc|file|article|paper/i;

function childLooksLikeViewer(downloadItem, entry) {
  const top = tabTops[String(downloadItem && downloadItem.tabId)];
  const first = top && (top.firstUrl || top.url);
  if (!first) return true;
  if (constants.isAcademicSite(first) || [downloadItem.url, downloadItem.finalUrl].some(url => url && constants.isAcademicSite(url))) return true;
  if (siteKey(first) && siteKey(first) === siteKey(entry && entry.context && entry.context.pageUrl)) return true;
  try {
    const parsed = new URL(first);
    return VIEWER_LIKE_PATTERN.test(decodeURIComponent(parsed.pathname + parsed.search));
  } catch (_error) {
    return false;
  }
}

// 같은 탭이거나 그 탭을 연 조상 탭에서 온 신뢰할 만한 논문 정보가 있는가.
function hasRelatedTrustedContext(downloadItem) {
  if (!downloadItem || !validTabId(downloadItem.tabId)) {
    return false;
  }
  return pendingContexts.some(entry => {
    if (!entry || !isTrustedPaperContext(entry.context)) return false;
    if (entry.tabId === downloadItem.tabId) {
      return !navigatedAwayFrom(entry, downloadItem) && referrerFitsContext(entry, downloadItem);
    }
    const link = lineageLink(downloadItem.tabId, entry.tabId);
    return Boolean(link && entry.context.capturedAt <= link.at + 2000 && childStayedOnViewer(downloadItem, link) &&
      childLooksLikeViewer(downloadItem, entry));
  });
}

function contextScore(entry, downloadItem, now, focusInfo) {
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
  // 같은 탭이라도 그 뒤에 다른 페이지로 옮겨 가서 받은 파일이면 같은 탭 가산점을 주지 않는다.
  const sameTab = Number.isInteger(downloadItem.tabId) && downloadItem.tabId >= 0 && entry.tabId === downloadItem.tabId &&
    !navigatedAwayFrom(entry, downloadItem);
  // 이 다운로드 탭을 연 조상 탭(원문보기 팝업·새 탭 뷰어의 부모)에서 온 정보인가.
  // 자식 탭이 열리기 전에 담긴 정보만 인정한다. 그 뒤에 부모 탭이 다른 논문으로 옮겨 갔다면
  // 그건 지금 받는 파일과 관계없다.
  const lineage = !sameTab && validTabId(entry.tabId) ? lineageLink(downloadItem.tabId, entry.tabId) : null;
  const lineageValid = Boolean(lineage && context.capturedAt <= lineage.at + 2000 &&
    childStayedOnViewer(downloadItem, lineage) && childLooksLikeViewer(downloadItem, entry));
  const freshContext = age >= 0 && age <= OPENER_CONTEXT_COPY_WINDOW_MS;
  // 약한 근거(같은 학술 사이트라는 사실, 최근에 담겼다는 사실)는 여러 창에 학술
  // 사이트를 띄워두면 전부 동점이 된다. 지금 보고 있지 않은 탭의 컨텍스트에는
  // 이 가산점을 주지 않아, 다른 창의 논문 이름이 넘어오는 것을 막는다.
  // 강한 근거(논문 ID·URL·같은 탭·원본 파일명 일치)는 그대로 인정한다.
  const weakEvidenceAllowed = isActiveTabEntry(entry, focusInfo);

  const itemId = extractPaperId(itemUrl) || extractPaperId(itemReferrer);
  const contextId = extractPaperId(pageUrl) || extractPaperId(contextUrl);
  if (itemId && contextId && itemId === contextId) {
    score += 12;
  } else if (conflictingPaperIds(extractPaperId(itemUrl), contextId)) {
    // 다운로드 URL이 다른 논문 ID를 가리키면 어떤 가산점으로도 이 정보를 쓰지 않는다.
    return -100;
  }

  if (sameTab) {
    score += 8;
  }
  if (lineageValid) {
    score += lineage.depth === 1 ? 8 : 6;
  }
  if (contextUrl && itemUrl && (itemUrl === contextUrl || itemUrl.includes(contextUrl) || contextUrl.includes(itemUrl))) {
    score += 8;
  }
  if (pageUrl && itemReferrer && (itemReferrer === pageUrl || itemReferrer.includes(pageUrl) || pageUrl.includes(itemReferrer))) {
    score += 6;
  }
  if (weakEvidenceAllowed && (sameTab || freshContext) && pageUrl && itemUrl && sameKnownPaperHost(pageUrl, itemUrl)) {
    score += 5;
  }
  if (weakEvidenceAllowed && (sameTab || freshContext) && contextUrl && itemUrl && sameKnownPaperHost(contextUrl, itemUrl)) {
    score += 5;
  }
  if (contextUrl && itemUrl && basename(contextUrl) && itemUrl.includes(basename(contextUrl))) {
    score += 4;
  }
  if (originalFilename && itemFilename && itemFilename.includes(originalFilename)) {
    score += 4;
  }

  if (weakEvidenceAllowed) {
    if (freshContext) {
      score += 3;
    } else if (age >= 0 && age < constants.CONTEXT_TTL_MS) {
      score += 1;
    }
  }

  // 여러 창에 학술 사이트를 띄워둔 상태에서 창 간 오염을 막는 축이다.
  if (focusInfo && Number.isInteger(entry.tabId) && entry.tabId >= 0) {
    if (entry.tabId === focusInfo.focusedTabId) {
      score += 6;
    } else if (Array.isArray(focusInfo.activeTabIds) && focusInfo.activeTabIds.includes(entry.tabId)) {
      score += 2;
    }
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

function selectContextMatch(downloadItem, nowValue, focusInfo) {
  const now = Number(nowValue) || Date.now();
  cleanupContexts(now);
  let best = null;
  const knownAcademicDownload = downloadValues(downloadItem).some(value => constants.isAcademicSite(value));
  const explicit = pendingContexts.filter(entry =>
    isTrustedPaperContext(entry.context) && hasExplicitContextMatch(entry.context, downloadItem));
  // The public download handler gates unknown hosts on an explicit match first.
  // Preserve legacy viewer matching for callers already carrying academic evidence.
  // 다운로드 주소가 다른 논문 ID를 가리키는 정보는 어떤 폴백에서도 후보가 아니다.
  const downloadPaperId = extractPaperId(downloadItem && (downloadItem.finalUrl || downloadItem.url) || "");
  const candidates = (!knownAcademicDownload && explicit.length ? explicit : pendingContexts)
    .filter(entry => !conflictingPaperIds(downloadPaperId, contextIdForEntry(entry)));
  for (const entry of candidates) {
    const score = contextScore(entry, downloadItem, now, focusInfo);
    if (!best || score > best.score || (score === best.score && entry.context.capturedAt > best.entry.context.capturedAt)) {
      best = { entry, score, reason: "best-score" };
    }
  }
  if ((!best || best.score < 4) && candidates.length === 1) {
    const only = candidates[0];
    if (isFreshContextEntry(only, now) && only.context.metadata && only.context.metadata.titleMain &&
        isActiveTabEntry(only, focusInfo)) {
      best = { entry: only, score: best ? best.score : 0, reason: "single-fresh-context" };
    }
  }
  if ((!best || best.score < 3) && isLikelyViewerDownload(downloadItem)) {
    const recent = candidates
      .filter((entry) => {
        const title = entry && entry.context && entry.context.metadata && entry.context.metadata.titleMain;
        return isFreshContextEntry(entry, now) && title &&
          isActiveTabEntry(entry, focusInfo) &&
          (!metadataModule || typeof metadataModule.isUsableTitle !== "function" ||
            metadataModule.isUsableTitle(title));
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

function selectContextEntry(downloadItem, nowValue, focusInfo) {
  const match = selectContextMatch(downloadItem, nowValue, focusInfo);
  return match ? match.entry : null;
}

function chooseContextEntry(downloadItem, nowValue, focusInfo) {
  const match = selectContextMatch(downloadItem, nowValue, focusInfo);
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

function chooseAfterRestore(downloadItem, callback, focusInfo) {
  const entry = chooseContextEntry(downloadItem, undefined, focusInfo);
  if (entry || !contextArea()) {
    callback(entry);
    return;
  }
  restoreContexts(() => {
    callback(chooseContextEntry(downloadItem, undefined, focusInfo));
  });
}

function rememberContext(context, sender) {
  if (!context || constants.isBlacklistedSite(context.pageUrl) || !hasContextMetadata(context)) {
    return;
  }
  const tabId = sender && sender.tab && Number.isInteger(sender.tab.id) ? sender.tab.id : -1;
  const frameId = sender && Number.isInteger(sender.frameId) ? sender.frameId : 0;
  const next = Object.assign({}, context, {
    capturedAt: Number(context.capturedAt) || Date.now()
  });
  // 사이트 UI 문구(검색 결과, 메뉴 등)가 제목에 섞여 들어오면 파일명을 오염시키므로
  // 저장 시 제목만 무효화한다. 컨텍스트 자체는 탭/호스트 매칭과 RISS 보강 대기에 필요하다.
  if (next.metadata && next.metadata.titleMain && metadataModule &&
      typeof metadataModule.isUsableTitle === "function" &&
      !metadataModule.isUsableTitle(next.metadata.titleMain)) {
    next.metadata = Object.assign({}, next.metadata, { titleMain: "" });
  }
  const entry = { context: next, tabId, frameId };
  pendingContexts.push(entry);
  pageContexts = pageContexts.filter(page => page.tabId !== tabId || page.frameId !== frameId);
  pageContexts.push(entry);
  pageContexts = pageContexts.slice(-constants.MAX_CONTEXTS);
  cleanupContexts(Date.now());
  persistContexts();
  enrichContextWithCrossref(entry);
}

function findContextEntry(downloadItem, callback, focusInfo) {
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
  const first = selectContextEntry(downloadItem, now, focusInfo);
  if (shouldWaitForRissEnrichment(first, downloadItem, now)) {
    setTimeout(() => chooseAfterRestore(downloadItem, finish, focusInfo), constants.CONTEXT_SETTLE_DELAY_MS);
    return;
  }
  chooseAfterRestore(downloadItem, finish, focusInfo);
}

// 새 탭·팝업이 어느 탭에서 열렸는지 기록한다. 예전에는 부모 컨텍스트를 5초 안에만
// 복사해 두었기 때문에, 상세페이지를 읽다가 원문보기를 누르면 이름이 안 바뀌었다.
// 이제는 관계만 기록하고, 다운로드 순간에 계보를 따라 올라가 부모의 논문 정보를 찾는다.
function handleTabRelation(tab) {
  if (!tab || !validTabId(tab.id)) {
    return;
  }
  if (validTabId(tab.openerTabId)) {
    recordTabParent(tab.id, tab.openerTabId, Date.now());
  }
}

// ── DOI 기반 Crossref 서지 보강 ──
//
// 사이트 셀렉터가 깨져 칸이 비어도 DOI만 있으면 서지를 복구할 수 있다.
// 다운로드 시점이 아니라 컨텍스트를 담을 때(=상세페이지를 열 때) 미리 채워두므로
// 다운로드가 네트워크를 기다리지 않는다.
function contextNeedsCrossref(metadata) {
  if (!metadata || !metadata.doi) {
    return false;
  }
  return !metadata.journalName ||
    !metadata.year ||
    !metadata.volume ||
    !metadata.pageFirst ||
    !Array.isArray(metadata.authors) ||
    !metadata.authors.length;
}

// Crossref 값으로 "비어 있는 칸만" 채운다.
// 국내 논문은 Crossref에 영문 제목·영문 학술지명만 등록된 경우가 많아,
// 사이트가 준 한글 값을 덮으면 오히려 나빠진다.
function mergeCrossrefIntoMetadata(metadata, extra) {
  let changed = false;
  Object.entries(extra || {}).forEach(([key, value]) => {
    if (key === "authors") {
      const hasAuthors = Array.isArray(metadata.authors) && metadata.authors.length;
      if (!hasAuthors && Array.isArray(value) && value.length) {
        metadata.authors = value;
        changed = true;
      }
      return;
    }
    if (value && !metadata[key]) {
      metadata[key] = value;
      changed = true;
    }
  });
  return changed;
}

// 컨텍스트는 페이지의 클릭마다 담기므로 같은 DOI를 반복 조회할 수 있다.
// 공개 API에 대한 예의이자 낭비 방지 차원에서 최근 조회한 DOI는 건너뛴다.
const crossrefQueriedDois = new Map();
const CROSSREF_REQUERY_INTERVAL_MS = 10 * 60 * 1000;

function shouldQueryCrossref(doi, now) {
  const at = crossrefQueriedDois.get(doi);
  if (at && now - at < CROSSREF_REQUERY_INTERVAL_MS) {
    return false;
  }
  if (crossrefQueriedDois.size > 100) {
    crossrefQueriedDois.clear();
  }
  crossrefQueriedDois.set(doi, now);
  return true;
}

function enrichContextWithCrossref(entry) {
  if (settingsCache.useCrossref !== true || typeof fetch !== "function") {
    return;
  }
  const metadata = entry && entry.context && entry.context.metadata;
  if (!contextNeedsCrossref(metadata) || !metadataModule ||
      typeof metadataModule.parseCrossrefWork !== "function") {
    return;
  }
  if (!shouldQueryCrossref(metadata.doi, Date.now())) {
    return;
  }
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), constants.CROSSREF_FETCH_TIMEOUT_MS)
    : null;
  const clearFetchTimeout = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  };
  // credentials를 보내지 않는다. 요청에 담기는 건 DOI뿐이다.
  fetch(`${constants.CROSSREF_API_BASE}${encodeURIComponent(metadata.doi)}`, {
    credentials: "omit",
    headers: { Accept: "application/json" },
    signal: controller ? controller.signal : undefined
  })
    .then((response) => (response && response.ok ? response.json() : null))
    .then((payload) => {
      clearFetchTimeout();
      if (!payload) {
        return;
      }
      if (mergeCrossrefIntoMetadata(metadata, metadataModule.parseCrossrefWork(payload))) {
        persistContexts();
      }
    })
    .catch(() => {
      clearFetchTimeout();
    });
}

// 닫힌 탭의 컨텍스트는 더 매칭될 이유가 없다. TTL(30분)을 기다리는 동안
// 스토리지에 남아 진단 로그와 폴백 후보를 어지럽히므로 즉시 지운다.
function forgetTabContexts(tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) {
    return;
  }
  delete tabTops[String(tabId)];
  delete tabParents[String(tabId)];
  // 이 탭이 연 뷰어 탭이 아직 열려 있으면, 그 탭의 다운로드를 위해 정보를 남겨 둔다
  // (TTL이 지나면 저절로 정리된다).
  const hasLiveChild = Object.values(tabParents).some(link => link && link.parent === tabId);
  const before = pendingContexts.length;
  const pagesBefore = pageContexts.length;
  if (!hasLiveChild) {
    pendingContexts = pendingContexts.filter((entry) => !entry || entry.tabId !== tabId);
  }
  pageContexts = pageContexts.filter((entry) => !entry || entry.tabId !== tabId);
  if (pendingContexts.length !== before || pageContexts.length !== pagesBefore || true) {
    persistContexts();
  }
}

function registerChromeListeners() {
  if (!hasChromeApi(["runtime"])) {
    return;
  }

  chrome.runtime.onInstalled.addListener(() => {
    loadSettings();
    // 0.1.x는 수집한 논문 정보를 디스크(storage.local)에 남겼다. 이제는 session에 두므로 옛 사본을 지운다.
    if (contextArea() !== (hasChromeApi(["storage", "local"]) ? chrome.storage.local : null) &&
        hasChromeApi(["storage", "local", "remove"])) {
      chrome.storage.local.remove([RECENT_CONTEXTS_STORAGE_KEY, PAGE_CONTEXTS_STORAGE_KEY], () => consumeLastError());
    }
  });
  chrome.runtime.onStartup.addListener(() => loadSettings());
  loadSettings();
  loadDiagnosticsEnabled();
  restoreContexts();

  if (hasChromeApi(["tabs", "onCreated"])) {
    chrome.tabs.onCreated.addListener(handleTabRelation);
  }
  // window.open 팝업, target=_blank, 리디렉션으로 열린 탭까지 출발 탭을 정확히 알려준다.
  if (hasChromeApi(["webNavigation", "onCreatedNavigationTarget"])) {
    chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => {
      if (details) recordTabParent(details.tabId, details.sourceTabId, details.timeStamp || Date.now());
    });
  }
  // 이동이 다운로드로 바뀌면 탭 주소는 그대로라 tabs.onUpdated로는 알 수 없다. 이동 시작을 기록해 둔다.
  if (hasChromeApi(["webNavigation", "onBeforeNavigate"])) {
    chrome.webNavigation.onBeforeNavigate.addListener((details) => {
      if (details) recordNavigation(details.tabId, details.url, details.timeStamp || Date.now());
    });
  }
  if (hasChromeApi(["tabs", "onUpdated"])) {
    // 예전에는 탭이 로딩을 시작하면 그 탭의 논문 정보를 지웠다. 그런데 다운로드 링크를 누르는
    // 순간에도 탭은 로딩 상태가 되기 때문에, 클릭 정보가 먼저 도착하면 지워지고 늦게 도착하면
    // 살아남아 "됐다가 안 됐다가"의 주원인이 됐다. 이제는 지우지 않고 주소 이동 시각만 기록한다.
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo && changeInfo.url) {
        // 팝업에 보여줄 "지금 페이지 정보"만 비운다. 다운로드 매칭용 정보는 남긴다.
        const before = pageContexts.length;
        pageContexts = pageContexts.filter(entry => !entry || entry.tabId !== tabId ||
          constants.sitePolicy.sameUrl(entry.context && entry.context.pageUrl, changeInfo.url));
        if (before !== pageContexts.length) persistContexts();
        recordTabTop(tabId, changeInfo.url, Date.now());
      }
    });
  }
  if (hasChromeApi(["tabs", "onRemoved"])) {
    chrome.tabs.onRemoved.addListener((tabId) => {
      forgetTabContexts(tabId);
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
    if (message && message.type === constants.MESSAGES.COOP_STATUS) {
      coopBackground.status(peers => sendResponse({ success: true, peers }));
      return true;
    }
    if (message && message.type === constants.MESSAGES.DOWNLOAD_CONTEXT) {
      rememberContext(message.context, sender);
      return false;
    }
    if (message && message.type === constants.MESSAGES.GET_TAB_PAGE_INFO) {
      restoreContexts(() => {
        const entries = pageContexts.filter(entry => entry.tabId === message.tabId && isTrustedPaperContext(entry.context));
        entries.sort((a, b) => b.context.capturedAt - a.context.capturedAt);
        sendResponse(entries.length ? { success: true, academic: true, metadata: entries[0].context.metadata } : { success: false });
      });
      return true;
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

  // 다운로드 이름 결정은 공존 프로토콜(coop.js)을 거친다. 국가유산 보고서 확장과
  // 서로의 결정을 물어 같은 최종 이름을 제안하므로, 설치 순서와 무관하게 결과가 같다.
  if (hasChromeApi(["downloads", "onDeterminingFilename"])) {
    chrome.downloads.onDeterminingFilename.addListener(coopBackground.handleDetermining);
  }
  if (hasChromeApi(["runtime", "onMessageExternal"])) {
    chrome.runtime.onMessageExternal.addListener(coopBackground.handleExternal);
  }
}

// 이 확장이 이 다운로드에 붙이고 싶은 이름을 정한다. callback({ filename, conflictAction } | undefined)
// 같은 다운로드에 대해 coop.js가 한 번만 부른다(자기 리스너와 상대 확장의 문의가 결과를 공유).
function decidePaperFilename(rawDownloadItem, callback) {
  let finished = false;
  let downloadItem = rawDownloadItem;
  const done = suggestion => {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    callback(suggestion);
  };
  // 저장소·포커스 조회가 응답하지 않아도 결정을 오래 붙잡지 않는다(coop.js의 결정 예산 3.5초 이내).
  const timeout = setTimeout(() => done(), 3300);
  if (isBlacklistedDownload(downloadItem)) {
    done();
    return;
  }
  try {
    loadSettings(() => restoreContexts(() => {
      if (finished) return;
      downloadItem = withResolvedTab(rawDownloadItem);
      if (settingsCache.enabled === false || !isPotentialPaperDownload(downloadItem)) {
        recordDownloadDiagnostic({ status: "skipped", reason: skipReason(downloadItem), downloadItem });
        done();
        return;
      }
      collectFocusInfo(focusInfo => {
        if (finished) return;
        findContextEntry(downloadItem, entry => {
          if (finished) return;
          if (settingsCache.enabled === false || !entry || !entry.context || !entry.context.metadata) {
            recordDownloadDiagnostic({ status: "no-context", reason: "no-matching-metadata", downloadItem });
            done();
            return;
          }
          try {
            const filename = renderDownloadFilename(entry, downloadItem);
            recordDownloadDiagnostic({
              status: "renamed", reason: entry.diagnosticMatch && entry.diagnosticMatch.reason || "matched-context",
              downloadItem, entry, suggestedFilename: filename
            });
            done(filename ? { filename, conflictAction: "uniquify" } : undefined);
          } catch (_error) { done(); }
        }, focusInfo);
      });
    }));
  } catch (_error) { done(); }
}

const coopBackground = globalThis.DownloadFilenameCoop.createBackground({
  role: "paper",
  decide: decidePaperFilename,
  sitePolicy: constants.sitePolicy
});

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
        pageContexts = [];
        tabParents = {};
        tabTops = {};
        recentNavigations = [];
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
    coopBackground,
    decidePaperFilename,
    clearDownloadDiagnostics,
    cleanupContexts,
    contextScore,
    contextNeedsCrossref,
    dcollectionDetailInfo,
    enrichContextWithCrossref,
    mergeCrossrefIntoMetadata,
    shouldQueryCrossref,
    extractDcollectionId,
    extractPaperId,
    recordNavigation,
    recordTabTop,
    resolveDownloadTabId,
    fetchDcollectionContext,
    findContextEntry,
    forgetTabContexts,
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
