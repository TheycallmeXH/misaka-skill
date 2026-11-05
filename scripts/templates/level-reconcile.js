/**
 * level-reconcile.js — 层间调和（workflow 脚本模板）
 *
 * args:
 *   {
 *     cli: "…/misaka.mjs",
 *     runDir: "…/research/<slug>",
 *     level: 0,
 *     nodes: [{ id:"n1", verdict:"merge", decision_path:"…", summary:"…" }, …]
 *   }
 *
 * 只做四件事：同问合并 / 殊途汇合 / 关系记录 / 下一层待开清单。
 * 不擅自开节点（开节点是编排者的决定），但可以用 CLI 记 relation 与 path。
 */

const A = args;
const CLI = A.cli;
const RUN = A.runDir;
const LEVEL = A.level || 0;
const q = (s) => '"' + String(s == null ? '' : s) + '"';

const SCHEMA = {
  type: 'object',
  properties: {
    doc_path: { type: 'string' },
    merge: {
      type: 'array',
      items: {
        type: 'object',
        properties: { keep: { type: 'string' }, absorb: { type: 'string' }, why: { type: 'string' } },
        required: ['keep', 'absorb', 'why'],
        additionalProperties: true,
      },
    },
    join: {
      type: 'array',
      items: {
        type: 'object',
        properties: { a: { type: 'string' }, b: { type: 'string' }, point: { type: 'string' } },
        required: ['a', 'b', 'point'],
        additionalProperties: true,
      },
    },
    relations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          a: { type: 'string' },
          b: { type: 'string' },
          type: { type: 'string', enum: ['convergence', 'divergence', 'resonance', 'appropriation', 'displacement'] },
          note: { type: 'string' },
        },
        required: ['a', 'b', 'type', 'note'],
        additionalProperties: true,
      },
    },
    open: { type: 'array', items: { type: 'string' } },
    close: { type: 'array', items: { type: 'string' } },
    commands: { type: 'array', items: { type: 'string' } },
  },
  required: ['doc_path', 'open'],
  additionalProperties: true,
};

const nodes = A.nodes || [];
const out = await agent(
  [
    '你是层间调和者。这一层已经收口，你要处理的是节点之间的关系，不是内容本身。',
    '总问题：' + (A.rootQuestion || '(见 run)'),
    '本层（L' + LEVEL + '）节点与裁决：',
    nodes.map((n) => '- ' + n.id + ' [' + (n.verdict || '?') + '] ' + n.summary + '\n  决策文件：' + n.decision_path).join('\n'),
    '',
    '四件事：',
    '1. merge：两个节点其实在答同一个问题 → 指出留哪个、并掉哪个、为什么。合并只记关系，不删文件。',
    '2. join：两条独立路线在中途汇到同一结论（殊途汇合）→ 指出汇合点在哪个论断上。',
    '3. relations：给每对相关节点定一种关系：',
    '   convergence 收敛于同一结论 / divergence 真正互相矛盾 / resonance 说法不同但互相加强 /',
    '   appropriation 一方把另一方的材料改了用途 / displacement 一方的结论把另一方的追问挪到了别的层面。',
    '   divergence 必须写清矛盾在哪一层（事实/解释/价值）。',
    '4. open：下一层还值得开的问题（一句话一个，最多 4 条）；close：明确不再追的线（写理由）。',
    '',
    '用 CLI 把关系与路径记下来（不要手改 graph.json）：',
    '  node ' + q(CLI) + ' relation add --a n1 --b n2 --type convergence --note "…" --dir ' + q(RUN),
    '  node ' + q(CLI) + ' paths add --node n1 --text "…" --dir ' + q(RUN),
    '把实际执行的命令写进 commands。',
    '',
    '写盘：' + RUN + '/nodes/_reconcile-L' + LEVEL + '.md',
    '含 ## 合并 / ## 汇合 / ## 关系表 / ## 下一层待开 / ## 明确关闭。',
    '然后只返回 JSON。',
  ].join('\n'),
  { schema: SCHEMA, label: 'reconcile:L' + LEVEL, phase: 'reconcile' },
);

return out;
