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

4) 物品技能（抓取时 items = 内容管理-道具技能全量，字段与英雄技能一致）
   与英雄技能共用同一套池化；技能侧多一个 src='item' 标记（英雄技能不写 src，缺省即 'hero'）。
   ⚠️ 物品技能 id 与英雄技能**不是同一个编号空间**（都从 1 开始），所以一律不查 ability_map。

5) 现版本物品技能（抓取时 itemRefs = 道具数据 item/list 的 ability_map 引用 id 列表）
   口径（2026-11-06 用户定）：只算「有分类」道具——道具数据 item/list 的 `cate1` 非空
   （商店物品 / 中立物品 / 掉落 / 采集物品 / 派生物品…），且不是「已移除物品」「未发布物品」；
   分类为空的、已移除、未发布 一律不算现版本。
   命中的物品技能写 cur=1；顶层写 itemCur=true 表示本数据包带该标记。
   旧 _raw.json 没有 itemRefs → 不写 itemCur，检索器退回「全部物品技能都算现版本」的旧行为。

6) 非英雄单位技能（本地留档 `../编写规范/非英雄单位技能.md`）
   口径（2026-11-06 用户定）：技能总表里**代码名命中该表第 2 列**的条目即算非英雄单位技能。
   命中者写 src='creep'（原先它们落在 orphan 目录外）。按代码名精确匹配，不做前缀推断；
   该文件缺失时跳过（不写 creep，检索器把这些条目继续按 orphan 处理）。
"""
import datetime
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


# ---------------------------------------------------------------- 「本次抓取日更新」判定
# 用途：id ≥ 20000 的条目默认按「自定义技能」排除（检索时勾「包含被排除项」才放回），
# 但后台新建/刚改过的技能（如建筑机制条 20316–20322）应当立即可检索。
# 口径（2026-11-10 用户定）：update_time 落在**本次抓取日**（本地时区）的条目，
# 写 nx=1 —— 检索器据此跳过「自定义技能」排除，**即使没勾「包含被排除项」也能检索到**。
def _fetch_day(iso):
    s = str(iso or '').strip()
    if not s:
        return datetime.date.today()
    try:
        t = datetime.datetime.fromisoformat(s.replace('Z', '+00:00'))
    except ValueError:
        return datetime.date.today()
    if t.tzinfo is None:
        t = t.replace(tzinfo=datetime.timezone.utc)
    return t.astimezone().date()


FETCH_DAY = _fetch_day(d.get('fetchedAt'))


def is_fresh(ut):
    """update_time（秒级 unix，兼容毫秒）是否落在本次抓取日。"""
    try:
        n = int(ut)
    except (TypeError, ValueError):
        return False
    if n <= 0:
        return False
    if n > 10 ** 12:
        n //= 1000
    try:
        return datetime.datetime.fromtimestamp(n).date() == FETCH_DAY
    except (OverflowError, OSError, ValueError):
        return False


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

# ---------------------------------------------------------------- 非英雄单位技能（本地留档）
# 口径（2026-11-06 用户定）：以 `编写规范/非英雄单位技能.md` 为准，按代码名精确匹配。
# 该表由人工逐条维护：中文名 / 代码名 /（可选）后台 id / 分类 / 使用单位，
# 2026-11-09 起为五列（新增后台 id），故按「拆列后取首列+代码列+倒数第二列为分类」解析，四列版同样兼容。
CREEP_MD = os.environ.get('CREEP_MD') or os.path.join(BASE, '..', '编写规范', '非英雄单位技能.md')
# 单位代码名 → 简体中文名（「原主」列写的是 npc_dota_xxx，界面要显示中文）
CREEP_LOC = os.environ.get('CREEP_LOC') or os.path.join(
    BASE, '..', 'npc', 'resource', 'localization', 'abilities_schinese.txt')


def load_loc_names(path):
    m = {}
    if not os.path.isfile(path):
        return m
    with open(path, 'r', encoding='utf-8', errors='ignore') as f:
        for line in f:
            mm = re.match(r'\s*"([^"]+)"\s+"([^"]*)"', line)
            if mm:
                m[mm.group(1)] = mm.group(2)
    return m


loc_names = load_loc_names(CREEP_LOC)
creep_by_en = {}
if os.path.isfile(CREEP_MD):
    with open(CREEP_MD, 'r', encoding='utf-8') as f:
        for line in f:
            s = line.strip()
            if not s.startswith('|'):
                continue
            cells = [c.strip() for c in s.strip('|').split('|')]
            if len(cells) < 4:
                continue
            m = re.match(r'^`([^`]+)`$', cells[1])
            if not m:
                continue
            # 列：中文名 / 代码名 / 后台 id / 分类 / 原主 / 使用单位。
            # 「原主」列 2026-11-27 才加，旧版五列没有 → 按列数判定，仍兼容旧表。
            if len(cells) >= 6:
                cat, owner_cell = cells[-3], cells[-2]
            else:
                cat, owner_cell = cells[-2], ''
            om = re.match(r'^`([^`]+)`$', owner_cell) if owner_cell else None
            owner_code = om.group(1) if om else ''
            creep_by_en[m.group(1)] = {
                'zh': cells[0], 'cat': cat,
                'ownerCode': owner_code,
                'owner': loc_names.get(owner_code, '') if owner_code else '',
            }
    with_owner = sum(1 for v in creep_by_en.values() if v['owner'])
    print('非英雄单位技能表：%s（%d 条，有原主 %d 条）'
          % (os.path.normpath(CREEP_MD), len(creep_by_en), with_owner))
else:
    print('⚠️ 未找到非英雄单位技能表（%s）→ 本次不写 creep 来源' % os.path.normpath(CREEP_MD))

# ---------------------------------------------------------------- 物品名（卡片第二行）
# 2026-11-27 用户定：物品技能卡片第二行显示**物品名**，不再显示「现版本物品技能」来源标签。
# 解析：本地化物品名 DOTA_Tooltip_Ability_item_<code>（权威，如 crellas_crozier→克莱拉牧杖）
#   →《物品技能.md》段落标题 → 技能名文本规则（阿哈利姆系列、神符这类表里没登记的）。
ITEM_MD = os.environ.get('ITEM_MD') or os.path.join(BASE, '..', '编写规范', '物品技能.md')


def item_names():
    code_of, title_of = {}, {}
    if os.path.isfile(ITEM_MD):
        with open(ITEM_MD, 'r', encoding='utf-8') as f:
            for line in f:
                if not line.startswith('## '):
                    continue
                cm = re.search(r'`(item_[a-z0-9_]+)`', line)
                im = re.search(r'后台\s*id\s*[=：:]\s*(\d+)', line)
                if not (cm and im):
                    continue
                aid = im.group(1)
                if aid in code_of:          # 同一 id 多段落时取首个
                    continue
                code_of[aid] = cm.group(1)
                title_of[aid] = line[3:].split('—')[0].strip()
    loc_lower = {}
    for k, v in loc_names.items():
        loc_lower.setdefault(k.lower(), v)
    out = {}
    for aid, code in code_of.items():
        zh = loc_lower.get(('DOTA_Tooltip_Ability_item_' + code[len('item_'):]).lower(), '')
        nm = zh or title_of.get(aid, '')
        if nm:
            out[aid] = nm
    return out


def item_name_fallback(skill_name):
    """未在《物品技能.md》登记的物品技能 → 物品名。
    「激活圣水神符」→「圣水神符」；「技能升级（阿哈利姆神杖）」→「阿哈利姆神杖」；其余还原名。"""
    n = (skill_name or '').strip()
    if not n:
        return ''
    if n.startswith('激活'):
        return n[2:].strip()
    parens = re.findall(r'（([^）]+)）', n)
    if parens:
        return parens[-1].strip()
    return n


item_name_by_id = item_names()
if item_name_by_id:
    print('物品名映射：%d 条（来源《物品技能.md》+ 本地化）' % len(item_name_by_id))

# ---------------------------------------------------------------- 技能主表
# 三类来源共用同一套池化逻辑：
#   d['abilities'] = 英雄技能（命中非英雄单位技能表的写 src='creep'，其余不写 src，缺省即 'hero'）
#   d['items']     = 物品技能（写 src='item'）
# ⚠️ 物品技能的 id 与英雄技能**不是同一个编号空间**（都从 1 开始），
#    所以物品技能绝不能去查 ability_map，否则会同号误挂到某个英雄名下。
abilities = []
feat_skills = 0
note_skills = 0
note_line_refs = 0
cast_skills = 0
bonus_skills = 0
bonus_items = 0
value_skills = 0
value_items = 0
map_by_field = 0
map_none = 0

rows_in = [(a, None) for a in d.get('abilities') or []]
rows_in += [(a, 'item') for a in d.get('items') or []]

# 现版本物品技能 id（道具数据 item/list 里 **cate1 非空且非已移除/未发布** 的道具的 ability_map）。
# 空列表 = 抓取失败或旧 _raw.json → 不写 itemCur，检索器按旧行为处理。
item_refs = set()
for _x in d.get('itemRefs') or []:
    try:
        item_refs.add(int(_x))
    except (TypeError, ValueError):
        pass
item_cur = bool(item_refs)


creep_hit = 0
creep_miss = []


for a, src in rows_in:
    # 非英雄单位技能：代码名命中本地留档表 → src='creep'（优先级高于英雄归属判断，
    # 但这些条目本来也不在任何英雄的 ability_map 里，实测无冲突）
    if not src and creep_by_en and a.get('en') in creep_by_en:
        src = 'creep'
        creep_hit += 1

    b = {k: a.get(k, []) for k in ('i', 'n', 'en', 'd', 'g', 'm', 'e')}

    # 加成属性数据项（2026-11-23）：名称含 {%加成tag id%} 且 isShow=1 的自定义中文名。
    # 格式 bx=[[中文名(含替换符), [tag id…]], …]；旧快照无 bx 时为空，检索器显示 0 命中。
    bx = []
    for x in (a.get('bx') or []):
        if not isinstance(x, dict):
            continue
        nm = str(x.get('n') or '')
        ids = []
        for tid in (x.get('t') or []):
            try:
                ids.append(int(tid))
            except (TypeError, ValueError):
                pass
        if nm and ids:
            bx.append([nm, ids])
    if bx:
        b['bx'] = bx
        bonus_skills += 1
        bonus_items += len(bx)

    # 数值数据项（2026-11-27）：所有「自定义中文名 + 数值」。抓取端已压成紧凑数组，直接透传。
    vx = []
    for x in (a.get('vx') or []):
        if isinstance(x, list) and len(x) >= 2 and str(x[0] or '').strip():
            vx.append(x)
    if vx:
        b['vx'] = vx
        value_skills += 1
        value_items += len(vx)

    # 本次抓取日更新过 → 标 nx=1：id ≥ 20000 也不按「自定义技能」排除（见文件头 is_fresh）
    if is_fresh(a.get('ut')):
        b['nx'] = 1

    # 所属英雄：仅取 ability_map（未被任何英雄登记 = 旧版本/废弃/通用条目）；物品技能不参与
    hs = None if src else skill_hero.get(a.get('i'))
    if hs:
        map_by_field += 1
        b['h'] = hs
    elif not src:
        map_none += 1

    if src:
        b['src'] = src

    # 物品名（卡片第二行显示，2026-11-27 用户定）
    if src == 'item':
        nm_item = item_name_by_id.get(str(a.get('i'))) or item_name_fallback(a.get('n'))
        if nm_item:
            b['in'] = nm_item

    # 现版本物品技能（道具数据里 cate1 非空且非已移除/未发布）→ cur=1
    if item_cur and a.get('i') in item_refs:
        b['cur'] = 1

    # 非英雄单位技能的「原主」中文名：界面卡片用它替代「现版本非英雄单位技能」这种来源标签，
    # 查不到原主（旧版已删单位 / 类级 / 机制技能）就不写，界面留空。
    if src == 'creep':
        owner = (creep_by_en.get(a.get('en')) or {}).get('owner')
        if owner:
            b['o'] = owner

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
if item_cur:
    out['itemCur'] = True

# 本地图标映射（scripts/download_icons.py 生成）：技能 id → {s:技能图标, u:单位图标}。
# 文件不存在时不写 imgMap，界面自动回退占位块；不影响抓取/构建主流程。
img_map_count = 0
img_map_path = os.path.join(BASE, 'scripts', 'imgmap.json')
if os.path.isfile(img_map_path):
    with open(img_map_path, 'r', encoding='utf-8') as f:
        out['imgMap'] = json.load(f)
    img_map_count = len(out['imgMap'])

# 把非英雄单位技能代码名回写进 _raw.json：页面内置的 buildDbFromRaw 读 creepRefs，
# 这样别人拿这份 _raw.json 在浏览器里重建，也能得到同样的 creep 来源。
# creepOwners 同步回写「代码名 → 原主中文名」，让内建构建也能显示原主（没有原主的条目不在其中）。
creep_owners = {k: v['owner'] for k, v in creep_by_en.items() if v.get('owner')}
need_raw = False
if creep_by_en and list(d.get('creepRefs') or []) != sorted(creep_by_en):
    d['creepRefs'] = sorted(creep_by_en)
    need_raw = True
if creep_owners and d.get('creepOwners') != creep_owners:
    d['creepOwners'] = creep_owners
    need_raw = True
if need_raw:
    with open(SRC, 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, separators=(',', ':'))
    print('已回写 _raw.json：creepRefs %d 个代码名 / creepOwners %d 条原主'
          % (len(d.get('creepRefs') or []), len(d.get('creepOwners') or {})))

with open(DST, 'w', encoding='utf-8') as f:
    f.write('window.TAGDB=')
    json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    f.write(';')

feat_items = sum(len(v) for v in feat_text.values())
item_n = sum(1 for b in abilities if b.get('src') == 'item')
creep_n = sum(1 for b in abilities if b.get('src') == 'creep')
creep_miss = sorted(set(creep_by_en) - set(b.get('en') for b in abilities if b.get('src') == 'creep'))
print('data.js 已生成：tags=%d abilities=%d（英雄 %d / 物品 %d / 非英雄单位 %d）特性tag=%d 池槽=%d 引用=%d 带内容技能=%d '
      '注释行池=%d 注释引用=%d 带注释技能=%d 带前摇技能=%d 加成数据项=%d（技能 %d）数值数据项=%d（技能 %d）图标映射=%d size=%.0f KB'
      % (len(out['tags']), len(out['abilities']), len(out['abilities']) - item_n - creep_n, item_n, creep_n,
         len(feat_text), feat_items, refs[0], feat_skills,
         len(note_pool), note_line_refs, note_skills, cast_skills, bonus_items, bonus_skills, value_items, value_skills,
         img_map_count, os.path.getsize(DST) / 1024.0))
print('现版本物品技能（有分类物品引用）：%d 个 id（itemCur=%s）' % (len(item_refs), item_cur))
if creep_by_en:
    print('非英雄单位技能：命中 %d / 表内 %d%s'
          % (creep_n, len(creep_by_en), ('；未命中：' + '、'.join(creep_miss)) if creep_miss else ''))
print('英雄：%d 个（力量 %d / 敏捷 %d / 智力 %d / 全才 %d / 其他 %d）；技能归属（仅 ability_map）：有归属 %d / 无归属 %d'
      % (len(heroes_out),
         sum(1 for h in heroes_out if h['a'] == '力量'), sum(1 for h in heroes_out if h['a'] == '敏捷'),
         sum(1 for h in heroes_out if h['a'] == '智力'), sum(1 for h in heroes_out if h['a'] == '全才'),
         sum(1 for h in heroes_out if h['a'] not in HERO_ATTR_ORDER),
         map_by_field, map_none))
