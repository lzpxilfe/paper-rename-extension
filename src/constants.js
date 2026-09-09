(function initConstants(global) {
  "use strict";

  const APP_TITLE = "논문 PDF 인용식 파일명";
  const SETTINGS_STORAGE_KEY = "paperRenameSettings";
  const DOWNLOAD_DIAGNOSTICS_STORAGE_KEY = "paperRenameDownloadDiagnostics";
  const DIAGNOSTICS_ENABLED_STORAGE_KEY = "paperRenameDiagnosticsEnabled";

  const MESSAGES = {
    DOWNLOAD_CONTEXT: "paper-rename-download-context",
    GET_DOWNLOAD_DIAGNOSTICS: "paper-rename-get-download-diagnostics",
    CLEAR_DOWNLOAD_DIAGNOSTICS: "paper-rename-clear-download-diagnostics",
    SET_DOWNLOAD_DIAGNOSTICS_ENABLED: "paper-rename-set-download-diagnostics-enabled",
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
    SEOUL_HISTORY: "서울역사",
    UNKNOWN: "unknown"
  };

  const DEFAULT_SETTINGS = {
    enabled: true,
    includePages: false,
    maxFilenameLength: 180,
    template: null,
    titleBracketMode: "single",
    journalBracketMode: "double",
    thesisDeptMode: "none",
    thesisTitleBracketMode: "double"
  };

  const ACTION = {
    OFF_BADGE_TEXT: "OFF",
    OFF_BADGE_COLOR: "#5f6368",
    DEFAULT_TITLE: APP_TITLE,
    DISABLED_TITLE: `${APP_TITLE} - 꺼짐`
  };

  // 컨텍스트 보관 상한. 상세페이지를 한참 읽다가 내려받는 경우가 흔해 넉넉히 둔다.
  // 오래된 컨텍스트는 contextScore에서 같은 탭이거나 논문 ID/URL이 맞을 때만
  // 임계점을 넘으므로, 이 값이 길다고 해서 엉뚱한 이름이 붙지는 않는다.
  const CONTEXT_TTL_MS = 30 * 60 * 1000;
  // RISS 상세 페이지 보강을 기다리는 최대 딜레이
  const CONTEXT_SETTLE_DELAY_MS = 800;
  const MAX_CONTEXTS = 30;
  const MAX_DOWNLOAD_DIAGNOSTICS = 20;

  // 파일명 최대 길이 기본값 / 허용 범위 (사용자 설정, 문자 수 기준)
  const MAX_FILENAME_LENGTH_DEFAULT = 180;
  const MAX_FILENAME_LENGTH_MIN = 40;
  const MAX_FILENAME_LENGTH_MAX = 240;

  // 파일명 한 조각의 UTF-8 바이트 상한.
  // macOS(APFS)와 리눅스(ext4/btrfs/xfs)는 파일명 한 조각을 255바이트로 제한한다.
  // 한글은 UTF-8에서 3바이트라 문자 수만 세면 180자 = 540바이트로 한도를 넘어
  // 제안한 파일명이 잘리거나 통째로 무시된다. Windows(NTFS)는 255 UTF-16 단위라
  // 문자 수 제한이 먼저 걸리므로, 두 기준을 함께 적용해야 3개 OS 모두 안전하다.
  // 235는 Chrome이 중복 시 붙이는 " (12)" 접미사 여유를 남긴 값이다.
  const MAX_FILENAME_BYTES = 235;

  const ACADEMIC_DOMAINS_PATTERN = /riss\.kr|dbpia|kiss\.kstudy|kci\.go\.kr|earticle\.net|scholar.*kyobobook|kyobobook.*scholar|koreascience|scienceon|krm\.or\.kr|nanet\.go\.kr|nl\.go\.kr|scholar\.google|dcollection|history\.seoul\.go\.kr/i;

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
    /dcollection/i,
    /history\.seoul\.go\.kr/i
  ];

  function isAcademicSite(url) {
    if (!url) return false;
    try {
      const parsed = new URL(url);
      const host = parsed.hostname;
      if (ACADEMIC_DOMAINS_PATTERN.test(host)) {
        return true;
      }
      // 대학 도서관 프록시(EZproxy 등)는 대상 호스트를 하이픈으로 인코딩한다.
      // 예: scholar-kyobobook-co-kr-ssl.openlib.uos.ac.kr, riss-kr.proxy.univ.ac.kr
      const hyphenDecoded = host.replace(/-/g, ".");
      if (hyphenDecoded !== host && ACADEMIC_DOMAINS_PATTERN.test(hyphenDecoded)) {
        return true;
      }
      // 경로/쿼리에 원본 주소를 담는 프록시: /login?url=https://www.riss.kr/...
      // (파일 경로에 도메인 단어가 섞인 일반 URL 오염을 막기 위해 http 표기가 있을 때만 본다)
      const embedded = `${parsed.pathname}${parsed.search}`;
      if (/https?(?::|%3A)/i.test(embedded) && ACADEMIC_DOMAINS_PATTERN.test(embedded)) {
        return true;
      }
      if (parsed.protocol === "blob:" && parsed.pathname) {
        try {
          return ACADEMIC_DOMAINS_PATTERN.test(new URL(parsed.pathname).hostname);
        } catch (_innerError) {
          return false;
        }
      }
      return false;
    } catch (_e) {
      return false;
    }
  }

  // archreport(국가유산 보고서 파일명 정리) 확장이 파일명을 바꾸는 국가유산 사이트들과
  // 공존하기 위한 블랙리스트다. 이 도메인에서는 컨텍스트를 수집하지 않고,
  // 다운로드 파일명 변경에도 개입하지 않는다.
  const BLACKLIST_DOMAINS_PATTERN = /heritage\.go\.kr|nrich\.go\.kr|nihc\.go\.kr|gogung\.go\.kr|khs\.go\.kr|cha\.go\.kr|nch\.go\.kr|e-minwon\.go\.kr|cihc\.or\.kr|iha\.go\.kr|116\.67\.83\.213/i;

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
    DIAGNOSTICS_ENABLED_STORAGE_KEY,
    isAcademicSite,
    isBlacklistedSite,
    KNOWN_HOST_PATTERNS,
    MAX_CONTEXTS,
    MAX_DOWNLOAD_DIAGNOSTICS,
    MAX_FILENAME_LENGTH_DEFAULT,
    MAX_FILENAME_LENGTH_MIN,
    MAX_FILENAME_LENGTH_MAX,
    MAX_FILENAME_BYTES,
    MESSAGES,
    DOWNLOAD_DIAGNOSTICS_STORAGE_KEY,
    SETTINGS_STORAGE_KEY,
    SOURCES
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.PaperRenameConstants = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
