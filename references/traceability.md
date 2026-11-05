# 可溯源：论断四分类 + 引文核查

目的只有一个：**把"我记得"和"文件里写着"分开**。没有这一层，红队抓不到假引文，歧路审也分不清"证据不足"和"框架看不到"。

## 四分类

| 类型 | 定义 | 义务 |
|---|---|---|
| `fact` | 能在指定位置逐字找到原文的陈述 | 必须 locator + page + offset + quote，且必须通过 `verify` |
| `inference` | 由 fact 推出，可被反驳但不可被"查原文"证伪 | 写明推自哪几条 fact |
| `interpretation` | 对材料意义的读解（"这说明…"） | 写明读解框架 |
| `value` | 价值判断（"更重要/更值得"） | 标明是价值判断，不许伪装成事实 |

判断顺序：能查到原文 → fact；只是"一般来说/通常是" → inference；"这意味着" → interpretation；"应该" → value。

**降级优先于编造**：查不到原文就写 inference，不要凑一个看起来对的页码。

## locator 格式

```
file#p<page>@<offset>
notes/hist/cities.md#p3@120
```

- `file` 相对 `<run>` 目录（不要写绝对路径，产物要能搬）。
- `page` 与 `doc.mjs` 的页面模型一致：
  - `.md` → 按 ATX 标题分节，节序号从 1 起（`# 前言` 也算第 1 节）；
  - `.txt` → 每 3000 字符一段，段序号从 1 起；
  - `.pdf` → 真实页（需 `pdftotext`，否则该文件不可核，标 degraded）。
- `offset` 是**该节/该页文本内**的 0 基字符偏移。

## SOURCES.md 表格式（机器读，别改格式）

```markdown
| # | type | claim | file | page | offset | quote |
|---|------|-------|------|------|--------|-------|
| 1 | fact | 特许状在12世纪已由城市共同体自行颁授 | notes/cities.md | 2 | 340 | …逐字原文… |
| 2 | inference | 大学特许状沿用了城市特许状的司法豁免逻辑 | | | | |
| 3 | value | 制度连续性比思想史解释更值得采纳 | | | | |
```

规则：
- 七列固定，**单元格内不许出现 `|`**（换行或改用 `｜`）。
- 非 `fact` 行 file/page/offset/quote 留空。
- `#` 从 1 连号，不要跳号。
- `verify` 只核 `fact` 行；`inference`/`interpretation`/`value` 无外部核查义务，但会被统计（`summary.untyped` 记未标类型的行）。

## 核查流程

```bash
# 1. 建索引（看有哪些文件、哪些不可核）
node doc.mjs scan ./research/<slug>

# 2. 看文件结构，确认 page 编号
node doc.mjs outline notes/cities.md

# 3. 摘要某节
node doc.mjs read notes/cities.md --section 2 --max 2000

# 4. 找关键词，拿 offset
node doc.mjs find "特许状" notes/cities.md

# 5. 单条校验
node doc.mjs verify notes/cities.md --page 2 --offset 340 --quote "…逐字原文…"

# 6. 整轮校验（所有节点的 SOURCES.md）
node misaka.mjs verify --dir ./research/<slug>
```

`misaka.mjs verify` 退出码：`0` 全过，`2` 有失配，`1` 状态错误。失配输出带 `node / row / locator / status`，直接定位到行。

## 失配的四种状态与处置

| status | 含义 | 处置 |
|---|---|---|
| `offset-mismatch` | 原文在该页，但偏移不对（`foundAt` 给了真实偏移） | 用 `foundAt` 修正 offset |
| `page-mismatch` | 原文在别的页（`foundPage` 给了真实页） | 修正 page，通常意味着引用时看的是另一个文件版本 |
| `not-found` | 全文找不到 | 引文被改写、文件被换过、或本来是编的 → 降级 inference 或换源 |
| `degraded` | 文件不可读（PDF 无 pdftotext / 二进制） | 转成 md/txt 再引，或换可核来源 |

`degraded` 不算通过。不可核的引用永远只是"看起来有出处"。

## 报告里的呈现

- 报告正文里 `fact` 用脚注式 locator，例：`…（notes/cities.md#p2@340）`。
- 附录 D 列出红队处置；附录 C 列出未采纳路径及理由。
- 每条 `foreclosed` 缺席在正文对应章节末尾单独一行说明——这是这套流程最不容易被替代的产出。
