// 页面交互：规则、文件与扫描三块都从服务端拉取，任何一步失败都把说明显示在顶部并标到对应输入项上

const state = {
  rules: [],
  files: [],
  levels: [],
  statuses: [],
  fileTypes: [],
  ruleLevels: [],
  ruleStatuses: [],
  ruleFileTypes: [],
  editingRuleId: '',
  editingFileId: '',
  allowsMap: {},
  openAllowRules: new Set(),
  hitView: 'active',
  lastScan: null,
  lastScanBody: null,
};

const el = (id) => document.getElementById(id);

// 统一的请求入口：出错时把服务端给的错误码、说明与出错位置一起抛出去
async function request(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch (err) {
    payload = null;
  }
  if (!res.ok) {
    const error = (payload && payload.error) || {};
    const failure = new Error(error.message || `请求失败（状态码 ${res.status}）`);
    failure.code = error.code || '';
    failure.field = error.field || '';
    throw failure;
  }
  return payload;
}

function notify(message, kind) {
  const box = el('notice');
  box.textContent = message;
  box.className = `notice ${kind === 'ok' ? 'ok' : 'error'}`;
}

function clearNotice() {
  const box = el('notice');
  box.className = 'notice hidden';
  box.textContent = '';
}

function clearFieldMarks() {
  document.querySelectorAll('.invalid').forEach((node) => node.classList.remove('invalid'));
}

// 把出错位置标到具体输入项上：规则区与文件区共用一套标记
function markField(field) {
  if (!field) return;
  const target = document.querySelector(`[data-field="${field}"]`);
  if (!target) return;
  target.classList.add('invalid');
  const input = target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA'
    ? target
    : target.querySelector('input, select, textarea');
  if (input) input.focus();
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (num) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function levelClass(level) {
  if (level === '错误') return 'lv-error';
  if (level === '警告') return 'lv-warn';
  return 'lv-hint';
}

const OPERATOR_KEY = 'check-hits-operator';

function currentOperator() {
  return el('operator').value.trim();
}

function restoreOperator() {
  el('operator').value = window.localStorage.getItem(OPERATOR_KEY) || '';
}

async function loadHealth() {
  try {
    await request('/api/health');
    el('health').textContent = '服务正常';
    el('health').className = 'health ok';
  } catch (err) {
    el('health').textContent = '服务连不上';
    el('health').className = 'health bad';
  }
}

async function loadRules() {
  const params = new URLSearchParams();
  const level = el('rule-filter-level').value;
  const status = el('rule-filter-status').value;
  const fileType = el('rule-filter-type').value;
  const keyword = el('rule-filter-keyword').value.trim();
  if (level) params.set('level', level);
  if (status) params.set('status', status);
  if (fileType) params.set('fileType', fileType);
  if (keyword) params.set('keyword', keyword);
  const query = params.toString();
  const payload = await request(`/api/rules${query ? `?${query}` : ''}`);
  state.rules = payload.rules || [];
  state.levels = payload.levels || [];
  state.statuses = payload.statuses || [];
  state.fileTypes = payload.fileTypes || [];
  renderRuleFilters();
  renderRules();
  renderScanRuleOptions();
}

async function loadFiles() {
  const params = new URLSearchParams();
  const type = el('file-filter-type').value;
  const keyword = el('file-filter-keyword').value.trim();
  if (type) params.set('type', type);
  if (keyword) params.set('keyword', keyword);
  const query = params.toString();
  const payload = await request(`/api/files${query ? `?${query}` : ''}`);
  state.files = payload.files || [];
  state.ruleFileTypes = payload.fileTypes || [];
  renderFileFilters();
  renderFiles();
  renderScanFileOptions();
}

function renderRuleFilters() {
  const levelSelect = el('rule-filter-level');
  const levelCurrent = levelSelect.value;
  levelSelect.innerHTML = '<option value="">全部级别</option>'
    + state.levels.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.levels.includes(levelCurrent)) levelSelect.value = levelCurrent;

  const statusSelect = el('rule-filter-status');
  const statusCurrent = statusSelect.value;
  statusSelect.innerHTML = '<option value="">全部状态</option>'
    + state.statuses.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.statuses.includes(statusCurrent)) statusSelect.value = statusCurrent;

  const typeSelect = el('rule-filter-type');
  const typeCurrent = typeSelect.value;
  typeSelect.innerHTML = '<option value="">全部适用文件类型</option>'
    + state.fileTypes.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.fileTypes.includes(typeCurrent)) typeSelect.value = typeCurrent;

  const formLevel = el('rule-level');
  const formLevelCurrent = formLevel.value;
  formLevel.innerHTML = state.levels.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.levels.includes(formLevelCurrent)) formLevel.value = formLevelCurrent;

  const formStatus = el('rule-status');
  const formStatusCurrent = formStatus.value;
  formStatus.innerHTML = state.statuses.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.statuses.includes(formStatusCurrent)) formStatus.value = formStatusCurrent;

  const formType = el('rule-file-type');
  const formTypeCurrent = formType.value;
  formType.innerHTML = state.fileTypes.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.fileTypes.includes(formTypeCurrent)) formType.value = formTypeCurrent;

  const scanLevel = el('scan-level');
  const scanLevelCurrent = scanLevel.value;
  scanLevel.innerHTML = '<option value="">全部级别</option>'
    + state.levels.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.levels.includes(scanLevelCurrent)) scanLevel.value = scanLevelCurrent;
}

function renderFileFilters() {
  const typeSelect = el('file-filter-type');
  const current = typeSelect.value;
  typeSelect.innerHTML = '<option value="">全部类型</option>'
    + state.ruleFileTypes.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.ruleFileTypes.includes(current)) typeSelect.value = current;
}

function renderScanRuleOptions() {
  const select = el('scan-rule');
  const current = select.value;
  select.innerHTML = '<option value="">全部规则</option>'
    + state.rules.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.code)} ${escapeHtml(item.name)}</option>`).join('');
  if (state.rules.some((item) => item.id === current)) select.value = current;
}

function renderScanFileOptions() {
  const select = el('scan-file');
  const current = select.value;
  select.innerHTML = '<option value="">全部文件</option>'
    + state.files.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.path)}</option>`).join('');
  if (state.files.some((item) => item.id === current)) select.value = current;
}

function renderRules() {
  const body = el('rule-body');
  body.innerHTML = state.rules.map((item) => {
    const open = state.openAllowRules.has(item.id);
    return `<tr>
      <td class="mono">${escapeHtml(item.code)}</td>
      <td>${escapeHtml(item.name)}</td>
      <td><span class="tag ${levelClass(item.level)}">${escapeHtml(item.level)}</span></td>
      <td>${escapeHtml(item.status)}</td>
      <td>${escapeHtml(item.fileType)}</td>
      <td class="mono">${escapeHtml(item.pattern)}</td>
      <td>
        <button type="button" class="link" data-allow-toggle="${escapeHtml(item.id)}">${item.allowCount || 0} 种写法</button>
      </td>
      <td class="note-cell">${escapeHtml(item.note)}</td>
      <td class="mono">${escapeHtml(formatTime(item.updatedAt))}</td>
      <td class="actions">
        <button type="button" class="link" data-rule-edit="${escapeHtml(item.id)}">编辑</button>
        <button type="button" class="link danger" data-rule-delete="${escapeHtml(item.id)}">删除</button>
      </td>
    </tr>
    <tr class="allow-row ${open ? '' : 'hidden'}" data-allow-row="${escapeHtml(item.id)}">
      <td colspan="10"><div class="allow-box" data-allow-box="${escapeHtml(item.id)}"></div></td>
    </tr>`;
  }).join('');
  el('rule-empty').classList.toggle('hidden', state.rules.length > 0);
  state.openAllowRules.forEach((ruleId) => renderAllowBox(ruleId));
}

// 从最近一轮扫描结果里取某条规则允许清单的逐条排除数
function allowStatsOf(ruleId) {
  const stats = state.lastScan && state.lastScan.allowStats;
  if (!stats) return null;
  return stats.find((item) => item.ruleId === ruleId) || null;
}

// 画一条规则的允许清单管理区：几种写法、每种本轮排除多少条、新增与移除
function renderAllowBox(ruleId) {
  const box = document.querySelector(`[data-allow-box="${CSS.escape(ruleId)}"]`);
  if (!box) return;
  const entries = state.allowsMap[ruleId] || [];
  const stats = allowStatsOf(ruleId);
  let excludedTotal = 0;
  let touchedKinds = 0;
  const countOf = (entryId) => {
    if (!stats) return 0;
    const entry = stats.entries.find((item) => item.id === entryId);
    return entry ? entry.excludedCount : 0;
  };
  if (stats) {
    stats.entries.forEach((entry) => {
      excludedTotal += entry.excludedCount;
      if (entry.excludedCount > 0) touchedKinds += 1;
    });
  }
  const scanLine = stats
    ? `本轮共排除 ${excludedTotal} 条（涉及 ${touchedKinds} 种写法）`
    : '本轮尚未扫描';

  box.innerHTML = `
    <div class="allow-head">
      <strong>允许清单</strong>
      <span class="allow-count">共登记 ${entries.length} 种写法</span>
      <span class="allow-count">${escapeHtml(scanLine)}</span>
    </div>
    <ul class="allow-list">
      ${entries.map((entry) => `<li>
        <span class="mono allow-order">第 ${escapeHtml(String(entry.order))} 项</span>
        <span class="mono allow-text">${escapeHtml(entry.text)}</span>
        <span class="allow-count">本轮排除 ${countOf(entry.id)} 条</span>
        <button type="button" class="link danger" data-allow-delete="${escapeHtml(entry.id)}" data-rule-id="${escapeHtml(ruleId)}">移除</button>
      </li>`).join('')}
      ${entries.length === 0 ? '<li class="allow-count">还没有登记允许写法</li>' : ''}
    </ul>
    <div class="allow-add">
      <label data-field="allowText">允许写法<input class="allow-text-input" maxlength="60" placeholder="命中行包含这段写法时，不再算这条规则命中"></label>
      <button type="button" data-allow-add="${escapeHtml(ruleId)}">登记</button>
    </div>
    <p class="allow-hint">写法区分大小写、按包含判断，只对这条规则生效；一行同时命中多种写法时记在清单里最靠前的一种。</p>`;
}

async function toggleAllowBox(ruleId) {
  const willOpen = !state.openAllowRules.has(ruleId);
  if (willOpen) {
    state.openAllowRules.add(ruleId);
    if (!state.allowsMap[ruleId]) {
      try {
        const payload = await request(`/api/rules/${encodeURIComponent(ruleId)}/allows`);
        state.allowsMap[ruleId] = (payload.allows || []).map((item, index) => ({ ...item, order: index + 1 }));
      } catch (err) {
        state.openAllowRules.delete(ruleId);
        notify(err.message, 'error');
        return;
      }
    }
  } else {
    state.openAllowRules.delete(ruleId);
  }
  renderRules();
}

async function submitAllowAdd(ruleId) {
  const input = document.querySelector(`[data-allow-row="${CSS.escape(ruleId)}"] .allow-text-input`);
  const label = document.querySelector(`[data-allow-row="${CSS.escape(ruleId)}"] [data-field="allowText"]`);
  clearNotice();
  if (label) label.classList.remove('invalid');
  try {
    await request(`/api/rules/${encodeURIComponent(ruleId)}/allows`, {
      method: 'POST',
      body: JSON.stringify({ text: input ? input.value : '' }),
    });
    const payload = await request(`/api/rules/${encodeURIComponent(ruleId)}/allows`);
    state.allowsMap[ruleId] = (payload.allows || []).map((item, index) => ({ ...item, order: index + 1 }));
    notify('允许写法已登记', 'ok');
    await loadRules();
  } catch (err) {
    notify(err.message, 'error');
    if (label) {
      label.classList.add('invalid');
      const field = label.querySelector('input');
      if (field) field.focus();
    }
  }
}

async function submitAllowDelete(ruleId, entryId) {
  clearNotice();
  if (!window.confirm('确定把这种写法从允许清单里移除吗？')) return;
  try {
    await request(`/api/rules/${encodeURIComponent(ruleId)}/allows/${encodeURIComponent(entryId)}`, { method: 'DELETE' });
    const payload = await request(`/api/rules/${encodeURIComponent(ruleId)}/allows`);
    state.allowsMap[ruleId] = (payload.allows || []).map((item, index) => ({ ...item, order: index + 1 }));
    notify('允许写法已移除', 'ok');
    await loadRules();
  } catch (err) {
    notify(err.message, 'error');
  }
}

function renderFiles() {
  const body = el('file-body');
  body.innerHTML = state.files.map((item) => `<tr>
      <td class="mono">${escapeHtml(item.path)}</td>
      <td>${escapeHtml(item.type)}</td>
      <td>${item.lineCount} 行</td>
      <td class="note-cell">${escapeHtml(item.note)}</td>
      <td class="mono">${escapeHtml(formatTime(item.updatedAt))}</td>
      <td class="actions">
        <button type="button" class="link" data-file-view="${escapeHtml(item.id)}">看内容</button>
        <button type="button" class="link" data-file-edit="${escapeHtml(item.id)}">编辑</button>
        <button type="button" class="link danger" data-file-delete="${escapeHtml(item.id)}">删除</button>
      </td>
    </tr>`).join('');
  el('file-empty').classList.toggle('hidden', state.files.length > 0);
}

function openRuleForm(rule) {
  state.editingRuleId = rule ? rule.id : '';
  el('rule-form-title').textContent = rule ? `编辑规则：${rule.code}` : '新建规则';
  el('rule-code').value = rule ? rule.code : '';
  el('rule-name').value = rule ? rule.name : '';
  el('rule-level').value = rule ? rule.level : (state.levels[0] || '提示');
  el('rule-status').value = rule ? rule.status : (state.statuses[0] || '启用');
  el('rule-file-type').value = rule ? rule.fileType : (state.fileTypes[0] || '全部');
  el('rule-pattern').value = rule ? rule.pattern : '';
  el('rule-note').value = rule ? rule.note : '';
  el('rule-form').classList.remove('hidden');
  el('rule-code').focus();
}

function closeRuleForm() {
  state.editingRuleId = '';
  el('rule-form').classList.add('hidden');
  clearFieldMarks();
}

function openFileForm(file) {
  state.editingFileId = file ? file.id : '';
  el('file-form-title').textContent = file ? `编辑文件：${file.path}` : '收录新文件';
  el('file-path').value = file ? file.path : '';
  el('file-content').value = file ? file.content : '';
  el('file-note').value = file ? file.note : '';
  el('file-form').classList.remove('hidden');
  el('file-path').focus();
}

function closeFileForm() {
  state.editingFileId = '';
  el('file-form').classList.add('hidden');
  clearFieldMarks();
}

async function showFileContent(id) {
  clearNotice();
  try {
    const file = await request(`/api/files/${encodeURIComponent(id)}`);
    const preview = el('file-preview');
    preview.textContent = `${file.path}（${file.lineCount} 行）\n${'─'.repeat(40)}\n${file.content}`;
    preview.classList.remove('hidden');
  } catch (err) {
    notify(err.message, 'error');
  }
}

async function submitRule(event) {
  event.preventDefault();
  clearNotice();
  clearFieldMarks();
  const payload = {
    code: el('rule-code').value,
    name: el('rule-name').value,
    level: el('rule-level').value,
    status: el('rule-status').value,
    fileType: el('rule-file-type').value,
    pattern: el('rule-pattern').value,
    note: el('rule-note').value,
  };
  const editing = state.editingRuleId;
  try {
    if (editing) {
      await request(`/api/rules/${encodeURIComponent(editing)}`, { method: 'PATCH', body: JSON.stringify(payload) });
      notify('规则已保存', 'ok');
    } else {
      await request('/api/rules', { method: 'POST', body: JSON.stringify(payload) });
      notify('规则已新增', 'ok');
    }
    closeRuleForm();
    await loadRules();
  } catch (err) {
    notify(err.message, 'error');
    markField(err.field);
  }
}

async function submitFile(event) {
  event.preventDefault();
  clearNotice();
  clearFieldMarks();
  const payload = {
    path: el('file-path').value,
    content: el('file-content').value,
    note: el('file-note').value,
  };
  const editing = state.editingFileId;
  try {
    if (editing) {
      await request(`/api/files/${encodeURIComponent(editing)}`, { method: 'PATCH', body: JSON.stringify(payload) });
      notify('文件已保存', 'ok');
    } else {
      await request('/api/files', { method: 'POST', body: JSON.stringify(payload) });
      notify('文件已收录', 'ok');
    }
    closeFileForm();
    await loadFiles();
  } catch (err) {
    notify(err.message, 'error');
    markField(err.field);
  }
}

// 扫一遍，把概要与命中清单都画出来
async function runScan() {
  clearNotice();
  const body = {
    ruleId: el('scan-rule').value,
    fileId: el('scan-file').value,
    level: el('scan-level').value,
  };
  try {
    const result = await request('/api/scan', { method: 'POST', body: JSON.stringify(body) });
    state.lastScan = result;
    state.lastScanBody = body;
    renderScan(result);
  } catch (err) {
    notify(err.message, 'error');
  }
}

function renderScan(result) {
  el('scan-meta').textContent = `扫描时刻 ${formatTime(result.scannedAt)}　参与比对的规则 ${result.rulesUsed} 条（启用共 ${result.enabledRules} 条）　范围里的文件 ${result.filesInScope} 个（清单共 ${result.filesTotal} 个）`;

  const warningBox = el('scan-warning');
  if (result.warning) {
    warningBox.textContent = result.warning;
    warningBox.classList.remove('hidden');
  } else {
    warningBox.classList.add('hidden');
    warningBox.textContent = '';
  }

  const summary = result.summary;
  const levelText = Object.keys(summary.byLevel)
    .map((key) => `${key} ${summary.byLevel[key]} 条`)
    .join('　');
  const ruleText = summary.byRule
    .map((item) => `${item.code} 待处理 ${item.count} 条／排除 ${item.excludedCount}／忽略 ${item.ignoredCount}`)
    .join('　') || '没有规则命中';
  const fileText = summary.byFile
    .map((item) => `${item.path} 待处理 ${item.count} 条／排除 ${item.excludedCount}／忽略 ${item.ignoredCount}`)
    .join('　') || '没有文件命中';
  const summaryBox = el('scan-summary');
  summaryBox.innerHTML = `
    <div class="summary-line"><strong>原始命中 ${summary.rawTotal} 条 ＝ 待处理 ${summary.total} 条 ＋ 允许排除 ${summary.excludedTotal} 条 ＋ 已忽略 ${summary.ignoredTotal} 条</strong>　${escapeHtml(levelText)}</div>
    <div class="summary-line">按规则：${escapeHtml(ruleText)}</div>
    <div class="summary-line">按文件：${escapeHtml(fileText)}</div>`;
  summaryBox.classList.remove('hidden');

  el('seg-active').textContent = summary.total;
  el('seg-excluded').textContent = summary.excludedTotal;
  el('seg-ignored').textContent = result.ignores.length;
  el('hit-segments').classList.remove('hidden');
  document.querySelectorAll('.seg-btn').forEach((btn) => {
    btn.classList.toggle('on', btn.dataset.hitView === state.hitView);
  });

  renderHitTable();
  state.openAllowRules.forEach((ruleId) => renderAllowBox(ruleId));
}

function hitBaseCells(hit) {
  return `<td class="mono">${escapeHtml(hit.code)}</td>
      <td><span class="tag ${levelClass(hit.level)}">${escapeHtml(hit.level)}</span></td>
      <td>${escapeHtml(hit.ruleName)}</td>
      <td class="mono">${escapeHtml(hit.path)}</td>
      <td class="mono">${hit.lineNo}</td>
      <td class="mono line-cell">${escapeHtml(hit.lineText)}</td>`;
}

// 三个页签共用一张表：待处理可忽略，允许排除写明是哪种写法放行，已忽略可取消
function renderHitTable() {
  const result = state.lastScan;
  const body = el('hit-body');
  const empty = el('hit-empty');
  if (!result) {
    body.innerHTML = '';
    empty.textContent = '还没有扫过，点右上角扫一遍';
    empty.classList.remove('hidden');
    return;
  }

  if (state.hitView === 'excluded') {
    body.innerHTML = result.excludedHits.map((hit) => `<tr>
      ${hitBaseCells(hit)}
      <td class="muted">允许：第 ${hit.allowOrder} 项 <span class="mono">${escapeHtml(hit.allowText)}</span></td>
    </tr>`).join('');
    empty.textContent = '这一轮没有被允许清单排除的命中';
    empty.classList.toggle('hidden', result.excludedHits.length > 0);
    return;
  }

  if (state.hitView === 'ignored') {
    const liveKeys = new Set(result.ignoredHits.map((hit) => hit.ignoreId));
    const rows = result.ignoredHits.map((hit) => `<tr>
      ${hitBaseCells(hit)}
      <td class="muted">已忽略 ${formatTime(hit.ignoredAt)}　<button type="button" class="link" data-ignore-cancel="${escapeHtml(hit.ignoreId)}">取消忽略</button></td>
    </tr>`).join('');
    const stale = result.ignores.filter((item) => !liveKeys.has(item.id));
    const staleRows = stale.length ? `<tr class="stale-sep"><td colspan="7">本轮未命中或不在扫描范围、但仍登记着的忽略：</td></tr>`
      + stale.map((item) => `<tr>
        ${hitBaseCells(item)}
        <td class="muted">历史忽略 ${formatTime(item.createdAt)}　<button type="button" class="link" data-ignore-cancel="${escapeHtml(item.id)}">取消忽略</button></td>
      </tr>`).join('') : '';
    body.innerHTML = rows + staleRows;
    empty.textContent = '还没有忽略任何命中';
    empty.classList.toggle('hidden', result.ignores.length > 0);
    return;
  }

  body.innerHTML = result.hits.map((hit) => `<tr>
    ${hitBaseCells(hit)}
    <td><button type="button" class="link" data-hit-ignore="1" data-rule-id="${escapeHtml(hit.ruleId)}" data-file-id="${escapeHtml(hit.fileId)}" data-line-no="${hit.lineNo}">忽略这一条</button></td>
  </tr>`).join('');
  empty.textContent = '这一轮没有待处理的命中';
  empty.classList.toggle('hidden', result.hits.length > 0);
}

// 用最近一次的范围重新扫一遍，让计数与三个页签都以服务端为准
async function rescanLast() {
  const body = state.lastScanBody || {};
  const result = await request('/api/scan', { method: 'POST', body: JSON.stringify(body) });
  state.lastScan = result;
  renderScan(result);
}

async function ignoreHit(ruleId, fileId, lineNo) {
  clearNotice();
  try {
    await request('/api/ignores', { method: 'POST', body: JSON.stringify({ ruleId, fileId, lineNo: Number(lineNo) }) });
    notify('这条命中已忽略', 'ok');
    await rescanLast();
  } catch (err) {
    notify(err.message, 'error');
  }
}

async function cancelIgnore(ignoreId) {
  clearNotice();
  try {
    await request(`/api/ignores/${encodeURIComponent(ignoreId)}`, { method: 'DELETE' });
    notify('已取消忽略', 'ok');
    await rescanLast();
  } catch (err) {
    notify(err.message, 'error');
  }
}

// 列表上的操作用事件委托统一处理，列表重绘之后不需要重新绑定
document.addEventListener('click', async (event) => {
  const node = event.target.closest('button');
  if (!node) return;

  if (node.dataset.allowToggle) {
    await toggleAllowBox(node.dataset.allowToggle);
    return;
  }

  if (node.dataset.allowAdd) {
    await submitAllowAdd(node.dataset.allowAdd);
    return;
  }

  if (node.dataset.allowDelete) {
    await submitAllowDelete(node.dataset.ruleId, node.dataset.allowDelete);
    return;
  }

  if (node.dataset.hitView) {
    state.hitView = node.dataset.hitView;
    document.querySelectorAll('.seg-btn').forEach((btn) => btn.classList.toggle('on', btn === node));
    renderHitTable();
    return;
  }

  if (node.dataset.hitIgnore) {
    await ignoreHit(node.dataset.ruleId, node.dataset.fileId, node.dataset.lineNo);
    return;
  }

  if (node.dataset.ignoreCancel) {
    await cancelIgnore(node.dataset.ignoreCancel);
    return;
  }

  if (node.dataset.ruleEdit) {
    clearNotice();
    const found = state.rules.find((item) => item.id === node.dataset.ruleEdit);
    if (found) openRuleForm(found);
    return;
  }

  if (node.dataset.ruleDelete) {
    clearNotice();
    const found = state.rules.find((item) => item.id === node.dataset.ruleDelete);
    if (!window.confirm(`确定删除规则 ${found ? found.code : ''} 吗？其允许清单与相关忽略也会一并清掉`)) return;
    try {
      await request(`/api/rules/${encodeURIComponent(node.dataset.ruleDelete)}`, { method: 'DELETE' });
      if (state.editingRuleId === node.dataset.ruleDelete) closeRuleForm();
      state.openAllowRules.delete(node.dataset.ruleDelete);
      delete state.allowsMap[node.dataset.ruleDelete];
      notify('规则已删除', 'ok');
      await loadRules();
    } catch (err) {
      notify(err.message, 'error');
    }
    return;
  }

  if (node.dataset.fileView) {
    await showFileContent(node.dataset.fileView);
    return;
  }

  if (node.dataset.fileEdit) {
    clearNotice();
    try {
      const file = await request(`/api/files/${encodeURIComponent(node.dataset.fileEdit)}`);
      openFileForm(file);
    } catch (err) {
      notify(err.message, 'error');
    }
    return;
  }

  if (node.dataset.fileDelete) {
    clearNotice();
    const found = state.files.find((item) => item.id === node.dataset.fileDelete);
    if (!window.confirm(`确定把 ${found ? found.path : ''} 移出清单吗？`)) return;
    try {
      await request(`/api/files/${encodeURIComponent(node.dataset.fileDelete)}`, { method: 'DELETE' });
      if (state.editingFileId === node.dataset.fileDelete) closeFileForm();
      el('file-preview').classList.add('hidden');
      notify('文件已移出清单', 'ok');
      await loadFiles();
    } catch (err) {
      notify(err.message, 'error');
    }
  }
});

el('rule-form').addEventListener('submit', submitRule);
el('file-form').addEventListener('submit', submitFile);
el('rule-new').addEventListener('click', () => {
  clearNotice();
  openRuleForm(null);
});
el('rule-cancel').addEventListener('click', closeRuleForm);
el('file-new').addEventListener('click', () => {
  clearNotice();
  openFileForm(null);
});
el('file-cancel').addEventListener('click', closeFileForm);
el('rule-filter-apply').addEventListener('click', () => {
  clearNotice();
  loadRules().catch((err) => notify(err.message, 'error'));
});
el('rule-filter-reset').addEventListener('click', () => {
  el('rule-filter-level').value = '';
  el('rule-filter-status').value = '';
  el('rule-filter-type').value = '';
  el('rule-filter-keyword').value = '';
  loadRules().catch((err) => notify(err.message, 'error'));
});
el('rule-refresh').addEventListener('click', () => {
  clearNotice();
  loadRules()
    .then(loadFiles)
    .catch((err) => notify(err.message, 'error'));
});
el('file-filter-apply').addEventListener('click', () => {
  clearNotice();
  loadFiles().catch((err) => notify(err.message, 'error'));
});
el('file-filter-reset').addEventListener('click', () => {
  el('file-filter-type').value = '';
  el('file-filter-keyword').value = '';
  loadFiles().catch((err) => notify(err.message, 'error'));
});
el('scan-run').addEventListener('click', runScan);
el('rule-filter-level').addEventListener('change', () => {
  loadRules().catch((err) => notify(err.message, 'error'));
});
el('rule-filter-status').addEventListener('change', () => {
  loadRules().catch((err) => notify(err.message, 'error'));
});
el('operator').addEventListener('change', () => {
  window.localStorage.setItem(OPERATOR_KEY, currentOperator());
});

// 页面打开时先把规则与文件都拉一遍，扫描的范围下拉依赖这两份清单
restoreOperator();
loadHealth();
loadRules()
  .then(loadFiles)
  .catch((err) => notify(err.message, 'error'));
