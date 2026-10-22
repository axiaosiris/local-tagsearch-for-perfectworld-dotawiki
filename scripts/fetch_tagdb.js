// fetch_tagdb —— 抓取「Tag管理」全量标签 + 「技能」全量 tag 数据（供离线检索工具 tagsearch 使用）
// 入参：无（A.compact=1 精简输出，默认 1）
// 输出：{ ok, fetchedAt, tags:[{id,name,c1,c2}], abilities:[{i,n,en,d,g,m,f,e,cp}], heroes:[{i,zh,en,a,s}] }
//   heroes = 「内容管理-英雄数据」全量英雄（接口 /apg/admin/hero/list，POST {}）
//     i=英雄 id  zh=中文名  en=英文名  a=主属性（力量/敏捷/智力/全才）  s=该英雄的技能 id 数组（ability_map）
//   d=skill_detail(技能类型 id)  g=tags 字段 id  m=skill_mechanism(mechanism_tag id)
//   f=[{i:mechanism_tag  id, c:mechanism_input 特性内容}]  与 m 同序（技能特性的文本，供检索器展示）
//   e=[{n:效果行名, t:[effect_tag id…]}]
//   cp=ability_cast_point 施法前摇原始文本（可能为空 / 带备注，如「0（魔晶）」）
//   note=skill_notes 原始富文本 HTML（技能注释，构建阶段转成纯文本行）
(async function () {
  var A = window.__A || {};

  // ---------- 1) Tag 全量（目标/机制/升级/图标 四类） ----------
  var tags = [];
  for (var p = 1; p <= 20; p++) {
    var r = await fetch('/apg/admin/mechanism/list?page=' + p, { credentials: 'include' });
    var j = await r.json();
    var L = (j.data && j.data.list) || (j.data && j.data.data) || null;
    if (!Array.isArray(L) || !L.length) break;
    L.forEach(function (t) {
      tags.push({ id: t.id, name: t.name, c1: t.cate1 || '', c2: t.cate2 || '', sort: t.sort, pid: t.pid });
    });
    if (L.length < 100) break;
  }

  // ---------- 2) 技能全量 ----------
  function jarr(v) {
    if (v == null || v === '') return [];
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') { try { var a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
    return [];
  }
  function ids(v) {
    if (v == null || v === '') return [];
    var out = [];
    var arr = jarr(v);
    if (arr.length) {
      arr.forEach(function (x) { var n = parseInt(x, 10); if (!isNaN(n) && n > 0) out.push(n); });
      return out;
    }
    if (typeof v === 'string') {
      v.split(',').forEach(function (t) { var n = parseInt(t, 10); if (!isNaN(n) && n > 0) out.push(n); });
    }
    return out;
  }

  var abs = [], pages = 0;
  for (var p2 = 1; p2 <= 20; p2++) {
    var r2 = await fetch('/apg/admin/hero/ability?page=' + p2, { credentials: 'include' });
    var j2 = await r2.json();
    var L2 = (j2.data && j2.data.list) || [];
    pages = p2;
    if (!L2.length) break;
    L2.forEach(function (x) {
      var eff = jarr(x.skill_effect).map(function (e) {
        return { n: e.effect_input || '', t: ids(e.effect_tag) };
      });
      var mech = [];
      var feat = [];
      jarr(x.skill_mechanism).forEach(function (mm) {
        var n = parseInt(mm.mechanism_tag, 10);
        if (isNaN(n) || n <= 0) return;
        mech.push(n);
        // 特性内容（网页「技能特性」行的描述文本），与 mech 同序
        feat.push({ i: n, c: String(mm.mechanism_input == null ? '' : mm.mechanism_input) });
      });
      abs.push({
        i: x.id,
        n: x.name_zh || '',
        en: x.name_en || '',
        d: ids(x.skill_detail),
        g: ids(x.tags),
        m: mech,
        f: feat,
        e: eff,
        note: String(x.skill_notes == null ? '' : x.skill_notes),
        // 施法前摇（后台字段 ability_cast_point；注意 _back 后缀的是「施法后摇」）
        cp: String(x.ability_cast_point == null ? '' : x.ability_cast_point).trim()
      });
    });
    if (L2.length < 100) break;
  }

  // ---------- 3) 英雄全量（内容管理-英雄数据；能力清单在 ability_map） ----------
  var heroes = [];
  try {
    var rh = await fetch('/apg/admin/hero/list', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    var jh = await rh.json();
    var LH = Array.isArray(jh.data) ? jh.data : ((jh.data && jh.data.list) || []);
    LH.forEach(function (h) {
      heroes.push({
        i: h.id,
        zh: h.name_zh || '',
        en: h.name_en || '',
        a: h.attribute_primary || '',
        s: ids(h.ability_map)
      });
    });
  } catch (e) { heroes = []; }

  return JSON.stringify({
    ok: true,
    fetchedAt: new Date().toISOString(),
    tagCount: tags.length,
    abilityCount: abs.length,
    heroCount: heroes.length,
    pages: pages,
    tags: tags,
    abilities: abs,
    heroes: heroes
  });
})()
