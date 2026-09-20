const { load, LEVELS, STATUSES } = require('./store');
const { ApiError, pickText } = require('./errors');

// 一条规则管不管这个文件：适用文件类型写成全部的管所有文件，否则只认同类型的
function ruleAppliesToFile(rule, file) {
  return rule.fileType === '全部' || rule.fileType === file.type;
}

function levelOrder(level) {
  const index = LEVELS.indexOf(level);
  return index === -1 ? LEVELS.length : index;
}

function ignoreKeyOf(ruleId, fileId, lineNo) {
  return `${ruleId} ${fileId} ${lineNo}`;
}

function compareHits(a, b) {
  if (a.code !== b.code) return a.code < b.code ? -1 : 1;
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  return a.lineNo - b.lineNo;
}

// 扫一遍：启用的规则逐条去比对范围内的文件，得到原始命中后，
// 先按每条规则自己的允许清单排除写法，再把手动忽略的命中单独放一边，剩下的才算待处理命中
function scan(options) {
  const input = options && typeof options === 'object' ? options : {};
  const level = pickText(input.level);
  const fileId = pickText(input.fileId);
  const ruleId = pickText(input.ruleId);

  if (level && !LEVELS.includes(level)) {
    throw new ApiError(400, 'LEVEL_INVALID', `级别只能是 ${LEVELS.join('、')} 其中之一`, 'scanLevel');
  }

  const data = load();

  let scopeFile = null;
  if (fileId) {
    scopeFile = data.files.find((item) => item.id === fileId);
    if (!scopeFile) throw new ApiError(404, 'FILE_NOT_FOUND', '选中的文件不在清单里', 'scanFile');
  }

  let scopeRule = null;
  if (ruleId) {
    scopeRule = data.rules.find((item) => item.id === ruleId);
    if (!scopeRule) throw new ApiError(404, 'RULE_NOT_FOUND', '选中的规则不在清单里', 'scanRule');
  }

  const enabled = data.rules.filter((item) => item.status === STATUSES[0]);
  const warning = scopeRule && scopeRule.status !== STATUSES[0]
    ? `${scopeRule.code} 当前是停用状态，这一轮不参与比对`
    : '';

  const rulesUsed = enabled
    .filter((item) => !scopeRule || item.id === scopeRule.id)
    .filter((item) => !level || item.level === level);

  const filesInScope = scopeFile ? [scopeFile] : data.files;

  // 每条规则的允许写法按登记顺序收好；允许判断只认命中所属规则自己这一份
  const allowsIndex = new Map();
  data.rules.forEach((rule) => {
    const entries = data.allows
      .filter((item) => item.ruleId === rule.id)
      .map((item) => ({ id: item.id, text: item.text }));
    if (entries.length) allowsIndex.set(rule.id, entries);
  });

  const ignoresMap = new Map();
  data.ignores.forEach((item) => {
    ignoresMap.set(ignoreKeyOf(item.ruleId, item.fileId, item.lineNo), item);
  });

  // 原始命中：口径与以前一致（区分大小写的子串、每行每条规则至多一条），rawLine 留着给允许清单按原文判断
  const rawHits = [];
  rulesUsed.forEach((rule) => {
    filesInScope.filter((file) => ruleAppliesToFile(rule, file)).forEach((file) => {
      file.content.split('\n').forEach((text, index) => {
        if (text.includes(rule.pattern)) {
          rawHits.push({
            ruleId: rule.id,
            code: rule.code,
            ruleName: rule.name,
            level: rule.level,
            pattern: rule.pattern,
            fileId: file.id,
            path: file.path,
            fileType: file.type,
            lineNo: index + 1,
            lineText: text.trim(),
            rawLine: text,
          });
        }
      });
    });
  });

  rawHits.sort(compareHits);

  const hits = [];
  const excludedHits = [];
  const ignoredHits = [];
  const excludedCountMap = new Map();

  rawHits.forEach((raw) => {
    const base = {
      ruleId: raw.ruleId,
      code: raw.code,
      ruleName: raw.ruleName,
      level: raw.level,
      pattern: raw.pattern,
      fileId: raw.fileId,
      path: raw.path,
      fileType: raw.fileType,
      lineNo: raw.lineNo,
      lineText: raw.lineText,
    };

    const entries = allowsIndex.get(raw.ruleId) || [];
    let matched = -1;
    for (let index = 0; index < entries.length; index += 1) {
      if (raw.rawLine.includes(entries[index].text)) { matched = index; break; }
    }

    if (matched !== -1) {
      const entry = entries[matched];
      excludedHits.push({ ...base, allowId: entry.id, allowText: entry.text, allowOrder: matched + 1 });
      excludedCountMap.set(entry.id, (excludedCountMap.get(entry.id) || 0) + 1);
      return;
    }

    const ignored = ignoresMap.get(ignoreKeyOf(raw.ruleId, raw.fileId, raw.lineNo));
    if (ignored) {
      ignoredHits.push({ ...base, ignoreId: ignored.id, ignoredAt: ignored.createdAt });
      return;
    }

    hits.push(base);
  });

  // 按规则汇总：原始命中、待处理、允许排除、已忽略各有多少（一条不剩地全记下）
  const byRuleMap = new Map();
  rawHits.forEach((hit) => {
    if (!byRuleMap.has(hit.code)) {
      byRuleMap.set(hit.code, { code: hit.code, ruleName: hit.ruleName, level: hit.level, count: 0, rawCount: 0, excludedCount: 0, ignoredCount: 0 });
    }
    byRuleMap.get(hit.code).rawCount += 1;
  });
  hits.forEach((hit) => { byRuleMap.get(hit.code).count += 1; });
  excludedHits.forEach((hit) => { byRuleMap.get(hit.code).excludedCount += 1; });
  ignoredHits.forEach((hit) => { byRuleMap.get(hit.code).ignoredCount += 1; });

  // 按文件汇总，口径同上
  const byFileMap = new Map();
  rawHits.forEach((hit) => {
    if (!byFileMap.has(hit.path)) {
      byFileMap.set(hit.path, { path: hit.path, fileType: hit.fileType, count: 0, rawCount: 0, excludedCount: 0, ignoredCount: 0 });
    }
    byFileMap.get(hit.path).rawCount += 1;
  });
  hits.forEach((hit) => { byFileMap.get(hit.path).count += 1; });
  excludedHits.forEach((hit) => { byFileMap.get(hit.path).excludedCount += 1; });
  ignoredHits.forEach((hit) => { byFileMap.get(hit.path).ignoredCount += 1; });

  const byLevel = {};
  LEVELS.forEach((item) => { byLevel[item] = 0; });
  hits.forEach((hit) => { byLevel[hit.level] += 1; });

  // 每种允许写法本轮各排除了多少条；这一轮没排到的也明确给 0
  const allowStats = data.rules
    .filter((rule) => allowsIndex.has(rule.id))
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
    .map((rule) => ({
      ruleId: rule.id,
      code: rule.code,
      entries: allowsIndex.get(rule.id).map((entry, index) => ({
        id: entry.id,
        text: entry.text,
        order: index + 1,
        excludedCount: excludedCountMap.get(entry.id) || 0,
      })),
    }));

  // 已忽略清单只给本轮范围里的记录（选中的规则与文件），范围外的不在这一页出现
  const scopeRuleIds = new Set(rulesUsed.map((item) => item.id));
  const scopeFileIds = new Set(filesInScope.map((item) => item.id));
  const sortedIgnores = data.ignores
    .filter((item) => scopeRuleIds.has(item.ruleId) && scopeFileIds.has(item.fileId))
    .sort(compareHits);

  return {
    scannedAt: new Date().toISOString(),
    enabledRules: enabled.length,
    rulesUsed: rulesUsed.length,
    filesInScope: filesInScope.length,
    filesTotal: data.files.length,
    rulesTotal: data.rules.length,
    warning,
    hits,
    excludedHits,
    ignoredHits,
    ignores: sortedIgnores,
    allowStats,
    summary: {
      total: hits.length,
      rawTotal: rawHits.length,
      excludedTotal: excludedHits.length,
      ignoredTotal: ignoredHits.length,
      byLevel,
      byRule: Array.from(byRuleMap.values()).sort((a, b) => (a.code < b.code ? -1 : 1)),
      byFile: Array.from(byFileMap.values()).sort((a, b) => (a.path < b.path ? -1 : 1)),
    },
  };
}

module.exports = { scan, ruleAppliesToFile, levelOrder };
