/**
 * 下書き復元機能
 * 1) GASの「下書き」シートに保存されている下書きがあればそこから復元
 * 2) 無ければブラウザの localStorage（shiftHopeApp）から復元
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'shiftHopeApp';
  var STORAGE_KEY_GAS_URL = 'shiftHopeAppGasUrl';
  var BUTTON_ID = 'draftRestoreBtn';

  function showToast(message) {
    var existing = document.getElementById('toast');
    if (existing) existing.remove();
    var toast = document.createElement('div');
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

  function getEffectiveGasUrl() {
    try {
      var fromStorage = localStorage.getItem(STORAGE_KEY_GAS_URL);
      if (fromStorage && fromStorage.trim()) return fromStorage.trim();
      if (typeof window !== 'undefined' && window.SHIFT_APP_GAS_URL && String(window.SHIFT_APP_GAS_URL).trim()) {
        return String(window.SHIFT_APP_GAS_URL).trim();
      }
    } catch (_) {}
    return '';
  }

  function getLocalState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function hasStoredDraft() {
    var state = getLocalState();
    if (state && (state.monthNotes || (state.days && Object.keys(state.days).length > 0))) return true;
    return !!localStorage.getItem(STORAGE_KEY);
  }

  function applyDraftToStorage(draft) {
    var state = getLocalState() || {};
    state.year = draft.year != null ? draft.year : state.year;
    state.month = draft.month != null ? draft.month - 1 : state.month;
    state.monthNotes = draft.monthNotes != null ? String(draft.monthNotes) : (state.monthNotes || '');
    state.days = draft.days && typeof draft.days === 'object' ? draft.days : (state.days || {});
    state.submitted = false;
    if (draft.employeeName != null) state.employeeName = String(draft.employeeName);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {}
  }

  function restoreDraft() {
    if (!window.confirm('保存した下書きを復元しますか？\n現在の画面の内容は、保存済みの下書きで上書きされます。')) {
      return;
    }
    var gasUrl = getEffectiveGasUrl();
    var local = getLocalState();
    var employeeName = local && local.employeeName ? String(local.employeeName).trim() : '';
    var year = local && local.year != null ? local.year : new Date().getFullYear();
    var month = local && local.month != null ? local.month + 1 : new Date().getMonth() + 1;

    if (gasUrl && gasUrl.indexOf('script.google.com') !== -1 && employeeName) {
      var sep = gasUrl.indexOf('?') >= 0 ? '&' : '?';
      var query = 'draft=1&employeeName=' + encodeURIComponent(employeeName) + '&year=' + encodeURIComponent(year) + '&month=' + encodeURIComponent(month);
      fetch(gasUrl + sep + query)
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data && !data.error && (data.monthNotes != null || (data.days && Object.keys(data.days).length > 0))) {
            applyDraftToStorage(data);
            showToast('下書きを復元しました');
            window.location.reload();
            return;
          }
          tryRestoreFromLocal();
        })
        .catch(function () {
          tryRestoreFromLocal();
        });
    } else {
      tryRestoreFromLocal();
    }
  }

  function tryRestoreFromLocal() {
    if (!hasStoredDraft()) {
      showToast('保存されている下書きはありません');
      return;
    }
    showToast('下書きを復元しました');
    window.location.reload();
  }

  function ensureButton() {
    var btn = document.getElementById(BUTTON_ID);
    if (btn) {
      btn.addEventListener('click', restoreDraft);
      return;
    }
    // ボタンがHTMLに無い場合はフッターに挿入
    var footerActions = document.querySelector('.footer-actions');
    if (!footerActions) return;
    var insertBtn = document.createElement('button');
    insertBtn.type = 'button';
    insertBtn.id = BUTTON_ID;
    insertBtn.className = 'btn-secondary';
    insertBtn.textContent = '下書き復元';
    var draftSaveBtn = document.getElementById('draftSaveBtn');
    if (draftSaveBtn && draftSaveBtn.nextSibling) {
      footerActions.insertBefore(insertBtn, draftSaveBtn.nextSibling);
    } else {
      footerActions.appendChild(insertBtn);
    }
    insertBtn.addEventListener('click', restoreDraft);
  }

  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', ensureButton);
    } else {
      ensureButton();
    }
  }

  init();
})();
