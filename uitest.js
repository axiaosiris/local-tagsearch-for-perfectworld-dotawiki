/* uitest.js —— 界面回归测试（jsdom）
 * 复现并验证已修 bug：输入过程中每敲一个字都会插入一个 .resol，导致
 *   ① 提示重复堆叠；② box.children 被撑满 → 无法再添加第二行。
 * 运行：NODE_PATH=.../node/workspace/node_modules node uitest.js
 */
const path = require('path');
const { JSDOM } = require('jsdom');

const FILE = path.join(__dirname, 'index.html');
let fails = 0;
function ok(cond, msg, extra) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + msg + (extra === undefined ? '' : '   [' + extra + ']'));
  if (!cond) fails++;
}

JSDOM.fromFile(FILE, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true })
  .then((dom) => new Promise((r) => setTimeout(() => r(dom), 1500)))
  .then((dom) => {
    const { window } = dom;
    const doc = window.document;
    const andBox = doc.querySelector('.grp[data-k="and"] .rows');
    const addBtn = doc.querySelector('[data-add="and"]');

    ok(!!andBox, '页面初始化：找到「且」条件组');
    ok(andBox.querySelectorAll('.rowitem').length === 1, '初始 1 行', andBox.querySelectorAll('.rowitem').length);

    const inp = andBox.querySelector('input');

    // ---- 复现场景：输入 6 个字符（均无法匹配） ----
    for (const ch of '未匹配标签') {
      inp.value += ch;
      inp.dispatchEvent(new window.Event('input', { bubbles: true }));
    }
    const resolCount = andBox.querySelectorAll('.resol').length;
    ok(resolCount === 1, '打字 5 次后仍只有 1 个提示块（旧版会堆叠成 5 个）', resolCount);
    ok(andBox.children.length === 1, '提示块不再计入行数（children=1）', andBox.children.length);
    ok(inp.classList.contains('bad') === false, '输入过程中不标红（仅失焦/检索才报错）');
    const txt = andBox.querySelector('.resol').textContent;
    ok(txt.indexOf('未匹配到') === 0, '输入中显示灰色提示文案', JSON.stringify(txt));

    // ---- 仍能添加第二行（原 bug 的核心） ----
    addBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(andBox.querySelectorAll('.rowitem').length === 2, '仍可添加第二行', andBox.querySelectorAll('.rowitem').length);

    // ---- 上限 5 ----
    for (let i = 0; i < 10; i++) addBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(andBox.querySelectorAll('.rowitem').length === 5, '每类上限 5 行', andBox.querySelectorAll('.rowitem').length);
    ok(addBtn.disabled === true, '达上限后「+ 添加」按钮置灰');

    // ---- 失焦时仍未匹配 → 标红 ----
    const first = andBox.querySelector('input');
    first.dispatchEvent(new window.Event('blur', { bubbles: false }));
    ok(first.classList.contains('bad') === true, '失焦后仍未匹配 → 标红');
    ok(andBox.querySelectorAll('.resol.bad').length === 1, '标红提示恰 1 条', andBox.querySelectorAll('.resol.bad').length);

    // ---- 正确名称可解析 ----
    first.value = '防御塔';
    first.dispatchEvent(new window.Event('input', { bubbles: true }));
    const r2 = andBox.querySelector('.resol');
    ok(first.classList.contains('bad') === false && /→/.test(r2.textContent), '输入「防御塔」解析成功', r2.textContent.slice(0, 40));
    ok((first.dataset.ids || '').split(',').filter(Boolean).length >= 2, '「防御塔」解析出多档 id', first.dataset.ids);

    // ---- 删除一行后按钮恢复可用 ----
    andBox.querySelector('.rowitem .del').dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(andBox.querySelectorAll('.rowitem').length === 4, '删除一行', andBox.querySelectorAll('.rowitem').length);
    ok(addBtn.disabled === false, '删除后「+ 添加」恢复可用');

    // ---- 升级项列 ----
    const upInp = doc.querySelector('.grp[data-k="and"] .rows input');
    upInp.value = '防御塔';
    upInp.dispatchEvent(new window.Event('input', { bubbles: true }));
    doc.getElementById('btnRun').dispatchEvent(new window.Event('click', { bubbles: true }));
    const ths = Array.prototype.map.call(doc.querySelectorAll('#tblbox thead th'), (t) => t.textContent);
    ok(ths[0] === '升级项', '「升级项」是第一列（技能列左侧）', ths.join(' / '));
    const upChips = doc.querySelectorAll('#tblbox tbody td.upcell .up');
    ok(upChips.length > 0, '带升级项的技能渲染出 chip', upChips.length);
    // 每个 chip = 上图标（img 或色块）+ 下占位符文本
    const firstChip = upChips[0];
    const ico = firstChip.querySelector('.ico');
    ok(!!ico, 'chip 内含图标元素（.ico）', ico ? ico.tagName + (ico.getAttribute('src') || ico.style.background) : '无');
    const lb = (firstChip.querySelector('.lb') || {}).textContent || '';
    ok(lb.length > 0 && !/[{%}]/.test(lb), 'chip 下方显示中文名（非占位符）', lb);
    ok(/级[左右]天赋$|^神杖$|^魔晶$|^命石$/.test(lb) || lb === '饰品专属' || lb === '其他技能来源',
      '中文名符合「网页条目名去掉『升级』」口径', lb);
    // 所有 chip 的显示名都不含占位符符号，且 img 均有 src
    const allLb = Array.prototype.map.call(upChips, (c) => (c.querySelector('.lb') || {}).textContent || '');
    ok(allLb.every((s) => s.length > 0 && !/[{%}]/.test(s)), '全部升级项 chip 均显示中文名', allLb.join(' / '));
    // 占位符仍保留在 title 中
    ok(/注释中写作 \{%\d+%\}升级后/.test(firstChip.getAttribute('title') || ''),
      'title 中保留 wiki 占位符写法', firstChip.getAttribute('title'));
    const allImg = Array.prototype.filter.call(upChips, (c) => c.querySelector('img.ico'));
    ok(allImg.every((c) => /^icons\/\d+\.png$/.test(c.querySelector('img.ico').getAttribute('src'))),
      '图标指向本地 icons/<id>.png', allImg.length + ' 个（其余为纯色块）');
    const noUp = Array.prototype.filter.call(
      doc.querySelectorAll('#tblbox tbody td.upcell'),
      (td) => td.querySelectorAll('.up').length === 0);
    ok(noUp.every((td) => td.textContent.trim() === '—'), '无升级项的技能显示「—」', noUp.length + ' 行');

    // ---- 默认排除：废弃 / 自定义 / 公式残条 ----
    const showEx = doc.getElementById('showEx');
    ok(!!showEx && showEx.checked === false, '存在「包含被排除项」开关且默认关闭');
    const c2 = window.TagSearch;
    const kindOf = (id, nm) => c2.excludeKind({ i: id, n: nm });
    ok(kindOf(1, '贪魔的贪婪（废）') === 'noUse', 'excludeKind：名含「废」→ 废弃条目', kindOf(1, '贪魔的贪婪（废）'));
    ok(kindOf(20001, '任意名字') === 'custom', 'excludeKind：id ≥ 20000 → 自定义技能', kindOf(20001, '任意名字'));
    ok(kindOf(1, '-{s:value}秒 雪球冷却') === 'junk', 'excludeKind：名以「-{」开头 → 公式残条', kindOf(1, '-{s:value}秒 雪球冷却'));
    ok(kindOf(5436, '活体护甲') === null, 'excludeKind：正常技能不排除', String(kindOf(5436, '活体护甲')));
    const info0 = window.__tagsearch.info();
    ok(info0.excludedTotal > 0, '索引统计出被排除条数',
      '共 ' + info0.excludedTotal + '（' + JSON.stringify(info0.excludedBy) + '）');

    // 用「自身英雄」对比：默认排除 vs 勾选包含
    doc.getElementById('btnClear').dispatchEvent(new window.Event('click', { bubbles: true }));
    const andInp = doc.querySelector('.grp[data-k="and"] .rows input');
    andInp.value = '自身英雄';
    andInp.dispatchEvent(new window.Event('input', { bubbles: true }));
    doc.getElementById('btnRun').dispatchEvent(new window.Event('click', { bubbles: true }));
    const nDefault = +doc.getElementById('nHit').textContent;
    const ib1 = (doc.querySelector('.infobox') || {}).textContent || '';
    ok(/已默认排除/.test(ib1), '默认检索时结果区提示排除条数', ib1.replace(/\s+/g, ' ').slice(0, 58));

    showEx.checked = true;
    showEx.dispatchEvent(new window.Event('change', { bubbles: true }));
    const nAll = +doc.getElementById('nHit').textContent;
    ok(nAll > nDefault, '勾选「包含被排除项」后命中数增加', nDefault + ' → ' + nAll);
    const exRows = doc.querySelectorAll('#tblbox tbody tr.ex');
    ok(exRows.length > 0, '被排除的行带 .ex 类（灰显）', exRows.length + ' 行');
    ok(doc.querySelectorAll('#tblbox tbody .xmark').length === exRows.length,
      '被排除行均带原因标记', doc.querySelectorAll('#tblbox tbody .xmark').length);
    const ib2 = (doc.querySelector('.infobox') || {}).textContent || '';
    ok(/已包含/.test(ib2), '勾选后提示切换为「已包含」', ib2.replace(/\s+/g, ' ').slice(0, 50));

    showEx.checked = false;
    showEx.dispatchEvent(new window.Event('change', { bubbles: true }));
    ok(+doc.getElementById('nHit').textContent === nDefault, '取消勾选后恢复默认命中数',
      doc.getElementById('nHit').textContent + ' vs ' + nDefault);
    ok(doc.querySelectorAll('#tblbox tbody tr.ex').length === 0, '取消勾选后无灰显行',
      doc.querySelectorAll('#tblbox tbody tr.ex').length);

    // ---- 简/详 展示切换 ----
    doc.getElementById('btnClear').dispatchEvent(new window.Event('click', { bubbles: true }));
    const inA = doc.querySelector('.grp[data-k="and"] .rows input');
    inA.value = '防御塔';
    inA.dispatchEvent(new window.Event('input', { bubbles: true }));
    doc.getElementById('btnRun').dispatchEvent(new window.Event('click', { bubbles: true }));

    const btnView = doc.getElementById('btnView');
    ok(!!btnView, '结果区上方存在「简/详」切换按钮', btnView && btnView.textContent.trim());
    ok(doc.querySelectorAll('#tblbox table').length === 1 && !doc.querySelector('#tblbox table.cmp'),
      '默认是详细展示（表格无 .cmp 类）');
    const fullTds = doc.querySelectorAll('#tblbox tbody tr')[0].querySelectorAll('td').length;
    ok(fullTds === 6, '详细模式每行 6 列（升级项/技能/ID/命中详情/tag 数/详情）', fullTds);

    btnView.dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(doc.querySelectorAll('#tblbox .cmpgrid').length === 1 && !doc.querySelector('#tblbox thead'),
      '切换后进入简洁展示（.cmpgrid 且无表头）');
    ok(doc.querySelectorAll('#tblbox table').length === 0, '简洁模式不再是「一行一个技能」的表格');
    const cItems = doc.querySelectorAll('#tblbox .cmpgrid > .cmitem');
    ok(cItems.length > 0, '简洁模式有技能块', cItems.length + ' 块');
    // 每块都必须同时含「升级项」与「技能名」——两者绑在同一个元素里，换行时整体一起换行
    ok(Array.prototype.every.call(cItems, (e) => !!e.querySelector('.cmup') && !!e.querySelector('.cname')),
      '每块都是一个整体（.cmup 升级项 + .cname 技能名，不可拆分）');
    ok(Array.prototype.every.call(cItems, (e) => e.children.length >= 2 && e.tagName === 'DIV'),
      '升级项与技能名同属一个块级容器，换行不会分离');
    ok(!!cItems[0].querySelector('.cmup .mico') || !!cItems[0].querySelector('.cmup .noico'),
      '简洁模式升级项区只渲染图标（.mico / 无图占位）');
    // 容器可换行：flex-wrap + 每块 min-width 固定，数量由浏览器按宽度自动决定
    const css = doc.querySelector('style').textContent;
    const wrapRule = (css.match(/\.cmpgrid\{[^}]*\}/) || [''])[0];
    ok(/display:flex/.test(wrapRule) && /flex-wrap:wrap/.test(wrapRule),
      '容器为 flex + flex-wrap:wrap（每行数量随浏览器宽度自适应）', wrapRule.replace(/\s+/g, ' '));
    const itemRule = (css.match(/\.cmitem\{[^}]*\}/) || [''])[0];
    ok(/flex:0 0 auto/.test(itemRule) && /min-width:\d+px/.test(itemRule),
      '技能块不压缩、有最小宽度（一行可容纳更多技能）', itemRule.replace(/\s+/g, ' '));
    const names2 = Array.prototype.map.call(doc.querySelectorAll('#tblbox .cmpgrid .cname'),
      (e) => e.textContent.trim());
    ok(names2.length === cItems.length && names2.every((s) => s.length > 0),
      '简洁模式每块显示技能名', names2.slice(0, 3).join(' / '));
    ok(doc.querySelectorAll('#tblbox .cmpgrid .chip').length === 0, '简洁模式不显示命中详情 chip');
    ok(doc.querySelectorAll('#tblbox .cmpgrid td.id, #tblbox .cmpgrid .count').length === 0,
      '简洁模式不显示 ID 列与 tag 数列');
    ok(/详细展示/.test(btnView.textContent), '按钮文案切换为「详细展示」', btnView.textContent.trim());
    ok(btnView.classList.contains('on'), '简洁模式按钮呈激活态');

    doc.querySelector('#tblbox .cmpgrid .cname').dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(doc.getElementById('mask').classList.contains('on'), '简洁模式点击技能名仍可打开详情');
    doc.getElementById('mClose').dispatchEvent(new window.Event('click', { bubbles: true }));

    btnView.dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(doc.querySelectorAll('#tblbox .cmpgrid').length === 0 &&
      doc.querySelectorAll('#tblbox table').length === 1 && !!doc.querySelector('#tblbox thead'),
      '再点一次复原为详细展示');
    ok(/简洁展示/.test(btnView.textContent), '按钮文案复原为「简洁展示」', btnView.textContent.trim());
    ok(!btnView.classList.contains('on'), '复原后按钮取消激活态');

    // ---- 清空 ----
    doc.getElementById('btnClear').dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(doc.querySelectorAll('.rowitem').length === 3, '清空后三类各留 1 行', doc.querySelectorAll('.rowitem').length);
    ok(doc.querySelectorAll('.resol').length === 0, '清空后无残留提示块', doc.querySelectorAll('.resol').length);

    // ---- 技能特性内容（命中技能特性时详细展示里给出特性内容） ----
    const featInp = doc.querySelector('.grp[data-k="and"] .rows input');
    featInp.value = '幻象不继承';
    featInp.dispatchEvent(new window.Event('input', { bubbles: true }));
    doc.getElementById('btnRun').dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(+doc.getElementById('nHit').textContent > 0, '检索「幻象不继承」有命中',
      doc.getElementById('nHit').textContent);
    const featEls = doc.querySelectorAll('#tblbox tbody .chip .feat');
    ok(featEls.length > 0, '详细模式在命中技能特性的 chip 内展示特性内容', featEls.length + ' 条');
    ok(doc.querySelectorAll('#tblbox tbody .chip .feat b').length === featEls.length,
      '每条特性内容前都带特性名（<b>）');
    const featTxt = featEls[0].textContent.trim();
    ok(featTxt.length > 8 && /本技能/.test(featTxt), '特性内容为完整描述句',
      JSON.stringify(featTxt.slice(0, 36)));
    ok(/@ 技能特性/.test(featEls[0].closest('.chip').textContent), 'chip 仍保留命中位置提示（@ 技能特性）');

    doc.querySelector('#tblbox tbody [data-detail]').dispatchEvent(new window.Event('click', { bubbles: true }));
    const mbody = doc.getElementById('mBody').textContent;
    ok(/技能特性（机制项）/.test(mbody), '详情面板含「技能特性（机制项）」区');
    ok(doc.querySelectorAll('#mBody .feattext').length > 0, '详情面板同样展示特性内容',
      doc.querySelectorAll('#mBody .feattext').length);
    doc.getElementById('mClose').dispatchEvent(new window.Event('click', { bubbles: true }));

    btnView.dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(doc.querySelectorAll('#tblbox .cmpgrid .feat').length === 0, '简洁模式不展示特性内容（仍只有图标+技能名）');
    btnView.dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(doc.querySelectorAll('#tblbox tbody .chip .feat').length > 0, '切回详细模式后特性内容恢复显示');
    doc.getElementById('btnClear').dispatchEvent(new window.Event('click', { bubbles: true }));

    // ---- 更新本地数据：入口与钩子 ----
    const updBtn = doc.getElementById('btnUpdate');
    ok(!!updBtn, '右上角存在「更新本地数据」按钮', updBtn && updBtn.textContent.trim());
    ok(!!doc.getElementById('updMask'), '更新面板存在');
    updBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(doc.getElementById('updMask').classList.contains('on'), '点击按钮打开更新面板');
    ok(!!window.__tagsearch && typeof window.__tagsearch.loadFromText === 'function', '暴露调试钩子 __tagsearch');

    // ---- 载入 _raw.json 内容：转换 + 应用 ----
    const raw = {
      ok: true, fetchedAt: '2026-10-16T00:00:00.000Z',
      tags: [{ id: 488, name: '治疗', cate1: '机制', cate2: '包含效果' },
             { id: 844, name: '友方防御塔', cate1: '目标', cate2: '目标' }],
      abilities: [{ i: 9001, n: '测试技能', en: 'test', d: [844], g: [], m: [], e: [{ n: '', t: [488] }] }]
    };
    window.__tagsearch.loadFromText(JSON.stringify(raw), '_raw.json');
    ok(doc.getElementById('mAbs').textContent === '1', '_raw.json 载入后技能数更新为 1', doc.getElementById('mAbs').textContent);
    ok(doc.getElementById('mTags').textContent === '2', '载入后 tag 数更新为 2', doc.getElementById('mTags').textContent);
    ok(new RegExp('已载入数据').test(doc.getElementById('updLog').textContent), '日志记录载入成功');

    // 载入后检索仍可用（新数据生效）
    const inp2 = doc.querySelector('.grp[data-k="and"] .rows input');
    inp2.value = '防御塔';
    inp2.dispatchEvent(new window.Event('input', { bubbles: true }));
    doc.getElementById('btnRun').dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(doc.getElementById('nHit').textContent === '1', '新数据下检索生效（命中 1）', doc.getElementById('nHit').textContent);

    // ---- 无法识别的文件 ----
    window.__tagsearch.loadFromText('这不是数据', 'x.txt');
    ok(/无法识别文件内容/.test(doc.getElementById('updLog').textContent), '非法文件给出明确提示');

    console.log(fails ? `\n${fails} 项失败` : '\n全部通过');
    process.exit(fails ? 1 : 0);
  })
  .catch((e) => { console.error(e); process.exit(2); });
