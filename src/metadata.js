(function initMetadataModule(global) {
  "use strict";

  const constants = global.PaperRenameConstants || (typeof require === "function" ? require("./constants.js") : {});
  const citation = global.PaperRenameCitation || (typeof require === "function" ? require("./citation.js") : {});
  const SOURCES = constants.SOURCES || {};

  function normalizeSpaces(value) {
    return citation.normalizeSpaces
      ? citation.normalizeSpaces(value)
      : String(value || "").replace(/\s+/g, " ").trim();
  }

  function fixTypography(value) {
    return normalizeSpaces(value)
      .replace(/`([^`]+)`/g, "‘$1’")
      .replace(/'([^']+)'/g, "‘$1’")
      .replace(/"([^"]+)"/g, "“$1”")
      .replace(/</g, "〈")
      .replace(/>/g, "〉")
      .replace(/[•ㆍᆞ・･‧⋅]/g, "·")
      .replace(/[‐‑⁃⁻₋﹣－―]/g, "-")
      .replace(/\.{3}/g, "…");
  }

  function removeNonKoreanParen(value) {
    return normalizeSpaces(value).replace(/\([^가-힣]*\)/g, "");
  }

  function cleanLabel(value) {
    return normalizeSpaces(value)
      .replace(/[:：]\s*$/g, "")
      .replace(/\s+/g, "");
  }

  function cleanValue(value) {
    return fixTypography(String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " "));
  }

  function splitTitle(rawValue) {
    let raw = fixTypography(String(rawValue || "").split("=")[0]);
    raw = raw.replace(/\s*\|\s*.*$/g, "");
    const ranges = [];
    [["『", "』"], ["「", "」"], ["‘", "’"], ["“", "”"]].forEach(([open, close]) => {
      const start = raw.indexOf(open);
      const end = raw.indexOf(close);
      if (start >= 0 && end > start) {
        ranges.push([start, end]);
      }
    });

    const delimiters = [":", " — ", " – ", raw.includes(" - ") ? " - " : "-"];
    for (const delimiter of delimiters) {
      let index = raw.indexOf(delimiter);
      while (index >= 0) {
        const insideBrackets = ranges.some(([start, end]) => index > start && index < end);
        const numberHyphen = delimiter === "-" && /\d/.test(raw.charAt(index - 1)) && /\d/.test(raw.charAt(index + 1));
        if (!insideBrackets && !numberHyphen) {
          const main = normalizeSpaces(raw.slice(0, index));
          const sub = normalizeSpaces(raw.slice(index + delimiter.length).replace(/^[\s\-–—]+|[\s\-–—]+$/g, ""));
          return { titleMain: main, titleSub: sub };
        }
        index = raw.indexOf(delimiter, index + delimiter.length);
      }
    }
    return { titleMain: raw, titleSub: "" };
  }

  function parseYear(value) {
    const match = normalizeSpaces(value).match(/(?:19|20)\d{2}/);
    return match ? match[0] : "";
  }

  function parsePages(value) {
    const text = normalizeSpaces(value)
      .replace(/[–—~〜]/g, "-")
      .replace(/쪽/g, "")
      .replace(/pp?\./ig, "");
    const range = text.match(/(\d+)\s*-\s*(\d+)/);
    if (range) {
      return { pageFirst: range[1], pageLast: range[2] };
    }
    const one = text.match(/\b(\d+)\b/);
    return one ? { pageFirst: one[1], pageLast: "" } : {};
  }

  function parseVolumeIssue(value) {
    const text = normalizeSpaces(value);
    let volume = "";
    let issue = "";
    const volNo = text.match(/Vol\.?\s*([0-9A-Za-z가-힣.-]+)/i);
    const no = text.match(/No\.?\s*([0-9A-Za-z가-힣.-]+)/i);
    const compact = text.match(/(\d+)\s*\(\s*(\d+)\s*\)/);
    const koreanVolume = text.match(/(?:제\s*)?(\d+)\s*(?:권|집|호)/);
    const koreanIssue = text.match(/(?:제\s*)?\d+\s*(?:권|집)\s*(?:제\s*)?(\d+)\s*호/);

    if (volNo) {
      volume = volNo[1].replace(/[-,.;]+$/g, "");
    }
    if (no && no[1] !== "-") {
      issue = no[1].replace(/[-,.;]+$/g, "");
    }
    if (!volume && compact) {
      volume = compact[1];
      issue = compact[2];
    }
    if (!volume && koreanVolume) {
      volume = koreanVolume[1];
    }
    if (!issue && koreanIssue) {
      issue = koreanIssue[1];
    }
    return { volume, issue };
  }

  function splitAuthors(value) {
    const text = removeNonKoreanParen(fixTypography(value))
      .replace(/\s+외\s+\d+\s*명/g, "")
      .replace(/\s+and\s+/ig, ";")
      .replace(/[;；]/g, ";");
    const pieces = text.split(/;|ㆍ|·|\n|\r/).map(cleanValue).filter(Boolean);
    if (pieces.length > 1) {
      return pieces;
    }
    const commaPieces = text.split(/\s*,\s*/).map(cleanValue).filter(Boolean);
    return commaPieces.length > 1 ? commaPieces : (text ? [cleanValue(text)] : []);
  }

  function textOf(element) {
    if (typeof element === "string") {
      return cleanValue(element);
    }
    return cleanValue((element && (element.innerText || element.textContent || element.value)) || "");
  }

  function q(doc, selector) {
    try {
      return doc && doc.querySelector ? doc.querySelector(selector) : null;
    } catch (_error) {
      return null;
    }
  }

  function qAll(doc, selector) {
    try {
      return doc && doc.querySelectorAll ? Array.from(doc.querySelectorAll(selector)) : [];
    } catch (_error) {
      return [];
    }
  }

  function looksLikeFieldLabel(label, names) {
    const normalized = cleanLabel(label);
    return names.some((name) => normalized === cleanLabel(name) || normalized.includes(cleanLabel(name)));
  }

  function nextValueElement(element) {
    if (!element) {
      return null;
    }
    let sibling = element.nextElementSibling;
    while (sibling) {
      if (!/^(script|style)$/i.test(sibling.tagName || "")) {
        return sibling;
      }
      sibling = sibling.nextElementSibling;
    }
    return null;
  }

  function collectFactsFromDocument(doc) {
    const facts = {};

    qAll(doc, "tr").forEach((row) => {
      const cells = qAll(row, "th, td");
      if (cells.length >= 2) {
        const label = cleanLabel(textOf(cells[0]));
        const value = textOf(cells.slice(1).map(textOf).join(" "));
        if (label && value && !facts[label]) {
          facts[label] = value;
        }
      }
    });

    qAll(doc, "dt, th").forEach((labelElement) => {
      const label = cleanLabel(textOf(labelElement));
      const value = textOf(nextValueElement(labelElement));
      if (label && value && !facts[label]) {
        facts[label] = value;
      }
    });

    qAll(doc, "li").forEach((item) => {
      const strong = q(item, "span.strong, strong, b, em");
      if (!strong) {
        return;
      }
      const label = cleanLabel(textOf(strong));
      const value = cleanValue(textOf(item).replace(textOf(strong), ""));
      if (label && value && !facts[label]) {
        facts[label] = value;
      }
    });

    return facts;
  }

  function valueByLabels(facts, labels) {
    for (const [label, value] of Object.entries(facts || {})) {
      if (looksLikeFieldLabel(label, labels) && value) {
        return cleanValue(value);
      }
    }
    return "";
  }

  function firstText(doc, selectors) {
    for (const selector of selectors) {
      const element = q(doc, selector);
      const value = textOf(element);
      if (value) {
        return value;
      }
    }
    return "";
  }

  function metaContent(doc, selectors) {
    for (const selector of selectors) {
      const element = q(doc, selector);
      const value = cleanValue(element && element.getAttribute && element.getAttribute("content"));
      if (value) {
        return value;
      }
    }
    return "";
  }

  function applyFactsToMetadata(meta, facts) {
    const next = Object.assign({}, meta || {});
    const authors = valueByLabels(facts, ["저자", "Authors", "Author"]);
    const journal = valueByLabels(facts, ["학술지명", "학술지", "간행물명", "논문집", "저널/프로시딩명", "Journal", "Journal/Proceedings"]);
    const publisher = valueByLabels(facts, ["발행기관", "출판사", "발행처", "Publisher", "소속기관", "발행처명"]);
    const year = valueByLabels(facts, ["발행연도", "발행년도", "발행년", "연도", "Year", "발행일", "게재년월", "발간년월", "Published"]);
    const pages = valueByLabels(facts, ["수록면", "페이지", "쪽수", "Pages", "Page"]);
    const pageFirst = valueByLabels(facts, ["시작페이지", "시작 페이지", "Start Page", "First Page"]);
    const pageLast = valueByLabels(facts, ["끝페이지", "끝 페이지", "End Page", "Last Page"]);
    const volumeIssue = valueByLabels(facts, ["권호사항", "권호", "Volume", "Issue"]);
    const volume = valueByLabels(facts, ["권", "Volume", "Vol"]);
    const issue = valueByLabels(facts, ["호", "Issue", "No"]);
    const title = valueByLabels(facts, ["논문명", "논문제목", "제목", "Title"]);

    if (!next.authors.length && authors) {
      next.authors = splitAuthors(authors);
    }
    if (!next.journalName && journal) {
      next.journalName = journal;
    }
    if (!next.publisher && publisher) {
      next.publisher = removeNonKoreanParen(publisher);
    }
    if (!next.year && year) {
      next.year = parseYear(year);
    }
    if (pages) {
      Object.assign(next, parsePages(pages));
    }
    if (pageFirst && !next.pageFirst) {
      next.pageFirst = normalizeSpaces(pageFirst).replace(/[^\d]/g, "");
    }
    if (pageLast && !next.pageLast) {
      next.pageLast = normalizeSpaces(pageLast).replace(/[^\d]/g, "");
    }
    if (volumeIssue) {
      const parsed = parseVolumeIssue(volumeIssue);
      next.volume = next.volume || parsed.volume;
      next.issue = next.issue || parsed.issue;
    }
    if (volume && !next.volume) {
      next.volume = normalizeSpaces(volume).replace(/[^\dA-Za-z가-힣.-]/g, "");
    }
    if (issue && !next.issue) {
      next.issue = normalizeSpaces(issue).replace(/[^\dA-Za-z가-힣.-]/g, "");
    }
    if (!next.titleMain && title) {
      Object.assign(next, splitTitle(title));
    }

    return next;
  }

  function blankMetadata(source, pageUrl) {
    return {
      authors: [],
      titleMain: "",
      titleSub: "",
      journalName: "",
      volume: "",
      issue: "",
      publisher: "",
      year: "",
      pageFirst: "",
      pageLast: "",
      originalFilename: "",
      source: source || SOURCES.UNKNOWN || "unknown",
      pageUrl: pageUrl || ""
    };
  }

  function detectSource(url) {
    let parsed;
    try {
      parsed = new URL(url || (global.location && global.location.href) || "");
    } catch (_error) {
      return SOURCES.UNKNOWN || "unknown";
    }
    const host = parsed.hostname;
    const href = parsed.href;
    if (/riss/i.test(host) && /\/search\/detail\/DetailView\.do/i.test(parsed.pathname)) {
      return SOURCES.RISS;
    }
    if (/kci\.go\.kr$/i.test(host) && /\/kciportal\//i.test(parsed.pathname)) {
      return SOURCES.KCI;
    }
    if (/kiss\.kstudy\.com$/i.test(host) && /\/Detail/i.test(parsed.pathname)) {
      return SOURCES.KISS;
    }
    if (/dbpia\.com$/i.test(host) && /\/journal\/(?:articleDetail|detail)/i.test(parsed.pathname)) {
      return SOURCES.DBPIA;
    }
    if (/earticle\.net$/i.test(host) && /\/Article\//i.test(parsed.pathname)) {
      return SOURCES.EARTICLE;
    }
    if (/scholar\.kyobobook\.co\.kr$/i.test(host) && /\/article\/detail\//i.test(parsed.pathname)) {
      return SOURCES.SCHOLAR;
    }
    if (/scholar-kyobobook-co-kr-ssl\.openlib\.uos\.ac\.kr$/i.test(host)) {
      return SOURCES.SCHOLAR;
    }
    if (/koreascience\.or\.kr$/i.test(host)) {
      return SOURCES.KOREASCIENCE;
    }
    if (/scienceon\.kisti\.re\.kr$/i.test(host)) {
      return SOURCES.SCIENCEON;
    }
    if (/(^|\.)krm\.or\.kr$/i.test(host)) {
      return SOURCES.KRM;
    }
    return SOURCES.UNKNOWN || "unknown";
  }

  function extractTitle(doc, source) {
    const sourceTitleSelectors = {
      RISS: ["#thesisInfoDiv .title", "#thesisInfoDiv h3", ".thesisInfo .title"],
      KCI: [".article-title", ".title", "h3", "h2"],
      KISS: [".articleTitle", ".title", "h3", "h2"],
      DBpia: [".thesis__tit", ".article-title", ".title", "h1", "h2"],
      eArticle: [".articleTitle", ".title", "h3", "h2"],
      "교보 스콜라": [".article-title", ".title", "h3", "h2"],
      KoreaScience: [".articleTitle", ".title", ".paper-title", "h1", "h2"],
      ScienceON: [".title", ".tit", ".paper-title", "h1", "h2"],
      KRM: [".title", ".tit", ".subject", "h1", "h2"]
    };
    const selectors = (sourceTitleSelectors[source] || [])
      .concat(["meta[property='og:title']", "meta[name='title']", "title"]);
    const metaTitle = metaContent(doc, ["meta[property='og:title']", "meta[name='title']"]);
    const title = firstText(doc, selectors.filter((selector) => !selector.startsWith("meta"))) || metaTitle || cleanValue(doc && doc.title);
    return splitTitle(title.replace(/\s*-\s*(RISS|KCI|KISS|DBpia|eArticle|교보문고|스콜라|KoreaScience|ScienceON|KRM).*$/i, ""));
  }

  function extractAuthorsBySelector(doc) {
    const selectors = [
      ".author",
      ".authors",
      ".writer",
      ".article-author",
      ".authorName",
      "[class*='author']"
    ];
    for (const selector of selectors) {
      const elements = qAll(doc, selector);
      const joined = elements.map(textOf).filter(Boolean).join(";");
      const authors = splitAuthors(joined);
      if (authors.length) {
        return authors;
      }
    }
    return [];
  }

  function extractFromDocument(doc, url) {
    const pageUrl = url || (global.location && global.location.href) || "";
    const source = detectSource(pageUrl);
    let meta = blankMetadata(source, pageUrl);
    if (!doc || source === (SOURCES.UNKNOWN || "unknown")) {
      return meta;
    }

    const facts = collectFactsFromDocument(doc);
    meta = applyFactsToMetadata(meta, facts);
    if (!meta.titleMain) {
      Object.assign(meta, extractTitle(doc, source));
    }
    if (!meta.authors.length) {
      meta.authors = extractAuthorsBySelector(doc);
    }
    if (!meta.year) {
      meta.year = parseYear(textOf(doc.body || doc.documentElement || doc));
    }
    return normalizeMetadata(meta);
  }

  function normalizeMetadata(meta) {
    const next = Object.assign(blankMetadata(meta && meta.source, meta && meta.pageUrl), meta || {});
    next.authors = Array.isArray(next.authors) ? next.authors.map(cleanValue).filter(Boolean) : splitAuthors(next.authors);
    [
      "titleMain",
      "titleSub",
      "journalName",
      "volume",
      "issue",
      "publisher",
      "year",
      "pageFirst",
      "pageLast",
      "originalFilename",
      "source",
      "pageUrl"
    ].forEach((key) => {
      next[key] = cleanValue(next[key]);
    });
    return next;
  }

  function stripTags(html) {
    return cleanValue(String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "));
  }

  function decodeHtml(value) {
    return String(value || "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'");
  }

  function collectFactsFromHtml(html) {
    const facts = {};
    const pairs = [
      /<tr[^>]*>\s*<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>\s*<td[^>]*>([\s\S]*?)<\/td>/gi,
      /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi,
      /<li[^>]*>\s*<(?:span|strong|b|em)[^>]*>([\s\S]*?)<\/(?:span|strong|b|em)>([\s\S]*?)<\/li>/gi
    ];
    pairs.forEach((pattern) => {
      let match;
      while ((match = pattern.exec(html))) {
        const label = cleanLabel(stripTags(decodeHtml(match[1])));
        const value = cleanValue(stripTags(decodeHtml(match[2])));
        if (label && value && !facts[label]) {
          facts[label] = value;
        }
      }
    });
    return facts;
  }

  function titleFromHtml(html) {
    const patterns = [
      /<[^>]+class=["'][^"']*(?:title|article-title|thesis__tit|articleTitle)[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i,
      /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i,
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i,
      /<title[^>]*>([\s\S]*?)<\/title>/i
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        return stripTags(decodeHtml(match[1]));
      }
    }
    return "";
  }

  function parseFixtureHtml(html, url) {
    const source = detectSource(url);
    let meta = blankMetadata(source, url);
    meta = applyFactsToMetadata(meta, collectFactsFromHtml(html));
    if (!meta.titleMain) {
      Object.assign(meta, splitTitle(titleFromHtml(html)));
    }
    if (!meta.year) {
      meta.year = parseYear(stripTags(html));
    }
    return normalizeMetadata(meta);
  }

  const api = {
    applyFactsToMetadata,
    blankMetadata,
    cleanValue,
    collectFactsFromDocument,
    collectFactsFromHtml,
    detectSource,
    extractFromDocument,
    fixTypography,
    normalizeMetadata,
    normalizeSpaces,
    parseFixtureHtml,
    parsePages,
    parseVolumeIssue,
    parseYear,
    removeNonKoreanParen,
    splitAuthors,
    splitTitle,
    stripTags
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.PaperRenameMetadata = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
