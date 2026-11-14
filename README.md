# SPM Box

**按 SPM 难度选谱，把键型整理成收藏夹。**

离线 Windows 桌面工具，以 SPM Rating、SPM Submodel 和 SPMTagClassifier 为核心。
支持 osu!stable 的本地 `.osu` 谱面与 `collection.db`，不修改谱面文件或 osu! 原版星数。

## 开始使用

1. 下载 [Releases](https://github.com/Ist1na07/SPMBox/releases) 中的 Windows x64 portable 程序；也可以按下文从源码运行。
2. 选择 **osu!stable 安装目录**，或其 `Songs` 文件夹。安装目录中的 `BeatmapDirectory` 配置也会被读取。
3. 点击 **分析谱面**，按 SPM 总难度、RC、LN、曲名或 ID 排序，也可筛选键数、键型、作者及导出 CSV。
4. 在 **收藏夹创建器** 中应用“!SPM Box · 全部 7K 键型”预设，或为单个键型设置阈值，然后预览边界谱面。
5. 检查各分类数量，**完全退出 osu!**，确认后批量创建。重新打开 osu! 后查看收藏夹。

程序无需联网；“在线谱面”和“源代码”按钮会按你的操作打开浏览器。当前发行版未做代码签名。

## 先看边界，再创建

- 每个键型有独立规则和单维数值阈值，比较采用 **分数 ≥ 阈值**。
- 每个分类显示入选分数最低的 5 张和未入选分数最高的 5 张，包含谱面 ID；未提交谱面显示本地 MD5 短标识。
- 默认预设一次选择全部 **19 个 7K 分类**，包含 RC、LN、混合及回退/休息分类；空分类也会创建。4K/6K 不会进入此预设。
- 预设名称和自动收藏夹统一使用 **`!SPM Box · `** 前缀，例如 `!SPM Box · 7K · Speed · detail-1x`，便于在游戏中集中排列与检索。
- 支持 Detailed / Compact 与 NM / DT（NC）/ HT；不同模型与速率的收藏夹分开管理，缓存也互不混用。

### 默认判定和数值阈值各有明确含义

当前上游 TagClassifier 的默认整谱标签使用**先验保留、强标签增补、混合及双族门控**，并不存在每个标签一个固定阈值就能完全复现的规则。因此 SPM Box 默认保留上游完整标签判定，另提供每个键型独立的数值阈值模式。

数值模式初值为上游保留门限 **25%**；Hybrid 初值为 Detailed 的双族门限 **10%**。这些初值不是对上游整套判定的替代声明。点击“恢复默认”返回上游判定。

- 14 个具体 7K 分支：上游的重叠支持加权难度负担占比，不是正确概率或时间占比。
- RC Mix / LN Mix：对应家族联合负担占比；数值模式不再要求上游混合多样性门控。
- Hybrid：单维分数为 `100 × min(RC familyMass, LN familyMass)`，避免纯 RC / LN 因家族总和而误入 Hybrid；它与上游显示标签的联合百分比不同。
- Wildcard / Break：上游没有对应连续难度分支，数值模式使用时长加权局部分类支持。上游默认整谱判定通常不会选出它们，空收藏夹是正常结果。
- 4K/6K 浏览器中的粗分类为另一套五类归一化形态支持，不能与 7K 百分比混为一谈。

## 只管理属于 SPM Box 的收藏夹

`collection.db` 没有扩展元数据字段，因此自动收藏夹的名称末尾附带完整的
`[SPMBox:v1:<owner UUID>:<collection UUID>]` 标识。请保留该标识。

程序同时维护同目录的 `collection.db.spmbox.json`，只有**名称标识、管理记录与谱面列表全部匹配**时才能更新或删除。
旧版 `SPM Box · …` 自动收藏夹在下次确认更新时添加 `!` 前缀，保留原 UUID 与管理关系；已被手动改动或存在目标名称冲突时拒绝改名。不会仅因名称相似而修改用户收藏夹。

- 不按显示名认领收藏夹；你手动创建的同名分类仍然受到保护。
- 手动增删谱面、复制出重复标识或删除管理记录后，程序不会继续覆盖原收藏夹。
- 用户收藏夹和无法验证来源的其他自动收藏夹均为只读。
- 保存前备份数据库与管理记录；写入使用临时文件替换、并发检查、锁文件和中断记录。
- **收藏夹管理 → 恢复收藏夹** 可恢复配对备份，恢复前也会备份当前文件。

备份位于 osu! 目录的 `.spmbox-backups`。恢复会回退整个数据库，包括备份之后的用户收藏夹更改。
保留 `collection.db`、标识文件和备份一起迁移；路径改变时程序会拒绝把旧记录直接认作新数据库。
见 [恢复与故障处理](docs/RECOVERY.md)。

## 快速分析，不简化算法

- 后台线程池，默认最多 4 线程，按 CPU 可用并行度限制；界面不等待单张谱面的计算。
- 只做一次完整 rating，把同一次原始难度场交给 7K classifier。
- 直接调用完整评分引擎，跳过仅供 overlay 显示的曲线分桶和段位格式化；评分模型与参数不变。
- 持久增量缓存按算法版本、文件路径、大小、修改/变更时间、模型与速率隔离；未变化谱面不再运行两个引擎。
- 取消分析保留上一次完整谱面库，已完成的分析仍写入缓存；失败文件会在下次扫描重试。
- 谱面表按 100 行分页，搜索节流，进度消息节流；缓存日志定期合并，最多保留 150,000 项。

本机 48 张大小分层抽样的真实 7K 谱面：单线程 **8.899 s** → 4 线程 **4.419 s**，完整缓存命中约 **5 ms**。
三者结果完全一致。环境及限制见 [验证记录](docs/VERIFICATION.md)，耗时取决于机器和谱面。

## 从源码运行

需要 Node.js 22.12+（推荐 24）与 Windows 10/11 x64。

```sh
npm ci
npm start
```

如果本机 npm 配置禁用了安装脚本，先执行 `node node_modules/electron/install.js` 下载官方 Electron 运行时。

```sh
npm test                 # 算法适配、边界、缓存、数据库与安全回归
npm run test:ui          # 实际 Electron 交互测试，使用临时谱面和数据库
npm run benchmark       # 生成测试谱面的冷/热缓存基准
npm run build           # dist/SPM-Box-0.1.0-portable.exe
```

`npm run benchmark -- <本地谱面目录> 48` 可测真实谱面；只在临时目录中复制抽样文件，不上传谱面。
GitHub Actions 在推送时运行测试、构建 Windows portable 并保存 Actions artifact，**不自动创建 Release**。
版本标签与正式发布仅在用户明确要求对应版本时创建。

## 当前支持范围

- 原生 4K / 6K / 7K 的 SPM 总难度和 RC/LN 难度；星数应在相同键数内比较。
- 7K 精细分类收藏夹；4K/6K 原生粗分类只用于浏览与筛选。
- osu!stable；**不直接读写 osu!lazer 数据库**，不重写 `osu!.db`，不修改成绩评级。
- 没有在线下载谱面、账号登录或遥测。分类失败与损坏谱面会在报告中列出，不静默伪造分数。

## 授权与署名

MIT · Copyright (c) 2026 **Ist1na**。见 [LICENSE](LICENSE)。

感谢 [zzzzv / OsuManiaToolbox](https://github.com/zzzzv/OsuManiaToolbox) 的功能参考、
[SPM Map Analyser](https://github.com/Ist1na07/spm_rating_map_analyser) 的算法集成、
SPM Rating / Submodel / TagClassifier，以及 sunnyxxy 的基础架构工作。
完整版本来源和运行时授权见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
