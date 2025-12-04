document.addEventListener('DOMContentLoaded', () => {
  // === 1. CONFIG & STATE ===
  const STORAGE_KEY = 'trinh_hg_settings_v17_final_optimized'; 
  const INPUT_STATE_KEY = 'trinh_hg_input_state_v17'; 

  // Ký tự đặc biệt để đánh dấu vùng đã thay thế (Private Use Area)
  // MARK_REP: Dùng cho từ được Replace (Vàng)
  // MARK_CAP: Dùng cho từ được Auto Caps (Xanh)
  const MARK_REP_START = '\uE000';
  const MARK_REP_END = '\uE001';
  const MARK_CAP_START = '\uE002';
  const MARK_CAP_END = '\uE003';

  const defaultState = {
    currentMode: 'default',
    activeTab: 'settings', 
    modes: {
      default: { pairs: [], matchCase: false, wholeWord: false, autoCaps: false }
    }
  };

  let state = JSON.parse(localStorage.getItem(STORAGE_KEY)) || defaultState;
  // Fallback nếu dữ liệu lỗi
  if (!state.activeTab) state.activeTab = 'settings'; 
  if (!state.modes || Object.keys(state.modes).length === 0) {
      state.modes = defaultState.modes;
      state.currentMode = 'default';
  }
  // Đảm bảo mode hiện tại tồn tại
  if (!state.modes[state.currentMode]) state.currentMode = Object.keys(state.modes)[0] || 'default';

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
    
    // Buttons & Labels
    matchCaseBtn: document.getElementById('match-case'),
    wholeWordBtn: document.getElementById('whole-word'),
    autoCapsBtn: document.getElementById('auto-caps'), 
    renameBtn: document.getElementById('rename-mode'),
    deleteBtn: document.getElementById('delete-mode'),
    emptyState: document.getElementById('empty-state'),
    
    replaceBtn: document.getElementById('replace-button'),
    
    // Word counts
    inputCount: document.getElementById('input-word-count'),
    outputCount: document.getElementById('output-word-count'),
    splitInputCount: document.getElementById('split-input-word-count')
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
      setTimeout(() => note.remove(), 300); 
    }, 2800); 
  }

  // --- NORMALIZE: Smart Quotes -> ASCII ---
  function normalizeText(text) {
    if (typeof text !== 'string') return '';
    if (text.length === 0) return text;
    
    return text
      .replace(/[\u201C\u201D\u201E\u201F\u00AB\u00BB\u275D\u275E\u301D-\u301F\uFF02\u02DD]/g, '"') // Double quotes
      .replace(/[\u2018\u2019\u201A\u201B\u2039\u203A\u275B\u275C\u276E\u276F\uA78C\uFF07]/g, "'") // Single quotes
      .replace(/\u00A0/g, ' '); // NBSP
  }

  // --- HTML ESCAPE: Bảo vệ chống XSS và giữ cấu trúc khi hiển thị ---
  function escapeHTML(str) {
      return str.replace(/[&<>"']/g, function(m) {
          switch (m) {
              case '&': return '&amp;';
              case '<': return '&lt;';
              case '>': return '&gt;';
              case '"': return '&quot;';
              case "'": return '&#039;';
          }
      });
  }

  // --- PRESERVE CASE ---
  function preserveCase(original, replacement) {
      // Nếu từ tìm thấy là viết hoa toàn bộ (và dài > 0)
      if (original === original.toUpperCase() && original !== original.toLowerCase()) {
          return replacement.toUpperCase();
      }
      // Nếu ký tự đầu viết hoa
      if (original[0] === original[0].toUpperCase() && original.slice(1) === original.slice(1).toLowerCase()) {
          return replacement.charAt(0).toUpperCase() + replacement.slice(1).toLowerCase();
      }
      return replacement;
  }

  // --- REGEX ESCAPE ---
  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // === 3. CORE LOGIC (NO FREEZE) ===
  
  function performReplaceAll() {
      // 1. UI Feedback
      els.replaceBtn.disabled = true;
      els.replaceBtn.textContent = 'Đang xử lý...';

      // Sử dụng setTimeout để UI render trạng thái disabled trước khi chạy logic nặng
      setTimeout(() => {
          try {
              executeLogic();
          } catch (e) {
              console.error(e);
              showNotification("Có lỗi xảy ra: " + e.message, "error");
          } finally {
              els.replaceBtn.disabled = false;
              els.replaceBtn.textContent = 'THỰC HIỆN THAY THẾ';
          }
      }, 50);
  }

  function executeLogic() {
      const mode = state.modes[state.currentMode];
      if(!mode.pairs.length) {
        return showNotification("Chưa có cặp thay thế nào!", "error");
      }

      let rawText = els.inputText.value;
      if (!rawText) return;

      // Bước 1: Chuẩn hóa quotes
      let processedText = normalizeText(rawText);

      // Sắp xếp rules: Ưu tiên chuỗi dài trước để tránh replace chồng chéo sai
      const rules = mode.pairs
        .filter(p => p.find && p.find.trim())
        .map(p => ({
            find: normalizeText(p.find), 
            replace: normalizeText(p.replace || '') 
        }))
        .sort((a,b) => b.find.length - a.find.length);

      let replaceCount = 0;

      // === PHASE 1: REPLACEMENTS (Yellow) ===
      // Chiến thuật: Thay thế text bằng MARKER + Text Mới + MARKER.
      // Không sửa DOM, chỉ sửa chuỗi.
      
      rules.forEach(rule => {
          const pattern = escapeRegExp(rule.find);
          let regex;
          const flags = mode.matchCase ? 'g' : 'gi';

          // Xử lý Whole Word bằng Unicode Lookaround (Chuẩn Google Docs)
          // (?<!\p{L}) : Phía trước không phải là chữ cái/số
          // (?!\p{L})  : Phía sau không phải là chữ cái/số
          if (mode.wholeWord) {
              regex = new RegExp(`(?<![\\p{L}\\p{N}_])${pattern}(?![\\p{L}\\p{N}_])`, flags + 'u');
          } else {
              regex = new RegExp(pattern, flags);
          }

          processedText = processedText.replace(regex, (match) => {
              replaceCount++;
              let replacement = rule.replace;
              if (!mode.matchCase) {
                  replacement = preserveCase(match, replacement);
              }
              // Bọc trong ký tự đánh dấu bí mật để highlight sau
              return `${MARK_REP_START}${replacement}${MARK_REP_END}`;
          });
      });

      // === PHASE 2: AUTO CAPS (Blue) ===
      // Logic: Tìm ký tự viết thường nằm sau dấu câu HOẶC đầu dòng.
      // Chỉ xử lý nếu nó chưa được bọc trong MARK_REP (Ưu tiên replace của user)
      // Nhưng nếu replace của user tạo ra chữ thường ở đầu câu, ta CÓ NÊN viết hoa không?
      // Yêu cầu: "nằm sau dấu . ? ! ... mà chưa viết hoa thì viết hoa".
      // Highlight màu xanh.
      
      if (mode.autoCaps) {
          // Regex tìm:
          // Group 1: Dấu kết thúc câu (.?!) + khoảng trắng HOẶC đầu dòng (^ hoặc \n)
          // Group 2: Có thể là marker kết thúc của replace trước đó (nếu có) - non-capturing
          // Group 3: Ký tự chữ cái viết thường (\p{LL})
          const autoCapsRegex = /(^|[\.?!\n]\s*)(?:\uE000|\uE001|\uE002|\uE003)*([\p{Ll}])/gmu;

          processedText = processedText.replace(autoCapsRegex, (fullMatch, prefix, char) => {
              // Kiểm tra xem ký tự này có nằm trong vùng đã replace (Yellow) không?
              // Nếu nó nằm TRONG cặp MARK_REP thì ta không nên can thiệp wrapper ngoài,
              // nhưng ta cần viết hoa nội dung bên trong.
              // Tuy nhiên regex trên match từ ngoài.
              
              // Để đơn giản và an toàn: Ta chỉ Auto Cap những từ chưa được Mark,
              // HOẶC những từ đã Mark nhưng text bên trong là thường.
              
              // Nhưng với Regex trên, 'char' là chữ cái thường.
              // Ta sẽ viết hoa nó và bọc MARK_CAP (Blue).
              // Lưu ý: Prefix là dấu câu, giữ nguyên.
              
              // Logic fix: Nếu prefix dính liền marker, cẩn thận vỡ token.
              // Cách an toàn nhất: Chỉ wrap ký tự char.
              
              // Chuyển ký tự thành hoa
              const upperChar = char.toUpperCase();
              
              // Trả về: Prefix + Marker Blue Start + Char + Marker Blue End
              // Lưu ý: prefix lấy từ capture group 1
              return `${prefix}${MARK_CAP_START}${upperChar}${MARK_CAP_END}`;
          });
      }

      // === PHASE 3: RENDERING (Build HTML) ===
      // Quét chuỗi, escape HTML các phần văn bản thường, biến Marker thành thẻ <mark>
      
      let finalHTML = '';
      let buffer = '';
      
      for (let i = 0; i < processedText.length; i++) {
          const c = processedText[i];
          
          if (c === MARK_REP_START) {
              finalHTML += escapeHTML(buffer); // Flush buffer cũ
              buffer = '';
              finalHTML += '<mark class="hl-yellow">';
          } else if (c === MARK_REP_END) {
              finalHTML += escapeHTML(buffer);
              buffer = '';
              finalHTML += '</mark>';
          } else if (c === MARK_CAP_START) {
              finalHTML += escapeHTML(buffer);
              buffer = '';
              finalHTML += '<mark class="hl-blue">';
          } else if (c === MARK_CAP_END) {
              finalHTML += escapeHTML(buffer);
              buffer = '';
              finalHTML += '</mark>';
          } else {
              buffer += c;
          }
      }
      finalHTML += escapeHTML(buffer); // Flush phần còn lại

      // Cập nhật DOM 1 lần duy nhất
      els.outputText.innerHTML = finalHTML;

      // Cleanup
      els.inputText.value = ''; 
      saveTempInput(); 
      updateCounters();
      
      if (replaceCount > 0) {
        showNotification(`Đã thay thế ${replaceCount} vị trí!`);
      } else if (mode.autoCaps) {
        showNotification(`Đã hoàn tất kiểm tra Auto Caps!`);
      } else {
        showNotification(`Không tìm thấy từ nào để thay thế.`, 'warning');
      }
  }

  // === 4. UI & UTILS ===
  
  function renderModeSelect() {
    els.modeSelect.innerHTML = '';
    Object.keys(state.modes).sort().forEach(m => {
      const opt = document.createElement('option');
      opt.value = m; opt.textContent = m;
      els.modeSelect.appendChild(opt);
    });
    // Re-verify current mode
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
    
    // Phát hiện header chương (ví dụ Chương 1, Chapter 10...)
    if (/^(Chương|Chapter)\s+\d+/.test(lines[0].trim())) {
        chapterHeader = lines[0].trim(); contentBody = lines.slice(1).join('\n');
    }
    
    const paragraphs = contentBody.split('\n').filter(p => p.trim());
    const totalWords = countWords(contentBody);
    const targetWords = Math.ceil(totalWords / currentSplitMode);
    
    let parts = [], currentPart = [], currentCount = 0;
    
    for (let p of paragraphs) {
        const wCount = countWords(p);
        // Nếu thêm đoạn này mà vượt quá target (và không phải phần cuối cùng)
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

    for(let i = 0; i < currentSplitMode; i++) {
        const el = document.getElementById(`out-${i+1}-text`);
        const cEl = document.getElementById(`out-${i+1}-count`);
        if(el) {
            let ph = ''; 
            if (chapterHeader) {
                // Tạo header phụ: Chương 1.1, Chương 1.2
                ph = chapterHeader.replace(/(\d+)/, (m, n) => `${n}.${i+1}`) + '\n\n';
            }
            el.value = ph + (parts[i] || '');
            if(cEl) cEl.textContent = 'Words: ' + countWords(el.value);
        }
    }
    
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
    els.inputCount.textContent = 'Words: ' + countWords(els.inputText.value);
    // outputText là div, lấy innerText
    els.outputCount.textContent = 'Words: ' + countWords(els.outputText.innerText);
    els.splitInputCount.textContent = 'Words: ' + countWords(els.splitInput.value);
  }

  // Debounce save input để tránh lag
  function saveTempInputDebounced() { 
    clearTimeout(saveTimeout); 
    saveTimeout = setTimeout(saveTempInput, 500); 
  }
  
  function saveTempInput() { 
    localStorage.setItem(INPUT_STATE_KEY, JSON.stringify({ 
        inputText: els.inputText.value, 
        splitInput: els.splitInput.value 
    })); 
  }
  
  function loadTempInput() {
    const saved = JSON.parse(localStorage.getItem(INPUT_STATE_KEY));
    if(saved) { 
        els.inputText.value = saved.inputText || ''; 
        els.splitInput.value = saved.splitInput || ''; 
    }
    updateCounters();
  }
  
  function switchTab(tabId) {
      document.querySelectorAll('.tab-button').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === tabId));
      state.activeTab = tabId; 
      saveState();
  }

  function initEvents() {
    document.querySelectorAll('.tab-button').forEach(btn => btn.onclick = () => switchTab(btn.dataset.tab));
    
    // Toggle Buttons Logic
    els.matchCaseBtn.onclick = () => { 
        const m = state.modes[state.currentMode]; m.matchCase = !m.matchCase; 
        saveState(); updateModeButtons(); 
    };
    els.wholeWordBtn.onclick = () => { 
        const m = state.modes[state.currentMode]; m.wholeWord = !m.wholeWord; 
        saveState(); updateModeButtons(); 
    };
    els.autoCapsBtn.onclick = () => { 
        const m = state.modes[state.currentMode]; m.autoCaps = !m.autoCaps; 
        saveState(); updateModeButtons(); 
    };
    
    // Mode Management
    els.modeSelect.onchange = (e) => { state.currentMode = e.target.value; saveState(); loadSettingsToUI(); };
    document.getElementById('add-mode').onclick = () => { 
        const n = prompt('Tên Mode:'); 
        if(n && !state.modes[n]) { 
            state.modes[n] = { pairs: [], matchCase: false, wholeWord: false, autoCaps: false }; 
            state.currentMode = n; saveState(); renderModeSelect(); loadSettingsToUI(); 
        }
    };
    document.getElementById('copy-mode').onclick = () => { 
        const n = prompt('Tên Mode Copy:'); 
        if(n && !state.modes[n]) { 
            state.modes[n] = JSON.parse(JSON.stringify(state.modes[state.currentMode])); 
            state.currentMode = n; saveState(); renderModeSelect(); loadSettingsToUI(); 
        }
    };
    els.renameBtn.onclick = () => { 
        const n = prompt('Tên mới:', state.currentMode); 
        if(n && n !== state.currentMode && !state.modes[n]) { 
            state.modes[n] = state.modes[state.currentMode]; 
            delete state.modes[state.currentMode]; 
            state.currentMode = n; saveState(); renderModeSelect(); 
        }
    };
    els.deleteBtn.onclick = () => { 
        if(state.currentMode !== 'default' && confirm('Xóa chế độ này?')) { 
            delete state.modes[state.currentMode]; 
            state.currentMode = 'default'; 
            saveState(); renderModeSelect(); loadSettingsToUI(); 
        }
    };
    
    // Action Buttons
    document.getElementById('add-pair').onclick = () => addPairToUI();
    document.getElementById('save-settings').onclick = () => saveCurrentPairsToState();
    
    // Replace Button with Anti-Freeze check
    els.replaceBtn.onclick = performReplaceAll;
    
    document.getElementById('copy-button').onclick = () => { 
        if(els.outputText.innerText) { 
            navigator.clipboard.writeText(els.outputText.innerText); 
            showNotification('Đã sao chép!'); 
        }
    };

    // Split buttons
    document.querySelectorAll('.split-mode-btn').forEach(btn => btn.onclick = () => { 
        document.querySelectorAll('.split-mode-btn').forEach(b=>b.classList.remove('active')); 
        btn.classList.add('active'); 
        currentSplitMode = parseInt(btn.dataset.split); 
        renderSplitOutputs(currentSplitMode); 
    });
    document.getElementById('split-action-btn').onclick = performSplit;
    
    // Import/Export
    document.getElementById('export-settings').onclick = exportCSV;
    document.getElementById('import-settings').onclick = () => { 
        const inp = document.createElement('input'); inp.type='file'; inp.accept='.csv'; 
        inp.onchange=e=>{if(e.target.files.length) importCSV(e.target.files[0])}; 
        inp.click(); 
    };

    // Input monitoring
    [els.inputText, els.splitInput].forEach(el => el.addEventListener('input', () => { 
        updateCounters(); 
        saveTempInputDebounced(); 
    }));
  }

  // INIT
  renderModeSelect(); 
  loadSettingsToUI(); 
  loadTempInput(); 
  renderSplitOutputs(currentSplitMode); 
  if(state.activeTab) switchTab(state.activeTab); 
  initEvents();
});
