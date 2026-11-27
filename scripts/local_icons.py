# -*- coding: utf-8 -*-
"""从本地 KVEdit 图标资源建立 imgMap（不下载、不使用 VPK 工具）。

源资源目录：D:/wiki/小工具/KVEdit/icons/panorama/images
  spellicons/<code>_png.png       英雄 / 中立技能图标
  items/<code>_png.png            物品技能图标
  heroes/icons/npc_dota_hero_<en>_png.png   英雄单位小图标
  heroes/<unit>_png.png           中立单位小图标

把实际用到的图标复制进 tagsearch/icons/，映射写入 scripts/imgmap.json
（技能 id → {s:技能图, u:单位图}），路径相对 index.html，
使检索器自包含、可独立分发。

用法：
  python scripts/local_icons.py
  python build_data.py     # 把 imgmap.json 注入 data.js 的 imgMap
"""
import json
import os
import subprocess
import re
import shutil
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_JS = os.path.join(BASE, 'data.js')
OUT = os.path.join(BASE, 'scripts', 'imgmap.json')
MISSING = os.path.join(BASE, 'icons', 'missing.json')

SRC = r'D:/wiki/小工具/KVEdit/icons/panorama/images'
ICON_DIR = os.path.join(BASE, 'icons')     # 复制目标：tagsearch/icons/
URL_PREFIX = 'icons'                        # imgMap 里相对 index.html 的路径
KV = r'D:/wiki/npc/scripts/npc/npc_abilities.txt'
KV_UNITS = r'D:/wiki/npc/scripts/npc/npc_units.txt'
KV_HERO_DIR = r'D:/wiki/npc/scripts/npc/heroes'

# 天赋技能（special_bonus_*）的图片：用「对应天赋」的升级图标。
# 键＝**天赋档位 1..8**（不是 Ability 槽号！每个英雄槽位起点不同，起始槽由
# talent_slots() 先定位再排序得到）：1,2＝10 级右/左，3,4＝15 级右/左，
# 5,6＝20 级右/左，7,8＝25 级右/左（2026-11-27 用户实测校正：同档先右后左）。
TALENT_ICONS = {
    1: 'icons/1049.png',   # 10 级右天赋升级
    2: 'icons/1048.png',   # 10 级左天赋升级
    3: 'icons/1051.png',   # 15 级右天赋升级
    4: 'icons/1050.png',   # 15 级左天赋升级
    5: 'icons/1053.png',   # 20 级右天赋升级
    6: 'icons/1052.png',   # 20 级左天赋升级
    7: 'icons/1055.png',   # 25 级右天赋升级
    8: 'icons/1054.png',   # 25 级左天赋升级
}
ITEM_SKILL_MD = r'D:/wiki/编写规范/物品技能.md'
# 缺图清单：用户在此文件「图片名称」列手填图标名，作为权威覆盖（2026-11-27 用户定）
MD_MISSING_MD = r'D:/wiki/日志/2026-11-27/技能缺图清单.md'
# md 手填覆盖的持久存档：命中的映射与「忽略」落盘，清单行删掉后也不会丢图
OVERRIDES_JSON = os.path.join(BASE, 'scripts', 'icon_overrides.json')

# 先天技能（KV 里 "Innate" "1"，本身没有专属图标）的统一兜底图（2026-11-27 用户定）
INNATE_FALLBACK = 'icons/other_icons/innate_icon_png.png'

# 现版本里仍找不到专属图标的技能（建筑/神龛/设施、旧版天赋残留等）统一用 Dota 2 程序图标
# 兜底（2026-11-27 用户定：没有图标的都用这个图标，换成新图时只改这一处）。
DOTA2_FALLBACK = 'icons/other_icons/dota2_exe_png.png'

# 技能名与图标文件名不一致（子技能借用母技能图）的例外，2026-11-27 用户指定。
# 值＝图标文件名去掉 _png.png 与目录的部分，直接去 spellicons 里找。
ICON_ALIASES = {
    'chaos_knight_armageddon': 'chaos_knight_armageddons_flank',   # 天劫前进
    'monkey_king_primal_spring_early': 'monkey_king_primal_spring',  # 马上跃出
    'skeleton_king_vampiric_aura': 'skeleton_king_bone_guard',      # 白骨护卫
    'tusk_launch_snowball': 'tusk_snowball',                        # 雪球滚滚
}
LOC_SCHINESE = r'D:/wiki/npc/resource/localization/abilities_schinese.txt'
LOC_DOTA_CN = r'D:/wiki/npc/resource/localization/dota_schinese.txt'


def load_db():
    with open(DATA_JS, 'r', encoding='utf-8') as f:
        s = f.read().strip()
    if not s.startswith('window.TAGDB='):
        sys.exit('data.js 格式不对：缺少 window.TAGDB= 前缀（请先运行 build_data.py）')
    return json.loads(s[len('window.TAGDB='):].rstrip(';'))


def texture_overrides():
    """npc_abilities.txt 里 AbilityTextureName 与技能名不同的例外（如 tower_aura）。"""
    out = {}
    if not os.path.isfile(KV):
        return out
    cur = None
    with open(KV, 'r', encoding='utf-8', errors='ignore') as f:
        for line in f:
            m = re.match(r'^\s*"([a-z0-9_]+)"\s*$', line)
            if m:
                cur = m.group(1)
                continue
            m = re.search(r'"AbilityTextureName"\s*"([^"]+)"', line)
            if m and cur:
                out[cur] = m.group(1)
    return out


def _kv_blocks(txt, indent=3):
    """按制表符缩进定位 KV 顶层块，返回 (块名, 块体) —— 用括号配对，避免跨块误读。"""
    pat = re.compile(r'^\t{%d}"([a-z0-9_]+)"\s*$' % indent, re.M)
    n = len(txt)
    for m in pat.finditer(txt):
        j = txt.find('{', m.end())
        if j < 0 or txt[m.end():j].strip():
            continue
        depth = 0
        k = j
        while k < n:
            c = txt[k]
            if c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
                if depth == 0:
                    break
            k += 1
        yield m.group(1), txt[j:k + 1]


def innate_abilities():
    """英雄 KV 里标了 "Innate" "1" 的技能（先天技能）。这些技能没有独立图标，
    界面统一用 icons/other_icons/innate_icon_png.png 兜底（2026-11-27 用户定）。"""
    out = set()
    if not os.path.isdir(KV_HERO_DIR):
        return out
    for fn in os.listdir(KV_HERO_DIR):
        if not fn.endswith('.txt'):
            continue
        path = os.path.join(KV_HERO_DIR, fn)
        with open(path, 'r', encoding='utf-8', errors='ignore') as f:
            txt = f.read()
        for name, body in _kv_blocks(txt):
            if re.search(r'"Innate"\s+"1"', body):
                out.add(name)
    return out


def skill_unit_map():
    """从 npc_units.txt 建立 技能名 → 单位名 映射（Ability1/2/... 字段）。"""
    out = {}
    if not os.path.isfile(KV_UNITS):
        return out
    with open(KV_UNITS, 'r', encoding='utf-8', errors='ignore') as f:
        txt = f.read()
    blocks = re.findall(r'\n\s*"([a-z0-9_]+)"\s*\n\s*\{([^{}]*)\}', txt)
    for unit, body in blocks:
        for ab in re.findall(r'"Ability\d+"\s*"([a-z0-9_]+)"', body):
            if ab:
                out.setdefault(ab, []).append(unit)
    return out


def talent_slots():
    """天赋技能 → 天赋档位（1..8；1＝10 级右，8＝25 级左）。

    **每个英雄的天赋槽位起点不同**：多数从 Ability10 起，但光法从 11、凯兹 / 拉比克从 12、
    变体精灵 / 拉尔戈从 15、卡尔从 17 起。所以不能按槽号硬编码，做法是——
    先定位该英雄**第一个天赋槽**（最小的 special_bonus AbilityN），再按槽号升序排名 1..8。
    同一通用天赋可能被多个英雄共用，取出现次数最多的档位（并列取靠前档位）。"""
    votes = {}
    if not os.path.isdir(KV_HERO_DIR):
        return {}
    for fn in sorted(os.listdir(KV_HERO_DIR)):
        if not fn.lower().endswith('.txt'):
            continue
        path = os.path.join(KV_HERO_DIR, fn)
        with open(path, 'r', encoding='utf-8', errors='ignore') as f:
            txt = f.read()
        # 只取主能力表（2 个 tab 缩进）；Facets 等子块里的 AbilityN 不算
        slots = [(int(n), ab) for n, ab in
                 re.findall(r'^\t{2}"Ability(\d+)"\s*"([A-Za-z0-9_]+)"', txt, re.M)]
        first = None
        for n, ab in sorted(slots):
            if ab.startswith('special_bonus'):
                first = n
                break
        if first is None:
            continue
        for n, ab in slots:
            if not ab.startswith('special_bonus'):
                continue
            rank = n - first + 1            # 1..8
            votes.setdefault(ab, {})
            votes[ab][rank] = votes[ab].get(rank, 0) + 1

    out = {}
    for ab, cnt in votes.items():
        out[ab] = sorted(cnt.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
    return out

def item_skill_codes():
    """解析 编写规范/物品技能.md：后台技能 id → 道具代码名（item_xxx）。

    文档段落形如：## 板砖 — `item_brick`（后台 id=335）。
    这是「物品技能 → 物品 → 图标」的权威映射源。"""
    out = {}
    if not os.path.isfile(ITEM_SKILL_MD):
        return out
    with open(ITEM_SKILL_MD, 'r', encoding='utf-8') as f:
        for line in f:
            if not line.startswith('## '):
                continue
            cm = re.search(r'`(item_[a-z0-9_]+)`', line)
            im = re.search(r'后台\s*id\s*[=：:]\s*(\d+)', line)
            if cm and im:
                out.setdefault(im.group(1), cm.group(1))
    return out


def loc_name2code():
    """本地化文件：道具中文名 → 代码名（去掉 item_ 前缀）。
    用于 md 未登记的技能按括号里的道具名兜底。"""
    d = {}
    for path in (LOC_SCHINESE, LOC_DOTA_CN):
        if not os.path.isfile(path):
            continue
        with open(path, 'r', encoding='utf-8-sig', errors='ignore') as f:
            for line in f:
                m = re.search(r'"DOTA_Tooltip_Ability_item_([a-z0-9_]+)"\s*"([^"]+)"', line, re.I)
                if m:
                    d.setdefault(m.group(2), m.group(1))
    return d


def md_icon_overrides():
    """解析缺图清单 md 的「图片名称」列 → ({技能代码名: 图标名}, {标了「忽略」的技能})。

    用户只在此 md 里填名字，脚本负责按名找文件（可少写 _png 后缀，见 find_icon_any）。"""
    out, ignored = {}, set()
    if not os.path.isfile(MD_MISSING_MD):
        return out, ignored
    col = None
    with open(MD_MISSING_MD, 'r', encoding='utf-8') as f:
        for line in f:
            s = line.strip()
            if not s.startswith('|'):
                col = None
                continue
            cells = [c.strip() for c in s.strip('|').split('|')]
            if col is None:
                if '图片名称' in cells:
                    col = cells.index('图片名称')
                continue
            if all(set(c) <= set('-: ') for c in cells):
                continue                      # 分隔行
            if len(cells) <= col:
                continue
            code = ''
            for c in cells:
                m = re.fullmatch(r'`([^`]+)`', c)
                if m:
                    code = m.group(1).strip()
                    break
            icon = cells[col].strip()
            if not code:
                continue
            if icon == '忽略':
                ignored.add(code)
            elif icon and icon not in ('-', '—'):
                out[code] = icon
    return out, ignored


def load_icon_overrides():
    """md 手填覆盖 + 持久存档（icon_overrides.json）合并。

    存档解决「清单里已补的行被删掉后映射丢失」：命中过的映射与「忽略」都落盘，
    以后清单只列未补项也不会丢图。md 里新填的值优先覆盖存档。"""
    out, ignored = {}, set()
    if os.path.isfile(OVERRIDES_JSON):
        try:
            with open(OVERRIDES_JSON, 'r', encoding='utf-8') as f:
                saved = json.load(f)
            for k, v in saved.items():
                if v == '__ignore__':
                    ignored.add(k)
                elif v:
                    out[k] = v
        except Exception:
            pass
    o2, i2 = md_icon_overrides()
    out.update(o2)
    ignored |= i2
    return out, ignored


def save_icon_overrides(mapping):
    with open(OVERRIDES_JSON, 'w', encoding='utf-8') as f:
        json.dump(mapping, f, ensure_ascii=False, indent=1, sort_keys=True)


def find_icon_any(name):
    """按 md 里填的图标名在源库各池里找文件并复制进 tagsearch/icons/<pool>/。

    容忍三种写法：`tower_armor_aura`、`tower_armor_aura_png`、`tower_armor_aura_png.png`；
    也允许带池前缀（`items/ward_sentry_png`）。返回相对 index.html 的 URL，找不到返回 ''。"""
    n = str(name).strip().strip('`').replace('\\', '/')
    if n.lower().endswith('.png'):
        n = n[:-4]
    pool_hint = ''
    if '/' in n:
        pool_hint, n = n.rsplit('/', 1)
    bases = [n]
    if n.lower().endswith('_png'):
        bases.append(n[:-4])
    wants = []
    for b in bases:
        wants.append((b + '.png').lower())
        wants.append((b + '_png.png').lower())
    pools = [pool_hint] if pool_hint else ['spellicons', 'items', 'other_icons', 'heroes', 'heroes/icons']
    want_set = set(wants)
    # 0) 已在 tagsearch/icons/ 里（含手工放入的 other_icons，如 hud_radar_png）→ 直接引用
    if os.path.isdir(ICON_DIR):
        for dp, _, fs in os.walk(ICON_DIR):
            for fn in fs:
                if fn.lower() in want_set:
                    rel = os.path.relpath(os.path.join(dp, fn), ICON_DIR).replace(os.sep, '/')
                    return '%s/%s' % (URL_PREFIX, rel)
    for pool in pools:
        src_pool = os.path.join(SRC, pool.replace('/', os.sep))
        if not os.path.isdir(src_pool):
            continue
        real = {}
        for fn in os.listdir(src_pool):
            real.setdefault(fn.lower(), fn)
        for w in wants:
            fname = real.get(w)
            if not fname:
                continue
            dst_pool = os.path.join(ICON_DIR, pool.replace('/', os.sep))
            os.makedirs(dst_pool, exist_ok=True)
            dst_file = os.path.join(dst_pool, fname)
            if not os.path.isfile(dst_file):
                shutil.copy2(os.path.join(src_pool, fname), dst_file)
            return '%s/%s/%s' % (URL_PREFIX, pool, fname)
    return ''


def find_icon(pool, names):
    """按顺序尝试候选文件名（均带 _png.png 后缀）；命中则从 SRC 复制进
    tagsearch/icons/<pool>/，返回相对 index.html 的 URL，未命中返回 ''。
    Windows 大小写不敏感：用源文件真实大小写拼目标名，避免复制后路径失效。"""
    src_pool = os.path.join(SRC, pool.replace('/', os.sep))
    dst_pool = os.path.join(ICON_DIR, pool.replace('/', os.sep))
    # 建立小写文件名 → 真实文件名索引，保证大小写不敏感匹配
    real = {}
    if os.path.isdir(src_pool):
        for fn in os.listdir(src_pool):
            real.setdefault(fn.lower(), fn)
    for n in names:
        if not n:
            continue
        want = (str(n) + '_png.png').lower()
        fname = real.get(want)
        if not fname:
            continue
        os.makedirs(dst_pool, exist_ok=True)
        dst_file = os.path.join(dst_pool, fname)
        if not os.path.isfile(dst_file):
            shutil.copy2(os.path.join(src_pool, fname), dst_file)
        return '%s/%s/%s' % (URL_PREFIX, pool, fname)
    return ''


def main():
    if not os.path.isdir(SRC):
        sys.exit('找不到本地图标资源：' + SRC)

    db = load_db()
    heroes = {h['i']: h.get('en', '') for h in db.get('heroes', [])}
    overrides = texture_overrides()
    skill_units = skill_unit_map()
    item_code = item_skill_codes()       # 后台技能 id → 道具代码名（权威）
    name2code = loc_name2code()          # 道具中文名 → 代码名（兜底）
    talents = talent_slots()             # 天赋技能 → 天赋槽位（Ability10..17）
    innate = innate_abilities()          # 先天技能（KV Innate=1）→ 无专属图标，用兜底图
    md_map, md_ignore = load_icon_overrides()   # 缺图清单 md 手填 + 持久存档（权威）
    imgmap = {}
    miss = []
    md_miss = []
    md_ok = {}
    n_fallback = 0
    n_dota2 = 0
    n_md = 0

    for a in db.get('abilities', []):
        en = str(a.get('en') or '').strip()
        aid = a.get('i')
        if not en or aid is None:
            continue
        src = a.get('src')
        if src == 'item':
            folder = 'items'
        elif src == 'creep' or a.get('h'):
            folder = 'spellicons'
        elif en.startswith('special_bonus'):
            # 未归属英雄的天赋条目也照样给图（按天赋名查 KV 槽位，不依赖归属）
            folder = 'spellicons'
        else:
            # 目录外技能（旧版残留 / OMG / 活动技能…）也照常找图（2026-11-27 用户定：
            # 全部技能能对应图标就用手图标），找不到再走 Dota 2 兜底
            folder = 'spellicons'

        names = []
        if src == 'item':
            zh = str(a.get('n') or '')
            base = zh.split('（')[0].strip()
            parens = re.findall(r'（([^）]+)）', zh)
            # 1) 权威：编写规范/物品技能.md 的后台 id → 道具代码名
            code = item_code.get(str(aid), '')
            if code:
                names.append(code)
                names.append(code.replace('item_', ''))
            # 2) 兜底：括号里的道具中文名 → 代码名
            for nm in [zh] + parens:
                c2 = name2code.get(nm, '')
                if c2:
                    names.append(c2)
            # 3) en 直拼（部分技能 en 本身就是道具代码名）
            names += [en, en.lower(), en.lower().replace(' ', '_')]
            # 4) 覆盖表（icon_overrides.json / md 图片名称列）：物品技能同样认手填图标名
            #    例：Activate Shield Rune → bottle_shield_png（护盾神符，物品池）
            tex = overrides.get(en, '') or md_map.get(en, '')
            if tex and tex != en:
                names.append(tex)
        else:
            names = [en]
            alias = ICON_ALIASES.get(en, '')
            if alias:
                names.append(alias)
            tex = overrides.get(en, '')
            if tex and tex != en:
                names.append(tex)
        # 去重保序
        seen = set()
        names = [n for n in names if n and not (n in seen or seen.add(n))]
        srel = ''
        if md_map.get(en):
            # 用户手填优先：md「图片名称」列 → 按名在源库找图（可少写 _png）
            srel = find_icon_any(md_map[en])
            if srel:
                n_md += 1
                md_ok[en] = md_map[en]
            else:
                md_miss.append([aid, a.get('n'), en, md_map[en]])
        if not srel and src != 'item' and en.startswith('special_bonus'):
            # 天赋技能：按「天赋档位 1..8」取对应升级图标（槽位起点各英雄不同，见 talent_slots）
            rank = talents.get(en)
            if rank:
                cand = TALENT_ICONS.get(rank, '')
                if cand and os.path.isfile(os.path.join(ICON_DIR, cand.split('/')[-1])):
                    srel = cand
        if not srel:
            srel = find_icon(folder, names)
        if not srel and src != 'item' and en in innate:
            # 先天技能本身没有专属图标 → 统一用 innate 兜底图（2026-11-27 用户定）
            srel = INNATE_FALLBACK
            n_fallback += 1
        # 仍无图标 → 统一用 Dota 2 程序图标兜底（2026-11-27 用户定：**全部技能**通用，
        # 不再只限现版本；能对上专属/天赋/先天图表的已在上方命中）
        if not srel:
            srel = DOTA2_FALLBACK
            n_dota2 += 1
        if not srel:
            miss.append([aid, a.get('n'), en, '技能图'])

        urel = ''
        if src == 'item':
            pass  # 物品技能不显示单位小图标
        elif a.get('h'):
            hen = heroes.get(a['h'][0], '')
            if hen:
                urel = find_icon('heroes/icons', ['npc_dota_hero_' + hen])
        elif src == 'creep':
            # 中立生物：单位小图标取 KV 里拥有该技能的单位（heroes/ 根目录）
            units = skill_units.get(en, [])
            if units:
                urel = find_icon('heroes', units)
        # 物品技能与英雄技能不是同一编号空间（存在同 id 不同技能，如 333 饿狼撕咬 / 天界光耀）：
        # 物品技能统一加 'item:' 前缀，避免互相覆盖。
        key = ('item:' + str(aid)) if src == 'item' else str(aid)
        imgmap[key] = {'s': srel, 'u': urel}

    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(imgmap, f, ensure_ascii=False, separators=(',', ':'))
    # 手填覆盖持久化：命中的 + 「忽略」的；找不到的不落盘，下次仍从 md 读并继续提醒。
    # 先读回已有存档再合并，避免把「手工直接写进 icon_overrides.json 的映射」冲掉。
    saved = {}
    if os.path.isfile(OVERRIDES_JSON):
        try:
            with open(OVERRIDES_JSON, 'r', encoding='utf-8') as f:
                saved = {k: v for k, v in (json.load(f) or {}).items() if v}
        except Exception:
            saved = {}
    saved.update(md_ok)
    for code in md_ignore:
        saved[code] = '__ignore__'
    save_icon_overrides(saved)
    os.makedirs(os.path.dirname(MISSING), exist_ok=True)
    with open(MISSING, 'w', encoding='utf-8') as f:
        json.dump({'count': len(miss), 'items': miss}, f, ensure_ascii=False, indent=1)

    ns = sum(1 for e in imgmap.values() if e['s'])
    nu = sum(1 for e in imgmap.values() if e['u'])
    print('映射完成：技能图 %d / 单位图 %d / 技能条目 %d' % (ns, nu, len(imgmap)))
    if n_fallback:
        print('先天技能用兜底图 %d 条（%s）' % (n_fallback, INNATE_FALLBACK))
    if n_dota2:
        print('无任何可对应图标的技能用 Dota 2 图标兜底 %d 条（%s）' % (n_dota2, DOTA2_FALLBACK))
    print('按 md「图片名称」列命中 %d 条' % n_md)
    if md_miss:
        print('⚠ md 填了但找不到文件 %d 条：' % len(md_miss))
        for r in md_miss:
            print('   id=%s %s → 填的是「%s」' % (r[0], r[2], r[3]))
    print('未命中技能图 %d 条，清单：icons/missing.json' % len(miss))
    print('下一行：python build_data.py')
    if '--no-b64' not in sys.argv:
        print('顺带重建 file:// 截图用的图标内联包…')
        subprocess.call([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                                       'gen_icon_b64.py')])


if __name__ == '__main__':
    main()
