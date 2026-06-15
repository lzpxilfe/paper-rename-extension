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

  function bracketPair(mode, defaultMode) {
    const activeMode = mode || defaultMode;
    if (activeMode === "none") {
      return null;
    }
    if (activeMode === "single") {
      return ["\u300c", "\u300d"];
    }
    if (activeMode === "angle") {
      return ["\u3008", "\u3009"];
    }
    if (activeMode === "doubleAngle") {
      return ["\u226a", "\u226b"];
    }
    return ["\u300e", "\u300f"];
  }

  function thesisTitleBrackets(settings) {
    return bracketPair(settings && settings.thesisTitleBracketMode, "double");
  }

  function bracketedText(text, brackets) {
    const clean = stripPdfExtension(text);
    return brackets ? `${brackets[0]}${clean}${brackets[1]}` : clean;
  }

  function titleText(meta, settings) {
    const main = normalizeSpaces(meta && meta.titleMain);
    const sub = normalizeSpaces(meta && meta.titleSub);
    if (!main && !sub) {
      return "";
    }
    const title = sub ? `${main}: ${sub}` : main || sub;
    const isThesis = meta && meta.publisher && /학위논문/.test(meta.publisher);
    const brackets = isThesis
      ? thesisTitleBrackets(settings)
      : bracketPair(settings && settings.titleBracketMode, "single");
    return bracketedText(title, brackets);
  }

  function journalText(meta, settings) {
    const journal = normalizeSpaces(meta && meta.journalName);
    return journal ? bracketedText(journal, bracketPair(settings && settings.journalBracketMode, "double")) : "";
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
        return titleText(source, settings);
      case "journal":
        return journalText(source, settings);
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
    bracketPair,
    bracketedText,
    compactPunctuation,
    fieldValue,
    joinAuthors,
    journalText,
    normalizeSpaces,
    pageRangeText,
    renderFullCitation,
    stripPdfExtension,
    thesisTitleBrackets,
    titleText,
    volumeIssueText
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.PaperRenameCitation = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
