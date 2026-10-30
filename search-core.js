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
 *   matchUnit: 匹配粒度（默认 true）——分两类 tag 判定：
 *        ①「效果类」tag（tag 管理里 机制-包含效果 及其同级效果组：包含效果/状态效果/
 *          驱散情况/减益免疫/叠加方式/伤害类型…）→ 必须**落在同一个效果条目里**；
 *          例：且=[弱驱散, 眩晕] 只命中「某个效果里同时有这两个 tag」的技能，
 *          「效果2有弱驱散、效果1有眩晕」不再算命中（或 / 反选同理）。
 *        ②「技能级」tag（技能类型 / 技能特性的类别：点目标、主动、会被破坏…）→
 *          可以跨效果、跨类型、跨特性，在整个技能里满足即可。
 *        false = 旧口径（整技能的 tag 并集判断）。
 *   scope: {d:技能类型, e:技能效果, m:技能特性, g:tags字段}
 *   includeExcluded: 是否把「废弃/自定义/公式残条」条目也纳入检索（默认 false，即排除）
 *   cast: {min, max} 施法前摇闭区间（秒，null=该侧不限）——与 tag 条件**同时生效**，
 *         数据来自后台 ability_cast_point（注意 _back 后缀的是「施法后摇」）；
 *         无前摇数据的技能在启用该条件时不参与命中（统计在 stats.cast.missing）。
 *   heroes: [英雄 id…] 英雄筛选（来自「内容管理-英雄数据」全量名册）——勾选后只保留
 *         这些英雄的**现版本技能**（并集）；不勾选 = 全部。技能的所属英雄见 a.h，
 *         构建阶段**只取**该英雄的 ability_map（即英雄数据页「人工处理数据 → 技能」列表），
 *         不做英文名推断；技能总表里残留的旧版本技能/废弃天赋登记不到任何英雄，
 *         启用英雄筛选时不会被命中（统计在 stats.hero.out）。
 *   sources: [来源 key…] 技能来源筛选（数据类别，见下方 SOURCES 登记表）——只保留所选来源的
 *         技能（并集）。技能侧来源看 a.src，**缺省视为 'hero'**（现版本英雄技能），故旧数据
 *         不写 src 即全部归入英雄技能。今后并入物品技能 / 非英雄单位技能时给技能写 src 即可。
 *         未勾选任何来源 = 不过滤（界面会拦住）；只勾了部分来源时统计在 stats.src.out。
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
   *   noUse  —— 废弃条目：名称带「（废）」标记（如「贪魔的贪婪（废）」）；⚠️ 不能只判「含废字」，
   *             物品技能里有正常的「残废」会被误伤
   *   custom —— 自定义技能：id ≥ 20000（站内「自」标条目，非官方技能）
   *   junk   —— 公式残条：名称以「-{」开头（数据里残留的模板片段，如「-{s:value}秒 雪球冷却」）
   * 互斥判定，按上述顺序取第一个命中项，故各类计数之和 = 被排除总数。 */
  var CUSTOM_ID_MIN = 20000;
  var EXCLUDE_KINDS = [
    { key: 'noUse', label: '废弃条目', tip: '名称带「（废）」标记' },
    { key: 'custom', label: '自定义技能', tip: 'id ≥ ' + CUSTOM_ID_MIN },
    { key: 'junk', label: '公式残条', tip: '名称以「-{」开头' }
  ];

  /** 返回该技能被排除的原因 key（不排除则 null） */
  function excludeKind(a) {
    if (!a) return null;
    var n = String(a.n == null ? '' : a.n);
    // 只认「（废）」这个后台标记（如「贪魔的贪婪（废）」）——
    // 不能只看含「废」字：物品技能里有正常的「残废」，会被误判成废弃条目
    if (/[（(]废/.test(n)) return 'noUse';
    if (n.indexOf('-{') === 0) return 'junk';
    if (a.i >= CUSTOM_ID_MIN) return 'custom';
    return null;
  }

  /* ---------- 技能来源（数据类别）----------
   * 检索库今后不只有英雄技能：物品技能、非英雄单位技能等会陆续并入同一份数据。
   * 约定：技能对象用 src 字段标注来源，**缺省（无 src）= 'hero'**，所以现有 data.js
   * 无需改造就全部算「现版本英雄技能」。新增一类来源只需两步：
   *   ① 在本登记表加一行、把 ready 改为 true（界面按此表自动渲染勾选项）；
   *   ② 构建阶段给该来源的技能写入 src（build_data.py）。
   * ready:false 的条目只是占位，界面不显示。 */
  var SOURCES = [
    { key: 'hero', label: '现版本英雄技能', ready: true,
      tip: '后台「英雄数据 → 人工处理数据 → 技能」的现版本技能（含技能总表里残留的旧版本条目）' },
    { key: 'item', label: '物品技能', ready: true,
      tip: '道具附带的技能（后台「内容管理 → 道具技能」），与英雄技能共用同一套标签；无英雄归属' },
    { key: 'creep', label: '非英雄单位技能', ready: false,
      tip: '野怪 / 小兵 / 召唤物 / Boss 的技能——数据尚未接入' }
  ];
  var SRC_DEFAULT = 'hero';

  /** 某技能的来源 key（无 src 字段 = 英雄技能） */
  function srcOf(a) { return String((a && a.src) || SRC_DEFAULT); }

  /** 归一化来源 key 数组（去空、去重） */
  function normSources(list) {
    var out = [];
    (list || []).forEach(function (v) {
      var k = String(v == null ? '' : v).trim();
      if (k && out.indexOf(k) < 0) out.push(k);
    });
    return out;
  }

  /** 该技能是否属于所选来源之一 */
  function hasSource(a, srcSet) { return srcSet.has(srcOf(a)); }

  function sourcePoolSize(index, srcSet) {
    if (!srcSet || !srcSet.size) return 0;
    var n = 0;
    (index.abilities || []).forEach(function (a) { if (hasSource(a, srcSet)) n++; });
    return n;
  }

  /** 统一构造 stats.src：on = 确实缩小了范围（只勾了数据里的部分来源） */
  function sourceStats(index, keys, out) {
    var all = (index && index.sources) || [];
    var on = keys.length > 0 && all.some(function (k) { return keys.indexOf(k) < 0; });
    return {
      on: !!on, keys: keys.slice(), all: all.slice(), out: out || 0,
      pool: sourcePoolSize(index, new Set(keys))
    };
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

    /* 英雄名册（内容管理-英雄数据）：heroes = [{i,zh,en,a}]，技能侧 a.h = 所属英雄 id 数组 */
    var heroes = db.heroes || [];
    var id2hero = new Map();
    heroes.forEach(function (h) { if (h && h.i != null) id2hero.set(h.i, h); });
    var heroSkills = new Map();      // 英雄 id → 归属技能条数（含被排除项）
    var heroSkillsValid = new Map();  // 英雄 id → 归属技能条数（不含被排除项）
    var heroedSkills = 0;            // 有英雄归属的技能条数
    var unexplainedSkills = 0;       // 无任何英雄归属的技能条数
    abilities.forEach(function (a) {
      var hs = a.h || [];
      var bad = excludeKind(a) ? 1 : 0;
      if (hs.length) heroedSkills++; else unexplainedSkills++;
      hs.forEach(function (id) {
        heroSkills.set(id, (heroSkills.get(id) || 0) + 1);
        if (!bad) heroSkillsValid.set(id, (heroSkillsValid.get(id) || 0) + 1);
      });
    });
    /* 技能来源（数据类别）：a.src，缺省 = 'hero' */
    var sources = [];                        // 数据里实际出现的来源 key（按出现顺序）
    var sourceCount = {};                    // 来源 → 技能条数（含被排除项）
    abilities.forEach(function (a) {
      var k = srcOf(a);
      if (sources.indexOf(k) < 0) sources.push(k);
      sourceCount[k] = (sourceCount[k] || 0) + 1;
    });

    return {
      db: db,
      id2tag: id2tag,
      name2ids: name2ids,
      names: names,
      abilities: abilities,
      featText: db.featText || {},
      notePool: db.notePool || [],
      sources: sources,
      sourceCount: sourceCount,
      heroes: heroes,
      id2hero: id2hero,
      heroSkills: heroSkills,
      heroSkillsValid: heroSkillsValid,
      heroedSkills: heroedSkills,
      unexplainedSkills: unexplainedSkills,
      excludedBy: excludedBy,
      excludedTotal: excludedTotal,
      fetchedAt: db.fetchedAt || ''
    };
  }

  /** 某技能的所属英雄：[{id, zh, en, a}]（无归属为空数组） */
  function heroesOf(index, a) {
    var map = (index && index.id2hero) || new Map();
    return ((a && a.h) || []).map(function (id) {
      var h = map.get(id);
      return { id: id, zh: h ? h.zh : '未知英雄 ' + id, en: h ? h.en : '', a: h ? h.a : '' };
    });
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
   * query = {q:'查找内容', heroes:[英雄 id…], includeExcluded:bool}
   *   多个词用空白分隔 → 需全部出现（AND），英文不区分大小写。
   *   heroes 非空时只在该批英雄的技能里查（并集）。
   * 命中项：{id,name,en,heroes,ability,upgrades,excluded,lines[{n,t,ind,hit}],matched,count,noteCount}
   * 排序：命中行数 ↓ → 词频 ↓ → id ↓ */
  function searchNotes(index, query) {
    query = query || {};
    var terms = String(query.q == null ? '' : query.q).split(/\s+/)
      .map(function (s) { return s.trim(); }).filter(Boolean);
    var lows = terms.map(function (s) { return s.toLowerCase(); });
    var showExcluded = !!query.includeExcluded;
    var srcKeys = normSources(query.sources);
    var srcOn = srcKeys.length > 0;
    var srcSet = new Set(srcKeys);
    var srcOut = 0;
    var heroIds = normHeroIds(query.heroes);
    var heroOn = heroIds.length > 0;
    var heroSet = new Set(heroIds);
    var heroOut = 0;
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
        noteSkills: noteStats(index).skills,
        hero: heroStats(index, heroOn, heroIds, 0),
        src: sourceStats(index, srcKeys, 0)
      }
    };
    if (!lows.length) return base;

    index.abilities.forEach(function (a) {
      var ex = excludeKind(a);
      if (ex && !showExcluded) { skipped++; return; }
      if (srcOn && !hasSource(a, srcSet)) { srcOut++; return; }
      if (heroOn && !hasHero(a, heroSet)) { heroOut++; return; }
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
        id: a.i, name: a.n, en: a.en, heroes: heroesOf(index, a), ability: a, upgrades: upgrades(a),
        excluded: ex || null, lines: ls, matched: matched, count: count, noteCount: ls.length
      });
    });

    hits.sort(function (x, y) {
      return (y.matched - x.matched) || (y.count - x.count) || (y.id - x.id);
    });
    base.stats.skipped = skipped;
    base.stats.hero = heroStats(index, heroOn, heroIds, heroOut);
    base.stats.src = sourceStats(index, srcKeys, srcOut);
    return base;
  }

  /* ---------- 英雄筛选 ---------- */
  /** 归一化英雄 id 数组（去空、去重） */
  function normHeroIds(list) {
    var out = [];
    (list || []).forEach(function (v) {
      var n = parseInt(v, 10);
      if (!isNaN(n) && n > 0 && out.indexOf(n) < 0) out.push(n);
    });
    return out;
  }

  /** 该技能是否属于所选英雄之一 */
  function hasHero(a, heroSet) {
    var hs = (a && a.h) || [];
    for (var i = 0; i < hs.length; i++) { if (heroSet.has(hs[i])) return true; }
    return false;
  }

  /** 所选英雄名下的技能条数（含被排除项；未启用为 0） */
  function heroPoolSize(index, heroSet) {
    if (!heroSet || !heroSet.size) return 0;
    var n = 0;
    (index.abilities || []).forEach(function (a) { if (hasHero(a, heroSet)) n++; });
    return n;
  }

  /** 统一构造 stats.hero */
  function heroStats(index, on, ids, out) {
    var set = new Set(ids || []);
    return { on: !!on, ids: (ids || []).slice(), out: out || 0, pool: heroPoolSize(index, set) };
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

  /** 按匹配范围收集某技能的全部 tag id（并集 —— 仅用于旧口径 / 纯反选 / tag 计数） */
  function tagSet(a, scope) {
    scope = normalizeScope(scope);
    var s = new Set();
    if (scope.d) (a.d || []).forEach(function (x) { s.add(x); });
    if (scope.g) (a.g || []).forEach(function (x) { s.add(x); });
    if (scope.m) (a.m || []).forEach(function (x) { s.add(x); });
    if (scope.e) (a.e || []).forEach(function (row) { (row.t || []).forEach(function (x) { s.add(x); }); });
    return s;
  }

  /* ---------- 匹配粒度：效果类 tag 必须落在「同一个效果条目」----------
   * 一个技能的 tag 分放在几处，性质不同：
   *   技能类型 d / 技能特性 m —— 技能级属性（点目标、主动、会被破坏…），整条技能成立
   *   tags 字段 g            —— 汇总，混进效果里会把不同效果的 tag 串起来，不参与效果条目判定
   *   技能效果 e 的每一行     —— 这才是「一个效果条目」
   *
   * 「效果类 tag」= 只描述某个效果本身的类别（见 EFFECT_C2，即 tag 管理里
   *   「机制-包含效果」及其同级效果组下的词条：包含效果/状态效果/驱散情况/减益免疫/
   *   叠加方式/伤害类型/伤害性质/状态抗性/减速抗性/无敌隐藏/伤害标记/初始伤害/判定时机/
   *   生效从属/伤害间隔/状态来源/状态归属/升级来源）。
   * 其余类别（施法类型/技能类别/冷却类型/魔法消耗/生命消耗/加成属性/目标/技能行为/
   *   施放技能时/面对控制时/指向性技能施法时/攻击命中判定）属技能级 tag。
   *
   * 判定规则：
   *   效果类 且/或/非 —— 必须在**同一个效果条目**里成立（不能「效果2 有 A、效果1 有 B」）
   *   技能级 且/或/非 —— 整个技能（类型 ∪ 特性 ∪ tags 字段 ∪ 所有效果）里成立即可
   * 同一条条件里若混了两类 tag（极少见）→ 按技能级处理（宽松）。
   */
  var EFFECT_C2 = {
    '包含效果': 1, '状态效果': 1, '驱散情况': 1, '减益免疫': 1, '叠加方式': 1,
    '伤害类型': 1, '伤害性质': 1, '状态抗性': 1, '减速抗性': 1, '无敌隐藏': 1,
    '伤害标记': 1, '初始伤害': 1, '判定时机': 1, '生效从属': 1, '伤害间隔': 1,
    '状态来源': 1, '状态归属': 1, '升级来源': 1
  };

  /** 该 tag 是否「效果类」（决定它要不要跟别的效果类 tag 挤在同一个效果条目里） */
  function isEffectTag(index, id) {
    var t = index && index.id2tag ? index.id2tag.get(id) : null;
    return !!(t && EFFECT_C2[t.c2]);
  }

  /** 一条条件（已解析出 ids）是否按「同一效果条目」判定：全部 id 都是效果类才算 */
  function isEffectCond(index, ids) {
    if (!ids || !ids.length) return false;
    for (var i = 0; i < ids.length; i++) { if (!isEffectTag(index, ids[i])) return false; }
    return true;
  }

  /** 技能的效果条目（判定单元）：每个效果行的 tag 集合。
   *  tags 字段里那些「任何行都没有」的效果类残留 tag 视为技能级补充，挂到每行；
   *  技能一行效果都没有（天赋加成、纯被动条目等）→ 整条技能算一个单元。 */
  function effectRowsOf(a, scope, index) {
    scope = normalizeScope(scope);
    var rows = [], inRows = new Set();
    if (scope.e) {
      (a.e || []).forEach(function (row, k) {
        var t = (row && row.t) || [];
        if (!t.length) return;
        t.forEach(function (x) { inRows.add(x); });
        rows.push({
          i: k, n: (row && row.n) || '', ids: t.slice(),
          label: '效果' + (k + 1) + ((row && row.n) ? '「' + row.n + '」' : '')
        });
      });
    }
    var residual = [];
    if (scope.g && index) {
      (a.g || []).forEach(function (x) {
        if (!inRows.has(x) && isEffectTag(index, x)) residual.push(x);
      });
    }
    rows.forEach(function (r) {
      var s = new Set(r.ids);
      residual.forEach(function (x) { s.add(x); });
      r.set = s;
    });
    if (!rows.length) {
      var s = new Set(residual);
      if (scope.d) (a.d || []).forEach(function (x) { s.add(x); });
      if (scope.m) (a.m || []).forEach(function (x) { s.add(x); });
      if (scope.g) (a.g || []).forEach(function (x) { s.add(x); });
      if (s.size) rows.push({ i: -1, n: '', ids: [], label: '整条技能', set: s });
    }
    return rows;
  }

  var hasAny = function (set, ids) {
    for (var i = 0; i < ids.length; i++) { if (set.has(ids[i])) return true; }
    return false;
  };

  /** 单个单元是否满足条件：且全部、或至少一项、反选一个都不许有；notIds 传 null = 忽略反选 */
  function matchCand(set, andIds, orIds, notIds) {
    var i;
    for (i = 0; i < andIds.length; i++) {
      if (andIds[i] && andIds[i].length && !hasAny(set, andIds[i])) return false;
    }
    if (orIds.length) {
      var ok = false;
      for (i = 0; i < orIds.length; i++) {
        if (orIds[i] && orIds[i].length && hasAny(set, orIds[i])) { ok = true; break; }
      }
      if (!ok) return false;
    }
    if (notIds && notIds.length) {
      for (i = 0; i < notIds.length; i++) {
        if (notIds[i] && notIds[i].length && hasAny(set, notIds[i])) return false;
      }
    }
    return true;
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

  /** 某组 tag 在**命中的效果条目**里的位置；rows 为空或缺省 = 全技能所有位置 */
  function locationsInRows(a, ids, scope, index, rows) {
    if (!rows || !rows.length) return locations(a, ids, scope, index);
    var want = new Set(ids);
    var inRow = false;
    var out = [], seen = {};
    rows.forEach(function (r) {
      var row = (a.e || [])[r.i];
      if (!row || seen[r.i]) return;
      if (!(row.t || []).some(function (x) { return want.has(x); })) return;
      seen[r.i] = 1;
      inRow = true;
      out.push({ where: '效果' + (r.i + 1) + (row.n ? '「' + row.n + '」' : ''), kind: 'e', row: r.i + 1 });
    });
    // 只出现在 tags 字段（或技能类型/特性）里的 tag：不在任何效果行内，位置直说
    if (!inRow) {
      if ((a.g || []).some(function (x) { return want.has(x); })) out.push({ where: 'tags字段', kind: 'g' });
      if ((a.d || []).some(function (x) { return want.has(x); })) out.push({ where: '技能类型', kind: 'd' });
      if ((a.m || []).some(function (x) { return want.has(x); })) {
        var fs = index ? featsOf(index, a).filter(function (f) { return want.has(f.id); }) : [];
        out.push({ where: '技能特性', kind: 'm', feats: fs });
      }
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

  /** 施法前摇（ability_cast_point）解析成数值数组
   *  '0.2' → [0.2]；'0（魔晶）' → [0]；'0.2/0.3' → [0.2,0.3]；空 → [] */
  var CP_CACHE = (typeof WeakMap === 'function') ? new WeakMap() : null;
  function castPoints(a) {
    if (!a) return [];
    if (CP_CACHE && CP_CACHE.has(a)) return CP_CACHE.get(a);
    var raw = String(a.cp == null ? '' : a.cp);
    var out = [];
    var re = /\d+(?:\.\d+)?/g, m;
    while ((m = re.exec(raw))) {
      var v = parseFloat(m[0]);
      if (!isNaN(v)) out.push(v);
    }
    if (CP_CACHE) CP_CACHE.set(a, out);
    return out;
  }

  /** 是否落在前摇闭区间内：任取一值命中即算；无数据 → false
   *  min/max 为 null 表示该侧不限 */
  function castInRange(a, min, max) {
    var v = castPoints(a);
    if (!v.length) return false;
    var lo = (min == null || isNaN(min)) ? -Infinity : Number(min);
    var hi = (max == null || isNaN(max)) ? Infinity : Number(max);
    for (var i = 0; i < v.length; i++) {
      if (v[i] >= lo && v[i] <= hi) return true;
    }
    return false;
  }

  /** 前摇条件是否被启用（两侧都空 = 不过滤） */
  function castActive(cast) {
    if (!cast) return false;
    var hasMin = cast.min != null && cast.min !== '' && !isNaN(cast.min);
    var hasMax = cast.max != null && cast.max !== '' && !isNaN(cast.max);
    return hasMin || hasMax;
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

    var hits = [];
    var showExcluded = !!query.includeExcluded;
    var skipped = 0;

    // 施法前摇区间（可选，与 tag 条件同时生效）
    var cast = query.cast || null;
    var castOn = castActive(cast);
    var castMin = castOn && cast.min != null && cast.min !== '' && !isNaN(cast.min) ? Number(cast.min) : null;
    var castMax = castOn && cast.max != null && cast.max !== '' && !isNaN(cast.max) ? Number(cast.max) : null;
    var castMissing = 0, castOut = 0;

    // 技能来源筛选（可选，先于英雄筛选，两者可叠加）
    var srcKeys = normSources(query.sources);
    var srcOn = srcKeys.length > 0;
    var srcSet = new Set(srcKeys);
    var srcOut = 0;

    // 英雄筛选（可选，与 tag / 前摇条件同时生效）
    var heroIds = normHeroIds(query.heroes);
    var heroOn = heroIds.length > 0;
    var heroSet = new Set(heroIds);
    var heroOut = 0;
    var notOut = 0;          // 被「反选」条件排除的技能条数（供界面说明「剩下」的算式）
    var unitOut = 0;         // 效果类条件分散在不同效果条目 → 未命中（仅统计）
    var afterTag = 0;        // 通过全部 tag 条件（含反选）、进入前摇判定的条数
    // 匹配粒度：默认「效果类 tag 必须落在同一个效果条目」；false = 旧口径（整技能并集）
    var matchUnit = query.matchUnit !== false;
    // 只有反选（没有且/或）时没有可锚定的效果条目 → 按整个技能判定
    var pureNot = !andIds.length && !orIds.length;
    var useRows = matchUnit && !pureNot && scope.e;

    // 条件分流：效果类（同一效果条目内成立）vs 技能级（整条技能成立即可）
    var effAnd = [], genAnd = [], effOr = [], genOr = [], effNot = [], genNot = [];
    var splitConds = function (resolved, effArr, genArr) {
      resolved.forEach(function (r) {
        if (!r || !r.ids) { genArr.push(null); return; }        // 名称没解析出来：忽略该条（旧行为）
        if (useRows && isEffectCond(index, r.ids)) effArr.push(r.ids);
        else genArr.push(r.ids);
      });
    };
    splitConds(rAnd, effAnd, genAnd);
    splitConds(rOr, effOr, genOr);
    splitConds(rNot, effNot, genNot);
    var hasEffCond = !!(effAnd.length || effOr.length || effNot.length);

    index.abilities.forEach(function (a) {
      var ex = excludeKind(a);
      if (ex && !showExcluded) { skipped++; return; }
      if (srcOn && !hasSource(a, srcSet)) { srcOut++; return; }
      if (heroOn && !hasHero(a, heroSet)) { heroOut++; return; }

      var whole = tagSet(a, scope);
      // 技能级条件：整条技能（类型 ∪ 特性 ∪ tags ∪ 所有效果）满足即可
      var genOk = matchCand(whole, genAnd, genOr, genNot);
      // 效果类条件：必须落在同一个效果条目里
      var rows = (useRows && hasEffCond) ? effectRowsOf(a, scope, index) : null;
      var matchedRows = rows
        ? rows.filter(function (r) { return matchCand(r.set, effAnd, effOr, effNot); })
        : [];
      var ok = genOk && (!rows || matchedRows.length > 0);

      if (!ok) {
        // 只因反选被剔除？（去掉反选就能成立）
        var rowsNoNot = rows ? rows.filter(function (r) { return matchCand(r.set, effAnd, effOr, null); }) : [];
        if (matchCand(whole, genAnd, genOr, null) && (!rows || rowsNoNot.length)) { notOut++; return; }
        // 条件本身都满足，只是效果类 tag 分散在不同效果条目 → 记「不同效果」未命中
        if (rows && matchCand(whole, andIds, orIds, notIds)) unitOut++;
        return;
      }
      // 前摇区间（在 tag 条件之后应用，便于统计「因前摇被排除」的数量）
      afterTag++;
      if (castOn) {
        if (!castPoints(a).length) { castMissing++; return; }
        if (!castInRange(a, castMin, castMax)) { castOut++; return; }
      }
      var detail = [];
      var pushDetail = function (r, group) {
        if (!r || !r.ids) return;
        if (useRows && isEffectCond(index, r.ids)) {
          // 效果类条件：位置落在命中的效果条目里
          if (!matchedRows.some(function (row) { return hasAny(row.set, r.ids); })) return;
          detail.push({ group: group, name: r.input, names: r.names, ids: r.ids, unit: true,
            loc: locationsInRows(a, r.ids, scope, index, matchedRows) });
          return;
        }
        // 技能级条件：整个技能里任意位置命中都算
        if (group === 'or' && !hasAny(whole, r.ids)) return;
        detail.push({ group: group, name: r.input, names: r.names, ids: r.ids, unit: false,
          loc: locations(a, r.ids, scope, index) });
      };
      rAnd.forEach(function (r) { pushDetail(r, 'and'); });
      rOr.forEach(function (r) { pushDetail(r, 'or'); });

      // 命中的效果条目（用于展示「这些效果类 tag 落在哪一条效果里」）
      var unitLabels = [];
      matchedRows.forEach(function (c) {
        if (c.label && unitLabels.indexOf(c.label) < 0) unitLabels.push(c.label);
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
        id: a.i, name: a.n, en: a.en, heroes: heroesOf(index, a), tagCount: whole.size,
        detail: detail, feats: feats, unitLabels: unitLabels,
        ability: a, upgrades: upgrades(a), excluded: ex || null,
        cast: String(a.cp == null ? '' : a.cp), castVals: castPoints(a)
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
        includeExcluded: showExcluded,
        cast: { on: castOn, min: castMin, max: castMax, missing: castMissing, out: castOut },
        unit: {
          on: useRows && hasEffCond, matchUnit: matchUnit, pureNot: pureNot, out: unitOut,
          mode: useRows && hasEffCond ? 'row' : 'skill',
          // 效果类（须同一效果条目）/ 技能级（跨效果、类型、特性）条件各几条
          eff: { and: effAnd.length, or: effOr.length, not: effNot.length },
          skill: { and: genAnd.length, or: genOr.length, not: genNot.length }
        },
        not: {
          on: notIds.length > 0, out: notOut, afterTag: afterTag, unit: useRows,
          names: rNot.map(function (r) { return r && r.input || ''; }),
          // 反选里哪些是效果类（只在命中的效果条目内排除）、哪些是技能级（出现即整条剔除）
          effNames: rNot.filter(function (r) { return r && r.ids && useRows && isEffectCond(index, r.ids); })
            .map(function (r) { return r.input; }),
          genNames: rNot.filter(function (r) { return r && r.ids && !(useRows && isEffectCond(index, r.ids)); })
            .map(function (r) { return r.input; })
        },
        hero: heroStats(index, heroOn, heroIds, heroOut),
        src: sourceStats(index, srcKeys, srcOut)
      }
    };
  }

  /** 列出某技能的全部 tag（按来源分组，供详情面板用） */
  function describe(index, a, scope) {
    scope = normalizeScope(scope);
    var nm = function (id) { var t = index.id2tag.get(id); return t ? { id: id, name: t.name, c1: t.c1, c2: t.c2 } : { id: id, name: '未知 tag ' + id, c1: '', c2: '' }; };
    var uniq = function (ids) { var seen = {}; return (ids || []).filter(function (id) { if (seen[id]) return false; seen[id] = 1; return true; }).map(nm); };
    var out = { detail: [], mech: [], tags: [], effects: [], upgrades: upgrades(a), cast: String(a.cp == null ? '' : a.cp) };
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
    locationsInRows: locationsInRows,
    effectRowsOf: effectRowsOf,
    isEffectTag: isEffectTag,
    isEffectCond: isEffectCond,
    EFFECT_C2: EFFECT_C2,
    matchCand: matchCand,
    describe: describe,
    resolveName: resolveName,
    upgrades: upgrades,
    castPoints: castPoints,
    castInRange: castInRange,
    castActive: castActive,
    excludeKind: excludeKind,
    heroesOf: heroesOf,
    normHeroIds: normHeroIds,
    hasHero: hasHero,
    SOURCES: SOURCES,
    srcOf: srcOf,
    normSources: normSources,
    hasSource: hasSource,
    sourceStats: sourceStats,
    featsOf: featsOf,
    featTexts: featTexts,
    EXCLUDE_KINDS: EXCLUDE_KINDS,
    CUSTOM_ID_MIN: CUSTOM_ID_MIN,
    UPGRADE_META: UPGRADE_META,
    UPGRADE_ORDER: UPGRADE_ORDER
  };
});
