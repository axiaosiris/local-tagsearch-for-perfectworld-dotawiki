# local tagsearch for perfectworld dotawiki

打开 `index.html` 即可使用。

初次使用需要下载wiki后台数据文件 `data.js`，`index.html` 右上角有下载说明，下载时需登陆`partner.dota2.com.cn`，仅管理员或编辑有此权限。

## 匹配粒度（左栏「匹配粒度」，三档）

决定多个 tag 条件在多大范围里同时成立：

| 档位 | 含义 |
|---|---|
| 整条技能合并 | 类型 ∪ 特性 ∪ tags 字段 ∪ 所有效果行，任意位置满足即可（最宽松） |
| 效果类 tag 需同一效果条目（默认） | 包含效果 / 状态效果 / 驱散情况 / 伤害类型… 须落在同一条效果里；技能级 tag 不受限 |
| 所有 tag 需同一效果条目 | 除下列「技能级类别」外，其余 tag（含**目标**）都必须落在同一条效果里 |

「技能级类别」不参与同条目判定（`search-core.js` 的 `SKILL_C2`）：
技能行为、施法类型、技能类别、冷却类型、魔法消耗、生命消耗、攻击命中判定、施放技能时、面对控制时、指向性技能施法时、加成属性。

依据：这些类别只挂在技能类型区（`skill_detail`）、特性区（`skill_mechanism`）或 tags 字段，从不进效果行；
若强行纳入，「基础技能 + 眩晕」会从 89 条直接归零。

命令行等价调用：`TagSearch.search(index, { unitMode: 'skill' | 'effect' | 'all' })`（旧参数 `matchUnit:false` 等价于 `'skill'`）。
