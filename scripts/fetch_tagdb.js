// fetch_tagdb —— 抓取「Tag管理」全量标签 + 「技能」全量 tag 数据（供离线检索工具 tagsearch 使用）
// 入参：无（A.compact=1 精简输出，默认 1）
// 输出：{ ok, fetchedAt, tags:[{id,name,c1,c2}], abilities:[…], items:[…], heroes:[…], itemRefs:[id…] }
//   itemRefs = 现版本物品技能 id 列表：道具数据 item/list 里「有分类（cate1 非空且非已移除/未发布）」道具的
//    ability_map 引用的技能 id（2026-11-06 用户定口径，取代 11-04 的「非已移除/未发布」口径）；
//    抓不到则为空数组（检索器退回旧行为）。
//   abilities = 「技能」（英雄技能）全量；items = 「内容管理-道具技能」全量，字段与 abilities 完全一致，
//    构建阶段给 items 写 src='item'（abilities 不写 src，缺省即 'hero'）。
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

  /** 单条技能记录（英雄技能 / 物品技能共用同一套字段）→ 精简结构 */
  function pack(x) {
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
    return {
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
      cp: String(x.ability_cast_point == null ? '' : x.ability_cast_point).trim(),
      // 最后更新时间（秒级 unix）→ 用于「今日更新」判定：id ≥ 20000 的自定义技能若今日更新过则不按自定义排除
      ut: parseInt(x.update_time, 10) || 0
    };
  }

  var abs = [], pages = 0;
  for (var p2 = 1; p2 <= 40; p2++) {
    var r2 = await fetch('/apg/admin/hero/ability?page=' + p2, { credentials: 'include' });
    var j2 = await r2.json();
    var L2 = (j2.data && j2.data.list) || [];
    pages = p2;
    if (!L2.length) break;
    L2.forEach(function (x) { abs.push(pack(x)); });
    if (L2.length < 100) break;
  }

  // ---------- 2b) 物品技能全量（内容管理-道具技能；字段同英雄技能） ----------
  // 构建阶段给这批记录写 src='item'（英雄技能不写 src，缺省即 'hero'）。
  var items = [], ipages = 0;
  for (var p3 = 1; p3 <= 20; p3++) {
    var r3 = await fetch('/apg/admin/item/ability?page=' + p3 + '&page_size=100', { credentials: 'include' });
    var j3 = await r3.json();
    var L3 = (j3.data && j3.data.list) || [];
    ipages = p3;
    if (!L3.length) break;
    L3.forEach(function (x) { items.push(pack(x)); });
    if (L3.length < 100) break;
  }

  // ---------- 2c) 现版本物品技能（道具数据 item/list 的 ability_map）----------
  // 判定口径（2026-11-06 用户定）：只算「有分类」的物品——道具数据 item/list 的 `cate1`
  // 字段非空（商店物品 / 中立物品 / 掉落 / 采集物品 / 派生物品…），且不是「已移除物品」「未发布物品」（基地商店有售 / 神秘商店有售 / 打造 / 采集 / 野怪掉落 / 肉山掉落…）。
  // 分类为空的（组件 / 未整理条目）、已移除、未发布 → 都不算现版本。
  // 抓取结果只输出 id 列表 itemRefs；构建阶段给对应物品技能写 cur=1。
  // 抓不到时 itemRefs 为空 → 构建阶段不写 itemCur 标记，检索器退回「全部物品技能」旧行为。
  var itemRefs = [], itemDataCount = 0, itemCateCount = 0;
  try {
    var refSet = {};
    for (var p4 = 1; p4 <= 12; p4++) {
      var r4 = await fetch('/apg/admin/item/list?page=' + p4 + '&page_size=100', { credentials: 'include' });
      var j4 = await r4.json();
      var L4 = (j4.data && j4.data.list) || [];
      if (!L4.length) break;
      itemDataCount += L4.length;
      L4.forEach(function (it) {
        var c1 = String(it.cate1 == null ? '' : it.cate1).trim();
        if (!c1) return;                       // 无分类 → 不算现版本物品
        if (c1 === '已移除物品' || c1 === '未发布物品') return;
        itemCateCount++;
        var am = it.ability_map;
        if (Array.isArray(am)) {
          am.forEach(function (x) { var n = parseInt(x, 10); if (n > 0) refSet[n] = 1; });
        } else {
          String(am == null ? '' : am).split(',').forEach(function (s) {
            var n = parseInt(s.trim(), 10); if (n > 0) refSet[n] = 1;
          });
        }
      });
      if (L4.length < 100) break;
    }
    itemRefs = Object.keys(refSet).map(function (k) { return parseInt(k, 10); }).sort(function (a, b) { return a - b; });
  } catch (e) { itemRefs = []; }

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
    itemCount: items.length,
    heroCount: heroes.length,
    itemDataCount: itemDataCount,
    itemCateCount: itemCateCount,
    itemRefCount: itemRefs.length,
    pages: pages,
    itemPages: ipages,
    tags: tags,
    abilities: abs,
    items: items,
    heroes: heroes,
    itemRefs: itemRefs
  });
})()
