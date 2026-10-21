# -*- coding: utf-8 -*-
"""把 bsk 抓取的 _raw.json 转成浏览器可直接加载的 data.js（window.TAGDB）

技能特性内容（抓取时 abilities[].f = [{i:机制tag id, c:特性内容}]）在构建阶段**池化**：
同一 tag 的文本在全库高度重复（如「本技能被窃取后，施法前摇将被降低至0.15。」出现上千次），
故输出为 featText = {tagId: [文本0, 文本1, …]}，技能侧 f 只存「与 m 同序的池下标数组」，
体积从数百 KB 压到几 KB。
"""
import json
import os
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, '_raw.json')
DST = os.path.join(BASE, 'data.js')

with open(SRC, 'r', encoding='utf-8') as f:
    d = json.load(f)

if not d.get('ok'):
    sys.exit('_raw.json 不是有效抓取结果：%s' % d)

# ---------- 技能特性内容池 ----------
feat_text = {}          # tagId -> [文本…]（同 tag 的多种写法各占一个槽位）
refs = [0]              # 统计：成功建立引用的次数


def feat_slot(tag_id, text):
    arr = feat_text.setdefault(tag_id, [])
    try:
        return arr.index(text)
    except ValueError:
        arr.append(text)
        return len(arr) - 1


abilities = []
feat_skills = 0
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
    abilities.append(b)

out = {
    'fetchedAt': d.get('fetchedAt', ''),
    'tags': [{'id': t['id'], 'name': t['name'], 'c1': t.get('c1', ''), 'c2': t.get('c2', '')} for t in d['tags']],
    'featText': feat_text,
    'abilities': abilities,
}

with open(DST, 'w', encoding='utf-8') as f:
    f.write('window.TAGDB=')
    json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    f.write(';')

pool_items = sum(len(v) for v in feat_text.values())
print('data.js 已生成：tags=%d abilities=%d 特性tag=%d 池槽=%d 引用=%d 带内容技能=%d size=%.0f KB'
      % (len(out['tags']), len(out['abilities']), len(feat_text), pool_items, refs[0],
         feat_skills, os.path.getsize(DST) / 1024.0))
