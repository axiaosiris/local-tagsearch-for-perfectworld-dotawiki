// 本地逻辑自测（node 运行，非交付文件）
global.window = global;
require('./data.js');
var core = require('./search-core.js');
var DB = global.TAGDB;
var idx = core.createIndex(DB);
console.log('标签数:', idx.names.length, ' 技能数:', idx.abilities.length, ' 快照:', idx.fetchedAt);
console.log('默认排除:', idx.excludedTotal, '条', JSON.stringify(idx.excludedBy),
  '→ 有效', idx.abilities.length - idx.excludedTotal, '条');

function show(label, q) {
  var r = core.search(idx, q);
  console.log('\n[' + label + '] 命中 ' + r.hits.length + (r.unknown.length ? ' | 未识别 tag: ' + r.unknown.join(',') : ''));
  console.log('  ' + r.hits.slice(0, 12).map(function (h) { return h.name + '(' + h.id + ')'; }).join('、') + (r.hits.length > 12 ? ' …' : ''));
  return r;
}

show('且:防御塔 非:定值生命恢复', { and: ['防御塔'], not: ['定值生命恢复'] });
show('或:防御塔|定值生命恢复', { and: [], or: ['防御塔', '定值生命恢复'], not: [] });
show('且:防御塔+定值生命恢复（严格交集）', { and: ['防御塔', '定值生命恢复'] });
show('仅:定值生命恢复', { and: ['定值生命恢复'] });

var r = core.search(idx, { and: ['防御塔'], or: ['定值生命恢复'], not: [] });
console.log('\n[组合] 且:防御塔 或:定值生命恢复 →', r.hits.length);
r.hits.slice(0, 3).forEach(function (h) {
  console.log('  ' + h.name, JSON.stringify(h.detail.map(function (d) { return { g: d.group, n: d.name, loc: d.loc.map(function (l) { return l.where; }) }; })));
});

console.log('\n[详情] 活体护甲:');
var ab = idx.abilities.filter(function (a) { return a.i === 5436; })[0];
var d = core.describe(idx, ab, {});
console.log('  技能类型:', d.detail.map(function (t) { return t.name; }).join('、'));
d.effects.forEach(function (e) { console.log('  效果「' + e.name + '」:', e.tags.map(function (t) { return t.name; }).slice(0, 8).join('、') + ' …'); });

/* ---------- 技能特性内容 ---------- */
console.log('\n[技能特性内容] featText 覆盖 tag =', Object.keys(DB.featText || {}).length,
  '，带内容技能 =', idx.abilities.filter(function (a) { return core.featTexts(idx, a).some(Boolean); }).length);
['幻象不继承', '会被破坏'].forEach(function (q) {
  var rr = core.search(idx, { and: [q], or: [], not: [] });
  var withText = rr.hits.filter(function (h) { return (h.feats || []).some(function (f) { return f.text; }); }).length;
  console.log('  「' + q + '」命中 ' + rr.hits.length + '（带特性内容 ' + withText + '）');
  rr.hits.slice(0, 2).forEach(function (h) {
    (h.feats || []).forEach(function (f) { console.log('    · ' + h.id + ' ' + h.name + ' → [' + f.name + '] ' + f.text); });
  });
});

/* ---------- 注释检索（独立功能） ---------- */
var ns = core.noteStats(idx);
console.log('\n[注释检索] 行池 =', ns.pool, '，带注释技能 =', ns.skills);
if (!ns.skills) {
  console.log('  当前 data.js 不含注释 —— 需重新抓取后再验证（逻辑用合成数据自检）');
  var sm = {
    notePool: ['光环有0.1秒的粘滞时间。', '受到大于等于40点伤害后，一层屏障将被移除。'],
    tags: [], abilities: [
      { i: 1, n: '合成甲', d: [], g: [], m: [], e: [], nt: [0, 1], ni: [0, 1] },
      { i: 2, n: '合成乙', d: [], g: [], m: [], e: [], nt: [0] }
    ]
  };
  var six = core.createIndex(sm);
  var sr = core.searchNotes(six, { q: '粘滞' });
  console.log('  合成数据「粘滞」→', sr.hits.length, '条；',
    '「粘滞 屏障」(AND) →', core.searchNotes(six, { q: '粘滞 屏障' }).hits.length, '条；',
    '「粘滞 不存在」(AND) →', core.searchNotes(six, { q: '粘滞 不存在' }).hits.length, '条');
  sr.hits.forEach(function (h) {
    console.log('    · ' + h.name + ' 命中 ' + h.matched + '/' + h.noteCount + ' 行：' +
      h.lines.filter(function (l) { return l.hit; }).map(function (l) { return 'L' + l.n + ' ' + l.t; }).join(' / '));
  });
} else {
  ['粘滞', '伤害事件', '格挡'].forEach(function (q) {
    var rn = core.searchNotes(idx, { q: q });
    console.log('  「' + q + '」→ ' + rn.hits.length + ' 个技能');
    rn.hits.slice(0, 2).forEach(function (h) {
      var l = h.lines.filter(function (x) { return x.hit; })[0];
      console.log('    · ' + h.id + ' ' + h.name + '  命中 ' + h.matched + '/' + h.noteCount +
        ' 行｜L' + l.n + ' ' + l.t.slice(0, 50));
    });
  });
  var multi = core.searchNotes(idx, { q: '粘滞 光环' });
  console.log('  「粘滞 光环」(AND) → ' + multi.hits.length + ' 个技能');
}

// ================= 施法前摇筛选（可与 tag 条件同时生效） =================
console.log('\n[施法前摇] 区间关区间判定：');
var castCount = idx.abilities.filter(function (a) { return core.castPoints(a).length; }).length;
console.log('  data.js 中带前摇数据的技能：' + castCount + ' / ' + idx.abilities.length);
if (!castCount) {
  var sc = core.createIndex({
    tags: [{ id: 1, name: '合成tag', c1: '机制', c2: '包含效果' }],
    abilities: [
      { i: 1, n: '零', en: 'z', d: [1], g: [], m: [], e: [], cp: '0' },
      { i: 2, n: '零点二', en: 'a', d: [1], g: [], m: [], e: [], cp: '0.2' },
      { i: 3, n: '无数据', en: 'n', d: [1], g: [], m: [], e: [] }
    ]
  });
  var s0 = core.search(sc, { and: ['合成tag'], or: [], not: [], scope: { d: 1 }, cast: { min: 0, max: 0 } });
  console.log('  合成 0~0 → ' + s0.hits.length + ' 条（期望 1）');
} else {
  [[0, 0], [0, 0.15], [null, 0.15]].forEach(function (r) {
    var rr = core.search(idx, { and: [], or: [], not: [], scope: { d: 1, e: 1, m: 1, g: 1 }, cast: { min: r[0], max: r[1] } });
    console.log('  前摇 ' + (r[0] == null ? '≤' : r[0] + '~') + (r[0] == null ? r[1] : r[1]) +
      ' → ' + rr.hits.length + ' 条（无数据被排除 ' + rr.stats.cast.missing + '，不在区间 ' + rr.stats.cast.out + '）');
    rr.hits.slice(0, 3).forEach(function (h) {
      console.log('    · ' + h.id + ' ' + h.name + '  前摇=' + h.cast);
    });
  });
  // 与 tag 叠加
  var withTag = core.search(idx, { and: ['防御塔'], or: [], not: [], scope: { d: 1, e: 1, m: 1, g: 1 }, cast: { min: 0, max: 0.15 } });
  console.log('  且:防御塔 + 前摇 0~0.15 → ' + withTag.hits.length + ' 条');
  withTag.hits.forEach(function (h) { console.log('    · ' + h.id + ' ' + h.name + '  前摇=' + (h.cast || '(无)')); });

  // 反选 + 前摇：结果是两者交集（前摇全量 = 反选后剩余 + 反选排除数）
  var q0 = { and: [], or: [], not: [], scope: { d: 1, e: 1, m: 1, g: 1 }, cast: { min: 0, max: 0 } };
  var castAll = core.search(idx, q0);
  var castNot = core.search(idx, {
    and: [], or: [], not: ['防御塔'], scope: { d: 1, e: 1, m: 1, g: 1 }, cast: { min: 0, max: 0 }
  });
  var nt = castNot.stats.not || {};
  var cst = castNot.stats.cast || {};
  var chain = (nt.afterTag - cst.missing - cst.out) === castNot.hits.length;
  console.log('  前摇0~0 全量 ' + castAll.hits.length + ' 条；叠加反选后：有效 ' +
    castNot.stats.effective + ' − 反选排除 ' + nt.out + ' = 参加前摇判定 ' + nt.afterTag +
    ' − 无前摇 ' + cst.missing + ' − 区间外 ' + cst.out + ' = ' + castNot.hits.length +
    '（' + (chain ? '✓ 链式自洽' : '✗ 链式不自洽') + '）');
  console.log('  反选条件 = ' + JSON.stringify(nt.names) + '，反选后 ' + castNot.hits.length + ' 条');
}

// ================= 英雄筛选（名册来自后台「内容管理-英雄数据」） =================
console.log('\n[英雄筛选]');
var heroTotal = (idx.heroes || []).length;
console.log('  名册英雄 = ' + heroTotal + '，有归属技能 = ' + idx.heroedSkills + '，无归属 = ' + idx.unexplainedSkills);
if (!heroTotal) {
  console.log('  当前 data.js 不含英雄名册 —— 用合成数据自检');
  var sh = core.createIndex({
    tags: [{ id: 1, name: '合成tag', c1: '机制', c2: '包含效果' }],
    heroes: [{ i: 10, zh: '甲', en: 'alpha', a: '力量' }, { i: 11, zh: '乙', en: 'beta', a: '敏捷' }],
    abilities: [
      { i: 1, n: '甲的技能', en: 'alpha_q', d: [1], g: [], m: [], e: [], h: [10] },
      { i: 2, n: '乙的技能', en: 'beta_q', d: [1], g: [], m: [], e: [], h: [11] },
      { i: 3, n: '无归属', en: 'generic', d: [1], g: [], m: [], e: [] }
    ]
  });
  var q1 = core.search(sh, { and: ['合成tag'], hero: undefined, heroes: [10] });
  console.log('  合成 且:合成tag + 英雄甲 → ' + q1.hits.length + ' 条（期望 1）');
} else {
  var byEn = {};
  idx.heroes.forEach(function (h) { byEn[String(h.en).toLowerCase()] = h; });
  var am = byEn['antimage'];
  console.log('  敌法师 = id ' + am.i + '，名下技能 ' + (idx.heroSkills.get(am.i) || 0) + ' 条');
  var r1 = core.search(idx, { and: [], or: [], not: [], scope: { d: 1, e: 1, m: 1, g: 1 }, heroes: [am.i] });
  var allMine = r1.hits.every(function (h) { return h.heroes.some(function (x) { return x.id === am.i; }); });
  console.log('  仅英雄:敌法师 → ' + r1.hits.length + ' 条（全部归属敌法师: ' + allMine + '）' +
    '，stats.hero.pool=' + r1.stats.hero.pool + '，out=' + r1.stats.hero.out);
  r1.hits.slice(0, 5).forEach(function (h) {
    console.log('    · ' + h.id + ' ' + h.name + '  [' + h.heroes.map(function (x) { return x.zh; }).join('、') + ']');
  });
  var ax = byEn['axe'];
  var r2 = core.search(idx, { and: [], or: [], not: [], scope: { d: 1, e: 1, m: 1, g: 1 }, heroes: [am.i, ax.i] });
  console.log('  仅英雄:敌法师+斧王 → ' + r2.hits.length + ' 条（= ' + r1.hits.length + ' + ' + (idx.heroSkills.get(ax.i) || 0) + '，去重后）');
  // 与 tag 叠加
  var r3 = core.search(idx, { and: ['防御塔'], or: [], not: [], scope: { d: 1, e: 1, m: 1, g: 1 }, heroes: [am.i] });
  console.log('  且:防御塔 + 英雄敌法师 → ' + r3.hits.length + ' 条');
  // 注释检索同样支持
  var r4 = core.searchNotes(idx, { q: '粘滞', heroes: [am.i] });
  var r4all = core.searchNotes(idx, { q: '粘滞' });
  console.log('  注释「粘滞」全库 ' + r4all.hits.length + ' → 限敌法师 ' + r4.hits.length + ' 条；' +
    '限敌法师+斧王 ' + core.searchNotes(idx, { q: '粘滞', heroes: [am.i, ax.i] }).hits.length + ' 条');
  console.log('  注释 stats.hero = ' + JSON.stringify(r4.stats.hero));

  // 旧版本技能回归：这些条目仍留在技能总表里，但「人工处理数据」没登记 → 不得归属任何英雄
  var byId = {};
  idx.abilities.forEach(function (a) { byId[a.i] = a; });
  [[7851, '如影随形(旧)'], [5432, '地之突袭'], [1355, '囤积狂鼠'], [5005, '法术护盾']].forEach(function (p) {
    var a = byId[p[0]];
    if (!a) { console.log('  旧版本回归 ' + p[0] + ' ' + p[1] + ' → 数据中已无此条目'); return; }
    var hs = core.heroesOf(idx, a) || [];
    console.log('  旧版本回归 ' + p[0] + ' ' + (a.n || p[1]) + ' → 归属 ' +
      (hs.length ? hs.map(function (x) { return x.zh; }).join('/') : '（无）') +
      (hs.length ? '  ✗ 应无归属' : '  ✓'));
  });
}

// ================= 技能来源筛选（数据类别；物品/非英雄单位技能待接入） =================
console.log('\n[技能来源]');
console.log('  登记表 = ' + core.SOURCES.map(function (s) { return s.key + (s.ready ? '' : '(未接入)'); }).join('、'));
console.log('  数据里的来源 = ' + JSON.stringify(idx.sources) + '，条数 ' + JSON.stringify(idx.sourceCount));
var readyKeys = core.SOURCES.filter(function (s) { return s.ready; }).map(function (s) { return s.key; });
var baseQ = { and: ['防御塔'], or: [], not: [] };
var rSrcAll = core.search(idx, { and: baseQ.and, or: [], not: [], sources: readyKeys });
var rSrcNone = core.search(idx, { and: baseQ.and, or: [], not: [], sources: [] });   // 空数组 = 不过滤
var rSrcOmit = core.search(idx, baseQ);
console.log('  全勾来源 ' + rSrcAll.hits.length + ' 条（stats.src.on=' + rSrcAll.stats.src.on + '）｜不传 sources ' +
  rSrcOmit.hits.length + ' 条｜空 sources ' + rSrcNone.hits.length + ' 条（= 不过滤；界面会拦住全不勾）');
console.log('  注释检索带 sources：' + core.searchNotes(idx, { q: '粘滞', sources: readyKeys }).hits.length +
  ' 条（应 = 全库 ' + core.searchNotes(idx, { q: '粘滞' }).hits.length + '）');

// 模拟接入「物品技能」：把 100 条**有效**技能标成 src:'item'，验证过滤与叠加
var pickItem = {};
DB.abilities.filter(function (a) { return !core.excludeKind(a); }).slice(0, 100)
  .forEach(function (a) { pickItem[a.i] = 1; });
var fake = core.createIndex({
  tags: DB.tags, heroes: DB.heroes, notePool: DB.notePool, featText: DB.featText,
  abilities: DB.abilities.map(function (a) {
    if (!pickItem[a.i]) return a;
    var c = {}; for (var kk in a) if (Object.prototype.hasOwnProperty.call(a, kk)) c[kk] = a[kk];
    c.src = 'item'; return c;
  })
});
console.log('  模拟数据来源 = ' + JSON.stringify(fake.sources) + '，条数 ' + JSON.stringify(fake.sourceCount));
var fItem = core.search(fake, { and: [], or: [], not: [], sources: ['item'] });
var fHero = core.search(fake, { and: [], or: [], not: [], sources: ['hero'] });
var fBoth = core.search(fake, { and: [], or: [], not: [], sources: ['hero', 'item'] });
console.log('  只 item ' + fItem.hits.length + ' ｜只 hero ' + fHero.hits.length + ' ｜两者 ' + fBoth.hits.length +
  '（合计应 = 有效 ' + (fake.abilities.length - fake.excludedTotal) + '）');
console.log('  只 item 的 stats.src = ' + JSON.stringify(fItem.stats.src));
