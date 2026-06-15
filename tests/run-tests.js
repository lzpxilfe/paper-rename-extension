"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const constants = require("../src/constants.js");
globalThis.PaperRenameConstants = constants;
const citation = require("../src/citation.js");
globalThis.PaperRenameCitation = citation;
const filename = require("../src/filename.js");
globalThis.PaperRenameFilename = filename;
const metadata = require("../src/metadata.js");
const background = require("../src/background.js");
const pendingTests = [];

function fixture(name) {
  return fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
}

function test(name, run) {
  try {
    const result = run();
    if (result && typeof result.then === "function") {
      const pending = result.then(() => {
        console.log(`ok - ${name}`);
      }).catch((error) => {
        console.error(`not ok - ${name}`);
        throw error;
      });
      pendingTests.push(pending);
      return pending;
    }
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
  return undefined;
}

const fullMeta = {
  authors: ["김영희", "박철수"],
  titleMain: "근대 문학의 매체성과 독자",
  titleSub: "잡지 문화를 중심으로",
  journalName: "한국문학연구",
  volume: "42",
  issue: "3",
  publisher: "한국문학회",
  year: "2025",
  pageFirst: "15",
  pageLast: "42",
  originalFilename: "article.pdf",
  source: "RISS",
  pageUrl: "https://example.test"
};

test("full citation renders all present fields", () => {
  assert.equal(
    citation.renderFullCitation(fullMeta, filename.safeSettings()),
    "김영희·박철수, 2025, 「근대 문학의 매체성과 독자: 잡지 문화를 중심으로」, 『한국문학연구』 42(3), 한국문학회, 15-42쪽"
  );
});

test("filename omits pages when includePages is false", () => {
  const settings = filename.safeSettings({ includePages: false });
  const actual = filename.renderFilename(fullMeta, settings, { filename: "article.pdf" });
  assert.ok(!actual.includes("15-42쪽"));
});

test("citation omits empty journal section for thesis-like metadata", () => {
  const thesis = Object.assign({}, fullMeta, {
    journalName: "",
    volume: "",
    issue: "",
    publisher: "서울대학교 대학원",
    pageFirst: "",
    pageLast: ""
  });
  assert.equal(
    citation.renderFullCitation(thesis, filename.safeSettings()),
    "김영희·박철수, 2025, 「근대 문학의 매체성과 독자: 잡지 문화를 중심으로」, 서울대학교 대학원"
  );
});

test("filename sanitizer removes forbidden characters and duplicate extension", () => {
  const actual = filename.renderFilename({
    authors: ["홍길동"],
    titleMain: "홍성 / 홍주읍성: 북문지.pdf",
    journalName: "문화재 <연구>",
    publisher: "A|B 연구소",
    year: "2026",
    originalFilename: "source.pdf"
  }, filename.safeSettings({ includePages: false }));

  assert.equal(actual, "홍길동, 2026, 「홍성 홍주읍성 북문지」, 『문화재 연구』, A B 연구소.pdf");
});

test("custom chip order changes rendered filename", () => {
  const settings = filename.safeSettings({
    includePages: false,
    template: [
      { kind: "field", value: "year" },
      { kind: "separator", value: "underscore" },
      { kind: "field", value: "authors" },
      { kind: "separator", value: "underscore" },
      { kind: "field", value: "title" }
    ]
  });

  assert.equal(
    filename.renderFilename(fullMeta, settings, { filename: "paper.pdf" }),
    "2025_김영희·박철수_「근대 문학의 매체성과 독자 잡지 문화를 중심으로」.pdf"
  );
});

test("max filename length is respected including extension", () => {
  const longTitle = "가".repeat(300);
  const actual = filename.renderFilename({
    titleMain: longTitle,
    originalFilename: "long.pdf"
  }, filename.safeSettings({ maxFilenameLength: 60 }));

  assert.ok(actual.length <= 60);
  assert.ok(actual.endsWith(".pdf"));
});

test("default field list does not include sequence number", () => {
  const fields = filename.DEFAULT_TEMPLATE
    .filter((token) => token.kind === "field")
    .map((token) => token.value);
  assert.ok(!fields.includes("sequenceNumber"));
});

test("default filename matches requested KCI citation filename", () => {
  const actual = filename.renderFilename({
    authors: ["이차원", "Lee ChaWon"],
    titleMain: "백제 한성기 몽촌토성의 성격과 기능",
    journalName: "백제학보",
    issue: "53",
    publisher: "백제학회",
    year: "2025",
    originalFilename: "download.pdf"
  }, filename.safeSettings(), { filename: "download.pdf" });

  assert.equal(actual, "이차원, 2025, 「백제 한성기 몽촌토성의 성격과 기능」, 『백제학보』 53, 백제학회.pdf");
});

test("default filename matches requested RISS thesis filename", () => {
  const actual = filename.renderFilename({
    authors: ["이차원"],
    titleMain: "백제 한성기 몽촌토성의 축조 목적과 기능",
    publisher: "서울시립대학교 국사학과 석사학위논문",
    year: "2025",
    originalFilename: "000000035976_20260615105228"
  }, filename.safeSettings(), { filename: "000000035976_20260615105228" });

  assert.equal(actual, "이차원, 2025, 『백제 한성기 몽촌토성의 축조 목적과 기능』, 서울시립대학교 국사학과 석사학위논문.pdf");
});

test("thesisDeptMode changes thesis publisher formatting", () => {
  const meta = {
    authors: ["백혜림"],
    titleMain: "禮山 伽倻寺址 伽藍 變遷 硏究",
    thesisInstitution: "서울시립대학교",
    thesisDept: "국사학과",
    thesisDegree: "석사학위논문",
    publisher: "서울시립대학교 국사학과 석사학위논문",
    year: "2025",
    originalFilename: "article.pdf"
  };


  const actualPlain = filename.renderFilename(
    meta,
    Object.assign({}, filename.safeSettings(), { thesisDeptMode: "plain" })
  );
  assert.equal(actualPlain, "백혜림, 2025, 『禮山 伽倻寺址 伽藍 變遷 硏究』, 서울시립대학교 국사학과 석사학위논문.pdf");

  const actualNone = filename.renderFilename(
    meta,
    Object.assign({}, filename.safeSettings(), { thesisDeptMode: "none" })
  );
  assert.equal(actualNone, "백혜림, 2025, 『禮山 伽倻寺址 伽藍 變遷 硏究』, 서울시립대학교 석사학위논문.pdf");
});

test("article title and journal bracket modes change academic paper brackets", () => {
  const meta = {
    authors: ["문상필"],
    titleMain: "2022 개정 교육과정 분석을 통한 초등학교 인공지능윤리 교육 프로그램 개발",
    journalName: "한국인공지능교육학회 학술대회",
    volume: "2022한국인공지능교육학회동계학술대회2022.12",
    publisher: "한국인공지능교육학회",
    year: "2022",
    originalFilename: "paper.pdf"
  };

  const actual = filename.renderFilename(
    meta,
    filename.safeSettings({
      titleBracketMode: "angle",
      journalBracketMode: "doubleAngle"
    })
  );

  assert.equal(
    actual,
    "문상필, 2022, 〈2022 개정 교육과정 분석을 통한 초등학교 인공지능윤리 교육 프로그램 개발〉, ≪한국인공지능교육학회 학술대회≫ 2022한국인공지능교육학회동계학술대회2022.12, 한국인공지능교육학회.pdf"
  );
});

test("thesisTitleBracketMode changes thesis title brackets", () => {
  const meta = {
    authors: ["홍길동"],
    titleMain: "학위논문 제목",
    publisher: "서울대학교 석사학위논문",
    year: "2026",
    originalFilename: "thesis.pdf"
  };

  const actualDefault = filename.renderFilename(
    meta,
    filename.safeSettings()
  );
  assert.ok(actualDefault.includes("『학위논문 제목』"));

  const actualSingle = filename.renderFilename(
    meta,
    filename.safeSettings({ thesisTitleBracketMode: "single" })
  );
  assert.ok(actualSingle.includes("「학위논문 제목」"));

  const actualAngle = filename.renderFilename(
    meta,
    filename.safeSettings({ thesisTitleBracketMode: "angle" })
  );
  assert.ok(actualAngle.includes("〈학위논문 제목〉"));

  const actualDoubleAngle = filename.renderFilename(
    meta,
    filename.safeSettings({ thesisTitleBracketMode: "doubleAngle" })
  );
  assert.ok(actualDoubleAngle.includes("≪학위논문 제목≫"));

  const actualNone = filename.renderFilename(
    meta,
    filename.safeSettings({ thesisTitleBracketMode: "none" })
  );
  assert.ok(actualNone.includes("학위논문 제목"));
  assert.ok(!actualNone.includes("『"));
  assert.ok(!actualNone.includes("』"));
  assert.ok(!actualNone.includes("「"));
  assert.ok(!actualNone.includes("」"));
});

test("author cleanup removes romanization and duplicate affiliation numbers", () => {
  assert.deepEqual(metadata.splitAuthors("이차원 Lee ChaWon 1·이차원 Lee ChaWon 1"), ["이차원"]);
});

test("RISS thesis detail facts extract Korean labels and thesis publisher", () => {
  const actual = metadata.parseFixtureHtml(`
    <!doctype html>
    <html lang="ko">
    <head><title>RISS 학위논문</title></head>
    <body>
      <div class="locationW">학위논문</div>
      <section id="thesisInfoDiv">
        <h3 class="title">백제 한성기 몽촌토성의 축조 목적과 기능</h3>
        <div class="infoDetailL">
          <ul>
            <li><span class="strong">저자</span> 이차원</li>
            <li><span class="strong">학위논문사항</span> 서울시립대학교 일반대학원, 국사학과, 국내석사, 2025</li>
            <li><span class="strong">발행년도</span> 2025</li>
          </ul>
        </div>
      </section>
    </body>
    </html>
  `, "https://www.riss.kr/search/detail/DetailView.do?p_mat_type=be54d9b8bc7cdb09");

  assert.deepEqual(actual.authors, ["이차원"]);
  assert.equal(actual.titleMain, "백제 한성기 몽촌토성의 축조 목적과 기능");
  assert.equal(actual.publisher, "서울시립대학교 국사학과 석사학위논문");
  assert.equal(actual.thesisInstitution, "서울시립대학교");
  assert.equal(actual.thesisDept, "국사학과");
  assert.equal(actual.thesisDegree, "석사학위논문");
  assert.equal(actual.year, "2025");
});

test("RISS search page title is not accepted as paper title", () => {
  const actual = metadata.parseFixtureHtml(`
    <!doctype html>
    <html lang="ko">
    <head><title>RISS 검색 — 통합검색</title></head>
    <body>
      <h1>RISS 검색 — 통합검색</h1>
    </body>
    </html>
  `, "https://www.riss.kr/search/Search.do?query=%EB%AA%BD%EC%B4%8C%ED%86%A0%EC%84%B1");

  assert.equal(actual.titleMain, "");
});

test("RISS search result list page does not merge all result authors for popup metadata", () => {
  const authorNodes = [
    { textContent: "김영애" },
    { textContent: "채경화" },
    { textContent: "손영준" },
    { textContent: "양재명" },
    { textContent: "구찬동" },
    { textContent: "김준홍" },
    { textContent: "김역군" },
    { textContent: "정성원" }
  ];
  const doc = {
    title: "RISS 검색 - 통합검색",
    documentElement: {
      textContent: "김영애 채경화 손영준 양재명 구찬동 김준홍 김역군 정성원 2026"
    },
    body: {
      textContent: "김영애 채경화 손영준 양재명 구찬동 김준홍 김역군 정성원 2026"
    },
    querySelector: () => null,
    querySelectorAll: (selector) => selector.includes("author") ? authorNodes : []
  };

  const actual = metadata.extractFromDocument(doc, "https://www.riss.kr/search/Search.do?query=test");

  assert.equal(actual.titleMain, "");
  assert.deepEqual(actual.authors, []);
  assert.equal(actual.year, "");
});

test("background chooses the nearest same-tab context", () => {
  background._state.reset();
  const now = Date.now();
  background.rememberContext({
    metadata: fullMeta,
    downloadUrl: "https://example.test/article.pdf",
    originalFilename: "article.pdf",
    capturedAt: now
  }, { tab: { id: 3 }, frameId: 0 });

  const entry = background.chooseContextEntry({
    tabId: 3,
    url: "https://example.test/article.pdf",
    filename: "article.pdf"
  }, now + 50);

  assert.ok(entry);
  assert.equal(entry.context.metadata.titleMain, fullMeta.titleMain);
});

test("background ignores expired contexts", () => {
  background._state.reset();
  const now = Date.now();
  background.rememberContext({
    metadata: fullMeta,
    downloadUrl: "https://example.test/article.pdf",
    capturedAt: now - constants.CONTEXT_TTL_MS - 1000
  }, { tab: { id: 3 }, frameId: 0 });

  assert.equal(background.chooseContextEntry({ tabId: 3, url: "https://example.test/article.pdf" }, now), null);
});

test("background returns null when no context matches", () => {
  background._state.reset();
  assert.equal(background.chooseContextEntry({ tabId: 1, url: "https://example.test/article.pdf" }), null);
});

test("background accepts one recent context for viewer-mediated downloads", () => {
  background._state.reset();
  const now = Date.now();
  background.rememberContext({
    metadata: fullMeta,
    pageUrl: "https://www.riss.kr/search/Search.do?query=test",
    downloadUrl: "",
    capturedAt: now
  }, { tab: { id: 7 }, frameId: 0 });

  const entry = background.chooseContextEntry({
    tabId: 12,
    url: "https://viewer.example.test/download",
    filename: "download.pdf"
  }, now + 1000);

  assert.ok(entry);
  assert.equal(entry.context.metadata.titleMain, fullMeta.titleMain);
});

test("background uses newest RISS context when viewer download is delayed", () => {
  background._state.reset();
  const now = Date.now();
  background.rememberContext({
    metadata: Object.assign({}, fullMeta, {
      titleMain: "검색결과 카드 제목",
      publisher: "검색결과 기관"
    }),
    pageUrl: "https://www.riss.kr/search/Search.do?query=test",
    downloadUrl: "",
    capturedAt: now - 1000
  }, { tab: { id: 7 }, frameId: 0 });
  background.rememberContext({
    metadata: Object.assign({}, fullMeta, {
      titleMain: "상세페이지 보강 제목",
      publisher: "서울시립대학교 국사학과 석사학위논문"
    }),
    pageUrl: "https://www.riss.kr/search/detail/DetailView.do?p_mat_type=be54d9b8bc7cdb09",
    downloadUrl: "",
    capturedAt: now
  }, { tab: { id: 7 }, frameId: 0 });
  background.handleTabRelation({
    id: 12,
    url: "https://viewer.example.test/download",
    openerTabId: 7
  });

  const entry = background.chooseContextEntry({
    tabId: 12,
    url: "https://viewer.example.test/download",
    filename: "000000035976_20260615105228"
  }, now + 30000);

  assert.ok(entry);
  assert.equal(entry.context.metadata.titleMain, "상세페이지 보강 제목");
  assert.equal(entry.context.metadata.publisher, "서울시립대학교 국사학과 석사학위논문");
});

test("background waits briefly for enriched RISS context before consuming search context", () => new Promise((resolve, reject) => {
  background._state.reset();
  const now = Date.now();
  background.rememberContext({
    metadata: Object.assign({}, fullMeta, {
      titleMain: "검색결과 카드 제목",
      publisher: "검색결과 기관",
      source: "RISS"
    }),
    source: "RISS",
    pageUrl: "https://www.riss.kr/search/Search.do?query=test",
    downloadUrl: "",
    capturedAt: now
  }, { tab: { id: 7 }, frameId: 0 });

  background.findContextEntry({
    tabId: 12,
    url: "https://viewer.example.test/download",
    filename: "000000035976_20260615105228"
  }, (entry) => {
    try {
      assert.ok(entry);
      assert.equal(entry.context.metadata.titleMain, "상세페이지 보강 제목");
      assert.equal(entry.context.metadata.publisher, "서울시립대학교 국사학과 석사학위논문");
      resolve();
    } catch (error) {
      reject(error);
    }
  });

  setTimeout(() => {
    background.rememberContext({
      metadata: Object.assign({}, fullMeta, {
        titleMain: "상세페이지 보강 제목",
        publisher: "서울시립대학교 국사학과 석사학위논문",
        source: "RISS"
      }),
      source: "RISS",
      pageUrl: "https://www.riss.kr/search/detail/DetailView.do?p_mat_type=be54d9b8bc7cdb09",
      downloadUrl: "",
      capturedAt: Date.now()
    }, { tab: { id: 7 }, frameId: 0 });
  }, 100);
}));

test("background ignores blank viewer contexts", () => {
  background._state.reset();
  const now = Date.now();
  background.rememberContext({
    metadata: fullMeta,
    pageUrl: "https://www.riss.kr/search/Search.do?query=test",
    capturedAt: now
  }, { tab: { id: 7 }, frameId: 0 });
  background.rememberContext({
    metadata: metadata.blankMetadata("RISS", "https://viewer.riss.kr"),
    pageUrl: "https://viewer.riss.kr",
    capturedAt: now + 1000
  }, { tab: { id: 9 }, frameId: 0 });

  assert.equal(background._state.pendingContexts.length, 1);
  assert.equal(background._state.pendingContexts[0].context.metadata.titleMain, fullMeta.titleMain);
});

test("KCI DOM metadata uses article title and journalInfo instead of UI text", () => {
  const actual = metadata.parseFixtureHtml(`
    <!doctype html>
    <html lang="ko">
    <body>
      <button class="title">초록 열기 닫기 버튼</button>
      <h3 id="artiTitle">백제 한성기 몽촌토성의 성격과 기능</h3>
      <div class="author"><a>이차원 Lee ChaWon 1</a></div>
      <div class="author"><a>이차원 Lee ChaWon 1</a></div>
      <div class="journalInfo">
        <span class="jounal"><a>백제학보</a></span>
        <span class="vol">2025, vol., no.53, pp. 5-60</span>
        <span class="pub"><a>백제학회</a></span>
      </div>
    </body>
    </html>
  `, "https://www.kci.go.kr/kciportal/ci/sereArticleSearch/ciSereArtiView.kci?sereArticleSearchBean.artiId=ART003238959");

  assert.deepEqual(actual.authors, ["이차원"]);
  assert.equal(actual.titleMain, "백제 한성기 몽촌토성의 성격과 기능");
  assert.equal(actual.journalName, "백제학보");
  assert.equal(actual.issue, "53");
  assert.equal(actual.publisher, "백제학회");
  assert.equal(actual.year, "2025");
});

test("KCI realistic page prefers citation metadata over UI button text", () => {
  const actual = metadata.parseFixtureHtml(
    fixture("kci-realistic.html"),
    "https://www.kci.go.kr/kciportal/ci/sereArticleSearch/ciSereArtiView.kci?sereArticleSearchBean.artiId=ART003238959"
  );

  assert.deepEqual(actual.authors, ["이차원"]);
  assert.equal(actual.titleMain, "백제 한성기 몽촌토성의 성격과 기능");
  assert.equal(actual.journalName, "백제학보");
  assert.equal(actual.issue, "53");
  assert.equal(actual.pageFirst, "5");
  assert.equal(actual.pageLast, "60");
});

test("RISS search result text yields thesis metadata for original-view clicks", () => {
  const actual = metadata.parseResultText(`
    학위논문 1
    백제 한성기 몽촌토성의 축조 목적과 기능
    이차원 | 서울시립대학교 일반대학원 | 2025 | 국내석사
    원문보기 목차검색조회 음성듣기
  `, "RISS", "https://www.riss.kr/search/Search.do?query=몽촌토성");

  assert.deepEqual(actual.authors, ["이차원"]);
  assert.equal(actual.titleMain, "백제 한성기 몽촌토성의 축조 목적과 기능");
  assert.equal(actual.publisher, "서울시립대학교 일반대학원");
  assert.equal(actual.year, "2025");
});

test("RISS search result text without pipes still avoids page-title fallback", () => {
  const actual = metadata.parseResultText(`
    RISS 검색 — 통합검색
    학위논문 1
    백제 한성기 몽촌토성의 축조 목적과 기능
    이차원 서울시립대학교 일반대학원 2025 국내석사
    원문보기 목차검색조회 음성듣기
  `, "RISS", "https://www.riss.kr/search/Search.do?query=%EB%AA%BD%EC%B4%8C%ED%86%A0%EC%84%B1");

  assert.deepEqual(actual.authors, ["이차원"]);
  assert.equal(actual.titleMain, "백제 한성기 몽촌토성의 축조 목적과 기능");
  assert.equal(actual.publisher, "서울시립대학교 일반대학원");
  assert.equal(actual.year, "2025");
});

const fixtureCases = [
  ["riss.html", "https://www.riss.kr/search/detail/DetailView.do?p_mat_type=1", "RISS", "근대 문학의 매체성과 독자", "한국문학연구", "2025"],
  ["kci.html", "https://www.kci.go.kr/kciportal/ci/sereArticleSearch/ciSereArtiView.kci", "KCI", "한국 고전 서사의 공간 연구", "고전문학과 해석", "2024"],
  ["kci-realistic.html", "https://www.kci.go.kr/kciportal/ci/sereArticleSearch/ciSereArtiView.kci?sereArticleSearchBean.artiId=ART003238959", "KCI", "백제 한성기 몽촌토성의 성격과 기능", "백제학보", "2025"],
  ["kiss.html", "https://kiss.kstudy.com/Detail/Ar?key=1", "KISS", "일제강점기 잡지 번역의 양상", "현대문학사", "2023"],
  ["dbpia.html", "https://www.dbpia.com/journal/articleDetail?nodeId=1", "DBpia", "문학장과 출판 네트워크", "인문학연구", "2022"],
  ["dbpia.html", "https://www.dbpia.co.kr/journal/articleDetail?nodeId=1", "DBpia", "문학장과 출판 네트워크", "인문학연구", "2022"],
  ["earticle.html", "https://www.earticle.net/Article/A1", "eArticle", "근대 독서 문화의 형성", "독서문화연구", "2021"],
  ["scholar.html", "https://scholar.kyobobook.co.kr/article/detail/1", "교보 스콜라", "서사 구조와 기억의 정치", "문화와 서사", "2020"],
  ["scholar.html", "https://scholar-kyobobook-co-kr-ssl.openlib.uos.ac.kr/article/detail/1", "교보 스콜라", "서사 구조와 기억의 정치", "문화와 서사", "2020"],
  ["koreascience.html", "https://www.koreascience.or.kr/article/JAKO202400000000001.page", "KoreaScience", "과학기술 지식정보 활용 연구", "정보관리학회지", "2024"],
  ["scienceon.html", "https://scienceon.kisti.re.kr/srch/selectPORSrchArticle.do?cn=ART002255251", "ScienceON", "데이터 기반 연구성과 분석", "한국데이터정보과학회지", "2023"],
  ["krm.html", "https://www.krm.or.kr/krmts/search/detailView.html?category=ResearchPaper&dbGubun=SD&local_id=10061537", "KRM", "지역 문화 연구의 자료화 방안", "인문사회연구", "2022"]
];

fixtureCases.forEach(([file, url, source, title, journal, year]) => {
  test(`${source} fixture extracts key metadata`, () => {
    const actual = metadata.parseFixtureHtml(fixture(file), url);
    assert.equal(actual.source, source);
    assert.equal(actual.titleMain, title);
    assert.equal(actual.journalName, journal);
    assert.equal(actual.year, year);
    assert.ok(actual.authors.length >= 1);
  });
});

test("eArticle metadata removes trailing navigation link labels", () => {
  const actual = metadata.parseFixtureHtml(`
    <!doctype html>
    <html lang="ko">
    <head><title>eArticle</title></head>
    <body>
      <h2 class="articleTitle">2022 개정 교육과정 분석을 통한 초등학교 인공지능윤리 교육 프로그램 개발</h2>
      <ul>
        <li><strong>저자</strong> 문상필</li>
        <li><strong>학술지명</strong> 한국인공지능교육학회 학술대회</li>
        <li><strong>권</strong> 2022한국인공지능교육학회동계학술대회2022.12<a href="#">바로가기</a></li>
        <li><strong>발행기관</strong> 한국인공지능교육학회 <a href="#">바로가기</a></li>
        <li><strong>발행년도</strong> 2022</li>
      </ul>
    </body>
    </html>
  `, "https://www.earticle.net/Article/A1");

  assert.equal(actual.publisher, "한국인공지능교육학회");
  assert.equal(actual.volume, "2022한국인공지능교육학회동계학술대회2022.12");

  const rendered = filename.renderFilename(actual, filename.safeSettings());
  assert.equal(
    rendered,
    "문상필, 2022, 「2022 개정 교육과정 분석을 통한 초등학교 인공지능윤리 교육 프로그램 개발」, 『한국인공지능교육학회 학술대회』 2022한국인공지능교육학회동계학술대회2022.12, 한국인공지능교육학회.pdf"
  );
  assert.ok(!rendered.includes("바로가기"));
});

test("Google Scholar meta tags are correctly parsed from HTML", () => {
  const html = `
    <!doctype html>
    <html>
    <head>
      <meta name="citation_title" content="태안읍성의 이전 의미와 굴포운하">
      <meta name="citation_author" content="이경복">
      <meta name="citation_author" content="김영희">
      <meta name="citation_journal_title" content="충청학과 충청문화">
      <meta name="citation_publication_date" content="2007/12/31">
      <meta name="citation_volume" content="10">
      <meta name="citation_issue" content="2">
      <meta name="citation_firstpage" content="120">
      <meta name="citation_lastpage" content="150">
      <meta name="citation_publisher" content="충청학회">
    </head>
    <body>
      <table>
        <tr><th>저자</th><td>모든 권리 보유</td></tr>
        <tr><th>제목</th><td>고객센터</td></tr>
        <tr><th>발행연도</th><td>2008</td></tr>
      </table>
    </body>
    </html>
  `;
  const actual = metadata.parseFixtureHtml(html, "https://scholar-kyobobook-co-kr-ssl.openlib.uos.ac.kr/article/detail/4010028835542");
  
  assert.equal(actual.source, "교보 스콜라");
  assert.equal(actual.titleMain, "태안읍성의 이전 의미와 굴포운하");
  assert.deepEqual(actual.authors, ["이경복", "김영희"]);
  assert.equal(actual.journalName, "충청학과 충청문화");
  assert.equal(actual.year, "2007");
  assert.equal(actual.volume, "10");
  assert.equal(actual.issue, "2");
  assert.equal(actual.pageFirst, "120");
  assert.equal(actual.pageLast, "150");
  assert.equal(actual.publisher, "충청학회");
});

test("Dublin Core meta tags are correctly parsed from unknown host", () => {
  const html = `
    <!doctype html>
    <html>
    <head>
      <meta name="DC.title" content="조선 후기 읍성의 축조와 공간 재편">
      <meta name="DC.creator" content="홍길동">
      <meta name="DC.publisher" content="조선역사학회">
      <meta name="DC.issued" content="1999-05-10">
    </head>
    <body>
      <p>본문 내용...</p>
    </body>
    </html>
  `;
  const actual = metadata.parseFixtureHtml(html, "https://nonacademic.example.com/some-page");
  
  assert.equal(actual.source, "unknown");
  assert.equal(actual.titleMain, "조선 후기 읍성의 축조와 공간 재편");
  assert.deepEqual(actual.authors, ["홍길동"]);
  assert.equal(actual.publisher, "조선역사학회");
  assert.equal(actual.year, "1999");
});

test("Open Graph and title tag fallbacks are correctly parsed from unknown host", () => {
  const html = `
    <!doctype html>
    <html>
    <head>
      <title>일반 블로그 글 제목: 서브 타이틀</title>
      <meta property="og:site_name" content="티스토리">
      <meta name="author" content="김영희;박철수">
    </head>
    <body>
      <p>이 글은 2024년도 연구에 관한 것입니다.</p>
    </body>
    </html>
  `;
  const actual = metadata.parseFixtureHtml(html, "https://blog.example.com/post/123");
  
  assert.equal(actual.source, "unknown");
  assert.equal(actual.titleMain, "일반 블로그 글 제목");
  assert.equal(actual.titleSub, "서브 타이틀");
  assert.deepEqual(actual.authors, ["김영희", "박철수"]);
  assert.equal(actual.journalName, "티스토리");
  assert.equal(actual.year, "2024");
});

test("JSON-LD metadata is correctly parsed from unknown host", () => {
  const html = `
    <!doctype html>
    <html>
    <head>
      <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "ScholarlyArticle",
        "headline": "JSON-LD 기반의 구조화된 서지 정보 추출법",
        "author": [
          { "@type": "Person", "name": "이순신" },
          { "@type": "Person", "name": "강감찬" }
        ],
        "datePublished": "2026-06-15",
        "publisher": {
          "@type": "Organization",
          "name": "대한학술원"
        },
        "isPartOf": {
          "@type": "Periodical",
          "name": "구조화데이터학보"
        },
        "pageStart": "150",
        "pageEnd": "180"
      }
      </script>
    </head>
    <body>
      <p>Content</p>
    </body>
    </html>
  `;
  const actual = metadata.parseFixtureHtml(html, "https://blog.example.com/ld-json-post");
  
  assert.equal(actual.source, "unknown");
  assert.equal(actual.titleMain, "JSON-LD 기반의 구조화된 서지 정보 추출법");
  assert.deepEqual(actual.authors, ["이순신", "강감찬"]);
  assert.equal(actual.publisher, "대한학술원");
  assert.equal(actual.journalName, "구조화데이터학보");
  assert.equal(actual.year, "2026");
  assert.equal(actual.pageFirst, "150");
  assert.equal(actual.pageLast, "180");
});

test("hasUsefulMetadata returns true with single field present", () => {
  const hasUsefulMetadata = (meta) => {
    if (!meta) return false;
    const authors = Array.isArray(meta.authors) ? meta.authors : [];
    return Boolean(
      meta.titleMain ||
      authors.length ||
      meta.journalName ||
      meta.publisher ||
      meta.year ||
      meta.pageFirst
    );
  };
  
  assert.ok(hasUsefulMetadata({ titleMain: "제목만 존재" }));
  assert.ok(hasUsefulMetadata({ authors: ["저자만 존재"] }));
  assert.ok(hasUsefulMetadata({ year: "2026" }));
  assert.ok(!hasUsefulMetadata({}));
});

test("isAcademicSite accurately filters domestic academic URLs", () => {
  assert.ok(constants.isAcademicSite("https://www.dbpia.co.kr/journal/articleDetail?nodeId=NODE00832805"));
  assert.ok(constants.isAcademicSite("https://dbpia-co-kr-ssl.openlib.uos.ac.kr/journal/articleDetail?nodeId=NODE00832805"));
  assert.ok(constants.isAcademicSite("https://www.riss.kr/search/detail/DetailView.do?p_mat_type=1"));
  assert.ok(constants.isAcademicSite("https://scholar.google.co.kr/scholar?hl=ko&q=test"));
  assert.ok(constants.isAcademicSite("https://dcollection.uos.ac.kr/jsp/common/DcResultDownload.jsp?id=123"));
  
  // Non-academic sites should return false
  assert.ok(!constants.isAcademicSite("https://www.naver.com/"));
  assert.ok(!constants.isAcademicSite("https://news.naver.com/main/read.nhn?mode=LSD&mid=shm&sid1=105&oid=001&aid=00000001"));
  assert.ok(!constants.isAcademicSite("https://www.google.com/search?q=test"));
});

test("default settings has includePages as false", () => {
  const settings = filename.safeSettings();
  assert.equal(settings.includePages, false);
});

test("default template does not end with pages field", () => {
  const lastToken = filename.DEFAULT_TEMPLATE[filename.DEFAULT_TEMPLATE.length - 1];
  assert.notEqual(lastToken.value, "pages");
});

test("isAcademicMainPage returns true for main page URLs and yields empty metadata", () => {
  const rissMain = "https://www.riss.kr/index.do";
  const rissProxyMain = "https://www-riss-kr-ssl.openlib.uos.ac.kr/";
  
  const doc = {
    title: "RISS(리스,학술연구정보서비스) 국내·국외 학술정보를 제공하는 대국민 서비스",
    documentElement: { textContent: "Copyright KERIS. ALL RIGHTS RESERVED." },
    body: { textContent: "Copyright KERIS. ALL RIGHTS RESERVED." }
  };
  
  const parsed1 = metadata.extractFromDocument(doc, rissMain);
  assert.equal(parsed1.titleMain, "");
  assert.deepEqual(parsed1.authors, []);
  
  const parsed2 = metadata.extractFromDocument(doc, rissProxyMain);
  assert.equal(parsed2.titleMain, "");
  assert.deepEqual(parsed2.authors, []);
});

test("isUsableTitle and cleanAuthorName filters copyright and site promo texts", () => {
  const doc = {
    title: "Copyright KERIS. ALL RIGHTS RESERVED.",
    documentElement: { textContent: "Copyright KERIS. ALL RIGHTS RESERVED." }
  };
  const parsed = metadata.extractFromDocument(doc, "https://www.riss.kr/search/detail/DetailView.do?p_mat_type=1");
  assert.equal(parsed.titleMain, "");
  assert.deepEqual(parsed.authors, []);
});

test("splitTitle removes brackets paper prefixes like [논문]", () => {
  const parsed = metadata.splitTitle("[논문]장기간 조위관측자료 분석과 GPS 수준측량 수준원점 성과 재정의");
  assert.equal(parsed.titleMain, "장기간 조위관측자료 분석과 GPS 수준측량 수준원점 성과 재정의");
});

test("normalizeMetadata cleans journal english full names and parenthesized english titles", () => {
  const meta = {
    journalName: "한국측량학회지 = Journal of the Korean Society of Surveying, Geodesy, Photogrammetry and Cartography"
  };
  const parsed = metadata.normalizeMetadata(meta);
  assert.equal(parsed.journalName, "한국측량학회지");
});

test("applyFactsToMetadata falls back to publisher institution if thesisInfo lack university", () => {
  const facts = {
    "학위논문사항": "학위논문(석사), 2025",
    "발행기관": "서울시립대학교 일반대학원"
  };
  const parsed = metadata.applyFactsToMetadata(metadata.blankMetadata(), facts);
  assert.equal(parsed.thesisInstitution, "서울시립대학교");
  assert.equal(parsed.thesisDegree, "석사학위논문");
  assert.equal(parsed.publisher, "서울시립대학교 석사학위논문");
});

test("dCollection detectSource detects dCollection urls", () => {
  assert.equal(metadata.detectSource("https://snu.dcollection.net/jsp/common/DcSearchSetLink.jsp?sItemId=000001234567"), "dCollection");
  assert.equal(metadata.detectSource("https://viewer.dcollection.net/originalViewer.jsp?streamdocsId=72059375539019568"), "dCollection");
});

test("dCollection service title is not accepted as paper metadata", () => {
  const actual = metadata.parseFixtureHtml(`
    <!doctype html>
    <html lang="ko">
    <head><title>dCollection 디지털 학술정보 유통시스템</title></head>
    <body>Copyright 2026 dCollection 디지털 학술정보 유통시스템</body>
    </html>
  `, "https://viewer.dcollection.net/originalViewer.jsp?streamdocsId=72059375539019568");

  assert.equal(actual.source, "dCollection");
  assert.equal(actual.titleMain, "");
  assert.deepEqual(actual.authors, []);
});

test("dCollection search result row text yields the clicked paper metadata", () => {
  const actual = metadata.parseResultText(`
    107  분산점칼만필터를 이용한 휴머노이드 로봇 SLAM 아키텍쳐
    유정기 | 大田大學校 産業技術硏究所 | 2015 | 산업기술연구소 論文集 | Vol.26 No.2
    원문보기
    For a humanoid robot, its non-linear constraints have to be considered for developing a navigation architecture.
  `, "dCollection", "https://uos.dcollection.net/search");

  assert.deepEqual(actual.authors, ["유정기"]);
  assert.equal(actual.titleMain, "분산점칼만필터를 이용한 휴머노이드 로봇 SLAM 아키텍쳐");
  assert.equal(actual.journalName, "산업기술연구소 論文集");
  assert.equal(actual.volume, "26");
  assert.equal(actual.issue, "2");
  assert.equal(actual.year, "2015");
});

test("background ignores dCollection viewer service metadata", () => {
  background._state.reset();
  const now = Date.now();

  background.rememberContext({
    metadata: {
      authors: [],
      titleMain: "dCollection 디지털 학술정보 유통시스템",
      year: "2026",
      source: "dCollection",
      pageUrl: "https://viewer.dcollection.net/originalViewer.jsp?streamdocsId=72059375539019568"
    },
    pageUrl: "https://viewer.dcollection.net/originalViewer.jsp?streamdocsId=72059375539019568",
    capturedAt: now
  }, { tab: { id: 51 }, frameId: 0 });

  assert.equal(background._state.pendingContexts.length, 0);
});

test("dCollection viewer background match links details using streamdocsId", () => {
  background._state.reset();
  const now = Date.now();

  // 1. 상세페이지에서 "원문보기" 클릭 시뮬레이션
  const downloadUrl = "https://viewer.dcollection.net/originalViewer.jsp?streamdocsId=72059375539019568";

  const dcolMeta = {
    authors: ["정태준"],
    titleMain: "인공지능을 활용한 매장유산 분포 예측 통합 연구",
    publisher: "서울시립대학교 석사학위논문",
    year: "2025",
    originalFilename: "article.pdf",
    source: "dCollection",
    pageUrl: "https://snu.dcollection.net/jsp/common/DcSearchSetLink.jsp?sItemId=000001234567"
  };

  background.rememberContext({
    metadata: dcolMeta,
    pageUrl: "https://snu.dcollection.net/jsp/common/DcSearchSetLink.jsp?sItemId=000001234567",
    downloadUrl: downloadUrl,
    capturedAt: now
  }, { tab: { id: 5 }, frameId: 0 });

  // 2. 뷰어 창에서 실제 다운로드 시뮬레이션
  const entry = background.chooseContextEntry({
    tabId: 9, // 다른 탭 (새 창)
    url: "https://viewer.dcollection.net/streamdocs/view/sd;streamdocsId=72059375539019568",
    filename: "originalViewer.pdf"
  }, now + 500);

  assert.ok(entry);
  assert.equal(entry.context.metadata.titleMain, "인공지능을 활용한 매장유산 분포 예측 통합 연구");
});

test("constants.isBlacklistedSite returns true for blacklisted domains", () => {
  assert.ok(constants.isBlacklistedSite("https://portal.nrich.go.kr/page"));
  assert.ok(constants.isBlacklistedSite("https://www.heritage.go.kr/download/file"));
  assert.ok(!constants.isBlacklistedSite("https://www.riss.kr/search/detail/DetailView.do"));
});

test("background ignores blacklisted site downloads", () => {
  background._state.reset();
  const now = Date.now();

  background.rememberContext({
    metadata: fullMeta,
    pageUrl: "https://portal.nrich.go.kr/page",
    downloadUrl: "",
    capturedAt: now
  }, { tab: { id: 8 }, frameId: 0 });

  background.findContextEntry({
    tabId: 8,
    url: "https://portal.nrich.go.kr/download/pdf",
    filename: "report.pdf"
  }, (entry) => {
    assert.equal(entry, null);
  });
});

test("hasContextMetadata filters out polluted author lists containing organizations", () => {
  // 정상 데이터
  assert.ok(background.hasContextMetadata({
    metadata: {
      authors: ["김영희", "박철수"],
      titleMain: "정상 논문 제목"
    }
  }));

  // 비정상 데이터: 저자명 총합 40자 초과
  assert.ok(!background.hasContextMetadata({
    metadata: {
      authors: ["한국전통문화대학교 국립고궁박물관 국립무형유산원 국립문화유산연구원 국립해양유산연구소 궁능유적본부"],
      titleMain: "오염된 논문 제목"
    }
  }));

  // 비정상 데이터: 저자명에 기관 키워드 2개 이상 포함
  assert.ok(!background.hasContextMetadata({
    metadata: {
      authors: ["서울시립대학교", "국립문화유산연구원"],
      titleMain: "오염된 논문 제목"
    }
  }));
});

test("background matches context even after 15 minutes", () => {
  background._state.reset();
  const now = Date.now();

  background.rememberContext({
    metadata: fullMeta,
    pageUrl: "https://scienceon.kisti.re.kr/srch/selectPORSrchArticle.do?cn=JAKO201020733098474",
    downloadUrl: "",
    capturedAt: now - 15 * 60 * 1000 // 15분 전
  }, { tab: { id: 10 }, frameId: 0 });

  const entry = background.chooseContextEntry({
    tabId: 10,
    url: "https://scienceon.kisti.re.kr/commons/util/originalView.do",
    filename: "download.pdf"
  }, now);

  assert.ok(entry);
  assert.equal(entry.context.metadata.titleMain, fullMeta.titleMain);
});

test("background matches sameKnownPaperHost with relaxed subdomains", () => {
  background._state.reset();
  const now = Date.now();

  background.rememberContext({
    metadata: fullMeta,
    pageUrl: "https://scienceon.kisti.re.kr/srch/selectPORSrchArticle.do?cn=JAKO201020733098474",
    downloadUrl: "",
    capturedAt: now
  }, { tab: { id: 11 }, frameId: 0 });

  // 다운로드 서버가 서브도메인이 다른 'pdf.scienceon.kisti.re.kr' 등일 때
  const entry = background.chooseContextEntry({
    tabId: 11,
    url: "https://pdf.scienceon.kisti.re.kr/commons/util/originalView.do",
    filename: "download.pdf"
  }, now + 100);

  assert.ok(entry);
  assert.equal(entry.context.metadata.titleMain, fullMeta.titleMain);
});

test("viewer page matches download using tabId thanks to initial context", () => {
  background._state.reset();
  const now = Date.now();

  // 뷰어 페이지가 로드되었을 때 (content.js 시뮬레이션)
  background.rememberContext({
    metadata: fullMeta,
    pageUrl: "https://scienceon.kisti.re.kr/commons/util/originalView.do?cn=JAKO201020733098474",
    downloadUrl: "",
    capturedAt: now
  }, { tab: { id: 15 }, frameId: 0 }); // tabId는 15

  // 뷰어 탭 내부에서 PDF 다운로드 클릭 시 (tabId는 15)
  const entry = background.chooseContextEntry({
    tabId: 15,
    url: "https://scienceon.kisti.re.kr/commons/util/pdfDownload.do",
    filename: "download.pdf"
  }, now + 500);

  assert.ok(entry);
  assert.equal(entry.context.metadata.titleMain, fullMeta.titleMain);
});

test("tabs openerTabId relation copies parent context to viewer tab", () => {
  background._state.reset();
  const now = Date.now();

  // 1. 상세페이지 탭(ID: 20)에서 서지 정보가 등록됨
  background.rememberContext({
    metadata: fullMeta,
    pageUrl: "https://snu.dcollection.net/jsp/common/DcSearchSetLink.jsp?sItemId=000001234567",
    downloadUrl: "",
    capturedAt: now
  }, { tab: { id: 20 }, frameId: 0 });

  // 2. 부모 탭(ID: 20)에 의해 새 뷰어 탭(ID: 25)이 열렸을 때 (탭 관계 이벤트 전파 시뮬레이션)
  background.handleTabRelation({
    id: 25,
    url: "https://viewer.dcollection.net/originalViewer.jsp?streamdocsId=144116969580369159",
    openerTabId: 20
  });

  // 3. 자식 뷰어 탭(ID: 25)에서 PDF 다운로드 시뮬레이션
  const entry = background.chooseContextEntry({
    tabId: 25,
    url: "https://viewer.dcollection.net/streamdocs/view/sd;streamdocsId=144116969580369159",
    filename: "download.pdf"
  }, now + 500);

  // 4. 동일 탭 매칭(tabId: 25)을 통해 매칭 성공하고 부모 탭의 정보 복구 확인
  assert.ok(entry);
  assert.equal(entry.context.metadata.titleMain, fullMeta.titleMain);
});

test("tabs openerTabId relation ignores stale parent context", () => {
  background._state.reset();
  const now = Date.now();
  const staleMeta = Object.assign({}, fullMeta, {
    titleMain: "stale parent paper",
    source: "dCollection"
  });

  background.rememberContext({
    metadata: staleMeta,
    pageUrl: "https://snu.dcollection.net/jsp/common/DcSearchSetLink.jsp?sItemId=old-paper",
    downloadUrl: "",
    capturedAt: now - 6000
  }, { tab: { id: 30 }, frameId: 0 });

  background.handleTabRelation({
    id: 31,
    url: "https://viewer.dcollection.net/originalViewer.jsp?streamdocsId=new-paper",
    openerTabId: 30
  });

  assert.ok(!background._state.pendingContexts.some((entry) => entry.tabId === 31));
  assert.equal(background.chooseContextEntry({
    tabId: 31,
    url: "https://viewer.dcollection.net/streamdocs/view/sd;streamdocsId=new-paper",
    filename: "download.pdf"
  }, now), null);
});

test("tabs openerTabId relation copies fresh parent context", () => {
  background._state.reset();
  const now = Date.now();
  const freshMeta = Object.assign({}, fullMeta, {
    titleMain: "fresh parent paper",
    source: "dCollection"
  });

  background.rememberContext({
    metadata: freshMeta,
    pageUrl: "https://snu.dcollection.net/jsp/common/DcSearchSetLink.jsp?sItemId=fresh-paper",
    downloadUrl: "",
    capturedAt: now - 2000
  }, { tab: { id: 40 }, frameId: 0 });

  background.handleTabRelation({
    id: 41,
    url: "https://viewer.dcollection.net/originalViewer.jsp?streamdocsId=fresh-paper",
    openerTabId: 40
  });

  const copied = background._state.pendingContexts.find((entry) => entry.tabId === 41);
  assert.ok(copied);
  assert.equal(copied.context.metadata.titleMain, "fresh parent paper");
});

module.exports = Promise.all(pendingTests);
