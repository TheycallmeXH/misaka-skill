# misaka

DSH skill：可审计的深度研究流程。协调者只看交付物，专家一次出手交一张卡，结论必须过红队与歧路审，引文必须能对回原文。

```bash
# 1. 自检
node scripts/templates/doctor.mjs

# 2. 建运行目录
node scripts/misaka.mjs init --question "…" --depth 2 --nodes 2 --cards 3 --out ./research/myslug

# 3. 根节点计划过审（--approve plan 时必需）
node scripts/misaka.mjs plan approve n1 --dir ./research/myslug

# 4. 跑一层：把 scripts/templates/node-run.js 作为 workflow 的 script，args 见 SKILL.md

# 4.5 把它的返回值落盘（paths / forks / 子节点，幂等）
node scripts/misaka.mjs ingest _wf-result.json --dir ./research/myslug

# 5. 层末调和
node scripts/misaka.mjs reconcile --level 0 --dir ./research/myslug
#    （再把 scripts/templates/level-reconcile.js 作为 workflow script 跑一次）

# 6. 开下一层
node scripts/misaka.mjs node add --parent n1 --question "…" --premise "为什么拆" --dir ./research/myslug

# 7. 收口
node scripts/misaka.mjs report --dir ./research/myslug
node scripts/misaka.mjs verify --dir ./research/myslug      # 有失配 exit 2

# 随时看进度
node scripts/misaka.mjs status --dir ./research/myslug
```

文档结构：

| 文件 | 内容 |
|---|---|
| `SKILL.md` | 何时用、怎么跑、七环节、协调者纪律 |
| `references/protocol.md` | 每个环节的输入输出契约与硬规则 |
| `references/graph-schema.md` | graph.json 结构与不变量、状态机、resume |
| `references/artifacts.md` | 产物目录与每个文件的必填小节、专家档三段格式 |
| `references/traceability.md` | 论断四分类、locator 格式、SOURCES 表、失配处置 |
| `references/allies.md` | claude/codex 作为 ally 的接入口径与降级 |
| `references/origin.md` | 与 MISAKA 的机制对应表、取舍理由、署名 |
| `INSTALL.md` | 安装、验证、三分钟上手、升级卸载、署名 |
| `scripts/pack.mjs` | 打可分发包（零依赖 ZIP，写入 `dist/`） |

零依赖，Node ≥ 20。不装任何 npm 包，不自动 git commit。

## 打包分发

```bash
node scripts/pack.mjs                     # → ./dist/misaka-<ver>.zip + .sha256 + .manifest.json
node scripts/pack.mjs --out D:\dist --version 0.1.1
```

同一份源码重跑产出字节一致的 zip（条目序固定、时间戳固定 1980-01-01、deflate 9），sha256 可对账。
接收方解压到 `~/.dsh/skills` 即得 `~/.dsh/skills/misaka/`，跑 `scripts/selftest.mjs` 应 31/31。

版本在 `VERSION` 文件里；改版本号只需改这个文件（`pack.mjs` 默认读它）。

## 安装

见 [`INSTALL.md`](INSTALL.md)：解压到 `~/.dsh/skills/`（或把本仓库克隆到 `~/.dsh/skills/misaka`），跑一次 `scripts/selftest.mjs`。

## 来源与协议

- 本仓库代码与文档：Apache License 2.0（见 [`LICENSE`](LICENSE)）。
- 设计源自 [MISAKA](https://github.com/Luciole-Studio/Misaka-Agent)（Copyright 2026 Luciole Studio，Apache-2.0）公开文档描述的协作协议，按 Apache-2.0 §4(d) 在 [`NOTICE`](NOTICE) 中保留署名。
- **不含 MISAKA 的源码或文档原文**：协议重写、schema 与本仓所有脚本均为本项目自行编写；第三方清单见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。
- 与 Luciole Studio 无隶属、无背书关系；"MISAKA" 仅用于标注设计来源，不主张任何商标权（Apache-2.0 §6）。

