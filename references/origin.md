# 溯源与取舍

## 来源

设计源自 [Luciole-Studio/Misaka-Agent](https://github.com/Luciole-Studio/Misaka-Agent)（Apache-2.0）。

本 skill 是**面向 DSH 原生能力的重新实现**：不含该项目源码、不含其文档原文，只保留机制层面的设计约定（节点七环节、协调者/专家上下文分离、歧路审、覆盖表、逐层调和、引文核查）。若日后需要引入其任何代码或文本，需按 Apache-2.0 附 NOTICE 与许可副本。

## 原文中最容易被误读的一句

"MISAKA 仍支持将 codex/claude code 有限纳入工作流进行协作"——出处是 `docs/guide/team.md` 的 Allies 节。要点：

- 它们是 `ally`：从 board 领 card，可接研究卡/红队卡/歧路审卡；
- 但 `a card's reviewer is always a Sister`，`An ally is reached by its running card; it has no contact session`；
- 走 Agent Client Protocol，`npx` 拉起，用本机登录，`settings.json` 里 `"allies": {"claude": {}, "codex": {}}` 打开；
- 用量算厂商配额，不进 MISAKA 的 token 预算。

立场是：**编排层自己留，别家 coding agent 是可替换执行器**。不是生态兼容。

## 机制对应表

| MISAKA | 本 skill | 说明 |
|---|---|---|
| Last Order（协调者） | 编排者 + `misaka.mjs` | 状态从内存搬到 `graph.json`，可中断续跑 |
| Sister（专家） | `agent()` 一次性上下文 | 每次出手一张卡，不共享上下文 |
| 节点 7 环节 | `node-run.js` 流水线 | plan→cards→synthesis→review→respond→divergence→decide |
| 红队 | `stageReview` + 处置校验 | 每条异议必须被处置，缺一条即节点失败 |
| 歧路审 | `stageDiverge` | 缺席分 `omission` / `foreclosed` |
| 覆盖表 + 路径清单 | `graph.paths` + `coverage.gaps` | 路径指纹去重，declined 必须带理由 |
| 逐层调和 | `level-reconcile.js` + `reconcile` | 合并/汇合/关系/待开四件事 |
| panel / pane / ghostty | 不做 | DSH Web GUI 与 session 已提供 |
| LCM 层级压缩 | 不做 | DSH 自带 compress/ACP，再叠一层会打架 |
| PageIndex 全量引擎 + OCR/DjVu | 降级为 `doc.mjs` | 分部索引 + 偏移校验，缺 `pdftotext` 时明确报 degraded |
| 模型供应商管理 | 不做 | 交 DSH |
| 自动 git commit | 不做 | 产物落盘，提交是用户的决定 |
| `misaka setup` | `misaka.mjs init` + `doctor.mjs` | 非交互，打印估算 |

## 为什么是 skill 不是插件

1. 价值全在协议与产物结构，不在 UI。
2. 运行时（独立上下文子代理、并行 fan-out、模型覆盖）`workflow`/`subagent` 已提供，插件能加的只有看板。
3. 零构建、零版本耦合：坏了删掉即可，不影响 DSH。

若以后要看板，做法是另写一个只读 `graph.json` 的插件，不动本 skill。

## 与原方案的有意偏离

| 偏离 | 理由 |
|---|---|
| 默认 `depth 1 / nodes 2 / cards 3` | 原方案默认更激进；本机跑一次 3 层要 100+ 次调用，先保守 |
| 无 panel、无多标签、无共享检索索引 | 宿主已有，重复实现只会分叉 |
| `--approve plan` 只在计划改动问题本身时强制 | 让日常研究不用每步等人 |
| 报告只由 CLI 装配骨架 | 正文必须由 agent 写，骨架必须可复现 |
| ally 只能接卡片 | 见 `allies.md` 的三条理由 |
