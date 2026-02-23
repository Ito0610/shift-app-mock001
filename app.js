(function () {
  'use strict';

  const STORAGE_KEY = 'shiftHopeApp';
  const STORAGE_KEY_GAS_URL = 'shiftHopeAppGasUrl'; // localStorage のキー名（ここにURLは入れない）

  // 管理者用: ここにGASのURLを入れると従業員が設定しなくても従業員リスト・提出が利用できます（空のままなら index.html の window.SHIFT_APP_GAS_URL を使用）
  const BUILTIN_GAS_URL_IN_APP = 'https://script.google.com/macros/s/AKfycbwS34yq35ZilTVjquXs060wfXPegIcehXM4zn-acXYw-Zb8taDa1PFMvj6jPTdlaokJ/exec';
  const BUILTIN_GAS_URL = (typeof window !== 'undefined' && window.SHIFT_APP_GAS_URL) ? String(window.SHIFT_APP_GAS_URL).trim() : (BUILTIN_GAS_URL_IN_APP || '');

  // 時間指定の範囲: 7:00 ～ 23:00
  const TIME_RANGE_START = 7 * 60;   // 7:00 = 420分
  const TIME_RANGE_END = 23 * 60;    // 23:00 = 1380分
  const TIME_CHART_SPAN = TIME_RANGE_END - TIME_RANGE_START; // 960分

  // 時（7〜23）の選択肢
  function buildHourOptions() {
    const opts = [{ value: '', label: '指定なし' }];
    for (let h = 7; h <= 23; h++) opts.push({ value: String(h), label: String(h) });
    return opts;
  }

  // 分（5分刻み）の選択肢
  function buildMinOptions() {
    const opts = [];
    for (let m = 0; m < 60; m += 5) opts.push({ value: String(m), label: String(m).padStart(2, '0') });
    return opts;
  }

  const hourOptions = buildHourOptions();
  const minOptions = buildMinOptions();
  const TIME_ANY = -1;

  const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

  // 祝日（Y-M-D 形式・月は1〜12）
  // 2027年以降を追加する場合: 下記の配列に "YYYY-M-D" を追加してください。
  // 例: '2027-1-1', '2027-1-11' など。内閣府「国民の祝日」を参照してください。
  // https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html
  const HOLIDAYS = new Set([
    '2025-1-1', '2025-1-13', '2025-2-11', '2025-2-23', '2025-2-24', '2025-3-20', '2025-4-29',
    '2025-5-3', '2025-5-4', '2025-5-5', '2025-5-6', '2025-7-21', '2025-8-11', '2025-9-15',
    '2025-9-23', '2025-10-13', '2025-11-3', '2025-11-24',
    '2026-1-1', '2026-1-12', '2026-2-11', '2026-2-23', '2026-3-20', '2026-4-29',
    '2026-5-3', '2026-5-4', '2026-5-5', '2026-5-6', '2026-7-20', '2026-8-11', '2026-9-21',
    '2026-9-23', '2026-10-12', '2026-11-3', '2026-11-23',
    '2027-1-1', '2027-1-11', '2027-2-11', '2027-2-23', '2027-3-21', '2027-4-29',
    '2027-5-3', '2027-5-4', '2027-5-5', '2027-5-6', '2027-7-19', '2027-8-11', '2027-9-20',
    '2027-9-23', '2027-10-11', '2027-11-3', '2027-11-23'
  ]);

  function isHoliday(y, monthIndex, date) {
    const m = monthIndex + 1;
    return HOLIDAYS.has(`${y}-${m}-${date}`);
  }

  let state = {
    year: new Date().getFullYear(),
    month: new Date().getMonth(),
    monthNotes: '',
    days: {},
    submitted: false,
    employeeName: '',
  };

  function dayKey(y, m, d) {
    return `${y}-${m + 1}-${d}`;
  }

  function getGasUrl() {
    try {
      return localStorage.getItem(STORAGE_KEY_GAS_URL) || '';
    } catch (_) { return ''; }
  }

  function getEffectiveGasUrl() {
    var fromStorage = getGasUrl();
    if (fromStorage) return fromStorage;
    return BUILTIN_GAS_URL || '';
  }

  function setGasUrl(url) {
    try {
      const u = (url && typeof url === 'string') ? url.trim() : '';
      if (u) localStorage.setItem(STORAGE_KEY_GAS_URL, u);
      else localStorage.removeItem(STORAGE_KEY_GAS_URL);
    } catch (_) {}
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.year !== undefined) state.year = parsed.year;
        if (parsed.month !== undefined) state.month = parsed.month;
        if (parsed.monthNotes !== undefined) state.monthNotes = parsed.monthNotes;
        if (parsed.days && typeof parsed.days === 'object') state.days = parsed.days;
        if (parsed.submitted !== undefined) state.submitted = parsed.submitted;
        if (parsed.employeeName !== undefined) state.employeeName = parsed.employeeName || '';
      }
    } catch (_) {}
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        year: state.year,
        month: state.month,
        monthNotes: state.monthNotes,
        days: state.days,
        submitted: state.submitted,
        employeeName: state.employeeName,
      }));
    } catch (_) {}
  }

  function showToast(message) {
    const existing = document.getElementById('toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(function () { toast.classList.add('toast-visible'); });
    setTimeout(function () {
      toast.classList.remove('toast-visible');
      setTimeout(function () { toast.remove(); }, 300);
    }, 2000);
  }

  function populateEmployeeSelect(names) {
    const sel = document.getElementById('employeeSelect');
    if (!sel) return;
    const current = state.employeeName;
    sel.innerHTML = '<option value="">— 選択してください —</option>';
    (names || []).forEach(function (name) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      if (name === current) opt.selected = true;
      sel.appendChild(opt);
    });
    if (!current || !names || names.indexOf(current) === -1) state.employeeName = '';
  }

  function fetchEmployees() {
    const url = getEffectiveGasUrl();
    if (!url || url.indexOf('script.google.com') === -1) return Promise.resolve();
    return fetch(url)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        const list = (data && data.employees) ? data.employees : [];
        populateEmployeeSelect(list);
        return list;
      })
      .catch(function () {
        populateEmployeeSelect([]);
        return [];
      });
  }

  function deepCopyEntry(entry) {
    if (!entry) return null;
    return {
      allDay: !!entry.allDay,
      slot1: entry.slot1 ? { start: entry.slot1.start, end: entry.slot1.end } : null,
      slot2: entry.slot2 ? { start: entry.slot2.start, end: entry.slot2.end } : null,
      notes: entry.notes ? String(entry.notes) : '',
    };
  }

  function clearCurrentMonthInput() {
    if (!window.confirm('今月分の入力内容をすべて削除しますか？')) return;
    state.monthNotes = '';
    const prefix = state.year + '-' + (state.month + 1) + '-';
    Object.keys(state.days).forEach(function (key) {
      if (key.indexOf(prefix) === 0) delete state.days[key];
    });
    saveState();
    renderCalendar();
    document.getElementById('monthNotes').value = '';
    showToast('入力内容を削除しました');
  }

  function clearDayInput(key) {
    if (!key) return;
    if (!window.confirm('この日の入力を削除しますか？')) return;
    delete state.days[key];
    saveState();
    renderCalendar();
    closeModal();
    showToast('この日の入力を削除しました');
  }

  function getWeekKeys(y, monthIndex, date) {
    const d0 = new Date(y, monthIndex, date);
    const dayOfWeek = d0.getDay();
    const monOffset = (dayOfWeek + 6) % 7;
    const mon = new Date(y, monthIndex, date - monOffset);
    const keys = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i);
      keys.push(dayKey(day.getFullYear(), day.getMonth(), day.getDate()));
    }
    return keys;
  }

  function getDaysInMonth(y, m) {
    const first = new Date(y, m, 1);
    const last = new Date(y, m + 1, 0);
    const startPad = first.getDay();
    const daysInMonth = last.getDate();
    const totalCells = startPad + daysInMonth;
    const rows = Math.ceil(totalCells / 7);
    const cells = rows * 7;
    const result = [];
    for (let i = 0; i < cells; i++) {
      const dayOfWeek = i % 7;
      const seq = i - startPad + 1;
      if (seq < 1) {
        const prevMonth = new Date(y, m, 0);
        result.push({
          date: prevMonth.getDate(),
          month: 'prev',
          year: prevMonth.getFullYear(),
          monthIndex: prevMonth.getMonth(),
        });
      } else if (seq > daysInMonth) {
        const nextDay = seq - daysInMonth;
        result.push({
          date: nextDay,
          month: 'next',
          year: m === 11 ? y + 1 : y,
          monthIndex: m === 11 ? 0 : m + 1,
        });
      } else {
        result.push({
          date: seq,
          month: 'current',
          year: y,
          monthIndex: m,
        });
      }
    }
    return result;
  }

  function slotHasContent(slot) {
    if (!slot) return false;
    const s = slot.start;
    const e = slot.end;
    return (s != null && s !== TIME_ANY) || (e != null && e !== TIME_ANY);
  }

  function formatSlotLabel(slot) {
    if (!slot || !slotHasContent(slot)) return '';
    const s = slot.start;
    const e = slot.end;
    const startStr = (s != null && s !== TIME_ANY) ? timeMinutesToLabel(s) : '';
    const endStr = (e != null && e !== TIME_ANY) ? timeMinutesToLabel(e) : '';
    if (startStr && endStr) return startStr + '-' + endStr;
    if (endStr) return '〜' + endStr;
    if (startStr) return startStr + '〜';
    return '';
  }

  function formatDaySummary(entry) {
    if (!entry) return '';
    if (entry.allDay) return '終日';
    const parts = [];
    if (slotHasContent(entry.slot1)) parts.push(formatSlotLabel(entry.slot1));
    if (slotHasContent(entry.slot2)) parts.push(formatSlotLabel(entry.slot2));
    return parts.join(' / ') || '';
  }

  function formatDaySummaryLines(entry) {
    if (!entry) return [];
    if (entry.allDay) return ['終日'];
    const lines = [];
    if (slotHasContent(entry.slot1)) lines.push(formatSlotLabel(entry.slot1));
    if (slotHasContent(entry.slot2)) lines.push(formatSlotLabel(entry.slot2));
    return lines;
  }

  function setDayAllDay(key) {
    state.days[key] = state.days[key] || {};
    state.days[key].allDay = true;
    state.days[key].slot1 = null;
    state.days[key].slot2 = null;
    if (!state.days[key].notes) state.days[key].notes = '';
    saveState();
    renderCalendar();
    showToast('終日で登録しました');
  }

  function timeMinutesToLabel(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}:${String(m).padStart(2, '0')}`;
  }

  function renderCalendar() {
    const cal = document.getElementById('calendar');
    const label = document.getElementById('currentMonthLabel');
    label.textContent = `${state.year}年${state.month + 1}月`;

    const today = new Date();
    const todayY = today.getFullYear();
    const todayM = today.getMonth();
    const todayD = today.getDate();

    const days = getDaysInMonth(state.year, state.month);
    cal.innerHTML = '';

    days.forEach(function (cell) {
      const div = document.createElement('div');
      div.className = 'day-cell';
      if (cell.month !== 'current') div.classList.add('other-month');
      const dayOfWeek = new Date(cell.year, cell.monthIndex, cell.date).getDay();
      if (dayOfWeek === 0) div.classList.add('sunday');
      if (dayOfWeek === 6) div.classList.add('saturday');
      if (isHoliday(cell.year, cell.monthIndex, cell.date)) div.classList.add('holiday');
      const isToday =
        cell.month === 'current' &&
        state.year === todayY &&
        state.month === todayM &&
        cell.date === todayD;
      if (isToday) div.classList.add('today');

      const key = dayKey(cell.year, cell.monthIndex, cell.date);
      const entry = state.days[key];
      const hasEntry = entry && (entry.allDay || slotHasContent(entry.slot1) || slotHasContent(entry.slot2));
      if (hasEntry) {
        div.classList.add('has-entry');
        const summaryWrap = document.createElement('div');
        summaryWrap.className = 'day-summary-wrap';
        formatDaySummaryLines(entry).forEach(function (line) {
          const lineEl = document.createElement('div');
          lineEl.className = 'day-summary-line';
          lineEl.textContent = line;
          summaryWrap.appendChild(lineEl);
        });
        div.appendChild(summaryWrap);
      }

      if (cell.month === 'current') {
        const quickActions = document.createElement('div');
        quickActions.className = 'day-quick-actions';
        const btnAllDay = document.createElement('button');
        btnAllDay.type = 'button';
        btnAllDay.className = 'day-quick-btn day-quick-all';
        btnAllDay.textContent = '終日';
        const btnTime = document.createElement('button');
        btnTime.type = 'button';
        btnTime.className = 'day-quick-btn day-quick-time';
        btnTime.textContent = '時間指定';
        quickActions.appendChild(btnAllDay);
        quickActions.appendChild(btnTime);
        if (hasEntry) {
          const btnCopy = document.createElement('button');
          btnCopy.type = 'button';
          btnCopy.className = 'day-quick-btn day-quick-copy';
          btnCopy.textContent = 'コピー';
          btnCopy.title = 'この日の内容をコピー';
          quickActions.appendChild(btnCopy);
          const btnDelete = document.createElement('button');
          btnDelete.type = 'button';
          btnDelete.className = 'day-quick-btn day-quick-delete';
          btnDelete.textContent = '削除';
          btnDelete.title = 'この日の入力を削除';
          quickActions.appendChild(btnDelete);
        }
        div.appendChild(quickActions);
      }

      const num = document.createElement('span');
      num.className = 'day-num';
      num.textContent = cell.date;
      div.insertBefore(num, div.firstChild);

      div.setAttribute('data-key', key);
      div.setAttribute('data-date', cell.date);
      div.setAttribute('data-month-index', cell.monthIndex);
      div.setAttribute('data-year', cell.year);
      div.setAttribute('data-month-type', cell.month);
      cal.appendChild(div);
    });
  }

  function fillTimeSelect(selectId, options) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    sel.innerHTML = '';
    (options || []).forEach(function (opt) {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      sel.appendChild(option);
    });
  }

  function setSelectValue(selectId, value) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const v = value == null || value === TIME_ANY ? '' : String(value);
    if (sel.value !== v) sel.value = v;
  }

  // 全角→半角（数字とコロン）
  function toHalfWidth(str) {
    if (!str || typeof str !== 'string') return '';
    return str.replace(/[０-９]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
    }).replace(/\uFF1A/g, ':');
  }

  // 直接入力: 全角を半角にし、コロンを自動補完（2桁目で「:」を挿入）
  function formatTimeInput(el) {
    if (!el) return;
    var raw = toHalfWidth(el.value);
    var digits = raw.replace(/\D/g, '');
    var colonIndex = raw.indexOf(':');
    if (colonIndex === -1) {
      if (digits.length <= 2) {
        el.value = digits;
      } else {
        el.value = digits.slice(0, 2) + ':' + digits.slice(2, 4);
      }
    } else {
      var before = raw.slice(0, colonIndex).replace(/\D/g, '');
      var after = raw.slice(colonIndex + 1).replace(/\D/g, '');
      if (before.length > 2) before = before.slice(0, 2);
      if (after.length > 2) after = after.slice(0, 2);
      el.value = before + (after.length > 0 ? ':' + after : '');
    }
  }

  // 直接入力 "10:23" や "9:5" をパース（7〜23時、0〜59分、1分単位可）。無効なら null
  function parseDirectTime(str) {
    if (!str || typeof str !== 'string') return null;
    const t = str.trim();
    const m = t.match(/^(\d{1,2}):(\d{1,2})$/);
    if (!m) return null;
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (h < 7 || h > 23 || min < 0 || min > 59) return null;
    return h * 60 + min;
  }

  // 入力欄（--:-- または HH:MM）から分数を取得
  function getTimeMinutesFromControls(prefix) {
    const inputEl = document.getElementById(prefix + 'Input');
    const val = inputEl && inputEl.value.trim();
    if (!val || val === '--:--') return TIME_ANY;
    const parsed = parseDirectTime(val);
    return parsed != null ? parsed : TIME_ANY;
  }

  // 分数（または TIME_ANY）を入力欄に反映
  function setTimeControls(prefix, totalMinutes) {
    const inputEl = document.getElementById(prefix + 'Input');
    if (!inputEl) return;
    if (totalMinutes == null || totalMinutes === TIME_ANY) {
      inputEl.value = '';
      return;
    }
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    inputEl.value = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  // 時刻ピッカー：時・分2軸ホイール用の定数
  const TIME_PICKER_ITEM_HEIGHT = 40;
  const TIME_PICKER_HOUR_VALUES = [''].concat([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23].map(String)); // 指定なし + 7〜23
  const TIME_PICKER_MIN_VALUES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]; // 5分刻み

  let timePickerCurrentPrefix = null;

  function buildWheelList(container, type, currentVal) {
    container.innerHTML = '';
    const pad = document.createElement('div');
    pad.className = 'time-picker-wheel-pad';
    container.appendChild(pad);

    let currentIndex = 0;
    const values = type === 'hour' ? TIME_PICKER_HOUR_VALUES : TIME_PICKER_MIN_VALUES;

    if (type === 'hour') {
      const total = parseDirectTime(currentVal);
      if (total != null) {
        const h = Math.floor(total / 60);
        currentIndex = h >= 7 && h <= 23 ? h - 7 + 1 : 0; // 0=指定なし, 1=7, ...
      }
    } else {
      const total = parseDirectTime(currentVal);
      if (total != null) {
        const m = total % 60;
        const idx = TIME_PICKER_MIN_VALUES.indexOf(m);
        currentIndex = idx >= 0 ? idx : 0;
      }
    }

    values.forEach(function (val, i) {
      const div = document.createElement('div');
      div.className = 'time-picker-wheel-item';
      div.dataset.index = i;
      if (type === 'hour' && val === '') {
        div.textContent = '指定なし';
        div.classList.add('time-picker-wheel-item-clear');
      } else if (type === 'hour') {
        div.textContent = val + '時';
      } else {
        div.textContent = String(val).padStart(2, '0') + '分';
      }
      if (i === currentIndex) div.classList.add('time-picker-wheel-item-selected');
      container.appendChild(div);
    });

    const padBottom = document.createElement('div');
    padBottom.className = 'time-picker-wheel-pad';
    container.appendChild(padBottom);

    container.scrollTop = currentIndex * TIME_PICKER_ITEM_HEIGHT;
    return currentIndex;
  }

  function getWheelIndex(container) {
    const st = container.scrollTop;
    const index = Math.round(st / TIME_PICKER_ITEM_HEIGHT);
    const items = container.querySelectorAll('.time-picker-wheel-item');
    const max = items.length > 0 ? items.length - 1 : 0;
    return Math.max(0, Math.min(index, max));
  }

  function syncWheelSelection(container) {
    const idx = getWheelIndex(container);
    const items = container.querySelectorAll('.time-picker-wheel-item');
    items.forEach(function (el, i) {
      el.classList.toggle('time-picker-wheel-item-selected', i === idx);
    });
    return idx;
  }

  function applyTimeFromWheels() {
    if (!timePickerCurrentPrefix) return;
    const inputEl = document.getElementById(timePickerCurrentPrefix + 'Input');
    const hourEl = document.getElementById('timePickerHourList');
    const minEl = document.getElementById('timePickerMinList');
    if (!inputEl || !hourEl || !minEl) return;
    const hourIdx = getWheelIndex(hourEl);
    const minIdx = getWheelIndex(minEl);
    const hourVal = TIME_PICKER_HOUR_VALUES[hourIdx];
    const minVal = TIME_PICKER_MIN_VALUES[minIdx];
    if (hourVal === '') {
      inputEl.value = '';
    } else {
      inputEl.value = String(hourVal).padStart(2, '0') + ':' + String(minVal).padStart(2, '0');
    }
    updateTimeChart();
  }

  function openTimePicker(prefix, anchorEl) {
    timePickerCurrentPrefix = prefix;
    const inputEl = document.getElementById(prefix + 'Input');
    const currentVal = inputEl && inputEl.value.trim();
    const hourList = document.getElementById('timePickerHourList');
    const minList = document.getElementById('timePickerMinList');
    if (!hourList || !minList) return;

    buildWheelList(hourList, 'hour', currentVal);
    buildWheelList(minList, 'min', currentVal);

    function onWheelScroll() {
      syncWheelSelection(hourList);
      syncWheelSelection(minList);
      applyTimeFromWheels();
    }

    hourList.removeEventListener('scroll', hourList._timePickerScroll);
    minList.removeEventListener('scroll', minList._timePickerScroll);
    hourList._timePickerScroll = onWheelScroll;
    minList._timePickerScroll = onWheelScroll;
    hourList.addEventListener('scroll', onWheelScroll);
    minList.addEventListener('scroll', onWheelScroll);

    document.getElementById('timePickerClearBtn').onclick = function () {
      if (inputEl) inputEl.value = '';
      updateTimeChart();
      closeTimePicker();
    };
    document.getElementById('timePickerApplyBtn').onclick = closeTimePicker;

    const popover = document.getElementById('timePickerPopover');
    const rect = anchorEl.getBoundingClientRect();
    popover.style.left = Math.max(8, rect.left) + 'px';
    popover.style.top = (rect.bottom + 4) + 'px';
    popover.classList.add('time-picker-popover-visible');
    popover.setAttribute('aria-hidden', 'false');
    applyTimeFromWheels();
  }

  function closeTimePicker() {
    timePickerCurrentPrefix = null;
    const popover = document.getElementById('timePickerPopover');
    popover.classList.remove('time-picker-popover-visible');
    popover.setAttribute('aria-hidden', 'true');
  }

  function updateTimeChart() {
    const slot1Start = getTimeMinutesFromControls('slot1Start');
    const slot1End = getTimeMinutesFromControls('slot1End');
    const slot2Start = getTimeMinutesFromControls('slot2Start');
    const slot2End = getTimeMinutesFromControls('slot2End');

    // 何も入力されていない場合は色を付けない（バーはグレーのまま）
    function slotHasTime(startMin, endMin) {
      const hasStart = startMin != null && startMin !== TIME_ANY;
      const hasEnd = endMin != null && endMin !== TIME_ANY;
      return hasStart || hasEnd;
    }

    // 時間のイメージは 7:00 ～ 23:00 の軸で表示
    function renderSlot(elId, startMin, endMin) {
      const el = document.getElementById(elId);
      if (!el) return;
      if (!slotHasTime(startMin, endMin)) {
        el.style.display = 'none';
        el.style.left = '0%';
        el.style.width = '0%';
        return;
      }
      const start = (startMin == null || startMin === TIME_ANY) ? TIME_RANGE_START : Math.max(startMin, TIME_RANGE_START);
      const end = (endMin == null || endMin === TIME_ANY) ? TIME_RANGE_END : Math.min(endMin, TIME_RANGE_END);
      if (end <= start) {
        el.style.display = 'none';
        el.style.left = '0%';
        el.style.width = '0%';
        return;
      }
      el.style.display = 'block';
      el.style.left = ((start - TIME_RANGE_START) / TIME_CHART_SPAN) * 100 + '%';
      el.style.width = ((end - start) / TIME_CHART_SPAN) * 100 + '%';
    }

    renderSlot('chartSlot1', slot1Start, slot1End);
    renderSlot('chartSlot2', slot2Start, slot2End);
  }

  function openModal(key, date, year, monthIndex) {
    const modal = document.getElementById('dayModal');
    const title = document.getElementById('modalDayTitle');
    title.textContent = `${monthIndex + 1}月${date}日 の希望`;

    const entry = state.days[key] || {};
    document.getElementById('allDay').checked = !!entry.allDay;
    setTimeControls('slot1Start', entry.slot1?.start);
    setTimeControls('slot1End', entry.slot1?.end);
    setTimeControls('slot2Start', entry.slot2?.start);
    setTimeControls('slot2End', entry.slot2?.end);
    document.getElementById('dayNotes').value = entry.notes || '';

    const dayOfWeek = new Date(year, monthIndex, date).getDay();
    const weekdayLabel = document.getElementById('copyWeekdayLabel');
    if (weekdayLabel) weekdayLabel.textContent = WEEKDAY_NAMES[dayOfWeek];

    const timeSection = document.getElementById('timeSlotsSection');
    timeSection.style.display = entry.allDay ? 'none' : 'block';
    updateTimeChart();

    modal.setAttribute('data-edit-key', key);
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
  }

  function closeModal() {
    const modal = document.getElementById('dayModal');
    modal.classList.remove('is-open');
    modal.removeAttribute('data-edit-key');
    modal.setAttribute('aria-hidden', 'true');
  }

  // 開始・終了の分数から slot オブジェクトを生成（片方だけ指定の場合はもう片方は TIME_ANY）
  function slotFromMinutes(startMin, endMin) {
    const hasStart = startMin != null && startMin !== TIME_ANY;
    const hasEnd = endMin != null && endMin !== TIME_ANY;
    if (!hasStart && !hasEnd) return null;
    return { start: startMin != null ? startMin : TIME_ANY, end: endMin != null ? endMin : TIME_ANY };
  }

  function saveDayFromModal() {
    const modal = document.getElementById('dayModal');
    const key = modal.getAttribute('data-edit-key');
    if (!key) return;

    const allDay = document.getElementById('allDay').checked;
    const slot1Start = getTimeMinutesFromControls('slot1Start');
    const slot1End = getTimeMinutesFromControls('slot1End');
    const slot2Start = getTimeMinutesFromControls('slot2Start');
    const slot2End = getTimeMinutesFromControls('slot2End');
    const slot1 = slotFromMinutes(slot1Start, slot1End);
    const slot2 = slotFromMinutes(slot2Start, slot2End);
    const notes = document.getElementById('dayNotes').value.trim();

    state.days[key] = {
      allDay,
      slot1: !allDay ? slot1 : null,
      slot2: !allDay ? slot2 : null,
      notes: notes || '',
    };

    saveState();
    renderCalendar();
    closeModal();
    showToast('この日を保存しました');
  }

  function copyDayToOtherDates(sourceKey) {
    const [y, m, d] = sourceKey.split('-').map(Number);
    const monthStr = `${state.year}年${state.month + 1}月`;
    const raw = window.prompt(
      'コピー先の日付をカンマで入力してください（同じ月内・例: 15,16,20）\n対象: ' + monthStr,
      ''
    );
    if (raw == null || raw.trim() === '') return;
    const dates = raw.split(/[,，\s]+/).map(function (s) { return parseInt(s.trim(), 10); }).filter(function (n) { return n >= 1 && n <= 31; });
    if (dates.length === 0) {
      showToast('有効な日付を入力してください');
      return;
    }
    const entry = state.days[sourceKey];
    if (!entry) {
      showToast('コピー元の日付にデータがありません');
      return;
    }
    const lastDay = new Date(state.year, state.month + 1, 0).getDate();
    let count = 0;
    dates.forEach(function (date) {
      if (date < 1 || date > lastDay) return;
      const key = dayKey(state.year, state.month, date);
      if (key === sourceKey) return;
      state.days[key] = deepCopyEntry(entry);
      count++;
    });
    saveState();
    renderCalendar();
    showToast(count + ' 日分をコピーしました');
  }

  function copyToSameWeekdayInMonth(sourceKey) {
    const parts = sourceKey.split('-').map(Number);
    const y = parts[0];
    const m = parts[1] - 1;
    const d = parts[2];
    const dayOfWeek = new Date(y, m, d).getDay();
    const entry = state.days[sourceKey];
    if (!entry) {
      showToast('コピー元の日付にデータがありません');
      return;
    }
    const lastDay = new Date(y, m + 1, 0).getDate();
    let count = 0;
    for (let date = 1; date <= lastDay; date++) {
      if (new Date(y, m, date).getDay() !== dayOfWeek) continue;
      const key = dayKey(y, m, date);
      if (key === sourceKey) continue;
      state.days[key] = deepCopyEntry(entry);
      count++;
    }
    saveState();
    renderCalendar();
    showToast(count + ' 日分にコピーしました');
  }

  function updateFooterVisibility() {
    const viewBtn = document.getElementById('viewSubmittedBtn');
    const badge = document.getElementById('submittedBadge');
    const submitBtn = document.getElementById('submitBtn');
    if (viewBtn) viewBtn.style.display = 'inline-block';
    if (submitBtn) {
      submitBtn.textContent = state.submitted ? '希望を更新して提出する' : '希望を提出する';
      submitBtn.disabled = false;
      submitBtn.classList.remove('submit-btn-disabled');
    }
    if (state.submitted && badge) badge.style.display = 'block';
    else if (badge) badge.style.display = 'none';
  }

  function fetchSubmissionAndReflectToCalendar(cb) {
    var url = getEffectiveGasUrl();
    var employeeName = state.employeeName && state.employeeName.trim();
    if (!url || !employeeName) {
      if (cb) cb();
      return;
    }
    var params = 'employeeName=' + encodeURIComponent(employeeName) + '&year=' + state.year + '&month=' + (state.month + 1);
    fetch(url + (url.indexOf('?') >= 0 ? '&' : '?') + params)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data && typeof data.days === 'object') {
          state.monthNotes = (data.monthNotes != null) ? String(data.monthNotes) : state.monthNotes;
          state.days = data.days;
          saveState();
          renderCalendar();
          showToast('提出内容をカレンダーに反映しました');
        }
        if (cb) cb();
      })
      .catch(function () { if (cb) cb(); });
  }

  function openConfirmModal() {
    fetchSubmissionAndReflectToCalendar(function () {
      document.getElementById('confirmMonthNotes').textContent = state.monthNotes || '（なし）';
      const listEl = document.getElementById('confirmDaysList');
      listEl.innerHTML = '';
      const keys = Object.keys(state.days).filter(function (k) {
        const d = state.days[k];
        return d && (d.allDay || slotHasContent(d.slot1) || slotHasContent(d.slot2) || (d.notes && d.notes.trim()));
      }).sort();
      if (keys.length === 0) {
        listEl.innerHTML = '<p class="confirm-days-empty">入力された日付はありません。</p>';
      } else {
        keys.forEach(function (key) {
          const keyParts = key.split('-').map(Number);
          const m = keyParts[1];
          const d = keyParts[2];
          const entry = state.days[key];
          const line = document.createElement('div');
          line.className = 'confirm-day-line';
          const summary = formatDaySummary(entry) || '（備考のみ）';
          const notes = entry.notes ? '　備考: ' + entry.notes : '';
          line.textContent = m + '/' + d + ' … ' + summary + notes;
          listEl.appendChild(line);
        });
      }
      document.getElementById('confirmModal').classList.add('is-open');
      document.getElementById('confirmModal').setAttribute('aria-hidden', 'false');
    });
  }

  function closeConfirmModal() {
    document.getElementById('confirmModal').classList.remove('is-open');
    document.getElementById('confirmModal').setAttribute('aria-hidden', 'true');
  }

  function openCopyPopover(key, anchorEl) {
    const parts = key.split('-').map(Number);
    const dayOfWeek = new Date(parts[0], parts[1] - 1, parts[2]).getDay();
    const weekdayEl = document.getElementById('copyPopoverWeekday');
    if (weekdayEl) weekdayEl.textContent = WEEKDAY_NAMES[dayOfWeek];
    const popover = document.getElementById('copyPopover');
    popover.setAttribute('data-copy-key', key);
    const rect = anchorEl.getBoundingClientRect();
    const isMobile = window.innerWidth <= 640;

    if (isMobile) {
      popover.style.left = '50%';
      popover.style.top = '50%';
      popover.style.transform = 'translate(-50%, -50%)';
    } else {
      popover.style.left = rect.left + 'px';
      popover.style.top = (rect.bottom + 4) + 'px';
      popover.style.transform = '';
    }

    popover.classList.add('copy-popover-visible');
    popover.setAttribute('aria-hidden', 'false');

    if (!isMobile) {
      requestAnimationFrame(function () {
        const popoverRect = popover.getBoundingClientRect();
        const viewportH = window.innerHeight;
        const spaceBelow = viewportH - rect.bottom;
        const margin = 12;
        let top = rect.bottom + 4;
        if (spaceBelow < popoverRect.height + margin) {
          top = rect.top - popoverRect.height - 4;
        }
        const left = Math.max(margin, Math.min(rect.left, window.innerWidth - popoverRect.width - margin));
        popover.style.left = left + 'px';
        popover.style.top = Math.max(margin, Math.min(top, viewportH - popoverRect.height - margin)) + 'px';
      });
    }
  }

  function closeCopyPopover() {
    const popover = document.getElementById('copyPopover');
    popover.classList.remove('copy-popover-visible');
    popover.removeAttribute('data-copy-key');
    popover.setAttribute('aria-hidden', 'true');
  }

  function bindEvents() {
    document.getElementById('prevMonth').addEventListener('click', function () {
      if (state.month === 0) {
        state.year--;
        state.month = 11;
      } else {
        state.month--;
      }
      saveState();
      renderCalendar();
    });

    document.getElementById('nextMonth').addEventListener('click', function () {
      if (state.month === 11) {
        state.year++;
        state.month = 0;
      } else {
        state.month++;
      }
      saveState();
      renderCalendar();
    });

    document.getElementById('calendar').addEventListener('click', function (e) {
      const quickAll = e.target.closest('.day-quick-all');
      if (quickAll) {
        const cell = quickAll.closest('.day-cell');
        if (cell) {
          const key = cell.getAttribute('data-key');
          if (key) {
            e.preventDefault();
            e.stopPropagation();
            setDayAllDay(key);
          }
        }
        return;
      }
      const quickDelete = e.target.closest('.day-quick-delete');
      if (quickDelete) {
        const cell = quickDelete.closest('.day-cell');
        if (cell) {
          const key = cell.getAttribute('data-key');
          if (key) {
            e.preventDefault();
            e.stopPropagation();
            clearDayInput(key);
          }
        }
        return;
      }
      const quickCopy = e.target.closest('.day-quick-copy');
      if (quickCopy) {
        const cell = quickCopy.closest('.day-cell');
        if (cell) {
          const key = cell.getAttribute('data-key');
          if (key) {
            e.preventDefault();
            e.stopPropagation();
            openCopyPopover(key, quickCopy);
          }
        }
        return;
      }
      const cell = e.target.closest('.day-cell');
      if (!cell) return;
      const key = cell.getAttribute('data-key');
      const date = cell.getAttribute('data-date');
      const year = parseInt(cell.getAttribute('data-year'), 10);
      const monthIndex = parseInt(cell.getAttribute('data-month-index'), 10);
      if (!key) return;
      openModal(key, date, year, monthIndex);
    });

    document.getElementById('modalClose').addEventListener('click', closeModal);
    document.getElementById('modalBackdrop').addEventListener('click', closeModal);

    document.getElementById('allDay').addEventListener('change', function () {
      const timeSection = document.getElementById('timeSlotsSection');
      timeSection.style.display = this.checked ? 'none' : 'block';
      if (!this.checked) updateTimeChart();
    });

    ['slot1StartInput', 'slot1EndInput', 'slot2StartInput', 'slot2EndInput'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', function () {
          formatTimeInput(el);
          updateTimeChart();
        });
      }
    });
    [
      { id: 'slot1StartClock', prefix: 'slot1Start' },
      { id: 'slot1EndClock', prefix: 'slot1End' },
      { id: 'slot2StartClock', prefix: 'slot2Start' },
      { id: 'slot2EndClock', prefix: 'slot2End' }
    ].forEach(function (item) {
      const btn = document.getElementById(item.id);
      if (btn) btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        openTimePicker(item.prefix, btn);
      });
    });
    document.addEventListener('click', function (e) {
      const popover = document.getElementById('timePickerPopover');
      if (!popover.classList.contains('time-picker-popover-visible')) return;
      if (popover.contains(e.target) || e.target.closest('.time-picker-btn')) return;
      closeTimePicker();
    });

    document.getElementById('saveDayBtn').addEventListener('click', saveDayFromModal);

    document.getElementById('copyDayToOthersBtn').addEventListener('click', function () {
      const key = document.getElementById('dayModal').getAttribute('data-edit-key');
      if (key) copyDayToOtherDates(key);
    });
    document.getElementById('copyWeekToOtherBtn').addEventListener('click', function () {
      const key = document.getElementById('dayModal').getAttribute('data-edit-key');
      if (key) copyToSameWeekdayInMonth(key);
    });

    document.getElementById('clearAllBtn').addEventListener('click', clearCurrentMonthInput);
    document.getElementById('clearDayBtn').addEventListener('click', function () {
      const key = document.getElementById('dayModal').getAttribute('data-edit-key');
      clearDayInput(key);
    });

    document.getElementById('copyPopoverToOthers').addEventListener('click', function () {
      const key = document.getElementById('copyPopover').getAttribute('data-copy-key');
      if (key) copyDayToOtherDates(key);
      closeCopyPopover();
    });
    document.getElementById('copyPopoverToWeekday').addEventListener('click', function () {
      const key = document.getElementById('copyPopover').getAttribute('data-copy-key');
      if (key) copyToSameWeekdayInMonth(key);
      closeCopyPopover();
    });
    document.addEventListener('click', function (e) {
      const popover = document.getElementById('copyPopover');
      if (!popover.classList.contains('copy-popover-visible')) return;
      if (popover.contains(e.target) || e.target.closest('.day-quick-copy')) return;
      closeCopyPopover();
    });

    document.getElementById('monthNotes').value = state.monthNotes;
    document.getElementById('monthNotes').addEventListener('input', function () {
      state.monthNotes = this.value;
      saveState();
    });

    document.getElementById('draftSaveBtn').addEventListener('click', function () {
      state.monthNotes = document.getElementById('monthNotes').value;
      saveState();
      showToast('下書きを保存しました');
    });

    document.getElementById('viewSubmittedBtn').addEventListener('click', openConfirmModal);
    document.getElementById('confirmModalClose').addEventListener('click', closeConfirmModal);
    document.getElementById('confirmModalBackdrop').addEventListener('click', closeConfirmModal);

    document.getElementById('submitBtn').addEventListener('click', function () {
      state.monthNotes = document.getElementById('monthNotes').value;
      saveState();

      var gasUrl = getEffectiveGasUrl();
      var employeeName = state.employeeName && state.employeeName.trim();

      if (gasUrl && employeeName) {
        var payload = {
          employeeName: employeeName,
          year: state.year,
          month: state.month + 1,
          monthNotes: state.monthNotes,
          days: state.days,
          submittedAt: new Date().toISOString(),
        };
        // Content-Type: text/plain にするとプリフライトが不要になり、GAS に POST が届きやすくなります（レスポンスはCORSのため読まない）
        fetch(gasUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          body: JSON.stringify(payload),
        })
          .then(function () {
            state.submitted = true;
            saveState();
            updateFooterVisibility();
            var count = Object.keys(state.days).filter(function (k) {
              var d = state.days[k];
              return d.allDay || slotHasContent(d.slot1) || slotHasContent(d.slot2);
            }).length;
            showToast('希望を提出しました。1日単位で修正できます。');
            alert('希望を提出しました。\n\n入力した日数: ' + count + ' 日\n\nスプレッドシートに記録されました。');
          })
          .catch(function (err) {
            showToast('送信に失敗しました');
            alert('送信に失敗しました。\n\nGASのURLとスプレッドシートの設定を確認してください。\n\n' + String(err));
          });
        return;
      }

      if (!gasUrl || !employeeName) {
        alert(
          '提出するには次のいずれかが必要です。\n\n' +
            '1. 管理者が配布しているURLでアプリを開く（GASのURLが最初から設定されている場合）\n' +
            '2. 「⚙️ 設定」からGASのウェブアプリURLを入力する\n' +
            '3. 「あなたの名前」で自分を選択する\n\n' +
            '設定後、もう一度「希望を提出する」を押してください。'
        );
        return;
      }

      state.submitted = true;
      saveState();
      updateFooterVisibility();
      showToast('希望を提出しました（ローカル保存のみ）');
    });

    document.getElementById('employeeSelect').addEventListener('change', function () {
      state.employeeName = this.value || '';
      saveState();
    });

    document.getElementById('settingsBtn').addEventListener('click', function () {
      document.getElementById('gasUrlInput').value = getGasUrl() || getEffectiveGasUrl();
      document.getElementById('settingsModal').classList.add('is-open');
      document.getElementById('settingsModal').setAttribute('aria-hidden', 'false');
    });
    document.getElementById('settingsModalClose').addEventListener('click', closeSettingsModal);
    document.getElementById('settingsModalBackdrop').addEventListener('click', closeSettingsModal);
    document.getElementById('settingsSaveBtn').addEventListener('click', function () {
      var url = document.getElementById('gasUrlInput').value.trim();
      setGasUrl(url);
      closeSettingsModal();
      if (url) {
        fetchEmployees().then(function (list) {
          showToast(list.length > 0 ? '設定を保存しました。従業員リストを読み込みました。' : '設定を保存しました。従業員シートを確認してください。');
        });
      } else {
        populateEmployeeSelect([]);
        showToast('設定を保存しました');
      }
    });
  }

  function closeSettingsModal() {
    var modal = document.getElementById('settingsModal');
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
  }

  function init() {
    loadState();
    document.getElementById('monthNotes').value = state.monthNotes;
    renderCalendar();
    updateFooterVisibility();
    bindEvents();
    if (getEffectiveGasUrl()) fetchEmployees();
  }

  init();
})();
