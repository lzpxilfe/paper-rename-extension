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
    if (DOWNLOAD_TEXT_PATTERN.test(text) && DOWNLOAD_SOURCE_PATTERN.test(`${text} ${source}`)) {
      return true;
    }
    if (/\.pdf(?:[?#]|$)/i.test(source)) {
      return true;
    }
    if (DOWNLOAD_SOURCE_PATTERN.test(source) && /(?:a|button|input)/i.test(control.tagName || "")) {
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

  function sendDownloadContext(control) {
    if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
      return;
    }
    const downloadUrl = downloadUrlFromControl(control);
    const metadata = getCurrentMetadata();
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
    chrome.runtime.sendMessage({
      type: constants.MESSAGES.DOWNLOAD_CONTEXT,
      context
    }, () => {
      void chrome.runtime.lastError;
    });
  }

  function handlePossibleDownload(event) {
    const control = safeClosest(event.target, "a, button, input, [role='button'], [onclick], [data-url], [data-href], [data-file]");
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
  document.addEventListener("keydown", handleKeyboard, true);

  getCurrentMetadata();
})();
