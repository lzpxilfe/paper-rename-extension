(function initConstants(global) {
  "use strict";

  const APP_TITLE = "논문 PDF 인용식 파일명";
  const SETTINGS_STORAGE_KEY = "paperRenameSettings";

  const MESSAGES = {
    DOWNLOAD_CONTEXT: "paper-rename-download-context",
    GET_PAGE_INFO: "paper-rename-get-page-info"
  };

  const SOURCES = {
    RISS: "RISS",
    KCI: "KCI",
    KISS: "KISS",
    DBPIA: "DBpia",
    EARTICLE: "eArticle",
    SCHOLAR: "교보 스콜라",
    KOREASCIENCE: "KoreaScience",
    SCIENCEON: "ScienceON",
    KRM: "KRM",
    UNKNOWN: "unknown"
  };

  const DEFAULT_SETTINGS = {
    enabled: true,
    includePages: false,
    maxFilenameLength: 180,
    template: null
  };

  const ACTION = {
    OFF_BADGE_TEXT: "OFF",
    OFF_BADGE_COLOR: "#5f6368",
    DEFAULT_TITLE: APP_TITLE,
    DISABLED_TITLE: `${APP_TITLE} - 꺼짐`
  };

  const CONTEXT_TTL_MS = 8 * 60 * 1000;
  const MAX_CONTEXTS = 30;

  const api = {
    ACTION,
    APP_TITLE,
    CONTEXT_TTL_MS,
    DEFAULT_SETTINGS,
    MAX_CONTEXTS,
    MESSAGES,
    SETTINGS_STORAGE_KEY,
    SOURCES
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.PaperRenameConstants = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
