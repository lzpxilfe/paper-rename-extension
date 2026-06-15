(function initPopup() {
  "use strict";

  const constants = globalThis.PaperRenameConstants;
  const filename = globalThis.PaperRenameFilename;

  const sampleMetadata = {
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
    source: "샘플",
    pageUrl: ""
  };

  const fieldPalette = [
    { kind: "field", value: "authors" },
    { kind: "field", value: "year" },
    { kind: "field", value: "title" },
    { kind: "field", value: "journal" },
    { kind: "field", value: "volumeIssue" },
    { kind: "field", value: "publisher" },
    { kind: "field", value: "pages" },
    { kind: "field", value: "originalFilename" }
  ];

  const separatorPalette = [
    { kind: "separator", value: "commaSpace", label: ", " },
    { kind: "separator", value: "space", label: "공백" },
    { kind: "separator", value: "hyphen", label: "-" },
    { kind: "separator", value: "underscore", label: "_" },
    { kind: "separator", value: "openParen", label: "(" },
    { kind: "separator", value: "closeParen", label: ")" }
  ];

  let settings = filename.safeSettings();
  let currentMetadata = sampleMetadata;
  let dragState = null;
  let dropIndex = null;
  const marker = document.createElement("span");
  marker.className = "insert-marker";

  const els = {};

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function tokenLabel(token) {
    if (token.kind === "field") {
      return filename.FIELD_LABELS[token.value] || token.value;
    }
    if (token.kind === "separator") {
      return separatorPalette.find((item) => item.value === token.value)?.label ||
        filename.resolveSeparator(token) ||
        token.value;
    }
    return token.value || "";
  }

  function tokenClass(token) {
    return token.kind === "separator" ? "separator" : "field";
  }

  function save() {
    settings = filename.safeSettings(settings);
    updatePreview();
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.sync) {
      return;
    }
    els.status.textContent = "저장 중";
    chrome.storage.sync.set({ [constants.SETTINGS_STORAGE_KEY]: settings }, () => {
      els.status.textContent = chrome.runtime.lastError ? "저장 실패" : "저장됨";
    });
  }

  function updateEnabledUi() {
    const enabled = settings.enabled !== false;
    els.enabledToggle.checked = enabled;
    els.enabledLabel.textContent = enabled ? "켜짐" : "꺼짐";
    document.body.classList.toggle("disabled-state", !enabled);
  }

  function updatePreview() {
    els.previewOutput.value = filename.renderFilename(currentMetadata, settings, { filename: "article.pdf" });
  }

  function clearMarker() {
    marker.remove();
    els.recipeList.classList.remove("drag-over");
    dropIndex = null;
  }

  function showMarker(index) {
    const chips = Array.from(els.recipeList.querySelectorAll(".chip"));
    const safeIndex = Math.max(0, Math.min(index, chips.length));
    dropIndex = safeIndex;
    els.recipeList.classList.add("drag-over");
    if (safeIndex >= chips.length) {
      els.recipeList.appendChild(marker);
    } else {
      els.recipeList.insertBefore(marker, chips[safeIndex]);
    }
  }

  function insertionIndexFromEvent(event) {
    const chips = Array.from(els.recipeList.querySelectorAll(".chip"));
    if (chips.length === 0) {
      return 0;
    }
    for (let index = 0; index < chips.length; index += 1) {
      const rect = chips[index].getBoundingClientRect();
      const midpoint = rect.left + rect.width / 2;
      if (event.clientY < rect.bottom && event.clientX < midpoint) {
        return index;
      }
      if (event.clientY < rect.bottom && event.clientX >= midpoint && index === chips.length - 1) {
        return index + 1;
      }
    }
    return chips.length;
  }

  function addToken(token, index) {
    const next = clone(token);
    const insertAt = Number.isInteger(index) ? index : settings.template.length;
    settings.template.splice(Math.max(0, Math.min(insertAt, settings.template.length)), 0, next);
    renderRecipe();
    save();
  }

  function moveToken(fromIndex, toIndex) {
    if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= settings.template.length) {
      return;
    }
    let insertAt = Math.max(0, Math.min(toIndex, settings.template.length));
    const [token] = settings.template.splice(fromIndex, 1);
    if (fromIndex < insertAt) {
      insertAt -= 1;
    }
    settings.template.splice(insertAt, 0, token);
    renderRecipe();
    save();
  }

  function removeToken(index) {
    settings.template.splice(index, 1);
    renderRecipe();
    save();
  }

  function renderRecipe() {
    els.recipeList.innerHTML = "";
    if (!settings.template.length) {
      const note = document.createElement("span");
      note.className = "empty-note";
      note.textContent = "항목 칩을 끌어 넣으세요";
      els.recipeList.appendChild(note);
      updatePreview();
      return;
    }
    settings.template.forEach((token, index) => {
      const chip = document.createElement("span");
      chip.className = `chip ${tokenClass(token)}`;
      chip.draggable = true;
      chip.dataset.index = String(index);
      chip.textContent = tokenLabel(token);
      chip.addEventListener("dragstart", (event) => {
        dragState = { source: "recipe", index, token: clone(token) };
        chip.classList.add("dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", tokenLabel(token));
      });
      chip.addEventListener("dragend", () => {
        chip.classList.remove("dragging");
        dragState = null;
        clearMarker();
      });

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "chip-remove";
      remove.setAttribute("aria-label", `${tokenLabel(token)} 제거`);
      remove.textContent = "x";
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        removeToken(index);
      });
      chip.appendChild(remove);
      els.recipeList.appendChild(chip);
    });
    updatePreview();
  }

  function renderPalette(container, tokens) {
    container.innerHTML = "";
    tokens.forEach((token) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `palette-chip ${tokenClass(token)}`;
      button.draggable = true;
      button.textContent = token.label || tokenLabel(token);
      button.addEventListener("click", () => addToken(token));
      button.addEventListener("dragstart", (event) => {
        dragState = { source: "palette", token: clone(token) };
        button.classList.add("dragging");
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("text/plain", tokenLabel(token));
      });
      button.addEventListener("dragend", () => {
        button.classList.remove("dragging");
        dragState = null;
        clearMarker();
      });
      container.appendChild(button);
    });
  }

  function bindRecipeDrop() {
    els.recipeList.addEventListener("dragover", (event) => {
      if (!dragState) {
        return;
      }
      event.preventDefault();
      showMarker(insertionIndexFromEvent(event));
      event.dataTransfer.dropEffect = dragState.source === "recipe" ? "move" : "copy";
    });
    els.recipeList.addEventListener("dragleave", (event) => {
      if (!els.recipeList.contains(event.relatedTarget)) {
        clearMarker();
      }
    });
    els.recipeList.addEventListener("drop", (event) => {
      event.preventDefault();
      if (!dragState) {
        clearMarker();
        return;
      }
      const index = Number.isInteger(dropIndex) ? dropIndex : settings.template.length;
      if (dragState.source === "recipe") {
        moveToken(dragState.index, index);
      } else {
        addToken(dragState.token, index);
      }
      dragState = null;
      clearMarker();
    });
  }

  function loadActiveTabMetadata() {
    if (typeof chrome === "undefined" || !chrome.tabs || !chrome.tabs.query) {
      return;
    }
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.id || !chrome.tabs.sendMessage) {
        return;
      }
      chrome.tabs.sendMessage(tab.id, { type: constants.MESSAGES.GET_PAGE_INFO }, (response) => {
        if (chrome.runtime.lastError || !response || !response.success || !response.metadata) {
          return;
        }
        currentMetadata = response.metadata;
        els.pageSource.textContent = response.metadata.source || "현재 페이지";
        updatePreview();
      });
    });
  }

  function loadSettings() {
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.sync) {
      settings = filename.safeSettings();
      syncStaticInputs();
      renderRecipe();
      updateEnabledUi();
      return;
    }
    chrome.storage.sync.get(constants.SETTINGS_STORAGE_KEY, (result) => {
      settings = filename.safeSettings(result && result[constants.SETTINGS_STORAGE_KEY]);
      syncStaticInputs();
      renderRecipe();
      updateEnabledUi();
      loadActiveTabMetadata();
    });
  }

  function bindControls() {
    els.enabledToggle.addEventListener("change", () => {
      settings.enabled = els.enabledToggle.checked;
      updateEnabledUi();
      save();
    });
    els.includePages.addEventListener("change", () => {
      settings.includePages = els.includePages.checked;
      save();
    });
    els.maxLength.addEventListener("change", () => {
      settings.maxFilenameLength = Number(els.maxLength.value) || 180;
      save();
    });
    els.resetTemplate.addEventListener("click", () => {
      settings.template = filename.clone(filename.DEFAULT_TEMPLATE);
      renderRecipe();
      save();
    });
  }

  function syncStaticInputs() {
    els.includePages.checked = settings.includePages !== false;
    els.maxLength.value = String(settings.maxFilenameLength || 180);
  }

  function init() {
    els.enabledToggle = document.getElementById("enabled-toggle");
    els.enabledLabel = document.getElementById("enabled-label");
    els.pageSource = document.getElementById("page-source");
    els.previewOutput = document.getElementById("preview-output");
    els.recipeList = document.getElementById("recipe-list");
    els.fieldPalette = document.getElementById("field-palette");
    els.separatorPalette = document.getElementById("separator-palette");
    els.includePages = document.getElementById("include-pages");
    els.maxLength = document.getElementById("max-length");
    els.resetTemplate = document.getElementById("reset-template");
    els.status = document.getElementById("save-status");

    renderPalette(els.fieldPalette, fieldPalette);
    renderPalette(els.separatorPalette, separatorPalette);
    bindRecipeDrop();
    bindControls();
    loadSettings();
    updatePreview();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
