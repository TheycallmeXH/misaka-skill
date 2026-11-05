# graph.json —— 唯一状态源

只有 `misaka.mjs` 写它。手工编辑会绕过不变量检查，之后 `verify`/`reconcile` 的行为都不可信。

## 结构

```json
{
  "schema": "rdag.graph/1",
  "slug": "misaka-cbc6974b",
  "question": "总问题",
  "created": "ISO",
  "updated": "ISO",
  "level": 0,
  "params": {
    "depth": 1, "nodesPerLevel": 2, "cardsPerNode": 3,
    "reviewRounds": 1, "revisions": 1, "maxNodes": 24, "approve": "plan"
  },
  "nodes": {
    "n1": {
      "id": "n1", "level": 0, "parent": null,
      "question": "…", "questionFp": "12位sha1", "premise": "root",
      "state": "decided", "reviewer": "sister", "cards": 0,
      "decision": null, "verdict": "merge", "failReason": null,
      "created": "ISO", "updated": "ISO"
    }
  },
  "paths": [
    { "id": "p1", "node": "n1", "text": "待探路径", "fp": "…", "status": "open", "reason": null }
  ],
  "relations": [
    { "a": "n1", "b": "n2", "type": "convergence", "note": "…" }
  ],
  "pendingForks": [
    { "id": "f1-xxx", "node": "n1", "question": "…", "fp": "…", "status": "pending" }
  ],
  "approvals": [ { "id": "n1", "what": "plan", "by": "user", "at": "ISO" } ],
  "usage": { "agents": 0, "cards": 0, "ally": {} }
}
```

`schema` 字段值 `rdag.graph/1` 是**格式标识**（技能改名前的历史 id），故意保持不变，这样改名时已有的运行目录（如 `research/demo`）继续可读，不需要迁移。新运行的 `slug` 用 `misaka-<fp8>` 前缀。

## 状态机

```
planned → carding → concluded → reviewed → responded → diverged → decided → merged
                                                                        ↘ declined
任意状态 → failed
```

| 跃迁 | 谁来推 | 前置条件 |
|---|---|---|
| → carding | plan agent（末段 clerk 兜底） | `--approve plan` 时必须有 `approvals[{id,what:"plan"}]` |
| → concluded | synthesis 完成后 | `synthesis.md` + `SOURCES.md` 存在 |
| → reviewed | review 完成后 | `review-1.md` 存在 |
| → responded | respond 完成后 | dispositions 覆盖全部 objections |
| → diverged | divergence 完成后 | `divergence-1.md` 存在 |
| → decided | decide 完成后 | `decision.md` 存在 |
| → merged / declined | reconcile 或编排者 | 与 `decision.md` 的 verdict 一致 |

非法跃迁 → 退出码 1，错误信息里列出允许的下一状态。不静默纠正。

## 不变量（CLI 强制）

1. `nodes[].id` 唯一；`id` 递增生成（n1, n2, …），不复用。
2. `parent` 必须存在；`level` 必须等于 `parent.level + 1`；`level <= params.depth`。
3. 同一问题只研究一次：`questionFp` 全图唯一（归一化：去空白、去标点、小写）。重复 → 拒绝并回既有 id。
4. 一个节点一个 `decision`（`decision.md` 覆盖写，历史版本靠 `synthesis-2.md`、`review-2.md` 留痕）。
5. `pendingForks` 存在 `status:"pending"` 时 `reconcile` 拒绝推进。
6. `paths[].fp` 唯一；`declined` 必须带 `reason`。
7. `relations` 同一对节点同一类型只记一次。
8. 节点总数 ≤ `params.maxNodes`。
9. `fork resolve` 的裁决只有 `accept | reject | rewrite` 三种（`park` 不存在：要留就 `rewrite` 成新问法，要丢就 `reject` 并写 note）。
10. `paths[].status` 只有 `open | covered | declined`；`open` 进报告附录 C 的"未展开"段，不等于"已排除"。
11. `verify` 只对真跑过的节点查引文：`planned` / `declined` 节点在 `summary.skipped` 里列出，不算通过也不算失败（它们不欠引文）；跑过但缺 `SOURCES.md` 才是 problem。

## 指纹（questionFp）

```
fp = sha1( question.toLowerCase() 去空白 去标点 )[0:12]
```

去标点包含中英文标点：`，。；：、？！,.;:?!'"“”‘’（）()《》<>-—_/\|`。

作用不是"语义去重"，而是"拦住同一个问题被开两次"。要问得不一样，就把问题写得不一样——这本来就是好事。

## resume

`status --json` 的 `resumable` 列出全部非终态节点，`next` 是下一状态。续跑规则：

- `carding` 但 `synthesis.md` 已存在 → 从 synthesis 接着跑；
- `concluded` → 从 review 接着跑；
- `responded` 但缺 dispositions → 重跑 respond；
- `failed` → 读 `failReason`，修完用 `node status <id> failed` 不行（终态），改法：`node add` 开等价新节点，或手工把该节点状态改回 `planned`（唯一允许的手工编辑场景，改完立刻 `status` 复核）。
