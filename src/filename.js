(function initFilenameModule(global) {
  "use strict";

  const constants = global.PaperRenameConstants || (typeof require === "function" ? require("./constants.js") : {});
  const citation = global.PaperRenameCitation || (typeof require === "function" ? require("./citation.js") : {});

  const FIELD_LABELS = {
    authors: "저자",
    year: "연도",
    title: "논문제목",
    journal: "학술지명",
    volumeIssue: "권호",
    publisher: "발행기관",
    pages: "쪽수",
    originalFilename: "원본파일명"
  };

  const SEPARATOR_VALUES = {
    space: " ",
    commaSpace: ", ",
    hyphen: " - ",
    underscore: "_",
    middleDot: "·",
    openParen: "(",
    closeParen: ")"
  };

  const DEFAULT_TEMPLATE = [
    { kind: "field", value: "authors" },
    { kind: "separator", value: "commaSpace" },
    { kind: "field", value: "title" },
    { kind: "separator", value: "commaSpace" },
    { kind: "field", value: "journal" },
    { kind: "separator", value: "space" },
    { kind: "field", value: "volumeIssue" },
    { kind: "separator", value: "commaSpace" },
    { kind: "field", value: "publisher" },
    { kind: "separator", value: "commaSpace" },
    { kind: "field", value: "year" },
    { kind: "separator", value: "commaSpace" },
    { kind: "field", value: "pages" }
  ];

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeSpaces(value) {
    return citation.normalizeSpaces
      ? citation.normalizeSpaces(value)
      : String(value || "").replace(/\s+/g, " ").trim();
  }

  function stripKnownExtension(value) {
    return String(value || "").replace(/\.[A-Za-z0-9]{1,8}$/i, "");
  }

  function extensionFromFilename(value) {
    const clean = String(value || "").split(/[?#]/)[0];
    const match = clean.match(/\.([A-Za-z0-9]{1,8})$/);
    return match ? `.${match[1].toLowerCase()}` : "";
  }

  function filenameFromUrl(url) {
    if (!url) {
      return "";
    }
    try {
      const parsed = new URL(String(url), "https://example.invalid");
      const candidates = [
        parsed.searchParams.get("filename"),
        parsed.searchParams.get("fileName"),
        parsed.searchParams.get("file"),
        parsed.pathname.split("/").pop()
      ];
      for (const candidate of candidates) {
        if (candidate) {
          return decodeURIComponent(String(candidate).split("/").pop());
        }
      }
    } catch (_error) {
      const withoutQuery = String(url).split(/[?#]/)[0];
      try {
        return decodeURIComponent(withoutQuery.split("/").pop() || "");
      } catch (_decodeError) {
        return withoutQuery.split("/").pop() || "";
      }
    }
    return "";
  }

  function safeSettings(settings) {
    const merged = Object.assign({}, constants.DEFAULT_SETTINGS || {}, settings || {});
    if (!Array.isArray(merged.template) || merged.template.length === 0) {
      merged.template = clone(DEFAULT_TEMPLATE);
    } else {
      merged.template = merged.template
        .filter((token) => token && (token.kind === "field" || token.kind === "separator"))
        .map((token) => Object.assign({}, token));
    }
    if (!Number.isFinite(Number(merged.maxFilenameLength)) || Number(merged.maxFilenameLength) < 40) {
      merged.maxFilenameLength = 180;
    } else {
      merged.maxFilenameLength = Math.min(240, Math.max(40, Math.floor(Number(merged.maxFilenameLength))));
    }
    return merged;
  }

  function resolveSeparator(token) {
    if (!token) {
      return "";
    }
    if (token.value === "custom") {
      return String(token.text || "");
    }
    return SEPARATOR_VALUES[token.value] || String(token.text || token.value || "");
  }

  function renderTemplate(meta, settings) {
    const activeSettings = safeSettings(settings);
    let output = "";
    let pendingSeparator = "";
    let hasValue = false;

    for (const token of activeSettings.template) {
      if (!token || !token.kind) {
        continue;
      }
      if (token.kind === "separator") {
        pendingSeparator = resolveSeparator(token);
        continue;
      }
      const value = citation.fieldValue
        ? citation.fieldValue(token.value, meta, activeSettings)
        : normalizeSpaces(meta && meta[token.value]);
      if (!value) {
        continue;
      }
      if (hasValue) {
        output += pendingSeparator || "";
      }
      output += value;
      hasValue = true;
      pendingSeparator = "";
    }

    const compact = citation.compactPunctuation
      ? citation.compactPunctuation(output)
      : normalizeSpaces(output);
    return compact || (citation.renderFullCitation ? citation.renderFullCitation(meta, activeSettings) : "");
  }

  function sanitizeFilenameBase(value, maxBaseLength) {
    const cleaned = stripKnownExtension(value)
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
      .replace(/\s+([」』〉》])/g, "$1")
      .replace(/([「『〈《])\s+/g, "$1")
      .replace(/\s+/g, " ")
      .replace(/[. ]+$/g, "")
      .trim();

    if (!cleaned) {
      return "";
    }
    const limit = Number(maxBaseLength) || 180;
    return cleaned.slice(0, limit).replace(/[. ]+$/g, "").trim();
  }

  function renderFilename(meta, settings, downloadItem) {
    const activeSettings = safeSettings(settings);
    const source = meta || {};
    const originalFilename = source.originalFilename ||
      (downloadItem && downloadItem.filename) ||
      filenameFromUrl(downloadItem && (downloadItem.finalUrl || downloadItem.url)) ||
      "";
    const extension =
      extensionFromFilename(originalFilename) ||
      extensionFromFilename(downloadItem && downloadItem.filename) ||
      extensionFromFilename(downloadItem && (downloadItem.finalUrl || downloadItem.url)) ||
      ".pdf";
    const maxBaseLength = Math.max(1, activeSettings.maxFilenameLength - extension.length);
    const rendered = renderTemplate(Object.assign({}, source, { originalFilename }), activeSettings);
    const fallback = citation.renderFullCitation
      ? citation.renderFullCitation(source, activeSettings)
      : originalFilename;
    const base = sanitizeFilenameBase(rendered || fallback || originalFilename || "paper", maxBaseLength);
    return `${base || "paper"}${extension}`;
  }

  const api = {
    DEFAULT_TEMPLATE,
    FIELD_LABELS,
    SEPARATOR_VALUES,
    clone,
    extensionFromFilename,
    filenameFromUrl,
    renderFilename,
    renderTemplate,
    resolveSeparator,
    safeSettings,
    sanitizeFilenameBase,
    stripKnownExtension
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.PaperRenameFilename = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
