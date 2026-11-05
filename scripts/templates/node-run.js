/**
 * node-run.js — misaka 节点运行器（workflow 脚本模板）
 *
 * 用法：把本文件内容作为 workflow 工具的 `script`，args 传：
 *   {
 *     cli: "C:/Users/<you>/.dsh/skills/misaka/scripts/misaka.mjs",
 *     runDir: "C:/proj/research/<slug>",
 *     cards: 3,                       // 每节点任务卡上限（默认 3）
 *     nodes: [                        // 同一层的节点，一次调用跑完（每个节点内部串行，节点之间并行）
 *       { id: "n1", question: "…", premise: "…", level: 0, roles: [{id:"hist", focus:"制度史", provider:"", model:""}] }
 *     ]
 *   }
 *
 * 硬约束（脚本运行环境没有 fs / 网络 / 定时器 / Node API）：
 *   - 本脚本不读写文件、不落盘、不依赖 Date/JSON。
 *   - 所有产物由 agent 自己写盘；所有状态由 agent 调 CLI 推进（末段 clerk 兜底）。
 *
 * 七环节：plan → cards → synthesis → review(红队) → respond(逐条答复) → divergence(歧路审) → decide
 */

const A = args;
const CLI = A.cli;
const RUN = A.runDir;
const CARDS = A.cards || 3;
const NODES = A.nodes && A.nodes.length ? A.nodes : [{ id: A.nodeId, question: A.question, premise: A.premise || '', level: A.level || 0, roles: A.roles || [] }];

const P = (id, tail) => RUN + '/nodes/' + id + (tail ? '/' + tail : '');
const q = (s) => '"' + String(s == null ? '' : s) + '"';

const CLAIM_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    type: { type: 'string', enum: ['fact', 'inference', 'interpretation', 'value'] },
    locator: { type: 'string' },
    page: { type: 'number' },
    offset: { type: 'number' },
    quote: { type: 'string' },
  },
  required: ['text', 'type', 'locator'],
  additionalProperties: true,
};

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    plan_path: { type: 'string' },
    restated_question: { type: 'string' },
    cards: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          role: { type: 'string' },
          task: { type: 'string' },
          prompt_hint: { type: 'string' },
          provider: { type: 'string' },
          model: { type: 'string' },
        },
        required: ['key', 'role', 'task'],
        additionalProperties: true,
      },
    },
    sub_questions: { type: 'array', items: { type: 'string' } },
    new_paths: { type: 'array', items: { type: 'string' } },
    forks: { type: 'array', items: { type: 'string' } },
  },
  required: ['plan_path', 'cards'],
  additionalProperties: true,
};

const CARD_SCHEMA = {
  type: 'object',
  properties: {
    card_path: { type: 'string' },
    key: { type: 'string' },
    headline: { type: 'string' },
    claims: { type: 'array', items: CLAIM_SCHEMA },
    dead_ends: { type: 'array', items: { type: 'string' } },
    open_questions: { type: 'array', items: { type: 'string' } },
  },
  required: ['card_path', 'key', 'headline'],
  additionalProperties: true,
};

const SYNTH_SCHEMA = {
  type: 'object',
  properties: {
    synthesis_path: { type: 'string' },
    sources_path: { type: 'string' },
    claims: { type: 'array', items: CLAIM_SCHEMA },
    coverage: {
      type: 'object',
      properties: {
        axes: { type: 'array', items: { type: 'string' } },
        gaps: { type: 'array', items: { type: 'string' } },
      },
      required: ['axes', 'gaps'],
      additionalProperties: true,
    },
    one_line: { type: 'string' },
  },
  required: ['synthesis_path', 'sources_path', 'claims', 'coverage'],
  additionalProperties: true,
};

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    review_path: { type: 'string' },
    objections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          target: { type: 'string' },
          kind: { type: 'string', enum: ['evidence', 'logic', 'scope', 'source', 'framing'] },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          text: { type: 'string' },
        },
        required: ['id', 'target', 'kind', 'severity', 'text'],
        additionalProperties: true,
      },
    },
  },
  required: ['review_path', 'objections'],
  additionalProperties: true,
};

const RESPOND_SCHEMA = {
  type: 'object',
  properties: {
    revised_path: { type: 'string' },
    dispositions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          objection: { type: 'string' },
          action: { type: 'string', enum: ['revise', 'rebut', 'concede', 'refer', 'park', 'fork'] },
          note: { type: 'string' },
        },
        required: ['objection', 'action', 'note'],
        additionalProperties: true,
      },
    },
  },
  required: ['revised_path', 'dispositions'],
  additionalProperties: true,
};

const DIVERGE_SCHEMA = {
  type: 'object',
  properties: {
    divergence_path: { type: 'string' },
    absences: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['omission', 'foreclosed'] },
          text: { type: 'string' },
          why: { type: 'string' },
        },
        required: ['kind', 'text', 'why'],
        additionalProperties: true,
      },
    },
    forks: { type: 'array', items: { type: 'string' } },
  },
  required: ['divergence_path', 'absences'],
  additionalProperties: true,
};

const DECIDE_SCHEMA = {
  type: 'object',
  properties: {
    decision_path: { type: 'string' },
    verdict: { type: 'string', enum: ['merge', 'decline', 'split'] },
    summary: { type: 'string' },
    new_nodes: {
      type: 'array',
      items: {
        type: 'object',
        properties: { question: { type: 'string' }, premise: { type: 'string' } },
        required: ['question'],
        additionalProperties: true,
      },
    },
    new_paths: { type: 'array', items: { type: 'string' } },
    forks: { type: 'array', items: { type: 'string' } },
  },
  required: ['decision_path', 'verdict', 'summary'],
  additionalProperties: true,
};

const CLERK_SCHEMA = {
  type: 'object',
  properties: {
    commands: { type: 'array', items: { type: 'string' } },
    failures: { type: 'array', items: { type: 'string' } },
  },
  required: ['commands'],
  additionalProperties: true,
};

// ---------- 七个环节 ----------

async function stagePlan(node, meta) {
  return agent(
    [
      '你是研究节点的计划者（Last Order 角色）。你只做计划，不做研究，不下结论。',
      '',
      '节点：' + node.id + '（第 ' + node.level + ' 层）',
      '节点问题：' + node.question,
      node.premise ? '拆分理由（上位节点为何要开这个节点）：' + node.premise : '',
      '总问题：' + meta.rootQuestion,
      '可用专家档：' + (node.roles || []).map((r) => r.id + '=' + r.focus).join('; ') || '（无，用通用研究角色）',
      '',
      '要做的事：',
      '1. 把节点问题重述到可操作的形式（界定范围、时间、对象、不可混淆的邻近概念）。',
      '2. 拆成 1..' + CARDS + ' 张任务卡。每张卡 = 一个执行者的一次独立出手，必须自带：',
      '   key（kebab-case，2-4 词）、role（从可用专家档里选，或 general）、task（一句话，可独立完成）、',
      '   prompt_hint（给执行者的额外约束：该查什么、别做什么）。',
      '   卡片之间必须分工，不许两张卡问同一件事。',
      '3. 列出该节点覆盖的判据轴（什么算把这个问题研究到了）与已知盲区。',
      '4. 提出 1..4 条待探路径（possible lines of inquiry，之后进 paths 清单）。',
      '5. 若节点问题本身会改变总问题的走向，提出 fork（一句话）。',
      '',
      '写盘：用 write 工具把计划写到 ' + P(node.id, 'plan.md') + '，',
      '含小节：## 问题重述 / ## 判据轴 / ## 任务卡 / ## 已知盲区 / ## 待探路径 / ## 分叉风险。',
      '不要写研究内容，不要引用外部资料。',
      '然后只返回 JSON。',
    ]
      .filter(Boolean)
      .join('\n'),
    { schema: PLAN_SCHEMA, label: node.id + ':plan', phase: 'plan' },
  );
}

async function stageCard(node, plan, card, meta) {
  const provider = card.provider || (node.roles || []).find((r) => r.id === card.role)?.provider || undefined;
  const model = card.model || (node.roles || []).find((r) => r.id === card.role)?.model || undefined;
  const opts = { schema: CARD_SCHEMA, label: node.id + ':' + card.key, phase: 'cards' };
  if (provider) opts.provider = provider;
  if (model) opts.model = model;
  return agent(
    [
      '你是任务卡执行者。你只对这张卡负责，不做节点级结论。',
      '节点问题：' + node.question,
      '计划里的问题重述：' + (plan.restated_question || '(见 ' + plan.plan_path + ')'),
      '你的卡：' + card.key + ' / 角色 ' + card.role,
      '任务：' + card.task,
      card.prompt_hint ? '额外约束：' + card.prompt_hint : '',
      '',
      '规则：',
      '1. 每条论断必须标类型：fact（可核事实）/ inference（由事实推出的结论）/ interpretation（对意义的读解）/ value（价值判断）。',
      '2. fact 必须能核：给出 locator（file#p<page>@<offset>，file 相对运行目录 ' + RUN + '），',
      '   并给出 page、offset、quote（原文片段，逐字，不要改写）。没有原文就不要标 fact，降级为 inference。',
      '3. 允许并鼓励记 dead_ends（查过但没有结果的路），这比假装有效果有价值。',
      '4. 不许编造文献、页码、引文；不许把记忆里的印象写成 fact。',
      '5. 资料不足时在 open_questions 里写清缺什么。',
      '',
      '写盘：' + P(node.id, 'cards/' + card.key + '.md') + '，含 ## 任务 / ## 发现（每条带类型标记） / ## 死路 / ## 缺口。',
      '然后只返回 JSON。',
    ]
      .filter(Boolean)
      .join('\n'),
    opts,
  );
}

async function stageSynth(node, plan, cards, meta) {
  return agent(
    [
      '你是本节点的综合者。把多张卡的发现压成一个可被攻击的结论，不要罗列。',
      '节点问题：' + node.question,
      '计划：' + plan.plan_path,
      '卡片文件：',
      cards.map((c) => '- ' + c.card_path + '（' + c.headline + '）').join('\n'),
      '',
      '规则：',
      '1. 先给结论（3-5 句），再给论证。冲突的卡片不许投票平均，要指出冲突在哪一层（事实层/解释层/价值层）。',
      '2. claims 里每条带 type + locator + page + offset + quote（fact 必填 locator；其他类型 locator 可空字符串）。',
      '3. coverage.axes = 判据轴；coverage.gaps = 覆盖表里空着的单元，必须诚实列出，不许用"篇幅有限"掩盖。',
      '4. 不要引入卡片之外的新事实。',
      '',
      '写盘：',
      '  ' + P(node.id, 'synthesis.md') + '（## 结论 / ## 论证 / ## 覆盖表 / ## 与既有理解的差异）',
      '  ' + P(node.id, 'SOURCES.md') + '，必须是这张表（表头固定，单元格内禁止出现竖线）：',
      '  | # | type | claim | file | page | offset | quote |',
      '  |---|------|-------|------|------|--------|-------|',
      '  | 1 | fact | …… | notes/a.md | 3 | 120 | 原文片段 |',
      '  file 相对 ' + RUN + '，page/offset 与 doc.mjs 的页面模型一致（md 按标题节，txt 按 3000 字符段，pdf 按真实页）。',
      '然后只返回 JSON。',
    ].join('\n'),
    { schema: SYNTH_SCHEMA, label: node.id + ':synthesis', phase: 'synthesis' },
  );
}

async function stageReview(node, synth, round) {
  return agent(
    [
      '你是红队。你的任务不是补充，是找能让这个结论站不住的地方。',
      '节点问题：' + node.question,
      '待攻结论：' + synth.synthesis_path,
      '引文表：' + synth.sources_path,
      '',
      '至少覆盖五个方向，每个方向至少要有一条异议（没异议就说明为什么这个方向不适用）：',
      '  evidence（证据不足/来源可疑）、logic（推理跳跃/概念滑移）、scope（越界概括）、',
      '  source（引文与原文不符、只引二手）、framing（问题的提法本身已经预设了答案）。',
      '',
      '要求：',
      '1. 每条 objection 有 id（o1, o2…）、target（指向具体论断或小节）、kind、severity（blocker/major/minor）、text（说清为什么这条能致命）。',
      '2. 只提能被答复或能被证伪的异议；不许提"还需更多研究"这类空话。',
      '3. 抽检至少 2 条 fact 论断的引文：把 quote 与 locator 指的文件对照一遍；对不上就写成 blocker。',
      '',
      '写盘：' + P(node.id, 'review-' + round + '.md') + '，含 ## 异议清单 / ## 抽检记录 / ## 若我是作者我会先改哪一处。',
      '然后只返回 JSON。',
    ].join('\n'),
    { schema: REVIEW_SCHEMA, label: node.id + ':review-' + round, phase: 'review' },
  );
}

async function stageRespond(node, synth, review, round, missing) {
  return agent(
    [
      '你是原结论的作者。逐条处置红队异议，不许集体糊过去。',
      '原结论：' + synth.synthesis_path,
      '红队报告：' + review.review_path,
      missing && missing.length ? '上一轮漏了这些异议，必须处置：' + missing.join(', ') : '',
      '',
      '每条异议只能选一种处置，并写 note 说明理由：',
      '  revise（改结论）、rebut（顶回去，必须给理由）、concede（承认错了，写清改了哪句）、',
      '  refer（转给别的节点处理，写明哪个节点）、park（暂挂，写明触发条件）、fork（提出分叉，改变问题本身）。',
      '',
      '写盘：' + P(node.id, 'synthesis-' + (round + 1) + '.md') + '（在原结论上改，保留"## 相对于上一版的改动"小节，逐条对应异议 id）。',
      '然后只返回 JSON，dispositions 必须覆盖 review 里全部 objection id。',
    ]
      .filter(Boolean)
      .join('\n'),
    { schema: RESPOND_SCHEMA, label: node.id + ':respond-' + round, phase: 'respond' },
  );
}

async function stageDiverge(node, respond, round) {
  return agent(
    [
      '你是歧路审（症候阅读）。你不问"还缺什么资料"，你问"这个提法本身让什么不可见"。',
      '节点问题：' + node.question,
      '修订后结论：' + respond.revised_path,
      '',
      '缺席分两类，必须分开写：',
      '  omission（疏漏）：该看而没看，补上就能修。',
      '  foreclosed（问题式所不容见）：这个提问方式、这套概念框架，使它结构性地看不见某类答案。',
      '    例：问"大学为什么在12世纪出现"时，"为何此前数百年无人这样组织知识"与"非欧洲同类组织为何没被算作大学"可能被框架本身排除。',
      '',
      '要求：',
      '1. 至少 2 条 foreclosed（少于 2 条要说明为什么这个框架已经足够），omission 若干。',
      '2. 每条写清：是什么缺席、为什么会缺席（机制，不是"作者疏忽"）、若要看见它需要换什么提法。',
      '3. 若某条缺席意味着必须改变问题本身，写进 forks（一句话），它会变成 pending-fork 等用户裁决。',
      '',
      '写盘：' + P(node.id, 'divergence-' + round + '.md') + '，含 ## 疏漏 / ## 问题式所不容见 / ## 需要的提法改动 / ## 分叉建议。',
      '然后只返回 JSON。',
    ].join('\n'),
    { schema: DIVERGE_SCHEMA, label: node.id + ':diverge-' + round, phase: 'diverge' },
  );
}

async function stageDecide(node, parts, meta) {
  return agent(
    [
      '你是节点裁决者。决定这个节点收口成什么，以及是否要开下一层。',
      '节点问题：' + node.question,
      '文件：',
      '  计划 ' + parts.plan.plan_path,
      '  综述 ' + parts.synth.synthesis_path,
      '  修订 ' + parts.respond.revised_path,
      '  红队 ' + parts.review.review_path,
      '  歧路 ' + parts.diverge.divergence_path,
      '',
      '裁决只能是三种：',
      '  merge —— 结论站得住，可以并入总报告；',
      '  decline —— 这个节点在当前提问下没有产出，写清为什么（不要硬凑）；',
      '  split —— 还差一块，必须开子节点，给 1..' + (meta.nodesPerLevel || 2) + ' 个 new_nodes（question + premise）。',
      '',
      '另需给出 new_paths（本轮暴露的新的待探路径）与 forks（若存在会改变总问题走向的分叉）。',
      'summary 用 3 句话写清：结论是什么、它的边界在哪、什么证据能让它翻案。',
      '',
      '写盘：' + P(node.id, 'decision.md') + '，含 ## 裁决 / ## 三句话结论 / ## 开子节点的理由（若 split） / ## 遗留。',
      '若歧路审里有必须改提问方式的项，同时写 ' + P(node.id, 'errata.md') + '（## 勘误，逐条：原说法 → 更正 → 依据）。',
      '然后只返回 JSON。',
    ]
      .filter(Boolean)
      .join('\n'),
    { schema: DECIDE_SCHEMA, label: node.id + ':decide', phase: 'decide' },
  );
}

async function clerk(node, states) {
  const cmds = states.map((s) => 'node ' + q(CLI) + ' node status ' + node.id + ' ' + s + ' --dir ' + q(RUN));
  return agent(
    [
      '你只做记账，不做研究。按顺序执行下面的命令（用 shell 工具），忽略失败的（状态机可能已经推进过）：',
      cmds.map((c, i) => i + 1 + '. ' + c).join('\n'),
      '把实际执行过的命令和报错原文放进 JSON。不要改任何文件。',
    ].join('\n'),
    { schema: CLERK_SCHEMA, label: node.id + ':clerk', phase: 'clerk' },
  );
}

// ---------- 一个节点 = 一条七环节流水线 ----------

async function runNode(node) {
  const meta = { rootQuestion: A.rootQuestion || '', nodesPerLevel: A.nodesPerLevel || 2 };
  const stateLog = [];
  let plan = await stagePlan(node, meta);
  if (!plan) return { id: node.id, ok: false, stage: 'plan', error: 'plan agent failed' };

  const cardSpecs = (plan.cards || []).slice(0, CARDS);
  if (!cardSpecs.length) return { id: node.id, ok: false, stage: 'plan', error: 'plan produced no cards' };

  const cards = (
    await parallel(cardSpecs.map((c) => () => stageCard(node, plan, c, meta).catch(() => null)))
  ).filter(Boolean);
  if (!cards.length) return { id: node.id, ok: false, stage: 'cards', error: 'all cards failed', plan };

  const synth = await stageSynth(node, plan, cards, meta);
  if (!synth) return { id: node.id, ok: false, stage: 'synthesis', error: 'synthesis agent failed', plan, cards };

  // 红队 → 答复：每条异议必须被处置
  const rounds = A.rounds || 1;
  let review = null;
  let respond = null;
  for (let r = 1; r <= Math.max(1, rounds); r++) {
    review = await stageReview(node, synth, r);
    if (!review) break;
    if (!review.objections || !review.objections.length) break;
    const ids = review.objections.map((o) => o.id);
    respond = await stageRespond(node, synth, review, r, []);
    let missing = ids.filter((id) => !(respond && respond.dispositions || []).some((d) => d.objection === id));
    if (missing.length) {
      respond = await stageRespond(node, synth, review, r, missing);
      missing = ids.filter((id) => !(respond && respond.dispositions || []).some((d) => d.objection === id));
      if (missing.length) {
        const cl = await clerk(node, ['responded', 'failed']);
        return { id: node.id, ok: false, stage: 'respond', error: 'unanswered objections: ' + missing.join(','), missing, review, clerk: cl };
      }
    }
    synth.revised = respond.revised_path;
  }
  if (!respond) respond = { revised_path: synth.synthesis_path, dispositions: [] };

  const diverge = await stageDiverge(node, respond, 1);
  const parts = { plan, cards, synth, review, respond, diverge };
  const decide = await stageDecide(node, parts, meta);
  if (!decide) return { id: node.id, ok: false, stage: 'decide', error: 'decide agent failed', parts: { plan: plan.plan_path, synth: synth.synthesis_path } };

  const cl = await clerk(node, ['carding', 'concluded', 'reviewed', 'responded', 'diverged', 'decided']);
  return {
    id: node.id,
    ok: true,
    verdict: decide.verdict,
    summary: decide.summary,
    decision_path: decide.decision_path,
    new_nodes: decide.new_nodes || [],
    new_paths: (decide.new_paths || []).concat(diverge && diverge.forks ? [] : []),
    forks: (decide.forks || []).concat(diverge && diverge.forks ? diverge.forks : []).concat(plan.forks || []),
    plan_paths: plan.new_paths || [],
    absences: diverge ? diverge.absences : [],
    unanswered: [],
    files: {
      plan: plan.plan_path,
      cards: cards.map((c) => c.card_path),
      synthesis: synth.synthesis_path,
      sources: synth.sources_path,
      review: review ? review.review_path : null,
      revised: respond.revised_path,
      divergence: diverge ? diverge.divergence_path : null,
      decision: decide.decision_path,
    },
    coverage_gaps: synth.coverage ? synth.coverage.gaps : [],
    clerk: cl,
  };
}

// pipeline 的首个 stage 收到 (prev, item)；单 stage 时 prev 就是 item，两种都接住。
const results = await pipeline(NODES, (prev, item) => runNode(item || prev));
return { nodes: results.filter(Boolean), failed: results.filter((r) => r && !r.ok).map((r) => ({ id: r.id, stage: r.stage, error: r.error })) };
