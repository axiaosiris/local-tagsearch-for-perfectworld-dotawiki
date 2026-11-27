/* shot.js —— 结果区「长截图」（无第三方依赖，2026-11-27）
 *
 * 为什么不引 html2canvas：本项目是纯离线单页，不想为一次截图加一个大库；
 * 浏览器原生就能做——把 DOM 塞进 SVG 的 <foreignObject> 再由 Image 光栅化。
 *
 * 流程：
 *   1) 克隆 main > .card（=「命中 N 个技能」行 + 检索条件行 + 全部结果卡片），
 *      只截这块，不截整页；
 *   2) 预处理：去掉「简洁展示 / 导出 CSV」两个按钮、解除 .tblbox 的 max-height 滚动裁剪、
 *      把所有 <img> 换成内联 dataURL；
 *   3) XMLSerializer 序列化成 XHTML —— <img>/<br> 必须自闭合，否则 SVG 解析失败整张空白；
 *   4) 套进 <svg><foreignObject> 光栅化；高度超过单张上限时按 CHUNK 分块，逐块绘制到
 *      同一张 canvas（= 自动拼接长截图；成品仍是一张图）；
 *   5) canvas.toBlob → 触发下载，文件名由调用方给（含检索条件 + 分钟级时间）。
 *
 * 图片为什么用 fetch：结果区的 <img> 带 loading="lazy"，没滚动到的图既不 load 也不 error，
 * 靠 img.onload 会永久挂起。fetch 同源读字节最稳。
 *
 * file:// 怎么办：浏览器不允许读 file:// 图片的像素（canvas 被标成跨源污染，toBlob 直接抛），
 * 页面也 fetch 不到本地字节。唯一出路是让图片本身变成 data: URL —— 预先由
 * scripts/gen_icon_b64.py 生成 icons_b64.js（imgMap 里全部图标，最长边 128px webp），
 * file:// 下按需 <script> 载入后直接取用；http 打开仍走 fetch 原图（画质更好）。
 */
window.TagShot = (function () {
  'use strict';

  var CHUNK = 15000;       // 分块渲染时每块高度（CSS px）：块越少越省（每块都要重新序列化 SVG）
  var SINGLE_MAX = 15000;  // 单块 SVG 最大高度（Chrome 纹理上限约 16384，留余量）
  var MAX_SIDE = 32000;    // canvas 单边上限（约 32767，留余量）
  var MAX_AREA = 2.4e8;    // canvas 总面积上限（约 2.68 亿）

  /* 截图专用覆盖样式：解除裁剪 + 去掉过渡带来的偶发差异 */
  var EXTRA_CSS = [
    '#shotroot{background:#fff;}',
    '#shotroot .tblbox{max-height:none!important;overflow:visible!important;}',
    '#shotroot *{transition:none!important;animation:none!important;}',
    '#shotroot .card{border-radius:0;}',
    '#shotroot a{text-decoration:none!important;}'
  ].join('\n');

  function collectCss() {
    var out = [], st = document.querySelectorAll('style');
    for (var i = 0; i < st.length; i++) out.push(st[i].textContent || '');
    // :root 里的 CSS 变量在 SVG 文档里挂不到我们的 div 上 → 改挂到 #shotroot
    return out.join('\n').replace(/:root\s*\{/g, '#shotroot{');
  }

  var BLOB_CACHE = {};

  /* ---------- file:// 专用：图标内联包（icons_b64.js，data: URL 不污染 canvas） ---------- */
  var BUNDLE = null, NAME_IDX = null;

  /** 只有 file:// 才需要绕道；http(s) 下 fetch 原图更清晰 */
  function useBundle() {
    return location.protocol === 'file:' || window.TAGSHOT_FORCE_B64 === true;
  }

  function iconBundle() {
    if (BUNDLE) return BUNDLE;
    BUNDLE = new Promise(function (res, rej) {
      if (window.ICON_B64) return res(window.ICON_B64);
      var t = setTimeout(function () {
        rej(new Error('图标内联包加载超时（icons_b64.js 缺失或损坏）'));
      }, 20000);
      var sc = document.createElement('script');
      sc.src = 'icons_b64.js';
      sc.onload = function () {
        clearTimeout(t);
        if (window.ICON_B64) res(window.ICON_B64);
        else rej(new Error('icons_b64.js 内容为空'));
      };
      sc.onerror = function () {
        clearTimeout(t);
        rej(new Error('缺少 icons_b64.js：请先运行 python scripts/gen_icon_b64.py'));
      };
      document.head.appendChild(sc);
    });
    return BUNDLE;
  }

  /** 在包里找这张图：先按原样，再按文件名兜底 */
  function bundleKey(map, src) {
    var p = src.replace(/^\.\//, '');
    if (map[p]) return p;
    if (!NAME_IDX) {
      NAME_IDX = {};
      Object.keys(map).forEach(function (k) { NAME_IDX[k.split('/').pop()] = k; });
    }
    return NAME_IDX[p.split('/').pop()] || '';
  }

  /** 限并发 map（保序） */
  function pool(items, limit, fn) {
    var out = new Array(items.length), i = 0;
    function worker() {
      if (i >= items.length) return Promise.resolve();
      var k = i++;
      return fn(items[k], k).then(function (v) { out[k] = v; return worker(); });
    }
    var ws = [];
    for (var j = 0; j < Math.min(limit, items.length); j++) ws.push(worker());
    return Promise.all(ws).then(function () { return out; });
  }

  /** 同源读图 → 内联 dataURL；按显示尺寸的 2 倍重编码（webp），
   *  否则几百张原始图标会让 SVG 字符串涨到几十 MB，Chromium 的 SVG 图像直接卡死。
   *  读失败/超时退回同源绝对地址（同源不污染 canvas）。 */
  function imgDataURL(src, wantW) {
    if (!src) return Promise.resolve('');
    if (src.slice(0, 5) === 'data:') return Promise.resolve(src);

    if (useBundle()) {                       // file://：只能取预生成的 data: URL
      var bk = src + '#b';
      if (!BLOB_CACHE[bk]) {
        BLOB_CACHE[bk] = iconBundle().then(function (m) {
          var k = bundleKey(m, src);
          return k ? m[k] : '';
        });
      }
      return BLOB_CACHE[bk];
    }

    var key = src + '@' + (wantW || 0);
    if (BLOB_CACHE[key]) return BLOB_CACHE[key];
    var abs;
    try { abs = new URL(src, location.href).href; } catch (e) { abs = src; }

    var job = fetch(abs, { cache: 'force-cache', credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.blob();
      })
      .then(function (b) {
        return createImageBitmap(b).then(function (bmp) {
          var w = bmp.width, h = bmp.height;
          if (wantW && wantW < w) { h = Math.max(1, Math.round(h * wantW / w)); w = wantW; }
          var c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(bmp, 0, 0, w, h);
          if (bmp.close) bmp.close();
          var u = c.toDataURL('image/webp', 0.92);
          if (u.slice(0, 15) !== 'data:image/webp') u = c.toDataURL('image/png');
          return u;
        });
      })
      .catch(function () { return abs; });

    // 单张图读取加超时：万一某张卡住，不能把整张截图拖死
    BLOB_CACHE[key] = Promise.race([job, new Promise(function (res) {
      setTimeout(function () { res(abs); }, 8000);
    })]);
    return BLOB_CACHE[key];
  }

  /** UTF-8 → base64（比 encodeURIComponent 省：中文不会膨胀成 9 个字符） */
  function svgDataUrl(svg) {
    var bytes = new TextEncoder().encode(svg);
    var bin = '', CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return 'data:image/svg+xml;base64,' + btoa(bin);
  }

  /* ⚠ 必须用 data: URL：blob: URL 的 SVG 图像文档在 Chrome 里会把 canvas 标成污染，
     toBlob 直接抛 SecurityError（实测 2026-11-27，Chrome 158）。 */
  function buildSvg(xhtml, W, H, y, h) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + h + '">' +
      '<foreignObject x="0" y="0" width="' + W + '" height="' + H + '">' +
      '<div xmlns="http://www.w3.org/1999/xhtml" id="shotroot" ' +
      'style="width:' + W + 'px;margin-top:-' + y + 'px;background:#fff">' +
      xhtml +
      '</div></foreignObject></svg>';
    return svgDataUrl(svg);
  }

  function loadSvg(url) {
    return new Promise(function (resolve, reject) {
      var done = false, im = new Image();
      var t = setTimeout(function () {
        if (done) return;
        done = true;
        reject(new Error('图片渲染超时（结果条目太多，建议缩小检索范围后重试）'));
      }, 45000);
      im.onload = function () { if (done) return; done = true; clearTimeout(t); resolve(im); };
      im.onerror = function () { if (done) return; done = true; clearTimeout(t); reject(new Error('SVG 光栅化失败')); };
      im.src = url;
    });
  }

  /** 落盘，返回 {mode, saved}：
   *   mode='server'   本地服务写进 tagsearch/screenshots（路径固定、无弹窗、可重名避让）
   *   mode='file'     file:// 下用户自己挑位置（另存为对话框）
   *   mode='download' 退回浏览器下载
   *   mode='cancel'   用户在另存为对话框里点了取消 */
  function save(blob, name, multi, handle) {
    if (location.protocol === 'file:') return saveFile(blob, name, multi, handle);
    return fetch('/api/save-shot?name=' + encodeURIComponent(name), {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: blob
    }).then(function (r) {
      if (!r.ok) throw new Error('no api');
      return r.json();
    }).then(function (j) {
      if (!j || !j.ok) throw new Error('save failed');
      return { mode: 'server', saved: j.path };
    }).catch(function () { return download(blob, name); });
  }

  /** file:// 落盘：单张走「另存为」（Chrome 允许 file:// 用这套 API，且不受
   *  「一个站点连续下载多个文件被拦」的限制，还能直接存进 tagsearch\screenshots）；
   *  多张/不支持/无用户手势时退回下载。 */
  function saveFile(blob, name, multi, handle) {
    if (handle) {
      return handle.createWritable().then(function (w) {
        return w.write(blob).then(function () { return w.close(); });
      }).then(function () {
        return { mode: 'file', saved: handle.name };
      });
    }
    if (!multi && typeof window.showSaveFilePicker === 'function') {
      return window.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: 'PNG 图片', accept: { 'image/png': ['.png'] } }]
      }).then(function (h) {
        return h.createWritable().then(function (w) {
          return w.write(blob).then(function () { return w.close(); });
        }).then(function () {
          return { mode: 'file', saved: h.name };
        });
      }).catch(function (e) {
        if (e && e.name === 'AbortError') return { mode: 'cancel', saved: '' };
        return download(blob, name);        // 合成点击 / 不支持 → 下载
      });
    }
    return download(blob, name);
  }

  /** 退回浏览器下载（file:// 或静态服务无 /api 时） */
  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
    return Promise.resolve({ mode: 'download', saved: '' });
  }

  /**
   * 截取结果区。
   * @param {Object} opt  {el, name, onProgress(msg)}
   * @returns {Promise<{width:number,height:number,name:string,bytes:number}>}
   */
  function capture(opt) {
    opt = opt || {};
    var el = opt.el || document.querySelector('main .card');
    var name = opt.name || ('screenshot_' + Date.now() + '.png');
    var say = opt.onProgress || function () {};

    if (!el) return Promise.reject(new Error('找不到结果区'));
    if (el.offsetWidth < 10) return Promise.reject(new Error('结果区宽度为 0，无法截图'));

    /* file:// 下落盘用「另存为」。⚠ 必须在点击产生的「瞬时激活」里同步发起（约 5 秒就过期），
       而大结果渲染要 8~20 秒 —— 所以在这里先弹，渲染完再往句柄里写。 */
    var picker = null;
    if (location.protocol === 'file:' && typeof window.showSaveFilePicker === 'function'
      && !opt.noPicker) {
      try {
        picker = window.showSaveFilePicker({
          suggestedName: name,
          types: [{ description: 'PNG 图片', accept: { 'image/png': ['.png'] } }]
        });
      } catch (e) { picker = null; }
    }

    var W = Math.round(el.offsetWidth);
    /** 图上实际要渲染多大（CSS px）；按 2 倍取，缩小时不糊。
     *  ⚠ 只看布局尺寸，别掺 naturalWidth —— 克隆里的图可能还没加载（naturalWidth=0），
     *  掺进来会让收集和替换算出不同的 key，图就贴不上（表现为卡片图变灰块）。 */
    function wantOf(im) {
      var r = im.getBoundingClientRect();
      var disp = Math.round(Math.max(r.width, r.height) || 0);
      return Math.max(48, Math.round((disp || im.naturalWidth || 48) * 2));
    }
    var srcImgs = Array.prototype.slice.call(el.querySelectorAll('img'));
    var jobs = [], seen = {};
    srcImgs.forEach(function (im) {
      var s = im.getAttribute('src') || '';
      if (!s || s.slice(0, 5) === 'data:') return;
      var w = wantOf(im);
      var k = s + '@' + w;
      if (!seen[k]) { seen[k] = 1; jobs.push({ k: k, s: s, w: w }); }
    });

    /* file:// 下先把内联包拿下来（约 7MB，只加载一次）；失败要在这里就报清楚，
       否则会退化成「所有图标空白」这种难查的结果。 */
    var ready = Promise.resolve(null);
    if (useBundle()) {
      say('正在加载本地图标包…');
      ready = iconBundle();
    }

    var LIMIT = 12;                     // 并发读图数：一次几百张会被浏览器连接数卡住
    var fileHandle = null;
    return ready.then(function () {
      if (!picker) return null;
      say('等待选择保存位置…');
      return picker.catch(function (e) {
        var err = new Error('已取消保存');
        err.cancelled = true;
        throw err;
      });
    }).then(function (handle) {
      fileHandle = handle || null;
      say('正在读取图标…（0/' + jobs.length + '）');
      var done = 0;
      return pool(jobs, LIMIT, function (j) {
        return imgDataURL(j.s, j.w).then(function (u) {
          done++;
          if (done % 20 === 0 || done === jobs.length) say('正在读取图标…（' + done + '/' + jobs.length + '）');
          return { k: j.k, u: u };
        });
      });
    }).then(function (list) {
      var map = {}, lost = 0;
      list.forEach(function (x) {
        map[x.k] = x.u;
        if (!x.u) lost++;
      });
      if (lost) console.warn('[shot] ' + lost + '/' + jobs.length + ' 张图标没取到，将显示为空白');
      if (lost && useBundle()) say('有 ' + lost + ' 张图标不在内联包里，将显示为空白（可重跑 scripts/gen_icon_b64.py）');

      /* ---------- 克隆 + 预处理 ---------- */
      var clone = el.cloneNode(true);
      Array.prototype.forEach.call(clone.querySelectorAll('#btnView, #btnCsv'), function (n) {
        if (n.parentNode) n.parentNode.removeChild(n);
      });
      // 克隆根上若带定位内联样式（外部传入的容器可能是 fixed 定位），会脱离文档流导致测高为 0
      clone.style.position = '';
      clone.style.left = '';
      clone.style.top = '';
      clone.style.margin = '';
      Array.prototype.forEach.call(clone.querySelectorAll('.tblbox'), function (tb) {
        tb.setAttribute('style', (tb.getAttribute('style') || '') +
          ';max-height:none!important;overflow:visible!important;');
      });

      var st = document.createElement('style');
      st.textContent = collectCss() + '\n' + EXTRA_CSS;
      clone.insertBefore(st, clone.firstChild);

      /* ---------- 离屏测量（解开滚动后才是完整高度） ---------- */
      var holder = document.createElement('div');
      holder.setAttribute('style',
        'position:fixed;left:-99999px;top:0;width:' + W + 'px;background:#fff;pointer-events:none;');
      holder.appendChild(clone);
      document.body.appendChild(holder);
      // 必须在 holder 里（有布局）之后再按显示尺寸贴图，否则量到的都是 0
      Array.prototype.forEach.call(clone.querySelectorAll('img'), function (im) {
        var s = im.getAttribute('src') || '';
        im.removeAttribute('loading');
        if (!s) return;
        var u = map[s + '@' + wantOf(im)] || map[s];
        if (u) im.setAttribute('src', u);
      });
      var H = Math.round(holder.getBoundingClientRect().height);
      document.body.removeChild(holder);
      if (!H) return Promise.reject(new Error('结果区高度为 0'));

      var xhtml = new XMLSerializer().serializeToString(clone);

      /* ---------- 缩放档位：优先整档，避免非整数缩放发糊 ---------- */
      var scale = pickScale(W, H);
      var maxPageH = Math.floor(MAX_SIDE / scale);     // 单张 canvas 最多装多少 CSS px
      var pages = Math.ceil(H / maxPageH);

      /* ---------- 逐页光栅化并导出 ---------- */
      var out = { width: 0, height: 0, name: name, pages: pages, bytes: 0 };
      var seq = Promise.resolve();
      for (var pi = 0; pi < pages; pi++) {
        (function (pi) {
          var y0 = pi * maxPageH;
          var ph = Math.min(maxPageH, H - y0);
          seq = seq.then(function () {
            return renderPage(xhtml, W, H, y0, ph, scale, pages, pi, name, say);
          }).then(function (r) {
            if (pi === 0) { out.width = r.width; out.height = r.height; out.bytes = r.bytes; }
            return save(r.blob, r.name, pages > 1, pi === 0 ? fileHandle : null).then(function (res) {
              out.name = r.name;
              if (res.mode === 'cancel') out.cancelled = true;
              if (!out.mode) out.mode = res.mode;
              out.saved = res.saved || out.saved || '';
              (out.files = out.files || []).push(res.saved || r.name);
            });
          });
        })(pi);
      }
      return seq.then(function () { return out; });
    });
  }

  /** 选缩放：2 / 1.5 / 1 里能塞进 canvas 上限的最大档；
   *  连 1 倍都超高（结果特别长）时用 1 倍并分页 —— 宁可多几张，也不把文字缩糊 */
  function pickScale(W, H) {
    var cands = [2, 1.5, 1];
    for (var i = 0; i < cands.length; i++) {
      var s = cands[i];
      if (H * s <= MAX_SIDE && W * s * H * s <= MAX_AREA) return s;
    }
    return 1;
  }

  /** 渲染 [y0, y0+ph) 这一段到一张 canvas 并转 PNG（ph 内再按 CHUNK 分块，避开单次纹理上限） */
  function renderPage(xhtml, W, H, y0, ph, scale, pages, pi, name, say) {
      var cw = Math.max(1, Math.round(W * scale));
      var ch = Math.max(1, Math.round(ph * scale));
      var canvas = document.createElement('canvas');
      canvas.width = cw; canvas.height = ch;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cw, ch);

      function drawAt(im, y, h) {
        ctx.drawImage(im, 0, 0, W, h, 0, Math.round((y - y0) * scale),
          Math.round(W * scale), Math.round(h * scale));
      }

      var tail = pages > 1 ? '_' + (pi + 1) : '';
      var base = name;
      if (tail) base = name.replace(/\.png$/i, '') + tail + '.png';

      var render;
      if (ph <= SINGLE_MAX) {
        say('正在生成图片…' + (pages > 1 ? '（第 ' + (pi + 1) + '/' + pages + ' 张）' : ''));
        render = loadSvg(buildSvg(xhtml, W, H, y0, ph)).then(function (im) {
          drawAt(im, y0, ph);
        });
      } else {
        var total = Math.ceil(ph / CHUNK), y = y0, n = 0;
        render = (function step() {
          if (y >= y0 + ph) return Promise.resolve();
          var h = Math.min(CHUNK, y0 + ph - y);
          return loadSvg(buildSvg(xhtml, W, H, y, h)).then(function (im) {
            drawAt(im, y, h);
            y += h; n++;
            say('正在拼接长图…' + n + '/' + total + (pages > 1 ? '（第 ' + (pi + 1) + '/' + pages + ' 张）' : ''));
            return step();
          });
        })();
      }

      return render.then(function () {
        say('正在导出 PNG…');
        return new Promise(function (resolve, reject) {
          canvas.toBlob(function (blob) {
            if (!blob) return reject(new Error('生成 PNG 失败（canvas 过大或被污染）'));
            resolve({ blob: blob, width: cw, height: ch, name: base, bytes: blob.size });
          }, 'image/png');
        });
      });
    }

  return { capture: capture, _imgDataURL: imgDataURL, _buildSvg: buildSvg };
})();
