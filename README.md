# tagsearch —— 完美世界 DOTA2 中文 wiki 技能检索器

纯静态单页工具：双击 `index.html` 直接打开（也可扔到任意静态托管上）。
两条检索线：**Tag 检索**（按标签）与**注释检索**（在技能注释里找文字）；左栏「技能筛选」按**数据来源**限定范围，
目前只有「现版本英雄技能」一类（默认勾选），物品技能 / 非英雄单位技能可按下方「扩展」接入。

---

## 首次使用：先抓一份数据

检索器**本身不含数据**（`data.js` / `_raw.json` 属 wiki 内容资产，不随代码分发）。
数据必须在**你自己的账号**下抓：抓取脚本运行在已登录的后台页面里，
抓完直接下载到你自己的电脑，**不经过任何第三方服务器、也不上传任何内容**。

1. 打开 `index.html` → 右上角 **「⟳ 更新本地数据」**
2. 安装书签：把 **「📌 抓取 tagsearch 数据」** 拖到书签栏；或**右键它 →「添加到收藏夹 / 添加书签」**（最稳）  
   （也可以点「复制书签代码」，手动新建书签、把代码粘进「网址」栏 —— **粘贴后确认开头仍有 `javascript:`，被浏览器吃掉就补上**）
3. 打开并登录 `partner.dota2.com.cn` 后台任意页面，**点一下这个书签** ——
   右下角会显示抓取进度，跑完自动下载 `_raw.json`（约 1.5 MB）
4. 回到检索器 → **「选择文件载入…」** → 选中刚下载的 `_raw.json`

载入成功后页面会自动再导出一份 `data.js`。把它放到 `index.html` 同目录、覆盖同名文件，
以后**直接打开就有数据**，不必每次抓。

## 更新数据

重复上面第 3、4 步即可。后台的改动（新增标签、改技能特性、改注释）要重新抓取后才会反映到检索器。

## 权限与提示

- 有后台登录态即可（管理员／编辑）。未登录时书签会提示「未登录或登录已过期」。
- 书签被浏览器拦下（个别环境会拦 `javascript:`）时，可在后台页按 `F12` 打开控制台，
  把书签代码粘进去回车 —— 效果相同。

## 为什么数据不在仓库里

`data.js` / `_raw.json` 是 wiki 内容资产，不适合随代码公开分发，`.gitignore` 已排除。
`icons/` 下的升级项图标仅用于界面展示。

---

## 维护者

| 文件 | 用途 |
|---|---|
| `refresh.sh` / `refresh.bat` | 走 bsk（browser-skill）在本机浏览器里抓取 → 调 `build_data.py` 重建 `data.js` |
| `scripts/fetch_tagdb.js` | 上面那条链路的抓取脚本（bsk `evaluate` 用） |
| `scripts/fetch_tagdb.bookmarklet.js` | **书签版**抓取脚本（面向使用者，源码可读） |
| `scripts/build_bookmarklet.py` | 把书签源码压成单行并内联进 `index.html`；**改完书签源码必须重跑** |
| `build_data.py` | `_raw.json` → `data.js`（特性/注释池化、英雄归属） |
| `search-core.js` | 检索核心（浏览器/Node 通用）：`SOURCES` 来源登记表、`search` / `searchNotes` |
| `serve.py` | 本机更新服务（页面「方式三」用，需 bsk daemon） |
| `selftest.js` / `uitest.js` | 浏览器端自测 / UI 测试 |

> `uitest.js` 是 jsdom 环境的界面回归测试，需要本机有 jsdom（`npm i jsdom` 或把 `NODE_PATH` 指到已有安装）；
> 没有 jsdom 时只跑 `node selftest.js`（纯逻辑自测，无依赖）。
>
> `index.html` 里内置了与 `build_data.py` 等价的 JS 构建逻辑（`buildDbFromRaw`），
> 所以使用者只拿 `_raw.json` 也能用；两条链路产物已对齐（含 Quill 残留 `\ufeff` 的清理）。

## 扩展：新增一类技能来源（物品技能 / 非英雄单位技能…）

左栏「技能筛选」是按**数据来源**分组的多选项，检索时取勾选来源的并集。接入新来源只需两步，**不用改检索逻辑**：

1. `search-core.js` 顶部的 `SOURCES` 表加一行，并把 `ready` 设为 `true`：
   `{ key: 'item', label: '物品技能', ready: true, tip: '物品附带的技能' }`
   （`ready: false` 只是占位，界面不显示；数据里已经出现、但表里还没登记的来源也会自动列出，只是默认不勾。）
2. 构建数据时给该来源的技能记录写上 `src`（例如 `src: 'item'`）。
   **没有 `src` 字段的技能一律视为 `hero`** —— 所以现有 `data.js` 不用改就全部算「现版本英雄技能」。

检索侧接口：`search(index, { …, sources: ['hero','item'] })`、`searchNotes(index, { q, sources })`；
返回的 `stats.src` 给出 `on`（只勾了部分来源 = 真在筛选）、`out`（被来源挡掉的条数）、`pool`、`all`（数据里的全部来源）。
控制台钩子：`__tagsearch.sources()` / `setSources([...])` / `searchSources([...])`。
