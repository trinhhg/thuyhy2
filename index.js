document.addEventListener('DOMContentLoaded', () => {
  // === 1. CONFIG & STATE ===
  const STORAGE_KEY = 'trinh_hg_settings_v15_final'; 
  const INPUT_STATE_KEY = 'trinh_hg_input_state_v15';

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
    splitInput: document.getElementById('split-input-text'),
    splitWrapper: document.getElementById('split-outputs-wrapper'),
    
    // Buttons
    matchCaseBtn: document.getElementById('match-case'),
    wholeWordBtn: document.getElementById('whole-word'),
    autoCapsBtn: document.getElementById('auto-caps'), 
    renameBtn: document.getElementById('rename-mode'),
    deleteBtn: document.getElementById('delete-mode'),
    emptyState: document.getElementById('empty-state')
  };

  // === 2. HELPER FUNCTIONS ===

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function showNotification(msg, type = 'success') {
    const container = document.getElementById('notification-container');
    const note = document.createElement('div');
    note.className = `notification ${type}`;
    note.textContent = msg;
    container.appendChild(note);
    setTimeout(() => {
      note.style.opacity = '0';
      setTimeout(() => note.remove(), 300); // Wait for fade out
    }, 2800); // 2.8s display time
  }

  // --- NORMALIZE: Xử lý Smart Quotes & NBSP ---
  function normalizeText(text) {
    if (typeof text !== 'string') return '';
    if (text.length === 0) return text;
    
    // 1. Double Quotes -> "
    let normalized = text.replace(/["\u201C\u201D\u201E\u201F\u00AB\u00BB\u275D\u275E\u301D-\u301F\uFF02\u02DD]/g, '"');
    // 2. Single Quotes -> '
    normalized = normalized.replace(/['\u2018\u2019\u201A\u201B\u2039\u203A\u275B\u275C\u276E\u276F\uA78C\uFF07]/g, "'");
    // 3. NBSP -> Space
    normalized = normalized.replace(/\u00A0/g, ' ');
    
    return normalized;
  }
  
  // --- Get Text Nodes: Dùng cho việc tìm kiếm text để replace ---
  function getTextNodes(node) {
      let textNodes = [];
      if (node.nodeType === 3) {
          textNodes.push(node);
      } else {
          for (let child of node.childNodes) {
              // Bỏ qua nội dung trong thẻ mark để tránh replace chồng chéo
              if (child.nodeType === 1 && child.tagName.toLowerCase() === 'mark') continue; 
              textNodes = textNodes.concat(getTextNodes(child));
          }
      }
      return textNodes;
  }

  // --- PRESERVE CASE: Giữ format viết hoa của từ gốc ---
  function preserveCase(original, replacement) {
      if (original === original.toUpperCase()) {
          return replacement.toUpperCase();
      }
      if (original[0] === original[0].toUpperCase()) {
          return replacement.charAt(0).toUpperCase() + replacement.slice(1);
      }
      return replacement;
  }

  // --- AUTO CAPS LOGIC (Sử dụng TreeWalker) ---
  // Logic: Duyệt qua toàn bộ kết quả sau khi đã replace. 
  // Gặp dấu ngắt câu (. ? ! ...) -> Bật cờ "cần viết hoa".
  // Gặp chữ cái tiếp theo -> Viết hoa & Tắt cờ.
  function applyAutoCapsToDOM(rootNode) {
      // TreeWalker duyệt qua TẤT CẢ text nodes (bao gồm cả trong <mark>)
      const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT, null, false);
      let node;
      let pendingCap = true; // Mặc định đầu văn bản cần viết hoa

      while (node = walker.nextNode()) {
          const text = node.nodeValue;
          let newText = '';
          let modified = false;

          for (let i = 0; i < text.length; i++) {
              const char = text[i];
              
              // 1. Kiểm tra dấu câu kích hoạt Auto Caps
              // Bao gồm: . ? ! và dấu ba chấm (…)
              if (/[\.\?\!\n\u2026]/.test(char)) {
                  pendingCap = true;
                  newText += char;
              } 
              // 2. Bỏ qua các ký tự không phải chữ (khoảng trắng, ngoặc, quote)
              // Lưu ý: Dấu ngoặc/quote đi liền sau dấu chấm vẫn giữ trạng thái pendingCap
              else if (/[^a-zà-ỹ0-9]/i.test(char)) {
                  newText += char;
              }
              // 3. Nếu là chữ cái
              else if (/[a-zà-ỹ]/i.test(char)) {
                  if (pendingCap) {
                      newText += char.toUpperCase();
                      pendingCap = false; // Đã viết hoa xong, tắt cờ
                      modified = true;
                  } else {
                      newText += char;
                  }
              }
              // 4. Số hoặc ký tự khác
              else {
                  newText += char;
                  pendingCap = false; // Gặp số thì coi như đã bắt đầu câu, tắt cờ
              }
          }

          if (modified) {
              node.nodeValue = newText;
          }
      }
  }

  // === 3. CORE REPLACE FUNCTION ===
  function performReplaceAll() {
      const replaceBtn = document.getElementById('replace-button');
      replaceBtn.disabled = true;
      replaceBtn.textContent = 'Đang xử lý...';

      const mode = state.modes[state.currentMode];
      if(!mode.pairs.length) {
        replaceBtn.disabled = false;
        replaceBtn.textContent = 'THỰC HIỆN THAY THẾ';
        return showNotification("Chưa có cặp thay thế nào!", "error");
      }

      // --- BƯỚC 1: CHUẨN HÓA INPUT ---
      let rawText = els.inputText.value;
      let normalizedText = normalizeText(rawText);
      
      // Reset Output
      els.outputText.innerHTML = '';
      els.outputText.innerText = normalizedText; 

      let totalCount = 0;

      // Chuẩn hóa Rules (Sắp xếp dài trước ngắn để tránh replace nhầm)
      const rules = mode.pairs
        .filter(p => p.find)
        .map(p => ({
            normalizedFind: normalizeText(p.find), 
            replace: normalizeText(p.replace || '') 
        }))
        .filter(p => p.normalizedFind.length > 0)
        .sort((a,b) => b.normalizedFind.length - a.normalizedFind.length);

      // --- BƯỚC 2: THỰC HIỆN REPLACE (LOGIC GOOGLE DOCS) ---
      rules.forEach(rule => {
          const findStr = rule.normalizedFind;
          let maxPasses = 50000; // Safety break
          let pass = 0;

          // Vòng lặp tìm kiếm trong Text Nodes
          while (pass < maxPasses) {
              let foundInThisPass = false;
              const nodes = getTextNodes(els.outputText);
              
              for (const node of nodes) {
                   const txt = node.nodeValue;
                   // Logic tìm kiếm Case Insensitive hoặc Sensitive
                   const searchIn = mode.matchCase ? txt : txt.toLowerCase();
                   const searchFor = mode.matchCase ? findStr : findStr.toLowerCase();
                   let idx = searchIn.indexOf(searchFor);

                   if (idx !== -1) {
                       // --- CHECK WHOLE WORD ---
                       if (mode.wholeWord) {
                            const before = idx > 0 ? txt[idx-1] : '';
                            const after = idx + findStr.length < txt.length ? txt[idx + findStr.length] : '';
                            
                            // Sử dụng Regex Unicode Property \p{L} để check ký tự chữ cái chính xác cho Tiếng Việt
                            // Nếu ký tự liền trước hoặc liền sau là chữ cái/số/_ -> Bỏ qua
                            const isWordChar = /[\p{L}\p{N}_]/u;
                            
                            if (isWordChar.test(before) || isWordChar.test(after)) {
                                continue; // Không phải whole word
                            }
                       }

                       // --- TÍNH TOÁN REPLACEMENT STRING ---
                       let replacement = rule.replace;
                       const originalMatch = txt.substr(idx, findStr.length);
                       
                       // Nếu KHÔNG bật Match Case -> Cố gắng giữ format viết hoa (Preserve Case)
                       if (!mode.matchCase) {
                           replacement = preserveCase(originalMatch, replacement);
                       }

                       // --- DOM MODIFICATION ---
                       // Tách node text thành 3 phần: [Trước] [Từ tìm thấy] [Sau]
                       const matchNode = node.splitText(idx);
                       matchNode.splitText(findStr.length);
                       
                       // Tạo thẻ highlight thay thế cho phần [Từ tìm thấy]
                       const mark = document.createElement('mark');
                       mark.className = 'hl-yellow'; 
                       mark.textContent = replacement;
                       
                       matchNode.parentNode.replaceChild(mark, matchNode);
                       
                       totalCount++;
                       foundInThisPass = true;
                       break; // Break để refetch nodes vì DOM đã thay đổi
                   }
              }
              if (!foundInThisPass) break; 
              pass++;
          }
      });
      
      // --- BƯỚC 3: AUTO CAPS (CHẠY SAU CÙNG) ---
      // Chỉ chạy khi replace đã hoàn tất, đảm bảo logic "Em? Em" đúng
      if (mode.autoCaps) {
          applyAutoCapsToDOM(els.outputText);
      }

      updateCounters();
      
      // --- CLEANUP ---
      els.inputText.value = ''; // Xóa input sau khi xong
      saveTempInput(); // Lưu trạng thái rỗng
      
      showNotification(`Đã thay thế ${totalCount} vị trí!`);
      replaceBtn.disabled = false;
      replaceBtn.textContent = 'THỰC HIỆN THAY THẾ';
  }

  // === 4. UI & UTILS ===
  function renderModeSelect() {
    els.modeSelect.innerHTML = '';
    Object.keys(state.modes).sort().forEach(m => {
      const opt = document.createElement('option');
      opt.value = m; opt.textContent = m;
      els.modeSelect.appendChild(opt);
    });
    if(!state.modes[state.currentMode]) state.currentMode = 'default';
    els.modeSelect.value = state.currentMode;
    updateModeButtons();
  }

  function updateModeButtons() {
    const isDefault = state.currentMode === 'default';
    els.renameBtn.classList.toggle('hidden', isDefault);
    els.deleteBtn.classList.toggle('hidden', isDefault);
    
    const mode = state.modes[state.currentMode];
    if(mode) {
        // Cập nhật text và class active cho các nút toggle
        els.matchCaseBtn.textContent = `Match Case: ${mode.matchCase ? 'BẬT' : 'Tắt'}`;
        els.matchCaseBtn.classList.toggle('active', mode.matchCase);
        
        els.wholeWordBtn.textContent = `Whole Word: ${mode.wholeWord ? 'BẬT' : 'Tắt'}`;
        els.wholeWordBtn.classList.toggle('active', mode.wholeWord);
        
        if (mode.autoCaps === undefined) mode.autoCaps = false;
        els.autoCapsBtn.textContent = `Auto Caps: ${mode.autoCaps ? 'BẬT' : 'Tắt'}`;
        els.autoCapsBtn.classList.toggle('active', mode.autoCaps);
    }
  }

  function addPairToUI(find = '', replace = '', append = false) {
    const item = document.createElement('div');
    item.className = 'punctuation-item';
    const safeFind = find.replace(/"/g, '&quot;');
    const safeReplace = replace.replace(/"/g, '&quot;');

    item.innerHTML = `
      <input type="text" class="find" placeholder="Tìm" value="${safeFind}">
      <input type="text" class="replace" placeholder="Thay thế" value="${safeReplace}">
      <button class="remove" tabindex="-1">×</button>
    `;

    item.querySelector('.remove').onclick = () => { item.remove(); checkEmptyState(); saveCurrentPairsToState(true); };
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

  function checkEmptyState() { els.emptyState.classList.toggle('hidden', els.list.children.length > 0); }

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

  // --- CSV Logic ---
  function parseCSVLine(text) {
    const result = [];
    let cell = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char === '"') {
            if (inQuotes && text[i+1] === '"') { cell += '"'; i++; } 
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
            const line = lines[i].trim();
            if (!line) continue;
            const cols = parseCSVLine(line);
            if (cols.length >= 3) {
                const find = cols[0];
                const replace = cols[1];
                const modeName = cols[2] || 'default';
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
        else if(importedModeNames.size > 0) {
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
                const safeFind = `"${(p.find||'').replace(/"/g, '""')}"`;
                const safeReplace = `"${(p.replace||'').replace(/"/g, '""')}"`;
                const safeMode = `"${modeName.replace(/"/g, '""')}"`;
                csvContent += `${safeFind},${safeReplace},${safeMode}\n`;
            });
        }
    });
    const blob = new Blob([csvContent], {type: 'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'settings_trinh_hg_final.csv'; a.click();
  }

  // --- SPLIT LOGIC ---
  function performSplit() {
    const text = els.splitInput.value;
    if(!text.trim()) return showNotification('Chưa có nội dung!', 'error');
    const normalizedText = normalizeText(text);
    const lines = normalizedText.split('\n');
    let chapterHeader = '', contentBody = normalizedText;
    
    // Logic tách header chương
    if (/^(Chương|Chapter)\s+\d+/.test(lines[0].trim())) {
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

    for(let i = 0; i < currentSplitMode; i++) {
        const el = document.getElementById(`out-${i+1}-text`);
        const cEl = document.getElementById(`out-${i+1}-count`);
        if(el) {
            let ph = ''; if (chapterHeader) ph = chapterHeader.replace(/(\d+)/, (m, n) => `${n}.${i+1}`) + '\n\n';
            el.value = ph + (parts[i] || '');
            if(cEl) cEl.textContent = 'Words: ' + countWords(el.value);
        }
    }
    // Clean Input
    els.splitInput.value = '';
    saveTempInput();
    showNotification('Đã chia xong!', 'success');
  }

  function renderSplitOutputs(count) {
    els.splitWrapper.innerHTML = '';
    els.splitWrapper.style.gridTemplateColumns = `repeat(${Math.min(count, 4)}, 1fr)`;
    for(let i = 1; i <= Math.min(count, 10); i++) {
        const div = document.createElement('div'); div.className = 'split-box';
        div.innerHTML = `
            <div class="split-header"><span>Phần ${i}</span><span id="out-${i}-count" class="badge">Words: 0</span></div>
            <textarea id="out-${i}-text" class="custom-scrollbar" readonly></textarea>
            <div class="split-footer"><button class="btn btn-secondary full-width copy-btn" data-target="out-${i}-text">Sao chép phần ${i}</button></div>
        `;
        els.splitWrapper.appendChild(div);
    }
    els.splitWrapper.querySelectorAll('.copy-btn').forEach(b => b.onclick = e => {
        const el = document.getElementById(e.target.dataset.target);
        if(el.value) { navigator.clipboard.writeText(el.value); showNotification(`Đã sao chép P${e.target.dataset.target.split('-')[1]}`); }
    });
  }

  // UTILS
  function countWords(str) { return str.trim() ? str.trim().split(/\s+/).length : 0; }
  function updateCounters() {
    document.getElementById('input-word-count').textContent = 'Words: ' + countWords(els.inputText.value);
    document.getElementById('output-word-count').textContent = 'Words: ' + countWords(els.outputText.innerText);
    document.getElementById('split-input-word-count').textContent = 'Words: ' + countWords(els.splitInput.value);
  }
  function saveTempInputDebounced() { clearTimeout(saveTimeout); saveTimeout = setTimeout(saveTempInput, 500); }
  function saveTempInput() { localStorage.setItem(INPUT_STATE_KEY, JSON.stringify({ inputText: els.inputText.value, splitInput: els.splitInput.value })); }
  function loadTempInput() {
    const saved = JSON.parse(localStorage.getItem(INPUT_STATE_KEY));
    if(saved) { els.inputText.value = saved.inputText || ''; els.splitInput.value = saved.splitInput || ''; }
    updateCounters();
  }
  function switchTab(tabId) {
      document.querySelectorAll('.tab-button').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === tabId));
      state.activeTab = tabId; saveState();
  }

  function initEvents() {
    document.querySelectorAll('.tab-button').forEach(btn => btn.onclick = () => switchTab(btn.dataset.tab));
    
    els.matchCaseBtn.onclick = () => { if(state.modes[state.currentMode]) { state.modes[state.currentMode].matchCase = !state.modes[state.currentMode].matchCase; saveState(); updateModeButtons(); }};
    els.wholeWordBtn.onclick = () => { if(state.modes[state.currentMode]) { state.modes[state.currentMode].wholeWord = !state.modes[state.currentMode].wholeWord; saveState(); updateModeButtons(); }};
    els.autoCapsBtn.onclick = () => { if(state.modes[state.currentMode]) { state.modes[state.currentMode].autoCaps = !state.modes[state.currentMode].autoCaps; saveState(); updateModeButtons(); }};
    
    els.modeSelect.onchange = (e) => { state.currentMode = e.target.value; saveState(); loadSettingsToUI(); };
    document.getElementById('add-mode').onclick = () => { const n = prompt('Tên Mode:'); if(n && !state.modes[n]) { state.modes[n] = { pairs: [], matchCase: false, wholeWord: false, autoCaps: false }; state.currentMode = n; saveState(); renderModeSelect(); loadSettingsToUI(); }};
    document.getElementById('copy-mode').onclick = () => { const n = prompt('Tên Mode Copy:'); if(n && !state.modes[n]) { state.modes[n] = JSON.parse(JSON.stringify(state.modes[state.currentMode])); state.currentMode = n; saveState(); renderModeSelect(); loadSettingsToUI(); }};
    els.renameBtn.onclick = () => { const n = prompt('Tên mới:', state.currentMode); if(n && n !== state.currentMode && !state.modes[n]) { state.modes[n] = state.modes[state.currentMode]; delete state.modes[state.currentMode]; state.currentMode = n; saveState(); renderModeSelect(); }};
    els.deleteBtn.onclick = () => { if(state.currentMode !== 'default' && confirm('Xóa?')) { delete state.modes[state.currentMode]; state.currentMode = 'default'; saveState(); renderModeSelect(); loadSettingsToUI(); }};
    
    document.getElementById('add-pair').onclick = () => addPairToUI();
    document.getElementById('save-settings').onclick = () => saveCurrentPairsToState();
    document.getElementById('replace-button').onclick = performReplaceAll;
    document.getElementById('copy-button').onclick = () => { if(els.outputText.innerText) { navigator.clipboard.writeText(els.outputText.innerText); showNotification('Đã sao chép!'); }};
    document.querySelectorAll('.split-mode-btn').forEach(btn => btn.onclick = () => { document.querySelectorAll('.split-mode-btn').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); currentSplitMode = parseInt(btn.dataset.split); renderSplitOutputs(currentSplitMode); });
    document.getElementById('split-action-btn').onclick = performSplit;
    document.getElementById('export-settings').onclick = exportCSV;
    document.getElementById('import-settings').onclick = () => { const inp = document.createElement('input'); inp.type='file'; inp.accept='.csv'; inp.onchange=e=>{if(e.target.files.length) importCSV(e.target.files[0])}; inp.click(); };
    [els.inputText, els.splitInput].forEach(el => el.addEventListener('input', () => { updateCounters(); saveTempInputDebounced(); }));
  }

  // INIT
  renderModeSelect(); loadSettingsToUI(); loadTempInput(); renderSplitOutputs(currentSplitMode); if(state.activeTab) switchTab(state.activeTab); initEvents();
});
