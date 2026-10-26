# -*- coding: utf-8 -*-
"""把 scripts/fetch_tagdb.bookmarklet.js 压成单行，并内联进 index.html 的「抓取书签」。

    python scripts/build_bookmarklet.py

产出/改动：
    scripts/bookmarklet.min.txt                  —— 单行书签代码（不含 javascript: 前缀）
    index.html 的 <script type="text/plain" id="bkmkSrc"> 块 —— 由本脚本写入

压缩策略（保守，不碰字符串内容）：
  1) 删掉「整行注释」——去掉缩进后以 // 开头的行
  2) 删掉行尾空白与空行
  3) 其余行用单空格拼接成一行

⚠️ 因为只删整行注释，源码里不要写行尾注释（如 `var x = 1; // 说明`），否则会被原样保留。
⚠️ 改完书签源码后必须重跑本脚本，否则 index.html 里的仍是旧代码。
"""
import os
import re
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(BASE)
SRC = os.path.join(BASE, 'fetch_tagdb.bookmarklet.js')
MIN = os.path.join(BASE, 'bookmarklet.min.txt')
HTML = os.path.join(ROOT, 'index.html')

BEGIN = '<!-- BKMK_BEGIN -->'
END = '<!-- BKMK_END -->'

if not os.path.exists(SRC):
    sys.exit('缺少源文件：%s' % SRC)

# ---------------------------------------------------------------- 1) 压缩
lines = []
with open(SRC, 'r', encoding='utf-8') as f:
    for raw in f:
        s = raw.strip()
        if not s:
            continue
        if s.startswith('//'):
            continue
        lines.append(s)

code = re.sub(r'\s+', ' ', ' '.join(lines)).strip()

if not code.endswith(';'):
    sys.exit('压缩后未以 ; 结尾，请检查源文件结构：%s' % code[-80:])

with open(MIN, 'w', encoding='utf-8', newline='\n') as f:
    f.write(code)

n = len(code)
print('书签代码：%s' % MIN)
print('  源码 %d 行 → 压缩后 1 行 / %d 字符（%.1f KB）' % (len(lines), n, n / 1024.0))

# ---------------------------------------------------------------- 2) 内联
with open(HTML, 'r', encoding='utf-8') as f:
    page = f.read()

block = (BEGIN + '\n'
         + '<!-- 抓取书签代码：由 scripts/build_bookmarklet.py 从\n'
         + '     scripts/fetch_tagdb.bookmarklet.js 生成，请勿手改本块 -->\n'
         + '<script type="text/plain" id="bkmkSrc">' + code + '</script>\n'
         + END)

if BEGIN in page and END in page:
    page2 = re.sub(re.escape(BEGIN) + r'.*?' + re.escape(END), lambda m: block, page,
                   count=1, flags=re.S)
    action = '替换已有块'
else:
    anchor = '<datalist id="tagOptions"></datalist>'
    if anchor not in page:
        sys.exit('index.html 里找不到插入锚点：%s' % anchor)
    page2 = page.replace(anchor, anchor + '\n\n' + block, 1)
    action = '首次插入'

with open(HTML, 'w', encoding='utf-8', newline='\n') as f:
    f.write(page2)

print('  index.html：%s（%d → %d 字符）' % (action, len(page), len(page2)))
