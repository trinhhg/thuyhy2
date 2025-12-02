document.addEventListener('DOMContentLoaded', () => {
  // === CONFIG & STATE ===
  const STORAGE_KEY = 'trinh_hg_settings_v14_fix';
  const INPUT_STATE_KEY = 'trinh_hg_input_state_v14';

  const defaultState = {
    currentMode: 'default',
    activeTab: 'settings',
    modes: {
      default: { pairs: [], matchCase: false, wholeWord: false, autoCaps: false }
    }
  };

  let rawState = null;
  try { rawState = JSON.parse(localStorage.getItem(STORAGE_KEY)); }
  catch { rawState = null; }

  let state = rawState || defaultState;
  if (!state.activeTab) state.activeTab = 'settings';
  if (!state.modes || Object.keys(state.modes).length === 0) {
    state.modes = defaultState.modes;
    state.currentMode = 'default';
  }

  let currentSplitMode = 2;
  let saveTimeout;

  // DOM ELEMENTS (NULL-SAFE)
  const els = {
    modeSelect: document.getElementById('mode-select'),
    list: document.getElementById('punctuation-list'),
    inputText: document.getElementById('input-text'),
    outputText: document.getElementById('output-text'),
    splitInput: document.getElementById('split-input'),
    matchCaseBtn: document.getElementById('match-case'),
    wholeWordBtn: document.getElementById('whole-word'),
    autoCapsBtn: document.getElementById('auto-caps'),
    renameBtn: document.getElementById('rename-mode'),
    deleteBtn: document.getElementById('delete-mode'),
    emptyState: document.getElementById('empty-state')
  };

  // HELPER: notification
  function showNotification(msg, type = 'success') {
    const container = document.getElementById('notification-container');
    if (!container) return;
    const note = document.createElement('div');
    note.className = `notification ${type === 'error' ? 'error' : ''}`;
    note.textContent = msg;
    container.appendChild(note);
    setTimeout(() => {
      note.style.opacity = '0';
      setTimeout(() => note.remove(), 300);
    }, 2800);
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch {}
  }

  // Normalize smart quotes & NBSP
  function normalizeText(text) {
    if (typeof text !== 'string') return '';
    if (text.length === 0) return text;
    let normalized = text.replace(/[\u201C\u201D\u201E\u201F\u00AB\u00BB\u275D\u275E\u301D-\u301F\uFF02\u02DD"]/g, '"');
    normalized = normalized.replace(/[\u2018\u2019\u201A\u201B\u2039\u203A\u275B\u275C\u276E\u276F\uA78C\uFF07']/g, "'");
    normalized = normalized.replace(/\u00A0/g, ' ');
    return normalized;
  }

  function getTextNodes(node) {
    let out = [];
    for (let child of node.childNodes) {
      if (child.nodeType === 3) out.push(child);
      else if (child.nodeType === 1) {
        const tn = child.tagName?.toLowerCase();
        if (tn === 'mark' || tn === 'code' || tn === 'pre') continue;
        out = out.concat(getTextNodes(child));
      }
    }
    return out;
  }

  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function preserveCase(original, replacement) {
    if (!original) return replacement;
    if (original.toUpperCase() === original && original.length > 1)
      return replacement.toUpperCase();
    if (original[0] === original[0].toUpperCase())
      return replacement.charAt(0).toUpperCase() + replacement.slice(1);
    return replacement;
  }

  // Auto Caps
  function applyAutoCapsToDOM(rootNode) {
    const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT, null, false);
    let node;
    let pendingCap = true;
    const letterRe = /\p{L}/u;

    while ((node = walker.nextNode())) {
      let text = node.nodeValue;
      let newText = '';
      let modified = false;

      for (let i = 0; i < text.length; i++) {
        const ch = text[i];

        if (['.', '?', '!', '\u2026'].includes(ch)) {
          pendingCap = true;
          newText += ch;
        } else if (ch === '\n' || ch === '\r') {
          pendingCap = true;
          newText += ch;
        } else if (/\s/.test(ch)) {
          newText += ch;
        } else {
          if (letterRe.test(ch)) {
            if (pendingCap) {
              newText += ch.toUpperCase();
              pendingCap = false;
              modified = true;
            } else newText += ch;
          } else newText += ch;
        }
      }

      if (modified || newText !== text) 
        node.nodeValue = newText;
    }
  }

  // CORE REPLACE
  function performReplaceAll() {
    const replaceBtn = document.getElementById('replace-button');
    if (!replaceBtn) return;

    replaceBtn.disabled = true;
    replaceBtn.textContent = 'Đang xử lý...';

    const mode = state.modes[state.currentMode];
    if (!mode || !mode.pairs || mode.pairs.length === 0) {
      replaceBtn.disabled = false;
      replaceBtn.textContent = 'THỰC HIỆN THAY THẾ';
      return showNotification("Chưa có cặp thay thế nào!", "error");
    }

    const rules = mode.pairs
      .map(p => ({ find: normalizeText(p.find || ''), replace: normalizeText(p.replace || '') }))
      .filter(r => r.find.length > 0)
      .sort((a, b) => b.find.length - a.find.length);

    const rawText = els.inputText?.value || '';
    const initialNormalized = normalizeText(rawText);

    if (els.outputText) {
      els.outputText.innerHTML = '';
      els.outputText.textContent = initialNormalized;
    }

    let totalCount = 0;
    const maxReplacements = 50000;
    let replacementsDone = 0;

    for (const rule of rules) {
      if (replacementsDone > maxReplacements) break;

      const find = rule.find;
      const repl = rule.replace;

      const flags = 'gu' + (mode.matchCase ? '' : 'i');
      const needWhole = !!mode.wholeWord;

      let letterClass = '\\p{L}\\p{N}_';
      let pattern;

      try {
        new RegExp('\\p{L}', 'u');
        pattern = needWhole
          ? `(?<![${letterClass}])(${escRe(find)})(?![${letterClass}])`
          : `(${escRe(find)})`;
      } catch {
        letterClass = 'A-Za-zÀ-ỹ0-9_';
        pattern = needWhole
          ? `(?<![${letterClass}])(${escRe(find)})(?![${letterClass}])`
          : `(${escRe(find)})`;
      }

      const re = new RegExp(pattern, flags);
      let textNodes = els.outputText ? getTextNodes(els.outputText) : [];

      for (let node of textNodes) {
        if (replacementsDone > maxReplacements) break;

        const original = node.nodeValue;
        if (!original) continue;

        let searchText = original;

        while (true) {
          const match = re.exec(searchText);
          if (!match) break;

          const matchStr = match[1];
          const idx = match.index;

          const nodeText = node.nodeValue;
          const originalMatch = nodeText.substr(idx, matchStr.length);

          let outReplace = mode.matchCase
            ? repl
            : preserveCase(originalMatch, repl);

          const tail = node.splitText(idx);
          const after = tail.splitText(matchStr.length);

          const mark = document.createElement('mark');
          mark.className = 'hl-yellow';
          mark.textContent = outReplace;

          tail.parentNode.replaceChild(mark, tail);

          totalCount++;
          replacementsDone++;

          if (replacementsDone > maxReplacements) break;

          node = after;
          searchText = after.nodeValue || '';

          break;
        }

        if (replacementsDone > 0)
          textNodes = getTextNodes(els.outputText);
      }
    }

    if (mode.autoCaps && els.outputText)
      applyAutoCapsToDOM(els.outputText);

    updateCounters();

    if (els.inputText) els.inputText.value = '';

    saveTempInput();
    showNotification(`Đã thay thế ${totalCount} vị trí!`);

    replaceBtn.disabled = false;
    replaceBtn.textContent = 'THỰC HIỆN THAY THẾ';
  }

  // Mode select UI
  function renderModeSelect() {
    if (!els.modeSelect) return;
    els.modeSelect.innerHTML = '';

    Object.keys(state.modes).sort().forEach(m => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      els.modeSelect.appendChild(opt);
    });

    if (!state.modes[state.currentMode]) state.currentMode = 'default';

    els.modeSelect.value = state.currentMode;
    updateModeButtons();
  }

  function updateModeButtons() {
    const mode = state.modes[state.currentMode];
    if (!mode) return;

    if (els.matchCaseBtn) {
      els.matchCaseBtn.textContent = `Match Case: ${mode.matchCase ? 'BẬT' : 'Tắt'}`;
      els.matchCaseBtn.classList.toggle('active', mode.matchCase);
    }
    if (els.wholeWordBtn) {
      els.wholeWordBtn.textContent = `Whole Word: ${mode.wholeWord ? 'BẬT' : 'Tắt'}`;
      els.wholeWordBtn.classList.toggle('active', mode.wholeWord);
    }
    if (els.autoCapsBtn) {
      els.autoCapsBtn.textContent = `Auto Caps: ${mode.autoCaps ? 'BẬT' : 'Tắt'}`;
      els.autoCapsBtn.classList.toggle('active', mode.autoCaps);
    }
  }

  function addPairToUI(find = '', replace = '', append = true) {
    if (!els.list) return;
    const item = document.createElement('div');
    item.className = 'punctuation-item';

    const safeFind = (find || '').replace(/"/g, '&quot;');
    const safeReplace = (replace || '').replace(/"/g, '&quot;');

    item.innerHTML = `
      <input type="text" class="find" placeholder="Tìm" value="${safeFind}">
      <input type="text" class="replace" placeholder="Thay thế" value="${safeReplace}">
      <button class="remove" tabindex="-1">×</button>
    `;

    item.querySelector('.remove').onclick = () => {
      item.remove();
      checkEmptyState();
      saveTempInputDebounced();
    };

    item.querySelectorAll('input').forEach(inp =>
      inp.addEventListener('input', saveTempInputDebounced)
    );

    if (append) els.list.appendChild(item);
    else els.list.insertBefore(item, els.list.firstChild);

    checkEmptyState();
  }

  function loadSettingsToUI() {
    if (!els.list) return;
    els.list.innerHTML = '';
    const mode = state.modes[state.currentMode];
    if (mode && mode.pairs) mode.pairs.forEach(p => addPairToUI(p.find, p.replace));
    updateModeButtons();
    checkEmptyState();
  }

  function checkEmptyState() {
    if (!els.emptyState || !els.list) return;
    els.emptyState.classList.toggle('hidden', els.list.children.length > 0);
  }

  function saveCurrentPairsToState(silent = false) {
    if (!els.list) return;

    const items = Array.from(els.list.children);
    const newPairs = items.map(item => ({
      find: item.querySelector('.find')?.value || '',
      replace: item.querySelector('.replace')?.value || ''
    })).filter(p => p.find !== '');

    state.modes[state.currentMode].pairs = newPairs;
    saveState();

    if (!silent) showNotification('Đã lưu cài đặt!');
  }

  // CSV
  function parseCSVLine(text) {
    const result = [];
    let cell = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === '"') {
        if (inQuotes && text[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(cell.trim());
        cell = '';
      } else cell += char;
    }
    result.push(cell.trim());
    return result;
  }

  function importCSV(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const lines = text.split(/\r?\n/);

      if (!lines[0]?.toLowerCase().includes('find,replace,mode'))
        return showNotification('Lỗi Header CSV!', 'error');

      let count = 0;
      let importedModeNames = new Set();

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const cols = parseCSVLine(line);
        if (cols.length >= 3) {
          const find = cols[0];
          const replace = cols[1];
          const modeName = cols[2] || 'default';

          if (!find) continue;

          if (!state.modes[modeName])
            state.modes[modeName] = { pairs: [], matchCase: false, wholeWord: false, autoCaps: false };

          state.modes[modeName].pairs.push({ find, replace });
          importedModeNames.add(modeName);

          count++;
        }
      }

      saveState();
      renderModeSelect();

      if (importedModeNames.has(state.currentMode)) loadSettingsToUI();
      else if (importedModeNames.size > 0) {
        state.currentMode = importedModeNames.values().next().value;
        saveState();
        renderModeSelect();
        loadSettingsToUI();
      }

      showNotification(`Đã nhập ${count} cặp!`);
    };

    reader.readAsText(file);
  }

  function exportCSV() {
    saveCurrentPairsToState(true);
    let csvContent = "\uFEFFfind,replace,mode\n";

    Object.keys(state.modes).forEach(modeName => {
      const mode = state.modes[modeName];
      if (!mode.pairs) return;

      mode.pairs.forEach(p => {
        const safeFind = `"${(p.find || '').replace(/"/g, '""')}"`;
        const safeReplace = `"${(p.replace || '').replace(/"/g, '""')}"`;
        const safeMode = `"${modeName.replace(/"/g, '""')}"`;
        csvContent += `${safeFind},${safeReplace},${safeMode}\n`;
      });
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'settings_trinh_hg_v14.csv';
    a.click();
  }

  // SPLIT
  function countWords(str) {
    return str.trim() ? str.trim().split(/\s+/).length : 0;
  }

  function performSplit() {
    if (!els.splitInput) return;

    const text = els.splitInput.value;
    if (!text.trim()) return showNotification('Chưa có nội dung!', 'error');

    const normalizedText = normalizeText(text);
    const lines = normalizedText.split('\n');

    let chapterHeader = '';
    let contentBody = normalizedText;

    if (/^(Chương|Chapter)\s+\d+/i.test(lines[0].trim())) {
      chapterHeader = lines[0].trim();
      contentBody = lines.slice(1).join('\n');
    }

    const paragraphs = contentBody.split('\n').filter(p => p.trim());
    const targetWords = Math.ceil(countWords(contentBody) / currentSplitMode);

    let parts = [];
    let currentPart = [];
    let currentCount = 0;

    for (let p of paragraphs) {
      const wCount = countWords(p);

      if (currentCount + wCount > targetWords && parts.length < currentSplitMode - 1) {
        parts.push(currentPart.join('\n\n'));
        currentPart = [p];
        currentCount = wCount;
      } else {
        currentPart.push(p);
        currentCount += wCount;
      }
    }

    if (currentPart.length) parts.push(currentPart.join('\n\n'));

    for (let i = 0; i < currentSplitMode; i++) {
      const el = document.getElementById(`out-${i + 1}-text`);
      const cEl = document.getElementById(`out-${i + 1}-count`);

      if (el) {
        let ph = '';
        if (chapterHeader)
          ph = chapterHeader.replace(/(\d+)/, (m, n) => `${n}.${i + 1}`) + '\n\n';

        el.value = ph + (parts[i] || '');

        if (cEl) cEl.textContent = 'Words: ' + countWords(el.value);
      }
    }

    els.splitInput.value = '';
    saveTempInput();
    showNotification('Đã chia xong!');
  }

  // COUNTERS
  function updateCounters() {
    const inW = document.getElementById('input-word-count');
    const outW = document.getElementById('output-word-count');
    const splitW = document.getElementById('split-input-word-count');

    if (inW && els.inputText)
      inW.textContent = 'Words: ' + countWords(els.inputText.value);

    if (outW && els.outputText)
      outW.textContent = 'Words: ' + countWords(els.outputText.innerText);

    if (splitW && els.splitInput)
      splitW.textContent = 'Words: ' + countWords(els.splitInput.value);
  }

  function saveTempInputDebounced() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveTempInput, 500);
  }

  function saveTempInput() {
    try {
      localStorage.setItem(INPUT_STATE_KEY, JSON.stringify({
        inputText: els.inputText?.value || '',
        splitInput: els.splitInput?.value || ''
      }));
    } catch {}
  }

  // FIX chính: loadTempInput *an toàn*
  function loadTempInput() {
    let saved = null;

    try { saved = JSON.parse(localStorage.getItem(INPUT_STATE_KEY) || '{}'); }
    catch { saved = {}; }

    if (saved) {
      if (els.inputText) els.inputText.value = saved.inputText || '';
      if (els.splitInput) els.splitInput.value = saved.splitInput || '';
    }
    updateCounters();
  }

  // EVENTS
  function initEvents() {
    if (els.matchCaseBtn)
      els.matchCaseBtn.onclick = () => {
        state.modes[state.currentMode].matchCase = !state.modes[state.currentMode].matchCase;
        saveState();
        updateModeButtons();
      };

    if (els.wholeWordBtn)
      els.wholeWordBtn.onclick = () => {
        state.modes[state.currentMode].wholeWord = !state.modes[state.currentMode].wholeWord;
        saveState();
        updateModeButtons();
      };

    if (els.autoCapsBtn)
      els.autoCapsBtn.onclick = () => {
        state.modes[state.currentMode].autoCaps = !state.modes[state.currentMode].autoCaps;
        saveState();
        updateModeButtons();
      };

    const addModeBtn = document.getElementById('add-mode');
    if (addModeBtn)
      addModeBtn.onclick = () => {
        const n = prompt('Tên Mode:');
        if (n && !state.modes[n]) {
          state.modes[n] = { pairs: [], matchCase: false, wholeWord: false, autoCaps: false };
          state.currentMode = n;
          saveState();
          renderModeSelect();
          loadSettingsToUI();
        }
      };

    const copyModeBtn = document.getElementById('copy-mode');
    if (copyModeBtn)
      copyModeBtn.onclick = () => {
        const n = prompt('Tên Mode Copy:');
        if (n && !state.modes[n]) {
          state.modes[n] = JSON.parse(JSON.stringify(state.modes[state.currentMode]));
          state.currentMode = n;
          saveState();
          renderModeSelect();
          loadSettingsToUI();
        }
      };

    if (els.modeSelect)
      els.modeSelect.onchange = (e) => {
        state.currentMode = e.target.value;
        saveState();
        loadSettingsToUI();
      };

    const addPairBtn = document.getElementById('add-pair');
    if (addPairBtn)
      addPairBtn.addEventListener('click', () => addPairToUI());

    const saveBtn = document.getElementById('save-settings');
    if (saveBtn)
      saveBtn.onclick = () => saveCurrentPairsToState();

    const replaceBtn = document.getElementById('replace-button');
    if (replaceBtn)
      replaceBtn.onclick = () => {
        saveCurrentPairsToState(true);
        performReplaceAll();
      };

    const copyBtn = document.getElementById('copy-button');
    if (copyBtn)
      copyBtn.onclick = () => {
        if (els.outputText?.innerText) {
          navigator.clipboard.writeText(els.outputText.innerText);
          showNotification('Đã sao chép!');
        }
      };

    document.querySelectorAll('.split-mode-btn').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.split-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentSplitMode = parseInt(btn.dataset.split);
      };
    });

    const splitBtn = document.getElementById('split-action-btn');
    if (splitBtn)
      splitBtn.onclick = performSplit;

    const exportBtn = document.getElementById('export-settings');
    if (exportBtn)
      exportBtn.onclick = exportCSV;

    const importBtn = document.getElementById('import-settings');
    if (importBtn)
      importBtn.onclick = () => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = '.csv';
        inp.onchange = e => {
          if (e.target.files.length)
            importCSV(e.target.files[0]);
        };
        inp.click();
      };

    [els.inputText, els.splitInput].forEach(el => {
      if (el)
        el.addEventListener('input', () => {
          updateCounters();
          saveTempInputDebounced();
        });
    });
  }

  // INIT
  renderModeSelect();
  loadSettingsToUI();
  loadTempInput();
  initEvents();
});
