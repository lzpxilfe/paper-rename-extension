// node tests/coexistence.cjs ../archreport
//
// 크롬의 실제 규칙을 흉내 낸다: onDeterminingFilename 리스너를 가진 확장이 여럿이면
// "나중에 설치된 확장"의 결정이 최종이다. 그 확장이 이름을 제안하지 않아도(suggest()) 그렇다.
// (실제 크로미움에서 두 최소 확장으로 확인한 동작이다. tools/e2e 참고)
// 그래서 두 확장은 서로에게 물어 같은 이름을 제안해야 하고, 이 테스트는 설치 순서와
// 상관없이 최종 결과가 맞는지 확인한다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createWorker } = require('./helpers/chrome.cjs');
const paperRoot = path.join(__dirname, '..');
const reportRoot = path.resolve(process.argv[2] || path.join(paperRoot, '../archreport'));
const STORE = { paper: 'jmbpkgngbebnonalekniidlhomcaokef', report: 'pmbgfboldeeaemikpcjnbkepldchodio' };
// 개발자 모드판 ID: manifest.json의 "key"에서 나온다.
function idFromKey(root) {
  const der = Buffer.from(require(path.join(root, 'manifest.json')).key, 'base64');
  const hex = require('node:crypto').createHash('sha256').update(der).digest('hex').slice(0, 32);
  return [...hex].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');
}
const DEV = { paper: idFromKey(paperRoot), report: idFromKey(reportRoot) };
const STRANGER = { paper: 'abcdefghijklmnopabcdefghijklmnop', report: 'ponmlkjihgfedcbaponmlkjihgfedcba' };

const reportContext = { source: 'heritage', agency: '보고서기관', year: '2026', reportTitle: '보고서 제목',
  pageUrl: 'https://www.heritage.go.kr/detail', downloadUrl: 'https://www.heritage.go.kr/download.pdf',
  originalFilename: 'download.pdf', capturedAt: Date.now() };

async function chromeOutcome(installedFirst, installedLater, item) {
  // 모든 리스너가 끝날 때까지 기다리고, 나중 설치 확장의 결정을 쓴다.
  const [first] = await installedFirst.download(item);
  const [later] = await installedLater.download(item);
  return { final: later && later.filename, first: first && first.filename, later: later && later.filename };
}

async function scenario(ids, order, url, expectFragment) {
  const report = createWorker(reportRoot, { id: ids.report });
  const paper = createWorker(paperRoot, { id: ids.paper });
  try {
    report.message({ type: 'arch-report-download-context', context: Object.assign({}, reportContext, { capturedAt: Date.now() }) }, { tab: { id: 11 }, frameId: 0 });
    paper.message({ type: 'paper-rename-download-context', context: {
      scholarly: true, metadata: { titleMain: '논문 제목', authors: ['논문저자'], year: '2025' },
      pageUrl: url, downloadUrl: url, originalFilename: 'download.pdf', capturedAt: Date.now()
    } }, { tab: { id: 22 }, frameId: 0 });
    const item = { id: Math.floor(Math.random() * 1e9), url, finalUrl: url, filename: 'download.pdf', mime: 'application/pdf', tabId: 22 };
    const [firstWorker, laterWorker] = order === 'paper-first' ? [paper, report] : [report, paper];
    const outcome = await chromeOutcome(firstWorker, laterWorker, item);
    if (expectFragment) {
      assert.ok(outcome.final && outcome.final.includes(expectFragment), `${order} ${url}: got ${JSON.stringify(outcome)}`);
      assert.equal(outcome.first, outcome.later, 'both extensions must suggest the identical name');
    } else {
      assert.ok(!outcome.final, `${order} ${url}: expected untouched, got ${JSON.stringify(outcome)}`);
    }
  } finally { report.dispose(); paper.dispose(); }
}

async function main() {
  assert.equal(fs.readFileSync(path.join(paperRoot, 'src/site-policy.js'), 'utf8'), fs.readFileSync(path.join(reportRoot, 'src/site-policy.js'), 'utf8'));
  assert.equal(fs.readFileSync(path.join(paperRoot, 'src/coop.js'), 'utf8'), fs.readFileSync(path.join(reportRoot, 'src/coop.js'), 'utf8'));
  const cases = [
    ['https://www.riss.kr/download.pdf', '논문 제목'],
    ['https://history.seoul.go.kr/download.pdf', '논문 제목'],
    ['blob:https://www-riss-kr-ssl.proxy.any-school.edu/guid', '논문 제목'],
    ['https://opaque.proxy.other.edu/pdf/123', '논문 제목'],
    ['https://www.heritage.go.kr/download.pdf', '보고서 제목']
  ];
  let count = 0;
  for (const [label, ids] of [['store IDs', STORE], ['developer-mode IDs (manifest key)', DEV]]) {
    for (const order of ['paper-first', 'report-first']) {
      for (const [url, expected] of cases) {
        await scenario(ids, order, url, expected);
        count++;
      }
    }
    console.log(`  ok: ${label}`);
  }
  // 알 수 없는 확장이 프로토콜을 흉내 내도 이름을 바꾸거나 다운로드 정보를 받지 못한다.
  {
    const paper = createWorker(paperRoot, { id: STORE.paper });
    const stranger = createWorker(reportRoot, { id: STRANGER.report });
    try {
      let answer = 'none';
      paper.chrome.runtime.onMessageExternal.listeners.forEach(fn => fn(
        { protocol: 'kr-download-filename-coop', type: 'decide', download: { id: 1, url: 'https://www.riss.kr/a.pdf' } },
        { id: STRANGER.report }, value => { answer = value; }));
      assert.equal(answer, 'none', 'unknown extension must not get an answer');
      assert.ok(paper.external.every(([id]) => id !== STRANGER.report), 'never queries unknown extensions');
    } finally { paper.dispose(); stranger.dispose(); }
    console.log('  ok: unknown extensions are ignored');
  }
  console.log(`PASS: shared policy + coop protocol, ${count} scenarios across both install orders (later-installed listener decides).`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
