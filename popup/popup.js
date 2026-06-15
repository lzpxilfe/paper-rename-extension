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
  const PRESETS = {
    default: {
      template: [
        { kind: "field", value: "authors" },
        { kind: "separator", value: "commaSpace" },
        { kind: "field", value: "year" },
        { kind: "separator", value: "commaSpace" },
        { kind: "field", value: "title" },
        { kind: "separator", value: "commaSpace" },
        { kind: "field", value: "journal" },
        { kind: "separator", value: "space" },
        { kind: "field", value: "volumeIssue" },
        { kind: "separator", value: "commaSpace" },
        { kind: "field", value: "publisher" }
      ],
      includePages: false
    },
    academic: {
      template: [
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
        { kind: "field", value: "year" }
      ],
      includePages: false
    },
    apa: {
      template: [
        { kind: "field", value: "authors" },
        { kind: "separator", value: "space" },
        { kind: "separator", value: "openParen" },
        { kind: "field", value: "year" },
        { kind: "separator", value: "closeParen" },
        { kind: "separator", value: "commaSpace" },
        { kind: "field", value: "title" },
        { kind: "separator", value: "commaSpace" },
        { kind: "field", value: "journal" },
        { kind: "separator", value: "commaSpace" },
        { kind: "field", value: "volumeIssue" }
      ],
      includePages: false
    },
    chicago: {
      template: [
        { kind: "field", value: "authors" },
        { kind: "separator", value: "commaSpace" },
        { kind: "field", value: "year" },
        { kind: "separator", value: "commaSpace" },
        { kind: "field", value: "title" },
        { kind: "separator", value: "commaSpace" },
        { kind: "field", value: "journal" },
        { kind: "separator", value: "commaSpace" },
        { kind: "field", value: "volumeIssue" },
        { kind: "separator", value: "commaSpace" },
        { kind: "field", value: "publisher" }
      ],
      includePages: false
    },
    ieee: {
      template: [
        { kind: "field", value: "authors" },
        { kind: "separator", value: "commaSpace" },
        { kind: "field", value: "title" },
        { kind: "separator", value: "commaSpace" },
        { kind: "field", value: "journal" },
        { kind: "separator", value: "commaSpace" },
        { kind: "field", value: "volumeIssue" },
        { kind: "separator", value: "commaSpace" },
        { kind: "field", value: "year" }
      ],
      includePages: false
    },
    "year-first": {
      template: [
        { kind: "field", value: "year" },
        { kind: "separator", value: "commaSpace" },
        { kind: "field", value: "authors" },
        { kind: "separator", value: "commaSpace" },
        { kind: "field", value: "title" }
      ],
      includePages: false
    }
  };

  let customPresets = {};
  const CUSTOM_PRESETS_STORAGE_KEY = "paperRenameCustomPresets";

  function isSameTemplate(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((token, index) => {
      const other = right[index];
      return token &&
        other &&
        token.kind === other.kind &&
        token.value === other.value &&
        String(token.text || "") === String(other.text || "");
    });
  }

  function renderPresetSelectOptions() {
    if (!els.presetSelect) return;
    const existingGroup = document.getElementById("custom-presets-group");
    if (existingGroup) {
      existingGroup.remove();
    }
    const keys = Object.keys(customPresets);
    if (keys.length === 0) return;

    const group = document.createElement("optgroup");
    group.id = "custom-presets-group";
    group.label = "사용자 지정 프리셋";

    keys.forEach((key) => {
      const opt = document.createElement("option");
      opt.value = `custom_${key}`;
      opt.textContent = key;
      group.appendChild(opt);
    });
    els.presetSelect.appendChild(group);
  }

  function syncPresetSelect() {
    if (!els.presetSelect) return;
    let found = "custom";
    for (const [key, preset] of Object.entries(PRESETS)) {
      if (isSameTemplate(settings.template, preset.template) && settings.includePages === preset.includePages) {
        found = key;
        break;
      }
    }
    if (found === "custom") {
      for (const [key, preset] of Object.entries(customPresets)) {
        if (isSameTemplate(settings.template, preset.template) && settings.includePages === preset.includePages) {
          found = `custom_${key}`;
          break;
        }
      }
    }
    els.presetSelect.value = found;

    if (els.deletePresetBtn) {
      els.deletePresetBtn.style.display = found.startsWith("custom_") ? "inline-block" : "none";
    }
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
    syncPresetSelect();
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
    updateCitation();
  }

  function updateCitation() {
    const citationModule = globalThis.PaperRenameCitation;
    if (!citationModule || !els.citationOutput) {
      return;
    }
    els.citationOutput.value = citationModule.renderFullCitation(currentMetadata, settings);
  }

  function syncMetaInputs() {
    if (!els.metaInputs) {
      return;
    }
    const authorsVal = (currentMetadata.authors || []).join(", ");
    els.metaInputs.authors.value = authorsVal;
    els.metaInputs.authors.title = authorsVal;

    const titleMainVal = currentMetadata.titleMain || "";
    els.metaInputs.titleMain.value = titleMainVal;
    els.metaInputs.titleMain.title = titleMainVal;

    const titleSubVal = currentMetadata.titleSub || "";
    els.metaInputs.titleSub.value = titleSubVal;
    els.metaInputs.titleSub.title = titleSubVal;

    const journalVal = currentMetadata.journalName || "";
    els.metaInputs.journal.value = journalVal;
    els.metaInputs.journal.title = journalVal;

    const volumeVal = currentMetadata.volume || "";
    els.metaInputs.volume.value = volumeVal;
    els.metaInputs.volume.title = volumeVal;

    const issueVal = currentMetadata.issue || "";
    els.metaInputs.issue.value = issueVal;
    els.metaInputs.issue.title = issueVal;

    const publisherVal = currentMetadata.publisher || "";
    els.metaInputs.publisher.value = publisherVal;
    els.metaInputs.publisher.title = publisherVal;

    const yearVal = currentMetadata.year || "";
    els.metaInputs.year.value = yearVal;
    els.metaInputs.year.title = yearVal;

    const pageFirstVal = currentMetadata.pageFirst || "";
    els.metaInputs.pageFirst.value = pageFirstVal;
    els.metaInputs.pageFirst.title = pageFirstVal;

    const pageLastVal = currentMetadata.pageLast || "";
    els.metaInputs.pageLast.value = pageLastVal;
    els.metaInputs.pageLast.title = pageLastVal;

    updateCitation();
  }

  function bindMetaInputs() {
    const bindInput = (id, key, isAuthors = false) => {
      const el = document.getElementById(id);
      if (!el) {
        return;
      }
      el.addEventListener("input", () => {
        const value = el.value;
        el.title = value;
        if (isAuthors) {
          currentMetadata.authors = value.split(/[,;；]/).map((x) => x.trim()).filter(Boolean);
        } else {
          currentMetadata[key] = value;
        }
        updatePreview();
      });
      el.addEventListener("focus", () => {
        el.select();
      });
    };

    bindInput("meta-authors", "authors", true);
    bindInput("meta-title-main", "titleMain");
    bindInput("meta-title-sub", "titleSub");
    bindInput("meta-journal", "journalName");
    bindInput("meta-volume", "volume");
    bindInput("meta-issue", "issue");
    bindInput("meta-publisher", "publisher");
    bindInput("meta-year", "year");
    bindInput("meta-page-first", "pageFirst");
    bindInput("meta-page-last", "pageLast");
  }

  function bindTabs() {
    const tabBtns = document.querySelectorAll(".tab-btn");
    const tabContents = document.querySelectorAll(".tab-content");
    tabBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.dataset.tab;
        tabBtns.forEach((b) => b.classList.remove("active"));
        tabContents.forEach((c) => c.classList.remove("active"));
        btn.classList.add("active");
        const targetEl = document.getElementById(target);
        if (targetEl) {
          targetEl.classList.add("active");
        }
      });
    });
  }

  function bindCopyButtons() {
    const copyToClipboard = (text, button) => {
      if (!text) {
        return;
      }
      navigator.clipboard.writeText(text).then(() => {
        const originalText = button.textContent;
        button.textContent = button.classList.contains("copy-btn") ? "복사됨!" : "인용 표기 복사됨!";
        button.classList.add("copied");
        setTimeout(() => {
          button.textContent = originalText;
          button.classList.remove("copied");
        }, 1500);
      }).catch((err) => {
        console.error("클립보드 복사 실패", err);
      });
    };

    document.querySelectorAll(".copy-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetId = btn.dataset.target;
        const targetInput = document.getElementById(targetId);
        if (targetInput) {
          copyToClipboard(targetInput.value, btn);
        }
      });
    });

    const copyCitationBtn = document.getElementById("copy-citation");
    if (copyCitationBtn) {
      copyCitationBtn.addEventListener("click", () => {
        if (els.citationOutput) {
          copyToClipboard(els.citationOutput.value, copyCitationBtn);
        }
      });
    }
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
    const next = filename.clone(token);
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
        dragState = { source: "recipe", index, token: filename.clone(token) };
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
        dragState = { source: "palette", token: filename.clone(token) };
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
      const tabUrl = tab.url || "";
      const isAcademic = constants.isAcademicSite(tabUrl);
      if (els.academicWarning) {
        els.academicWarning.style.display = isAcademic ? "none" : "flex";
      }

      chrome.tabs.sendMessage(tab.id, { type: constants.MESSAGES.GET_PAGE_INFO }, (response) => {
        if (chrome.runtime.lastError || !response || !response.success || !response.metadata || !isAcademic) {
          if (!isAcademic) {
            currentMetadata = {
              authors: [],
              titleMain: "",
              titleSub: "",
              journalName: "",
              volume: "",
              issue: "",
              publisher: "",
              year: "",
              pageFirst: "",
              pageLast: "",
              originalFilename: "",
              source: "unknown",
              pageUrl: tabUrl
            };
            els.pageSource.textContent = "수동 입력 (비학술 페이지)";
            updatePreview();
            syncMetaInputs();
          }
          return;
        }
        currentMetadata = response.metadata;
        els.pageSource.textContent = response.metadata.source || "현재 페이지";
        updatePreview();
        syncMetaInputs();
      });
    });
  }

  function loadSettings() {
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.sync) {
      settings = filename.safeSettings();
      syncStaticInputs();
      renderRecipe();
      updateEnabledUi();
      syncMetaInputs();
      syncPresetSelect();
      return;
    }
    chrome.storage.sync.get([constants.SETTINGS_STORAGE_KEY, CUSTOM_PRESETS_STORAGE_KEY], (result) => {
      settings = filename.safeSettings(result && result[constants.SETTINGS_STORAGE_KEY]);
      customPresets = (result && result[CUSTOM_PRESETS_STORAGE_KEY]) || {};
      syncStaticInputs();
      renderRecipe();
      updateEnabledUi();
      syncMetaInputs();
      loadActiveTabMetadata();
      renderPresetSelectOptions();
      syncPresetSelect();
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
    if (els.presetSelect) {
      els.presetSelect.addEventListener("change", () => {
        const val = els.presetSelect.value;
        if (val === "custom") return;
        let preset = PRESETS[val];
        if (!preset && val.startsWith("custom_")) {
          const customKey = val.replace("custom_", "");
          preset = customPresets[customKey];
        }
        if (preset) {
          settings.template = filename.clone(preset.template);
          settings.includePages = preset.includePages;
          syncStaticInputs();
          renderRecipe();
          save();
        }
      });
    }

    if (els.savePresetBtn) {
      els.savePresetBtn.addEventListener("click", () => {
        const name = prompt("새 프리셋 이름을 입력해 주세요:");
        if (!name) return;
        const trimmed = name.trim();
        if (!trimmed) return;
        if (PRESETS[trimmed] || trimmed === "custom") {
          alert("기본 프리셋 이름과 겹칠 수 없습니다.");
          return;
        }
        customPresets[trimmed] = {
          template: filename.clone(settings.template),
          includePages: settings.includePages
        };
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.sync) {
          chrome.storage.sync.set({ [CUSTOM_PRESETS_STORAGE_KEY]: customPresets }, () => {
            renderPresetSelectOptions();
            syncPresetSelect();
          });
        } else {
          renderPresetSelectOptions();
          syncPresetSelect();
        }
      });
    }

    if (els.deletePresetBtn) {
      els.deletePresetBtn.addEventListener("click", () => {
        const val = els.presetSelect.value;
        if (!val.startsWith("custom_")) return;
        const customKey = val.replace("custom_", "");
        if (confirm(`'${customKey}' 프리셋을 삭제하시겠습니까?`)) {
          delete customPresets[customKey];
          if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.sync) {
            chrome.storage.sync.set({ [CUSTOM_PRESETS_STORAGE_KEY]: customPresets }, () => {
              renderPresetSelectOptions();
              els.presetSelect.value = "custom";
              syncPresetSelect();
            });
          } else {
            renderPresetSelectOptions();
            els.presetSelect.value = "custom";
            syncPresetSelect();
          }
        }
      });
    }
    if (els.thesisDeptMode) {
      els.thesisDeptMode.addEventListener("change", () => {
        settings.thesisDeptMode = els.thesisDeptMode.value;
        save();
      });
    }
    if (els.thesisTitleBracketMode) {
      els.thesisTitleBracketMode.addEventListener("change", () => {
        settings.thesisTitleBracketMode = els.thesisTitleBracketMode.value;
        save();
      });
    }
  }

  function syncStaticInputs() {
    els.includePages.checked = Boolean(settings.includePages);
    els.maxLength.value = String(settings.maxFilenameLength || 180);
    if (els.thesisDeptMode) {
      els.thesisDeptMode.value = settings.thesisDeptMode || "none";
    }
    if (els.thesisTitleBracketMode) {
      els.thesisTitleBracketMode.value = settings.thesisTitleBracketMode || "double";
    }
  }

  function init() {
    els.enabledToggle = document.getElementById("enabled-toggle");
    els.enabledLabel = document.getElementById("enabled-label");
    els.academicWarning = document.getElementById("academic-warning");
    els.presetSelect = document.getElementById("preset-select");
    els.savePresetBtn = document.getElementById("save-preset");
    els.deletePresetBtn = document.getElementById("delete-preset");
    els.pageSource = document.getElementById("page-source");
    els.previewOutput = document.getElementById("preview-output");
    els.recipeList = document.getElementById("recipe-list");
    els.fieldPalette = document.getElementById("field-palette");
    els.separatorPalette = document.getElementById("separator-palette");
    els.includePages = document.getElementById("include-pages");
    els.maxLength = document.getElementById("max-length");
    els.resetTemplate = document.getElementById("reset-template");
    els.status = document.getElementById("save-status");
    els.thesisDeptMode = document.getElementById("thesis-dept-mode");
    els.thesisTitleBracketMode = document.getElementById("thesis-title-bracket-mode");

    els.citationOutput = document.getElementById("citation-output");
    els.metaInputs = {
      authors: document.getElementById("meta-authors"),
      titleMain: document.getElementById("meta-title-main"),
      titleSub: document.getElementById("meta-title-sub"),
      journal: document.getElementById("meta-journal"),
      volume: document.getElementById("meta-volume"),
      issue: document.getElementById("meta-issue"),
      publisher: document.getElementById("meta-publisher"),
      year: document.getElementById("meta-year"),
      pageFirst: document.getElementById("meta-page-first"),
      pageLast: document.getElementById("meta-page-last")
    };

    renderPalette(els.fieldPalette, fieldPalette);
    renderPalette(els.separatorPalette, separatorPalette);
    bindRecipeDrop();
    bindControls();
    bindMetaInputs();
    bindTabs();
    bindCopyButtons();

    loadSettings();
    updatePreview();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
