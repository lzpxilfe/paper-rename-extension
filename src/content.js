(function initContentScript() {
  "use strict";

  const constants = globalThis.PaperRenameConstants;
  const metadataModule = globalThis.PaperRenameMetadata;
  const filenameModule = globalThis.PaperRenameFilename;

  const titleText = (document.title || "").toLowerCase();
  // 원문 뷰어/미리보기 창. KCI의 "원문 미리보기"는 ciSereArtiOrteView.kci, DBpia는 pdfView 등
  // 사이트마다 이름이 달라 넓게 잡는다. 뷰어 판정은 "부모(opener) 문서의 서지를 쓸지"에만 쓰인다.
  const isViewerPage = /viewer/i.test(location.hostname) ||
                       /viewer|originalView|popOriginal|viewOriginal|OrteView|PreView|pdfView|pdf_view|fileView|docView|streamdocs|ebook/i.test(location.pathname) ||
                       /원문보기|원문\s*보기|원문\s*미리보기|미리\s*보기|original\s*view|pdf\s*view/i.test(titleText);
  // 쿼리 파라미터(sessionId=, returnUrl=/login 등)까지 검사하면 논문 상세 페이지까지
  // 차단되므로 경로(pathname)만 본다.
  // 지연 평가한다. 비밀번호 입력창 검사와 innerText 읽기는 강제 레이아웃을 유발하는데,
  // 이 값은 실제로 서지 정보를 추출할 때만 필요하다.
  let loginPageCache = null;
  function isLoginPage() {
    if (loginPageCache !== null) {
      return loginPageCache;
    }
    loginPageCache = /login|signin|oauth|authorize|register/i.test(location.pathname) ||
      /^(로그인|인증|login|signin)$/i.test(titleText) ||
      /(?:로그인\s*페이지|도서관\s*로그인|library\s*login)/i.test(titleText) ||
      // 비밀번호 입력창이 있어도 본문이 거의 없는(로그인 전용) 화면일 때만
      // 로그인 페이지로 본다. 논문 사이트는 헤더에 로그인 위젯을 두는 경우가 많다.
      (document.querySelector && document.querySelector('input[type="password"]') !== null &&
       document.body && (document.body.innerText || "").trim().length < 400);
    return loginPageCache;
  }
  if (!constants || !metadataModule || !filenameModule) {
    return;
  }


  function pageUrl() {
    if (/^about:(?:blank|srcdoc)/i.test(location.href)) {
      try {
        if (window.parent !== window && /^https?:/i.test(window.parent.location.href)) return window.parent.location.href;
      } catch (_error) {}
      return document.referrer || location.href;
    }
    return location.href;
  }

  function isScholarlyPage() {
    const url = pageUrl();
    if (constants.isBlacklistedSite(url)) return false;
    return constants.isAcademicSite(url) ||
      metadataModule.hasScholarlyMetadata(document) ||
      // 원 주소를 남기지 않는 학교 프록시: 학술 DB 고유의 경로 모양으로 알아본다.
      Boolean(metadataModule.pathSignatureSource && metadataModule.pathSignatureSource(url)) ||
      // 같은 출처의 부모 창이 논문 페이지인 뷰어 팝업.
      Boolean(isViewerPage && openerDocument());
  }

  // 같은 출처라서 읽을 수 있는 부모(opener) 창의 문서. 뷰어 팝업에서 서지를 가져올 때 쓴다.
  function openerDocument() {
    try {
      const opener = window.opener;
      if (!opener || opener === window || opener.closed) return null;
      const doc = opener.document;
      if (!doc || !doc.documentElement) return null;
      const openerUrl = opener.location.href;
      if (constants.isBlacklistedSite(openerUrl)) return null;
      if (!(constants.isAcademicSite(openerUrl) || metadataModule.hasScholarlyMetadata(doc) ||
            (metadataModule.pathSignatureSource && metadataModule.pathSignatureSource(openerUrl)))) {
        return null;
      }
      return { doc, url: openerUrl };
    } catch (_error) {
      return null; // 다른 출처면 읽을 수 없다. 이 경우는 백그라운드의 탭 계보가 처리한다.
    }
  }

  function citationPdfUrl() {
    const element = document.querySelector('meta[name="citation_pdf_url" i]');
    const value = element && element.getAttribute("content");
    if (!value) return "";
    try { return new URL(value, pageUrl()).href; } catch (_error) { return ""; }
  }

  const DOWNLOAD_TEXT_PATTERN = /(?:PDF|원문|본문|다운로드|내려받기|파일|Full\s*Text|Download|View\s*PDF)/i;
  const DOWNLOAD_SOURCE_PATTERN = /(?:pdf|download|down|file|fulltext|original|원문|다운로드|fnFile|fileDown|downloadFile)/i;

  let lastMetadata = null;
  // 한 번의 클릭에서 pointerdown → click 순으로 두 번 발화하는 문제를 주방하는 debounce 간격
  const CONTEXT_SEND_DEBOUNCE_MS = 300;
  let lastContextSentAt = 0;
  let runtimeInvalidated = false;

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

  function extractStreamDocsIdFromJs(text) {
    if (!text) {
      return "";
    }
    const explicitMatch = text.match(/(?:streamdocsId|sItemId)[=;:'"]+([A-Za-z0-9_-]+)/i);
    if (explicitMatch) {
      return explicitMatch[1];
    }
    const numberMatch = text.match(/['"](\d{12,20})['"]/);
    if (numberMatch) {
      return numberMatch[1];
    }
    return "";
  }

  function downloadUrlFromControl(control) {
    if (!control || !control.getAttribute) {
      return "";
    }
    const href = control.getAttribute("href") || "";
    const onclick = control.getAttribute("onclick") || "";
    const dataUrl = control.getAttribute("data-url") ||
      control.getAttribute("data-href") ||
      control.getAttribute("data-file") || "";

    const directUrl = absolutizeUrl(dataUrl || href);
    if (directUrl) {
      return directUrl;
    }

    const jsText = (href.startsWith("javascript:") ? href : "") + " " + onclick;
    const sId = extractStreamDocsIdFromJs(jsText);
    if (sId) {
      return `https://viewer.dcollection.net/originalViewer.jsp?streamdocsId=${sId}`;
    }

    return firstUrlFromJs(onclick);
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
      let docToExtract = document;
      let urlToExtract = pageUrl();

      if (constants && typeof constants.isBlacklistedSite === "function" && constants.isBlacklistedSite(urlToExtract)) {
        return lastMetadata || metadataModule.blankMetadata(metadataModule.detectSource(urlToExtract), urlToExtract);
      }

      let extracted = metadataModule.extractFromDocument(docToExtract, urlToExtract);
      // 뷰어 팝업은 문서 자체에 서지가 없다(제목이 사이트 이름뿐). 부모 창의 논문 정보를 쓴다.
      if (isViewerPage && !(extracted && extracted.titleMain && metadataModule.isUsableTitle(extracted.titleMain))) {
        const opener = openerDocument();
        if (opener) {
          const fromOpener = metadataModule.extractFromDocument(opener.doc, opener.url);
          if (fromOpener && fromOpener.titleMain) {
            extracted = fromOpener;
            urlToExtract = opener.url;
          }
        }
      }
      const isExtractedValid = extracted && (
        extracted.titleMain ||
        extracted.authors.length ||
        extracted.journalName ||
        extracted.publisher ||
        extracted.year ||
        extracted.pageFirst
      );
      if (isExtractedValid) {
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
    return Boolean(
      metadata.titleMain ||
      authors.length ||
      metadata.journalName ||
      metadata.publisher ||
      metadata.year ||
      metadata.pageFirst
    );
  }

  // RISS 검색 결과 "목록"인가. 상세 화면(/search/detail/DetailView.do)도 경로에 /search/가 들어가므로
  // 예전처럼 /search/만 보면 상세 화면에서 버튼 주변 글자를 제목으로 잘못 썼다.
  function isRissSearchPage(metadata) {
    return metadata && metadata.source === constants.SOURCES.RISS &&
      metadataModule.isAcademicListPage(pageUrl(), metadata.source) && !/\/search\/detail\//i.test(location.pathname);
  }

  function isGoogleScholarPage() {
    return /(?:^|\.)scholar\.google\.[a-z.]+$/i.test(location.hostname) || /scholar[-.]google/i.test(location.hostname);
  }

  function isGenericPageMetadata(metadata) {
    const title = normalizeSpaces(metadata && metadata.titleMain);
    const authors = Array.isArray(metadata && metadata.authors) ? metadata.authors : [];
    const hasPaperIdentity = Boolean(
      title ||
      authors.length ||
      (metadata && metadata.journalName) ||
      (metadata && metadata.publisher) ||
      (metadata && metadata.pageFirst)
    );
    return Boolean(
      metadata &&
      metadata.source === constants.SOURCES.DCOLLECTION &&
      (!hasPaperIdentity || /(?:dCollection\s*디지털\s*학술정보\s*유통시스템|디지털\s*학술정보\s*유통시스템)/i.test(title))
    );
  }

  function shouldUseScopedMetadata(current, scoped) {
    if (!hasUsefulMetadata(scoped)) {
      return false;
    }
    // 버튼 주변에서 읽은 글자에 쓸 만한 제목이 없으면(버튼 문구뿐이면) 쓰지 않는다.
    if (!scoped.titleMain || !metadataModule.isUsableTitle(scoped.titleMain)) {
      return false;
    }
    if (!hasUsefulMetadata(current)) {
      return true;
    }
    if (isGenericPageMetadata(current)) {
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
      ".gs_r",
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
    // Google 학술검색: 결과 한 줄 단위로 제목·저자·학술지를 읽는다.
    if (isGoogleScholarPage()) {
      const row = safeClosest(control, ".gs_r, .gs_scl, .gs_or");
      const parsed = row ? metadataModule.parseScholarResultRow(row, location.href) : null;
      if (parsed && parsed.titleMain) return parsed;
    }
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

  function markRuntimeInvalidated(error) {
    const message = error && error.message ? error.message : String(error || "");
    if (/Extension context invalidated|context invalidated/i.test(message)) {
      runtimeInvalidated = true;
    }
  }

  function consumeRuntimeLastError() {
    try {
      void chrome.runtime.lastError;
    } catch (error) {
      markRuntimeInvalidated(error);
    }
  }

  function canUseRuntimeMessaging() {
    return !runtimeInvalidated &&
      typeof chrome !== "undefined" &&
      chrome.runtime &&
      typeof chrome.runtime.sendMessage === "function";
  }

  function sendContext(context) {
    if (!canUseRuntimeMessaging()) {
      return;
    }
    try {
      chrome.runtime.sendMessage({
        type: constants.MESSAGES.DOWNLOAD_CONTEXT,
        context
      }, consumeRuntimeLastError);
    } catch (error) {
      markRuntimeInvalidated(error);
    }
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
    if (!canUseRuntimeMessaging() || !isScholarlyPage()) {
      return;
    }
    // debounce: pointerdown → click 연속 발화 시 중복 전송 방지
    const now = Date.now();
    if (now - lastContextSentAt < CONTEXT_SEND_DEBOUNCE_MS) {
      return;
    }
    lastContextSentAt = now;
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
      pageUrl: pageUrl(),
      scholarly: isScholarlyPage(),
      downloadUrl,
      originalFilename: originalFilenameFromControl(control, downloadUrl),
      source: metadata.source,
      capturedAt: Date.now()
    };
    sendContext(context);
    enrichRissContextFromDetail(context, container);
  }

  function handlePossibleDownload(event) {
    if (constants && typeof constants.isBlacklistedSite === "function" && constants.isBlacklistedSite(location.href)) {
      return;
    }
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

  try {
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (!message || message.type !== constants.MESSAGES.GET_PAGE_INFO) {
          return false;
        }
        try {
          sendResponse({
            success: true,
            academic: isScholarlyPage(),
            metadata: isScholarlyPage() ? getCurrentMetadata() : null
          });
        } catch (error) {
          sendResponse({
            success: false,
            error: error && error.message ? error.message : String(error)
          });
        }
        return true;
      });
    }
  } catch (error) {
    markRuntimeInvalidated(error);
  }

  // URLs are not tied to a specific school. Unknown proxy hosts require actual
  // scholarly metadata before any click listeners or context collection start.
  let listening = false;
  function activate() {
    if (!isScholarlyPage() || isLoginPage()) return false;
    if (!listening) {
      listening = true;
      document.addEventListener("pointerdown", handlePossibleDownload, true);
      document.addEventListener("click", handlePossibleDownload, true);
      document.addEventListener("change", handlePossibleDownload, true);
      document.addEventListener("keydown", handleKeyboard, true);
    }
    return true;
  }

  let initialFingerprint = "";
  function sendInitialContext() {
    if (!activate()) {
      return;
    }
    const metadata = getCurrentMetadata();
    // 목록(검색 결과) 화면은 한 페이지에 논문이 여럿이라 페이지 단위로 담지 않는다(클릭한 행만 담는다).
    // 예전에는 주소에 search/srch가 들어가면 모두 목록으로 봤는데, KCI 상세(ciSereArticleSearch/...)와
    // ScienceON 상세(srch/selectPORSrchArticle.do)까지 걸려 상세페이지 정보가 미리 담기지 않았다.
    const listPage = metadataModule.isAcademicListPage(pageUrl(), metadata.source);
    if (hasUsefulMetadata(metadata) && metadata.titleMain && !isGenericPageMetadata(metadata) && !isRissSearchPage(metadata) && !listPage) {
      const context = {
        metadata,
        pageUrl: pageUrl(),
        scholarly: isScholarlyPage(),
        downloadUrl: citationPdfUrl(),
        originalFilename: "",
        source: metadata.source,
        capturedAt: Date.now()
      };
      const fingerprint = JSON.stringify([context.pageUrl, context.downloadUrl, metadata]);
      if (fingerprint === initialFingerprint) return;
      initialFingerprint = fingerprint;
      sendContext(context);
    }
  }

  if (activate()) getCurrentMetadata();
  [500, 1500, 4000].forEach(delay => setTimeout(sendInitialContext, delay));

  // 페이지를 새로 읽지 않고 주소만 바꾸는 사이트(SPA)에서도 지금 보이는 논문을 다시 담는다.
  // 학술 페이지에서만, 주소나 제목이 바뀌었을 때만 동작한다.
  if (window === window.top) {
    let lastHref = location.href;
    let lastTitle = document.title;
    const checkForSoftNavigation = () => {
      if (location.href === lastHref && document.title === lastTitle) return;
      lastHref = location.href;
      lastTitle = document.title;
      lastMetadata = null;
      loginPageCache = null;
      [300, 1500].forEach(delay => setTimeout(sendInitialContext, delay));
    };
    try {
      if (window.navigation && typeof window.navigation.addEventListener === "function") {
        window.navigation.addEventListener("navigatesuccess", checkForSoftNavigation);
      }
    } catch (_error) {}
    window.addEventListener("popstate", checkForSoftNavigation);
    let softChecks = 0;
    const softTimer = setInterval(() => {
      softChecks += 1;
      if (softChecks > 120 || runtimeInvalidated) clearInterval(softTimer);
      if (listening) checkForSoftNavigation();
    }, 2000);
  }
})();
