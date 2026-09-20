const crypto = require('crypto');
const { load, save, MAX_ALLOW_TEXT_LENGTH } = require('./store');
const { ApiError } = require('./errors');

// 找到允许写法所属的规则，规则已经不在时按同一套说法拒绝
function findRule(data, ruleId) {
  const rule = data.rules.find((item) => item.id === ruleId);
  if (!rule) throw new ApiError(404, 'RULE_NOT_FOUND', '这条规则不存在或已被删除', '');
  return rule;
}

// 规则的允许清单：按登记顺序给出
function listAllows(ruleId) {
  const data = load();
  const rule = findRule(data, ruleId);
  const allows = data.allows
    .filter((item) => item.ruleId === rule.id)
    .map((item) => ({ id: item.id, ruleId: item.ruleId, text: item.text, createdAt: item.createdAt, updatedAt: item.updatedAt }));
  return { ruleId: rule.id, code: rule.code, pattern: rule.pattern, allows };
}

// 新增一条允许写法。第 n 项指它在这条规则清单里将占据的位置（当前条数 + 1）
function createAllow(ruleId, payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const rule = findRule(data, ruleId);
  const owned = data.allows.filter((item) => item.ruleId === rule.id);
  const n = owned.length + 1;
  const text = typeof input.text === 'string' ? input.text : '';

  if (!text.trim()) {
    throw new ApiError(400, 'ALLOW_TEXT_REQUIRED', `规则 ${rule.code} 的允许清单第 ${n} 项不能为空`, 'allowText');
  }
  if (text.includes('\n') || text.includes('\r')) {
    throw new ApiError(400, 'ALLOW_TEXT_INVALID', `规则 ${rule.code} 的允许清单第 ${n} 项只能写一行文本`, 'allowText');
  }
  if (text.length > MAX_ALLOW_TEXT_LENGTH) {
    throw new ApiError(400, 'ALLOW_TEXT_TOO_LONG', `规则 ${rule.code} 的允许清单第 ${n} 项不能超过 ${MAX_ALLOW_TEXT_LENGTH} 个字符`, 'allowText');
  }
  const sameIndex = owned.findIndex((item) => item.text === text);
  if (sameIndex !== -1) {
    throw new ApiError(409, 'ALLOW_TEXT_DUPLICATED', `规则 ${rule.code} 的允许清单第 ${sameIndex + 1} 项已经是这个写法，第 ${n} 项不能重复添加`, 'allowText');
  }
  if (text === rule.pattern) {
    throw new ApiError(409, 'ALLOW_TEXT_EQUALS_PATTERN', `规则 ${rule.code} 的允许清单第 ${n} 项和该规则的匹配写法完全相同，加上后这条规则将永远不命中`, 'allowText');
  }

  const now = new Date().toISOString();
  const created = {
    id: crypto.randomUUID(),
    ruleId: rule.id,
    text,
    createdAt: now,
    updatedAt: now,
  };
  data.allows.push(created);
  save(data);
  return created;
}

// 删除一条允许写法，只能删这条规则自己清单里的项
function deleteAllow(ruleId, entryId) {
  const data = load();
  const rule = findRule(data, ruleId);
  const index = data.allows.findIndex((item) => item.id === entryId && item.ruleId === rule.id);
  if (index === -1) {
    throw new ApiError(404, 'ALLOW_NOT_FOUND', `规则 ${rule.code} 的允许清单里没有这一项`, '');
  }
  const [removed] = data.allows.splice(index, 1);
  save(data);
  return { id: removed.id, ruleId: rule.id };
}

module.exports = {
  listAllows,
  createAllow,
  deleteAllow,
};
