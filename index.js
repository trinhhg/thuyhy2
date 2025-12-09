document.addEventListener('DOMContentLoaded', () => {
    // =========================================================================
    // 1. CONFIGURATION & STATE
    // =========================================================================
    
    const STORAGE_KEY = 'trinh_hg_settings_v21_final_fixed';
    const INPUT_STATE_KEY = 'trinh_hg_input_state_v21';
  
    // MARKERS
    const MARK_REP_START  = '\uE000'; 
    const MARK_REP_END    = '\uE001';
    const MARK_CAP_START  = '\uE002'; 
    const MARK_CAP_END    = '\uE003';
    const MARK_BOTH_START = '\uE004'; 
    const MARK_BOTH_END   = '\uE005';
  
    const defaultState = {
      currentMode: 'default',
      activeTab: 'settings',
      modes: {
        default: { 
            pairs: [], 
            matchCase: false, 
            wholeWord: false, 
            autoCaps: false, 
            exceptions: 'jpg, png, com, vn, net'
        }
      }
    };
  
    let state = JSON.parse(localStorage.getItem(STORAGE_KEY)) || defaultState;
    if (!state.activeTab) state.activeTab = 'settings';
    if (!state.modes || Object.keys(state.modes).length === 0) {
        state.modes = JSON.parse(JSON.stringify(defaultState.modes));
        state.currentMode = 'default';
    }
    if (!state.modes[state.currentMode]) state.currentMode = Object.keys(state.modes)[0] || 'default';
  
    let currentSplitMode = 2;
    let saveTimeout;
  
    // =========================================================================
    // 2. DOM ELEMENTS
    // =========================================================================
    const els = {
      modeSelect: document.getElementById('mode-select'),
      list: document.getElementById('punctuation-list'),
      matchCaseBtn: document.getElementById('match-case'),
      wholeWordBtn: document.getElementById('whole-word'),
      autoCapsBtn: document.getElementById('auto-caps'), 
      renameBtn: document.getElementById('rename-mode'),
      deleteBtn: document.getElementById('delete-mode'),
      emptyState: document.getElementById('empty-state'),
      capsExceptionInput: document.getElementById('caps-exception'),
      saveExceptionBtn: document.getElementById('save-exception-btn'),
      
      inputText: document.getElementById('input-text'),
      outputText: document.getElementById('output-text'),
      replaceBtn: document.getElementById('replace-button'),
      
      splitInput: document.getElementById('split-input-text'),
      splitWrapper: document.getElementById('split-outputs-wrapper'),
      splitRegexInput: document.getElementById('split-regex-input'),
      splitTypeRadios: document.getElementsByName('split-type'),
      splitControlCount: document.getElementById('split-type-count'),
      splitControlRegex: document.getElementById('split-type-regex'),
      splitActionBtn: document.getElementById('split-action-btn'),
      clearSplitRegexBtn: document.getElementById('clear-split-regex'),
      
      inputCount: document.getElementById('input-word-count'),
      outputCount: document.getElementById('output-word-count'),
      replaceCountBadge: document.getElementById('count-replace'),
      capsCountBadge: document.getElementById('count-caps'),
      splitInputCount: document.getElementById('split-input-word-count')
    };
  
    // =========================================================================
    // 3. HELPER FUNCTIONS
    // =========================================================================
    function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    
    function showNotification(msg, type = 'success') {
      const container = document.getElementById('notification-container');
      const note = document.createElement('div');
      note.className = `notification ${type}`;
      note.textContent = msg;
      container.appendChild(note);
      setTimeout(() => { note.style.opacity = '0'; setTimeout(() => note.remove(), 300); }, 2000); 
    }
  
    function normalizeText(text) {
      if (typeof text !== 'string') return '';
      if (text.length === 0) return text;
      return text.replace(/[\u201C\u201D\u201E\u201F\u00AB\u00BB\u275D\u275E\u301D-\u301F\uFF02\u02DD]/g, '"')
                 .replace(/[\u2018\u2019\u201A\u201B\u2039\u203A\u275B\u275C\u276E\u276F\uA78C\uFF07]/g, "'")
                 .replace(/\u00A0/g, ' ');
    }
    
    function escapeHTML(str) { return str.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])); }
    function escapeRegExp(string) { return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
    function preserveCase(o, r) {
        if (o === o.toUpperCase() && o !== o.toLowerCase()) return r.toUpperCase();
        if (o[0] === o[0].toUpperCase()) return r.charAt(0).toUpperCase() + r.slice(1).toLowerCase();
        return r;
    }
    function countWords(str) { return str.trim() ? str.trim().split(/\s+/).length : 0; }

    // =========================================================================
    // 4. CORE: FIND & REPLACE (2 PHASES)
    // =========================================================================
    
    function performReplaceAll() {
        const rawText = els.inputText.value;
        if (!rawText) return showNotification("Chưa có nội dung!", "error");

        try {
            const mode = state.modes[state.currentMode];
            let processedText = normalizeText(rawText);
            
            // Clean Spacing
            processedText = processedText.replace(/\n\s*\n\s*\n+/g, '\n').split(/\r?\n/).filter(line => line.trim() !== '').join('\n\n');

            let countReplace = 0;
            let countCaps = 0;

            // --- BƯỚC 1: REPLACE ---
            if (mode.pairs && mode.pairs.length > 0) {
                const rules = mode.pairs
                    .filter(p => p.find && p.find.trim())
                    .map(p => ({ find: normalizeText(p.find), replace: normalizeText(p.replace || '') }))
                    .sort((a,b) => b.find.length - a.find.length);

                rules.forEach(rule => {
                    const pattern = escapeRegExp(rule.find);
                    const flags = mode.matchCase ? 'g' : 'gi';
                    const regex = mode.wholeWord ? new RegExp(`(?<![\\p{L}\\p{N}_])${pattern}(?![\\p{L}\\p{N}_])`, flags + 'u') : new RegExp(pattern, flags);
                    
                    processedText = processedText.replace(regex, (match) => {
                        countReplace++; // Đếm Replace
                        let replacement = rule.replace;
                        if (!mode.matchCase) replacement = preserveCase(match, replacement);
                        return `${MARK_REP_START}${replacement}${MARK_REP_END}`;
                    });
                });
            }

            // --- BƯỚC 2: AUTO CAPS ---
            if (mode.autoCaps) {
                const exceptionList = (mode.exceptions || "").split(',').map(s => s.trim().toLowerCase()).filter(s => s);
                
                // Logic Regex:
                // 1. Dòng đầu tiên (^).
                // 2. Dấu kết câu (.?!) theo sau là dấu cách (\s+).
                // Capture Group:
                // Gr1: Prefix (Dấu câu + Space) hoặc Start line
                // Nội dung sau đó có thể là:
                //    - Marker Vàng + Text + Marker End
                //    - Hoặc Text thường
                
                const autoCapsRegex = /(^|[.?!]\s+)(?:(\uE000)(.*?)(\uE001)|([^\s\uE000\uE001]+))/gmu;

                processedText = processedText.replace(autoCapsRegex, (match, prefix, mStart, mContent, mEnd, rawWord) => {
                    let targetWord = mContent || rawWord;
                    if (!targetWord) return match;
                    
                    // Check ngoại lệ (file.jpg, etc.)
                    if (exceptionList.includes(targetWord.toLowerCase())) return match;
                    
                    // Viết hoa chữ đầu
                    let cappedWord = targetWord.charAt(0).toUpperCase() + targetWord.slice(1);
                    
                    // Nếu từ gốc đã viết hoa rồi thì thôi, trừ khi nó nằm trong Replace
                    // Nếu là Replace (mStart tồn tại), ta chắc chắn đổi màu, kể cả nó đã viết hoa sẵn hay chưa (do user replace thành chữ thường chẳng hạn)
                    
                    if (mStart) {
                        // Vừa Replace, Vừa Caps -> Màu Cam (Both)
                        // Đã đếm replace ở trên, giờ đếm thêm Caps
                        countCaps++;
                        return `${prefix}${MARK_BOTH_START}${cappedWord}${MARK_BOTH_END}`;
                    } else {
                        // Chỉ Caps -> Màu Xanh
                        if (rawWord.charAt(0) === rawWord.charAt(0).toUpperCase()) return match; // Đã hoa rồi thì bỏ qua
                        countCaps++;
                        return `${prefix}${MARK_CAP_START}${cappedWord}${MARK_CAP_END}`;
                    }
                });
            }

            // --- RENDER HTML ---
            let finalHTML = ''; let buffer = '';
            for (let i = 0; i < processedText.length; i++) {
                const c = processedText[i];
                if (c === MARK_REP_START) { finalHTML += escapeHTML(buffer) + '<mark class="hl-yellow">'; buffer = ''; }
                else if (c === MARK_REP_END || c === MARK_CAP_END || c === MARK_BOTH_END) { finalHTML += escapeHTML(buffer) + '</mark>'; buffer = ''; }
                else if (c === MARK_CAP_START) { finalHTML += escapeHTML(buffer) + '<mark class="hl-blue">'; buffer = ''; }
                else if (c === MARK_BOTH_START) { finalHTML += escapeHTML(buffer) + '<mark class="hl-orange">'; buffer = ''; }
                else { buffer += c; }
            }
            finalHTML += escapeHTML(buffer);

            // Update UI
            els.outputText.innerHTML = finalHTML;
            els.replaceCountBadge.textContent = `Replace: ${countReplace}`;
            els.capsCountBadge.textContent = `Auto-Caps: ${countCaps}`;
            updateCounters();
            
            els.inputText.value = ''; saveTempInput();
            showNotification("Hoàn tất xử lý!");
        } catch (e) { console.error(e); showNotification("Lỗi: " + e.message, "error"); }
    }

    // =========================================================================
    // 5. SPLITTER
    // =========================================================================
    
    function renderSplitPlaceholders(count) {
        els.splitWrapper.innerHTML = ''; 
        for (let i = 1; i <= count; i++) {
             const div = document.createElement('div'); div.className = 'split-box';
             div.innerHTML = `
                <div class="split-header"><span>Phần ${i} (Chờ kết quả...)</span><span class="badge">0 W</span></div>
                <textarea id="out-split-${i-1}" class="custom-scrollbar" readonly placeholder="Kết quả phần ${i} sẽ hiện ở đây..."></textarea>
                <div class="split-footer"><button class="btn btn-success full-width copy-split-btn" data-target="out-split-${i-1}" data-seq="${i}">Sao chép ${i}</button></div>
            `;
            els.splitWrapper.appendChild(div);
        }
        bindCopyEvents();
    }

    function performSplit() {
        const text = els.splitInput.value;
        if(!text.trim()) return showNotification('Chưa có nội dung!', 'error');
        const splitType = document.querySelector('input[name="split-type"]:checked').value;

        if (splitType === 'regex') {
            const regexStr = els.splitRegexInput.value;
            if (!regexStr) return showNotification("Chưa nhập Regex!", "error");
            try {
                const regex = new RegExp(regexStr, 'gmi');
                const matches = [...text.matchAll(regex)];
                if (matches.length === 0) return showNotification("Không tìm thấy chương nào!", "warning");
                
                let parts = [];
                for (let i = 0; i < matches.length; i++) {
                    const start = matches[i].index;
                    const end = (i < matches.length - 1) ? matches[i+1].index : text.length;
                    let chunk = text.substring(start, end).trim().split(/\r?\n/).filter(l => l.trim()).join('\n\n');
                    const title = chunk.split('\n')[0].trim();
                    parts.push({ content: chunk, title: title || `Phần ${i+1}` });
                }
                renderFilledSplitGrid(parts); 
                showNotification(`Đã tìm thấy ${parts.length} chương!`);
            } catch (e) { return showNotification("Regex không hợp lệ!", "error"); }
        } else {
            // Count Mode Logic
            const lines = normalizeText(text).split('\n');
            let chapterHeader = '', contentBody = normalizeText(text);
            if (/^(Chương|Chapter|Hồi)\s+\d+/.test(lines[0].trim())) { chapterHeader = lines[0].trim(); contentBody = lines.slice(1).join('\n'); }
            const paragraphs = contentBody.split('\n').filter(p => p.trim());
            const targetWords = Math.ceil(countWords(contentBody) / currentSplitMode);
            let currentPart = [], currentCount = 0, rawParts = [];
            
            for (let p of paragraphs) {
                const wCount = countWords(p);
                if (currentCount + wCount > targetWords && rawParts.length < currentSplitMode - 1) { rawParts.push(currentPart.join('\n\n')); currentPart = [p]; currentCount = wCount; } 
                else { currentPart.push(p); currentCount += wCount; }
            }
            if (currentPart.length) rawParts.push(currentPart.join('\n\n'));
            
            const existingBoxes = els.splitWrapper.children;
            if (existingBoxes.length !== currentSplitMode) renderSplitPlaceholders(currentSplitMode);

            for(let i = 0; i < currentSplitMode; i++) {
                let pContent = rawParts[i] || '';
                let h = `Phần ${i+1}`;
                if (chapterHeader && pContent) { h = chapterHeader.replace(/(\d+)/, (m, n) => `${n}.${i+1}`); pContent = h + '\n\n' + pContent; }
                const textArea = document.getElementById(`out-split-${i}`);
                const headerSpan = existingBoxes[i].querySelector('.split-header span:first-child');
                const badge = existingBoxes[i].querySelector('.badge');
                if (textArea) { textArea.value = pContent; if(headerSpan) headerSpan.textContent = pContent ? h : `Phần ${i+1} (Trống)`; if(badge) badge.textContent = countWords(pContent) + ' W'; }
            }
            showNotification(`Đã chia xong!`);
        }
        els.splitInput.value = ''; saveTempInput();
    }

    function renderFilledSplitGrid(parts) {
        els.splitWrapper.innerHTML = '';
        parts.forEach((part, index) => {
            const div = document.createElement('div'); div.className = 'split-box';
            div.innerHTML = `
                <div class="split-header"><span>${part.title.substring(0,27)}...</span><span class="badge">${countWords(part.content)} W</span></div>
                <textarea id="out-split-${index}" class="custom-scrollbar" readonly>${part.content}</textarea>
                <div class="split-footer"><button class="btn btn-success full-width copy-split-btn" data-target="out-split-${index}" data-seq="${index+1}">Sao chép ${index+1}</button></div>`;
            els.splitWrapper.appendChild(div);
        });
        bindCopyEvents();
    }

    function bindCopyEvents() {
        els.splitWrapper.querySelectorAll('.copy-split-btn').forEach(b => {
            b.onclick = (e) => {
                const el = document.getElementById(e.target.dataset.target);
                if(el && el.value) { 
                    navigator.clipboard.writeText(el.value); 
                    e.target.textContent = `Đã chép ${e.target.dataset.seq}!`;
                    setTimeout(()=>{ e.target.textContent = `Sao chép ${e.target.dataset.seq}`; }, 1500);
                } else showNotification("Ô trống!", "warning");
            };
        });
    }

    // =========================================================================
    // 6. UI & EVENTS
    // =========================================================================
    function renderModeSelect() {
      els.modeSelect.innerHTML = '';
      Object.keys(state.modes).sort().forEach(m => {
        const opt = document.createElement('option'); opt.value = m; opt.textContent = m;
        els.modeSelect.appendChild(opt);
      });
      if(!state.modes[state.currentMode]) state.currentMode = 'default';
      els.modeSelect.value = state.currentMode;
      updateModeUI();
    }
  
    function updateModeUI() {
      const mode = state.modes[state.currentMode];
      if(mode) {
          const upd = (btn, act, txt) => { btn.textContent = `${txt}: ${act ? 'BẬT' : 'Tắt'}`; btn.classList.toggle('active', act); };
          upd(els.matchCaseBtn, mode.matchCase, 'Match Case');
          upd(els.wholeWordBtn, mode.wholeWord, 'Whole Word');
          upd(els.autoCapsBtn, mode.autoCaps, 'Auto Caps');
          els.capsExceptionInput.value = mode.exceptions || '';
      }
    }
  
    function addPairToUI(find = '', replace = '', append = false) {
      const item = document.createElement('div'); item.className = 'punctuation-item';
      item.innerHTML = `<input type="text" class="find" placeholder="Tìm" value="${find.replace(/"/g, '&quot;')}"><input type="text" class="replace" placeholder="Thay thế" value="${replace.replace(/"/g, '&quot;')}"><button class="remove" tabindex="-1">×</button>`;
      item.querySelector('.remove').onclick = () => { item.remove(); checkEmptyState(); saveCurrentPairsToState(true); };
      item.querySelectorAll('input').forEach(inp => inp.addEventListener('input', debounceSave));
      if (append) els.list.appendChild(item); else els.list.insertBefore(item, els.list.firstChild);
      checkEmptyState();
    }
    
    function loadSettingsToUI() {
      els.list.innerHTML = '';
      const mode = state.modes[state.currentMode];
      if (mode && mode.pairs) mode.pairs.forEach(p => addPairToUI(p.find, p.replace, true));
      updateModeUI(); checkEmptyState();
    }
    function checkEmptyState() { els.emptyState.classList.toggle('hidden', els.list.children.length > 0); }
    function saveCurrentPairsToState(silent = false) {
      const items = Array.from(els.list.children);
      const newPairs = items.map(item => ({ find: item.querySelector('.find').value, replace: item.querySelector('.replace').value })).filter(p => p.find !== '');
      state.modes[state.currentMode].pairs = newPairs;
      // Note: Exceptions được lưu riêng qua nút hoặc khi đổi mode, nhưng lưu ở đây cũng an toàn
      // state.modes[state.currentMode].exceptions = els.capsExceptionInput.value; 
      saveState(); if (!silent) showNotification('Đã lưu cài đặt!', 'success');
    }
    
    // CSV Logic
    function parseCSVLine(text) {
        const result = []; let cell = ''; let inQuotes = false;
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if (char === '"') { if (inQuotes && text[i+1] === '"') { cell += '"'; i++; } else { inQuotes = !inQuotes; } } 
            else if ((char === ',' || char === '\t') && !inQuotes) { result.push(cell.trim()); cell = ''; } 
            else { cell += char; }
        } result.push(cell.trim()); return result;
    }
    function importCSV(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target.result; const lines = text.split(/\r?\n/);
            if (!lines[0].toLowerCase().includes('find') || !lines[0].toLowerCase().includes('replace')) return showNotification('Lỗi Header CSV!', 'error');
            let count = 0;
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim(); if (!line) continue;
                const cols = parseCSVLine(line);
                if (cols.length >= 2) {
                    const find = cols[0]; const replace = cols[1]; const modeName = cols[2] || 'default';
                    if (find) {
                        if (!state.modes[modeName]) state.modes[modeName] = JSON.parse(JSON.stringify(defaultState.modes.default));
                        state.modes[modeName].pairs.push({ find, replace }); count++;
                    }
                }
            }
            saveState(); renderModeSelect(); loadSettingsToUI(); showNotification(`Đã nhập ${count} cặp!`);
        }; reader.readAsText(file);
    }
    function exportCSV() {
        saveCurrentPairsToState(true);
        let csvContent = "\uFEFFfind,replace,mode\n"; 
        Object.keys(state.modes).forEach(modeName => {
            const mode = state.modes[modeName];
            if (mode.pairs) mode.pairs.forEach(p => { csvContent += `"${(p.find||'').replace(/"/g, '""')}","${(p.replace||'').replace(/"/g, '""')}","${modeName.replace(/"/g, '""')}"\n`; });
        });
        const blob = new Blob([csvContent], {type: 'text/csv;charset=utf-8;'});
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'settings_full.csv'; a.click();
    }

    function updateCounters() {
      els.inputCount.textContent = 'Words: ' + countWords(els.inputText.value);
      els.outputCount.textContent = 'Words: ' + countWords(els.outputText.innerText);
      els.splitInputCount.textContent = 'Words: ' + countWords(els.splitInput.value);
    }
    function debounceSave() { clearTimeout(saveTimeout); saveTimeout = setTimeout(() => { saveTempInput(); if(state.activeTab==='settings') saveCurrentPairsToState(true); }, 500); }
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
      const toggleHandler = (prop) => { const m = state.modes[state.currentMode]; m[prop] = !m[prop]; saveState(); updateModeUI(); };
      els.matchCaseBtn.onclick = () => toggleHandler('matchCase');
      els.wholeWordBtn.onclick = () => toggleHandler('wholeWord');
      els.autoCapsBtn.onclick = () => toggleHandler('autoCaps');
      
      // FIX ISSUE 6: Mode Switch
      els.modeSelect.onchange = (e) => { 
          state.currentMode = e.target.value; 
          saveState(); 
          loadSettingsToUI(); // Load lại list ngay lập tức
      };
      
      // FIX ISSUE 7: Save Exception Button
      els.saveExceptionBtn.onclick = () => {
          state.modes[state.currentMode].exceptions = els.capsExceptionInput.value;
          saveState();
          showNotification('Đã lưu ngoại lệ!');
      };

      document.getElementById('add-mode').onclick = () => { 
          const n = prompt('Tên Mode mới:'); 
          if(n && !state.modes[n]) { state.modes[n] = JSON.parse(JSON.stringify(defaultState.modes.default)); state.currentMode = n; saveState(); renderModeSelect(); loadSettingsToUI(); }
      };
      document.getElementById('copy-mode').onclick = () => {
        const n = prompt('Tên Mode bản sao:'); 
        if(n && !state.modes[n]) { state.modes[n] = JSON.parse(JSON.stringify(state.modes[state.currentMode])); state.currentMode = n; saveState(); renderModeSelect(); loadSettingsToUI(); }
      };
      els.renameBtn.onclick = () => { 
          const n = prompt('Tên mới:', state.currentMode); 
          if(n && n !== state.currentMode && !state.modes[n]) { state.modes[n] = state.modes[state.currentMode]; delete state.modes[state.currentMode]; state.currentMode = n; saveState(); renderModeSelect(); }
      };
      els.deleteBtn.onclick = () => { 
          if(confirm('Xóa chế độ này?')) { 
              delete state.modes[state.currentMode]; 
              const keys = Object.keys(state.modes);
              if (keys.length === 0) { state.modes['default'] = JSON.parse(JSON.stringify(defaultState.modes.default)); state.currentMode = 'default'; } else { state.currentMode = keys[0]; }
              saveState(); renderModeSelect(); loadSettingsToUI(); 
          }
      };
      document.getElementById('add-pair').onclick = () => addPairToUI();
      document.getElementById('save-settings').onclick = () => saveCurrentPairsToState();
      document.getElementById('export-settings').onclick = exportCSV;
      document.getElementById('import-settings').onclick = () => { const inp = document.createElement('input'); inp.type='file'; inp.accept='.csv'; inp.onchange = e => { if(e.target.files.length) importCSV(e.target.files[0]) }; inp.click(); };
      els.replaceBtn.onclick = performReplaceAll;
      document.getElementById('copy-button').onclick = () => { if(els.outputText.innerText) { navigator.clipboard.writeText(els.outputText.innerText).then(() => { showNotification('Đã sao chép văn bản!'); }); }};

      // SPLIT EVENTS
      els.splitTypeRadios.forEach(radio => {
          radio.addEventListener('change', (e) => {
              const val = e.target.value;
              els.splitControlCount.classList.toggle('hidden', val !== 'count');
              els.splitControlRegex.classList.toggle('hidden', val !== 'regex');
              if(val === 'count') renderSplitPlaceholders(currentSplitMode);
              else els.splitWrapper.innerHTML = ''; // Regex mode starts empty
          });
      });
      document.querySelectorAll('.split-mode-btn').forEach(btn => btn.onclick = () => { 
          document.querySelectorAll('.split-mode-btn').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); 
          currentSplitMode = parseInt(btn.dataset.split); 
          renderSplitPlaceholders(currentSplitMode);
      });
      els.splitActionBtn.onclick = performSplit;
      
      // Clear Regex Button
      els.clearSplitRegexBtn.onclick = () => {
          els.splitWrapper.innerHTML = '';
          showNotification('Đã xóa kết quả chia!');
      };
      
      [els.inputText, els.splitInput].forEach(el => el.addEventListener('input', () => { updateCounters(); debounceSave(); }));
    }

    // INIT
    renderModeSelect(); 
    loadSettingsToUI(); 
    loadTempInput(); 
    if(state.activeTab) switchTab(state.activeTab); 
    if (document.querySelector('input[name="split-type"]:checked').value === 'count') renderSplitPlaceholders(currentSplitMode);
    
    initEvents();
});
