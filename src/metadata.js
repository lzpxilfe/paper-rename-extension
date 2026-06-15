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
    const safeVol = text.match(/vol\.?\s*([0-9A-Za-z\uac00-\ud7a3-]+)/i);
    const safeNo = text.match(/no\.?\s*([0-9A-Za-z\uac00-\ud7a3-]+)/i);
    const safeKorean = text.match(/(\d+)\s*\uad8c\s*(?:(\d+)\s*\ud638)?/);
    const volNo = text.match(/Vol\.?\s*([0-9A-Za-z가-힣.-]+)/i);
    const no = text.match(/No\.?\s*([0-9A-Za-z가-힣.-]+)/i);
    const compact = text.match(/(\d+)\s*\(\s*(\d+)\s*\)/);
    const koreanVolume = text.match(/(?:제\s*)?(\d+)\s*(?:권|집|호)/);
    const koreanIssue = text.match(/(?:제\s*)?\d+\s*(?:권|집)\s*(?:제\s*)?(\d+)\s*호/);

    if (safeVol) {
      volume = safeVol[1].replace(/[-,.;]+$/g, "");
    }
    if (safeNo) {
      issue = safeNo[1].replace(/[-,.;]+$/g, "");
    }
    if (safeKorean) {
      volume = volume || safeKorean[1];
      issue = issue || safeKorean[2] || "";
    }
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
    const robustText = removeNonKoreanParen(fixTypography(value))
      .replace(/\s+\d+$/g, "")
      .replace(/\s+\d+\s*\uba85/g, "")
      .replace(/\s*\/\s*/g, ";")
      .replace(/\s+and\s+/ig, ";")
      .replace(/[\u00b7\u318d;]+/g, ";");
    const robustPieces = robustText
      .split(/;|,|\n|\r/)
      .map(cleanAuthorName)
      .filter(Boolean);
    if (robustPieces.length) {
      return uniqueValues(robustPieces);
    }
    const text = removeNonKoreanParen(fixTypography(value))
      .replace(/\s+외\s+\d+\s*명/g, "")
      .replace(/\s*\/\s*/g, ";")
      .replace(/\s+and\s+/ig, ";")
      .replace(/[;；]/g, ";");
    const pieces = text.split(/;|ㆍ|·|\n|\r/).map(cleanAuthorName).filter(Boolean);
    if (pieces.length > 1) {
      return uniqueValues(pieces);
    }
    const commaPieces = text.split(/\s*,\s*/).map(cleanAuthorName).filter(Boolean);
    return commaPieces.length > 1 ? uniqueValues(commaPieces) : (text ? uniqueValues([cleanAuthorName(text)]) : []);
  }

  function cleanAuthorName(value) {
    let text = cleanValue(value)
      .replace(/\s+\d+$/g, "")
      .replace(/\s*\^\{\d+\}\s*$/g, "");
    const koreanSafe = text.match(/[\uac00-\ud7a3]{2,}(?:\s*[\u00b7\u318d]\s*[\uac00-\ud7a3]{2,})*/);
    if (koreanSafe) {
      text = koreanSafe[0];
    }
    const korean = text.match(/[가-힣]{2,}(?:\s*[·ㆍ]\s*[가-힣]{2,})*/);
    if (korean) {
      text = korean[0];
    }
    return cleanValue(text);
  }

  function uniqueValues(values) {
    const seen = new Set();
    const output = [];
    values.forEach((value) => {
      const cleaned = cleanValue(value);
      const key = cleaned.replace(/\s+/g, "").toLowerCase();
      if (!cleaned || seen.has(key)) {
        return;
      }
      seen.add(key);
      output.push(cleaned);
    });
    return output;
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

  function formatThesisPublisher(value) {
    const text = cleanValue(value);
    if (!text) {
      return "";
    }
    const parts = text
      .split(/--|,|\||;/)
      .map(cleanValue)
      .filter(Boolean);
    let institution = parts.find((part) => /[\uac00-\ud7a3]*(?:\ub300\ud559\uad50|\ub300\ud559\uc6d0|\uc5f0\uad6c\uc6d0)/.test(part)) || parts[0] || "";
    const institutionParts = institution.split(/\s+/).filter(Boolean);
    if (institutionParts.length >= 2 && /\ub300\ud559\uad50$/.test(institutionParts[0]) && /\ub300\ud559\uc6d0$/.test(institutionParts[1])) {
      institution = institutionParts[0];
    }
    const department = parts.find((part) =>
      part !== institution &&
      !parseYear(part) &&
      /(?:\ud559\uacfc|\uc804\uacf5|\ud559\ubd80|\uacc4\uc5f4)/.test(part)
    ) || "";
    const degreeSource = parts.find((part) => /(?:\uc11d\uc0ac|\ubc15\uc0ac|\ud559\uc704\ub17c\ubb38)/.test(part)) || "";
    let degree = "";
    if (/\ubc15\uc0ac/.test(degreeSource)) {
      degree = "\ubc15\uc0ac\ud559\uc704\ub17c\ubb38";
    } else if (/\uc11d\uc0ac/.test(degreeSource)) {
      degree = "\uc11d\uc0ac\ud559\uc704\ub17c\ubb38";
    } else if (/\ud559\uc704\ub17c\ubb38/.test(degreeSource)) {
      degree = degreeSource;
    }
    return [institution, department, degree].map(cleanValue).filter(Boolean).join(" ");
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

  function parseKciVolumeText(value) {
    const text = cleanValue(value);
    const out = Object.assign({}, parseVolumeIssue(text), parsePages(text));
    const year = parseYear(text);
    if (year) {
      out.year = year;
    }
    return out;
  }

  function parseKciDom(doc) {
    const out = {};
    const title = firstText(doc, [
      "#artiTitle",
      "[id='artiTitle']",
      ".article-title",
      "meta[name='citation_title']",
      "meta[property='citation_title']"
    ]);
    if (isUsableTitle(title)) {
      Object.assign(out, splitTitle(title));
    }

    const authorText = qAll(doc, ".author a, .author, [class*='author'] a")
      .map(textOf)
      .filter(Boolean)
      .join(";");
    const authors = splitAuthors(authorText);
    if (authors.length) {
      out.authors = authors;
    }

    const journal = firstText(doc, [
      ".journalInfo .jounal a",
      ".journalInfo .journal a",
      ".journalInfo [class*='jounal'] a",
      ".journalInfo [class*='journal'] a",
      "meta[name='citation_journal_title']"
    ]);
    if (journal) {
      out.journalName = removeNonKoreanParen(journal);
    }

    const volText = firstText(doc, [
      ".journalInfo .vol",
      ".journalInfo [class*='vol']",
      ".journalInfo"
    ]);
    Object.assign(out, parseKciVolumeText(volText));

    const publisher = firstText(doc, [
      ".journalInfo .pub a",
      ".journalInfo [class*='pub'] a",
      "meta[name='citation_publisher']"
    ]);
    if (publisher) {
      out.publisher = removeNonKoreanParen(publisher);
    }

    return out;
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

    const authorsFallback = valueByLabels(facts, ["\uc800\uc790", "\uc5f0\uad6c\uc790", "Authors", "Author"]);
    const journalFallback = valueByLabels(facts, ["\ud559\uc220\uc9c0\uba85", "\ud559\uc220\uc9c0", "\uac04\ud589\ubb3c\uba85", "\ub17c\ubb38\uc9c0", "Journal"]);
    const publisherFallback = valueByLabels(facts, ["\ubc1c\ud589\uae30\uad00", "\ucd9c\ud310\uc0ac", "\ubc1c\ud589\ucc98", "\uc18c\uc18d\uae30\uad00", "Publisher"]);
    const thesisInfoFallback = valueByLabels(facts, ["\ud559\uc704\ub17c\ubb38\uc0ac\ud56d", "\ud559\uc704\ub17c\ubb38 \uc0ac\ud56d"]);
    const yearFallback = valueByLabels(facts, ["\ubc1c\ud589\ub144\ub3c4", "\ubc1c\ud589\uc5f0\ub3c4", "\ubc1c\ud589\uc77c", "\uc5f0\ub3c4", "\ud559\uc704\uc218\uc5ec\ub144\uc6d4", "Year"]);
    const pagesFallback = valueByLabels(facts, ["\uc218\ub85d\uba74", "\ud398\uc774\uc9c0", "\ucabd\uc218", "Pages", "Page"]);
    const pageFirstFallback = valueByLabels(facts, ["\uc2dc\uc791\ud398\uc774\uc9c0", "\uc2dc\uc791 \ud398\uc774\uc9c0", "Start Page", "First Page"]);
    const pageLastFallback = valueByLabels(facts, ["\ub05d\ud398\uc774\uc9c0", "\ub05d \ud398\uc774\uc9c0", "End Page", "Last Page"]);
    const volumeIssueFallback = valueByLabels(facts, ["\uad8c\ud638\uc0ac\ud56d", "\uad8c\ud638", "Volume", "Issue"]);
    const volumeFallback = valueByLabels(facts, ["\uad8c", "Volume", "Vol"]);
    const issueFallback = valueByLabels(facts, ["\ud638", "Issue", "No"]);
    const titleFallback = valueByLabels(facts, ["\ub17c\ubb38\uba85", "\ub17c\ubb38\uc81c\ubaa9", "\ud559\uc704\ub17c\ubb38\uba85", "\uc81c\ubaa9", "Title"]);

    if (!next.authors.length && (authors || authorsFallback)) {
      next.authors = splitAuthors(authors || authorsFallback);
    }
    if (!next.journalName && (journal || journalFallback)) {
      next.journalName = journal || journalFallback;
    }
    if (!next.publisher && (publisher || publisherFallback || thesisInfoFallback)) {
      next.publisher = thesisInfoFallback
        ? formatThesisPublisher(thesisInfoFallback)
        : removeNonKoreanParen(publisher || publisherFallback);
    }
    if (!next.year && (year || yearFallback || thesisInfoFallback)) {
      next.year = parseYear(year || yearFallback || thesisInfoFallback);
    }
    if (pages || pagesFallback) {
      Object.assign(next, parsePages(pages || pagesFallback));
    }
    if ((pageFirst || pageFirstFallback) && !next.pageFirst) {
      next.pageFirst = normalizeSpaces(pageFirst || pageFirstFallback).replace(/[^\d]/g, "");
    }
    if ((pageLast || pageLastFallback) && !next.pageLast) {
      next.pageLast = normalizeSpaces(pageLast || pageLastFallback).replace(/[^\d]/g, "");
    }
    if (volumeIssue || volumeIssueFallback) {
      const parsed = parseVolumeIssue(volumeIssue || volumeIssueFallback);
      next.volume = next.volume || parsed.volume;
      next.issue = next.issue || parsed.issue;
    }
    if (volume && !next.volume) {
      next.volume = normalizeSpaces(volume).replace(/[^\dA-Za-z가-힣.-]/g, "");
    }
    if (issue && !next.issue) {
      next.issue = normalizeSpaces(issue).replace(/[^\dA-Za-z가-힣.-]/g, "");
    }
    if (volumeFallback && !next.volume) {
      next.volume = normalizeSpaces(volumeFallback).replace(/[^\dA-Za-z\uac00-\ud7a3-]/g, "");
    }
    if (issueFallback && !next.issue) {
      next.issue = normalizeSpaces(issueFallback).replace(/[^\dA-Za-z\uac00-\ud7a3-]/g, "");
    }
    if (!next.titleMain && (title || titleFallback)) {
      Object.assign(next, splitTitle(title || titleFallback));
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
    if (/riss/i.test(host)) {
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
      KCI: ["#artiTitle", ".article-title", "h3", "h2"],
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
    const candidates = selectors
      .filter((selector) => !selector.startsWith("meta"))
      .map((selector) => firstText(doc, [selector]))
      .concat([metaTitle, cleanValue(doc && doc.title)])
      .filter(Boolean);
    const title = candidates.find((candidate) => isUsableTitle(candidate)) || "";
    return splitTitle(title.replace(/\s*-\s*(RISS|KCI|KISS|DBpia|eArticle|교보문고|스콜라|KoreaScience|ScienceON|KRM).*$/i, ""));
  }

  function isUsableTitle(value) {
    const text = cleanValue(value);
    if (/(?:RISS\s*\uac80\uc0c9|\ud1b5\ud569\uac80\uc0c9|\uac80\uc0c9\uacb0\uacfc|KCI\s*\uc6d0\ubb38|\ub17c\ubb38\uc815\ubcf4|\ucd08\ub85d\s*\uc5f4\uae30\s*\ub2eb\uae30\s*\ubc84\ud2bc|\uc6d0\ubb38\s*\ub0b4\ub824\ubc1b\uae30)/i.test(text)) {
      return false;
    }
    if (text.length < 4 || text.length > 180) {
      return false;
    }
    if (/^(초록|키워드|논문정보|참고문헌|인용현황|원문\s*찾아보기|Download|Loading)$/i.test(text)) {
      return false;
    }
    if (/(열기|닫기)\s*버튼/.test(text)) {
      return false;
    }
    return /[가-힣A-Za-z0-9]/.test(text);
  }

  function mergePreferExisting(base, extra) {
    const next = Object.assign({}, base || {});
    Object.entries(extra || {}).forEach(([key, value]) => {
      if (key === "authors") {
        const authors = Array.isArray(value) ? value : splitAuthors(value);
        if ((!next.authors || next.authors.length === 0) && authors.length) {
          next.authors = authors;
        }
        return;
      }
      if ((next[key] === undefined || next[key] === "") && value) {
        next[key] = value;
      }
    });
    return next;
  }

  function mergePreferExtra(base, extra) {
    const next = Object.assign({}, base || {});
    Object.entries(extra || {}).forEach(([key, value]) => {
      if (key === "authors") {
        const authors = Array.isArray(value) ? value : splitAuthors(value);
        if (authors.length) {
          next.authors = authors;
        }
        return;
      }
      if (value) {
        next[key] = value;
      }
    });
    return next;
  }

  function parseKciCitationText(text) {
    const source = String(text || "");
    const out = {};
    const bib = {
      author: source.match(/author=\{([^}]+)\}/i),
      title: source.match(/title=\{([^}]+)\}/i),
      journal: source.match(/journal=\{([^}]+)\}/i),
      year: source.match(/year=\{([^}]+)\}/i),
      number: source.match(/number=\{([^}]+)\}/i),
      pages: source.match(/pages=\{([^}]+)\}/i)
    };
    if (bib.author) {
      out.authors = splitAuthors(bib.author[1]);
    }
    if (bib.title) {
      Object.assign(out, splitTitle(bib.title[1]));
    }
    if (bib.journal) {
      out.journalName = cleanValue(bib.journal[1]);
    }
    if (bib.year) {
      out.year = parseYear(bib.year[1]);
    }
    if (bib.number) {
      out.issue = cleanValue(bib.number[1]);
    }
    if (bib.pages) {
      Object.assign(out, parsePages(bib.pages[1]));
    }

    const risMap = [
      ["authors", /(?:^|\n)AU\s*-\s*([^\n<]+)/i],
      ["title", /(?:^|\n)TI\s*-\s*([^\n<]+)/i],
      ["journalName", /(?:^|\n)(?:T2|JO)\s*-\s*([^\n<]+)/i],
      ["year", /(?:^|\n)PY\s*-\s*([^\n<]+)/i],
      ["issue", /(?:^|\n)IS\s*-\s*([^\n<]+)/i],
      ["publisher", /(?:^|\n)PB\s*-\s*([^\n<]+)/i],
      ["pageFirst", /(?:^|\n)SP\s*-\s*([^\n<]+)/i],
      ["pageLast", /(?:^|\n)EP\s*-\s*([^\n<]+)/i]
    ];
    risMap.forEach(([key, pattern]) => {
      const match = source.match(pattern);
      if (!match || out[key]) {
        return;
      }
      const value = cleanValue(match[1]);
      if (key === "authors") {
        out.authors = splitAuthors(value);
      } else if (key === "title") {
        Object.assign(out, splitTitle(value));
      } else if (key === "year") {
        out.year = parseYear(value);
      } else {
        out[key] = value;
      }
    });

    const info = source.match(/(\d{4}),\s*vol\.,\s*no\.([0-9A-Za-z가-힣.-]+),\s*pp\.\s*([0-9]+)\s*-\s*([0-9]+)/i);
    if (info) {
      out.year = out.year || info[1];
      out.issue = out.issue || info[2];
      out.pageFirst = out.pageFirst || info[3];
      out.pageLast = out.pageLast || info[4];
    }
    const publisher = source.match(/발행기관\s*:\s*([^\n]+)/);
    if (publisher && !out.publisher) {
      out.publisher = cleanValue(publisher[1]);
    }
    return out;
  }

  function parseResultText(text, source, pageUrl) {
    const lines = String(text || "")
      .split(/\n|\r|\s{2,}/)
      .map(cleanValue)
      .filter(Boolean)
      .filter((line) => !/^(KCI등재|무료|유료|기관 내 무료|원문보기|목차검색조회|음성듣기|\d+|F|M|W)$/.test(line));

    const joined = lines.join(" | ");
    const out = blankMetadata(source, pageUrl || "");
    const title = lines.find((line) =>
      isUsableTitle(line) &&
      !/^(저자|발행|학술|권호|수록|검색|결과|국내학술논문|학위논문)/.test(line) &&
      !/\s\|\s/.test(line)
    );
    if (title) {
      Object.assign(out, splitTitle(title));
    }
    const pipeLine = lines.find((line) => line.includes("|")) || joined;
    const parts = pipeLine.split("|").map(cleanValue).filter(Boolean);
    if (parts.length) {
      out.authors = splitAuthors(parts[0]);
    }
    const yearPart = parts.find((part) => parseYear(part));
    if (yearPart) {
      out.year = parseYear(yearPart);
    }
    const pagePart = parts.find((part) => /pp\.?\s*\d+|[0-9]+\s*[-~]\s*[0-9]+/.test(part));
    if (pagePart) {
      Object.assign(out, parsePages(pagePart));
    }
    const volPart = parts.find((part) => /(?:Vol\.|No\.|\(\d+\)|\d+\s*권|\d+\s*호)/i.test(part));
    if (volPart) {
      Object.assign(out, parseVolumeIssue(volPart));
    }
    if (parts.length >= 4) {
      const likelyJournal = parts.find((part) => /학보|학회지|연구|논문|저널|Journal|Review/i.test(part));
      out.journalName = likelyJournal || out.journalName;
      if (!out.publisher) {
        out.publisher = parts.find((part) => /학회|대학교|대학원|연구소|박물관|기관/.test(part)) || "";
      }
    } else if (parts.length >= 2 && !out.publisher) {
      out.publisher = parts[1];
    }
    return normalizeMetadata(out);
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
    if (source === SOURCES.KCI) {
      meta = mergePreferExtra(meta, parseKciDom(doc));
      meta = mergePreferExtra(meta, parseKciCitationText(textOf(doc.body || doc.documentElement || doc)));
    }
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
    next.authors = uniqueValues(next.authors.map(cleanAuthorName));
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

  function firstHtmlText(html, patterns) {
    for (const pattern of patterns) {
      const match = String(html || "").match(pattern);
      if (match && match[1]) {
        return stripTags(decodeHtml(match[1]));
      }
    }
    return "";
  }

  function parseKciHtml(html) {
    const out = {};
    const title = firstHtmlText(html, [
      /<[^>]+id=["']artiTitle["'][^>]*>([\s\S]*?)<\/[^>]+>/i,
      /<[^>]+class=["'][^"']*article-title[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i
    ]);
    if (isUsableTitle(title)) {
      Object.assign(out, splitTitle(title));
    }

    const authorBlocks = [];
    const authorPattern = /<[^>]+class=["'][^"']*author[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/gi;
    let authorMatch;
    while ((authorMatch = authorPattern.exec(String(html || "")))) {
      authorBlocks.push(stripTags(decodeHtml(authorMatch[1])));
    }
    const authors = splitAuthors(authorBlocks.join(";"));
    if (authors.length) {
      out.authors = authors;
    }

    const journal = firstHtmlText(html, [
      /<[^>]+class=["'][^"']*jounal[^"']*["'][^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i,
      /<[^>]+class=["'][^"']*journal[^"']*["'][^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i
    ]);
    if (journal) {
      out.journalName = removeNonKoreanParen(journal);
    }

    const volText = firstHtmlText(html, [
      /<[^>]+class=["'][^"']*vol[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i
    ]);
    Object.assign(out, parseKciVolumeText(volText));

    const publisher = firstHtmlText(html, [
      /<[^>]+class=["'][^"']*pub[^"']*["'][^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i
    ]);
    if (publisher) {
      out.publisher = removeNonKoreanParen(publisher);
    }

    return out;
  }

  function parseFixtureHtml(html, url) {
    const source = detectSource(url);
    let meta = blankMetadata(source, url);
    meta = applyFactsToMetadata(meta, collectFactsFromHtml(html));
    if (source === SOURCES.KCI) {
      meta = mergePreferExtra(meta, parseKciHtml(html));
      meta = mergePreferExtra(meta, parseKciCitationText(stripTags(html)));
    }
    if (!meta.titleMain) {
      const htmlTitle = titleFromHtml(html);
      if (isUsableTitle(htmlTitle)) {
        Object.assign(meta, splitTitle(htmlTitle));
      }
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
    cleanAuthorName,
    collectFactsFromDocument,
    collectFactsFromHtml,
    detectSource,
    extractFromDocument,
    fixTypography,
    normalizeMetadata,
    normalizeSpaces,
    parseFixtureHtml,
    parseKciCitationText,
    parsePages,
    parseResultText,
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
