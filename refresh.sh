#!/usr/bin/env bash
# tagsearch 数据刷新：从 partner 后台抓取「Tag管理」全量 + 「技能」全量 → 重建 data.js
#
# 依赖：
#   1) bsk（browser-skill CLI，https://github.com/Tencent/BrowserSkill）
#   2) bsk daemon 运行中，且浏览器已安装 browser-skill 扩展并处于连接状态
#   3) 该浏览器已登录 partner.dota2.com.cn（抓取在其页面内同源执行，靠登录 Cookie）
#   4) python 3（仅用于 build_data.py）
#
# 可选环境变量：
#   BSK_EXE      指定 bsk 可执行文件（默认从 PATH 查找）
#   BSK_SESSION  指定复用某个会话 id（默认自动取现有会话，没有再新建）
#   PYTHON       指定 python 可执行文件（默认 python）
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JS="$DIR/scripts/fetch_tagdb.js"
OUT="$DIR/_raw.json"

[ -f "$JS" ] || { echo "ERROR: 缺少抓取脚本 $JS" >&2; exit 1; }

# 1) bsk CLI
BSK_EXE="${BSK_EXE:-$(command -v bsk 2>/dev/null || command -v bsk.exe 2>/dev/null || true)}"
if [ -z "$BSK_EXE" ] || [ ! -x "$BSK_EXE" ]; then
  echo "ERROR: 未找到 bsk CLI。请安装 browser-skill，或用 BSK_EXE 指向可执行文件。" >&2
  echo "  安装：https://github.com/Tencent/BrowserSkill" >&2
  exit 1
fi

# 2) daemon 存活？
if ! BSK_AUTO_START=0 "$BSK_EXE" status --json >/dev/null 2>&1; then
  echo "bsk daemon 未运行。请先以「后台任务」方式启动（勿用 &）："
  echo "  bsk daemon start --foreground --session-idle 30m --daemon-idle 30m --port 52810"
  exit 1
fi

# 3) 会话：$BSK_SESSION → 现有会话 → 新建
list_sid() {
  BSK_AUTO_START=0 "$BSK_EXE" session list 2>/dev/null \
    | awk 'p && NF {print $1; exit} /^SESSION/ {p=1}'
}
S="${BSK_SESSION:-}"
[ -n "$S" ] || S="$(list_sid)"
if [ -z "$S" ]; then
  echo "无活跃会话 → 尝试新建…"
  BSK_AUTO_START=0 "$BSK_EXE" session start >/dev/null 2>&1 || true
  S="$(list_sid)"
fi
if [ -z "$S" ]; then
  echo "ERROR: 无法建立会话。请在浏览器中打开 browser-skill 扩展，等弹窗显示 connected 后重试。" >&2
  exit 1
fi
echo "会话：$S"

# 4) 导航到技能页（接口为相对路径，需同域）
BSK_AUTO_START=0 "$BSK_EXE" navigate --session "$S" 'https://partner.dota2.com.cn/#/cms/skilldata' >/dev/null 2>&1 || true
sleep 3

# 5) 抓取（脚本自包含，直接 evaluate；不依赖任何外部工具集）
if ! BSK_AUTO_START=0 "$BSK_EXE" evaluate --session "$S" --timeout 180s "$(cat "$JS")" > "$OUT"; then
  echo "ERROR: 抓取失败（$(head -c 160 "$OUT")）" >&2
  exit 1
fi
if ! head -c 40 "$OUT" | grep -q '"ok":true'; then
  echo "ERROR: 返回内容异常：$(head -c 240 "$OUT")" >&2
  exit 1
fi

# 6) 构建 data.js
cd "$DIR" || exit 1
PYTHON="${PYTHON:-python}"
"$PYTHON" build_data.py || exit 1
echo "完成 —— 刷新 index.html 即可看到最新数据。"
