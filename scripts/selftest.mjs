#!/usr/bin/env node
/**
 * selftest.mjs — 验收自测。零依赖，跑完整套状态机与引文核查。
 *   node scripts/selftest.mjs
 * 全部通过 exit 0；任一失败 exit 1 并打印失败项。
 * 产物写在系统临时目录，跑完删除，不动用户任何文件。
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadUnits, verifyQuote } from './doc.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MISAKA = join(HERE, 'misaka.mjs');
const DOC = join(HERE, 'doc.mjs');
const RUN = join(tmpdir(), 'misaka-selftest-' + process.pid);

const results = [];
function check(name, cond, extra) {
  results.push({ name, ok: !!cond, extra });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !extra ? '' : '  → ' + JSON.stringify(extra).slice(0, 300)}`);
}
function run(cli, args, opts = {}) {
  try {
    const out = execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout ?? '') + String(e.stderr ?? '') };
  }
}
const G = () => join(RUN, 'graph.json');
const readG = () => JSON.parse(readFileSync(G(), 'utf8'));
const write = (rel, text) => {
  const p = join(RUN, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
};

// ---------- 1. init ----------
let r = run(MISAKA, ['init', '--question', '中世纪大学为何在12世纪欧洲自治城市中出现？', '--depth', '1', '--nodes', '2', '--cards', '2', '--out', RUN]);
check('init 创建运行目录', r.code === 0 && existsSync(G()), r.out.slice(0, 200));
check('init 生成根节点 n1 状态 planned', readG().nodes.n1?.state === 'planned');
check('init 打印调用估算', /estimateAgents/.test(r.out));

// ---------- 2. 状态机 ----------
check('未批准计划时禁止进入 carding', run(MISAKA, ['node', 'status', 'n1', 'carding', '--dir', RUN]).code === 1);
check('非法跃迁 planned→decided 报错', run(MISAKA, ['node', 'status', 'n1', 'decided', '--dir', RUN]).code === 1);
check('plan approve 通过', run(MISAKA, ['plan', 'approve', 'n1', '--dir', RUN]).code === 0);
check('批准后 planned→carding', run(MISAKA, ['node', 'status', 'n1', 'carding', '--dir', RUN]).code === 0);

// ---------- 3. 去重与上限 ----------
const dup = run(MISAKA, ['node', 'add', '--parent', 'n1', '--question', '中世纪大学为何在12世纪欧洲自治城市中出现', '--dir', RUN]);
check('同问 add 被拒且回既有 id', dup.code === 1 && /"existing": "n1"/.test(dup.out), dup.out.slice(0, 160));
const add2 = run(MISAKA, ['node', 'add', '--parent', 'n1', '--question', '行会垄断与大学特许状的关系', '--premise', '拆开制度来源', '--dir', RUN]);
check('新问 add 成功', add2.code === 0 && readG().nodes.n2?.level === 1, add2.out.slice(0, 160));
check('paths 重复指纹被拒', (() => {
  run(MISAKA, ['paths', 'add', '--node', 'n1', '--text', '查城市法原始文本', '--dir', RUN]);
  return run(MISAKA, ['paths', 'add', '--node', 'n1', '--text', '查城市法原始文本', '--dir', RUN]).code === 1;
})());
check('declined 路径缺 reason 被拒', run(MISAKA, ['paths', 'resolve', 'p1', '--as', 'declined', '--dir', RUN]).code === 1);
check('declined 带 reason 通过', run(MISAKA, ['paths', 'resolve', 'p1', '--as', 'declined', '--reason', '本层不追', '--dir', RUN]).code === 0);

// ---------- 4. 层闸门 ----------
check('本层未收口时 reconcile 拒绝', run(MISAKA, ['reconcile', '--level', '0', '--dir', RUN]).code === 1);
run(MISAKA, ['fork', 'add', '--node', 'n1', '--question', '要不要把"大学"换成"知识行会"来问', '--dir', RUN]);
const forkGate = run(MISAKA, ['reconcile', '--level', '0', '--dir', RUN]);
check('pending fork 时 reconcile 拒绝', forkGate.code === 1 && /fork/i.test(forkGate.out), forkGate.out.slice(0, 160));

// ---------- 5. 引文核查 ----------
const QUOTE = '特许状在十二世纪已由城市共同体自行颁授，其效力来自成员的誓约而非教皇的批准。';
write('notes/cities.md', ['# 城市法笔记', '', '## 一、特许状的来源', '', QUOTE, '这一变化常被误读为世俗权力的胜利。', '', '## 二、行会与大学', '', '大学早期的自治章程在形式上沿用了行会的组织结构。'].join('\n'));

const units = loadUnits(join(RUN, 'notes/cities.md')).units;
const page = units.find((u) => u.text.includes(QUOTE));
const off = page ? page.text.indexOf(QUOTE) : -1;
check('doc.mjs 页面模型：md 按标题分节', units.length === 2 && units[0].heading.includes('特许状') && units[1].heading.includes('行会'), units.map((u) => u.heading));
check('doc.mjs verify 命中正确 locator', verifyQuote(join(RUN, 'notes/cities.md'), page.index, off, QUOTE).ok === true);
check('doc.mjs verify 抓出错误偏移', verifyQuote(join(RUN, 'notes/cities.md'), page.index, off + 5, QUOTE).status === 'offset-mismatch');
check('doc.mjs verify 抓出假引文', verifyQuote(join(RUN, 'notes/cities.md'), page.index, 0, '教皇在一一二三年颁布了大学特许状').status === 'not-found');
const vcli = run(DOC, ['verify', join(RUN, 'notes/cities.md'), '--page', String(page.index), '--offset', String(off), '--quote', QUOTE]);
check('doc.mjs CLI 正确引文 exit 0', vcli.code === 0);
const vbad = run(DOC, ['verify', join(RUN, 'notes/cities.md'), '--page', String(page.index), '--offset', '0', '--quote', '教皇在一一二三年颁布了大学特许状']);
check('doc.mjs CLI 假引文 exit 2', vbad.code === 2, vbad.out.slice(0, 120));

// ---------- 6. 装配产物 + 全链路 verify ----------
const SRC = (rows) => ['| # | type | claim | file | page | offset | quote |', '|---|------|-------|------|------|--------|-------|', ...rows].join('\n');
write('nodes/n1/synthesis.md', '# 结论\n\n城市自治是制度前提。\n');
write('nodes/n1/review-1.md', '# 异议清单\n\n- o1 [evidence/blocker] 单一城市样本不足。\n');
write('nodes/n1/divergence-1.md', '# 疏漏\n\n- 缺拜占庭材料。\n\n# 问题式所不容见\n\n- foreclosed：问"为何出现"时，"为何没有在伊斯兰世界以同一形式出现"被排除。\n');
write('nodes/n1/decision.md', '# 裁决\n\nmerge\n');
write('nodes/n1/SOURCES.md', SRC([
  `| 1 | fact | 特许状由城市共同体颁授 | notes/cities.md | ${page.index} | ${off} | ${QUOTE} |`,
  '| 2 | fact | 一二一五年教皇颁布大学特许状 | notes/cities.md | 1 | 0 | 教皇在一二一五年颁布了大学特许状 |',
  '| 3 | inference | 大学沿用了城市的司法豁免逻辑 | | | | |',
]));
write('nodes/n2/synthesis.md', '# 结论\n\n行会结构提供组织形式。\n');
write('nodes/n2/SOURCES.md', SRC(['| 1 | inference | 行会结构提供组织形式 | | | | |']));

const vfail = run(MISAKA, ['verify', '--dir', RUN]);
check('假引文让 verify exit 2 且定位到行', vfail.code === 2 && /"row": 2/.test(vfail.out), vfail.out.slice(0, 300));

write('nodes/n1/SOURCES.md', SRC([
  `| 1 | fact | 特许状由城市共同体颁授 | notes/cities.md | ${page.index} | ${off} | ${QUOTE} |`,
  '| 2 | inference | 大学沿用了城市的司法豁免逻辑 | | | | |',
]));
const vok = run(MISAKA, ['verify', '--dir', RUN]);
check('修正后 verify 全通过', vok.code === 0, vok.out.slice(0, 200));

// ---------- 7. ingest：workflow 返回值落盘 ----------
const wf = join(RUN, '_wf-result.json');
writeFileSync(
  wf,
  JSON.stringify({
    nodes: [
      {
        id: 'n1',
        ok: true,
        verdict: 'split',
        plan_paths: ['ingest 带回来的待探路径 A'],
        new_paths: ['ingest 带回来的待探路径 B'],
        forks: ['ingest 带回来的分叉：要不要换问法'],
        new_nodes: [{ question: readG().nodes.n2.question, premise: '这条问题图上已有，应被拦' }],
      },
    ],
  }),
  'utf8',
);
const ing1 = run(MISAKA, ['ingest', wf, '--dir', RUN]);
check('ingest 落盘 paths/forks 并拦重复子节点', ing1.code === 0 && /"p1[0-9]*"|"p[0-9]+"/.test(ing1.out) && /same question as n2/.test(ing1.out) && Object.keys(readG().nodes).length === 2, ing1.out.slice(0, 400));
const ing2 = run(MISAKA, ['ingest', wf, '--dir', RUN]);
check('ingest 幂等（二次全 dedupe）', ing2.code === 0 && /"added": \[\]/.test(ing2.out) && /"deduped": [1-9]/.test(ing2.out), ing2.out.slice(0, 300));

// ---------- 8. 收口 ----------
for (const s of ['concluded', 'reviewed', 'responded', 'diverged', 'decided']) {
  run(MISAKA, ['node', 'status', 'n1', s, '--dir', RUN]);
}
run(MISAKA, ['node', 'status', 'n1', 'merged', '--dir', RUN]);
run(MISAKA, ['node', 'status', 'n2', 'declined', '--reason', '未展开', '--dir', RUN]);
const forkPending = readG().pendingForks.filter((f) => f.status === 'pending');
for (const fp of forkPending) run(MISAKA, ['fork', 'resolve', fp.id, '--as', 'reject', '--note', '保持原提法', '--dir', RUN]);
const rec = run(MISAKA, ['reconcile', '--level', '0', '--dir', RUN]);
check('收口后 reconcile 通过并给下一层清单', rec.code === 0, rec.out.slice(0, 240));
const vSkip = run(MISAKA, ['verify', '--dir', RUN]);
check('declined 节点不欠引文（verify 跳过而非报缺失）', vSkip.code === 0 && /"state": "declined"/.test(vSkip.out), vSkip.out.slice(0, 300));

const rep = run(MISAKA, ['report', '--dir', RUN]);
const finalFile = join(RUN, 'final', readG().slug + '-final.md');
check('report 生成 final 成稿', rep.code === 0 && existsSync(finalFile), rep.out.slice(0, 200));
if (existsSync(finalFile)) {
  const t = readFileSync(finalFile, 'utf8');
  check('成稿含摘要/章节/图谱/四个附录/参考文献', ['## 摘要', '## 章节', '## 图谱', '## 附录 A', '## 附录 B', '## 附录 C', '## 附录 D', '## 参考文献'].every((h) => t.includes(h)));
  check('附录 C 记录未采纳路径及理由', /本层不追/.test(t));
}
const st = run(MISAKA, ['status', '--json', '--dir', RUN]);
check('status --json 可解析', (() => { try { const o = JSON.parse(st.out); return o.nodes === 2; } catch { return false; } })(), st.out.slice(0, 120));

// ---------- 8. 中断续跑 ----------
const stJson = JSON.parse(st.out);
check('续跑清单为空（全部终态）', stJson.resumable.length === 0, stJson.resumable);

// ---------- cleanup ----------
const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) console.log('FAILED: ' + failed.map((f) => f.name).join(' | '));
if (!failed.length) rmSync(RUN, { recursive: true, force: true });
else console.log('产物保留在 ' + RUN);
process.exit(failed.length ? 1 : 0);
