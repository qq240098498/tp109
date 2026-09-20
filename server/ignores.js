const crypto = require('crypto');
const { load, save, STATUSES } = require('./store');
const { ApiError, pickText } = require('./errors');
const { ruleAppliesToFile } = require('./scan');

// 忽略记录按规则编码、文件路径、行号排序，方便页面按这个顺序展示
function sortIgnores(list) {
  return list.slice().sort((a, b) => {
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    return a.lineNo - b.lineNo;
  });
}

function ignoreKey(ruleId, fileId, lineNo) {
  return `${ruleId} ${fileId} ${lineNo}`;
}

// 全部忽略记录：哪怕这一行本轮没有再命中，记录也还在这里
function listIgnores() {
  const data = load();
  return { ignores: sortIgnores(data.ignores) };
}

// 把一条具体命中（规则 + 文件 + 行）标记为忽略。只能忽略当前确实命中的那一行
function createIgnore(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const ruleId = pickText(input.ruleId);
  const fileId = pickText(input.fileId);

  if (!ruleId) throw new ApiError(400, 'IGNORE_RULE_REQUIRED', '请指定要忽略的规则', '');
  if (!fileId) throw new ApiError(400, 'IGNORE_FILE_REQUIRED', '请指定要忽略的文件', '');
  if (!Number.isSafeInteger(input.lineNo) || input.lineNo < 1) {
    throw new ApiError(400, 'IGNORE_LINE_INVALID', '行号必须是不小于 1 的整数', '');
  }
  const lineNo = input.lineNo;

  const data = load();
  const rule = data.rules.find((item) => item.id === ruleId);
  if (!rule) throw new ApiError(404, 'RULE_NOT_FOUND', '这条规则不存在或已被删除', '');
  const file = data.files.find((item) => item.id === fileId);
  if (!file) throw new ApiError(404, 'FILE_NOT_FOUND', '这个文件不存在或已被移出清单', '');

  if (data.ignores.some((item) => item.ruleId === ruleId && item.fileId === fileId && item.lineNo === lineNo)) {
    throw new ApiError(409, 'IGNORE_DUPLICATED', `规则 ${rule.code} 在 ${file.path} 第 ${lineNo} 行的命中已经忽略过了`, '');
  }

  const lines = file.content.split('\n');
  const lineText = lineNo <= lines.length ? lines[lineNo - 1] : '';
  const hitsNow = rule.status === STATUSES[0]
    && ruleAppliesToFile(rule, file)
    && lineNo <= lines.length
    && lineText.includes(rule.pattern);
  if (!hitsNow) {
    throw new ApiError(409, 'IGNORE_HIT_NOT_FOUND', `规则 ${rule.code} 当前没有在 ${file.path} 第 ${lineNo} 行命中，不能忽略`, '');
  }

  const now = new Date().toISOString();
  const created = {
    id: crypto.randomUUID(),
    ruleId,
    fileId,
    lineNo,
    code: rule.code,
    ruleName: rule.name,
    level: rule.level,
    path: file.path,
    lineText: lineText.trim(),
    createdAt: now,
    updatedAt: now,
  };
  data.ignores.push(created);
  save(data);
  return created;
}

// 取消一条忽略记录
function deleteIgnore(id) {
  const data = load();
  const index = data.ignores.findIndex((item) => item.id === id);
  if (index === -1) {
    throw new ApiError(404, 'IGNORE_NOT_FOUND', '这条忽略记录不存在或已被取消', '');
  }
  const [removed] = data.ignores.splice(index, 1);
  save(data);
  return { id: removed.id };
}

module.exports = {
  listIgnores,
  createIgnore,
  deleteIgnore,
  ignoreKey,
};
