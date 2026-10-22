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
