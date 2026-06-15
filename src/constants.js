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
    DCOLLECTION: "dCollection",
    UNKNOWN: "unknown"
  };

  const DEFAULT_SETTINGS = {
    enabled: true,
    includePages: false,
    maxFilenameLength: 180,
    template: null,
    thesisDeptMode: "none"
  };

  const ACTION = {
    OFF_BADGE_TEXT: "OFF",
    OFF_BADGE_COLOR: "#5f6368",
    DEFAULT_TITLE: APP_TITLE,
    DISABLED_TITLE: `${APP_TITLE} - 꺼짐`
  };

  const CONTEXT_TTL_MS = 30 * 60 * 1000;
  // 다운로드 직전 클릭 컨텍스트를 최근으로 간주하는 윈도우 (20분)
  const RECENT_CONTEXT_WINDOW_MS = 20 * 60 * 1000;
  // RISS 상세 페이지 보강을 기다리는 최대 딜레이
  const CONTEXT_SETTLE_DELAY_MS = 800;
  const MAX_CONTEXTS = 30;

  // 파일명 최대 길이 기본값 / 허용 범위
  const MAX_FILENAME_LENGTH_DEFAULT = 180;
  const MAX_FILENAME_LENGTH_MIN = 40;
  const MAX_FILENAME_LENGTH_MAX = 240;

  const ACADEMIC_DOMAINS_PATTERN = /riss\.kr|dbpia|kiss\.kstudy|kci\.go\.kr|earticle\.net|kyobobook.*scholar|koreascience|scienceon|krm\.or\.kr|nanet\.go\.kr|nl\.go\.kr|scholar\.google|dcollection/i;

  const KNOWN_HOST_PATTERNS = [
    /riss/i,
    /kci/i,
    /kiss/i,
    /dbpia/i,
    /earticle/i,
    /scholar.*kyobobook/i,
    /koreascience/i,
    /scienceon/i,
    /krm/i,
    /dcollection/i
  ];

  function isAcademicSite(url) {
    if (!url) return false;
    try {
      const parsed = new URL(url);
      const host = parsed.hostname;
      const path = parsed.pathname;
      return ACADEMIC_DOMAINS_PATTERN.test(host) || ACADEMIC_DOMAINS_PATTERN.test(path);
    } catch (_e) {
      return false;
    }
  }

  const BLACKLIST_DOMAINS_PATTERN = /heritage\.go\.kr|nrich\.go\.kr|nihc\.go\.kr|gogung\.go\.kr|khs\.go\.kr|cha\.go\.kr|nch\.go\.kr/i;

  function isBlacklistedSite(url) {
    if (!url) return false;
    try {
      const parsed = new URL(url);
      const host = parsed.hostname;
      const path = parsed.pathname;
      return BLACKLIST_DOMAINS_PATTERN.test(host) || BLACKLIST_DOMAINS_PATTERN.test(path);
    } catch (_e) {
      return false;
    }
  }

  const api = {
    ACADEMIC_DOMAINS_PATTERN,
    ACTION,
    APP_TITLE,
    BLACKLIST_DOMAINS_PATTERN,
    CONTEXT_SETTLE_DELAY_MS,
    CONTEXT_TTL_MS,
    DEFAULT_SETTINGS,
    isAcademicSite,
    isBlacklistedSite,
    KNOWN_HOST_PATTERNS,
    MAX_CONTEXTS,
    MAX_FILENAME_LENGTH_DEFAULT,
    MAX_FILENAME_LENGTH_MIN,
    MAX_FILENAME_LENGTH_MAX,
    MESSAGES,
    RECENT_CONTEXT_WINDOW_MS,
    SETTINGS_STORAGE_KEY,
    SOURCES
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.PaperRenameConstants = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
