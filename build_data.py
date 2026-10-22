# -*- coding: utf-8 -*-
"""把 bsk 抓取的 _raw.json 转成浏览器可直接加载的 data.js（window.TAGDB）

两类文本在构建阶段**池化**，避免 data.js 膨胀：

1) 技能特性内容（抓取时 abilities[].f = [{i:机制tag id, c:特性内容}]）
   同一 tag 的文本在全库高度重复（如「本技能被窃取后，施法前摇将被降低至0.15。」出现上千次），
   故输出 featText = {tagId: [文本0, 文本1, …]}，技能侧 f 只存「与 m 同序的池下标数组」。

2) 技能注释（抓取时 abilities[].note = skill_notes 富文本 HTML）
   先由 HTML 转成「纯文本行 + 缩进层级」，再按行去重成全局行池 notePool，
   技能侧 nt = 行池下标数组、ni = 与 nt 等长的缩进数组（全 0 时省略）。
   这样同一句话（如「光环有0.1秒的粘滞时间。」）在全库只存一份。
"""
import json
import os
import re
import sys
from html.parser import HTMLParser

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, '_raw.json')
DST = os.path.join(BASE, 'data.js')

with open(SRC, 'r', encoding='utf-8') as f:
    d = json.load(f)

if not d.get('ok'):
    sys.exit('_raw.json 不是有效抓取结果：%s' % d)


# ---------------------------------------------------------------- 注释 HTML → 文本行
class NoteParser(HTMLParser):
    """把 skill_notes 的富文本（Quill 输出的 ul/li/p/strong/img）拆成 [{ind,text}]。

    - <li class="ql-indent-N"> / <p class="ql-indent-N"> 的缩进层级取 N（默认 0）
    - <br> 视为同一层级换行
    - <img>（注释里的插图）记为「〔图〕」，使纯文本检索仍能看出该行有图
    - 其余行内标签（strong / em / span / a …）只保留文字
    """

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.lines = []
        self._buf = []
        self._ind = 0

    def _flush(self):
        s = ''.join(self._buf)
        s = s.replace('\xa0', ' ')
        s = re.sub(r'\s+', ' ', s).strip()
        if s:
            self.lines.append({'ind': self._ind, 'text': s})
        self._buf = []

    def handle_starttag(self, tag, attrs):
        if tag in ('li', 'p'):
            self._flush()
            cls = ''
            for k, v in attrs:
                if k == 'class':
                    cls = v or ''
                    break
            m = re.search(r'ql-indent-(\d+)', cls)
            self._ind = int(m.group(1)) if m else 0
        elif tag == 'br':
            self._flush()
        elif tag == 'img':
            self._buf.append('〔图〕')

    def handle_startendtag(self, tag, attrs):
        if tag == 'img':
            self._buf.append('〔图〕')
        elif tag == 'br':
            self._flush()

    def handle_endtag(self, tag):
        if tag in ('li', 'p'):
            self._flush()

    def handle_data(self, data):
        self._buf.append(data)

    def result(self):
        self._flush()
        return self.lines


def note_lines(html):
    if not html or not isinstance(html, str):
        return []
    p = NoteParser()
    try:
        p.feed(html)
        p.close()
    except Exception:                                        # noqa: BLE001
        return []
    return p.result()


# ---------------------------------------------------------------- 技能特性内容池
feat_text = {}          # tagId -> [文本…]（同 tag 的多种写法各占一个槽位）
refs = [0]              # 统计：成功建立引用的次数


def feat_slot(tag_id, text):
    arr = feat_text.setdefault(tag_id, [])
    try:
        return arr.index(text)
    except ValueError:
        arr.append(text)
        return len(arr) - 1


# ---------------------------------------------------------------- 注释行池
note_pool = []          # [行文本…]（全库去重）
pool_idx = {}


def note_slot(text):
    i = pool_idx.get(text)
    if i is None:
        i = len(note_pool)
        note_pool.append(text)
        pool_idx[text] = i
    return i


abilities = []
feat_skills = 0
note_skills = 0
note_line_refs = 0

for a in d['abilities']:
    b = {k: a.get(k, []) for k in ('i', 'n', 'en', 'd', 'g', 'm', 'e')}

    raw = a.get('f') or []
    fidx = []
    for it in raw:
        if not isinstance(it, dict):
            fidx.append(-1)
            continue
        try:
            tid = int(it.get('i') or 0)
        except (TypeError, ValueError):
            tid = 0
        c = (it.get('c') or '').strip()
        if tid > 0 and c:
            fidx.append(feat_slot(tid, c))
            refs[0] += 1
        else:
            fidx.append(-1)
    if fidx:
        b['f'] = fidx
        if any(x >= 0 for x in fidx):
            feat_skills += 1

    lines = note_lines(a.get('note'))
    if lines:
        b['nt'] = [note_slot(x['text']) for x in lines]
        inds = [x['ind'] for x in lines]
        if any(inds):
            b['ni'] = inds
        note_skills += 1
        note_line_refs += len(lines)

    abilities.append(b)

out = {
    'fetchedAt': d.get('fetchedAt', ''),
    'tags': [{'id': t['id'], 'name': t['name'], 'c1': t.get('c1', ''), 'c2': t.get('c2', '')} for t in d['tags']],
    'featText': feat_text,
    'notePool': note_pool,
    'abilities': abilities,
}

with open(DST, 'w', encoding='utf-8') as f:
    f.write('window.TAGDB=')
    json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    f.write(';')

feat_items = sum(len(v) for v in feat_text.values())
print('data.js 已生成：tags=%d abilities=%d 特性tag=%d 池槽=%d 引用=%d 带内容技能=%d '
      '注释行池=%d 注释引用=%d 带注释技能=%d size=%.0f KB'
      % (len(out['tags']), len(out['abilities']), len(feat_text), feat_items, refs[0], feat_skills,
         len(note_pool), note_line_refs, note_skills, os.path.getsize(DST) / 1024.0))
