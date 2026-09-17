// node tests/coexistence.cjs ../archreport
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createWorker } = require('./helpers/chrome.cjs');
const paperRoot = path.join(__dirname, '..');
const reportRoot = path.resolve(process.argv[2] || path.join(paperRoot, '../archreport'));
const reportContext = { source: 'heritage', agency: '보고서기관', year: '2026', reportTitle: '보고서 제목',
  pageUrl: 'https://www.heritage.go.kr/detail', downloadUrl: 'https://www.heritage.go.kr/download.pdf',
  originalFilename: 'download.pdf', capturedAt: Date.now() };
async function main() {
  assert.equal(fs.readFileSync(path.join(paperRoot, 'src/site-policy.js'), 'utf8'), fs.readFileSync(path.join(reportRoot, 'src/site-policy.js'), 'utf8'));
  let count = 0;
  for (const url of ['https://www.riss.kr/download.pdf', 'https://history.seoul.go.kr/download.pdf',
    'blob:https://www-riss-kr-ssl.proxy.any-school.edu/guid', 'https://opaque.proxy.other.edu/pdf/123',
    'https://www.heritage.go.kr/download.pdf']) {
    for (const reverse of [false, true]) {
      const report = createWorker(reportRoot, { id: 'random-report-id' });
      const paper = createWorker(paperRoot, { id: 'random-paper-id' });
      try {
        report.message({ type: 'arch-report-download-context', context: reportContext }, { tab: { id: 11 }, frameId: 0 });
        paper.message({ type: 'paper-rename-download-context', context: {
          scholarly: true, metadata: { titleMain: '논문 제목', authors: ['논문저자'], year: '2025' },
          pageUrl: url, downloadUrl: url, originalFilename: 'download.pdf', capturedAt: Date.now()
        } });
        const item = { id: 100 + count, url, finalUrl: url, filename: 'download.pdf', mime: 'application/pdf' };
        const order = reverse ? [paper, report] : [report, paper];
        const suggestions = [];
        for (const worker of order) suggestions.push(...await worker.download(item));
        const explicit = suggestions.filter(Boolean);
        assert.equal(explicit.length, 1, `Exactly one owner: ${url}`);
        assert.ok(explicit[0].filename.includes(url.includes('heritage.go.kr') ? '보고서 제목' : '논문 제목'));
        assert.equal(report.external.length + paper.external.length, 0);
        count++;
      } finally { report.dispose(); paper.dispose(); }
    }
  }
  console.log(`PASS: shared URL policy + ${count} paired worker scenarios, both callback orders, arbitrary extension IDs.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
