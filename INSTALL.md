# 安装 misaka

一个 DSH skill：把深度调研拆成**研究图**跑，产物全部落盘可审计。

```
plan 计划 → 任务卡（专家各一次出手）→ 综述 → 红队 → 逐条处置 → 歧路审 → 分叉决策 → 分层调和 → 成稿 + 引文核查
```

## 前置

- **Node ≥ 20**（必需，CLI 是零依赖 ESM）。
- 可选：`pdftotext`（PDF 真实页码；缺则 PDF 源标 `degraded`，不假装成功）、`claude` / `codex`（作为 ally 接任务卡；缺则标 `fallback: subagent`）。

## 安装

```powershell
# 解压到 skills 根目录，得到 ~/.dsh/skills/misaka/
Expand-Archive misaka-0.1.0.zip -DestinationPath $env:USERPROFILE\.dsh\skills
Test-Path $env:USERPROFILE\.dsh\skills\misaka\SKILL.md   # → True
```

装完即生效，无需登记。**skill 列表是会话开场快照**：本会话的可用列表不会变，新开会话才会出现 `misaka`。验证以磁盘为准。

本机路径示例：`C:\Users\<you>\.dsh\skills\misaka`

## 验证（三条，逐条看退出码）

```powershell
$S = "$env:USERPROFILE\.dsh\skills\misaka"
node $S\scripts\templates\doctor.mjs      # 期望 exit 0，node ok；pdftotext/claude/codex 报 MISS 属正常
node $S\scripts\selftest.mjs              # 期望 31/31 passed
node $S\scripts\misaka.mjs init --question "验证" --out $env:TEMP\misaka-smoke
```

第三条应打印 `estimateAgents`、`slug: misaka-<8hex>`、`next: node misaka.mjs plan approve n1`。

## 三分钟上手

```powershell
# 1) 建运行目录（产物写到 ./research/<slug>/）
node $S\scripts\misaka.mjs init --question "你的研究问题" --depth 1 --nodes 2 --cards 3

# 2) 起草根节点计划（让 agent 写 nodes/n1/plan.md），看过再批
node $S\scripts\misaka.mjs plan approve n1

# 3) 把 scripts/templates/node-run.js 当 workflow 脚本跑（agent 自己写产物、自己推进状态）
#    返回值落盘：
node $S\scripts\misaka.mjs ingest _wf-result.json

# 4) 层末调和 → 装配骨架 → 核查引文
node $S\scripts\misaka.mjs reconcile --level 0
node $S\scripts\misaka.mjs report
node $S\scripts\misaka.mjs verify
```

`verify` 退出码：`0` 全过 / `2` 有引文失配 / `1` 状态错误。失配直接带 `node / row / locator / status` 定位到行。

其它常用：`status [--json]`、`node list`、`paths list`、`fork list`、`ingest`（幂等，重复跑只会 dedupe）。

## 目录

```
misaka/
├── SKILL.md                      触发条件、编排六步、状态机、协调者纪律
├── INSTALL.md                    本文件
├── VERSION                       0.1.0
├── README.md                     命令速查
├── references/
│   ├── protocol.md               七环节输入输出契约 + 三角色上下文边界
│   ├── graph-schema.md           graph.json 字段、状态机、11 条不变量
│   ├── artifacts.md              产物目录树与每文件必填小节
│   ├── traceability.md           四分类义务、locator 格式、失配处置
│   ├── allies.md                 claude/codex 作为 ally 的边界与适配
│   └── origin.md                 与 MISAKA 的机制对应表与有意偏离
└── scripts/
    ├── misaka.mjs                状态机 CLI（唯一写 graph.json 的东西）
    ├── doc.mjs                   文件 → 页/段模型，引文核验
    ├── selftest.mjs              31 项自测
    ├── pack.mjs                  本包打包器（零依赖 ZIP）
    └── templates/
        ├── node-run.js           workflow：单节点七环节
        ├── level-reconcile.js    workflow：层末调和
        └── doctor.mjs            环境体检
```

## 升级 / 卸载

- 升级：覆盖目录即可。`graph.json` 的 `schema` 值保持 `rdag.graph/1`（格式标识，不随技能改名变化），已有运行目录继续可读。
- 卸载：删掉 `~/.dsh/skills/misaka` 整个目录。不写注册表、不改全局环境、不留后台进程。

## 来源与署名

设计源自 [Luciole-Studio/Misaka-Agent](https://github.com/Luciole-Studio/Misaka-Agent)（Apache-2.0）的团队协作协议；本包是对该协议的 **DSH 重新实现**，不含其源码或文档原文。

有意不做：panel/pane/ghostty 界面、LCM 压缩重实现、PageIndex 全量引擎与 OCR/DjVu/LibreOffice 管线、模型供应商管理、自动 git commit、setup 向导。理由见 `references/origin.md`。

> 历史：本 skill 原名 `research-dag`，0.1.0 改名为 `misaka`；CLI 入口由 `rdag.mjs` 改为 `misaka.mjs`，新运行的 `slug` 前缀由 `rdag-` 改为 `misaka-`。改名前的运行目录（如 `research/demo`，`slug: rdag-…`）无需迁移，`status / report / verify` 照常可用。
