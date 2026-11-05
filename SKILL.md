---
name: misaka
description: 用「研究图（research DAG）」跑深度调研：协调者只看交付物、专家各在一次出手里交任务卡、结论必须过红队与歧路审、每层节点收口成 merge/decline/split，产物全部落盘可审计（plan/cards/synthesis-vN/review/divergence/decision/SOURCES/errata）。当用户要做多轮深度调研、要"别一个 agent 一口气写完"、要带引文核查的研究报告、要把一个问题拆成多节点分别研究再调和、或提到 研究图/红队/歧路审/症候阅读/可审计调研 时使用。
---

# misaka

一套可审计的深度研究流程。核心是把**判断**留在协调者、把**执行**拆给一次性专家上下文，并强制两件事：结论必须被红队攻击后逐条处置，引用必须能对回原文。

设计源自 [Luciole-Studio/Misaka-Agent](https://github.com/Luciole-Studio/Misaka-Agent)（Apache-2.0）的团队协议，本 skill 是面向 DSH 原生能力（`workflow` / `subagent`）的重新实现，不含其源码。详见 `references/origin.md`。

## 什么时候用

- 一个问题需要多路线并行、还要把各路结论调和成一个判断。
- 用户明说"别糊""要有出处""哪些没看到也写出来"。
- 报告要能被人追问：这条结论哪来的、红队说过什么、你当时怎么答的。

不要用于：单点事实查询、一次能写完的小文案、纯代码任务。

## 依赖

```bash
node <skill-directory>/scripts/templates/doctor.mjs      # 先自检
```

必须：`node >= 20`。可选：`pdftotext`（PDF 引文核查）、`claude`/`codex`（allies）、`git`（你自己提交，本 skill 不提交）。

CLI 全部零依赖，统一入口：

```bash
node <skill-directory>/scripts/misaka.mjs <command>
node <skill-directory>/scripts/doc.mjs  <command>
```

`<run>` = 产物目录，默认 `./research/<slug>/`，之后所有命令都带 `--dir <run>`。

## 跑一次（编排者视角）

**0. 判断规模**（先跟用户对齐，别自己决定烧多少）

| 规模 | depth | nodes/层 | cards/节点 | 大致 agent 调用 |
|---|---|---|---|---|
| 小的对照研究 | 1 | 2 | 2 | ~18 |
| 正常调研 | 2 | 2 | 3 | ~50 |
| 大专题 | 3 | 2 | 3 | ~140 |

`init` 会打印估算，`--max-nodes` 是硬上限。

**1. 起草根节点计划，交用户点头**

用 plan agent（不要自己推演）写根节点的 `plan.md` 草案。`--approve plan` 时，把"问题重述 + 判据轴 + 任务卡 + 已知盲区 + 待探路径"摘要给用户，等一句"可以"，再

```bash
node misaka.mjs init --question "…" --depth 2 --nodes 2 --cards 3 --out ./research/<slug>
node misaka.mjs plan approve n1
```

**2. 逐层跑**（一层 = 一次 `workflow` 调用）

读 `scripts/templates/node-run.js`，把它作为 `workflow` 的 `script`，`args` 传：

```js
{
  cli: "<skill-directory>/scripts/misaka.mjs",     // 绝对路径
  runDir: "<abs>/research/<slug>",
  rootQuestion: "…", nodesPerLevel: 2, cards: 3, rounds: 1,
  nodes: [ { id: "n1", question: "…", premise: "root", level: 0,
             roles: [{ id: "hist", focus: "制度史" }] } ]
}
```

同层多个节点塞进同一个 `nodes` 数组，节点之间并行、节点内部按七环节串行。层内失败：脚本对红队异议未处置的节点会重试一次 `respond`，仍缺则标 failed 并返回原因；其余节点照跑。

**2.5 把 workflow 返回值落盘（别手工抄）**

`node-run` 的返回值里带 `plan_paths` / `new_paths` / `forks` / `new_nodes`。**不要一条条 `paths add` / `fork add` / `node add`**，交给 ingest：

```bash
node misaka.mjs ingest _wf-result.json --dir ./research/<slug>   # 或 ingest --json "<返回值>"
```

它按指纹去重后写入：`plan_paths`+`new_paths` → `paths`（p1…）、`forks` → `pendingForks`（f1…）、`new_nodes` → 子节点（level = parent+1，受 depth / maxNodes / 同问指纹三重拦截）。幂等：同一份返回值跑第二次全部 deduped。输出末尾给 `next`（先裁决 fork / 跑下一层 / 去 reconcile）。

**3. 层末调和**

```bash
node misaka.mjs reconcile --level 0      # 有未收口节点或有 pending fork 会直接拒绝
```

再把 `scripts/templates/level-reconcile.js` 作为 `workflow` 脚本跑一次（args 传本层各节点的 verdict/summary/decision_path），它负责同问合并、殊途汇合、关系记录、下一层待开清单，并用 CLI 落实 `relation add` / `paths add`。

**4. 开下一层**

只从 `reconcile` 输出的 open paths / 上一层 `split` 裁决出的 `new_nodes` 开节点（若已跑过 `ingest`，`new_nodes` 那部分已经建好了，别再手工 add 一遍）：

```bash
node misaka.mjs node add --parent n1 --question "…" --premise "为什么拆这一块"
```

同问会被指纹去重（同父或跨层都拦），提示里直接给既有节点 id。

**5. 收口**

```bash
node misaka.mjs report      # 只装配骨架，正文由报告 agent 填
node misaka.mjs verify      # 引文逐条对回原文，任一失配 exit 2
```

`report` 生成 `final/<slug>-final.md`（摘要/章节/图谱/附录 A 代价、B 勘误、C 未采纳路径、D 审查处置/参考文献）。正文由报告 agent 写：逐节点综述 → 初稿 → 独立红队 → 终稿，四步各自独立上下文。

**6. 断点续跑**

```bash
node misaka.mjs status --json     # resumable: 第一个非终态节点
```

状态只在 `graph.json`，产物只在磁盘：重跑从非终态节点接着跑，不重复已 `decided` 的节点。

## 七环节（每个节点）

| 环节 | 产出 | 关键强制 |
|---|---|---|
| plan | `plan.md` | 问题重述 + 判据轴 + 任务卡（互不重复）+ 已知盲区 + 待探路径 |
| cards | `cards/<key>.md` ×N | 每条论断带类型 `fact/inference/interpretation/value`；`fact` 必须带 locator + quote |
| synthesis | `synthesis.md` + `SOURCES.md` | 先结论后论证；覆盖表的空单元必须进 `coverage.gaps` |
| review（红队） | `review-1.md` | 五个方向（证据/逻辑/范围/来源/提法）各至少一条；抽检 ≥2 条引文 |
| respond | `synthesis-2.md` | 每条异议处置为 `revise/rebut/concede/refer/park/fork`，缺一条即节点失败 |
| divergence（歧路审） | `divergence-1.md` | 缺席分两类：`omission`（疏漏）与 `foreclosed`（问题式所不容见），后者 ≥2 条 |
| decide | `decision.md`（+`errata.md`） | 只能是 `merge / decline / split`；`split` 必须给子节点问题 |

## 状态机

```
planned → carding → concluded → reviewed → responded → diverged → decided → merged
                                                                        ↘ declined
任意状态 → failed（带 reason）
```

非法跃迁一律报错退出（不静默纠正）。`--approve plan` 时，没有 `plan approve <id>` 就不许进 `carding`。

## 协调者的纪律（写在最前面，容易犯）

1. **只看交付物**。子代理只回 `{verdict, files[], objections[], gaps[]}` 这类短结构；正文在磁盘，协调者不把卡片正文读进上下文。
2. **不替专家推演**。计划、综合、裁决都由对应 agent 做；协调者负责传 id、传路径、卡上限、向用户要裁决。
3. **改变问题本身的分叉必须问人**。`fork` 进 `pendingForks`，未清空时 `reconcile` 直接拒绝进下一层。
4. **不 commit**。产物落在用户目录，由用户自己提交。
5. **不编引文**。`verify` 是门，不是建议；`fact` 没有可核 locator 就降级成 `inference`。

## 目录

```
<run>/
├── run.json                      参数与估算
├── graph.json                    唯一状态源（只经 CLI 写）
├── roles/<id>.md                 专家档：DESCRIBE（协调者可见）/ SOUL（仅自己）/ SKILLS（该读哪些 skill）
├── nodes/<id>/
│   ├── plan.md  cards/*.md  synthesis.md  synthesis-2.md …
│   ├── review-1.md  divergence-1.md  decision.md
│   ├── SOURCES.md  errata.md
└── final/<slug>-final.md  <slug>-graph.md
```

## 参考

- `references/protocol.md` —— 每个环节的输入/输出契约与角色 prompt 要点
- `references/graph-schema.md` —— graph.json 字段、不变量、状态机
- `references/artifacts.md` —— 每类产物文件的必填小节
- `references/traceability.md` —— 论断四分类、locator 格式、核查流程、SOURCES.md 表格式
- `references/allies.md` —— claude/codex 作为 ally 的接入口径与降级
- `references/origin.md` —— 与 MISAKA 的机制对应表、署名与取舍理由
- `INSTALL.md` —— 安装、验证三条、三分钟上手、升级卸载
- `scripts/pack.mjs` —— 打可分发包：`node scripts/pack.mjs [--out DIR] [--version X]`，产出 `dist/misaka-<ver>.zip|.sha256|.manifest.json`，重跑字节一致
