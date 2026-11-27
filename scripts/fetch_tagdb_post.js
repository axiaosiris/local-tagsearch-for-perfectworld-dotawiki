// fetch_tagdb_post —— fetch_tagdb 的「本机回传」版：抓完不下载文件，直接 POST 到本机接收端。
// 用法（浏览器已在 partner.dota2.com.cn 后台页、bsk 会话活着的状态下）：
//   1) python D:/wiki/tagsearch/scripts/recv_raw.py          # 起本机接收端（127.0.0.1:52812）
//   2) cd /d/wiki && . ./bsk-toolkit/lib.sh && bsk_eval D:/wiki/tagsearch/scripts/fetch_tagdb_post.js
//   3) mv D:/wiki/tagsearch/_raw.new.json D:/wiki/tagsearch/_raw.json   # 覆盖前先备份
// 说明：返回的是 {posted, bytes, fetchedAt}；bytes 是 JS 字符数，落盘字节数约为 1.5 倍。
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

  // 加成属性 tag id（tag 管理 → 图标 → 加成属性；动态取，tag 增减无需改代码）
  var bonusIds = {};
  tags.forEach(function (t) {
    if ((t.c1 || '') === '图标' && (t.c2 || '') === '加成属性') bonusIds[t.id] = 1;
  });

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

  /** JSON 字符串 → 对象（ability_special_map 是对象型 JSON，不能用 jarr） */
  function jobj(v) {
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
    if (typeof v === 'string') {
      try { var o = JSON.parse(v); return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {}; }
      catch (e) { return {}; }
    }
    return {};
  }

  /** 加成属性数据项：名称含 {%加成tag id%} 且 isShow=1 的「自定义中文名」项。
   *  用户口径（2026-11-23）：只按替换符检索即可，不区分数据项分区。
   *  优先用 ability_special_map_front（已含 customName/isShow）；缺项时由 *_custom_name / *_is_show 配对还原。
   *  ⚠ 物品技能（/apg/admin/item/ability）没有 *_is_show 字段、front 恒为空数组：无开关字段视为开启。
   *  只有显式 isShow=0 才排除；英雄技能 front 里的 isShow 仍照常判定。 */
  function bonusItems(v) {
    var s = jobj(v), arr = s.ability_special_map_front, out = [], seen = {};
    if (!Array.isArray(arr) || !arr.length) {
      arr = [];
      Object.keys(s).forEach(function (k) {
        if (!/_custom_name$/.test(k)) return;
        var f = k.replace(/_custom_name$/, '');
        arr.push({ customName: s[k], isShow: s[f + '_is_show'], fieldBack: k });
      });
    }
    arr.forEach(function (it) {
      // 无开关字段（物品技能整类都没有）→ 视为开启；只有显式 0 才排除
      if (it.isShow != null && parseInt(it.isShow, 10) !== 1) return;
      var nm = String(it.customName == null ? '' : it.customName), ids = [], mm;
      var re = /\{%(\d+)%\}/g;
      while ((mm = re.exec(nm)) !== null) {
        var id = parseInt(mm[1], 10);
        if (bonusIds[id] && ids.indexOf(id) < 0) ids.push(id);
      }
      if (!ids.length) return;
      var k = String(it.fieldBack || '');
      var key = k + '|' + nm;
      if (seen[key]) return;
      seen[key] = 1;
      out.push({ k: k, n: nm, t: ids });
    });
    return out;
  }

  /** 数值数据项（2026-11-27 数值检索）：所有「自定义中文名 + 数值」的项。
   *  数值口径（用户定）：常规值 = 前缀 + valueFront + 后缀；手填值(custom_covervalue) = 原样，不加前后缀。
   *  紧凑格式 vx=[[名称, 数值文本, 前缀, 后缀, 手填标志, [关联tag id…], [替换符tag id…]], …]
   *  ⚠ 物品技能无 is_show / front 恒空：无开关字段视为开启（同 bonusItems）。 */
  function valueItems(v) {
    var s = jobj(v), arr = s.ability_special_map_front, out = [], seen = {};
    if (!Array.isArray(arr) || !arr.length) {
      arr = [];
      Object.keys(s).forEach(function (k) {
        if (!/_custom_name$/.test(k)) return;
        var f = k.replace(/_custom_name$/, '');
        var it = { customName: s[k], fieldBack: f };
        if (s[f + '_is_show'] != null) it.isShow = s[f + '_is_show'];
        // 把平铺的 covervalue / prefix / suffix 挂到 it 上，和 front 统一取值
        if (s[f + '_custom_covervalue'] != null) it.customCoverValue = s[f + '_custom_covervalue'];
        if (s[f + '_custom_prefix'] != null) it.customPrefix = s[f + '_custom_prefix'];
        if (s[f + '_custom_suffix'] != null) it.customSuffix = s[f + '_custom_suffix'];
        var rt = s[f + '_custom_relatetag'];
        if (rt != null) it.customRelateTag = rt;
        arr.push(it);
      });
    }
    arr.forEach(function (it) {
      if (it.isShow != null && parseInt(it.isShow, 10) !== 1) return;
      var nm = String(it.customName == null ? '' : it.customName).trim();
      if (!nm || nm === '//') return;
      var f = String(it.fieldBack || '').replace(/_custom_name$/, '');
      // 手填值优先：covervalue 在 front 项上或平铺键上
      var cov = it.customCoverValue != null ? it.customCoverValue : s[f + '_custom_covervalue'];
      var hand = cov != null && String(cov).length > 0;
      var vf = it.valueFront != null ? it.valueFront : s[f + '_custom_value'];
      var raw = hand ? String(cov) : String(vf == null ? '' : vf);
      if (!raw.trim()) return;
      var pfx = hand ? '' : String(it.customPrefix == null ? '' : it.customPrefix);
      var sfx = hand ? '' : String(it.customSuffix == null ? '' : it.customSuffix);
      var val = pfx + raw + sfx;
      // 关联 tag：front 用 customRelateTag，平铺用 f+'_custom_relatetag'
      var rel = it.customRelateTag != null ? it.customRelateTag : s[f + '_custom_relatetag'];
      var relIds = [];
      if (Array.isArray(rel)) rel.forEach(function (x) { var id = parseInt(x, 10); if (id > 0 && relIds.indexOf(id) < 0) relIds.push(id); });
      else if (rel != null) { var id1 = parseInt(rel, 10); if (id1 > 0) relIds.push(id1); }
      // 替换符 tag（名称里的 {%id%}）
      var phIds = [], mm, re = /\{%(\d+)%\}/g;
      while ((mm = re.exec(nm)) !== null) { var tid = parseInt(mm[1], 10); if (tid > 0 && phIds.indexOf(tid) < 0) phIds.push(tid); }
      var key = f + '|' + nm + '|' + val;
      if (seen[key]) return;
      seen[key] = 1;
      out.push([nm, val, pfx, sfx, hand ? 1 : 0, relIds, phIds]);
    });
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
      ut: parseInt(x.update_time, 10) || 0,
      // 加成属性数据项（名称含 {%加成tag%} 且开启）；无则空数组
      bx: bonusItems(x.ability_special_map),
      // 数值数据项（所有自定义中文名 + 数值，供「数值检索」）；无则空数组
      vx: valueItems(x.ability_special_map)
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

  var __payload = JSON.stringify({
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
  var __r = await fetch('http://127.0.0.1:52812/raw', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: __payload
  });
  return JSON.stringify({ posted: __r.status, bytes: __payload.length,
    fetchedAt: JSON.parse(__payload).fetchedAt });
})()
