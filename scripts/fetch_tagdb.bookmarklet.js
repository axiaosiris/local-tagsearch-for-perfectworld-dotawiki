// fetch_tagdb.bookmarklet —— 「抓取书签」源码（面向仓库使用者，不含任何凭据）
//
// 用法：在**已登录**的 partner.dota2.com.cn 后台页面上点一下这个书签，
//       它会用你自己的登录态、在你的浏览器里调用官方接口，抓完直接下载 _raw.json。
//       全程不传 Cookie、不上传数据；数据只落到你自己的硬盘。
//
// 抓取内容与 scripts/fetch_tagdb.js（维护者用 refresh.sh 走 bsk）完全一致：
//   tags    = 「Tag管理」全量 [{id,name,c1,c2,sort,pid}]
//   abilities = 「技能」全量 [{i,n,en,d,g,m,f,e,note,cp,bx}]
//   bx = 加成属性数据项：名称含 {%加成tag id%} 且 isShow=1 的自定义中文名 [{k,n,t:[tag id…]}]
//   items   = 「内容管理-道具技能」全量（同上结构，构建阶段标 src='item'）
//   heroes  = 「内容管理-英雄数据」全量 [{i,zh,en,a,s}]
//   itemRefs = 现版本物品技能 id（道具数据 item/list 里「有分类（cate1 非空且非已移除/未发布）」道具的 ability_map）
//
// 注意：本文件被 scripts/build_bookmarklet.py 压成单行后内联进 index.html，
//       所以这里只用「整行 // 注释」，不要用行尾注释（压缩脚本只删整行注释）。
(async function () {
  'use strict';
  var D = document;

  if (!/^partner\.dota2\.com\.cn$/i.test(location.hostname)) {
    alert('请先在已登录的 partner.dota2.com.cn 后台页面使用本抓取书签。');
    return;
  }

  // ---------- 轻量浮层（样式全部内联，避免与后台样式冲突）----------
  var box = D.getElementById('__tsbkBox');
  if (!box) {
    box = D.createElement('div');
    box.id = '__tsbkBox';
    box.setAttribute('style', 'position:fixed;right:18px;bottom:18px;z-index:2147483647;width:336px;'
      + 'background:#101418;color:#e8eef5;border:1px solid #2c3946;border-radius:10px;padding:12px 14px;'
      + 'font:13px/1.65 system-ui,-apple-system,"Microsoft YaHei",sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.45)');
    D.body.appendChild(box);
  }
  function paint(title, body, ok) {
    box.innerHTML = '<div style="font-weight:600;color:' + (ok === false ? '#ff9d9d' : ok ? '#8fe3a8' : '#cfe3ff')
      + ';margin-bottom:4px">' + title + '</div><div style="opacity:.85">' + body + '</div>';
  }
  function step(t) { paint('正在抓取后台数据…', t); }

  step('准备中…');

  // ---------- 工具 ----------
  function jarr(v) {
    if (v == null || v === '') return [];
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') {
      try { var a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch (e) { return []; }
    }
    return [];
  }
  function ids(v) {
    if (v == null || v === '') return [];
    var out = [], arr = jarr(v);
    if (arr.length) {
      arr.forEach(function (x) { var n = parseInt(x, 10); if (!isNaN(n) && n > 0) out.push(n); });
      return out;
    }
    if (typeof v === 'string') {
      v.split(',').forEach(function (t) { var n = parseInt(t, 10); if (!isNaN(n) && n > 0) out.push(n); });
    }
    return out;
  }
  // ability_special_map（对象型 JSON 字符串）→ 对象
  function jobj(v) {
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
    if (typeof v === 'string') {
      try { var o = JSON.parse(v); return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {}; }
      catch (e) { return {}; }
    }
    return {};
  }
  // 加成属性数据项：名称含 {%加成tag id%} 且开启；按替换符检索即可，不区分数据项分区。
  // ⚠ 物品技能无 *_is_show 字段、front 恒为空数组：无开关字段视为开启，只有显式 0 才排除
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
      var k = String(it.fieldBack || ''), key = k + '|' + nm;
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

  // 单条技能记录（英雄技能 / 物品技能共用同一套字段）→ 精简结构
  function pack(x) {
    var eff = jarr(x.skill_effect).map(function (e) {
      return { n: e.effect_input || '', t: ids(e.effect_tag) };
    });
    var mech = [], feat = [];
    jarr(x.skill_mechanism).forEach(function (mm) {
      var n = parseInt(mm.mechanism_tag, 10);
      if (isNaN(n) || n <= 0) return;
      mech.push(n);
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
      cp: String(x.ability_cast_point == null ? '' : x.ability_cast_point).trim(),
      ut: parseInt(x.update_time, 10) || 0,
      bx: bonusItems(x.ability_special_map),
      // 数值数据项（所有自定义中文名 + 数值，供「数值检索」）；无则空数组
      vx: valueItems(x.ability_special_map)
    };
  }
  function getJSON(url, opt) {
    var o = opt || { credentials: 'include' };
    if (!o.credentials) o.credentials = 'include';
    return fetch(url, o).then(function (r) {
      if (r.status === 401 || r.status === 403) throw new Error('未登录或登录已过期（HTTP ' + r.status + '）');
      if (!r.ok) throw new Error('HTTP ' + r.status + ' — ' + url);
      return r.json();
    }).then(function (j) {
      // 后台统一响应体：code=0 为成功；非 0 一般是登录态失效或权限不足
      if (j && typeof j.code === 'number' && j.code !== 0) {
        throw new Error('接口返回 code=' + j.code + (j.msg ? '（' + j.msg + '）' : '') + ' —— 请确认已登录后台');
      }
      return j;
    });
  }

  try {
    // ---------- 1) Tag 全量 ----------
    var tags = [];
    for (var p = 1; p <= 50; p++) {
      step('Tag 第 ' + p + ' 页…（已 ' + tags.length + ' 条）');
      var j = await getJSON('/apg/admin/mechanism/list?page=' + p);
      var L = (j.data && j.data.list) || (j.data && j.data.data) || [];
      if (!L.length) break;
      L.forEach(function (t) {
        tags.push({ id: t.id, name: t.name, c1: t.cate1 || '', c2: t.cate2 || '', sort: t.sort, pid: t.pid });
      });
    }

    // 加成属性 tag id（tag 管理 → 图标 → 加成属性；动态取，tag 增减无需改代码）
    var bonusIds = {};
    tags.forEach(function (t) {
      if ((t.c1 || '') === '图标' && (t.c2 || '') === '加成属性') bonusIds[t.id] = 1;
    });

    // ---------- 2) 技能全量 ----------
    var abs = [], pages = 0;
    for (var p2 = 1; p2 <= 50; p2++) {
      step('技能第 ' + p2 + ' 页…（已 ' + abs.length + ' 条 / Tag ' + tags.length + '）');
      var j2 = await getJSON('/apg/admin/hero/ability?page=' + p2);
      var L2 = (j2.data && j2.data.list) || [];
      pages = p2;
      if (!L2.length) break;
      L2.forEach(function (x) { abs.push(pack(x)); });
    }

    // ---------- 2b) 物品技能全量（道具技能页；字段同英雄技能）----------
    var items = [], ipages = 0;
    for (var p3 = 1; p3 <= 30; p3++) {
      step('物品技能第 ' + p3 + ' 页…（已 ' + items.length + ' 条 / 技能 ' + abs.length + ' 条）');
      var j3 = await getJSON('/apg/admin/item/ability?page=' + p3 + '&page_size=100');
      var L3 = (j3.data && j3.data.list) || [];
      ipages = p3;
      if (!L3.length) break;
      L3.forEach(function (x) { items.push(pack(x)); });
      if (L3.length < 100) break;
    }

    // ---------- 2c) 现版本物品技能（道具数据 item/list 的 ability_map）----------
    // 只算「有分类」道具：item/list 的 cate1 非空，且不是「已移除物品」「未发布物品」
    // （2026-11-06 用户定口径）。分类为空的也不计入。
    var itemRefs = [], itemDataCount = 0;
    try {
      var refSet = {};
      for (var p4 = 1; p4 <= 12; p4++) {
        step('道具数据第 ' + p4 + ' 页…（现版本技能引用 ' + Object.keys(refSet).length + '）');
        var j4 = await getJSON('/apg/admin/item/list?page=' + p4 + '&page_size=100');
        var L4 = (j4.data && j4.data.list) || [];
        if (!L4.length) break;
        itemDataCount += L4.length;
        L4.forEach(function (it) {
          var c1 = String(it.cate1 == null ? '' : it.cate1).trim();
          if (!c1) return;
          if (c1 === '已移除物品' || c1 === '未发布物品') return;
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
    } catch (e) {
      itemRefs = [];
    }

    // ---------- 3) 英雄名册（技能归属只认 ability_map）----------
    var heroes = [];
    try {
      step('英雄名册…（技能已 ' + abs.length + ' 条）');
      var jh = await getJSON('/apg/admin/hero/list', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
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
    } catch (e) {
      heroes = [];
    }

    if (!tags.length || !abs.length) throw new Error('抓到的数据为空 —— 请确认已登录后台并有编辑权限');

    // ---------- 4) 下载 _raw.json ----------
    step('生成文件…');
    // 非英雄单位技能代码名：构建书签时由 scripts/build_bookmarklet.py 从
    // ../编写规范/非英雄单位技能.md 注入（占位 __CREEP_REFS__ 会被替换成字符串数组）
    var creepRefs = __CREEP_REFS__;
    var payload = {
      ok: true,
      fetchedAt: new Date().toISOString(),
      tagCount: tags.length,
      abilityCount: abs.length,
      itemCount: items.length,
      heroCount: heroes.length,
      itemDataCount: itemDataCount,
      itemRefCount: itemRefs.length,
      pages: pages,
      itemPages: ipages,
      tags: tags,
      abilities: abs,
      items: items,
      heroes: heroes,
      itemRefs: itemRefs,
      creepRefs: creepRefs
    };
    var txt = JSON.stringify(payload);
    var sizeKB = Math.round(txt.length / 1024);
    var url = URL.createObjectURL(new Blob([txt], { type: 'application/json' }));
    var a = D.createElement('a');
    a.href = url;
    a.download = '_raw.json';
    a.style.display = 'none';
    D.body.appendChild(a);
    a.click();
    D.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);

    paint('✓ 已下载 _raw.json（' + sizeKB + ' KB）',
      'Tag ' + tags.length + ' 条 · 技能 ' + abs.length + ' 条 · 英雄 ' + heroes.length + ' 个<br>'
      + '下一步：打开检索器 → 右上角「⟳ 更新本地数据」→「选择文件载入…」→ 选刚下载的 _raw.json'
      + '<br><span style="opacity:.6">本浮层不会自动关闭，可手动关掉浏览器标签或刷新页面。</span>', true);
  } catch (e) {
    paint('✗ 抓取失败', (e && e.message ? e.message : String(e))
      + '<br><span style="opacity:.7">若提示未登录，请先登录后台再点书签；'
      + '若书签被浏览器拦截（CSP），可在后台页按 F12 打开控制台，把书签代码粘贴进去回车。</span>', false);
  }
})();
