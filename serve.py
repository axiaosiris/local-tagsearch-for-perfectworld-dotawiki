# -*- coding: utf-8 -*-
"""tagsearch 本地服务 —— 静态托管 + 一键更新数据

为什么需要它：
  浏览器不会把 partner.dota2.com.cn 的登录 Cookie 发给「跨站」请求，所以
  index.html 直接 fetch 后台接口只会拿到 code=1001（未登录）——
  file:// 与 http://127.0.0.1 两种打开方式都实测无效。
  本服务改为调用 bsk（browser-skill）：在**已登录的 partner 页面内**（同源）抓取
  官方接口，再把结果落盘成 data.js，页面从同源拿到新数据。

用法：
    python serve.py --open          # 启动并打开浏览器（推荐 start.bat）
    python serve.py --port 8899

接口：
    GET  /api/ping      探测服务（页面「更新本地数据」按钮用它判断通道是否可用）
    POST /api/refresh   执行抓取 + 重建 data.js（内部调用 ../tagsearch/refresh.sh）
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(ROOT, '_raw.json')
DATA_JS = os.path.join(ROOT, 'data.js')
REFRESH_SH = os.path.join(ROOT, 'refresh.sh')
APP = 'tagsearch'

_LOCK = threading.Lock()
_LOG: list[str] = []          # 最近一次更新的日志（供页面拉取）
_STATE = {'running': False, 'last': None}


# ---------------------------------------------------------------- bsk / bash

def find_bash() -> str | None:
    cands = [os.environ.get('BASH') or '',
             r'C:/Program Files/Git/bin/bash.exe',
             r'C:/Program Files (x86)/Git/bin/bash.exe',
             r'C:/Program Files/Git/usr/bin/bash.exe']
    for c in cands:
        if c and os.path.isfile(c):
            return c
    return shutil.which('bash')


def _bsk_exe() -> str:
    """bsk 可执行文件：环境变量 → PATH → 常见安装位置（browser-skill CLI）

    ⚠️ Windows 上 bsk 常装在 `~/.local/bin/`，不在 PATH 里；只查 PATH 会误报
    「未找到 bsk CLI」，导致页面「更新本地数据」直接失败。
    """
    cands = [os.environ.get('BSK_EXE') or '',
             shutil.which('bsk') or '',
             shutil.which('bsk.exe') or '']
    home = os.path.expanduser('~')
    local = os.environ.get('LOCALAPPDATA') or os.path.join(home, 'AppData', 'Local')
    for d in (os.path.join(home, '.local', 'bin'),
              os.path.join(local, 'Programs', 'browser-skill'),
              os.path.join(local, 'bin')):
        cands.append(os.path.join(d, 'bsk.exe'))
        cands.append(os.path.join(d, 'bsk'))
    for c in cands:
        if c and os.path.isfile(c):
            return c
    return 'bsk'


def daemon_state() -> dict:
    """daemon 是否在跑 + 是否已连上浏览器"""
    exe = _bsk_exe()
    if not (os.path.isfile(exe) or shutil.which(exe)):
        return {'ok': False, 'why': '未找到 bsk CLI（请安装 browser-skill 或设置 BSK_EXE）'}
    env = dict(os.environ)
    env['BSK_AUTO_START'] = '0'
    try:
        p = subprocess.run([exe, 'status', '--json'], capture_output=True, timeout=20, env=env)
    except Exception as e:                                   # noqa: BLE001
        return {'ok': False, 'why': 'bsk status 调用失败：%s' % e}
    if p.returncode != 0:
        return {'ok': False, 'why': 'bsk daemon 未运行 —— 先在终端执行：'
                                    '"%s" daemon start --foreground --port 52810' % exe}
    try:
        j = json.loads(p.stdout.decode('utf-8', 'replace'))
    except Exception:                                        # noqa: BLE001
        return {'ok': False, 'why': 'bsk status 返回无法解析'}
    browsers = j.get('browsers') or []
    if not browsers:
        return {'ok': False, 'why': '浏览器扩展未连接（请在浏览器中打开 browser-skill 扩展弹窗，等显示 connected）'}
    return {'ok': True, 'port': j.get('ws_port'), 'browsers': [
        {'instance_id': b.get('instance_id'), 'name': b.get('browser_name'),
         'version': b.get('browser_version'), 'unresponsive': b.get('unresponsive')}
        for b in browsers]}


def refresh() -> dict:
    """执行一次抓取；返回 {ok, log[], fetchedAt, tags, abilities, sizeKB}"""
    if not _LOCK.acquire(blocking=False):
        return {'ok': False, 'error': '已有一次更新正在进行，请稍候', 'log': list(_LOG)}
    t0 = time.time()
    log: list[str] = []
    try:
        _LOG.clear()

        def say(s: str) -> None:
            log.append(s)
            _LOG.append(s)

        st = daemon_state()
        if not st.get('ok'):
            say('✗ ' + st.get('why', '环境不可用'))
            say('提示：更新需要 bsk daemon 在运行、且浏览器已安装并连接 browser-skill 扩展。')
            return {'ok': False, 'error': st.get('why', '环境不可用'), 'log': log}
        say('✓ bsk daemon 正常，已连接 %d 个浏览器' % len(st['browsers']))

        bash = find_bash()
        if not bash:
            say('✗ 未找到 bash（Git Bash），无法调用 refresh.sh')
            return {'ok': False, 'error': '未找到 bash', 'log': log}
        if not os.path.isfile(REFRESH_SH):
            say('✗ 未找到 %s' % REFRESH_SH)
            return {'ok': False, 'error': '缺少 refresh.sh', 'log': log}

        say('调用 refresh.sh（导航到技能页 → 页面内抓取 → 重建 data.js）…')
        env = dict(os.environ)
        env['BSK_AUTO_START'] = '0'
        env['BSK_EXE'] = _bsk_exe()          # 子进程（bash）里通常找不到 bsk，父进程定位后显式传入
        env.setdefault('PYTHON', sys.executable)
        for k in ('HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy'):
            env.pop(k, None)                 # 环境注入的代理会让 bsk 连不上本机 daemon
        p = subprocess.run([bash, 'refresh.sh'], cwd=ROOT, capture_output=True,
                           timeout=600, env=env)
        out = (p.stdout or b'').decode('utf-8', 'replace')
        err = (p.stderr or b'').decode('utf-8', 'replace')
        for line in (out + err).splitlines():
            if line.strip():
                say(line.rstrip())
        if p.returncode != 0:
            blob = out + err
            if 'previous session command is still running' in blob:
                why = 'bsk 会话正忙（正在执行其它自动化命令）。等它结束后重试即可。'
            elif '无法建立会话' in blob or '没有活跃' in blob:
                why = '没有可用的 bsk 会话：请在浏览器中打开 browser-skill 扩展，等弹窗显示 connected 后重试。'
            elif 'daemon' in blob:
                why = 'bsk daemon 未运行或浏览器未连接。'
            else:
                why = '抓取失败（退出码 %d）' % p.returncode
            say('✗ ' + why)
            return {'ok': False, 'error': why, 'log': log}

        info = {'fetchedAt': '', 'tags': 0, 'abilities': 0, 'items': 0, 'sizeKB': 0}
        try:
            with open(RAW, 'r', encoding='utf-8') as f:
                d = json.load(f)
            info['fetchedAt'] = d.get('fetchedAt', '')
            info['tags'] = len(d.get('tags') or [])
            info['abilities'] = len(d.get('abilities') or [])
            info['items'] = len(d.get('items') or [])
            info['sizeKB'] = round(os.path.getsize(DATA_JS) / 1024.0, 1)
        except Exception as e:                               # noqa: BLE001
            say('（读取统计失败：%s）' % e)

        ms = int((time.time() - t0) * 1000)
        say('✓ 完成：tag %d 条 / 英雄技能 %d 条 / 物品技能 %d 条 / data.js %.0f KB，用时 %.1fs'
            % (info['tags'], info['abilities'], info['items'], info['sizeKB'], ms / 1000.0))
        info.update({'ok': True, 'ms': ms, 'log': log})
        _STATE['last'] = info
        return info
    except subprocess.TimeoutExpired:
        log.append('✗ 抓取超时（>10 分钟）')
        return {'ok': False, 'error': '抓取超时', 'log': log}
    except Exception as e:                                   # noqa: BLE001
        log.append('✗ 异常：%r' % (e,))
        return {'ok': False, 'error': repr(e), 'log': log}
    finally:
        _LOCK.release()


# ---------------------------------------------------------------- HTTP

class Handler(SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'tagsearch/1.0'

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    # 允许 file:// 打开的本页调用本服务（Origin: null / 127.0.0.1 / localhost）
    def _cors(self) -> None:
        o = self.headers.get('Origin')
        if o and (o == 'null' or '127.0.0.1' in o or 'localhost' in o):
            self.send_header('Access-Control-Allow-Origin', o)
            self.send_header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
            self.send_header('Access-Control-Allow-Private-Network', 'true')

    def end_headers(self) -> None:
        self.send_header('Cache-Control', 'no-store, max-age=0')
        self._cors()
        super().end_headers()

    def _json(self, obj, code: int = 200) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:                            # noqa: N802
        self.send_response(204)
        self.send_header('Content-Length', '0')
        self.end_headers()

    def _path(self) -> str:
        return self.path.split('?', 1)[0]

    def do_GET(self) -> None:                                # noqa: N802
        p = self._path()
        if p == '/api/ping':
            st = daemon_state()
            return self._json({
                'ok': True, 'app': APP, 'busy': _STATE['running'] or _LOCK.locked(),
                'last': _STATE['last'],
                'bsk': st,
                'hasData': os.path.isfile(DATA_JS),
                'dataTime': int(os.path.getmtime(DATA_JS)) if os.path.isfile(DATA_JS) else 0,
            })
        if p in ('/', '/index.html'):
            self.path = '/index.html'
        return super().do_GET()

    def do_POST(self) -> None:                               # noqa: N802
        if self._path() == '/api/refresh':
            n = int(self.headers.get('Content-Length') or 0)
            if n:
                self.rfile.read(n)
            return self._json(refresh())
        self._json({'ok': False, 'error': 'unknown endpoint'}, 404)

    def log_message(self, fmt, *args):                       # 安静一点，只留错误
        if str(args[1] if len(args) > 1 else '').startswith(('4', '5')):
            sys.stderr.write('[tagsearch] %s\n' % (fmt % args))


def main() -> None:
    ap = argparse.ArgumentParser(description='tagsearch 本地服务（静态托管 + 一键更新数据）')
    ap.add_argument('--port', type=int, default=int(os.environ.get('TAGSEARCH_PORT', '8899')))
    ap.add_argument('--open', action='store_true', help='启动后自动打开浏览器')
    args = ap.parse_args()

    url = 'http://127.0.0.1:%d/index.html' % args.port
    try:
        srv = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    except OSError as e:
        print('端口 %d 无法绑定：%s' % (args.port, e))
        print('换个端口：python serve.py --port 8900')
        return
    print('tagsearch 本地服务已启动：%s' % url)
    print('数据更新接口：POST /api/refresh   （Ctrl+C 停止）')
    if args.open:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print('\n已停止。')
    finally:
        srv.server_close()


if __name__ == '__main__':
    main()
