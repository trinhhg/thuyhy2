document.addEventListener('DOMContentLoaded', () => {
  // === 1. CONFIG & STATE ===
  const STORAGE_KEY = 'trinh_hg_settings_v17_optimized'; 
  const INPUT_STATE_KEY = 'trinh_hg_input_state_v17'; 

  // MARKERS: Ký tự đặc biệt để đánh dấu vùng đã thay thế
  // E000-E001: Replace (Vàng)
  // E002-E003: Auto Caps (Xanh)
  // E004-E005: Replace + Auto Caps (Cam)
  const MARK_REP_START = '\uE000';
  const MARK_REP_END = '\uE001';
  const MARK_CAP_START = '\uE002';
  const MARK_CAP_END = '\uE003';
  const MARK_MIX_START = '\uE004';
  const MARK_MIX_END = '\uE005';

  const defaultState = {
    currentMode: 'default',
    activeTab: 'settings', 
    modes: {
      default: { pairs: [], matchCase: false, wholeWord: false, autoCaps: false }
    }
  };

  let state = JSON.parse(localStorage.getItem(STORAGE_KEY)) || defaultState;
  
  // Validate state
  if (!state.activeTab) state.activeTab = 'settings'; 
  if (!state.modes || Object.keys(state.modes).length === 0) {
      state.modes = defaultState.modes;
      state.currentMode = 'default';
  }
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
    
    // Buttons
    matchCaseBtn: document.getElementById('match-case'),
    wholeWordBtn: document.getElementById('whole-word'),
    autoCapsBtn: document.getElementById('auto-caps'), 
    renameBtn: document.getElementById('rename-mode'),
    deleteBtn: document.getElementById('delete-mode'),
    emptyState: document.getElementById('empty-state'),
    replaceBtn: document.getElementById('replace-button'),
    clearInputBtn: document.getElementById('clear-input'),
    
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

  // --- HTML ESCAPE ---
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
      if (original === original.toUpperCase() && original !== original.toLowerCase()) {
          return replacement.toUpperCase();
      }
      if (original[0] === original[0].toUpperCase() && original.slice(1) === original.slice(1).toLowerCase()) {
          return replacement.charAt(0).toUpperCase() + replacement.slice(1).toLowerCase();
      }
      return replacement;
  }

  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // === 3. CORE LOGIC (NO FREEZE) ===
  
  function performReplaceAll() {
      els.replaceBtn.disabled = true;
      els.replaceBtn.textContent = 'Đang xử lý...';

      // Timeout để UI kịp cập nhật trạng thái disabled trước khi chạy logic nặng
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
      let rawText = els.inputText.value;
      
      if (!rawText) return;
      if (!mode.pairs.length && !mode.autoCaps) {
          return showNotification("Chưa có cặp thay thế nào và Auto Caps đang tắt!", "warning");
      }

      // Lưu ý: KHÔNG normalize toàn bộ text đầu vào để bảo tồn smart quotes
      let processedText = rawText; 

      // Lọc và sắp xếp rules
      const rules = mode.pairs
        .filter(p => p.find && p.find.trim())
        .map(p => ({ find: p.find, replace: p.replace || '' }))
        .sort((a,b) => b.find.length - a.find.length); // Xử lý từ dài trước

      let replaceCount = 0;
      let autoCapsCount = 0;

      // === PHASE 1: USER REPLACEMENTS (YELLOW) ===
      // Sử dụng Marker để đánh dấu vùng đã thay thế, tránh replace chồng chéo
      rules.forEach(rule => {
          const pattern = escapeRegExp(rule.find);
          const flags = mode.matchCase ? 'g' : 'gi';
          let regex;
          
          if (mode.wholeWord) {
              // Lookaround để xác định ranh giới từ
              try {
                  regex = new RegExp(`(?<![\\p{L}\\p{N}_])${pattern}(?![\\p{L}\\p{N}_])`, flags + 'u');
              } catch (e) {
                  // Fallback cho trình duyệt cũ không hỗ trợ Lookbehind
                  regex = new RegExp(`\\b${pattern}\\b`, flags);
              }
          } else {
              regex = new RegExp(pattern, flags);
          }

          processedText = processedText.replace(regex, (match) => {
              replaceCount++;
              let replacement = rule.replace;
              if (!mode.matchCase) {
                  replacement = preserveCase(match, replacement);
              }
              // Bọc trong marker Yellow
              return `${MARK_REP_START}${replacement}${MARK_REP_END}`;
          });
      });

      // === PHASE 2: AUTO CAPS (BLUE & ORANGE) ===
      if (mode.autoCaps) {
          // Regex tìm: 
          // 1. Dấu kết thúc câu (.?!) hoặc đầu dòng (^, \n)
          // 2. Theo sau bởi khoảng trắng
          // 3. Có thể có markers (đã replace trước đó)
          // 4. Ký tự chữ cái viết thường
          
          const autoCapsRegex = /(^|[\.?!\n]\s*)(?:\uE000|\uE001)*([a-zà-ỹ])/gmi;

          processedText = processedText.replace(autoCapsRegex, (fullMatch, prefix, char, offset) => {
              // Logic check xem char này nằm trong marker nào không?
              // Tuy nhiên regex trên match cả chuỗi bao gồm marker nếu có.
              
              // Cách xử lý đơn giản và hiệu quả:
              // Kiểm tra xem trong 'fullMatch' có chứa marker MARK_REP_START không.
              
              const isInsideRep = fullMatch.includes(MARK_REP_START);
              const upperChar = char.toUpperCase();
              
              if (isInsideRep) {
                  // CASE: ORANGE (Đã replace + Giờ AutoCaps)
                  // Ta cần thay thế Marker cũ (Yellow) thành Marker mới (Orange) và viết hoa chữ cái
                  // fullMatch ví dụ: ". \uE000hello" (trong đó 'hello' là replacement)
                  // Ta trả về: ". \uE004Hello" (chưa có đóng marker, đóng marker nằm ở sau ký tự này trong chuỗi gốc, nhưng replace regex chỉ ăn phần đầu)
                  
                  // Vấn đề: regex replace chỉ match prefix + char. Phần đuôi marker (\uE001) nằm ở sau char.
                  // Do đó, ta chỉ cần thay đổi Marker Start và Char. 
                  // Khi render, ta sẽ map MARK_REP_END thành đóng thẻ tương ứng dựa vào stack.
                  // NHƯNG: Để an toàn và đơn giản, ta quy định:
                  // Nếu phát hiện REPLACEMENT ở đây, ta đổi MARK_REP_START -> MARK_MIX_START
                  // Và đổi MARK_REP_END -> MARK_MIX_END (cần replace global sau đó hoặc xử lý lúc render).
                  
                  // Cách tiếp cận an toàn hơn: 
                  // Regex match: (^|[\.?!\n]\s*) (\uE000)? ([a-z])
                  // Nếu có \uE000 => Chuyển thành \uE004 + UpperChar.
                  // Lưu ý: \uE001 (End Marker) vẫn nằm đâu đó phía sau char này trong chuỗi lớn.
                  // Ta cần một bước hậu xử lý để đổi \uE001 thành \uE005 nếu tương ứng với \uE004.
                  
                  autoCapsCount++;
                  // Thay thế \uE000 bằng \uE004 trong fullMatch và upcase char
                  let newSegment = fullMatch.replace(MARK_REP_START, MARK_MIX_START);
                  newSegment = newSegment.substring(0, newSegment.length - 1) + upperChar;
                  return newSegment;
              } else {
                  // CASE: BLUE (Chỉ AutoCaps, không phải từ replace)
                  // Trả về: Prefix + BlueStart + UpperChar + BlueEnd
                  autoCapsCount++;
                  return `${prefix}${MARK_CAP_START}${upperChar}${MARK_CAP_END}`;
              }
          });
          
          // Hậu xử lý cho Case Orange:
          // Nếu có MARK_MIX_START (\uE004), ta phải tìm MARK_REP_END (\uE001) gần nhất và đổi thành MARK_MIX_END (\uE005)
          // Vì cấu trúc luôn là Start ... End không lồng nhau (do user replace không lồng nhau), ta có thể dùng counter.
          
          let tempBuffer = '';
          let openMix = false;
          for(let i=0; i<processedText.length; i++) {
              const c = processedText[i];
              if(c === MARK_MIX_START) openMix = true;
              if(c === MARK_REP_END && openMix) {
                  tempBuffer += MARK_MIX_END;
                  openMix = false;
              } else {
                  tempBuffer += c;
              }
          }
          processedText = tempBuffer;
      }

      // === PHASE 3: RENDERING HTML ===
      // Chuyển đổi markers thành thẻ HTML và xử lý xuống dòng
      
      let finalHTML = '';
      let buffer = '';
      
      for (let i = 0; i < processedText.length; i++) {
          const c = processedText[i];
          
          // Flush buffer function
          const flush = () => {
              if (buffer) {
                  finalHTML += escapeHTML(buffer).replace(/\n/g, '<br>');
                  buffer = '';
              }
          };

          if (c === MARK_REP_START) {
              flush(); finalHTML += '<mark class="hl-yellow">';
          } else if (c === MARK_REP_END) {
              flush(); finalHTML += '</mark>';
          } else if (c === MARK_CAP_START) {
              flush(); finalHTML += '<mark class="hl-blue">';
          } else if (c === MARK_CAP_END) {
              flush(); finalHTML += '</mark>';
          } else if (c === MARK_MIX_START) {
              flush(); finalHTML += '<mark class="hl-orange">';
          } else if (c === MARK_MIX_END) {
              flush(); finalHTML += '</mark>';
          } else {
              buffer += c;
          }
      }
      // Flush phần còn lại
      if (buffer) finalHTML += escapeHTML(buffer).replace(/\n/g, '<br>');

      // Cập nhật DOM
      els.outputText.innerHTML = finalHTML;

      // Stats & Notification
      saveTempInput(); 
      updateCounters();
      
      if (replaceCount > 0 || autoCapsCount > 0) {
        showNotification(`Thay thế: ${replaceCount} | Auto Caps: ${autoCapsCount}`);
      } else {
        showNotification(`Không có thay đổi nào.`, 'warning');
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
    // Verify mode
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
        
        els.autoCapsBtn.textContent = `Auto Caps: ${mode.autoCaps ? 'BẬT' : 'Tắt'}`;
        els.autoCapsBtn.classList.toggle('active', mode.autoCaps);
    }
  }

  function addPairToUI(find = '', replace = '', append = false) {
    const item = document.createElement('div');
    item.className = 'punctuation-item';
    // Escape quote for value attribute
    const safeFind = find.replace(/"/g, '&quot;');
    const safeReplace = replace.replace(/"/g, '&quot;');

    item.innerHTML = `
      <input type="text" class="find" placeholder="Tìm" value="${safeFind}">
      <input type="text" class="replace" placeholder="Thay thế" value="${safeReplace}">
      <button class="remove" tabindex="-1">×</button>
    `;

    item.querySelector('.remove').onclick = () => { 
        item.remove(); 
        checkEmptyState(); 
        saveCurrentPairsToState(true); 
    };
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

  // --- CSV UTILS ---
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
        // Basic header check
        if (!lines[0].toLowerCase().includes('find') && !lines[0].toLowerCase().includes('replace')) 
            return showNotification('File CSV không đúng định dạng (cần cột find, replace)', 'error');
        
        let count = 0;
        let importedModeNames = new Set();
        
        // Skip header row
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            const cols = parseCSVLine(line);
            if (cols.length >= 2) {
                const find = cols[0];
                const replace = cols[1] || '';
                const modeName = cols[2] || 'default'; // Nếu có cột mode
                if (find) {
                    if (!state.modes[modeName]) state.modes[modeName] = { pairs: [], matchCase: false, wholeWord: false, autoCaps: false };
                    state.modes[modeName].pairs.push({ find, replace });
                    importedModeNames.add(modeName);
                    count++;
                }
            }
        }
        saveState(); renderModeSelect();
        // Switch to imported mode if possible
        if (importedModeNames.has(state.currentMode)) loadSettingsToUI();
        else if(importedModeNames.size > 0) {
             state.currentMode = importedModeNames.values().next().value;
             saveState(); renderModeSelect(); loadSettingsToUI();
        }
        showNotification(`Đã nhập ${count} cặp thay thế!`);
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
    a.href = url; a.download = 'settings_trinh_hg.csv'; a.click();
  }

  // --- SPLIT LOGIC ---
  function normalizeTextForSplit(text) {
      if(!text) return '';
      // Chỉ chuẩn hóa quotes ở phần split nếu cần thiết, hoặc giữ nguyên
      // Ở đây ta giữ nguyên để an toàn, chỉ trim.
      return text;
  }

  function performSplit() {
    const text = els.splitInput.value;
    if(!text.trim()) return showNotification('Chưa có nội dung!', 'error');
    
    const lines = text.split('\n');
    let chapterHeader = '', contentBody = text;
    
    // Phát hiện header chương đơn giản
    if (/^(Chương|Chapter)\s+\d+/.test(lines[0].trim())) {
        chapterHeader = lines[0].trim(); contentBody = lines.slice(1).join('\n');
    }
    
    const paragraphs = contentBody.split('\n').filter(p => p.trim());
    const totalWords = countWords(contentBody);
    const targetWords = Math.ceil(totalWords / currentSplitMode);
    
    let parts = [], currentPart = [], currentCount = 0;
    
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

    renderSplitOutputsUI(parts, chapterHeader);
    
    els.splitInput.value = '';
    saveTempInput();
    showNotification('Đã chia thành công!', 'success');
  }

  function renderSplitOutputsUI(parts, header) {
    els.splitWrapper.innerHTML = '';
    els.splitWrapper.style.gridTemplateColumns = `repeat(${Math.min(currentSplitMode, 4)}, 1fr)`;
    
    for(let i = 0; i < currentSplitMode; i++) {
        const partContent = parts[i] || '';
        let fullContent = partContent;
        if (header && partContent) {
            // Tạo header phụ: Chương 1.1, Chương 1.2
            fullContent = header.replace(/(\d+)/, (m, n) => `${n}.${i+1}`) + '\n\n' + partContent;
        }

        const div = document.createElement('div'); 
        div.className = 'split-box';
        div.innerHTML = `
            <div class="split-header"><span>Phần ${i+1}</span><span class="badge">Words: ${countWords(fullContent)}</span></div>
            <textarea id="out-${i+1}-text" class="custom-scrollbar" readonly>${fullContent}</textarea>
            <div class="split-footer"><button class="btn btn-secondary full-width copy-btn">Sao chép phần ${i+1}</button></div>
        `;
        div.querySelector('.copy-btn').onclick = () => {
             if(fullContent) { 
                 navigator.clipboard.writeText(fullContent); 
                 showNotification(`Đã sao chép Phần ${i+1}`); 
             }
        };
        els.splitWrapper.appendChild(div);
    }
  }

  // UTILS
  function countWords(str) { return str.trim() ? str.trim().split(/\s+/).length : 0; }
  
  function updateCounters() {
    els.inputCount.textContent = 'Words: ' + countWords(els.inputText.value);
    // outputText là div, lấy innerText để đếm
    els.outputCount.textContent = 'Words: ' + countWords(els.outputText.innerText);
    els.splitInputCount.textContent = 'Words: ' + countWords(els.splitInput.value);
  }

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
    // Tabs
    document.querySelectorAll('.tab-button').forEach(btn => btn.onclick = () => switchTab(btn.dataset.tab));
    
    // Config Toggles
    const toggleHandler = (key) => {
        const m = state.modes[state.currentMode]; m[key] = !m[key];
        saveState(); updateModeButtons();
    };
    els.matchCaseBtn.onclick = () => toggleHandler('matchCase');
    els.wholeWordBtn.onclick = () => toggleHandler('wholeWord');
    els.autoCapsBtn.onclick = () => toggleHandler('autoCaps');
    
    // Mode Management
    els.modeSelect.onchange = (e) => { state.currentMode = e.target.value; saveState(); loadSettingsToUI(); };
    document.getElementById('add-mode').onclick = () => { 
        const n = prompt('Tên Mode mới:'); 
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
    
    // Settings Actions
    document.getElementById('add-pair').onclick = () => addPairToUI();
    document.getElementById('save-settings').onclick = () => saveCurrentPairsToState();
    document.getElementById('export-settings').onclick = exportCSV;
    document.getElementById('import-settings').onclick = () => { 
        const inp = document.createElement('input'); inp.type='file'; inp.accept='.csv'; 
        inp.onchange=e=>{if(e.target.files.length) importCSV(e.target.files[0])}; 
        inp.click(); 
    };
    
    // Replace Actions
    els.replaceBtn.onclick = performReplaceAll;
    els.clearInputBtn.onclick = () => {
        if(confirm('Xóa trắng ô nhập liệu?')) {
            els.inputText.value = '';
            els.outputText.innerHTML = '';
            updateCounters(); saveTempInput();
        }
    };
    
    document.getElementById('copy-button').onclick = () => { 
        if(els.outputText.innerText) { 
            navigator.clipboard.writeText(els.outputText.innerText); 
            showNotification('Đã sao chép kết quả!'); 
        }
    };

    // Split Actions
    document.querySelectorAll('.split-mode-btn').forEach(btn => btn.onclick = () => { 
        document.querySelectorAll('.split-mode-btn').forEach(b=>b.classList.remove('active')); 
        btn.classList.add('active'); 
        currentSplitMode = parseInt(btn.dataset.split); 
        // Trigger re-split if text exists? Or just update state
    });
    document.getElementById('split-action-btn').onclick = performSplit;

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
  if(state.activeTab) switchTab(state.activeTab); 
  initEvents();
});
