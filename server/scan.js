const { load, LEVELS, STATUSES } = require('./store');
const { ApiError, pickText } = require('./errors');

// 一条规则管不管这个文件：适用文件类型写成全部的管所有文件，否则只认同类型的
function ruleAppliesToFile(rule, file) {
  return rule.fileType === '全部' || rule.fileType === file.type;
}

// 这一行被这条规则的允许清单里哪一条写法挡下了；只看本规则自己的清单，别的规则的清单管不到这里
function allowedBy(rule, text) {
  const list = Array.isArray(rule.allowlist) ? rule.allowlist : [];
  return list.find((entry) => entry && text.includes(entry));
}

function levelOrder(level) {
  const index = LEVELS.indexOf(level);
  return index === -1 ? LEVELS.length : index;
}

// 扫一遍：启用的规则逐条去比对范围内的文件，命中记到具体行上；
// 被规则自己的允许清单挡下的行不算命中，单独记成忽略项
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

  const hits = [];
  const ignored = [];
  rulesUsed.forEach((rule) => {
    filesInScope.filter((file) => ruleAppliesToFile(rule, file)).forEach((file) => {
      file.content.split('\n').forEach((text, index) => {
        if (!text.includes(rule.pattern)) return;
        const record = {
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
        };
        const allowPattern = allowedBy(rule, text);
        if (allowPattern === undefined) {
          hits.push(record);
        } else {
          ignored.push({ ...record, allowPattern });
        }
      });
    });
  });

  const byPosition = (a, b) => {
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    return a.lineNo - b.lineNo;
  };
  hits.sort(byPosition);
  ignored.sort(byPosition);

  const byLevel = {};
  LEVELS.forEach((item) => { byLevel[item] = 0; });
  hits.forEach((hit) => { byLevel[hit.level] += 1; });

  const byRuleMap = new Map();
  hits.forEach((hit) => {
    const key = hit.code;
    if (!byRuleMap.has(key)) {
      byRuleMap.set(key, { code: hit.code, ruleName: hit.ruleName, level: hit.level, count: 0 });
    }
    byRuleMap.get(key).count += 1;
  });

  const byFileMap = new Map();
  hits.forEach((hit) => {
    const key = hit.path;
    if (!byFileMap.has(key)) byFileMap.set(key, { path: hit.path, fileType: hit.fileType, count: 0 });
    byFileMap.get(key).count += 1;
  });

  // 忽略项按规则汇总：这条规则一共排除了几种写法、每一种排除了多少条
  const ignoredByRuleMap = new Map();
  ignored.forEach((item) => {
    const key = item.code;
    if (!ignoredByRuleMap.has(key)) {
      ignoredByRuleMap.set(key, { code: item.code, ruleName: item.ruleName, level: item.level, count: 0, patternMap: new Map() });
    }
    const bucket = ignoredByRuleMap.get(key);
    bucket.count += 1;
    bucket.patternMap.set(item.allowPattern, (bucket.patternMap.get(item.allowPattern) || 0) + 1);
  });
  const ignoredByRule = Array.from(ignoredByRuleMap.values())
    .map((bucket) => ({
      code: bucket.code,
      ruleName: bucket.ruleName,
      level: bucket.level,
      count: bucket.count,
      patterns: Array.from(bucket.patternMap.entries())
        .map(([pattern, count]) => ({ pattern, count }))
        .sort((a, b) => (a.pattern < b.pattern ? -1 : 1)),
    }))
    .sort((a, b) => (a.code < b.code ? -1 : 1));

  return {
    scannedAt: new Date().toISOString(),
    enabledRules: enabled.length,
    rulesUsed: rulesUsed.length,
    filesInScope: filesInScope.length,
    filesTotal: data.files.length,
    rulesTotal: data.rules.length,
    warning,
    hits,
    ignored,
    summary: {
      total: hits.length,
      byLevel,
      byRule: Array.from(byRuleMap.values()).sort((a, b) => (a.code < b.code ? -1 : 1)),
      byFile: Array.from(byFileMap.values()).sort((a, b) => (a.path < b.path ? -1 : 1)),
      ignored: {
        total: ignored.length,
        byRule: ignoredByRule,
      },
    },
  };
}

module.exports = { scan, ruleAppliesToFile, levelOrder };
