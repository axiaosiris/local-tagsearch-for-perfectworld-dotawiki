/* search-core.js —— 检索核心逻辑（浏览器 / Node 通用，无依赖）
 *
 * 两条**完全独立**的检索线（同一时间界面只展示其中一条）：
 *   A. Tag 检索 —— 按标签（tag）匹配技能的类型 / 效果 / 特性 / tags 字段
 *   B. 注释检索 —— 在技能注释（skill_notes 富文本转成的纯文本行）中查找关键词
 *
 * A 的条件模型：
 *   and: [tagName…] 必须全部包含（且）
 *   or : [tagName…] 至少包含其一（或）——为空则不参与判断
 *   not: [tagName…] 全部不得包含（反选/排除）
 *   scope: {d:技能类型, e:技能效果, m:技能特性, g:tags字段}
 *   includeExcluded: 是否把「废弃/自定义/公式残条」条目也纳入检索（默认 false，即排除）
 * 同名 tag 可能存在于多个档位（如「友方防御塔」有 目标/神杖/魔晶/天赋 四档）→ 命中任一档即算包含。
 * 技能特性（skill_mechanism）除词条外还有「特性内容」（mechanism_input）：
 *   数据侧池化为 featText = {tagId:[文本…]}，技能侧 f = 与 m 同序的池下标，
 *   命中特性时一并返回内容（feats），供详细展示。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.TagSearch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  /* ---------- 默认排除的非技能条目 ----------
   * 这三类不是正常技能条目，检索时默认跳过（可在界面勾选「包含被排除项」临时放回）：
   *   noUse  —— 废弃条目：名称含「废」（如「贪魔的贪婪（废）」）
   *   custom —— 自定义技能：id ≥ 20000（站内「自」标条目，非官方技能）
   *   junk   —— 公式残条：名称以「-{」开头（数据里残留的模板片段，如「-{s:value}秒 雪球冷却」）
   * 互斥判定，按上述顺序取第一个命中项，故各类计数之和 = 被排除总数。 */
  var CUSTOM_ID_MIN = 20000;
  var EXCLUDE_KINDS = [
    { key: 'noUse', label: '废弃条目', tip: '名称含「废」' },
    { key: 'custom', label: '自定义技能', tip: 'id ≥ ' + CUSTOM_ID_MIN },
    { key: 'junk', label: '公式残条', tip: '名称以「-{」开头' }
  ];

  /** 返回该技能被排除的原因 key（不排除则 null） */
  function excludeKind(a) {
    if (!a) return null;
    var n = String(a.n == null ? '' : a.n);
    if (n.indexOf('废') >= 0) return 'noUse';
    if (n.indexOf('-{') === 0) return 'junk';
    if (a.i >= CUSTOM_ID_MIN) return 'custom';
    return null;
  }

  function createIndex(db) {
    var id2tag = new Map();
    var name2ids = new Map();
    (db.tags || []).forEach(function (t) {
      id2tag.set(t.id, t);
      var arr = name2ids.get(t.name);
      if (!arr) { arr = []; name2ids.set(t.name, arr); }
      if (arr.indexOf(t.id) < 0) arr.push(t.id);
    });
    var names = Array.from(name2ids.keys()).sort(function (a, b) {
      return String(a).localeCompare(String(b), 'zh-Hans-CN');
    });
    var abilities = db.abilities || [];
    var excludedBy = { noUse: 0, custom: 0, junk: 0 };
    abilities.forEach(function (a) { var k = excludeKind(a); if (k) excludedBy[k]++; });
    var excludedTotal = excludedBy.noUse + excludedBy.custom + excludedBy.junk;
    return {
      db: db,
      id2tag: id2tag,
      name2ids: name2ids,
      names: names,
      abilities: abilities,
      featText: db.featText || {},
      notePool: db.notePool || [],
      excludedBy: excludedBy,
      excludedTotal: excludedTotal,
      fetchedAt: db.fetchedAt || ''
    };
  }

  /** 某技能的特性内容数组（与 a.m 同序；无内容为空字符串） */
  function featTexts(index, a) {
    var pool = (index && index.featText) || {};
    var slot = (a && a.f) || [];
    return ((a && a.m) || []).map(function (id, k) {
      var vi = slot[k];
      var list = pool[id];
      if (vi == null || vi < 0 || !list || list[vi] == null) return '';
      return list[vi];
    });
  }

  /** 某技能的全部技能特性：[{id, name, text, c1, c2}] */
  function featsOf(index, a) {
    var texts = featTexts(index, a);
    var id2tag = (index && index.id2tag) || new Map();
    return ((a && a.m) || []).map(function (id, k) {
      var t = id2tag.get(id);
      return {
        id: id,
        name: t ? t.name : '未知 tag ' + id,
        text: texts[k] || '',
        c1: t ? t.c1 : '',
        c2: t ? t.c2 : ''
      };
    });
  }

  /* ---------- 技能注释 ----------
   * 数据侧：build_data.py 把 skill_notes 富文本转成「纯文本行」并按行去重成
   *   全局行池 notePool = [行文本…]，技能侧 nt = 行池下标数组、ni = 与之等长的缩进层级。
   * 命中行号按技能内顺序 1 起计（与网页注释的行序一致，供人工回查）。 */

  /** 某技能的注释行：[{n:行号, t:文本, ind:缩进层级}] */
  function noteLines(index, a) {
    var pool = (index && index.notePool) || [];
    var nt = (a && a.nt) || [];
    var ni = (a && a.ni) || [];
    var out = [];
    for (var k = 0; k < nt.length; k++) {
      var t = pool[nt[k]];
      if (t == null) continue;
      out.push({ n: k + 1, t: t, ind: ni[k] || 0 });
    }
    return out;
  }

  /** 注释数据概况：{pool:行池大小, skills:带注释的技能数} —— 旧数据（无 notePool）返回 0 */
  function noteStats(index) {
    var pool = (index && index.notePool) || [];
    var skills = 0;
    ((index && index.abilities) || []).forEach(function (a) { if ((a.nt || []).length) skills++; });
    return { pool: pool.length, skills: skills };
  }

  /** 注释检索（与 tag 检索完全独立）
   * query = {q:'查找内容', includeExcluded:bool}
   *   多个词用空白分隔 → 需全部出现（AND），英文不区分大小写。
   * 命中项：{id,name,en,ability,upgrades,excluded,lines[{n,t,ind,hit}],matched,count,noteCount}
   * 排序：命中行数 ↓ → 词频 ↓ → id ↓ */
  function searchNotes(index, query) {
    query = query || {};
    var terms = String(query.q == null ? '' : query.q).split(/\s+/)
      .map(function (s) { return s.trim(); }).filter(Boolean);
    var lows = terms.map(function (s) { return s.toLowerCase(); });
    var showExcluded = !!query.includeExcluded;
    var hits = [];
    var skipped = 0;
    var base = {
      terms: terms,
      hits: hits,
      scanned: index.abilities.length,
      stats: {
        total: index.abilities.length,
        excludedTotal: index.excludedTotal || 0,
        excludedBy: index.excludedBy || { noUse: 0, custom: 0, junk: 0 },
        skipped: 0,
        effective: index.abilities.length - (index.excludedTotal || 0),
        includeExcluded: showExcluded,
        noteSkills: noteStats(index).skills
      }
    };
    if (!lows.length) return base;

    index.abilities.forEach(function (a) {
      var ex = excludeKind(a);
      if (ex && !showExcluded) { skipped++; return; }
      var lines = noteLines(index, a);
      if (!lines.length) return;
      var full = lines.map(function (l) { return l.t; }).join('\n').toLowerCase();
      var count = 0;
      for (var i = 0; i < lows.length; i++) {
        var q = lows[i], from = 0, c = 0, p;
        while ((p = full.indexOf(q, from)) >= 0) { c++; from = p + q.length; }
        if (!c) return;                        // 任一词未出现 → 不命中（AND）
        count += c;
      }
      var matched = 0;
      var ls = lines.map(function (l) {
        var lo = l.t.toLowerCase();
        var hit = false;
        for (var j = 0; j < lows.length; j++) { if (lo.indexOf(lows[j]) >= 0) { hit = true; break; } }
        if (hit) matched++;
        return { n: l.n, t: l.t, ind: l.ind, hit: hit };
      });
      hits.push({
        id: a.i, name: a.n, en: a.en, ability: a, upgrades: upgrades(a),
        excluded: ex || null, lines: ls, matched: matched, count: count, noteCount: ls.length
      });
    });

    hits.sort(function (x, y) {
      return (y.matched - x.matched) || (y.count - x.count) || (y.id - x.id);
    });
    base.stats.skipped = skipped;
    return base;
  }

  function normalizeScope(scope) {
    scope = scope || {};
    return {
      d: scope.d !== false,
      e: scope.e !== false,
      m: scope.m !== false,
      g: scope.g !== false
    };
  }

  /** 按匹配范围收集某技能的全部 tag id */
  function tagSet(a, scope) {
    scope = normalizeScope(scope);
    var s = new Set();
    if (scope.d) (a.d || []).forEach(function (x) { s.add(x); });
    if (scope.g) (a.g || []).forEach(function (x) { s.add(x); });
    if (scope.m) (a.m || []).forEach(function (x) { s.add(x); });
    if (scope.e) (a.e || []).forEach(function (row) { (row.t || []).forEach(function (x) { s.add(x); }); });
    return s;
  }

  /** 某组 tag ids 在该技能中的命中位置（人类可读）；命中技能特性时附带其内容 */
  function locations(a, ids, scope, index) {
    scope = normalizeScope(scope);
    var want = new Set(ids);
    var hit = function (x) { return want.has(x); };
    var out = [];
    if (scope.d && (a.d || []).some(hit)) out.push({ where: '技能类型', kind: 'd' });
    if (scope.m && (a.m || []).some(hit)) {
      var fs = index ? featsOf(index, a).filter(function (f) { return want.has(f.id); }) : [];
      out.push({ where: '技能特性', kind: 'm', feats: fs });
    }
    if (scope.g && (a.g || []).some(hit)) out.push({ where: 'tags字段', kind: 'g' });
    if (scope.e) {
      (a.e || []).forEach(function (row, i) {
        if ((row.t || []).some(hit)) {
          out.push({ where: '效果' + (i + 1) + (row.n ? '「' + row.n + '」' : ''), kind: 'e', row: i + 1 });
        }
      });
    }
    return out;
  }

  /** 把用户输入解析为 tag id 集合：精确优先，未命中则按子串匹配（如「防御塔」→ 友方/敌方防御塔） */
  function resolveName(index, raw, fuzzy) {
    var n = String(raw || '').trim();
    if (!n) return null;
    var exactIds = index.name2ids.get(n);
    if (exactIds && !fuzzy) {
      return { input: n, names: [n], ids: exactIds.slice(), exact: true };
    }
    var hits = index.names.filter(function (x) { return x.indexOf(n) >= 0; });
    if (!hits.length) {
      if (exactIds) return { input: n, names: [n], ids: exactIds.slice(), exact: true };
      return { input: n, names: [], ids: null, exact: false };
    }
    var ids = [];
    hits.forEach(function (x) {
      index.name2ids.get(x).forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); });
    });
    return { input: n, names: hits, ids: ids, exact: (hits.length === 1 && hits[0] === n) };
  }

  /* ---------- 升级项（升级来源） ----------
   * 后台「Tag 管理 → 升级 / 升级来源」共 13 条，作为 tag 挂在技能效果行的 effect_tag 上
   * （少量出现在 tags 字段）。此处按固定顺序汇总、去重，供展示用。 */
  var UPGRADE_ORDER = [1046, 1047, 1048, 1049, 1050, 1051, 1052, 1053, 1054, 1055, 1056, 1101, 1165];
  /* label = 界面显示的中文名（= 网页条目名去掉尾缀「升级」）
   * ph  = wiki 占位符本体（{%id%}，注释里写 {%id%}升级后/前）——不显示，只进 title / CSV
   * img = 本地图标（icons/<id>.png，取自 wiki 资源，40×40 / 64×64 PNG）+ cdn 在线回退
   * 1056/1101/1165 在 wiki 中为纯色标签（无图标），用 color 填充色块 */
  var UPGRADE_META = {
    1046: { full: '神杖升级', label: '神杖', cls: 'sce', ph: '{%1046%}', img: 'icons/1046.png', cdn: 'https://img.dota2.com.cn/dota2wiki/745544e7-dca6-4fca-89b6-f3c085bb4488.png' },
    1047: { full: '魔晶升级', label: '魔晶', cls: 'sha', ph: '{%1047%}', img: 'icons/1047.png', cdn: 'https://img.dota2.com.cn/dota2wiki/038c5bb4-6b7d-4e59-bdbd-33d3436b0244.png' },
    1048: { full: '10级左天赋升级', label: '10级左天赋', cls: 'tal', ph: '{%1048%}', img: 'icons/1048.png', cdn: 'https://img.dota2.com.cn/dota2wiki/00ce85c6-3339-4f23-b067-6c5ee1716b79.png' },
    1049: { full: '10级右天赋升级', label: '10级右天赋', cls: 'tal', ph: '{%1049%}', img: 'icons/1049.png', cdn: 'https://img.dota2.com.cn/dota2wiki/b7a33bd8-7f62-4002-aac5-07a7f6175934.png' },
    1050: { full: '15级左天赋升级', label: '15级左天赋', cls: 'tal', ph: '{%1050%}', img: 'icons/1050.png', cdn: 'https://img.dota2.com.cn/dota2wiki/0feea1e6-22d5-4f3f-b3f8-a0fb2266b092.png' },
    1051: { full: '15级右天赋升级', label: '15级右天赋', cls: 'tal', ph: '{%1051%}', img: 'icons/1051.png', cdn: 'https://img.dota2.com.cn/dota2wiki/5fc33aee-ff00-4e26-82c4-79db13c521b1.png' },
    1052: { full: '20级左天赋升级', label: '20级左天赋', cls: 'tal', ph: '{%1052%}', img: 'icons/1052.png', cdn: 'https://img.dota2.com.cn/dota2wiki/e2598fd5-1511-4fad-853f-7698b72f41cc.png' },
    1053: { full: '20级右天赋升级', label: '20级右天赋', cls: 'tal', ph: '{%1053%}', img: 'icons/1053.png', cdn: 'https://img.dota2.com.cn/dota2wiki/7596cb10-78eb-49e3-8d29-ab61cbd4a9f1.png' },
    1054: { full: '25级左天赋升级', label: '25级左天赋', cls: 'tal', ph: '{%1054%}', img: 'icons/1054.png', cdn: 'https://img.dota2.com.cn/dota2wiki/685d6bc2-0040-4a1c-b4f2-ed5ddf07d6d2.png' },
    1055: { full: '25级右天赋升级', label: '25级右天赋', cls: 'tal', ph: '{%1055%}', img: 'icons/1055.png', cdn: 'https://img.dota2.com.cn/dota2wiki/944c2842-7fd4-4a4e-8e51-a5138ab6337c.png' },
    1056: { full: '其他技能来源升级', label: '其他技能来源', cls: 'oth', ph: '{%1056%}', color: '#0080FF' },
    1101: { full: '饰品专属', label: '饰品专属', cls: 'acc', ph: '{%1101%}', color: '#B0B848' },
    1165: { full: '命石升级', label: '命石', cls: 'fac', ph: '{%1165%}', color: '#FF0080' }
  };

  /** 某技能涉及的升级项 id 列表（固定顺序）；scope 不影响它 */
  function upgrades(a) {
    var s = new Set();
    (a.d || []).forEach(function (x) { s.add(x); });
    (a.g || []).forEach(function (x) { s.add(x); });
    (a.e || []).forEach(function (row) { (row.t || []).forEach(function (x) { s.add(x); }); });
    return UPGRADE_ORDER.filter(function (id) { return s.has(id); });
  }

  function search(index, query) {
    var scope = normalizeScope(query.scope);
    var fuzzy = !!query.fuzzy;
    var andNames = (query.and || []).map(function (s) { return String(s || '').trim(); }).filter(Boolean);
    var orNames = (query.or || []).map(function (s) { return String(s || '').trim(); }).filter(Boolean);
    var notNames = (query.not || []).map(function (s) { return String(s || '').trim(); }).filter(Boolean);

    var rAnd = andNames.map(function (n) { return resolveName(index, n, fuzzy); });
    var rOr = orNames.map(function (n) { return resolveName(index, n, fuzzy); });
    var rNot = notNames.map(function (n) { return resolveName(index, n, fuzzy); });
    var andIds = rAnd.map(function (r) { return r && r.ids; });
    var orIds = rOr.map(function (r) { return r && r.ids; });
    var notIds = rNot.map(function (r) { return r && r.ids; });

    var unknown = [];
    [rAnd, rOr, rNot].forEach(function (list) {
      list.forEach(function (r) { if (r && !r.ids) unknown.push(r.input); });
    });

    var hasId = function (set, ids) { return ids.some(function (id) { return set.has(id); }); };
    var hits = [];
    var showExcluded = !!query.includeExcluded;
    var skipped = 0;

    index.abilities.forEach(function (a) {
      var ex = excludeKind(a);
      if (ex && !showExcluded) { skipped++; return; }
      var set = tagSet(a, scope);
      var i;
      for (i = 0; i < andIds.length; i++) {
        if (andIds[i] && !hasId(set, andIds[i])) return;
      }
      if (orIds.length) {
        var okOr = false;
        for (i = 0; i < orIds.length; i++) {
          if (orIds[i] && hasId(set, orIds[i])) { okOr = true; break; }
        }
        if (!okOr) return;
      }
      for (i = 0; i < notIds.length; i++) {
        if (notIds[i] && hasId(set, notIds[i])) return;
      }
      var detail = [];
      rAnd.forEach(function (r, k) {
        if (r && r.ids) detail.push({ group: 'and', name: r.input, names: r.names, ids: r.ids, loc: locations(a, r.ids, scope, index) });
      });
      rOr.forEach(function (r, k) {
        if (r && r.ids && hasId(set, r.ids)) detail.push({ group: 'or', name: r.input, names: r.names, ids: r.ids, loc: locations(a, r.ids, scope, index) });
      });
      // 被任一条件命中的技能特性（带内容），供详细展示
      var hitIds = [];
      detail.forEach(function (d) {
        (d.ids || []).forEach(function (x) { if (hitIds.indexOf(x) < 0) hitIds.push(x); });
      });
      var feats = featsOf(index, a).filter(function (f) {
        return hitIds.indexOf(f.id) >= 0 && f.text;
      });
      hits.push({
        id: a.i, name: a.n, en: a.en, tagCount: set.size, detail: detail, feats: feats,
        ability: a, upgrades: upgrades(a), excluded: ex || null
      });
    });

    hits.sort(function (x, y) { return y.id - x.id; });
    return {
      hits: hits,
      unknown: unknown,
      resolutions: { and: rAnd, or: rOr, not: rNot },
      scanned: index.abilities.length,
      stats: {
        total: index.abilities.length,
        excludedTotal: index.excludedTotal || 0,
        excludedBy: index.excludedBy || { noUse: 0, custom: 0, junk: 0 },
        skipped: skipped,
        effective: index.abilities.length - (index.excludedTotal || 0),
        includeExcluded: showExcluded
      }
    };
  }

  /** 列出某技能的全部 tag（按来源分组，供详情面板用） */
  function describe(index, a, scope) {
    scope = normalizeScope(scope);
    var nm = function (id) { var t = index.id2tag.get(id); return t ? { id: id, name: t.name, c1: t.c1, c2: t.c2 } : { id: id, name: '未知 tag ' + id, c1: '', c2: '' }; };
    var uniq = function (ids) { var seen = {}; return (ids || []).filter(function (id) { if (seen[id]) return false; seen[id] = 1; return true; }).map(nm); };
    var out = { detail: [], mech: [], tags: [], effects: [], upgrades: upgrades(a) };
    if (scope.d) out.detail = uniq(a.d);
    if (scope.m) {
      var seenM = {};
      out.mech = featsOf(index, a).filter(function (f) {
        if (seenM[f.id]) return false;
        seenM[f.id] = 1;
        return true;
      });
    }
    if (scope.g) out.tags = uniq(a.g);
    if (scope.e) out.effects = (a.e || []).map(function (row) { return { name: row.n, tags: uniq(row.t) }; });
    return out;
  }

  return {
    createIndex: createIndex,
    search: search,
    searchNotes: searchNotes,
    noteLines: noteLines,
    noteStats: noteStats,
    tagSet: tagSet,
    locations: locations,
    describe: describe,
    resolveName: resolveName,
    upgrades: upgrades,
    excludeKind: excludeKind,
    featsOf: featsOf,
    featTexts: featTexts,
    EXCLUDE_KINDS: EXCLUDE_KINDS,
    CUSTOM_ID_MIN: CUSTOM_ID_MIN,
    UPGRADE_META: UPGRADE_META,
    UPGRADE_ORDER: UPGRADE_ORDER
  };
});
