# 产物约定

目录树（`<run>` = `./research/<slug>/`）：

```
<run>/
├── run.json                        参数、估算、创建时间（只读参考）
├── graph.json                      状态源（只经 CLI 写）
├── roles/<id>.md                   专家档
├── nodes/<id>/
│   ├── plan.md
│   ├── cards/<key>.md
│   ├── synthesis.md                第一版结论
│   ├── synthesis-2.md              答复红队后的修订版（再修订就 -3）
│   ├── review-1.md                 红队（第二轮 -2）
│   ├── divergence-1.md             歧路审
│   ├── decision.md                 裁决
│   ├── SOURCES.md                  引文表（机器可读，verify 的输入）
│   └── errata.md                   勘误（可选）
├── nodes/_reconcile-L<N>.md        层间调和记录
└── final/<slug>-final.md           成稿
        <slug>-graph.md             图谱
```

## 每个文件的必填小节

| 文件 | 必填 | 别写什么 |
|---|---|---|
| `plan.md` | 问题重述 / 判据轴 / 任务卡 / 已知盲区 / 待探路径 / 分叉风险 | 结论、资料摘抄 |
| `cards/<key>.md` | 任务 / 发现 / 死路 / 缺口 | 节点级结论 |
| `synthesis.md` | 结论 / 论证 / 覆盖表 / 与既有理解的差异 | 卡片罗列 |
| `review-1.md` | 异议清单 / 抽检记录 / 若我是作者我会先改哪一处 | 替作者改稿 |
| `synthesis-2.md` | 上一版全部 + 相对于上一版的改动（逐条对应异议 id） | 无声覆盖旧版 |
| `divergence-1.md` | 疏漏 / 问题式所不容见 / 需要的提法改动 / 分叉建议 | "还需更多研究" |
| `decision.md` | 裁决 / 三句话结论 / 开子节点的理由 / 遗留 | 复述综述 |
| `SOURCES.md` | 固定表头（见 `traceability.md`） | 单元格内出现竖线 |
| `errata.md` | 勘误（原说法 → 更正 → 依据） | 空文件 |

## roles/<id>.md —— 专家档三段

```markdown
## DESCRIBE
制度史方向：关注行会、特许状、城市法；不看思想史。

## SOUL
你读档案时先问"这份文件是为谁写的、要解决谁的麻烦"，再看它说了什么。
不喜欢把制度说成"自然演化"；遇到"自然而然"就找利益。

## SKILLS
research, domain-modeling
```

- `DESCRIBE` 只有这段进协调者可见范围（用来决定派什么卡）。
- `SOUL` 只贴进该专家自己的 prompt，从不外传。
- `SKILLS` 是它开工前该读的本地 skill 名。

专家档的 `provider`/`model`（可选）写在文件头的 YAML 里：

```yaml
---
provider: anthropic
model: claude-sonnet-4
---
```

缺省则用会话默认模型。

## run.json

```json
{ "slug": "…", "question": "…", "out": "…",
  "params": { "...": "同 graph.params" },
  "estimate": { "nodesMax": 24, "cardsPerNode": 3, "agentsPerNode": 7, "estimateAgents": 18 },
  "created": "ISO" }
```

只用来给人看成本，程序不读它做判断。

## final/<slug>-final.md

由 `misaka.mjs report` 装配骨架，报告 agent 填正文。结构固定：

```
# <slug> — 研究报告
> 问题 / 生成时间 / 深度 / 节点数
## 摘要
## 章节            （每节点一节：结论先写，论证后写）
## 图谱
## 附录 A 代价与用量
## 附录 B 勘误
## 附录 C 未采纳路径
## 附录 D 审查处置
## 参考文献
```

附录不是摆设：B 让读者看见你改过什么，C 让读者看见你没走哪条路（及其理由），D 让读者看见红队说过什么、你当时怎么答。这三样是这套流程对"看起来像研究"的最大区别。

## 磁盘卫生

- 所有产物是纯文本 Markdown + JSON，`git diff` 可读，没有二进制。
- 不写 `node_modules`、不装依赖、不生成临时缓存（`doc.mjs scan` 的 `_index.json` 例外，它可随时重建）。
- 不自动 commit。要不要提交是用户的决定。
