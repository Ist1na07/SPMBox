# SPM Box

**在游戏里按 SPM 难度选谱，把键型整理成收藏夹。**

离线 Windows 桌面工具，以 SPM Rating、SPM Submodel、SPMTagClassifier 为核心。
独立 Electron 实现，功能参考 OsuManiaToolbox；成绩评级逻辑由原项目改编并保留 MIT 署名。

## 开始使用

1. 从 GitHub Actions 的构建 artifact 或本地打包取得 Windows x64 portable 程序，也可以按下文从源码运行。更新程序前先退出旧的 SPM Box，保留应用数据目录。
2. 连接 osu!stable 安装目录或 Songs 文件夹。会读取安装目录的 `BeatmapDirectory` 设置。
3. 点击 **分析谱面**。已有有效缓存直接复用，只分析新建或改动的谱面。
4. 要在游戏内排序，打开 **游戏内难度重排**，选择 NM / HT / DT，预览后完全退出 osu!，备份并写入。
5. 要按键型整理，打开 **收藏夹创建器**，应用 **!7K 全部键型**，检查边界谱面、分类数量和实际名称后确认写入。

程序不联网分析，不修改 `.osu` 文件。在线谱面与源代码按钮按你的操作打开浏览器。
支持 osu!stable，不直接读写 osu!lazer 数据库；本地 portable 未做代码签名。
**版本标签及 GitHub Release 仅在用户明确要求对应版本时创建。**

## 游戏内难度重排，不只是工具内排序

- 将所选模型的 **SPM 总难度**写入 `osu!.db` 中原生 4K / 6K / 7K mania 的 NM、HT、DT 星数槽位；已有 NC 槽位同时更新。
- 支持 Detailed / Compact。只计算所选且尚未缓存的速率；例如已有 NM，选 HT 不会重跑 NM。准备其他速率不会替换当前谱面库视图。
- 按谱面 MD5 匹配数据库，键数不匹配或没有匹配记录的谱面跳过并统计；未分析成功的谱面保留原星数。
- 预览显示变更数、旧星数 → 新星数、谱面 ID、缓存命中和失败数。只在确认后写入，游戏打开时拒写。
- 其他模式、其他 Mod 槽位、成绩和评级保持原字节；不借用 EZ 星数存储备份。
- 写入前备份到 osu! 目录的 `.spmbox-db-backups`。该页面可恢复整个 `osu!.db`，恢复前再次备份当前文件。
- 重新启动游戏后按 Difficulty 排序。游戏 F5 重建或重新计算星数可能覆盖本地星数，再次应用缓存即可。

支持 2014-06-09 之后的 stable 记录布局，包括 2019 年记录长度变化与 2025 年单精度星数。
未知字段类型、截断或多余数据拒绝覆盖。恢复整个数据库也会回退备份后的谱面索引和评级更改。

## 成绩评级与筛选导出

**成绩评级**读取本地 `scores.db`，按 mania 准确率取每张谱面的最佳评级：100% 为 SS；默认 S/A/B/C/D 门限为 99/98/96/93/88%。可单独设置 NF、EZ、HT 等同 NM、固定 D、不显示评级或忽略该成绩。
可选择保留最近游玩时间，或取最高准确率／最高分数成绩的时间；也可将无本地成绩的谱面标记为未游玩。
仅修改 `osu!.db` 的评级及选定状态，不改实际成绩、回放或 `scores.db`。同样先预览、退出游戏、备份再写入。

谱面库支持文字、键数、键型及表达式组合筛选，并可把**全部匹配结果**导出 CSV 或创建为自动收藏夹，不限当前分页。例如：

```text
keys == 7 && rating >= 10 && rating < 20
hasTag("density") || hasTag("coordination")
creator ~ "name" && lnRating > 8
```

表达式使用 SPM Box 字段，不执行 JavaScript，也不兼容原工具的 C# 对象表达式。
支持 `&&`、`||`、`!`、括号、`== != < <= > >=`、文字包含 `~` 和 `hasTag("tag id")`。
字段有 `keys`、`rating`、`rcRating`、`lnRating`、`beatmapId`、`beatmapSetId`、`notes`、`duration`（毫秒）、`bpm`、`title`、`artist`、`creator`、`difficulty`、`family`（Rating 家族）、`classificationFamily`（Classifier 家族）、`rate` 和 `model`。

## 18 类收藏夹，短名字与明确层级

默认预设仅使用 7K，排除 RC Wildcard、LN Wildcard、Break：

- **RC**：Chordjack、Minijack、Dense Chordstream、Fast Chordstream、Speed、Tech、Vibro、Anchor、RC Mix。
- **LN**：Coordination、Density、Inverse、Release、Technical、LN Mix。
- **Hybrid**：与 RC、LN 并列。

默认收藏夹名为 **`!7K Density`**、`!7K RC`、`!7K Hybrid` 等，不附家族路径、算法编号或 UUID。
其他模型／速率只加必要短后缀，例如 `!7K Density DT`、`!7K Density Compact`，避免变体相互覆盖。
界面仍显示 RC／LN 父子层级；空分类也会创建。

每个分类独立设置默认判定或单维数值阈值。创建前显示入选分数最低 5 张、未入选分数最高 5 张，含在线谱面 ID；未提交谱面显示本地 MD5 短标识。

### 默认判定与数值阈值

RC / LN / Hybrid 默认使用 `overall.sort` 整谱归属，不使用 Rating 的 LN 覆盖率类型；三个默认总类互斥。
细类使用 `overall.tags`，保留原始多标签：Hybrid 谱面可能同时属于具体 RC / LN 细类。

上游整谱判定有先验保留、强标签增补、混合及双族门控，不能用一个固定阈值精确替代。
SPM Box 默认保留原始判定，数值模式另提供独立门限，比较采用 **分数 ≥ 阈值**。
数值初值为保留门限 25%，Hybrid 为 Detailed 双族门限 10%；“恢复默认”回到上游判定。

- 具体分支：上游重叠的支持加权难度负担占比，不是正确概率或时间占比。
- RC / LN 与 RC Mix / LN Mix：相应家族联合负担占比；数值模式不要求原始整谱归属或混合门控。
- Hybrid：`100 × min(RC familyMass, LN familyMass)`，避免纯家族误入；不同于上游标签的家族联合百分比。
- 4K/6K 原生五类归一化形态支持只用于浏览筛选，不进入此 7K 预设。

## 短名也不能误动用户收藏夹

自动管理身份、UUID、名称、规则和成员列表保存在同目录的 **`collection.db.spmbox.json`**。
`collection.db` 不支持额外字段，身份不再塞进游戏可见名称。
只有路径绑定的管理记录、唯一名称及成员列表匹配时，软件才允许更新或删除。

- 旧版长名及名称内 UUID 在确认更新时迁移为短名，UUID 保留在管理记录中，不重复创建。
- 已验证且未改动的旧 Wildcard／LN Wildcard／Break 自动收藏夹在同次预览中列出删除；手动改动的旧分类保留并受保护。
- 不按 `!7K` 前缀认领收藏夹。同名用户收藏夹阻止创建，不覆盖、不合并。
- 手动改名、增删成员、复制出同名集合或丢失管理记录后，拒绝接管。请把数据库、记录文件和备份一起保留。
- 写入前备份数据库和管理记录；原子替换、锁、并发检查、中断记录及失败回滚保护写入。
- **收藏夹管理 → 恢复收藏夹**恢复整个配对数据库；备份位于 `.spmbox-backups`。

恢复与手动抢救方式见 [恢复与故障处理](docs/RECOVERY.md)。

## 更新不再等于全量重跑

缓存身份只包含**实际评分／分类算法身份**，不绑定 SPM Box 应用版本、界面、收藏夹规则或命名。
既有 adapter 1–3 数据自动兼容迁移；已有标签可以精确还原的整谱家族直接补字段，不运行引擎。
少量旧无标签结果缺少原先验回退家族，仅在分类扫描时定向补算；难度重排可以直接复用其已保存星数。
未知算法版本不会误用，也不会因为当前版本不使用而立即清掉。

- 按文件路径、大小、修改／变更时间、模型与速率隔离；文件未改且算法未变，直接缓存命中。
- 切回已分析过的 Detailed / Compact、NM / DT / HT 组合复用原结果。
- 有效变体不会因超过旧的 150,000 条上限而被挤掉；完整扫描后只清理当前目录已删除文件的记录。
- 取消分析保留上一完整谱面库，已完成工作仍缓存；失败文件下次重试。
- 后台线程池最多 4 线程；评分只运行一次，原始难度场复用于 7K 分类，不简化评分模型。
- 跳过仅供 overlay 展示的曲线分桶／段位格式化。界面按 100 行分页，搜索与进度节流。

若未来真实算法改变，需要重新计算受影响的结果；旧缓存字段已被旧版本删除时无法凭空恢复。
更换 portable 文件不会改变 `%APPDATA%/SPM Box` 中的缓存，请不要随更新删除该目录。
历史性能数据及本次检查见 [验证记录](docs/VERIFICATION.md)。

## 从源码运行

Node.js 22.12+（推荐 24），Windows 10/11 x64。

```sh
npm ci
npm start
npm test
npm run test:ui
npm run build
```

本机 npm 禁用安装脚本时，先执行 `node node_modules/electron/install.js` 下载官方 Electron。
`npm run build` 生成 `dist/SPM-Box-0.1.0-portable.exe`；正在运行的旧程序可能锁定同名文件，应先退出或另命名打包。
`SPMBOX_UI_PACKAGED=1` 可对 `dist/win-unpacked` 运行同一套交互测试。
`npm run benchmark -- <本地谱面目录> 48` 可测冷／热缓存；仅在临时目录抽样，不上传谱面。
GitHub Actions 只测试、构建和保存 artifact，不自动发布 Release 或推送版本标签。

## 授权与署名

MIT · Copyright (c) 2026 **Ist1na**；改编的成绩评级逻辑 Copyright (c) 2026 **zzzzv**。
见 [LICENSE](LICENSE) 与保留的 [原项目 MIT 许可](vendor/toolbox/LICENSE)。
感谢 [OsuManiaToolbox](https://github.com/zzzzv/OsuManiaToolbox)、
[SPM Map Analyser](https://github.com/Ist1na07/spm_rating_map_analyser)、
SPM Rating / Submodel / TagClassifier，以及 sunnyxxy 的基础架构工作。
算法固定版本和完整第三方声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
