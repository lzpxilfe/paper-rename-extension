(function initCitationModule(global) {
  "use strict";

  function normalizeSpaces(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function stripPdfExtension(value) {
    return String(value || "").replace(/\.pdf$/i, "");
  }

  function compactPunctuation(value) {
    return normalizeSpaces(value)
      .replace(/\s+([,.)\]}])/g, "$1")
      .replace(/([([{])\s+/g, "$1")
      .replace(/(?:,\s*){2,}/g, ", ")
      .replace(/,\s*$/g, "")
      .replace(/^[,\s]+/g, "")
      .trim();
  }

  function asArray(value) {
    if (Array.isArray(value)) {
      return value.map(normalizeSpaces).filter(Boolean);
    }
    const text = normalizeSpaces(value);
    return text ? [text] : [];
  }

  function joinAuthors(authors) {
    return asArray(authors).join("·");
  }

  function titleText(meta) {
    const main = normalizeSpaces(meta && meta.titleMain);
    const sub = normalizeSpaces(meta && meta.titleSub);
    if (!main && !sub) {
      return "";
    }
    const title = sub ? `${main} — ${sub}` : main || sub;
    return `「${stripPdfExtension(title)}」`;
  }

  function journalText(meta) {
    const journal = normalizeSpaces(meta && meta.journalName);
    return journal ? `『${journal}』` : "";
  }

  function volumeIssueText(meta) {
    const volume = normalizeSpaces(meta && meta.volume);
    const issue = normalizeSpaces(meta && meta.issue);
    if (volume && issue) {
      return `${volume}(${issue})`;
    }
    if (volume) {
      return volume;
    }
    if (issue) {
      return `(${issue})`;
    }
    return "";
  }

  function pageRangeText(meta, settings) {
    const includePages = !settings || settings.includePages !== false;
    if (!includePages) {
      return "";
    }
    const first = normalizeSpaces(meta && meta.pageFirst);
    const last = normalizeSpaces(meta && meta.pageLast);
    if (first && last) {
      return `${first}–${last}쪽`;
    }
    if (first) {
      return `${first}쪽`;
    }
    return "";
  }

  function fieldValue(field, meta, settings) {
    const source = meta || {};
    switch (field) {
      case "authors":
        return joinAuthors(source.authors);
      case "year":
        return normalizeSpaces(source.year);
      case "title":
        return titleText(source);
      case "journal":
        return journalText(source);
      case "volumeIssue":
        return volumeIssueText(source);
      case "publisher":
        return normalizeSpaces(source.publisher);
      case "pages":
        return pageRangeText(source, settings);
      case "originalFilename":
        return stripPdfExtension(normalizeSpaces(source.originalFilename));
      default:
        return normalizeSpaces(source[field]);
    }
  }

  function renderFullCitation(meta, settings) {
    const parts = [
      fieldValue("authors", meta, settings),
      fieldValue("title", meta, settings)
    ];
    const journal = fieldValue("journal", meta, settings);
    const volumeIssue = fieldValue("volumeIssue", meta, settings);
    if (journal && volumeIssue) {
      parts.push(`${journal} ${volumeIssue}`);
    } else {
      parts.push(journal || volumeIssue);
    }
    parts.push(
      fieldValue("publisher", meta, settings),
      fieldValue("year", meta, settings),
      fieldValue("pages", meta, settings)
    );
    return compactPunctuation(parts.filter(Boolean).join(", "));
  }

  const api = {
    asArray,
    compactPunctuation,
    fieldValue,
    joinAuthors,
    journalText,
    normalizeSpaces,
    pageRangeText,
    renderFullCitation,
    stripPdfExtension,
    titleText,
    volumeIssueText
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.PaperRenameCitation = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
