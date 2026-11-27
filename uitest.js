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

    // ---- 技能来源默认状态（现版本英雄 / 现版本物品 / 现版本非英雄单位 勾选；目录外 / 非现版本物品默认不勾）----
    const sChips0 = Array.prototype.slice.call(doc.querySelectorAll('#srcList .schip'));
    ok(sChips0.length >= 5, '来源列表至少 5 类（现版本英雄 / 现版本物品 / 现版本非英雄单位 / 目录外 / 非现版本物品）', sChips0.length);
    ok(/现版本英雄技能/.test(sChips0[0].textContent) && sChips0[0].querySelector('input').checked,
      '「现版本英雄技能」默认勾选');
    ok(/现版本物品技能/.test(sChips0[1].textContent) && sChips0[1].querySelector('input').checked,
      '「现版本物品技能」默认勾选（第 2 位）');
    ok(/现版本非英雄单位技能/.test(sChips0[2].textContent) && sChips0[2].querySelector('input').checked,
      '「现版本非英雄单位技能」第 3 位且默认勾选');
    ok(/目录外技能/.test(sChips0[3].textContent) && !sChips0[3].querySelector('input').checked,
      '「目录外技能」第 4 位、默认不勾（旧版本残留不参与检索）');
    ok(/已选 3 \/ \d+ 类/.test(doc.getElementById('srcSum').textContent), '来源摘要显示「已选 3 / N 类」',
      doc.getElementById('srcSum').textContent);
    ok(+sChips0[0].querySelector('.cnt').textContent.replace(/\D/g, '') === window.__tagsearch.info().heroedSkills,
      '「现版本英雄技能」条数 = 有 ability_map 归属的条目数',
      sChips0[0].querySelector('.cnt').textContent.trim());
    // 后续用例按「全部来源」口径跑（含目录外，等价于改造前的全库行为）
    window.__tagsearch.setSources(['hero', 'item', 'orphan', 'itemOld']);

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

    // ---- 升级项（2026-11-27 改版：不再单占一行、不再写「升级项」字样，与命中位置 chip 同行）----
    const upInp = doc.querySelector('.grp[data-k="and"] .rows input');
    upInp.value = '防御塔';
    upInp.dispatchEvent(new window.Event('input', { bubbles: true }));
    doc.getElementById('btnRun').dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(!!doc.querySelector('#tblbox .skillgrid'), 'Tag 详细模式改用等宽技能卡片网格');
    ok(!doc.querySelector('#tblbox .skillcard .tagup') &&
      !/升级项/.test(doc.getElementById('tblbox').textContent), '卡片内不再出现「升级项」字样与其独立区块');
    // ---- 2026-11-27：tags 字段维度整体移除（后台数据过时）----
    const scLabels = Array.prototype.slice.call(doc.querySelectorAll('.scope label'));
    ok(scLabels.length === 3 && !doc.getElementById('scG'),
      '匹配范围只剩 技能类型/技能效果/技能特性 三项（tags 字段已移除）', scLabels.length);
    ok(!/tags\s*字段/.test(doc.getElementById('tblbox').textContent),
      '结果卡片里不再出现「tags字段」命中位置提示');
    const upChips = doc.querySelectorAll('#tblbox .skillcard .tagitems .ups.inl .up');
    ok(upChips.length > 0, '带升级项的技能渲染出 chip', upChips.length);
    // 升级项 chip 与命中位置 chip 在同一行容器内，且排在其前面
    const upRow = upChips[0] && upChips[0].closest('.tagitems');
    ok(!!upRow && !!upRow.querySelector('.chip'), '升级项与命中位置 chip 处于同一行容器',
      upRow ? Array.prototype.map.call(upRow.children, (e) => e.className.split(' ')[0]).join(',') : '无');
    ok(!!upRow && !!(upRow.firstElementChild.compareDocumentPosition(upRow.querySelector('.chip')) & 4),
      '升级项 chip 排在命中位置 chip 之前');
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
      doc.querySelectorAll('#tblbox .skillcard'),
      (card) => !card.querySelector('.ups.inl'));
    ok(noUp.every((card) => !card.querySelector('.ups') && !/升级项/.test(card.textContent)),
      '无升级项的技能不渲染升级项 chip', noUp.length + ' 张卡片');

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
    const exRows = doc.querySelectorAll('#tblbox .skillcard.ex');
    ok(exRows.length > 0, '被排除的卡片带 .ex 类（灰显）', exRows.length + ' 张');
    ok(doc.querySelectorAll('#tblbox .skillcard .xmark').length === exRows.length,
      '被排除卡片均带原因标记', doc.querySelectorAll('#tblbox .skillcard .xmark').length);
    const ib2 = (doc.querySelector('.infobox') || {}).textContent || '';
    ok(/已包含/.test(ib2), '勾选后提示切换为「已包含」', ib2.replace(/\s+/g, ' ').slice(0, 50));

    showEx.checked = false;
    showEx.dispatchEvent(new window.Event('change', { bubbles: true }));
    ok(+doc.getElementById('nHit').textContent === nDefault, '取消勾选后恢复默认命中数',
      doc.getElementById('nHit').textContent + ' vs ' + nDefault);
    ok(doc.querySelectorAll('#tblbox .skillcard.ex').length === 0, '取消勾选后无灰显卡片',
      doc.querySelectorAll('#tblbox .skillcard.ex').length);

    // ---- 简/详 展示切换 ----
    doc.getElementById('btnClear').dispatchEvent(new window.Event('click', { bubbles: true }));
    const inA = doc.querySelector('.grp[data-k="and"] .rows input');
    inA.value = '防御塔';
    inA.dispatchEvent(new window.Event('input', { bubbles: true }));
    doc.getElementById('btnRun').dispatchEvent(new window.Event('click', { bubbles: true }));

    const btnView = doc.getElementById('btnView');
    ok(!!btnView, '结果区上方存在「简/详」切换按钮', btnView && btnView.textContent.trim());
    ok(doc.querySelectorAll('#tblbox .skillgrid').length === 1 && !doc.querySelector('#tblbox .cmpgrid'),
      '默认是详细展示（等宽技能卡片网格）');
    ok(doc.querySelectorAll('#tblbox .skillcard [data-detail]').length > 0, '详细卡片保留「详情」按钮');
    ok(!/tag 数/.test(doc.getElementById('tblbox').textContent), '详细卡片不再显示 tag 数');
    ok(!/施法前摇/.test(doc.getElementById('tblbox').textContent), '未填前摇条件时不显示前摇段');

    btnView.dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(doc.querySelectorAll('#tblbox .cmpgrid').length === 1 && !doc.querySelector('#tblbox .skillgrid'),
      '切换后进入简洁展示（.cmpgrid，无卡片网格）');
    ok(doc.querySelectorAll('#tblbox .skillcard').length === 0, '简洁模式不再使用技能卡片');
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
      doc.querySelectorAll('#tblbox .skillgrid').length === 1 && !!doc.querySelector('#tblbox .skillcard [data-detail]'),
      '再点一次复原为详细展示');
    ok(/简洁展示/.test(btnView.textContent), '按钮文案复原为「简洁展示」', btnView.textContent.trim());
    ok(!btnView.classList.contains('on'), '复原后按钮取消激活态');

    // ---- Tag 结果只显示效果位置；升级项仅在前后效果 tag 有差异时展示 ----
    const runTagQ = (q) => {
      doc.getElementById('btnClear').dispatchEvent(new window.Event('click', { bubbles: true }));
      const el = doc.querySelector('.grp[data-k="and"] .rows input');
      el.value = q;
      el.dispatchEvent(new window.Event('input', { bubbles: true }));
      doc.getElementById('btnRun').dispatchEvent(new window.Event('click', { bubbles: true }));
    };
    const cardOf = (nm) => Array.prototype.find.call(doc.querySelectorAll('#tblbox .skillcard'),
      (c) => ((c.querySelector('.scnm') || {}).textContent || '').indexOf(nm) >= 0);

    runTagQ('百分比护甲穿透');
    const tide = cardOf('潮汐使者');
    ok(!!tide, '检索「百分比护甲穿透」命中潮汐使者');
    ok(/效果5「潮汐使者护甲穿透」/.test(tide.querySelector('.tagitems').textContent),
      '卡片只显示 效果5「潮汐使者护甲穿透」', tide.querySelector('.tagitems').textContent.trim());
    ok(!/百分比护甲穿透/.test(tide.querySelector('.tagitems').textContent),
      '结果卡片不重复显示被检索的 tag 名');
    ok(!tide.querySelector('.ups'), '潮汐使者：该效果只有一个版本 → 不显示升级项');

    runTagQ('无敌');
    const astral = cardOf('星体禁锢');
    ok(!!astral, '检索「无敌」命中星体禁锢');
    ok(/效果2「星体禁锢（友方）」/.test(astral.querySelector('.tagitems').textContent),
      '卡片只显示 效果2「星体禁锢（友方）」', astral.querySelector('.tagitems').textContent.trim());
    ok(!!astral.querySelector('.tagitems .ups.inl') && /魔晶/.test(astral.querySelector('.tagitems .ups.inl').textContent),
      '星体禁锢：只有魔晶升级才有无敌 → 显示升级项');

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
    const featEls = doc.querySelectorAll('#tblbox .skillcard .chip .feat');
    ok(featEls.length > 0, '详细卡片在命中技能特性的 chip 内展示特性内容', featEls.length + ' 条');
    ok(doc.querySelectorAll('#tblbox .skillcard .chip .feat b').length === featEls.length,
      '每条特性内容前都带特性名（<b>）');
    const featTxt = featEls[0].textContent.trim();
    ok(featTxt.length > 8 && /本技能/.test(featTxt), '特性内容为完整描述句',
      JSON.stringify(featTxt.slice(0, 36)));
    ok(/^技能特性/.test(featEls[0].closest('.chip').textContent.trim()), 'chip 只显示命中位置（技能特性），不重复 tag 名');

    // ---- 命中数下方重述检索条件 ----
    const qc = doc.getElementById('qCond');
    ok(qc.style.display !== 'none' && /包含【幻象不继承】/.test(qc.textContent),
      '命中数下方显示「包含【…】」条件', qc.textContent);
    const qOr = doc.querySelector('.grp[data-k="or"] .rows input');
    qOr.value = '治疗';
    qOr.dispatchEvent(new window.Event('input', { bubbles: true }));
    const qNot = doc.querySelector('.grp[data-k="not"] .rows input');
    qNot.value = '无敌';
    qNot.dispatchEvent(new window.Event('input', { bubbles: true }));
    doc.getElementById('btnRun').dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(/包含【幻象不继承】；至少包含【治疗】；排除【无敌】/.test(qc.textContent),
      '条件行按「包含 / 至少包含 / 排除」顺序重述', qc.textContent);
    qNot.value = ''; qOr.value = '';
    qNot.dispatchEvent(new window.Event('input', { bubbles: true }));
    qOr.dispatchEvent(new window.Event('input', { bubbles: true }));

    doc.querySelector('#tblbox .skillcard [data-detail]').dispatchEvent(new window.Event('click', { bubbles: true }));
    const mbody = doc.getElementById('mBody').textContent;
    ok(/技能特性（机制项）/.test(mbody), '详情面板含「技能特性（机制项）」区');
    ok(doc.querySelectorAll('#mBody .feattext').length > 0, '详情面板同样展示特性内容',
      doc.querySelectorAll('#mBody .feattext').length);
    doc.getElementById('mClose').dispatchEvent(new window.Event('click', { bubbles: true }));

    btnView.dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(doc.querySelectorAll('#tblbox .cmpgrid .chip .feat').length === 0, '简洁模式不展示特性内容（仍只有图标+技能名）');
    btnView.dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(doc.querySelectorAll('#tblbox .skillcard .chip .feat').length > 0, '切回详细模式后特性内容恢复显示');
    doc.getElementById('btnClear').dispatchEvent(new window.Event('click', { bubbles: true }));

    // ---- 更新本地数据：入口与钩子 ----
    const updBtn = doc.getElementById('btnUpdate');
    ok(!!updBtn, '右上角存在「更新本地数据」按钮', updBtn && updBtn.textContent.trim());
    ok(!!doc.getElementById('updMask'), '更新面板存在');
    updBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(doc.getElementById('updMask').classList.contains('on'), '点击按钮打开更新面板');
    ok(!!window.__tagsearch && typeof window.__tagsearch.loadFromText === 'function', '暴露调试钩子 __tagsearch');
    ok(!doc.getElementById('updRun') && !/方式三/.test(doc.getElementById('updMask').textContent),
      '更新面板只剩方式一 / 方式二（方式三「本机服务一键更新」已删除）');

    // ---- 载入 _raw.json 内容：转换 + 应用 ----
    const raw = {
      ok: true, fetchedAt: '2026-10-16T00:00:00.000Z',
      tags: [{ id: 488, name: '治疗', cate1: '机制', cate2: '包含效果' },
             { id: 844, name: '友方防御塔', cate1: '目标', cate2: '目标' }],
      abilities: [{ i: 9001, n: '测试技能', en: 'test', d: [844], g: [], m: [], e: [{ n: '', t: [488] }] }]
    };
    window.__tagsearch.loadFromText(JSON.stringify(raw), '_raw.json');
    ok(doc.getElementById('mTime').textContent !== '—', '_raw.json 载入后页头显示快照时间',
      doc.getElementById('mTime').textContent);
    ok(!doc.getElementById('mAbs') && !doc.getElementById('mTags') && !doc.getElementById('mNotes') &&
      !doc.getElementById('mDup'), '页头统计只保留快照时间（tag/技能/英雄/注释/同名 已去掉）');
    // 页头右上：截图（预留）+ 更新本地图标 + 更新本地数据
    const hdIds = Array.prototype.map.call(
      doc.querySelectorAll('.hdact .btn'), (b) => b.id);
    ok(hdIds.join(',') === 'btnShot,btnIcon,btnUpdate', '右上三个按钮顺序：截图 / 更新本地图标 / 更新本地数据',
      hdIds.join(','));
    doc.getElementById('btnIcon').dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(doc.getElementById('icoMask').classList.contains('on'), '点「更新本地图标」打开教程弹窗');
    ok(/icons/.test(doc.getElementById('icoMask').textContent), '教程说明把图标复制进 icons 文件夹');
    ok(/spellicons/.test(doc.getElementById('icoMask').textContent) &&
      /other_icons/.test(doc.getElementById('icoMask').textContent), '教程列出各图标子目录');
    doc.getElementById('icoClose').dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(!doc.getElementById('icoMask').classList.contains('on'), '教程弹窗可关闭');
    doc.getElementById('btnShot').dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(doc.getElementById('toast').classList.contains('on') &&
      /先检索一次/.test(doc.getElementById('toast').textContent), '未检索时点「截图」提示先检索',
      doc.getElementById('toast').textContent);
    // 截图文件名规则：包含A、B_至少包含C_排除D_YYYY-MM-DD_HHmm.png（没有的组忽略）
    var nm = window.__tagsearch.shotName({ and: ['缠绕', '缴械'], or: ['沉默'], not: ['锁闭'] });
    ok(/^包含缠绕、缴械_至少包含沉默_排除锁闭_\d{4}-\d{2}-\d{2}_\d{4}\.png$/.test(nm),
      '截图文件名按「包含_至少包含_排除_时间(到分)」拼装', nm);
    var nm2 = window.__tagsearch.shotName({ and: ['缠绕'], or: [], not: [] });
    ok(/^包含缠绕_\d{4}-\d{2}-\d{2}_\d{4}\.png$/.test(nm2), '没有的筛选条件忽略', nm2);
    var nm3 = window.__tagsearch.shotName(null);
    ok(/^\d{4}-\d{2}-\d{2}_\d{4}\.png$/.test(nm3), '无条件时只留时间', nm3);
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

    // ================= 注释检索（独立功能，与 Tag 检索互不影响） =================
    const noteDb = {
      fetchedAt: '2026-10-22T00:00:00.000Z',
      tags: [{ id: 488, name: '治疗', c1: '机制', c2: '包含效果' }],
      notePool: [
        '光环有0.1秒的粘滞时间。',
        '受到来自玩家及其控制的单位大于等于40点伤害后，一层屏障将被移除。',
        '状态栏会显示当前的陵卫斗篷层数。'
      ],
      abilities: [
        { i: 9101, n: '甲技能', en: 'alpha', d: [488], g: [], m: [], e: [], nt: [0, 1], ni: [0, 1] },
        { i: 9102, n: '乙技能', en: 'beta', d: [], g: [], m: [], e: [], nt: [0] },
        { i: 9103, n: '丙技能', en: 'gamma', d: [], g: [], m: [], e: [], nt: [2] },
        { i: 9104, n: '丁技能', en: 'delta', d: [], g: [], m: [], e: [] }
      ]
    };
    window.__tagsearch.applyDb(noteDb, '合成测试数据');
    ok(doc.getElementById('mTime').textContent !== '—', '页头只剩快照时间（不再显示注释行数）',
      doc.getElementById('mTime').textContent);

    // Tag 模式先留一份结果（用于验证「互不影响」）
    const tagInp2 = doc.querySelector('.grp[data-k="and"] .rows input');
    tagInp2.value = '治疗';
    tagInp2.dispatchEvent(new window.Event('input', { bubbles: true }));
    doc.getElementById('btnRun').dispatchEvent(new window.Event('click', { bubbles: true }));
    const nTag = +doc.getElementById('nHit').textContent;
    ok(nTag === 1, '合成数据下 Tag 检索命中 1', nTag);

    // 切到注释模式
    const mNote = doc.querySelector('#modes .mbtn[data-mode="note"]');
    const mTag = doc.querySelector('#modes .mbtn[data-mode="tag"]');
    ok(!!mNote && !!mTag, '页头存在「Tag 检索 / 注释检索」模式切换');
    mNote.dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(window.__tagsearch.mode() === 'note', '点击后进入注释模式');
    ok(doc.getElementById('paneTag').style.display === 'none' &&
      doc.getElementById('paneNote').style.display !== 'none', '同一时间只显示一种检索面板');
    ok(mNote.classList.contains('on') && !mTag.classList.contains('on'), '模式按钮激活态随之切换');
    ok(/要查找的注释内容/.test(doc.getElementById('tblbox').textContent), '注释模式空态提示与模式一致',
      doc.getElementById('tblbox').textContent.trim());

    // 检索
    const q = doc.getElementById('noteQ');
    ok(!!q, '存在注释输入框');
    ok(doc.getElementById('btnRunN').textContent.trim() === '确认检索', '注释面板有「确认检索」按钮');
    q.value = '粘滞';
    doc.getElementById('btnRunN').dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(+doc.getElementById('nHit').textContent === 2, '注释检索「粘滞」命中 2 个技能',
      doc.getElementById('nHit').textContent);
    const nThs = Array.prototype.map.call(doc.querySelectorAll('#tblbox thead th'), (t) => t.textContent);
    ok(nThs[0] === '升级项' && /命中行/.test(nThs[3]), '注释模式表头为「升级项 / 技能 / ID / 命中行…」',
      nThs.join(' / '));
    ok(doc.querySelectorAll('#tblbox tbody .nline').length >= 2, '每行展示命中的注释原文行',
      doc.querySelectorAll('#tblbox tbody .nline').length);
    const marks = doc.querySelectorAll('#tblbox tbody mark');
    ok(marks.length >= 2 && /粘滞/.test(marks[0].textContent), '命中关键词标黄', marks.length + ' 处');
    ok(doc.querySelectorAll('#tblbox tbody .xmark').length === 0, '默认不含被排除项时无原因标记');
    ok(!doc.querySelector('#tblbox tbody td.count'), '注释结果表已无「命中」列（命中行数 / 总行数）');

    // 多词 AND
    q.value = '粘滞 层数';
    doc.getElementById('btnRunN').dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(doc.getElementById('nHit').textContent === '0', '空格分隔多词 = 需同时包含（AND）',
      doc.getElementById('nHit').textContent);
    q.value = '粘滞';
    doc.getElementById('btnRunN').dispatchEvent(new window.Event('click', { bubbles: true }));

    // 详情：完整注释 + 命中行高亮（按技能名定位行，排序为命中数优先，不假定行序）
    const rowOf = (nm) => Array.prototype.find.call(
      doc.querySelectorAll('#tblbox tbody tr'),
      (tr) => ((tr.querySelector('td.nm') || {}).textContent || '').indexOf(nm) >= 0);
    const rowA = rowOf('甲技能');
    ok(!!rowA, '列表中能找到「甲技能」（2 行注释、命中 1 行）');
    rowA.querySelector('[data-detail]').dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(doc.getElementById('mask').classList.contains('on'), '注释模式点「详情」可打开弹窗');
    const allLis = doc.querySelectorAll('#mBody .noteall li');
    ok(allLis.length === 2, '详情展示该技能全部注释行', allLis.length);
    ok(doc.querySelectorAll('#mBody .noteall li.hit').length === 1, '详情内命中行带高亮类',
      doc.querySelectorAll('#mBody .noteall li.hit').length);
    ok(/L1/.test(allLis[0].textContent) && /L2/.test(allLis[1].textContent), '详情逐行给出行号（L1 / L2）');
    ok(allLis[1].style.paddingLeft === '14px', '缩进层级体现在行内边距', allLis[1].style.paddingLeft || '(无)');
    doc.getElementById('mClose').dispatchEvent(new window.Event('click', { bubbles: true }));

    // 注释模式固定详细展示，不提供简/详按钮；结果表无「命中」列
    ok(doc.getElementById('btnView').style.display === 'none', '注释模式隐藏「简/详」按钮',
      doc.getElementById('btnView').style.display);
    const noteThs = Array.prototype.map.call(doc.querySelectorAll('#tblbox thead th'), (t) => t.textContent.trim());
    ok(noteThs.length === 5 && !noteThs.includes('命中'), '注释模式结果表固定 5 列且无「命中」列',
      noteThs.join(' / '));
    ok(doc.querySelectorAll('#tblbox tbody .nline').length > 0, '注释命中行仍在详细表格中');

    // 互不影响：切回 Tag 模式应还原之前的 Tag 结果
    mTag.dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(+doc.getElementById('nHit').textContent === nTag, '切回 Tag 模式还原原结果（不受注释检索影响）',
      doc.getElementById('nHit').textContent + ' vs ' + nTag);
    ok(!!doc.querySelector('#tblbox .skillcard .chip') && !doc.querySelector('#tblbox .nline'),
      'Tag 模式恢复详细卡片命中 chip，不残留注释行');

    mNote.dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(+doc.getElementById('nHit').textContent === 2, '再切回注释模式还原注释结果',
      doc.getElementById('nHit').textContent);

    // 清空
    doc.getElementById('btnClearN').dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(q.value === '' && +doc.getElementById('nHit').textContent === 0, '注释「清空」清掉输入与结果');
    doc.getElementById('btnRunN').dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(/请输入要查找的注释内容/.test(doc.getElementById('tblbox').textContent), '空输入时给出提示');

    // 旧快照（无 notePool）→ 明确提示
    window.__tagsearch.applyDb({
      fetchedAt: '', tags: noteDb.tags,
      abilities: [{ i: 9201, n: '无注释技能', en: 'x', d: [], g: [], m: [], e: [] }]
    }, '旧快照');
    mNote.dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(/不含注释内容/.test(doc.getElementById('noteWarn').textContent), '数据无注释时提示重新抓取',
      doc.getElementById('noteWarn').textContent.trim().slice(0, 30));
    ok(!doc.getElementById('mNotes'), '页头不再显示注释统计');

    // ================= 施法前摇筛选（可与 tag 条件同时使用） =================
    const cpDb = {
      fetchedAt: '2026-10-22T00:00:00.000Z',
      tags: [{ id: 488, name: '治疗', c1: '机制', c2: '包含效果' },
             { id: 489, name: '护盾', c1: '机制', c2: '包含效果' }],
      notePool: [],
      abilities: [
        { i: 9301, n: '零前摇', en: 'a0', d: [488], g: [], m: [], e: [], cp: '0' },
        { i: 9302, n: '零点二', en: 'a2', d: [488], g: [], m: [], e: [], cp: '0.2' },
        { i: 9303, n: '零点一五', en: 'a15', d: [488, 489], g: [], m: [], e: [], cp: '0.15' },
        { i: 9304, n: '零带备注', en: 'a0n', d: [488], g: [], m: [], e: [], cp: '0（魔晶）' },
        { i: 9305, n: '无前摇数据', en: 'an', d: [488], g: [], m: [], e: [] },
        { i: 9306, n: '双值技能', en: 'am', d: [488], g: [], m: [], e: [], cp: '0.67/0.5（古龙形态）' }
      ]
    };
    window.__tagsearch.applyDb(cpDb, '合成测试数据（前摇）');
    mTag.dispatchEvent(new window.Event('click', { bubbles: true }));

    ok(!!doc.getElementById('cpMin') && !!doc.getElementById('cpMax'), '左栏存在「施法前摇」最小/最大输入框');
    ok(!!doc.getElementById('cpEq0') && !!doc.getElementById('cpLe015') && !!doc.getElementById('cpReset'),
      '存在前摇快捷按钮（=0 / ≤0.15 / 清空）');

    const cpMin = doc.getElementById('cpMin'), cpMax = doc.getElementById('cpMax');
    const tagInp3 = doc.querySelector('.grp[data-k="and"] .rows input');
    const runBtn = doc.getElementById('btnRun');
    const cpNames = () => Array.prototype.map.call(
      doc.querySelectorAll('#tblbox .skillcard .scnm'), (e) => e.textContent.replace(/[#\d]/g, '').replace(/[a-z_]+$/, '').trim());

    // ① 0~0 = 恰为 0（含「0（魔晶）」这种带备注的写法），排除 0.2 / 0.15 / 无数据
    tagInp3.value = '治疗';
    tagInp3.dispatchEvent(new window.Event('input', { bubbles: true }));
    cpMin.value = '0'; cpMax.value = '0';
    runBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(+doc.getElementById('nHit').textContent === 2, '「0~0」= 前摇恰为 0（2 个）',
      doc.getElementById('nHit').textContent);
    ok(/零带备注/.test(doc.getElementById('tblbox').textContent) &&
       !/零点二/.test(doc.getElementById('tblbox').textContent),
      '「0（魔晶）」按 0 处理，0.2 被排除');

    // ② 0~0.15 含端点
    cpMin.value = '0'; cpMax.value = '0.15';
    runBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(+doc.getElementById('nHit').textContent === 3, '「0~0.15」含端点 0.15（3 个）',
      doc.getElementById('nHit').textContent);

    // ③ 卡片显示「施法前摇」段且保留后台原值
    ok(/施法前摇/.test(doc.getElementById('tblbox').textContent), '详细卡片新增「施法前摇」段');
    const cpCells = Array.prototype.map.call(doc.querySelectorAll('#tblbox .skillcard .cpcell'), (e) => e.textContent.trim());
    ok(cpCells.some((s) => s.indexOf('0.15') === 0), '前摇段显示后台原值', cpCells.join(' / '));

    // ④ 无数据技能被排除并提示数量
    ok(/无施法前摇数据/.test(doc.getElementById('tblbox').textContent), '提示「无施法前摇数据」被排除的数量');

    // ⑤ 多值取任一命中区间
    cpMin.value = '0.6'; cpMax.value = '1';
    runBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(+doc.getElementById('nHit').textContent === 1 && /双值技能/.test(doc.getElementById('tblbox').textContent),
      '「0.6~1」命中多值技能（0.67/0.5 取任一）', doc.getElementById('nHit').textContent);

    // ⑥ 最小值 > 最大值 → 自动对调并提示
    cpMin.value = '0.15'; cpMax.value = '0';
    runBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(/自动对调/.test(doc.getElementById('tblbox').textContent), '最小值大于最大值时自动对调并提示');
    ok(+doc.getElementById('nHit').textContent === 3, '对调后结果正确（0~0.15 → 3 个）',
      doc.getElementById('nHit').textContent);

    // ⑦ 表达式条含前摇条件
    ok(/前摇/.test(doc.getElementById('expr').textContent), '「当前条件」表达式包含前摇区间',
      doc.getElementById('expr').textContent.trim());

    // ⑧ 只有前摇、没有 tag 也能检索
    tagInp3.value = '';
    tagInp3.dispatchEvent(new window.Event('input', { bubbles: true }));
    cpMin.value = '0'; cpMax.value = '0';
    runBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(+doc.getElementById('nHit').textContent === 2, '仅设前摇区间也可检索（无需 tag）',
      doc.getElementById('nHit').textContent);

    // ⑨ 前摇 + tag 同时生效：换一个不存在的 tag → 0 命中
    tagInp3.value = '治疗';
    tagInp3.dispatchEvent(new window.Event('input', { bubbles: true }));
    cpMin.value = '0.15'; cpMax.value = '0.15';
    runBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(+doc.getElementById('nHit').textContent === 1 && /零点一五/.test(doc.getElementById('tblbox').textContent),
      '前摇与 tag 条件叠加生效', doc.getElementById('nHit').textContent);

    // ⑩ 快捷按钮：≤0.15 填 0~0.15
    doc.getElementById('cpLe015').dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(cpMin.value === '0' && cpMax.value === '0.15', '快捷按钮「≤0.15」填入 0 ~ 0.15',
      cpMin.value + '~' + cpMax.value);
    // ⑪ 清空按钮同时清掉前摇输入
    doc.getElementById('btnClear').dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(cpMin.value === '' && cpMax.value === '', '「清空」同时重置前摇区间');

    // ⑫ 简洁模式仍可用（前摇筛选下）
    tagInp3.value = '治疗';
    tagInp3.dispatchEvent(new window.Event('input', { bubbles: true }));
    cpMin.value = '0'; cpMax.value = '0.15';
    runBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
    doc.getElementById('btnView').dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(doc.querySelectorAll('#tblbox .cmpgrid > .cmitem').length === 3, '前摇筛选下简洁模式照常渲染',
      doc.querySelectorAll('#tblbox .cmpgrid > .cmitem').length);
    doc.getElementById('btnView').dispatchEvent(new window.Event('click', { bubbles: true }));

    // ⑬ 反选（非）+ 前摇叠加：结果必须是两者的交集，并给出反选排除数量
    doc.getElementById('btnClear').dispatchEvent(new window.Event('click', { bubbles: true }));
    const notGrp = doc.querySelector('.grp[data-k="not"]');
    const addNot = (txt) => {
      notGrp.querySelector('[data-add]').dispatchEvent(new window.Event('click', { bubbles: true }));
      const ins = notGrp.querySelectorAll('.rows input');
      const inp = ins[ins.length - 1];
      inp.value = txt;
      inp.dispatchEvent(new window.Event('input', { bubbles: true }));
      return inp;
    };
    addNot('护盾');
    cpMin.value = '0'; cpMax.value = '0.15';
    runBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(+doc.getElementById('nHit').textContent === 2,
      '反选「护盾」+ 前摇 0~0.15 → 2 个（3 个去 1 个）', doc.getElementById('nHit').textContent);
    ok(!/零点一五/.test(doc.getElementById('tblbox').textContent) &&
       /零前摇/.test(doc.getElementById('tblbox').textContent),
      '被反选的技能不出现在结果里，其余保留');
    ok(/反选/.test(doc.getElementById('tblbox').textContent), '结果区说明反选排除了多少条');
    console.log('    反选说明：' + Array.prototype.map.call(doc.querySelectorAll('#tblbox .infobox'),
      (e) => e.textContent.replace(/\s+/g, ' ').trim()).join(' ｜ '));

    // 多个反选 tag：语义是「都要排除」，表达式显示为「非A 且 非B」
    addNot('治疗');
    runBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
    const exprNot = doc.getElementById('expr').textContent.replace(/\s+/g, '');
    ok(/非护盾且非治疗/.test(exprNot), '多个反选 tag 的表达式写作「非A 且 非B」', exprNot);
    ok(+doc.getElementById('nHit').textContent === 0, '反选「护盾」+「治疗」→ 0 个（全部命中其一）',
      doc.getElementById('nHit').textContent);
    doc.getElementById('btnClear').dispatchEvent(new window.Event('click', { bubbles: true }));

    // ================= 同一效果内匹配（matchUnit，默认开启） =================
    window.__tagsearch.applyDb({
      fetchedAt: '2026-10-30T00:00:00.000Z',
      tags: [{ id: 601, name: '测试弱驱散', c1: '机制', c2: '包含效果' },
             { id: 602, name: '测试眩晕', c1: '机制', c2: '包含效果' },
             { id: 603, name: '测试点目标', c1: '机制', c2: '施法类型' }],
      notePool: [],
      abilities: [
        { i: 9501, n: '同效果技能', en: 'same_row', d: [603], g: [], m: [], e: [{ n: '效果甲', t: [601, 602] }] },
        { i: 9502, n: '跨效果技能', en: 'cross_row', d: [603], g: [], m: [],
          e: [{ n: '效果甲', t: [601] }, { n: '效果乙', t: [602] }] }
      ]
    }, '合成测试数据（同一效果）');
    mTag.dispatchEvent(new window.Event('click', { bubbles: true }));
    doc.getElementById('btnClear').dispatchEvent(new window.Event('click', { bubbles: true }));

    const unitRadios = () => Array.prototype.slice.call(doc.querySelectorAll('input[name="unitMode"]'));
    const unitPick = (v) => {
      const el = unitRadios().filter((x) => x.value === v)[0];
      if (!el) return null;
      el.checked = true;
      el.dispatchEvent(new window.Event('change', { bubbles: true }));
      return el;
    };
    ok(unitRadios().length === 3, '左栏存在「匹配粒度」三档单选', unitRadios().length);
    ok((unitRadios().filter((x) => x.checked)[0] || {}).value === 'effect',
      '默认档位 =「效果类 tag 需同一效果条目」');

    const andRows = () => Array.prototype.slice.call(doc.querySelectorAll('.grp[data-k="and"] .rows input'));
    const setAnd = (vals) => {
      doc.getElementById('btnClear').dispatchEvent(new window.Event('click', { bubbles: true }));
      vals.forEach((v, k) => {
        if (k > 0) doc.querySelector('[data-add="and"]').dispatchEvent(new window.Event('click', { bubbles: true }));
        const inp = andRows()[k];
        inp.value = v;
        inp.dispatchEvent(new window.Event('input', { bubbles: true }));
      });
      doc.getElementById('btnRun').dispatchEvent(new window.Event('click', { bubbles: true }));
    };

    setAnd(['测试弱驱散', '测试眩晕']);
    ok(+doc.getElementById('nHit').textContent === 1, '且:A+B 只命中「同一效果里同时含 A、B」的技能',
      doc.getElementById('nHit').textContent);
    ok(/同效果技能/.test(doc.getElementById('tblbox').textContent) &&
       !/跨效果技能/.test(doc.getElementById('tblbox').textContent),
      '「A 在效果1、B 在效果2」不再算命中');
    ok(/效果类 tag 同一效果条目/.test(doc.getElementById('tblbox').textContent) &&
       /分散/.test(doc.getElementById('tblbox').textContent), '结果区说明有多少条因条件分散未命中');
    const uChips = doc.querySelectorAll('#tblbox .tagitems .chip');
    ok(uChips.length >= 1 && /效果1/.test(uChips[0].textContent), '命中卡片标注命中效果条目（效果1）',
      uChips.length ? uChips[0].textContent.trim() : '(无)');
    ok(/效果类同一条目/.test(doc.getElementById('expr').textContent), '「当前条件」标明匹配粒度',
      doc.getElementById('expr').textContent.replace(/\s+/g, ' ').trim());

    unitPick('skill');
    ok(+doc.getElementById('nHit').textContent === 2, '切到「整条技能合并」→ 旧口径 2 条',
      doc.getElementById('nHit').textContent);
    ok(doc.querySelectorAll('#tblbox .chip.unit').length === 0, '「整条技能合并」不显示命中单元');
    ok(/整技能合并/.test(doc.getElementById('expr').textContent), '表达式切换为「整技能合并」',
      doc.getElementById('expr').textContent.replace(/\s+/g, ' ').trim());

    unitPick('effect');
    ok(+doc.getElementById('nHit').textContent === 1, '切回「效果类同条目」→ 1 条',
      doc.getElementById('nHit').textContent);

    // 反选也在同一效果内判断：同效果技能的「效果甲」里就有 B → 被剔除；跨效果技能仍命中
    setAnd(['测试弱驱散']);
    doc.querySelector('.grp[data-k="not"] [data-add]').dispatchEvent(new window.Event('click', { bubbles: true }));
    const notInp = doc.querySelector('.grp[data-k="not"] .rows input');
    notInp.value = '测试眩晕';
    notInp.dispatchEvent(new window.Event('input', { bubbles: true }));
    doc.getElementById('btnRun').dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(+doc.getElementById('nHit').textContent === 1 &&
       /跨效果技能/.test(doc.getElementById('tblbox').textContent),
      '反选按命中单元判断：含 B 的那个效果被剔除，另一个效果仍可命中',
      doc.getElementById('nHit').textContent);
    doc.getElementById('btnClear').dispatchEvent(new window.Event('click', { bubbles: true }));
    doc.querySelector('.grp[data-k="not"] .rows .del') &&
      doc.querySelectorAll('.grp[data-k="not"] .rows .del').forEach((b) => b.dispatchEvent(new window.Event('click', { bubbles: true })));
    unitPick('effect');

    // 技能级 tag（类型 / 特性类）可以跨效果：点目标 + 眩晕 不再要求落在同一条效果
    setAnd(['测试点目标', '测试眩晕']);
    ok(+doc.getElementById('nHit').textContent === 2,
      '技能级 tag + 效果类 tag：技能级可跨效果，两条技能都命中', doc.getElementById('nHit').textContent);
    ok(/跨效果技能/.test(doc.getElementById('tblbox').textContent),
      '「点目标在技能类型、眩晕在效果2」也算命中（技能级 tag 不受同条目限制）');
    ok(/技能类型/.test(doc.getElementById('tblbox').textContent),
      '结果里标出技能级 tag 的命中位置（技能类型）');

    // ================= 新档位：所有 tag 需同一效果条目（unitMode='all'） =================
    window.__tagsearch.applyDb({
      fetchedAt: '2026-11-09T00:00:00.000Z',
      tags: [
        { id: 601, name: '测试弱驱散', c1: '机制', c2: '包含效果' },
        { id: 602, name: '测试眩晕', c1: '机制', c2: '包含效果' },
        { id: 603, name: '测试点目标', c1: '机制', c2: '施法类型' },
        { id: 604, name: '测试单一目标', c1: '目标', c2: '目标' },
        { id: 605, name: '测试基础技能', c1: '机制', c2: '技能类别' }
      ],
      notePool: [],
      abilities: [
        { i: 9601, n: '目标同行技能', en: 'target_same', d: [603, 605], g: [], m: [],
          e: [{ n: '效果甲', t: [601, 604] }] },
        { i: 9602, n: '目标分家技能', en: 'target_split', d: [603, 605], g: [], m: [],
          e: [{ n: '效果甲', t: [601] }, { n: '效果乙', t: [604] }] }
      ]
    }, '合成测试数据（全部 tag 同一效果条目）');
    mTag.dispatchEvent(new window.Event('click', { bubbles: true }));
    doc.getElementById('btnClear').dispatchEvent(new window.Event('click', { bubbles: true }));

    unitPick('effect');
    setAnd(['测试弱驱散', '测试单一目标']);
    ok(+doc.getElementById('nHit').textContent === 2,
      '效果类档：目标类 tag 不参与同行判定，2 条都命中', doc.getElementById('nHit').textContent);

    unitPick('all');
    ok(+doc.getElementById('nHit').textContent === 1 &&
       /目标同行技能/.test(doc.getElementById('tblbox').textContent),
      '所有 tag 档：目标 tag 必须与效果类 tag 落在同一条效果里（只命中同行那条）',
      doc.getElementById('nHit').textContent);
    ok(/所有 tag 同一效果条目/.test(doc.getElementById('tblbox').textContent),
      '结果区说明按新档位措辞');
    ok(/全部tag同一条目/.test(doc.getElementById('expr').textContent.replace(/\s+/g, '')),
      '表达式标明「全部tag同一条目」', doc.getElementById('expr').textContent.replace(/\s+/g, ' ').trim());

    // 「技能类别」在黑名单里：即使最严档位也不参与同行判定
    setAnd(['测试基础技能', '测试弱驱散']);
    ok(+doc.getElementById('nHit').textContent === 2,
      '技能级类别（技能类别/施法类型…）在最严档位也不参与同行判定，2 条都命中',
      doc.getElementById('nHit').textContent);

    // 施法类型同样不参与（点目标挂在技能类型区）
    setAnd(['测试点目标', '测试单一目标']);
    ok(+doc.getElementById('nHit').textContent === 2,
      '施法类型同样按技能级处理（不受同行限制）', doc.getElementById('nHit').textContent);
    unitPick('effect');
    doc.getElementById('btnClear').dispatchEvent(new window.Event('click', { bubbles: true }));

    // ================= 技能筛选（按数据来源；现版本英雄 / 现版本物品 / 目录外 / 非现版本物品） =================
    const srcDb = {
      fetchedAt: '2026-10-26T00:00:00.000Z',
      tags: [{ id: 488, name: '治疗', c1: '机制', c2: '包含效果' }],
      notePool: ['光环有0.1秒的粘滞时间。'],
      heroes: [{ i: 10, zh: '甲英雄', en: 'alpha', a: '力量' }],
      abilities: [
        { i: 9401, n: '甲一', en: 'alpha_one', d: [488], g: [], m: [], e: [], nt: [0], h: [10] },
        { i: 9402, n: '甲二', en: 'alpha_two', d: [488], g: [], m: [], e: [], h: [10] }
      ]
    };
    window.__tagsearch.applyDb(srcDb, '合成测试数据（来源）');
    mTag.dispatchEvent(new window.Event('click', { bubbles: true }));
    doc.getElementById('btnClear').dispatchEvent(new window.Event('click', { bubbles: true }));

    const srcList = doc.getElementById('srcList');
    const sChips = () => Array.prototype.slice.call(srcList.querySelectorAll('.schip'));
    const srcCb = (re) => {
      const c = sChips().filter((x) => re.test(x.textContent))[0];
      return c ? c.querySelector('input') : null;
    };
    ok(!!doc.getElementById('paneSrc'), '左栏存在「技能筛选」卡片');
    ok(!doc.getElementById('paneHero') && !doc.getElementById('heroGrid'),
      '原「英雄筛选」卡片与英雄网格已移除');
    ok(sChips().length === 5, '只列出已接入的来源（5 类：现版本英雄 / 现版本物品 / 目录外 / 非现版本物品 / 非英雄单位）', sChips().length);
    ok(/现版本英雄技能/.test(sChips()[0].textContent), '来源选项为「现版本英雄技能」',
      sChips()[0].textContent.trim());
    ok(sChips()[0].querySelector('input').checked, '「现版本英雄技能」默认勾选');
    ok(/全部来源/.test(doc.getElementById('srcSum').textContent), '摘要显示「全部来源」',
      doc.getElementById('srcSum').textContent);
    ok(/2 条/.test(sChips()[0].textContent), '来源右侧显示技能条数', sChips()[0].textContent.trim());

    const tagInp4 = doc.querySelector('.grp[data-k="and"] .rows input');
    tagInp4.value = '治疗';
    tagInp4.dispatchEvent(new window.Event('input', { bubbles: true }));
    doc.getElementById('btnRun').dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(+doc.getElementById('nHit').textContent === 2, '默认来源下命中 2 条', doc.getElementById('nHit').textContent);

    // 全部取消勾选 → 拦住、不出结果（已接入的两类都要取消）
    let cbSrc = srcCb(/现版本英雄技能/);
    cbSrc.checked = false;
    cbSrc.dispatchEvent(new window.Event('change', { bubbles: true }));
    let cbItem = srcCb(/物品技能/);
    cbItem.checked = false;
    cbItem.dispatchEvent(new window.Event('change', { bubbles: true }));
    ok(/至少勾选一类「技能来源」/.test(doc.getElementById('tblbox').textContent),
      '全不勾来源时提示至少勾选一类');
    ok(/未选来源/.test(doc.getElementById('srcSum').textContent), '摘要显示「未选来源」',
      doc.getElementById('srcSum').textContent);
    ok(doc.getElementById('btnCsv').disabled, '无来源时导出按钮禁用');

    cbSrc = srcCb(/现版本英雄技能/);
    cbSrc.checked = true;
    cbSrc.dispatchEvent(new window.Event('change', { bubbles: true }));
    ok(+doc.getElementById('nHit').textContent === 2, '重新勾上后恢复结果', doc.getElementById('nHit').textContent);

    // 数据里出现物品技能条目 → 来源已有对应勾选项，默认勾选
    window.__tagsearch.applyDb({
      fetchedAt: srcDb.fetchedAt, tags: srcDb.tags, notePool: srcDb.notePool, heroes: srcDb.heroes,
      abilities: srcDb.abilities.concat([
        { i: 9403, n: '物品一', en: 'item_one', src: 'item', d: [488], g: [], m: [], e: [], nt: [0] }
      ])
    }, '含物品技能');
    ok(sChips().length === 5, '数据变化后来源勾选项仍为已接入的 5 类', sChips().length);
    const itemCb = srcCb(/物品技能/);
    ok(!!itemCb && !itemCb.checked, '手动取消过的来源，换数据后仍保持未勾选（选择状态沿用）');
    ok(/已选 1 \/ 2 类/.test(doc.getElementById('srcSum').textContent), '摘要反映「已选 1 / 2 类」',
      doc.getElementById('srcSum').textContent);

    itemCb.checked = true;
    itemCb.dispatchEvent(new window.Event('change', { bubbles: true }));
    let heroCb = srcCb(/现版本英雄技能/);
    heroCb.checked = false;
    heroCb.dispatchEvent(new window.Event('change', { bubbles: true }));
    ok(+doc.getElementById('nHit').textContent === 1, '只剩物品技能来源时命中 1 条',
      doc.getElementById('nHit').textContent);
    ok(/已按技能来源筛选/.test(doc.getElementById('tblbox').textContent), '只勾部分来源时结果区给出说明');
    ok(/来源/.test(doc.getElementById('expr').textContent), '「当前条件」表达式包含来源条件',
      doc.getElementById('expr').textContent.trim());

    ok(typeof window.__tagsearch.setSources === 'function' &&
       typeof window.__tagsearch.setHeroes === 'function' &&
       typeof window.__tagsearch.sources === 'function', '自动化钩子保留 setSources / setHeroes / sources');

    // ================= 目录外技能：勾「现版本英雄技能」时不许混进来（用户 bug） =================
    window.__tagsearch.applyDb({
      fetchedAt: '2026-10-30T00:00:00.000Z',
      tags: [{ id: 488, name: '治疗', c1: '机制', c2: '包含效果' }],
      notePool: [],
      heroes: [{ i: 10, zh: '甲英雄', en: 'alpha', a: '力量' }],
      abilities: [
        { i: 9501, n: '现版本一', en: 'live_one', d: [488], g: [], m: [], e: [], h: [10] },
        { i: 9502, n: '目录外一', en: 'orphan_one', d: [488], g: [], m: [], e: [], h: [] }
      ]
    }, '含目录外条目');
    const tblText = () => doc.getElementById('tblbox').textContent;
    window.__tagsearch.setSources(['hero']);
    setAnd(['治疗']);
    ok(+doc.getElementById('nHit').textContent === 1 && !/目录外一/.test(tblText()),
      '勾「现版本英雄技能」后，目录外条目不再命中',
      doc.getElementById('nHit').textContent + ' / ' + (tblText().match(/目录外一/) ? '含目录外' : '干净'));
    window.__tagsearch.setSources(['orphan']);
    ok(+doc.getElementById('nHit').textContent === 1 && /目录外一/.test(tblText()),
      '改勾「目录外技能」后才出现该条目', doc.getElementById('nHit').textContent);
    ok(/目录外技能/.test(tblText()), '结果行标出技能来源「目录外技能」');
    doc.getElementById('btnClear').dispatchEvent(new window.Event('click', { bubbles: true }));

    // ================= 现版本物品技能：默认只勾现版本，非现版本单独可选 =================
    window.__tagsearch.applyDb({
      fetchedAt: '2026-11-04T00:00:00.000Z',
      tags: [{ id: 488, name: '治疗', c1: '机制', c2: '包含效果' }],
      notePool: [],
      itemCur: true,
      abilities: [
        { i: 9701, n: '现版本物品一', en: 'cur_item', src: 'item', cur: 1, d: [488], g: [], m: [], e: [] },
        { i: 9702, n: '非现版本物品一', en: 'old_item', src: 'item', d: [488], g: [], m: [], e: [] }
      ]
    }, '合成测试数据（现版本物品技能）');
    const curCb = srcCb(/现版本物品技能/);
    const oldCb = srcCb(/非现版本物品技能/);
    ok(!!curCb && !!oldCb, '左栏出现「现版本物品技能」「非现版本物品技能」两个开关');
    ok(/1 条/.test(curCb.closest('.schip').textContent) && /1 条/.test(oldCb.closest('.schip').textContent),
      '两类物品技能各 1 条', curCb.closest('.schip').textContent + ' / ' + oldCb.closest('.schip').textContent);
    window.__tagsearch.setSources(['item']);
    setAnd(['治疗']);
    ok(+doc.getElementById('nHit').textContent === 1 && /现版本物品一/.test(tblText()) && !/非现版本物品一/.test(tblText()),
      '默认「现版本物品技能」口径不含非现版本条目',
      doc.getElementById('nHit').textContent + ' / ' + (/非现版本物品一/.test(tblText()) ? '混入' : '干净'));
    window.__tagsearch.setSources(['itemOld']);
    ok(+doc.getElementById('nHit').textContent === 1 && /非现版本物品一/.test(tblText()),
      '改勾「非现版本物品技能」后才出现该条目', doc.getElementById('nHit').textContent);
    window.__tagsearch.setSources(['hero', 'item', 'orphan', 'itemOld']);
    doc.getElementById('btnClear').dispatchEvent(new window.Event('click', { bubbles: true }));

    // ================= 同名 tag：按类别区分 =================
    window.__tagsearch.applyDb({
      fetchedAt: '2026-10-30T00:00:00.000Z',
      tags: [{ id: 701, name: '测试光环', c1: '机制', c2: '施法类型' },
             { id: 702, name: '测试光环', c1: '机制', c2: '包含效果' },
             { id: 703, name: '测试光环', c1: '机制', c2: '神杖升级施法类型' }],
      notePool: [],
      abilities: [
        { i: 9601, n: '施法型技能', en: 'cast_one', d: [], g: [], m: [], e: [{ n: '效果甲', t: [701] }] },
        { i: 9602, n: '效果型技能', en: 'eff_one', d: [], g: [], m: [], e: [{ n: '效果甲', t: [702] }] },
        { i: 9603, n: '神杖档技能', en: 'sce_one', d: [], g: [], m: [], e: [{ n: '效果甲', t: [703] }] }
      ]
    }, '合成测试数据（同名 tag）');
    // 上一段测试把来源改成「只物品」，这里恢复全选，否则新数据（hero）会被筛掉
    window.__tagsearch.setSources(['hero', 'item', 'orphan', 'itemOld']);
    doc.getElementById('btnClear').dispatchEvent(new window.Event('click', { bubbles: true }));

    // 补全里同名 tag 应拆成「名称（类别）」
    const opts = Array.prototype.map.call(doc.querySelectorAll('#tagOptions option'), (o) => o.value);
    ok(opts.indexOf('测试光环（施法类型）') >= 0 && opts.indexOf('测试光环（包含效果）') >= 0,
      '补全列表把同名 tag 拆成「名称（类别）」多条',
      opts.filter((v) => /测试光环/.test(v)).join(' / '));

    // 只写名字 → 多义提示 + 全部含义一起匹配
    const andIn = () => doc.querySelectorAll('.grp[data-k="and"] .rows input');
    andIn()[0].value = '测试光环';
    andIn()[0].dispatchEvent(new window.Event('input', { bubbles: true }));
    const ambTip = doc.querySelector('.grp[data-k="and"] .resol');
    ok(ambTip && /同名多义/.test(ambTip.textContent), '输入同名 tag 时提示「同名多义」');
    ok(/施法类型/.test(ambTip.textContent) && /包含效果/.test(ambTip.textContent),
      '提示里列出全部含义', ambTip.textContent.replace(/\s+/g, ' ').trim().slice(0, 80));
    ok(/测试光环（包含效果）/.test(ambTip.textContent), '提示里给出精确写法');

    // 点击提示里的「名称（类别）」→ 直接填入并重算
    const fillBtn = doc.querySelector('.grp[data-k="and"] .resol code[data-fill]');
    ok(!!fillBtn, '多义提示里给出可点击的精确写法', fillBtn && fillBtn.getAttribute('data-fill'));
    if (fillBtn) {
      fillBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
      ok(andIn()[0].value === fillBtn.getAttribute('data-fill'), '点击后自动填入「名称（类别）」', andIn()[0].value);
      ok(!/同名多义/.test(doc.querySelector('.grp[data-k="and"] .resol').textContent), '填入后提示切换为「已指定类别」');
    }

    // 还原成只有名字，继续验证多义检索
    andIn()[0].value = '测试光环';
    andIn()[0].dispatchEvent(new window.Event('input', { bubbles: true }));
    doc.getElementById('btnRun').dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(+doc.getElementById('nHit').textContent === 3, '不带类别 → 两种含义全匹配（含神杖档，3 条）',
      doc.getElementById('nHit').textContent);
    const ambItems = doc.querySelector('#tblbox .skillcard .tagitems').textContent;
    ok(!/测试光环/.test(ambItems) && /效果/.test(ambItems), '结果卡片只显示效果位置，不再重复 tag 名/多义类别',
      ambItems.replace(/\s+/g, ' ').trim().slice(0, 60));
    ok(/同名含义/.test(doc.getElementById('tblbox').textContent), '结果区给出多义说明');

    // 写成「名称（类别）」→ 只匹配该类别
    doc.getElementById('btnClear').dispatchEvent(new window.Event('click', { bubbles: true }));
    andIn()[0].value = '测试光环（包含效果）';
    andIn()[0].dispatchEvent(new window.Event('input', { bubbles: true }));
    ok(!/同名多义/.test(doc.querySelector('.grp[data-k="and"] .resol').textContent), '指定类别后不再提示多义');
    doc.getElementById('btnRun').dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(+doc.getElementById('nHit').textContent === 1 &&
       /效果型技能/.test(doc.getElementById('tblbox').textContent),
      '「测试光环（包含效果）」只命中效果型技能', doc.getElementById('nHit').textContent);
    ok(!/同名含义/.test(doc.getElementById('tblbox').textContent), '结果区不再提示多义');

    // 类别 + 档位：写法基类别 = 命中任一档
    doc.getElementById('btnClear').dispatchEvent(new window.Event('click', { bubbles: true }));
    andIn()[0].value = '测试光环（施法类型）';
    andIn()[0].dispatchEvent(new window.Event('input', { bubbles: true }));
    doc.getElementById('btnRun').dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(+doc.getElementById('nHit').textContent === 2 &&
       /施法型技能/.test(doc.getElementById('tblbox').textContent) &&
       /神杖档技能/.test(doc.getElementById('tblbox').textContent) &&
       !/效果型技能/.test(doc.getElementById('tblbox').textContent),
      '「（施法类型）」只取该类别的所有档（基础 + 神杖升级），不含其它类别',
      doc.getElementById('nHit').textContent);

    // 详情面板里同名 tag 也带类别小标
    doc.querySelector('#tblbox [data-detail]').dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(doc.querySelectorAll('#mBody .chip .cat').length >= 1, '详情面板为同名 tag 标注类别',
      doc.querySelectorAll('#mBody .chip .cat').length);
    doc.getElementById('mClose').dispatchEvent(new window.Event('click', { bubbles: true }));

    // 同名 tag 一览入口已移除（2026-11-27 用户定：不需要）
    doc.getElementById('btnClear').dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(!doc.getElementById('btnDup'), '不再提供「同名 tag 一览」入口');
    ok(!/同名/.test(doc.querySelector('header .meta').textContent), '页头不再出现同名统计');

    // ================= 加成检索（第三模式，2026-11-23） =================
    // 上一段注入的合成数据没有加成 tag → 此处单独注入一份含 7 个加成 tag 的合成数据
    window.__tagsearch.applyDb({
      fetchedAt: '2026-11-23T00:00:00.000Z',
      tags: [
        { id: 1156, name: '受施法距离加成影响', c1: '图标', c2: '加成属性' },
        { id: 1157, name: '不受施法距离加成影响', c1: '图标', c2: '加成属性' },
        { id: 1158, name: '受攻击距离加成影响', c1: '图标', c2: '加成属性' },
        { id: 1159, name: '不受攻击距离加成影响', c1: '图标', c2: '加成属性' },
        { id: 1160, name: '受作用范围加成影响', c1: '图标', c2: '加成属性' },
        { id: 1161, name: '不受作用范围加成影响', c1: '图标', c2: '加成属性' },
        { id: 1334, name: '物品威力', c1: '图标', c2: '加成属性' }
      ],
      notePool: [], heroes: [{ i: 1, zh: '敌法师', en: 'antimage', a: '敏捷' }],
      imgMap: {
        7710: { s: 'icons/abilities/void_spirit_resonant_pulse.png', u: 'icons/heroes/antimage.png' },
        7712: { s: 'icons/abilities/entangle.png', u: '' },
        5122: { s: 'icons/abilities/magic_arrow.png', u: '' },
        // 物品技能在 imgMap 里带 'item:' 前缀（与英雄技能同 id 时不互相覆盖）
        'item:302': { s: 'icons/items/vile_phial.png', u: '' }
      },
      abilities: [
        { i: 7710, n: '共鸣脉冲', en: 'void_spirit_resonant_pulse', h: [1], d: [], g: [], m: [], e: [],
          bx: [['脉冲作用范围{%1160%}', [1160]]],
          vx: [['脉冲作用范围{%1160%}', '375', '', '', 0, [], [1160]]] },
        { i: 7712, n: '缠绕', en: 'entangle', d: [1046], g: [], m: [], e: [],
          bx: [['缠绕持续时间{%1160%}{%1046%}', [1160]]],
          vx: [['缠绕持续时间{%1160%}{%1046%}', '325', '', '', 0, [], [1160]]] },
        { i: 5122, n: '魔法箭', en: 'magic_arrow', d: [1047], g: [], m: [], e: [],
          bx: [['弹射距离百分比{%1047%}{%1156%}{%1161%}', [1156, 1161]]],
          vx: [['弹射距离百分比{%1047%}{%1156%}{%1161%}', '50%', '', '%', 0, [], [1156, 1161]]] },
        { i: 7711, n: '范围外技能', en: 'no_bonus', d: [], g: [], m: [], e: [], bx: [] },
        { i: 302, n: '破法（净魂之刃）', en: 'mana_break', src: 'item', d: [], g: [], m: [], e: [],
          bx: [['每次燃烧魔法{%1334%}', [1334]]],
          vx: [['每次燃烧魔法{%1334%}', '30%', '', '%', 0, [], [1334]]] }
      ]
    }, '合成测试数据（加成检索）');

    const mBtns = Array.prototype.slice.call(doc.querySelectorAll('#modes .mbtn'));
    ok(mBtns.length === 4 && mBtns.some((b) => b.getAttribute('data-mode') === 'bonus') &&
       mBtns.some((b) => b.getAttribute('data-mode') === 'value'),
      '页头有四个模式按钮（含加成检索、数值检索）', mBtns.length);
    ok(!!doc.getElementById('paneBonus'), '左栏存在加成检索面板');
    const bRadios = Array.prototype.slice.call(doc.querySelectorAll('input[name="bonusTag"]'));
    ok(bRadios.length === 7, '加成面板列出 7 个 tag 单选', bRadios.length);
    ok(bRadios.some((r) => r.value === '1160'), '包含「受作用范围加成影响」(1160)');

    window.__tagsearch.setMode('bonus');
    ok(doc.getElementById('paneBonus').style.display !== 'none', '切到加成模式 → 显示加成面板');
    ok(doc.getElementById('paneNote').style.display === 'none', '切到加成模式 → 注释面板隐藏');
    ok(doc.getElementById('btnView').style.display === 'none', '加成模式隐藏「简/详」按钮');
    ok(mBtns.filter((b) => b.getAttribute('data-mode') === 'bonus')[0].classList.contains('on'),
      '「加成检索」按钮高亮');

    ok(window.__tagsearch.setBonusTag(1160) === true, 'setBonusTag(1160) 选中成功');
    const nB = +doc.getElementById('nHit').textContent;
    ok(nB > 0, '加成检索命中 > 0', nB);
    const bBox = doc.getElementById('tblbox').textContent;
    ok(/脉冲作用范围/.test(bBox), '结果含「脉冲作用范围」');
    const bItems = doc.querySelector('#tblbox .scitems').textContent;
    ok(!/\{%1160%\}/.test(bItems), '加成检索不展示加成替换符 {%1160%}');
    ok(/受作用范围加成影响/.test(bBox), '结果说明含 tag 名');
    ok(/脉冲作用范围: 375/.test(bBox), '中文名与数值之间是冒号（脉冲作用范围: 375）');
    ok(/缠绕持续时间神杖: 325/.test(bBox), '升级项就地替换在中文名里（缠绕持续时间 + 神杖）');
    ok(doc.querySelectorAll('#tblbox .scit .upinline').length === 1, '升级项渲染为条目内 inline chip');
    ok(!doc.querySelectorAll('#tblbox .scup').length, '升级项不再堆在全部条目之前');
    ok(!/\{%1046%\}/.test(bBox), '升级占位符原文不展示');
    ok(doc.querySelectorAll('#tblbox .skillcard').length === 2, '加成检索使用等宽技能卡片展示');
    ok(doc.querySelectorAll('#tblbox img.scpic').length === 2, 'imgMap 命中 → 主体显示技能图标');
    ok(doc.querySelectorAll('#tblbox .scpic.ph').length === 0, '有图标时不再显示占位块');
    ok(doc.querySelectorAll('#tblbox .schd img.schico').length === 1, '英雄技能显示单位小图标');
    ok(!doc.querySelectorAll('#tblbox thead th').length, '加成检索不再使用表头');
    ok(doc.getElementById('btnRunB').textContent.trim() === '确认检索', '加成面板有「确认检索」按钮');
    doc.getElementById('btnRunB').dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(+doc.getElementById('nHit').textContent === nB, '点击「确认检索」重新执行搜索，结果一致');

    // 同一项含多个加成替换符：全部去掉，只保留升级 chip（魔法箭 1047/1156/1161）
    ok(window.__tagsearch.setBonusTag(1156) === true, 'setBonusTag(1156) 选中成功');
    const b1156 = doc.getElementById('tblbox');
    ok(/弹射距离百分比魔晶: 50%/.test(b1156.textContent), '魔法箭：仅保留中文名 + 魔晶 chip + 数值');
    ok(!/\{%1156%\}/.test(b1156.querySelector('.scitems').textContent), '不展示被检索的 {%1156%}');
    ok(!/\{%1161%\}/.test(b1156.querySelector('.scitems').textContent), '同项其他加成替换符 {%1161%} 也不展示');
    ok(b1156.querySelectorAll('.scit .upinline').length === 1, '1047 就地换成魔晶 chip');
    ok(window.__tagsearch.setBonusTag(1160) === true, '切回 1160 供后续断言');
    ok(!!doc.querySelector('input[name="bonusTag"][value="1160"]').checked, '1160 保持选中');
    ok(doc.querySelectorAll('#bonusTags label.on').length === 1, '选中项高亮 1 个');

    window.__tagsearch.setMode('tag');
    ok(doc.getElementById('paneBonus').style.display === 'none', '切回 Tag 模式 → 加成面板隐藏');
    window.__tagsearch.setMode('bonus');
    ok(+doc.getElementById('nHit').textContent === nB, '切回来加成结果保留',
      doc.getElementById('nHit').textContent);

    // 物品威力（1334）：物品技能无 is_show 字段，也须能被检索到
    ok(window.__tagsearch.setBonusTag(1334) === true, 'setBonusTag(1334) 选中成功');
    ok(+doc.getElementById('nHit').textContent === 1, '物品威力命中 1 条（破法）',
      doc.getElementById('nHit').textContent);
    ok(/每次燃烧魔法: 30%/.test(doc.getElementById('tblbox').textContent),
      '结果含「每次燃烧魔法: 30%」（替换符不展示、冒号分隔）');
    ok(/破法（净魂之刃）/.test(doc.getElementById('tblbox').textContent), '结果含技能名「破法（净魂之刃）」');
    ok(/30%/.test(doc.getElementById('tblbox').textContent), '物品技能加成项也显示数值');
    ok(doc.querySelectorAll('#tblbox img.scpic[src="icons/items/vile_phial.png"]').length === 1,
      '物品技能显示物品图标');
    ok(doc.querySelectorAll('#tblbox .schd .schico').length === 0,
      '物品技能不显示单位小图标，也不留占位空格');

    doc.getElementById('btnClearB').dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(+doc.getElementById('nHit').textContent === 0, '清空加成条件 → 0 命中');
    ok(doc.querySelectorAll('input[name="bonusTag"]:checked').length === 0, '清空后无选中 radio');

    // ================= 数值检索（第四模式，2026-11-27） =================
    window.__tagsearch.applyDb({
      fetchedAt: '2026-11-27T00:00:00.000Z',
      tags: [
        { id: 385, name: '伤害', c1: '机制', c2: '包含效果' },
        { id: 490, name: '生命恢复增强', c1: '机制', c2: '包含效果' },
        { id: 1160, name: '受作用范围加成影响', c1: '图标', c2: '加成属性' },
        { id: 1326, name: '物品威力', c1: '机制', c2: '包含效果' },
        { id: 1334, name: '物品威力', c1: '图标', c2: '加成属性' }
      ],
      notePool: [], heroes: [],
      abilities: [
        { i: 1310, n: '黑暗之心', en: 'heart', d: [], g: [], m: [], e: [],
          vx: [
            ['白天生命回复', '-20%', '-', '%', 0, [490], []],
            ['最高伤害', '120/200/280/360', '', '', 0, [385], []],
            ['作用范围{%1160%}', '375', '', '', 0, [], [1160]]
          ] },
        { i: 999, n: '泉水回春', en: 'fountain', d: [], g: [], m: [], e: [],
          vx: [['每秒恢复最大生命值', '5', '', '', 1, [490], []]] },
        { i: 1000, n: '背刺', en: 'backstab', d: [], g: [], m: [], e: [],
          vx: [['额外物品威力', '10%', '', '', 0, [1326], []]] }
      ]
    }, '合成测试数据（数值检索）');

    ok(!!doc.getElementById('paneValue'), '左栏存在数值检索面板');
    ok(!!doc.getElementById('valueTag'), '数值检索有 tag 名称输入框');
    window.__tagsearch.setMode('value');
    ok(doc.getElementById('paneValue').style.display !== 'none', '切到数值模式 → 显示数值面板');
    ok(doc.getElementById('paneBonus').style.display === 'none', '切到数值模式 → 加成面板隐藏');
    ok(doc.getElementById('btnView').style.display === 'none', '数值模式隐藏「简/详」按钮');
    ok(!!doc.getElementById('btnRunV') && doc.getElementById('btnRunV').textContent.trim() === '确认检索',
      '数值面板有「确认检索」按钮');

    ok(window.__tagsearch.setValueTag('伤害') === true, 'setValueTag(伤害) 成功');
    const vHit = +doc.getElementById('nHit').textContent;
    ok(vHit === 1, '按 tag「伤害」命中 1 个技能', vHit);
    doc.getElementById('btnRunV').dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(+doc.getElementById('nHit').textContent === vHit, '点击「确认检索」重新执行数值搜索，结果一致');
    let vBox = doc.getElementById('tblbox').textContent;
    ok(/最高伤害: 120\/200\/280\/360/.test(vBox), '结果含「中文名: 数值」');
    ok(!/（伤害）/.test(vBox), '不再重复展示检索的 tag 名称');
    ok(!!doc.querySelector('#tblbox .skillgrid'), '数值检索改用等宽卡片网格展示');
    ok(doc.querySelectorAll('#tblbox .skillcard').length === 1, '数值检索使用等宽技能卡片展示');
    ok(doc.querySelectorAll('#tblbox .skillcard .scpic.ph').length === 1, '数值卡片预留图片占位位置');
    ok(!doc.querySelectorAll('#tblbox thead th').length, '数值检索不再使用表头');

    ok(window.__tagsearch.setValueTag('生命恢复增强') === true, 'setValueTag(生命恢复增强) 成功');
    vBox = doc.getElementById('tblbox').textContent;
    ok(/-20%/.test(vBox), '常规值含前后缀 -20%');
    ok(/手填/.test(vBox) && /每秒恢复最大生命值/.test(vBox), '手填值标注且原样显示（泉水回春）');

    window.__tagsearch.setValueTag('不存在的TagXYZ');
    ok(+doc.getElementById('nHit').textContent === 0, '未识别 tag → 0 命中');
    ok(/未识别/.test(doc.getElementById('valueTagList').textContent), '提示未识别的 tag 名称');

    doc.getElementById('btnClearV').dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(doc.getElementById('valueTag').value === '', '清空数值条件 → 输入框清空');
    ok(+doc.getElementById('nHit').textContent === 0, '清空数值条件 → 0 命中');

    // 候选：输入名称后列出同名 tag 的 id，人工选中后写入纯数字 id（精确匹配）
    const vInput = doc.getElementById('valueTag');
    const cands = doc.getElementById('valueCands');
    vInput.value = '物品威力';
    vInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    ok(!cands.hidden, '输入 tag 名称 → 显示候选框');
    const candEls = Array.prototype.slice.call(cands.querySelectorAll('.vc'));
    ok(candEls.length === 2, '同名「物品威力」列出 2 个候选', candEls.length);
    ok(candEls.some((el) => /1326/.test(el.textContent) && /包含效果/.test(el.textContent)) &&
       candEls.some((el) => /1334/.test(el.textContent) && /加成属性/.test(el.textContent)),
      '候选同时给出 tag id 与类别，供人工匹配');
    const pick1326 = candEls.filter((el) => el.textContent.trim().indexOf('1326') === 0)[0];
    ok(!!pick1326, '存在 1326（包含效果）候选');
    pick1326.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    ok(vInput.value === '1326', '点击候选 → 写入纯数字 tag id', vInput.value);
    vInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    ok(+doc.getElementById('nHit').textContent === 1, '按候选 id 精确命中 1 条（背刺）',
      doc.getElementById('nHit').textContent);
    ok(/额外物品威力/.test(doc.getElementById('tblbox').textContent), '结果展示填写的自定义中文名');

    // 图片位置接口：注入 resolver 后占位块换成 img，清空后恢复占位
    window.__tagsearch.setCardImageResolver(function (h) { return h.id === 1000 ? '/pic/1000.png' : ''; });
    ok(doc.querySelectorAll('#tblbox img.scpic').length === 1, '注入图片接口 → 渲染 img 占位位');
    ok(doc.querySelector('#tblbox img.scpic').getAttribute('src') === '/pic/1000.png', '图片接口返回 URL 生效');
    window.__tagsearch.setCardImageResolver(null);
    ok(doc.querySelectorAll('#tblbox .scpic.ph').length === 1, '清空图片接口 → 恢复占位块');

    // ---- 图标归属：物品技能与英雄技能同 id 不互相覆盖；天赋技能用对应天赋的升级图标 ----
    window.__tagsearch.applyDb({
      fetchedAt: '2026-11-27T00:00:00.000Z',
      tags: [{ id: 619, name: '隐藏状态', c1: '机制', c2: '状态效果' }],
      notePool: [],
      heroes: [{ i: 1, zh: '狼人', en: 'lycan', a: '力量' }],
      imgMap: {
        // 英雄技能 333 饿狼撕咬
        333: {
          s: 'icons/spellicons/lycan_wolf_bite_png.png',
          u: 'icons/heroes/icons/npc_dota_hero_lycan_png.png'
        },
        // 物品技能 333 天界光耀：同 id 不同技能，键带 item: 前缀
        'item:333': { s: 'icons/items/starforge_png.png', u: '' },
        // 天赋技能：图片＝对应天赋的升级图标（6423 在 KV 是 Ability12 → 15 级右 → icons/1051.png）
        6423: { s: 'icons/1051.png', u: 'icons/heroes/icons/npc_dota_hero_tusk_png.png' }
      },
      abilities: [
        { i: 333, n: '饿狼撕咬', en: 'lycan_wolf_bite', h: [1], d: [], g: [], m: [],
          e: [{ n: '效果1', t: [619] }] },
        { i: 333, n: '天界光耀', en: 'Celestial Flare', src: 'item', in: '星铸之刃', d: [], g: [], m: [],
          e: [{ n: '效果1', t: [619] }] },
        { i: 6423, n: '+{s:value} 生命', en: 'special_bonus_hp_325', h: [1], d: [753], g: [], m: [],
          e: [{ n: '生命值加成', t: [619] }] }
      ]
    }, '合成测试数据（图标归属）');
    window.__tagsearch.setMode('tag');
    doc.getElementById('btnClear').dispatchEvent(new window.Event('click', { bubbles: true }));
    const icoIn = doc.querySelector('.grp[data-k="and"] .rows input');
    icoIn.value = '隐藏状态';
    icoIn.dispatchEvent(new window.Event('input', { bubbles: true }));
    doc.getElementById('btnRun').dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(doc.querySelectorAll('#tblbox .skillcard').length === 3, '三张卡片（英雄 / 物品 / 天赋）',
      doc.querySelectorAll('#tblbox .skillcard').length);
    ok(doc.querySelectorAll('#tblbox img.scpic[src="icons/spellicons/lycan_wolf_bite_png.png"]').length === 1,
      '英雄技能 333（饿狼撕咬）取自己的技能图标');
    ok(doc.querySelectorAll('#tblbox img.scpic[src="icons/items/starforge_png.png"]').length === 1,
      '物品技能 333（天界光耀）不被英雄技能覆盖，仍取物品图标');
    ok(doc.querySelectorAll('#tblbox img.scpic[src="icons/1051.png"]').length === 1,
      '天赋技能图片＝对应天赋的升级图标（Ability12 → 15 级右 → icons/1051.png）');
    ok(doc.querySelectorAll('#tblbox img.schico[src="icons/heroes/icons/npc_dota_hero_lycan_png.png"]').length === 1,
      '英雄技能显示英雄头像');
    ok(doc.querySelectorAll('#tblbox img.schico[src="icons/heroes/icons/npc_dota_hero_tusk_png.png"]').length === 1,
      '天赋技能也显示归属英雄头像');
    ok(doc.querySelectorAll('#tblbox .schd .schico').length === 2, '物品技能不显示单位小图标',
      doc.querySelectorAll('#tblbox .schd .schico').length);
    {
      const itemCard = Array.from(doc.querySelectorAll('#tblbox .skillcard'))
        .find(function (c) { return /天界光耀/.test(c.textContent); });
      ok(!!itemCard && /星铸之刃/.test(itemCard.textContent),
        '物品技能卡片第二行显示物品名（a.in）');
      ok(!!itemCard && !/现版本物品技能/.test(itemCard.textContent),
        '物品技能卡片不再显示「现版本物品技能」来源标签');
    }

    // ---- 非英雄单位技能：卡片第二行显示「原主」，不再显示「现版本非英雄单位技能」 ----
    window.__tagsearch.applyDb({
      fetchedAt: '2026-11-27T00:00:00.000Z',
      tags: [{ id: 620, name: '缠绕', c1: '机制', c2: '状态效果' }],
      notePool: [],
      heroes: [],
      imgMap: {},
      abilities: [
        { i: 5001, n: '弱化光环', en: 'ancient_rock_golem_weakening_aura', src: 'creep', o: '远古岩石傀儡',
          d: [], g: [], m: [], e: [{ n: '效果1', t: [620] }] },
        { i: 5002, n: '停滞', en: 'spawnlord_master_freeze', src: 'creep',
          d: [], g: [], m: [], e: [{ n: '效果1', t: [620] }] }
      ]
    }, '合成测试数据（原主）');
    window.__tagsearch.setMode('tag');
    doc.getElementById('btnClear').dispatchEvent(new window.Event('click', { bubbles: true }));
    const ownIn = doc.querySelector('.grp[data-k="and"] .rows input');
    ownIn.value = '缠绕';
    ownIn.dispatchEvent(new window.Event('input', { bubbles: true }));
    doc.getElementById('btnRun').dispatchEvent(new window.Event('click', { bubbles: true }));
    const ownCards = Array.prototype.slice.call(doc.querySelectorAll('#tblbox .skillcard'));
    ok(ownCards.length === 2, '两张非英雄单位技能卡片', ownCards.length);
    const ownerCard = ownCards.filter((c) => /弱化光环/.test(c.textContent))[0];
    ok(!!ownerCard && ownerCard.querySelector('.hr') &&
       ownerCard.querySelector('.hr').textContent.trim() === '远古岩石傀儡',
      '卡片第二行只显示原主中文名（无「原主：」前缀）',
      ownerCard && ownerCard.querySelector('.hr') && ownerCard.querySelector('.hr').textContent.trim());
    ok(!/现版本非英雄单位技能/.test(doc.getElementById('tblbox').textContent),
      '卡片不再显示「现版本非英雄单位技能」来源标签');
    const noOwnerCard = ownCards.filter((c) => /停滞/.test(c.textContent))[0];
    ok(!!noOwnerCard && !noOwnerCard.querySelector('.hr'), '原主未登记时该行留空（不渲染 .hr）');
    noOwnerCard.querySelector('[data-detail]').dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(/原主/.test(doc.getElementById('mBody').textContent) &&
       /未登记/.test(doc.getElementById('mBody').textContent),
      '详情弹窗给「原主」段并注明未登记');

    console.log(fails ? `\n${fails} 项失败` : '\n全部通过');
    process.exit(fails ? 1 : 0);
  })
  .catch((e) => { console.error(e); process.exit(2); });
