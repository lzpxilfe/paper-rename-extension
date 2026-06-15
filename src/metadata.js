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
        const wordHyphen = delimiter === "-" && /[A-Za-z0-9가-힣]/.test(raw.charAt(index - 1)) && /[A-Za-z0-9가-힣]/.test(raw.charAt(index + 1));
        if (!insideBrackets && !numberHyphen && !wordHyphen) {
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
    // vol./no. 패턴 — 이전에 safeVol/volNo로 이중 정의되어 volNo가 safeVol을 덮어새는 버그가 있었음 — 하나로 통합
    const matchVol     = text.match(/vol\.?\s*([0-9A-Za-z\uac00-\ud7a3.-]+)/i);
    const matchNo      = text.match(/no\.?\s*([0-9A-Za-z\uac00-\ud7a3.-]+)/i);
    const matchKorean  = text.match(/(\d+)\s*\uad8c\s*(?:(\d+)\s*\ud638)?/);
    const compact      = text.match(/(\d+)\s*\(\s*(\d+)\s*\)/);
    const koreanVolume = text.match(/(?:\uc81c\s*)?(\d+)\s*(?:\uad8c|\uc9d1|\ud638)/);
    const koreanIssue  = text.match(/(?:\uc81c\s*)?\d+\s*(?:\uad8c|\uc9d1)\s*(?:\uc81c\s*)?(\d+)\s*\ud638/);

    if (matchVol) {
      volume = matchVol[1].replace(/[-,.;]+$/g, "");
    }
    if (matchKorean) {
      volume = volume || matchKorean[1];
      issue  = issue  || matchKorean[2] || "";
    }
    if (matchNo && matchNo[1] !== "-") {
      issue = issue || matchNo[1].replace(/[-,.;]+$/g, "");
    }
    if (!volume && compact) {
      volume = compact[1];
      issue  = compact[2];
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
    if (/(?:Copyright|rights\s*reserved|KERIS|학술연구|대국민\s*서비스)/i.test(text)) {
      return "";
    }
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

  function directTextAfter(element) {
    if (!element) {
      return "";
    }
    const parts = [];
    let next = element.nextSibling;
    while (next) {
      if (next.nodeType === 3) { // TEXT_NODE
        parts.push(next.nodeValue);
      } else if (next.nodeType === 1) { // ELEMENT_NODE
        const tagName = (next.tagName || "").toLowerCase();
        if (/^(a|span|i|b|strong|em|font)$/.test(tagName)) {
          parts.push(next.textContent || next.innerText || "");
        } else {
          break;
        }
      }
      next = next.nextSibling;
    }
    return cleanValue(parts.join(" "));
  }

  // 한 필드 값의 합리적 최대 길이 — 이 이상이면 DOM 서브트리(연구분야·초록 등) 오염으로 간주해 건너뜀
  const FACTS_MAX_VALUE_LENGTH = 100;

  function collectFactsFromDocument(doc) {
    const facts = {};

    qAll(doc, "tr").forEach((row) => {
      const cells = qAll(row, "th, td");
      if (cells.length >= 2) {
        const label = cleanLabel(textOf(cells[0]));
        const value = textOf(cells.slice(1).map(textOf).join(" "));
        if (label && value && value.length <= FACTS_MAX_VALUE_LENGTH && !facts[label]) {
          facts[label] = value;
        }
      }
    });

    qAll(doc, "dt, th").forEach((labelElement) => {
      const label = cleanLabel(textOf(labelElement));
      const value = textOf(nextValueElement(labelElement));
      if (label && value && value.length <= FACTS_MAX_VALUE_LENGTH && !facts[label]) {
        facts[label] = value;
      }
    });

    qAll(doc, "li").forEach((item) => {
      const strong = q(item, "span.strong, strong, b, em");
      if (!strong) {
        return;
      }
      const label = cleanLabel(textOf(strong));
      let value = directTextAfter(strong);
      if (!value) {
        const valueEl = nextValueElement(strong);
        value = valueEl
          ? cleanValue(textOf(valueEl))
          : cleanValue(textOf(item).replace(textOf(strong), ""));
      }
      if (label && value && value.length <= FACTS_MAX_VALUE_LENGTH && !facts[label]) {
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

  function parseThesisDetails(value) {
    const text = cleanValue(value);
    if (!text) {
      return { institution: "", department: "", degree: "" };
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
      degree = "박사학위논문";
    } else if (/\uc11d\uc0ac/.test(degreeSource)) {
      degree = "석사학위논문";
    } else if (/\ud559\uc704\ub17c\ubb38/.test(degreeSource)) {
      degree = degreeSource;
    }
    return { institution, department, degree };
  }

  function formatThesisPublisher(value) {
    const parsed = parseThesisDetails(value);
    return [parsed.institution, parsed.department, parsed.degree].filter(Boolean).join(" ");
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

  function parseGoogleScholarMetaTags(doc) {
    const out = {};
    const title = metaContent(doc, ["meta[name='citation_title']", "meta[property='citation_title']"]);
    if (title && isUsableTitle(title)) {
      Object.assign(out, splitTitle(title));
    }
    const authors = qAll(doc, "meta[name='citation_author'], meta[property='citation_author']")
      .map((el) => cleanValue(el && el.getAttribute && el.getAttribute("content")))
      .filter(Boolean);
    if (authors.length) {
      out.authors = splitAuthors(authors.join(";"));
    }
    const journal = metaContent(doc, ["meta[name='citation_journal_title']", "meta[property='citation_journal_title']"]);
    if (journal) {
      out.journalName = removeNonKoreanParen(journal);
    }
    const publisher = metaContent(doc, ["meta[name='citation_publisher']", "meta[property='citation_publisher']"]);
    if (publisher) {
      out.publisher = removeNonKoreanParen(publisher);
    }
    const date = metaContent(doc, ["meta[name='citation_publication_date']", "meta[property='citation_publication_date']", "meta[name='citation_date']"]);
    if (date) {
      const year = parseYear(date);
      if (year) {
        out.year = year;
      }
    }
    const volume = metaContent(doc, ["meta[name='citation_volume']", "meta[property='citation_volume']"]);
    if (volume) {
      out.volume = volume;
    }
    const issue = metaContent(doc, ["meta[name='citation_issue']", "meta[property='citation_issue']"]);
    if (issue) {
      out.issue = issue;
    }
    const firstpage = metaContent(doc, ["meta[name='citation_firstpage']", "meta[property='citation_firstpage']"]);
    if (firstpage) {
      out.pageFirst = firstpage;
    }
    const lastpage = metaContent(doc, ["meta[name='citation_lastpage']", "meta[property='citation_lastpage']"]);
    if (lastpage) {
      out.pageLast = lastpage;
    }
    return out;
  }

  function parseGoogleScholarMetaTagsFromHtml(html) {
    const out = {};
    const title = firstHtmlText(html, [
      /<meta[^>]+(?:name|property)=["']citation_title["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']citation_title["']/i
    ]);
    if (title && isUsableTitle(title)) {
      Object.assign(out, splitTitle(title));
    }
    const authorPattern = /<meta[^>]+(?:name|property)=["']citation_author["'][^>]+content=["']([^"']+)["']/gi;
    const authorPatternAlt = /<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']citation_author["']/gi;
    const authors = [];
    let match;
    while ((match = authorPattern.exec(html))) {
      authors.push(cleanValue(match[1]));
    }
    authorPatternAlt.lastIndex = 0;
    while ((match = authorPatternAlt.exec(html))) {
      authors.push(cleanValue(match[1]));
    }
    if (authors.length) {
      out.authors = splitAuthors(authors.join(";"));
    }
    const journal = firstHtmlText(html, [
      /<meta[^>]+(?:name|property)=["']citation_journal_title["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']citation_journal_title["']/i
    ]);
    if (journal) {
      out.journalName = removeNonKoreanParen(journal);
    }
    const publisher = firstHtmlText(html, [
      /<meta[^>]+(?:name|property)=["']citation_publisher["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']citation_publisher["']/i
    ]);
    if (publisher) {
      out.publisher = removeNonKoreanParen(publisher);
    }
    const date = firstHtmlText(html, [
      /<meta[^>]+(?:name|property)=["'](?:citation_publication_date|citation_date)["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:citation_publication_date|citation_date)["']/i
    ]);
    if (date) {
      const year = parseYear(date);
      if (year) {
        out.year = year;
      }
    }
    const volume = firstHtmlText(html, [
      /<meta[^>]+(?:name|property)=["']citation_volume["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']citation_volume["']/i
    ]);
    if (volume) {
      out.volume = volume;
    }
    const issue = firstHtmlText(html, [
      /<meta[^>]+(?:name|property)=["']citation_issue["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']citation_issue["']/i
    ]);
    if (issue) {
      out.issue = issue;
    }
    const firstpage = firstHtmlText(html, [
      /<meta[^>]+(?:name|property)=["']citation_firstpage["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']citation_firstpage["']/i
    ]);
    if (firstpage) {
      out.pageFirst = firstpage;
    }
    const lastpage = firstHtmlText(html, [
      /<meta[^>]+(?:name|property)=["']citation_lastpage["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']citation_lastpage["']/i
    ]);
    if (lastpage) {
      out.pageLast = lastpage;
    }
    return out;
  }

  function extractFromJsonLdObject(obj) {
    if (!obj) return null;
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const res = extractFromJsonLdObject(item);
        if (res && (res.titleMain || res.authors.length || res.journalName)) {
          return res;
        }
      }
      return null;
    }
    if (obj["@graph"] && Array.isArray(obj["@graph"])) {
      return extractFromJsonLdObject(obj["@graph"]);
    }

    const out = {};
    const headline = obj.headline || obj.name;
    if (headline && typeof headline === "string" && isUsableTitle(headline)) {
      Object.assign(out, splitTitle(headline));
    }

    const authors = [];
    const rawAuthor = obj.author;
    if (rawAuthor) {
      const authorList = Array.isArray(rawAuthor) ? rawAuthor : [rawAuthor];
      authorList.forEach((author) => {
        if (typeof author === "string") {
          authors.push(author);
        } else if (author && typeof author === "object") {
          if (typeof author.name === "string") {
            authors.push(author.name);
          } else if (Array.isArray(author.name)) {
            author.name.forEach((n) => {
              if (typeof n === "string") authors.push(n);
            });
          }
        }
      });
    }
    if (authors.length) {
      out.authors = splitAuthors(authors.join(";"));
    }

    const date = obj.datePublished || obj.dateCreated || obj.dateModified;
    if (date) {
      const year = parseYear(String(date));
      if (year) {
        out.year = year;
      }
    }

    const publisher = obj.publisher;
    if (publisher) {
      if (typeof publisher === "string") {
        out.publisher = removeNonKoreanParen(publisher);
      } else if (typeof publisher === "object" && publisher.name) {
        out.publisher = removeNonKoreanParen(publisher.name);
      }
    }

    const isPartOf = obj.isPartOf;
    if (isPartOf) {
      if (typeof isPartOf === "string") {
        out.journalName = removeNonKoreanParen(isPartOf);
      } else if (typeof isPartOf === "object") {
        const partName = isPartOf.name || isPartOf.headline;
        if (partName) {
          out.journalName = removeNonKoreanParen(partName);
        }
      }
    }

    const pageStart = obj.pageStart;
    const pageEnd = obj.pageEnd;
    if (pageStart) {
      out.pageFirst = String(pageStart).replace(/[^\d]/g, "");
    }
    if (pageEnd) {
      out.pageLast = String(pageEnd).replace(/[^\d]/g, "");
    }
    const pagination = obj.pagination;
    if (pagination && (!out.pageFirst || !out.pageLast)) {
      const pages = parsePages(String(pagination));
      if (pages.pageFirst) out.pageFirst = pages.pageFirst;
      if (pages.pageLast) out.pageLast = pages.pageLast;
    }

    return out;
  }

  function parseJsonLd(doc) {
    const scripts = qAll(doc, "script[type='application/ld+json']");
    for (const script of scripts) {
      try {
        const text = script.textContent || script.innerText;
        if (!text) continue;
        const parsed = JSON.parse(text);
        const meta = extractFromJsonLdObject(parsed);
        if (meta && (meta.titleMain || meta.authors.length || meta.journalName || meta.year)) {
          return meta;
        }
      } catch (_e) {
        // ignore
      }
    }
    return {};
  }

  function parseJsonLdFromHtml(html) {
    const pattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = pattern.exec(html))) {
      try {
        const parsed = JSON.parse(match[1]);
        const meta = extractFromJsonLdObject(parsed);
        if (meta && (meta.titleMain || meta.authors.length || meta.journalName || meta.year)) {
          return meta;
        }
      } catch (_e) {
        // ignore
      }
    }
    return {};
  }

  function parseUniversalMetaTags(doc) {
    const out = {};
    const scholar = parseGoogleScholarMetaTags(doc);
    Object.assign(out, scholar);

    const dcTitle = metaContent(doc, ["meta[name='DC.title']", "meta[name='dc.title']", "meta[name='DC.Title']"]);
    if (dcTitle && !out.titleMain) {
      Object.assign(out, splitTitle(dcTitle));
    }
    const dcAuthors = qAll(doc, "meta[name='DC.creator'], meta[name='dc.creator'], meta[name='DC.Creator'], meta[name='DC.author'], meta[name='dc.author']")
      .map((el) => cleanValue(el && el.getAttribute && el.getAttribute("content")))
      .filter(Boolean);
    if (dcAuthors.length && (!out.authors || out.authors.length === 0)) {
      out.authors = splitAuthors(dcAuthors.join(";"));
    }
    const dcPublisher = metaContent(doc, ["meta[name='DC.publisher']", "meta[name='dc.publisher']", "meta[name='DC.Publisher']"]);
    if (dcPublisher && !out.publisher) {
      out.publisher = removeNonKoreanParen(dcPublisher);
    }
    const dcDate = metaContent(doc, ["meta[name='DC.date']", "meta[name='dc.date']", "meta[name='DC.Date']", "meta[name='DC.issued']", "meta[name='dc.issued']"]);
    if (dcDate && !out.year) {
      const year = parseYear(dcDate);
      if (year) {
        out.year = year;
      }
    }
    const dcJournal = metaContent(doc, ["meta[name='DC.relation']", "meta[name='dc.relation']"]);
    if (dcJournal && !out.journalName) {
      out.journalName = removeNonKoreanParen(dcJournal);
    }

    const ogTitle = metaContent(doc, ["meta[property='og:title']", "meta[name='twitter:title']"]);
    if (ogTitle && !out.titleMain && isUsableTitle(ogTitle)) {
      Object.assign(out, splitTitle(ogTitle));
    }
    const ogSiteName = metaContent(doc, ["meta[property='og:site_name']", "meta[name='citation_journal_title']"]);
    if (ogSiteName && !out.journalName) {
      out.journalName = removeNonKoreanParen(ogSiteName);
    }
    const ogPublisher = metaContent(doc, ["meta[property='article:publisher']", "meta[property='og:publisher']"]);
    if (ogPublisher && !out.publisher) {
      out.publisher = removeNonKoreanParen(ogPublisher);
    }
    const ogAuthor = metaContent(doc, ["meta[property='article:author']", "meta[name='author']", "meta[property='og:author']"]);
    if (ogAuthor && (!out.authors || out.authors.length === 0)) {
      out.authors = splitAuthors(ogAuthor);
    }
    const ogDate = metaContent(doc, ["meta[property='article:published_time']", "meta[property='article:modified_time']", "meta[name='pubdate']", "meta[name='publish_date']"]);
    if (ogDate && !out.year) {
      const year = parseYear(ogDate);
      if (year) {
        out.year = year;
      }
    }

    // 일반 SEO 메타 태그 폴백 추가
    const stdAuthor = metaContent(doc, ["meta[name='author']", "meta[name='copyright']", "meta[name='creator']"]);
    if (stdAuthor && (!out.authors || out.authors.length === 0)) {
      out.authors = splitAuthors(stdAuthor);
    }
    const stdPublisher = metaContent(doc, ["meta[name='publisher']"]);
    if (stdPublisher && !out.publisher) {
      out.publisher = removeNonKoreanParen(stdPublisher);
    }
    const stdDate = metaContent(doc, ["meta[name='pubdate']", "meta[name='publish_date']", "meta[name='date']"]);
    if (stdDate && !out.year) {
      const year = parseYear(stdDate);
      if (year) {
        out.year = year;
      }
    }

    return out;
  }

  function parseUniversalMetaTagsFromHtml(html) {
    const out = {};
    const scholar = parseGoogleScholarMetaTagsFromHtml(html);
    Object.assign(out, scholar);

    const dcTitle = firstHtmlText(html, [
      /<meta[^>]+(?:name|property)=["'](?:DC\.title|dc\.title|DC\.Title)["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:DC\.title|dc\.title|DC\.Title)["']/i
    ]);
    if (dcTitle && !out.titleMain) {
      Object.assign(out, splitTitle(dcTitle));
    }
    const dcAuthorPattern = /<meta[^>]+(?:name|property)=["'](?:DC\.creator|dc\.creator|DC\.Creator|DC\.author|dc\.author)["'][^>]+content=["']([^"']+)["']/gi;
    const dcAuthorPatternAlt = /<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:DC\.creator|dc\.creator|DC\.Creator|DC\.author|dc\.author)["']/gi;
    const dcAuthors = [];
    let match;
    while ((match = dcAuthorPattern.exec(html))) {
      dcAuthors.push(cleanValue(match[1]));
    }
    dcAuthorPatternAlt.lastIndex = 0;
    while ((match = dcAuthorPatternAlt.exec(html))) {
      dcAuthors.push(cleanValue(match[1]));
    }
    if (dcAuthors.length && (!out.authors || out.authors.length === 0)) {
      out.authors = splitAuthors(dcAuthors.join(";"));
    }
    const dcPublisher = firstHtmlText(html, [
      /<meta[^>]+(?:name|property)=["'](?:DC\.publisher|dc\.publisher|DC\.Publisher)["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:DC\.publisher|dc\.publisher|DC\.Publisher)["']/i
    ]);
    if (dcPublisher && !out.publisher) {
      out.publisher = removeNonKoreanParen(dcPublisher);
    }
    const dcDate = firstHtmlText(html, [
      /<meta[^>]+(?:name|property)=["'](?:DC\.date|dc\.date|DC\.Date|DC\.issued|dc\.issued)["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:DC\.date|dc\.date|DC\.Date|DC\.issued|dc\.issued)["']/i
    ]);
    if (dcDate && !out.year) {
      const year = parseYear(dcDate);
      if (year) {
        out.year = year;
      }
    }

    const ogTitle = firstHtmlText(html, [
      /<meta[^>]+(?:name|property)=["'](?:og:title|twitter:title)["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:og:title|twitter:title)["']/i
    ]);
    if (ogTitle && !out.titleMain && isUsableTitle(ogTitle)) {
      Object.assign(out, splitTitle(ogTitle));
    }
    const ogSiteName = firstHtmlText(html, [
      /<meta[^>]+(?:name|property)=["'](?:og:site_name|citation_journal_title)["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:og:site_name|citation_journal_title)["']/i
    ]);
    if (ogSiteName && !out.journalName) {
      out.journalName = removeNonKoreanParen(ogSiteName);
    }
    const ogPublisher = firstHtmlText(html, [
      /<meta[^>]+(?:name|property)=["'](?:article:publisher|og:publisher)["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:article:publisher|og:publisher)["']/i
    ]);
    if (ogPublisher && !out.publisher) {
      out.publisher = removeNonKoreanParen(ogPublisher);
    }
    const ogAuthor = firstHtmlText(html, [
      /<meta[^>]+(?:name|property)=["'](?:article:author|author|og:author)["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:article:author|author|og:author)["']/i
    ]);
    if (ogAuthor && (!out.authors || out.authors.length === 0)) {
      out.authors = splitAuthors(ogAuthor);
    }
    const ogDate = firstHtmlText(html, [
      /<meta[^>]+(?:name|property)=["'](?:article:published_time|article:modified_time|pubdate|publish_date)["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:article:published_time|article:modified_time|pubdate|publish_date)["']/i
    ]);
    if (ogDate && !out.year) {
      const year = parseYear(ogDate);
      if (year) {
        out.year = year;
      }
    }

    // 일반 SEO 메타 태그 폴백 추가 (HTML)
    const stdAuthor = firstHtmlText(html, [
      /<meta[^>]+(?:name|property)=["'](?:author|copyright|creator)["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:author|copyright|creator)["']/i
    ]);
    if (stdAuthor && (!out.authors || out.authors.length === 0)) {
      out.authors = splitAuthors(stdAuthor);
    }
    const stdPublisher = firstHtmlText(html, [
      /<meta[^>]+(?:name|property)=["'](?:publisher)["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:publisher)["']/i
    ]);
    if (stdPublisher && !out.publisher) {
      out.publisher = removeNonKoreanParen(stdPublisher);
    }
    const stdDate = firstHtmlText(html, [
      /<meta[^>]+(?:name|property)=["'](?:pubdate|publish_date|date)["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:pubdate|publish_date|date)["']/i
    ]);
    if (stdDate && !out.year) {
      const year = parseYear(stdDate);
      if (year) {
        out.year = year;
      }
    }

    return out;
  }

  function applyFactsToMetadata(meta, facts) {
    const next = Object.assign({}, meta || {});

    // 레이블 목록: fallback 변수를 비코드(\uXXXX)로 중복 정의하던 방식 제거 — 유일한 레이블 목록으로 통합
    const authors     = valueByLabels(facts, ["\uc800\uc790", "\uc5f0\uad6c\uc790", "Authors", "Author"]);
    const journal     = valueByLabels(facts, ["\ud559\uc220\uc9c0\uba85", "\ud559\uc220\uc9c0", "\uac04\ud589\ubb3c\uba85", "\ub17c\ubb38\uc9d1", "\ub17c\ubb38\uc9c0", "\uc800\ub110/\ud504\ub85c\uc2dc\ub529\uba85", "Journal", "Journal/Proceedings"]);
    const publisher   = valueByLabels(facts, ["\ubc1c\ud589\uae30\uad00", "\ucd9c\ud310\uc0ac", "\ubc1c\ud589\ucc98", "\ubc1c\ud589\ucc98\uba85", "\uc18c\uc18d\uae30\uad00", "Publisher"]);
    const year        = valueByLabels(facts, ["\ubc1c\ud589\uc5f0\ub3c4", "\ubc1c\ud589\ub144\ub3c4", "\ubc1c\ud589\ub144", "\uc5f0\ub3c4", "\ud559\uc704\uc218\uc5ec\ub144\uc6d4", "Year", "\ubc1c\ud589\uc77c", "\uac8c\uc7ac\ub144\uc6d4", "\ubc1c\uac04\ub144\uc6d4", "Published"]);
    const pages       = valueByLabels(facts, ["\uc218\ub85d\uba74", "\ud398\uc774\uc9c0", "\ucabd\uc218", "Pages", "Page"]);
    const pageFirst   = valueByLabels(facts, ["\uc2dc\uc791\ud398\uc774\uc9c0", "\uc2dc\uc791 \ud398\uc774\uc9c0", "Start Page", "First Page"]);
    const pageLast    = valueByLabels(facts, ["\ub05d\ud398\uc774\uc9c0", "\ub05d \ud398\uc774\uc9c0", "End Page", "Last Page"]);
    const volumeIssue = valueByLabels(facts, ["\uad8c\ud638\uc0ac\ud56d", "\uad8c\ud638", "Volume", "Issue"]);
    const volume      = valueByLabels(facts, ["\uad8c", "Volume", "Vol"]);
    const issue       = valueByLabels(facts, ["\ud638", "Issue", "No"]);
    const title       = valueByLabels(facts, ["\ub17c\ubb38\uba85", "\ub17c\ubb38\uc81c\ubaa9", "\ud559\uc704\ub17c\ubb38\uba85", "\uc81c\ubaa9", "Title"]);
    // \ud559\uc704\ub17c\ubb38\uc0ac\ud56d\uc740 \ubc1c\ud589\uae30\uad00\u00b7\uc5f0\ub3c4\ub97c \ubcf5\ud569\uc73c\ub85c \ub2f4\uc73c\ubbc0\ub85c \ub2e4\ub978 \ud544\ub4dc\uc640 \ubd84\ub9ac \ud30c\uc2f1
    const thesisInfo  = valueByLabels(facts, ["\ud559\uc704\ub17c\ubb38\uc0ac\ud56d", "\ud559\uc704\ub17c\ubb38 \uc0ac\ud56d"]);

    if (!next.authors.length && authors) {
      next.authors = splitAuthors(authors);
    }
    if (!next.journalName && journal) {
      next.journalName = journal;
    }
    if (thesisInfo) {
      const parsedThesis = parseThesisDetails(thesisInfo);
      next.thesisInstitution = parsedThesis.institution;
      next.thesisDept = parsedThesis.department;
      next.thesisDegree = parsedThesis.degree;
      next.publisher = [parsedThesis.institution, parsedThesis.department, parsedThesis.degree]
        .filter(Boolean).join(" ");
    } else if (!next.publisher && publisher) {
      next.publisher = removeNonKoreanParen(publisher);
    }
    if (!next.year && (year || thesisInfo)) {
      next.year = parseYear(year || thesisInfo);
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
      next.issue  = next.issue  || parsed.issue;
    }
    if (volume && !next.volume) {
      next.volume = normalizeSpaces(volume).replace(/[^\dA-Za-z\uac00-\ud7a3.-]/g, "");
    }
    if (issue && !next.issue) {
      next.issue = normalizeSpaces(issue).replace(/[^\dA-Za-z\uac00-\ud7a3.-]/g, "");
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
      pageUrl: pageUrl || "",
      thesisInstitution: "",
      thesisDept: "",
      thesisDegree: ""
    };
  }

  function isAcademicMainPage(url) {
    if (!url) return false;
    try {
      const parsed = new URL(url);
      const host = parsed.hostname;
      const path = parsed.pathname.toLowerCase();
      if (/riss/i.test(host) && (path === "/" || path === "/index.do")) return true;
      if (/dbpia/i.test(host) && (path === "/" || path === "/index.do")) return true;
      if (/kiss.*kstudy/i.test(host) && (path === "/" || path === "/index" || path === "/index.do")) return true;
      if (/kci\.go\.kr/i.test(host) && (path === "/" || path === "/kciportal/main.kci" || path === "/kciportal/land.kci")) return true;
      if (/earticle/i.test(host) && (path === "/" || path === "/index.html")) return true;
      if (/scholar.*kyobobook/i.test(host) && (path === "/" || path === "/main.ink")) return true;
      if (/scienceon/i.test(host) && (path === "/" || path === "/main/mainform.do")) return true;
      if (/scholar\.google/i.test(host) && (path === "/" || path === "/schhp")) return true;
      if (path === "/" || path === "/index.html" || path === "/index.do" || path === "/main.do") {
        return true;
      }
    } catch (_e) {}
    return false;
  }

  function detectSource(url) {
    let parsed;
    try {
      parsed = new URL(url || (global.location && global.location.href) || "");
    } catch (_error) {
      return SOURCES.UNKNOWN || "unknown";
    }
    const host = parsed.hostname;
    if (/riss/i.test(host)) {
      return SOURCES.RISS;
    }
    if (/kci\.go\.kr/i.test(host) && /\/kciportal\//i.test(parsed.pathname)) {
      return SOURCES.KCI;
    }
    if (/kiss.*kstudy/i.test(host) && /\/Detail/i.test(parsed.pathname)) {
      return SOURCES.KISS;
    }
    if (/dbpia/i.test(host) && /\/journal\/(?:articleDetail|detail)/i.test(parsed.pathname)) {
      return SOURCES.DBPIA;
    }
    if (/earticle/i.test(host) && /\/Article\//i.test(parsed.pathname)) {
      return SOURCES.EARTICLE;
    }
    if (/scholar.*kyobobook/i.test(host)) {
      return SOURCES.SCHOLAR;
    }
    if (/koreascience/i.test(host)) {
      return SOURCES.KOREASCIENCE;
    }
    if (/scienceon/i.test(host)) {
      return SOURCES.SCIENCEON;
    }
    if (/krm\.or\.kr/i.test(host)) {
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
    if (/(?:Copyright|rights\s*reserved|KERIS|학술연구정보서비스|대국민\s*서비스|국내·국외\s*학술정보)/i.test(text)) {
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
    if (/^(구분|순서|번호|목록|선택|기능|열기|닫기|보기|상세|정보|검색)$/.test(text)) {
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
    const publisher = source.match(/발행기관\s*:\s*(.+?)(?=\s*(?:연구분야|저자|초록|키워드|학술지명|발행년도|페이지|권호|원문|피인용|참고문헌|목차|음성|$))/i);
    if (publisher && !out.publisher) {
      const val = cleanValue(publisher[1]);
      if (val.length <= 100) {
        out.publisher = val;
      }
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
    let parts = [];
    const pipeLine = lines.find((line) => line.includes("|"));
    if (pipeLine) {
      parts = pipeLine.split("|").map(cleanValue).filter(Boolean);
      if (parts.length) {
        out.authors = splitAuthors(parts[0]);
      }
    } else if (joined.length <= 50) {
      parts = joined.split("|").map(cleanValue).filter(Boolean);
      if (parts.length) {
        out.authors = splitAuthors(parts[0]);
      }
    }
    if (source === SOURCES.RISS && (!out.authors.length || !out.year || !out.publisher)) {
      const titleIndex = title ? lines.indexOf(title) : -1;
      const metadataLine = lines
        .slice(titleIndex >= 0 ? titleIndex + 1 : 0)
        .find((line) => parseYear(line) && /[\uac00-\ud7a3]/.test(line)) || "";
      const year = parseYear(metadataLine);
      const beforeYear = year ? metadataLine.split(year)[0] : metadataLine;
      const tokens = beforeYear.split(/\s+/).map(cleanValue).filter((token) => token && token !== "|");
      const institutionIndex = tokens.findIndex((token) => /(?:\ub300\ud559\uad50|\ub300\ud559\uc6d0|\ud559\ud68c|\uc5f0\uad6c\uc18c|\ubc15\ubb3c\uad00)/.test(token));
      const suspiciousAuthors = out.authors.join(" ");
      const shouldReplaceAuthors = !out.authors.length || /(?:RISS|\uac80\uc0c9|\ud559\uc704\ub17c\ubb38|\uad6d\ub0b4\ud559\uc220\ub17c\ubb38)/i.test(suspiciousAuthors);
      if (shouldReplaceAuthors && institutionIndex > 0) {
        out.authors = splitAuthors(tokens.slice(0, institutionIndex).join(";"));
      }
      if (!out.publisher && institutionIndex >= 0) {
        out.publisher = tokens.slice(institutionIndex).join(" ").replace(/\s*\|\s*$/g, "");
      }
      if (!out.year && year) {
        out.year = year;
      }
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
    if (!doc) {
      return meta;
    }
    if (isAcademicMainPage(pageUrl)) {
      return meta;
    }

    const jsonLdMeta = parseJsonLd(doc);
    meta = mergePreferExtra(meta, jsonLdMeta);

    const universalMeta = parseUniversalMetaTags(doc);
    meta = mergePreferExtra(meta, universalMeta);

    const facts = collectFactsFromDocument(doc);
    meta = applyFactsToMetadata(meta, facts);
    if (source === SOURCES.KCI) {
      meta = mergePreferExtra(meta, parseKciDom(doc));
      meta = mergePreferExtra(meta, parseKciCitationText(textOf(doc.body || doc.documentElement || doc)));
    }
    if (!meta.titleMain) {
      Object.assign(meta, extractTitle(doc, source));
    }
    if (!meta.titleMain) {
      const docTitle = cleanValue(doc.title);
      if (isUsableTitle(docTitle)) {
        Object.assign(meta, splitTitle(docTitle));
      }
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
      "pageUrl",
      "thesisInstitution",
      "thesisDept",
      "thesisDegree"
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
        if (label && value && value.length <= FACTS_MAX_VALUE_LENGTH && !facts[label]) {
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

    const jsonLdMeta = parseJsonLdFromHtml(html);
    meta = mergePreferExtra(meta, jsonLdMeta);

    const universalMeta = parseUniversalMetaTagsFromHtml(html);
    meta = mergePreferExtra(meta, universalMeta);
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
    parseJsonLd,
    parseJsonLdFromHtml,
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
