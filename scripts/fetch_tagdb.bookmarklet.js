// fetch_tagdb.bookmarklet —— 「抓取书签」源码（面向仓库使用者，不含任何凭据）
//
// 用法：在**已登录**的 partner.dota2.com.cn 后台页面上点一下这个书签，
//       它会用你自己的登录态、在你的浏览器里调用官方接口，抓完直接下载 _raw.json。
//       全程不传 Cookie、不上传数据；数据只落到你自己的硬盘。
//
// 抓取内容与 scripts/fetch_tagdb.js（维护者用 refresh.sh 走 bsk）完全一致：
//   tags    = 「Tag管理」全量 [{id,name,c1,c2,sort,pid}]
//   abilities = 「技能」全量 [{i,n,en,d,g,m,f,e,note,cp}]
//   items   = 「内容管理-道具技能」全量（同上结构，构建阶段标 src='item'）
//   heroes  = 「内容管理-英雄数据」全量 [{i,zh,en,a,s}]
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
      cp: String(x.ability_cast_point == null ? '' : x.ability_cast_point).trim()
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
    var payload = {
      ok: true,
      fetchedAt: new Date().toISOString(),
      tagCount: tags.length,
      abilityCount: abs.length,
      itemCount: items.length,
      heroCount: heroes.length,
      pages: pages,
      itemPages: ipages,
      tags: tags,
      abilities: abs,
      items: items,
      heroes: heroes
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
