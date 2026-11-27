#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""生成 icons_b64.js —— 给 file://（双击 index.html）下截图用的图标内联包。

为什么需要：
  浏览器对 file:// 页面上的图片做 canvas 取值会被判为「跨源污染」，toBlob 直接抛错，
  file:// 页面又 fetch 不到本地字节 —— 两条常规读图途径全断。
  唯一出路是把图片本身变成 data: URL（data: 不污染 canvas），而 data: URL 只能预先
  生成好由 <script> 带进来。

做法：
  读 data.js 的 imgMap（所有 <img src> 都来自它的 s / u 字段），逐个把 PNG 压成
  最长边 ≤MAX_SIDE 的 webp，写成
      window.ICON_B64 = { "icons/spellicons/xxx_png.png": "data:image/webp;base64,...", ... }
  只在 file:// 下按需加载（shot.js 里判断），http 打开时仍走 fetch 原图，画质更好。

用法：
  python scripts/gen_icon_b64.py            # 更新 data.js 或换过图标后跑一次
  python scripts/gen_icon_b64.py --check    # 只检查包是否与 data.js/图标一致，不写文件
"""
import base64
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_JS = os.path.join(ROOT, 'data.js')
OUT_JS = os.path.join(ROOT, 'icons_b64.js')

MAX_SIDE = 128          # 卡片里最大图标显示约 88px，2 倍屏 176px；128 是体积与清晰度的折中
QUALITY = 88
SKIP_ABOVE = 40 * 1024 * 1024       # 输出超过这个体积就报警（正常约 6~8MB）


def load_img_paths():
    """data.js → imgMap 里全部图片相对路径（s 与 u）"""
    with io.open(DATA_JS, encoding='utf-8') as f:
        txt = f.read()
    m = re.match(r'\s*window\.TAGDB\s*=\s*', txt)
    body = txt[m.end():] if m else txt
    body = body.rstrip().rstrip(';')
    db = json.loads(body)
    paths = []
    seen = set()
    for v in (db.get('imgMap') or {}).values():
        if not isinstance(v, dict):
            continue
        for k in ('s', 'u'):
            p = (v.get(k) or '').strip()
            if p and p not in seen:
                seen.add(p)
                paths.append(p)
    return sorted(paths)


def encode(path):
    from PIL import Image
    full = os.path.join(ROOT, path.replace('/', os.sep))
    im = Image.open(full)
    if im.mode not in ('RGBA', 'RGB'):
        im = im.convert('RGBA')
    im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, 'WEBP', quality=QUALITY, method=4)
    return 'data:image/webp;base64,' + base64.b64encode(buf.getvalue()).decode('ascii')


def main():
    check = '--check' in sys.argv
    paths = load_img_paths()
    if not paths:
        print('✗ data.js 里没有 imgMap，先跑 build_data.py')
        return 1

    out = {}
    miss = 0
    for i, p in enumerate(paths, 1):
        try:
            out[p] = encode(p)
        except Exception as e:                       # 文件缺失/损坏：跳过，截图时显示占位
            miss += 1
            print('  ! 跳过 %s（%s）' % (p, e))
        if i % 300 == 0:
            print('   … %d/%d' % (i, len(paths)))

    js = ('/* 自动生成，勿手改 —— python scripts/gen_icon_b64.py\n'
          ' * 用途：file:// 双击打开时，截图需要把图标内联成 data: URL 才能读像素。\n'
          ' * 来源：data.js 的 imgMap（%d 张，最长边 %dpx webp q%d）*/\n'
          'window.ICON_B64 = %s;\n') % (len(out), MAX_SIDE, QUALITY,
                                        json.dumps(out, ensure_ascii=False, separators=(',', ':')))
    data = js.encode('utf-8')
    size = len(data)

    if os.path.exists(OUT_JS):
        with open(OUT_JS, 'rb') as f:
            old = f.read()
    else:
        old = b''

    print('图标 %d 张，缺失 %d；icons_b64.js %.2f MB（base64 前原始合计另计）'
          % (len(out), miss, size / 1048576.0))

    if check:
        same = (old == data)
        print('检查：%s' % ('一致' if same else '不一致，需要重新生成'))
        return 0 if same else 2

    if old == data:
        print('内容未变，跳过写入')
        return 0
    with open(OUT_JS, 'wb') as f:
        f.write(data)
    print('已写入 %s' % OUT_JS)
    if size > SKIP_ABOVE:
        print('⚠ 体积偏大（>%d MB），可调小 MAX_SIDE' % (SKIP_ABOVE // 1048576))
    return 0


if __name__ == '__main__':
    sys.exit(main())
