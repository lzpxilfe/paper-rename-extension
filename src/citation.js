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
    const values = asArray(authors);
    const hasKorean = values.some((value) => /[\uac00-\ud7a3]/.test(value));
    const preferred = hasKorean ? values.filter((value) => /[\uac00-\ud7a3]/.test(value)) : values;
    return preferred.join("\u00b7");
  }

  function titleText(meta) {
    const main = normalizeSpaces(meta && meta.titleMain);
    const sub = normalizeSpaces(meta && meta.titleSub);
    if (!main && !sub) {
      return "";
    }
    const title = sub ? `${main}: ${sub}` : main || sub;
    const isThesis = meta && meta.publisher && /학위논문/.test(meta.publisher);
    const openBracket = isThesis ? "\u300e" : "\u300c";
    const closeBracket = isThesis ? "\u300f" : "\u300d";
    return `${openBracket}${stripPdfExtension(title)}${closeBracket}`;
  }

  function journalText(meta) {
    const journal = normalizeSpaces(meta && meta.journalName);
    return journal ? `\u300e${journal}\u300f` : "";
  }

  function volumeIssueText(meta) {
    const volume = normalizeSpaces(meta && meta.volume);
    const issue = normalizeSpaces(meta && meta.issue);
    if (volume && issue) {
      return `${volume}(${issue})`;
    }
    return volume || issue || "";
  }

  function pageRangeText(meta, settings) {
    const includePages = !settings || settings.includePages !== false;
    if (!includePages) {
      return "";
    }
    const first = normalizeSpaces(meta && meta.pageFirst);
    const last = normalizeSpaces(meta && meta.pageLast);
    if (first && last) {
      return `${first}-${last}\ucabd`;
    }
    if (first) {
      return `${first}\ucabd`;
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
        if (source.thesisInstitution) {
          const inst = source.thesisInstitution;
          const dept = source.thesisDept;
          const deg = source.thesisDegree;
          const mode = (settings && settings.thesisDeptMode) || "none";
          
          let formatted = inst;
          if (dept && mode === "plain") {
            formatted += ` ${dept}`;
          }
          if (deg) {
            formatted += ` ${deg}`;
          }
          return normalizeSpaces(formatted);
        }
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
    const citationSettings = Object.assign({}, settings || {}, { includePages: true });
    const parts = [
      fieldValue("authors", meta, citationSettings),
      fieldValue("year", meta, citationSettings),
      fieldValue("title", meta, citationSettings)
    ];
    const journal = fieldValue("journal", meta, citationSettings);
    const volumeIssue = fieldValue("volumeIssue", meta, citationSettings);
    if (journal && volumeIssue) {
      parts.push(`${journal} ${volumeIssue}`);
    } else {
      parts.push(journal || volumeIssue);
    }
    parts.push(
      fieldValue("publisher", meta, citationSettings),
      fieldValue("pages", meta, citationSettings)
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
