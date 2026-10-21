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
