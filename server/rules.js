const crypto = require('crypto');
const { load, save, LEVELS, STATUSES, FILE_TYPES, MAX_CODE_LENGTH, MAX_RULE_NAME_LENGTH, MAX_PATTERN_LENGTH, MAX_NOTE_LENGTH, MAX_ALLOWLIST_SIZE } = require('./store');
const { ApiError, pickText } = require('./errors');

// 规则编码固定成大写字母加分段的数字，方便在命中清单里引用
const CODE_PATTERN = /^[A-Z]{2,6}-\d{2,4}$/;

function validateCode(value, data, selfId) {
  const code = pickText(value);
  if (!code) throw new ApiError(400, 'CODE_REQUIRED', '请填写规则编码', 'code');
  if (code.length > MAX_CODE_LENGTH) {
    throw new ApiError(400, 'CODE_TOO_LONG', `规则编码不能超过 ${MAX_CODE_LENGTH} 个字符`, 'code');
  }
  if (!CODE_PATTERN.test(code)) {
    throw new ApiError(400, 'CODE_INVALID', '规则编码要写成大写字母加短横线加数字，例如 CODE-001', 'code');
  }
  const hit = data.rules.find((item) => item.id !== selfId && item.code.toLowerCase() === code.toLowerCase());
  if (hit) throw new ApiError(409, 'CODE_DUPLICATED', `编码 ${hit.code} 已经被 ${hit.name} 用了`, 'code');
  return code;
}

function validateName(value) {
  const name = pickText(value);
  if (!name) throw new ApiError(400, 'NAME_REQUIRED', '请填写规则名称', 'name');
  if (name.length > MAX_RULE_NAME_LENGTH) {
    throw new ApiError(400, 'NAME_TOO_LONG', `规则名称不能超过 ${MAX_RULE_NAME_LENGTH} 个字符`, 'name');
  }
  return name;
}

function validatePattern(value) {
  const pattern = typeof value === 'string' ? value : '';
  if (!pattern.trim()) throw new ApiError(400, 'PATTERN_REQUIRED', '请填写要匹配的写法', 'pattern');
  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new ApiError(400, 'PATTERN_TOO_LONG', `匹配写法不能超过 ${MAX_PATTERN_LENGTH} 个字符`, 'pattern');
  }
  return pattern;
}

// 允许清单逐条当场校验：空条目、同一段写法登记两次、与匹配写法完全相同，都要指出是哪一条规则的哪一项
function validateAllowlist(value, pattern, code) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new ApiError(400, 'ALLOWLIST_INVALID', `规则 ${code} 的允许清单要写成一串写法`, 'allowlist');
  }
  if (value.length > MAX_ALLOWLIST_SIZE) {
    throw new ApiError(400, 'ALLOWLIST_TOO_MANY', `规则 ${code} 的允许清单最多登记 ${MAX_ALLOWLIST_SIZE} 条写法`, 'allowlist');
  }
  const seen = new Map();
  return value.map((item, index) => {
    const where = `规则 ${code} 的允许清单第 ${index + 1} 项`;
    if (typeof item !== 'string') {
      throw new ApiError(400, 'ALLOWLIST_INVALID', `${where} 不是文本，允许清单里只能登记写法`, 'allowlist');
    }
    if (!item.trim()) {
      throw new ApiError(400, 'ALLOWLIST_EMPTY_ITEM', `${where} 是空条目，请把它删掉或填上写法`, 'allowlist');
    }
    if (item.length > MAX_PATTERN_LENGTH) {
      throw new ApiError(400, 'ALLOWLIST_ITEM_TOO_LONG', `${where} 不能超过 ${MAX_PATTERN_LENGTH} 个字符`, 'allowlist');
    }
    if (item === pattern) {
      throw new ApiError(400, 'ALLOWLIST_SAME_AS_PATTERN', `${where} 与这条规则的匹配写法完全相同，登记了它这条规则就永远不可能命中`, 'allowlist');
    }
    if (seen.has(item)) {
      throw new ApiError(400, 'ALLOWLIST_DUPLICATED', `${where} 与第 ${seen.get(item) + 1} 项是同一段写法，一段写法只登记一次`, 'allowlist');
    }
    seen.set(item, index);
    return item;
  });
}

// 只改匹配写法、没动允许清单时，也要复查已有条目会不会与新写法完全相同
function checkAllowlistAgainstPattern(allowlist, pattern, code) {
  allowlist.forEach((item, index) => {
    if (item === pattern) {
      throw new ApiError(400, 'ALLOWLIST_SAME_AS_PATTERN', `规则 ${code} 的允许清单第 ${index + 1} 项与要改成的匹配写法完全相同，请先调整允许清单`, 'pattern');
    }
  });
}

function validateLevel(value) {
  const level = pickText(value);
  if (!level) return LEVELS[0];
  if (!LEVELS.includes(level)) {
    throw new ApiError(400, 'LEVEL_INVALID', `级别只能是 ${LEVELS.join('、')} 其中之一`, 'level');
  }
  return level;
}

function validateStatus(value) {
  const status = pickText(value);
  if (!status) return STATUSES[0];
  if (!STATUSES.includes(status)) {
    throw new ApiError(400, 'STATUS_INVALID', `状态只能是 ${STATUSES.join('、')} 其中之一`, 'status');
  }
  return status;
}

function validateFileType(value) {
  const fileType = pickText(value);
  if (!fileType) return FILE_TYPES[0];
  if (!FILE_TYPES.includes(fileType)) {
    throw new ApiError(400, 'FILE_TYPE_INVALID', `适用文件类型只能是 ${FILE_TYPES.join('、')} 其中之一`, 'fileType');
  }
  return fileType;
}

function validateNote(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new ApiError(400, 'NOTE_INVALID', '说明需要是文本', 'note');
  if (value.length > MAX_NOTE_LENGTH) {
    throw new ApiError(400, 'NOTE_TOO_LONG', `说明不能超过 ${MAX_NOTE_LENGTH} 个字符`, 'note');
  }
  return value.trim();
}

function sortRules(list) {
  return list.slice().sort((a, b) => {
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
}

// 规则清单：按级别、状态、适用文件类型筛选，再按编码、名称或匹配写法搜索
function listRules(options) {
  const input = options && typeof options === 'object' ? options : {};
  const level = pickText(input.level);
  const status = pickText(input.status);
  const fileType = pickText(input.fileType);
  const keyword = pickText(input.keyword).toLowerCase();
  const data = load();

  let list = data.rules;
  if (level) list = list.filter((item) => item.level === level);
  if (status) list = list.filter((item) => item.status === status);
  if (fileType) list = list.filter((item) => item.fileType === fileType || item.fileType === '全部');
  if (keyword) {
    list = list.filter((item) => item.code.toLowerCase().includes(keyword)
      || item.name.toLowerCase().includes(keyword)
      || item.pattern.toLowerCase().includes(keyword));
  }

  const usedFileTypes = Array.from(new Set(data.rules.map((item) => item.fileType)));
  return {
    rules: sortRules(list),
    levels: LEVELS.slice(),
    statuses: STATUSES.slice(),
    fileTypes: FILE_TYPES.slice(),
    usedFileTypes,
  };
}

function getRule(id) {
  const data = load();
  const found = data.rules.find((item) => item.id === id);
  if (!found) throw new ApiError(404, 'RULE_NOT_FOUND', '这条规则不存在或已被删除', '');
  return found;
}

function createRule(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const now = new Date().toISOString();
  const code = validateCode(input.code, data, '');
  const pattern = validatePattern(input.pattern);
  const created = {
    id: crypto.randomUUID(),
    code,
    name: validateName(input.name),
    level: validateLevel(input.level),
    status: validateStatus(input.status),
    fileType: validateFileType(input.fileType),
    pattern,
    allowlist: validateAllowlist(input.allowlist, pattern, code),
    note: validateNote(input.note),
    createdAt: now,
    updatedAt: now,
  };
  data.rules.push(created);
  save(data);
  return created;
}

function updateRule(id, payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const found = data.rules.find((item) => item.id === id);
  if (!found) throw new ApiError(404, 'RULE_NOT_FOUND', '这条规则不存在或已被删除', '');

  found.code = input.code === undefined ? found.code : validateCode(input.code, data, found.id);
  found.name = input.name === undefined ? found.name : validateName(input.name);
  found.level = input.level === undefined ? found.level : validateLevel(input.level);
  found.status = input.status === undefined ? found.status : validateStatus(input.status);
  found.fileType = input.fileType === undefined ? found.fileType : validateFileType(input.fileType);
  found.pattern = input.pattern === undefined ? found.pattern : validatePattern(input.pattern);
  if (input.allowlist !== undefined) {
    found.allowlist = validateAllowlist(input.allowlist, found.pattern, found.code);
  } else if (input.pattern !== undefined) {
    checkAllowlistAgainstPattern(found.allowlist, found.pattern, found.code);
  }
  found.note = input.note === undefined ? found.note : validateNote(input.note);
  found.updatedAt = new Date().toISOString();
  save(data);
  return found;
}

function deleteRule(id) {
  const data = load();
  const index = data.rules.findIndex((item) => item.id === id);
  if (index === -1) throw new ApiError(404, 'RULE_NOT_FOUND', '这条规则不存在或已被删除', '');
  const [removed] = data.rules.splice(index, 1);
  save(data);
  return { id: removed.id, code: removed.code, name: removed.name };
}

module.exports = {
  listRules,
  getRule,
  createRule,
  updateRule,
  deleteRule,
};
