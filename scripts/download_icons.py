# -*- coding: utf-8 -*-
"""批量下载检索器技能卡片所需图标（Steam CDN，方案 B：本地存储）。

来源规则（2026-11-27 实测）：
  英雄 / 中立技能图标：.../dota_react/abilities/<英文名>.png
  物品技能图标        ：.../dota_react/items/<英文名>.png
  英雄单位小图标      ：.../dota_react/heroes/<英雄英文名>.png
  中立生物单位小图标  ：Steam CDN 无稳定路径 → 暂留空（等 VPK 方案）。

范围：默认参与检索的技能（现版本英雄技能 + 中立技能 + 物品技能）+ 英雄头像；
同名图标去重。绝对路径不写入数据包，imgmap.json 里存相对 index.html 的路径。

用法：
  python scripts/download_icons.py            # 跳过已存在文件
  python scripts/download_icons.py --force    # 重新下载覆盖
  python scripts/download_icons.py --all      # 连目录外/非现版本技能也下载（约 3500 张）
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_JS = os.path.join(BASE, 'data.js')
ICON_DIR = os.path.join(BASE, 'icons')
OUT = os.path.join(BASE, 'scripts', 'imgmap.json')
MISSING = os.path.join(BASE, 'icons', 'missing.json')
KV = r'D:/wiki/npc/scripts/npc/npc_abilities.txt'
CDN = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react'
UA = {'User-Agent': 'Mozilla/5.0 (tagsearch icon downloader)'}

FORCE = '--force' in sys.argv
ALL = '--all' in sys.argv


def load_db():
    with open(DATA_JS, 'r', encoding='utf-8') as f:
        s = f.read().strip()
    if not s.startswith('window.TAGDB='):
        sys.exit('data.js 格式不对：缺少 window.TAGDB= 前缀（请先运行 build_data.py）')
    return json.loads(s[len('window.TAGDB='):].rstrip(';'))


def texture_overrides():
    """npc_abilities.txt 里少量 AbilityTextureName 与技能名不同（如 tower_aura），用于 404 回退。"""
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


def fetch(url, dest):
    if os.path.isfile(dest) and os.path.getsize(dest) > 0 and not FORCE:
        return 'cached', 0
    tmp = dest + '.part'
    for attempt in range(2):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=20) as r:
                body = r.read()
            if not body or body[:8] != b'\x89PNG\r\n\x1a\n':
                return 'bad', 0
            with open(tmp, 'wb') as f:
                f.write(body)
            os.replace(tmp, dest)
            return 'ok', len(body)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return '404', 0
            err = str(e)
        except Exception as e:  # noqa: BLE001 - 网络任务需逐个记录失败，不中断整批
            err = str(e)
        if attempt == 0:
            time.sleep(0.6)
    return 'err:' + err[:60], 0


def main():
    db = load_db()
    heroes = {h['i']: h.get('en', '') for h in db.get('heroes', [])}
    overrides = texture_overrides()
    jobs = {}          # 相对路径 → URL
    imgmap = {}        # 技能 id → {s:技能图相对路径, u:单位图相对路径}

    for a in db.get('abilities', []):
        en = str(a.get('en') or '').strip()
        aid = a.get('i')
        if not en or aid is None:
            continue
        src = a.get('src')
        if src == 'item':
            folder, kind = 'items', 'item'
        elif src == 'creep':
            folder, kind = 'abilities', 'creep'
        elif (a.get('h') or []):
            folder, kind = 'abilities', 'hero'
        elif ALL:
            folder, kind = 'abilities', 'hero'
        else:
            continue

        skill_rel = 'icons/%s/%s.png' % (folder, en)
        url = '%s/%s/%s.png' % (CDN, folder, urllib.parse.quote(en, safe=''))
        tex = overrides.get(en, '')
        jobs[skill_rel] = (url, urllib.parse.quote(tex, safe='') if tex else '')

        entry = {'s': skill_rel, 'u': ''}
        if kind == 'hero' and (a.get('h') or []):
            hen = heroes.get(a['h'][0], '')
            if hen:
                unit_rel = 'icons/heroes/%s.png' % hen
                jobs[unit_rel] = ('%s/heroes/%s.png' % (CDN, urllib.parse.quote(hen, safe='')), '')
                entry['u'] = unit_rel
        imgmap[str(aid)] = entry

    for folder in ('abilities', 'items', 'heroes'):
        os.makedirs(os.path.join(ICON_DIR, folder), exist_ok=True)

    results = {}
    with ThreadPoolExecutor(max_workers=12) as pool:
        tasks = {}
        for rel, (url, tex) in jobs.items():
            tasks[pool.submit(fetch, url, os.path.join(BASE, rel.replace('/', os.sep)))] = (rel, url, tex)
        done = 0
        for fut in as_completed(tasks):
            rel, url, tex = tasks[fut]
            status, size = fut.result()
            # 主地址 404 → 用 KV 的 AbilityTextureName 再试一次
            if status == '404' and tex:
                alt = url.rsplit('/', 1)[0] + '/' + tex + '.png'
                status, size = fetch(alt, os.path.join(BASE, rel.replace('/', os.sep)))
            results[rel] = status
            done += 1
            if done % 200 == 0:
                print('进度 %d/%d' % (done, len(tasks)))

    ok = sum(1 for v in results.values() if v in ('ok', 'cached'))
    miss = sorted(rel for rel, v in results.items() if v not in ('ok', 'cached'))
    # 下载失败的不写进 imgmap，界面自动回退占位块
    for entry in imgmap.values():
        for k in ('s', 'u'):
            if entry.get(k) and results.get(entry[k]) not in ('ok', 'cached'):
                entry[k] = ''

    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(imgmap, f, ensure_ascii=False, separators=(',', ':'))
    with open(MISSING, 'w', encoding='utf-8') as f:
        json.dump({'count': len(miss), 'items': [[rel, results[rel]] for rel in miss]},
                  f, ensure_ascii=False, indent=1)

    total_bytes = 0
    for rel in results:
        p = os.path.join(BASE, rel.replace('/', os.sep))
        if os.path.isfile(p):
            total_bytes += os.path.getsize(p)
    print('完成：下载/复用 %d 张，失败 %d 张，总体积 %.1f MB' % (ok, len(miss), total_bytes / 1048576.0))
    print('映射：scripts/imgmap.json（%d 个技能）；失败清单：icons/missing.json' % len(imgmap))
    if miss:
        print('失败示例：' + '、'.join(miss[:10]))


if __name__ == '__main__':
    main()
