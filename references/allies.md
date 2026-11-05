# allies：把 claude / codex 当作执行器纳入，而不是当作队友

这套口径直接对应 MISAKA 的 "Allies"：外部 coding agent 只能接**任务卡**，不能接红队卡，不能做协调者，不能有常驻会话。

## 为什么限定得这么死

三个硬理由，不是姿态问题：

1. **审者不能是执行者的同类**。红队如果也由外部 agent 做，那条"每条异议必须被处置"的校验就失去了独立性——它会对自己的同类手软，也无法读本地 skill 里的判据。
2. **协调者必须长期在场**。ally 无常驻会话（`An ally is reached by its running card`），图状态、待审批分叉、层间调和都需要跨调用记忆，这些只能留在编排层。
3. **成本要隔离**。ally 的用量算厂商配额，不进本流程的估算；混在一起会让 `run.json` 的代价估算失去意义。

## 本机实现（`scripts/templates/doctor.mjs` 检测）

```bash
node <skill>/scripts/templates/doctor.mjs
# ally: claude=false codex=false
```

检测逻辑：`claude` 与 `codex` 是否在 PATH 且 `--version` 可执行。

### 有 CLI 时的适配形状

```bash
claude -p "<card prompt>" --output-format json
codex exec --json "<card prompt>"
```

两者都返回 JSON，把输出映射到卡片 schema：

```js
// CardOut
{ card_path, key, headline, claims: [{ text, type, locator, page, offset, quote }],
  dead_ends: [], open_questions: [] }
```

映射时的三条硬约束：
- **写盘由 ally 自己做**（它有文件工具）：把 `card_path` 传给它，要求它写完再回 JSON。不回路径视为失败。
- **类型标记不许省**：没有 `type` 的论断一律按 `inference` 收，并在 `run.json.usage.ally` 记一次 `untyped`。
- **引文必须过 verify**：ally 最容易编页码，`fact` 行照常进 `misaka.mjs verify`，失配就和内置 agent 一样处理。

### 在 workflow 里怎么接

`node-run.js` 的 `stageCard` 已经支持两个口子：

```js
{ provider: "…", model: "…" }   // 走内置 provider
```

ally 走另一条：把该卡的 `agent()` 调用替换成一次 shell 调用（`claude -p …`），拿回 JSON 后填同样的结构。建议只在 `cards` 环节替换，其它环节（plan/synthesis/review/respond/divergence/decide）保持内置 agent——审与判这两类永远不外派。

### 无 CLI 时的降级

标 `fallback: subagent`，同一条卡走 `agent()`。**不假装是 ally**：`run.json.usage` 里要能看出这一轮到底谁干的活，否则代价与质量都无法回溯。

## 计费与限额

```json
"usage": { "agents": 14, "cards": 6, "ally": { "claude": { "cards": 3, "runs": 3 }, "codex": {} } }
```

- `agents` 计内置调用数，`cards` 计卡片数。
- `ally` 单独计，用 `runs`（次数）而不是 token（拿不到可靠 token 数就别假装能算）。
- 预算超了就停在这一层，不要偷跑到下一层再报错。

## 一句话判断该不该用 ally

- 该用：卡片任务重工具调用（跑测试、读大仓库、跑脚本），且结果能被本地 verify 兜住。
- 不该用：红队、歧路审、裁决、层间调和、报告终稿——这些的失败代价是"看起来对"，本地无法机械发现。
