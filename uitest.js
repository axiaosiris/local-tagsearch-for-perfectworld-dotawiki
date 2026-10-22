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
    ok(fullTds === 7, '详细模式每行 7 列（升级项/技能/ID/施法前摇/命中详情/tag 数/详情）', fullTds);

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
    ok(/行 \/ 3 技能/.test(doc.getElementById('mNotes').textContent), '页头显示注释数据量（行池 / 技能数）',
      doc.getElementById('mNotes').textContent);

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
    const cnt0 = doc.querySelector('#tblbox tbody td.count').textContent;
    ok(/^\d+\/\d+$/.test(cnt0.trim()), '显示「命中行数 / 注释总行数」', cnt0);

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

    // 简洁模式（注释模式共用简/详）
    btnView.dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(doc.querySelectorAll('#tblbox .cmpgrid').length === 1 &&
      doc.querySelectorAll('#tblbox .nline').length === 0, '注释模式也支持简洁展示（仅图标 + 技能名）');
    ok(doc.querySelectorAll('#tblbox .cmpgrid .cname').length === 2, '简洁模式列出全部命中技能',
      doc.querySelectorAll('#tblbox .cmpgrid .cname').length);
    btnView.dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(doc.querySelectorAll('#tblbox tbody .nline').length > 0, '切回详细后注释命中行恢复');

    // 互不影响：切回 Tag 模式应还原之前的 Tag 结果
    mTag.dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(+doc.getElementById('nHit').textContent === nTag, '切回 Tag 模式还原原结果（不受注释检索影响）',
      doc.getElementById('nHit').textContent + ' vs ' + nTag);
    const tThs = Array.prototype.map.call(doc.querySelectorAll('#tblbox thead th'), (t) => t.textContent);
    ok(tThs.includes('命中详情') && !tThs.includes('命中行（注释原文）'), 'Tag 模式表头仍为「命中详情」', tThs.join(' / '));
    ok(doc.querySelectorAll('#tblbox .nline').length === 0, 'Tag 模式不残留注释行');

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
    ok(doc.getElementById('mNotes').textContent === '无', '页头注释数显示「无」',
      doc.getElementById('mNotes').textContent);

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
      doc.querySelectorAll('#tblbox tbody td.nm'), (e) => e.textContent.replace(/[#\d]/g, '').replace(/[a-z_]+$/, '').trim());

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

    // ③ 表头有「施法前摇」列且显示原值
    ok(/施法前摇/.test(doc.querySelector('#tblbox thead').textContent), '详细表新增「施法前摇」列');
    const cpCells = Array.prototype.map.call(doc.querySelectorAll('#tblbox tbody td.cpcell'), (e) => e.textContent.trim());
    ok(cpCells.includes('0.15'), '前摇列显示后台原值', cpCells.join(' / '));

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

    // ================= 英雄筛选（勾选英雄 = 只看这些英雄的技能） =================
    const heroDb = {
      fetchedAt: '2026-10-22T00:00:00.000Z',
      tags: [{ id: 488, name: '治疗', c1: '机制', c2: '包含效果' }],
      notePool: ['光环有0.1秒的粘滞时间。'],
      heroes: [
        { i: 10, zh: '甲英雄', en: 'alpha', a: '力量' },
        { i: 11, zh: '乙英雄', en: 'beta', a: '敏捷' },
        { i: 12, zh: '丙英雄', en: 'gamma', a: '智力' }
      ],
      abilities: [
        { i: 9401, n: '甲一', en: 'alpha_one', d: [488], g: [], m: [], e: [], nt: [0], h: [10] },
        { i: 9402, n: '甲二', en: 'alpha_two', d: [488], g: [], m: [], e: [], h: [10] },
        { i: 9403, n: '乙一', en: 'beta_one', d: [488], g: [], m: [], e: [], h: [11], nt: [0] },
        { i: 9404, n: '无归属', en: 'orphan', d: [488], g: [], m: [], e: [] }
      ]
    };
    window.__tagsearch.applyDb(heroDb, '合成测试数据（英雄）');
    mTag.dispatchEvent(new window.Event('click', { bubbles: true }));
    doc.getElementById('btnClear').dispatchEvent(new window.Event('click', { bubbles: true }));  // 清掉上一组测试留下的前摇区间

    const heroGrid = doc.getElementById('heroGrid');
    const heroBody = doc.getElementById('heroBody');
    ok(!!doc.getElementById('paneHero') && !!heroGrid, '左栏存在「英雄筛选」卡片');
    ok(/名册 3/.test(doc.getElementById('mHero').textContent), '页头显示英雄名册数',
      doc.getElementById('mHero').textContent);
    ok(heroBody.style.display === 'none', '英雄名册默认收起（不占版面）');
    doc.getElementById('heroToggle').dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(heroBody.style.display !== 'none', '点「展开」后显示名册');
    const chips = () => Array.prototype.slice.call(heroGrid.querySelectorAll('.hchip'));
    ok(chips().length === 2, '只列出有技能记录的英雄（0 技能的「丙英雄」不出现）', chips().length);
    ok(chips().every((c) => !!c.querySelector('.dot')), '每个英雄带主属性色点');
    ok(/全部英雄（2）/.test(doc.getElementById('heroSum').textContent), '未勾选时摘要为「全部英雄」',
      doc.getElementById('heroSum').textContent);

    // 勾选「甲英雄」→ 只留该英雄的技能
    const tagInp4 = doc.querySelector('.grp[data-k="and"] .rows input');
    tagInp4.value = '治疗';
    tagInp4.dispatchEvent(new window.Event('input', { bubbles: true }));
    doc.getElementById('btnRun').dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(+doc.getElementById('nHit').textContent === 4, '未勾选英雄时命中 4 条（全库）',
      doc.getElementById('nHit').textContent);

    const cbA = heroGrid.querySelector('.hchip input[value="10"]');
    cbA.checked = true;
    cbA.dispatchEvent(new window.Event('change', { bubbles: true }));
    ok(heroGrid.querySelector('.hchip input[value="10"]').closest('.hchip').classList.contains('on'),
      '勾选后 chip 高亮');
    ok(+doc.getElementById('nHit').textContent === 2, '勾选英雄后立即按英雄重筛（甲英雄 2 条）',
      doc.getElementById('nHit').textContent);
    ok(/已按英雄筛选/.test(doc.getElementById('tblbox').textContent), '结果区提示按英雄筛选');
    ok(!/乙一/.test(doc.getElementById('tblbox').textContent) && !/无归属/.test(doc.getElementById('tblbox').textContent),
      '其他英雄与无归属条目被排除');
    const hrCell = doc.querySelector('#tblbox tbody td.nm .hr');
    ok(!!hrCell && /甲英雄/.test(hrCell.textContent), '结果表技能列下显示所属英雄', hrCell && hrCell.textContent);
    ok(/英雄/.test(doc.getElementById('expr').textContent), '「当前条件」表达式包含英雄条件',
      doc.getElementById('expr').textContent.trim());

    // 详情弹窗含「所属英雄」
    doc.querySelector('#tblbox tbody [data-detail]').dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(/所属英雄/.test(doc.getElementById('mBody').textContent), '技能详情含「所属英雄」段');
    doc.getElementById('mClose').dispatchEvent(new window.Event('click', { bubbles: true }));

    // 清空 / 全选 / 反选
    doc.getElementById('heroNone').dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(+doc.getElementById('nHit').textContent === 4, '「清空」英雄勾选后恢复全库命中',
      doc.getElementById('nHit').textContent);
    doc.getElementById('heroAll').dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(+doc.getElementById('nHit').textContent === 3, '「全选」= 甲乙两英雄的并集（3 条，无归属仍排除）',
      doc.getElementById('nHit').textContent);
    doc.getElementById('heroInv').dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(+doc.getElementById('nHit').textContent === 4, '「反选」后全部取消 → 回到全库',
      doc.getElementById('nHit').textContent);

    // 搜索框过滤 + 只对可见项操作
    const heroQ = doc.getElementById('heroQ');
    heroQ.value = 'beta';
    heroQ.dispatchEvent(new window.Event('input', { bubbles: true }));
    ok(chips().length === 1 && /乙英雄/.test(chips()[0].textContent), '搜索框按中文/英文过滤英雄',
      chips().map((c) => c.textContent.trim()).join('/'));
    doc.getElementById('heroAll').dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(+doc.getElementById('nHit').textContent === 1, '「全选」只作用于当前搜索到的英雄（乙英雄 1 条）',
      doc.getElementById('nHit').textContent);
    heroQ.value = '';
    heroQ.dispatchEvent(new window.Event('input', { bubbles: true }));
    ok(chips().length === 2, '清空搜索框后恢复完整名册');

    // 与注释检索共用：注释模式同样受英雄筛选影响
    mNote.dispatchEvent(new window.Event('click', { bubbles: true }));
    const noteQ2 = doc.getElementById('noteQ');
    noteQ2.value = '粘滞';
    doc.getElementById('btnRunN').dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(+doc.getElementById('nHit').textContent === 1 &&
      /乙一/.test(doc.getElementById('tblbox').textContent), '注释检索同样按英雄筛选（只剩乙一）',
      doc.getElementById('nHit').textContent);
    ok(/已按英雄筛选/.test(doc.getElementById('tblbox').textContent), '注释模式同样提示按英雄筛选');
    mTag.dispatchEvent(new window.Event('click', { bubbles: true }));
    doc.getElementById('heroNone').dispatchEvent(new window.Event('click', { bubbles: true }));
    ok(+doc.getElementById('nHit').textContent === 4, '取消英雄勾选后 Tag 结果恢复',
      doc.getElementById('nHit').textContent);

    // 旧快照（无 heroes）→ 名册给出提示
    window.__tagsearch.applyDb({
      fetchedAt: '', tags: heroDb.tags,
      abilities: [{ i: 9501, n: '无英雄技能', en: 'x', d: [488], g: [], m: [], e: [] }]
    }, '旧快照');
    ok(/不含英雄名册/.test(heroGrid.textContent), '数据无英雄名册时给出重新抓取提示',
      heroGrid.textContent.trim().slice(0, 24));
    ok(doc.getElementById('mHero').textContent === '无', '页头英雄数显示「无」', doc.getElementById('mHero').textContent);

    console.log(fails ? `\n${fails} 项失败` : '\n全部通过');
    process.exit(fails ? 1 : 0);
  })
  .catch((e) => { console.error(e); process.exit(2); });
