const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');
const { createWorker } = require('./helpers/chrome.cjs');
const policy = require('../src/site-policy.js');
const metadata = require('../src/metadata.js');
const root = path.join(__dirname, '..');
const meta = { authors: ['홍길동'], year: '2025', titleMain: '학교 프록시를 통한 논문 다운로드', journalName: '학술지', source: 'unknown' };
function seed(worker, context, frameId = 0) {
  worker.message({ type: 'paper-rename-download-context', context: { metadata: meta, capturedAt: Date.now(), ...context } }, { tab: { id: 22 }, frameId });
}
function content(html, url, options = {}) {
  const { document, window } = parseHTML(html);
  const messages = [], timers = [], listeners = [];
  const context = vm.createContext({ document, window, location: new URL(url), URL, TextEncoder,
    console, setTimeout(fn) { timers.push(fn); }, clearTimeout() {},
    chrome: { runtime: { id: 'arbitrary-local-id', sendMessage(message, cb) { messages.push(message); cb?.(); }, onMessage: { addListener(fn) { listeners.push(fn); } } } } });
  for (const file of require('../manifest.json').content_scripts[0].js) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  if (options.afterLoad) options.afterLoad(document);
  timers.splice(0).forEach(fn => fn());
  return { document, messages, listeners };
}
const html = `<!doctype html><html><head><title>논문 제목</title>
<meta name="citation_title" content="학교 프록시를 통한 논문 다운로드">
<meta name="citation_author" content="홍길동"><meta name="citation_publication_date" content="2025">
<meta name="citation_journal_title" content="학술지"><meta name="citation_pdf_url" content="/pdf/123">
</head><body><a href="/pdf/123">PDF 다운로드</a></body></html>`;

test('opaque university proxy with scholarly meta tags publishes usable download context', async t => {
  const page = content(html, 'https://opaque.proxy.any-school.edu/article/123');
  assert.equal(page.messages.length, 1);
  const captured = page.messages[0].context;
  assert.equal(captured.scholarly, true); assert.equal(captured.metadata.titleMain, meta.titleMain);
  assert.equal(captured.downloadUrl, 'https://opaque.proxy.any-school.edu/pdf/123');
  const worker = createWorker(root); t.after(() => worker.dispose());
  seed(worker, captured, 7);
  const [result] = await worker.download({ id: 1, url: captured.downloadUrl, filename: 'download.pdf', mime: 'application/pdf' });
  assert.ok(result.filename.includes(meta.titleMain));
  assert.equal(worker.external.length, 0);
});
test('unknown publisher in HTTP iframe can be read by popup through its tab cache', t => {
  const page = content(html, 'http://journal.proxy.different-college.edu/article/123');
  assert.equal(page.messages.length, 1);
  const worker = createWorker(root); t.after(() => worker.dispose()); seed(worker, page.messages[0].context, 4);
  const info = worker.message({ type: 'paper-rename-get-tab-page-info', tabId: 22 });
  assert.equal(info.academic, true); assert.equal(info.metadata.titleMain, meta.titleMain);
  assert.equal(worker.message({ type: 'paper-rename-get-tab-page-info', tabId: 23 }).success, false);
  const script = require('../manifest.json').content_scripts[0];
  assert.ok(script.all_frames && script.match_about_blank && script.match_origin_as_fallback);
  assert.ok(script.matches.includes('http://*/*'));
});
test('scholarly JSON-LD on an unknown publisher is accepted, news Article is not', () => {
  const make = type => `<html><head><script type="application/ld+json">${JSON.stringify({ '@type': type, headline: meta.titleMain, author: { '@type': 'Person', name: '홍길동' }, datePublished: '2025', isPartOf: { name: '학술지' } })}</script></head><body></body></html>`;
  assert.equal(content(make('ScholarlyArticle'), 'https://opaque.school.example/paper/1').messages.length, 1);
  assert.equal(content(make('Article'), 'https://news.example/article/1').messages.length, 0);
});
test('ordinary pages, portal login screens and report pages never publish paper contexts', () => {
  assert.equal(content('<html><head><title>일반 문서</title><meta property="og:title" content="일반 문서"></head><body>Hello</body></html>', 'https://ordinary.example/page').messages.length, 0);
  assert.equal(content(html, 'https://portal.any-school.edu/login').messages.length, 0);
  assert.equal(content(html, 'https://www.heritage.go.kr/article/123').messages.length, 0);
});
test('late scholarly metadata starts capture without school-domain configuration', () => {
  const page = content('<html><head><title>Loading</title></head><body></body></html>', 'https://opaque.other.edu/article/123', {
    afterLoad(doc) { doc.head.innerHTML = parseHTML(html).document.head.innerHTML; }
  });
  assert.equal(page.messages.length, 1); assert.equal(page.messages[0].context.metadata.titleMain, meta.titleMain);
});
test('normalization is shared across source-specific parsers and site classification', () => {
  for (const url of ['https://www-kci-go-kr-ssl.proxy.any.edu/kciportal/ci/article?artiId=1',
    'https://gateway.other.edu/route?url=https%3A%2F%2Fwww.kci.go.kr%2Fkciportal%2Fci%2Farticle%3FartiId%3D1']) {
    assert.equal(policy.isAcademicSite(url), true); assert.equal(metadata.detectSource(url), 'KCI');
  }
  assert.equal(metadata.detectSource('https://krm-or-kr.proxy.any.edu/article'), 'KRM');
  assert.equal(policy.isAcademicSite('blob:https://www-riss-kr-ssl.any-school.edu/id'), true);
  assert.equal(policy.isAcademicSite('https://example.org/search?q=https://www.riss.kr/'), false);
  assert.equal(policy.isAcademicSite('https://example.org/download/scienceon-report.pdf'), false);
});
test('metadata-less academic download yields without requesting a report filename', async t => {
  const worker = createWorker(root); t.after(() => worker.dispose());
  const results = await worker.download({ id: 2, url: 'https://www.riss.kr/download.pdf', filename: 'download.pdf' });
  assert.ok(results.every(value => !value)); assert.equal(worker.external.length, 0);
  assert.equal(worker.chrome.runtime.onMessageExternal.listeners.length, 0);
});
test('unknown CDN downloads require an exact URL or page referrer, never just an active tab', async t => {
  const worker = createWorker(root); t.after(() => worker.dispose());
  seed(worker, { scholarly: true, pageUrl: 'https://opaque.any.edu/article/123', downloadUrl: 'https://cdn.example.org/signed/123' });
  assert.ok((await worker.download({ id: 3, url: 'https://unrelated.example.org/download.pdf', filename: 'download.pdf' })).every(value => !value));
  const [result] = await worker.download({ id: 4, url: 'https://cdn.example.org/signed/123', filename: 'download.pdf' });
  assert.ok(result.filename.includes(meta.titleMain));
});
test('school-proxied report downloads remain archreport responsibility', async t => {
  const worker = createWorker(root); t.after(() => worker.dispose());
  seed(worker, { scholarly: true, pageUrl: 'https://paper.proxy.any.edu/article/123', downloadUrl: 'https://www-heritage-go-kr.proxy.any.edu/download.pdf' });
  assert.ok((await worker.download({ id: 5, url: 'https://www-heritage-go-kr.proxy.any.edu/download.pdf', filename: 'download.pdf' })).every(value => !value));
});
test('OFF is honored on worker startup and retained contexts do not rename', async t => {
  const worker = createWorker(root, { data: { paperRenameSettings: { enabled: false } } }); t.after(() => worker.dispose());
  seed(worker, { pageUrl: 'https://www.riss.kr/detail', downloadUrl: 'https://www.riss.kr/download.pdf' });
  assert.ok((await worker.download({ id: 6, url: 'https://www.riss.kr/download.pdf', filename: 'download.pdf' })).every(value => !value));
});
test('unresponsive storage does not leave the download indefinitely pending', async t => {
  const worker = createWorker(root, { hangStorage: true, fastTimeouts: true }); t.after(() => worker.dispose());
  assert.ok((await worker.download({ id: 7, url: 'https://www.riss.kr/download.pdf', filename: 'download.pdf' })).every(value => !value));
});
test('iframe popup metadata survives download consumption and worker restart, but not navigation', async t => {
  const worker = createWorker(root); t.after(() => worker.dispose());
  const url = 'https://opaque.any-school.edu/pdf/123';
  seed(worker, { scholarly: true, pageUrl: 'https://opaque.any-school.edu/article/123', downloadUrl: url }, 4);
  assert.ok((await worker.download({ id: 8, url, filename: 'download.pdf' }))[0]);
  const restarted = createWorker(root, { data: worker.data }); t.after(() => restarted.dispose());
  assert.equal(restarted.message({ type: 'paper-rename-get-tab-page-info', tabId: 22 }).metadata.titleMain, meta.titleMain);
  restarted.chrome.tabs.onUpdated.listeners.forEach(fn => fn(22, { status: 'loading' }, { id: 22 }));
  assert.equal(restarted.message({ type: 'paper-rename-get-tab-page-info', tabId: 22 }).success, false);
});
