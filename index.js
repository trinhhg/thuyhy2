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

  let state = JSON.parse(localStorage.getItem(STORAGE_KEY)) || defaultState;
  if (!state.activeTab) state.activeTab = 'settings';
  if (!state.modes || Object.keys(state.modes).length === 0) {
    state.modes = defaultState.modes;
    state.currentMode = 'default';
  }

  let currentSplitMode = 2;
  let saveTimeout;

  // DOM ELEMENTS
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

  // HELPERS
  function showNotification(msg, type = 'success') {
    const container = document.getElementById('notification-container');
    const note = document.createElement('div');
    note.className = `notification ${type === 'error' ? 'error' : ''}`;
    note.textContent = msg;
    container.appendChild(note);
    setTimeout(() => {
      note.style.opacity = '0';
      setTimeout(() => note.remove(), 300);
    }, 2800);
  }

  function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

  // Normalize smart quotes & NBSP
  function normalizeText(text) {
    if (typeof text !== 'string') return '';
    if (text.length === 0) return text;
    let normalized = text.replace(/[\u201C\u201D\u201E\u201F\u00AB\u00BB\u275D\u275E\u301D-\u301F\uFF02\u02DD"]/g, '"');
    normalized = normalized.replace(/[\u2018\u2019\u201A\u201B\u2039\u203A\u275B\u275C\u276E\u276F\uA78C\uFF07']/g, "'");
    normalized = normalized.replace(/\u00A0/g, ' ');
    return normalized;
  }

  // Get text nodes but skip existing mark tags
  function getTextNodes(node) {
    let out = [];
    for (let child of node.childNodes) {
      if (child.nodeType === 3) out.push(child);
      else if (child.nodeType === 1) {
        const tn = child.tagName && child.tagName.toLowerCase();
        if (tn === 'mark' || tn === 'code' || tn === 'pre') continue; // skip highlight or code
        out = out.concat(getTextNodes(child));
      }
    }
    return out;
  }

  // escape regex
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // preserve-case replacement
  function preserveCase(original, replacement) {
    if (!original) return replacement;
    if (original.toUpperCase() === original && original.length > 1) return replacement.toUpperCase();
    if (original[0] === original[0].toUpperCase()) return replacement.charAt(0).toUpperCase() + replacement.slice(1);
    return replacement;
  }

  // Apply AutoCaps by walking text nodes (skip mark/code)
  function applyAutoCapsToDOM(rootNode) {
    const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT, null, false);
    let node;
    let pendingCap = true; // start of document => capitalize first letter

    // Recognize letters via Unicode property if available
    const letterRe = /\p{L}/u;

    while ((node = walker.nextNode())) {
      let text = node.nodeValue;
      let newText = '';
      let modified = false;

      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        // If ch is punctuation that ends sentence -> set pendingCap true
        if (ch === '.' || ch === '?' || ch === '!' || ch === '\u2026') {
          pendingCap = true;
          newText += ch;
        } else if (ch === '\n' || ch === '\r') {
          pendingCap = true;
          newText += ch;
        } else if (/\s/.test(ch)) {
          // whitespace: keep pendingCap as-is
          newText += ch;
        } else {
          // letter?
          if (letterRe.test(ch)) {
            if (pendingCap) {
              newText += ch.toUpperCase();
              pendingCap = false;
              modified = true;
            } else {
              newText += ch;
            }
          } else {
            // other characters (quotes, closing paren, digits) -> keep; do not consume pendingCap
            newText += ch;
          }
        }
      }

      if (modified || newText !== text) node.nodeValue = newText;
    }
  }

  // CORE REPLACE: robust, works on text nodes, wholeWord, matchCase, preserve punctuation
  function performReplaceAll() {
    const replaceBtn = document.getElementById('replace-button');
    replaceBtn.disabled = true;
    replaceBtn.textContent = 'Đang xử lý...';

    const mode = state.modes[state.currentMode];
    if (!mode || !mode.pairs || mode.pairs.length === 0) {
      replaceBtn.disabled = false;
      replaceBtn.textContent = 'THỰC HIỆN THAY THẾ';
      return showNotification("Chưa có cặp thay thế nào!", "error");
    }

    // prepare rules: normalized find/replace
    const rules = mode.pairs
      .map(p => ({ find: normalizeText(p.find || ''), replace: normalizeText(p.replace || '') }))
      .filter(r => r.find.length > 0)
      .sort((a, b) => b.find.length - a.find.length); // longer first

    // reset output content -> set normalized input into output container (we'll operate on DOM)
    const rawText = els.inputText.value || '';
    const initialNormalized = normalizeText(rawText);
    els.outputText.innerHTML = '';
    // set text node inside outputText
    els.outputText.textContent = initialNormalized;

    let totalCount = 0;
    const maxReplacements = 50000;
    let replacementsDone = 0;

    // For each rule, walk text nodes and replace occurrences
    for (const rule of rules) {
      if (replacementsDone > maxReplacements) break;
      const find = rule.find;
      const repl = rule.replace;

      // build regex for the find: use Unicode property for letters if available
      // If wholeWord: ensure bounds on letters/numbers: (?<!\p{L}\p{N}_){find}(?!\p{L}\p{N}_)
      // Use 'u' flag; if matchCase false add 'i'
      const flags = 'gu' + (mode.matchCase ? '' : 'i');
      const needWhole = !!mode.wholeWord;

      // Try to create \p patterns; if engine doesn't support, fallback to ASCII range
      let letterClass = '\\p{L}\\p{N}_';
      let pattern;
      try {
        // attempt to compile a test regexp using \p
        new RegExp('\\p{L}', 'u');
        // ok
        if (needWhole) {
          pattern = `(?<![${letterClass}])(${escRe(find)})(?![${letterClass}])`;
        } else {
          pattern = `(${escRe(find)})`;
        }
      } catch (e) {
        // fallback: Latin extended range (sufficient for Vietnamese)
        letterClass = 'A-Za-zÀ-ỹ0-9_';
        if (needWhole) {
          pattern = `(?<![${letterClass}])(${escRe(find)})(?![${letterClass}])`;
        } else {
          pattern = `(${escRe(find)})`;
        }
      }

      const re = new RegExp(pattern, flags);

      // Iterate text nodes; for each node, do a replace with callback to preserve-case and keep punctuation
      let textNodes = getTextNodes(els.outputText);
      for (const node of textNodes) {
        if (replacementsDone > maxReplacements) break;
        const original = node.nodeValue;
        if (!original) continue;

        // We'll apply regex on node text; but since we need to create mark elements for visual highlight,
        // we do incremental processing by searching and splitting nodes.
        let searchText = original;
        let match;
        let offset = 0;

        while ((match = re.exec(searchText)) !== null) {
          const matchStr = match[1];
          const idx = match.index + offset;

          // Determine original matched substring from the current node.nodeValue (might differ in case)
          const nodeText = node.nodeValue;
          const originalMatch = nodeText.substr(idx, matchStr.length);

          // build replacement respecting case when matchCase is false
          let outReplace = repl;
          if (!mode.matchCase) {
            outReplace = preserveCase(originalMatch, repl);
          } else {
            // if matchCase true, only replace exact-case matches: our regex used 'i' only when matchCase false,
            // so when matchCase true, re was case-sensitive. Good.
            outReplace = repl;
          }

          // Replace by splitting text node and inserting mark
          // split at idx to get tail node starting at matched text
          const tail = node.splitText(idx);
          // split tail at matched length -> mid becomes matched node
          const after = tail.splitText(matchStr.length);

          // create mark element with replacement text
          const mark = document.createElement('mark');
          mark.className = 'hl-yellow';
          mark.textContent = outReplace;

          tail.parentNode.replaceChild(mark, tail);

          replacementsDone++;
          totalCount++;
          if (replacementsDone > maxReplacements) break;

          // After we modified the DOM, continue scanning from the 'after' node.
          // But re.exec was applied to 'searchText' which is original substring; easier to reset exec on after.nodeValue.
          // Move to next node to continue.
          // Prepare for next loop: search in 'after' node
          searchText = after.nodeValue || '';
          offset = 0; // because searchText is now the node content from start
          node = after;
          // create new RegExp object to reset lastIndex
          // (we will keep using same re but need to restart exec on new string)
          // break out to outer while to run exec on new searchText from beginning
          // So continue while loop with searchText reset; but ensure we don't infinite loop:
          // use 'break' to restart a fresh exec on new searchText
          break;
        } // end while exec for node

        // If the last exec found a match and we updated node to 'after', we need to continue processing that 'after' node.
        // So restart processing of textNodes by recomputing getTextNodes starting from current parent.
        // To keep it simple and robust, after each replacement we recompute node list and continue outer for loop.
        if (replacementsDone > 0 && replacementsDone % 1 === 0) {
          // recompute node list to reflect DOM changes
          textNodes = getTextNodes(els.outputText);
        }
      } // end for textNodes
    } // end for rules

    // STEP 2: Auto-caps after all replacements
    if (mode.autoCaps) applyAutoCapsToDOM(els.outputText);

    // Update counters
    updateCounters();

    // Clear input and save temp
    els.inputText.value = '';
    saveTempInput();
    showNotification(`Đã thay thế ${totalCount} vị trí!`);
    replaceBtn.disabled = false;
    replaceBtn.textContent = 'THỰC HIỆN THAY THẾ';
    return totalCount;
  }

  // UI helpers: render select, pairs, etc.
  function renderModeSelect() {
    els.modeSelect.innerHTML = '';
    Object.keys(state.modes).sort().forEach(m => {
      const opt = document.createElement('option');
      opt.value = m; opt.textContent = m;
      els.modeSelect.appendChild(opt);
    });
    if (!state.modes[state.currentMode]) state.currentMode = 'default';
    els.modeSelect.value = state.currentMode;
    updateModeButtons();
  }

  function updateModeButtons() {
    const mode = state.modes[state.currentMode];
    if (mode) {
      els.matchCaseBtn.textContent = `Match Case: ${mode.matchCase ? 'BẬT' : 'Tắt'}`;
      els.matchCaseBtn.classList.toggle('active', mode.matchCase);
      els.wholeWordBtn.textContent = `Whole Word: ${mode.wholeWord ? 'BẬT' : 'Tắt'}`;
      els.wholeWordBtn.classList.toggle('active', mode.wholeWord);
      els.autoCapsBtn.textContent = `Auto Caps: ${mode.autoCaps ? 'BẬT' : 'Tắt'}`;
      els.autoCapsBtn.classList.toggle('active', mode.autoCaps);
    }
  }

  function addPairToUI(find = '', replace = '', append = true) {
    const item = document.createElement('div');
    item.className = 'punctuation-item';
    const safeFind = (find || '').replace(/"/g, '&quot;');
    const safeReplace = (replace || '').replace(/"/g, '&quot;');
    item.innerHTML = `
      <input type="text" class="find" placeholder="Tìm" value="${safeFind}">
      <input type="text" class="replace" placeholder="Thay thế" value="${safeReplace}">
      <button class="remove" tabindex="-1">×</button>
    `;
    item.querySelector('.remove').onclick = () => { item.remove(); checkEmptyState(); saveTempInputDebounced(); };
    item.querySelectorAll('input').forEach(inp => inp.addEventListener('input', saveTempInputDebounced));
    if (append) els.list.appendChild(item);
    else els.list.insertBefore(item, els.list.firstChild);
    checkEmptyState();
  }

  function loadSettingsToUI() {
    els.list.innerHTML = '';
    const mode = state.modes[state.currentMode];
    if (mode && mode.pairs) mode.pairs.forEach(p => addPairToUI(p.find, p.replace, true));
    updateModeButtons();
    checkEmptyState();
  }

  function checkEmptyState() { document.getElementById('empty-state').classList.toggle('hidden', els.list.children.length > 0); }

  function saveCurrentPairsToState(silent = false) {
    const items = Array.from(els.list.children);
    const newPairs = items.map(item => ({
      find: item.querySelector('.find').value,
      replace: item.querySelector('.replace').value
    })).filter(p => p.find !== '');

    state.modes[state.currentMode].pairs = newPairs;
    saveState();
    if (!silent) showNotification('Đã lưu cài đặt!', 'success');
  }

  // CSV / Split minimal implementations kept from your original; not changed heavily
  function parseCSVLine(text) {
    const result = [];
    let cell = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === '"') {
        if (inQuotes && text[i + 1] === '"') { cell += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (char === ',' && !inQuotes) {
        result.push(cell.trim()); cell = '';
      } else { cell += char; }
    }
    result.push(cell.trim());
    return result;
  }

  function importCSV(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const lines = text.split(/\r?\n/);
      if (!lines[0].toLowerCase().includes('find,replace,mode')) return showNotification('Lỗi Header CSV!', 'error');
      let count = 0;
      let importedModeNames = new Set();
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim(); if (!line) continue;
        const cols = parseCSVLine(line);
        if (cols.length >= 3) {
          const find = cols[0]; const replace = cols[1]; const modeName = cols[2] || 'default';
          if (find) {
            if (!state.modes[modeName]) state.modes[modeName] = { pairs: [], matchCase: false, wholeWord: false, autoCaps: false };
            state.modes[modeName].pairs.push({ find, replace });
            importedModeNames.add(modeName);
            count++;
          }
        }
      }
      saveState(); renderModeSelect();
      if (importedModeNames.has(state.currentMode)) loadSettingsToUI();
      else if (importedModeNames.size > 0) {
        state.currentMode = importedModeNames.values().next().value;
        saveState(); renderModeSelect(); loadSettingsToUI();
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
      if (mode.pairs) {
        mode.pairs.forEach(p => {
          const safeFind = `"${(p.find || '').replace(/"/g, '""')}"`;
          const safeReplace = `"${(p.replace || '').replace(/"/g, '""')}"`;
          const safeMode = `"${modeName.replace(/"/g, '""')}"`;
          csvContent += `${safeFind},${safeReplace},${safeMode}\n`;
        });
      }
    });
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'settings_trinh_hg_v14.csv'; a.click();
  }

  // SPLIT
  function countWords(str) { return str.trim() ? str.trim().split(/\s+/).length : 0; }
  function performSplit() {
    const text = els.splitInput.value;
    if (!text.trim()) return showNotification('Chưa có nội dung!', 'error');
    const normalizedText = normalizeText(text);
    const lines = normalizedText.split('\n');
    let chapterHeader = '', contentBody = normalizedText;
    if (/^(Chương|Chapter)\s+\d+/i.test(lines[0].trim())) {
      chapterHeader = lines[0].trim(); contentBody = lines.slice(1).join('\n');
    }
    const paragraphs = contentBody.split('\n').filter(p => p.trim());
    const targetWords = Math.ceil(countWords(contentBody) / currentSplitMode);
    let parts = [], currentPart = [], currentCount = 0;
    for (let p of paragraphs) {
      const wCount = countWords(p);
      if (currentCount + wCount > targetWords && parts.length < currentSplitMode - 1) {
        parts.push(currentPart.join('\n\n')); currentPart = [p]; currentCount = wCount;
      } else { currentPart.push(p); currentCount += wCount; }
    }
    if (currentPart.length) parts.push(currentPart.join('\n\n'));

    for (let i = 0; i < currentSplitMode; i++) {
      const el = document.getElementById(`out-${i + 1}-text`);
      const cEl = document.getElementById(`out-${i + 1}-count`);
      if (el) {
        let ph = ''; if (chapterHeader) ph = chapterHeader.replace(/(\d+)/, (m, n) => `${n}.${i+1}`) + '\n\n';
        el.value = ph + (parts[i] || '');
        if (cEl) cEl.textContent = 'Words: ' + countWords(el.value);
      }
    }

    els.splitInput.value = '';
    saveTempInput();
    showNotification('Đã chia xong!', 'success');
  }

  // Counters & temp save
  function updateCounters() {
    document.getElementById('input-word-count').textContent = 'Words: ' + countWords(els.inputText.value || '');
    document.getElementById('output-word-count').textContent = 'Words: ' + countWords(els.outputText.innerText || '');
    document.getElementById('split-input-word-count').textContent = 'Words: ' + countWords(els.splitInput.value || '');
  }
  function saveTempInputDebounced() { clearTimeout(saveTimeout); saveTimeout = setTimeout(saveTempInput, 500); }
  function saveTempInput() { localStorage.setItem(INPUT_STATE_KEY, JSON.stringify({ inputText: els.inputText.value, splitInput: els.splitInput.value })); }
  function loadTempInput() {
    const saved = JSON.parse(localStorage.getItem(INPUT_STATE_KEY) || '{}');
    if (saved) { els.inputText.value = saved.inputText || ''; els.splitInput.value = saved.splitInput || ''; }
    updateCounters();
  }

  // Events init
  function initEvents() {
    // tab buttons omitted in simplified UI
    els.matchCaseBtn.onclick = () => { state.modes[state.currentMode].matchCase = !state.modes[state.currentMode].matchCase; saveState(); updateModeButtons(); };
    els.wholeWordBtn.onclick = () => { state.modes[state.currentMode].wholeWord = !state.modes[state.currentMode].wholeWord; saveState(); updateModeButtons(); };
    els.autoCapsBtn.onclick = () => { state.modes[state.currentMode].autoCaps = !state.modes[state.currentMode].autoCaps; saveState(); updateModeButtons(); };

    document.getElementById('add-mode').onclick = () => {
      const n = prompt('Tên Mode:');
      if (n && !state.modes[n]) {
        state.modes[n] = { pairs: [], matchCase: false, wholeWord: false, autoCaps: false };
        state.currentMode = n; saveState(); renderModeSelect(); loadSettingsToUI();
      }
    };
    document.getElementById('copy-mode').onclick = () => {
      const n = prompt('Tên Mode Copy:');
      if (n && !state.modes[n]) {
        state.modes[n] = JSON.parse(JSON.stringify(state.modes[state.currentMode]));
        state.currentMode = n; saveState(); renderModeSelect(); loadSettingsToUI();
      }
    };

    els.modeSelect.onchange = (e) => { state.currentMode = e.target.value; saveState(); loadSettingsToUI(); };

    document.getElementById('add-pair')?.addEventListener('click', () => addPairToUI());
    document.getElementById('save-settings').onclick = () => saveCurrentPairsToState();
    document.getElementById('replace-button').onclick = () => { saveCurrentPairsToState(true); performReplaceAll(); };
    document.getElementById('copy-button').onclick = () => {
      if (els.outputText.innerText) { navigator.clipboard.writeText(els.outputText.innerText); showNotification('Đã sao chép!'); }
    };
    document.querySelectorAll('.split-mode-btn').forEach(btn => btn.onclick = () => {
      document.querySelectorAll('.split-mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentSplitMode = parseInt(btn.dataset.split); renderSplitOutputs(currentSplitMode);
    });
    document.getElementById('split-action-btn').onclick = performSplit;
    document.getElementById('export-settings').onclick = exportCSV;
    document.getElementById('import-settings').onclick = () => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.csv';
      inp.onchange = e => { if (e.target.files.length) importCSV(e.target.files[0]); }; inp.click();
    };
    [els.inputText, els.splitInput].forEach(el => el.addEventListener('input', () => { updateCounters(); saveTempInputDebounced(); }));
  }

  function renderSplitOutputs(count) {
    // create simple outputs (hidden in this simplified UI)
  }

  // INIT
  renderModeSelect();
  loadSettingsToUI();
  loadTempInput();
  if (state.activeTab) {} // no tabs used
  initEvents();
});
