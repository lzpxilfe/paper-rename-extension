(function initContentScript() {
  "use strict";

  const constants = globalThis.PaperRenameConstants;
  const metadataModule = globalThis.PaperRenameMetadata;
  const filenameModule = globalThis.PaperRenameFilename;

  if (!constants || !metadataModule || !filenameModule) {
    return;
  }

  const DOWNLOAD_TEXT_PATTERN = /(?:PDF|원문|본문|다운로드|내려받기|파일|Full\s*Text|Download|View\s*PDF)/i;
  const DOWNLOAD_SOURCE_PATTERN = /(?:pdf|download|down|file|fulltext|original|원문|다운로드|fnFile|fileDown|downloadFile)/i;

  let lastMetadata = null;

  const DOWNLOAD_TEXT_PATTERN_EXTRA = /(?:\uc6d0\ubb38|\ubcf8\ubb38|\ub2e4\uc6b4\ub85c\ub4dc|\ub0b4\ub824\ubc1b\uae30|\ud30c\uc77c)/i;
  const DOWNLOAD_SOURCE_PATTERN_EXTRA = /(?:viewer|view|\uc6d0\ubb38|\ubcf8\ubb38|\ub2e4\uc6b4\ub85c\ub4dc|\ub0b4\ub824\ubc1b\uae30|\ud30c\uc77c)/i;

  function matchesPattern(pattern, extraPattern, value) {
    return pattern.test(value) || extraPattern.test(value);
  }

  function normalizeSpaces(value) {
    return metadataModule.normalizeSpaces(value);
  }

  function safeClosest(target, selector) {
    try {
      return target && target.closest ? target.closest(selector) : null;
    } catch (_error) {
      return null;
    }
  }

  function controlText(control) {
    if (!control) {
      return "";
    }
    let text = [
      control.textContent,
      control.value,
      control.getAttribute && control.getAttribute("title"),
      control.getAttribute && control.getAttribute("alt"),
      control.getAttribute && control.getAttribute("aria-label"),
      control.getAttribute && control.getAttribute("class"),
      control.getAttribute && control.getAttribute("id")
    ].join(" ");
    if (control.querySelectorAll) {
      Array.from(control.querySelectorAll("img")).forEach((img) => {
        text += " " + [
          img.getAttribute("alt"),
          img.getAttribute("title"),
          img.getAttribute("src")
        ].join(" ");
      });
    }
    return normalizeSpaces(text);
  }

  function sourceText(control) {
    if (!control || !control.getAttribute) {
      return "";
    }
    return normalizeSpaces([
      control.getAttribute("href"),
      control.getAttribute("onclick"),
      control.getAttribute("data-url"),
      control.getAttribute("data-href"),
      control.getAttribute("data-file"),
      control.getAttribute("data-filename"),
      control.getAttribute("download")
    ].join(" "));
  }

  function isLikelyDownloadControl(control) {
    if (!control) {
      return false;
    }
    const text = controlText(control);
    const source = sourceText(control);
    if (matchesPattern(DOWNLOAD_TEXT_PATTERN, DOWNLOAD_TEXT_PATTERN_EXTRA, text) &&
      matchesPattern(DOWNLOAD_SOURCE_PATTERN, DOWNLOAD_SOURCE_PATTERN_EXTRA, `${text} ${source}`)) {
      return true;
    }
    if (/\.pdf(?:[?#]|$)/i.test(source)) {
      return true;
    }
    if (matchesPattern(DOWNLOAD_SOURCE_PATTERN, DOWNLOAD_SOURCE_PATTERN_EXTRA, source) &&
      /(?:a|button|input|select|option)/i.test(control.tagName || "")) {
      return true;
    }
    return false;
  }

  function absolutizeUrl(value) {
    const raw = String(value || "").trim();
    if (!raw || /^javascript:/i.test(raw) || raw === "#") {
      return "";
    }
    try {
      return new URL(raw, location.href).href;
    } catch (_error) {
      return raw;
    }
  }

  function firstUrlFromJs(source) {
    const text = String(source || "");
    const direct = text.match(/https?:\/\/[^'")\s]+/i);
    if (direct) {
      return direct[0];
    }
    const quoted = text.match(/['"]([^'"]*(?:pdf|download|file|down)[^'"]*)['"]/i);
    return quoted ? absolutizeUrl(quoted[1]) : "";
  }

  function downloadUrlFromControl(control) {
    if (!control || !control.getAttribute) {
      return "";
    }
    const direct = control.getAttribute("href") ||
      control.getAttribute("data-url") ||
      control.getAttribute("data-href") ||
      control.getAttribute("data-file");
    const directUrl = absolutizeUrl(direct);
    if (directUrl) {
      return directUrl;
    }
    return firstUrlFromJs(control.getAttribute("onclick"));
  }

  function originalFilenameFromControl(control, downloadUrl) {
    if (!control || !control.getAttribute) {
      return filenameModule.filenameFromUrl(downloadUrl);
    }
    const direct = control.getAttribute("download") ||
      control.getAttribute("data-filename") ||
      control.getAttribute("data-file-name") ||
      control.getAttribute("title") ||
      "";
    const directPdf = String(direct).match(/([^\\/:"?*<>|]+\.pdf)\b/i);
    if (directPdf) {
      return directPdf[1];
    }
    const textPdf = controlText(control).match(/([^\\/:"?*<>|]+\.pdf)\b/i);
    if (textPdf) {
      return textPdf[1];
    }
    return filenameModule.filenameFromUrl(downloadUrl);
  }

  function getCurrentMetadata() {
    try {
      const extracted = metadataModule.extractFromDocument(document, location.href);
      if (extracted && (extracted.titleMain || extracted.authors.length || extracted.journalName)) {
        lastMetadata = extracted;
      }
    } catch (error) {
      if (typeof console !== "undefined" && console.warn) {
        console.warn("[paper-rename] metadata extraction failed", error);
      }
    }
    return lastMetadata || metadataModule.blankMetadata(metadataModule.detectSource(location.href), location.href);
  }

  function hasUsefulMetadata(metadata) {
    if (!metadata) {
      return false;
    }
    const authors = Array.isArray(metadata.authors) ? metadata.authors : [];
    return Boolean(metadata.titleMain && (authors.length || metadata.journalName || metadata.publisher || metadata.year));
  }

  function isRissSearchPage(metadata) {
    return metadata && metadata.source === constants.SOURCES.RISS && /\/search\//i.test(location.pathname);
  }

  function shouldUseScopedMetadata(current, scoped) {
    if (!hasUsefulMetadata(scoped)) {
      return false;
    }
    if (!hasUsefulMetadata(current)) {
      return true;
    }
    if (isRissSearchPage(current)) {
      return true;
    }
    if ((current.source || scoped.source) === constants.SOURCES.KCI) {
      return false;
    }
    return false;
  }

  function nearbyContainer(control) {
    if (!control || !control.closest) {
      return null;
    }
    const selectors = [
      ".item",
      ".listCont",
      ".cont",
      ".box",
      ".card",
      "article",
      "tr",
      "dl",
      "li",
      "section",
      ".srchResultListW",
      ".search-result",
      ".result-list",
      ".result",
      "[class*='result']"
    ];
    for (const selector of selectors) {
      const found = safeClosest(control, selector);
      if (found && found.textContent && found.textContent.length >= Math.max((control.textContent || "").length + 20, 40)) {
        return found;
      }
    }
    return control;
  }

  function metadataFromControl(control, knownContainer) {
    const current = getCurrentMetadata();
    const container = knownContainer || nearbyContainer(control);
    const text = container ? container.innerText || container.textContent || "" : "";
    const scoped = metadataModule.parseResultText(text, current.source || metadataModule.detectSource(location.href), location.href);
    if (shouldUseScopedMetadata(current, scoped)) {
      return Object.assign({}, current, Object.fromEntries(
        Object.entries(scoped).filter(([, value]) => Array.isArray(value) ? value.length > 0 : Boolean(value))
      ));
    }
    return current;
  }

  function mergeMetadata(base, extra) {
    const next = Object.assign({}, base || {});
    Object.entries(extra || {}).forEach(([key, value]) => {
      if (key === "authors") {
        if (Array.isArray(value) && value.length) {
          next.authors = value;
        }
        return;
      }
      if (value) {
        next[key] = value;
      }
    });
    return next;
  }

  function sendContext(context) {
    chrome.runtime.sendMessage({
      type: constants.MESSAGES.DOWNLOAD_CONTEXT,
      context
    }, () => {
      void chrome.runtime.lastError;
    });
  }

  function detailUrlFromContainer(container) {
    if (!container || !container.querySelector) {
      return "";
    }
    const link = container.querySelector("a[href*='DetailView.do'], a[href*='detail/DetailView'], a[href*='p_mat_type'], [onclick*='DetailView.do'], [onclick*='p_mat_type']");
    if (!link) {
      return "";
    }
    const href = link.getAttribute("href");
    if (href && href !== "#") {
      return absolutizeUrl(href);
    }
    const onclick = link.getAttribute("onclick") || "";
    const direct = onclick.match(/https?:\/\/[^'")\s]*(?:DetailView\.do|p_mat_type)[^'")\s]*/i);
    if (direct) {
      return direct[0];
    }
    const quoted = onclick.match(/['"]([^'"]*(?:DetailView\.do|p_mat_type)[^'"]*)['"]/i);
    return quoted ? absolutizeUrl(quoted[1]) : "";
  }

  function enrichRissContextFromDetail(context, container) {
    if (!context || context.source !== constants.SOURCES.RISS || !/\/search\//i.test(location.pathname) || typeof fetch !== "function") {
      return;
    }
    const detailUrl = detailUrlFromContainer(container);
    if (!detailUrl) {
      return;
    }
    fetch(detailUrl, { credentials: "include" })
      .then((response) => response.ok ? response.text() : "")
      .then((html) => {
        if (!html) {
          return;
        }
        const detailMetadata = metadataModule.parseFixtureHtml(html, detailUrl);
        if (!hasUsefulMetadata(detailMetadata)) {
          return;
        }
        sendContext(Object.assign({}, context, {
          metadata: mergeMetadata(context.metadata, detailMetadata),
          pageUrl: detailUrl,
          capturedAt: Date.now()
        }));
      })
      .catch(() => {});
  }

  function sendDownloadContext(control) {
    if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
      return;
    }
    const downloadUrl = downloadUrlFromControl(control);
    const container = nearbyContainer(control);
    const metadata = metadataFromControl(control, container);
    if (!hasUsefulMetadata(metadata)) {
      return;
    }
    const context = {
      metadata: Object.assign({}, metadata, {
        originalFilename: metadata.originalFilename || originalFilenameFromControl(control, downloadUrl)
      }),
      pageUrl: location.href,
      downloadUrl,
      originalFilename: originalFilenameFromControl(control, downloadUrl),
      source: metadata.source,
      capturedAt: Date.now()
    };
    sendContext(context);
    enrichRissContextFromDetail(context, container);
  }

  function handlePossibleDownload(event) {
    const control = safeClosest(event.target, "a, button, input, select, option, [role='button'], [tabindex], [onclick], [data-url], [data-href], [data-file], [class*='down'], [class*='file'], [class*='full']");
    if (!isLikelyDownloadControl(control)) {
      return;
    }
    sendDownloadContext(control);
  }

  function handleKeyboard(event) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    handlePossibleDownload(event);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== constants.MESSAGES.GET_PAGE_INFO) {
      return false;
    }
    try {
      sendResponse({
        success: true,
        metadata: getCurrentMetadata()
      });
    } catch (error) {
      sendResponse({
        success: false,
        error: error && error.message ? error.message : String(error)
      });
    }
    return true;
  });

  document.addEventListener("pointerdown", handlePossibleDownload, true);
  document.addEventListener("mousedown", handlePossibleDownload, true);
  document.addEventListener("click", handlePossibleDownload, true);
  document.addEventListener("change", handlePossibleDownload, true);
  document.addEventListener("keydown", handleKeyboard, true);

  getCurrentMetadata();
})();
