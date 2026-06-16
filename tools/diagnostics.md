# 개발자용 다운로드 진단

일반 배포판 UI에는 상세 진단을 노출하지 않는다. 다운로드 URL과 페이지 URL이 들어갈 수 있으므로, 문제 재현이 필요할 때만 로컬에서 켠다.

## 켜기

확장 프로그램 서비스 워커 콘솔에서:

```js
chrome.storage.local.set({ paperRenameDiagnosticsEnabled: true });
chrome.runtime.reload();
```

## 최근 진단 보기

```js
chrome.runtime.sendMessage(
  { type: "paper-rename-get-download-diagnostics" },
  console.log
);
```

또는:

```js
chrome.storage.local.get("paperRenameDownloadDiagnostics", console.log);
```

## 끄기 및 비우기

```js
chrome.storage.local.set({
  paperRenameDiagnosticsEnabled: false,
  paperRenameDownloadDiagnostics: []
});
chrome.runtime.reload();
```
