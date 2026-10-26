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

3) 英雄目录（抓取时 heroes = 内容管理-英雄数据全量，含 ability_map）
   输出 heroes = [{i,zh,en,a}]；技能侧 h = 所属英雄 id 数组。
   归属**只**取 ability_map —— 即英雄数据页「人工处理数据 → 技能」里那串现版本技能。
   一个技能可属多个英雄（如共享天赋/共享子技能）。
   ⚠️ 不做英文名推断：技能总表里残留大量旧版本技能（米波 meepo_geostrike 地之突袭、
   幽鬼 spectre_haunt_single 如影随形、meepo_pack_rat 囤积狂鼠等）与废弃天赋，
   前缀也属于某英雄，推断会把旧技能混进筛选结果。未登记者 h 留空（= 非现版本英雄技能）。
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
        # Quill 会在行尾残留 U+FEFF（零宽无断字符，来自 <span class="ql-cursor">），
        # 必须显式删除：Python 的 \s 不匹配它，而 JS 的 \s 匹配 —— 不统一会让
        # build_data.py 与 index.html 内建构建（书签抓取的 _raw.json 走这条）产出不一致。
        s = s.replace('\ufeff', '')
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


# ---------------------------------------------------------------- 英雄 → 技能映射
heroes_raw = d.get('heroes') or []
HERO_ATTR_ORDER = ['力量', '敏捷', '智力', '全才']
heroes_out = []
skill_hero = {}          # 技能 id -> [英雄 id…]（按英雄在名册中的顺序）
for h in heroes_raw:
    try:
        hid = int(h.get('i') or 0)
    except (TypeError, ValueError):
        hid = 0
    if hid <= 0:
        continue
    try:
        attr = str(h.get('a') or '')
    except (TypeError, ValueError):
        attr = ''
    heroes_out.append({'i': hid, 'zh': h.get('zh') or '', 'en': h.get('en') or '', 'a': attr})
    for sid in h.get('s') or []:
        try:
            sid = int(sid)
        except (TypeError, ValueError):
            continue
        if sid <= 0:
            continue
        arr = skill_hero.setdefault(sid, [])
        if hid not in arr:
            arr.append(hid)


# ⚠️ 只认 ability_map（英雄数据页「人工处理数据 → 技能」里那串现版本技能）。
# 技能总表(/apg/admin/hero/ability)里残留大量旧版本技能与废弃天赋，
# 它们的英文名前缀同样属于某英雄，**不能**拿来推断归属，否则旧技能会混进筛选结果。

# ---------------------------------------------------------------- 技能主表
abilities = []
feat_skills = 0
note_skills = 0
note_line_refs = 0
cast_skills = 0
map_by_field = 0
map_none = 0

for a in d['abilities']:
    b = {k: a.get(k, []) for k in ('i', 'n', 'en', 'd', 'g', 'm', 'e')}

    # 所属英雄：仅取 ability_map（未被任何英雄登记 = 旧版本/废弃/通用条目）
    hs = skill_hero.get(a.get('i'))
    if hs:
        map_by_field += 1
        b['h'] = hs
    else:
        map_none += 1

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

    # 施法前摇（原样保留文本：可能为空、带备注如「0（魔晶）」、或「0.2/0.3」多值）
    cp = str(a.get('cp') or '').strip()
    if cp:
        b['cp'] = cp
        cast_skills += 1

    abilities.append(b)

out = {
    'fetchedAt': d.get('fetchedAt', ''),
    'tags': [{'id': t['id'], 'name': t['name'], 'c1': t.get('c1', ''), 'c2': t.get('c2', '')} for t in d['tags']],
    'featText': feat_text,
    'notePool': note_pool,
    'abilities': abilities,
    'heroes': heroes_out,
}

with open(DST, 'w', encoding='utf-8') as f:
    f.write('window.TAGDB=')
    json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    f.write(';')

feat_items = sum(len(v) for v in feat_text.values())
print('data.js 已生成：tags=%d abilities=%d 特性tag=%d 池槽=%d 引用=%d 带内容技能=%d '
      '注释行池=%d 注释引用=%d 带注释技能=%d 带前摇技能=%d size=%.0f KB'
      % (len(out['tags']), len(out['abilities']), len(feat_text), feat_items, refs[0], feat_skills,
         len(note_pool), note_line_refs, note_skills, cast_skills, os.path.getsize(DST) / 1024.0))
print('英雄：%d 个（力量 %d / 敏捷 %d / 智力 %d / 全才 %d / 其他 %d）；技能归属（仅 ability_map）：有归属 %d / 无归属 %d'
      % (len(heroes_out),
         sum(1 for h in heroes_out if h['a'] == '力量'), sum(1 for h in heroes_out if h['a'] == '敏捷'),
         sum(1 for h in heroes_out if h['a'] == '智力'), sum(1 for h in heroes_out if h['a'] == '全才'),
         sum(1 for h in heroes_out if h['a'] not in HERO_ATTR_ORDER),
         map_by_field, map_none))
