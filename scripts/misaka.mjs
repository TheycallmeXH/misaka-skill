#!/usr/bin/env node
/**
 * misaka.mjs — research DAG state machine + artifact verifier + report assembler.
 * Zero dependencies. Node >= 20. Single source of truth: <run>/graph.json
 *
 * Usage:
 *   node misaka.mjs init --question "Q" [--depth 1] [--nodes 2] [--cards 3]
 *        [--rounds 1] [--revisions 1] [--max-nodes 24] [--approve plan|auto] [--out DIR]
 *   node misaka.mjs node add --parent n1 --question "Q" [--premise "why split"] [--level N]
 *   node misaka.mjs node status <id> <state> [--reason "…"]
 *   node misaka.mjs node list [--json]
 *   node misaka.mjs plan approve <id> [--by user]
 *   node misaka.mjs paths list [--json]
 *   node misaka.mjs paths add --node <id> --text "possible line of inquiry"
 *   node misaka.mjs paths resolve <pid> --as opened|covered|declined [--reason "…"]
 *   node misaka.mjs fork list|add --node <id> --question "…" |resolve <fid> --as accept|reject|rewrite --note "…"
 *   node misaka.mjs relation add --a n1 --b n2 --type convergence|divergence|resonance|appropriation|displacement --note "…"
 *   node misaka.mjs ingest <result.json|-> | ingest --json "<workflow return value>"   （把 workflow 的返回值落成 paths/forks/子节点）
 *   node misaka.mjs reconcile --level N
 *   node misaka.mjs verify [--node <id>] [--json]
 *   node misaka.mjs report
 *   node misaka.mjs status [--json]
 *
 * Exit codes: 0 ok, 1 usage/state error, 2 verification failure.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { verifyQuote } from './doc.mjs';

const SCHEMA = 'rdag.graph/1';
const ORDER = ['planned', 'carding', 'concluded', 'reviewed', 'responded', 'diverged', 'decided', 'merged'];
const VERDICTS = ['merge', 'decline', 'split'];
const REL_TYPES = ['convergence', 'divergence', 'resonance', 'appropriation', 'displacement'];
const CLAIM_TYPES = ['fact', 'inference', 'interpretation', 'value'];

const die = (msg, code = 1) => {
  console.error(`error: ${msg}`);
  process.exit(code);
};
const nowIso = () => new Date().toISOString();
const fp = (s) =>
  createHash('sha1')
    .update(
      String(s)
        .toLowerCase()
        .replace(/[\s]+/g, '')
        .replace(/[，。；：、？！,.;:?!'"“”‘’（）()《》<>\-—_/\\|]+/g, ''),
    )
    .digest('hex')
    .slice(0, 12);

function parseArgs(argv) {
  const flags = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) flags[k] = true;
      else {
        flags[k] = next;
        i++;
      }
    } else pos.push(a);
  }
  return { cmd: pos[0], sub: pos[1], rest: pos.slice(2), flags };
}

function graphPath(runDir) {
  return join(runDir, 'graph.json');
}
function runPath(runDir) {
  return join(runDir, 'run.json');
}
function load(runDir) {
  const p = graphPath(runDir);
  if (!existsSync(p)) die(`no graph.json under ${runDir} (run init first)`);
  const g = JSON.parse(readFileSync(p, 'utf8'));
  if (g.schema !== SCHEMA) die(`graph schema mismatch: ${g.schema}`);
  return g;
}
function save(runDir, g) {
  g.updated = nowIso();
  writeFileSync(graphPath(runDir), JSON.stringify(g, null, 2));
}
function nodeDir(runDir, id) {
  return join(runDir, 'nodes', id);
}
function ensureDirs(runDir, id) {
  mkdirSync(join(nodeDir(runDir, id), 'cards'), { recursive: true });
}

function nextState(cur) {
  const i = ORDER.indexOf(cur);
  return i >= 0 && i < ORDER.length - 1 ? ORDER[i + 1] : null;
}

function assertTransition(id, from, to) {
  if (to === 'failed' || to === 'declined') return;
  if (from === to) die(`node ${id} already ${to}`);
  const n = nextState(from);
  if (n !== to) {
    const allowed = [n, 'failed', 'declined'].filter(Boolean).join(' | ');
    die(`illegal transition ${from} -> ${to} on ${id}; allowed: ${allowed}`);
  }
}

function findNodeByFp(g, question) {
  const f = fp(question);
  return Object.values(g.nodes).find((n) => n.questionFp === f) || null;
}

function relFiles(runDir, id) {
  const d = nodeDir(runDir, id);
  if (!existsSync(d)) return [];
  const out = [];
  const walk = (p) => {
    for (const name of readdirSync(p)) {
      const full = join(p, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(full);
    }
  };
  walk(d);
  return out;
}

/** Parse the SOURCES.md citation table. Columns: # | type | claim | file | page | offset | quote */
function parseSources(file) {
  const rows = [];
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim().startsWith('|')) continue;
    if (/^\|\s*-{2,}/.test(line) || /\|\s*#\s*\|/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 7) continue;
    const [num, type, claim, f, page, offset] = cells;
    const quote = cells.slice(6).join(' | ');
    if (!/^\d+$/.test(num)) continue;
    rows.push({ num: Number(num), type, claim, file: f, page: Number(page), offset: Number(offset), quote });
  }
  return rows;
}

function cmdInit(runDir, f) {
  const question = f.question;
  if (!question || question === true) die('init requires --question "…"');
  if (existsSync(graphPath(runDir)) && !f.force) die(`refusing to overwrite existing run at ${runDir} (pass --force)`);
  for (const d of ['nodes', 'roles', 'final']) mkdirSync(join(runDir, d), { recursive: true });
  const params = {
    depth: Number(f.depth ?? 1),
    nodesPerLevel: Number(f.nodes ?? 2),
    cardsPerNode: Number(f.cards ?? 3),
    reviewRounds: Number(f.rounds ?? 1),
    revisions: Number(f.revisions ?? 1),
    maxNodes: Number(f['max-nodes'] ?? 24),
    approve: f.approve === 'auto' ? 'auto' : 'plan',
  };
  const slug = f.slug && f.slug !== true ? String(f.slug) : `misaka-${fp(question).slice(0, 8)}`;
  const rootId = 'n1';
  const g = {
    schema: SCHEMA,
    slug,
    question,
    created: nowIso(),
    updated: nowIso(),
    level: 0,
    params,
    nodes: {
      [rootId]: {
        id: rootId,
        level: 0,
        parent: null,
        question,
        questionFp: fp(question),
        premise: 'root',
        state: 'planned',
        reviewer: 'sister',
        cards: 0,
        decision: null,
        verdict: null,
        failReason: null,
        created: nowIso(),
        updated: nowIso(),
      },
    },
    paths: [],
    relations: [],
    pendingForks: [],
    approvals: [],
    usage: { agents: 0, cards: 0, ally: {} },
  };
  ensureDirs(runDir, rootId);
  writeFileSync(
    runPath(runDir),
    JSON.stringify(
      {
        slug,
        question,
        out: runDir,
        params,
        estimate: {
          nodesMax: params.maxNodes,
          cardsPerNode: params.cardsPerNode,
          agentsPerNode: 7,
          note: 'agents ≈ nodes × (2 + cardsPerNode + 5) + level reconciles',
        },
        created: nowIso(),
      },
      null,
      2,
    ),
  );
  save(runDir, g);
  let planned = 0;
  for (let k = 0; k <= params.depth; k++) planned += Math.pow(params.nodesPerLevel, k);
  const est = Math.min(planned, params.maxNodes) * (2 + params.cardsPerNode + 5);
  console.log(
    JSON.stringify(
      { ok: true, run: runDir, slug, root: rootId, params, estimateAgents: est, next: `node misaka.mjs plan approve ${rootId}` },
      null,
      2,
    ),
  );
}

function needId(g, id) {
  const n = g.nodes[id];
  if (!n) die(`unknown node: ${id}`);
  return n;
}

function addNodeRecord(g, runDir, parentId, question, premise) {
  const parent = g.nodes[parentId];
  if (!parent) return { ok: false, reason: `unknown parent ${parentId}` };
  if (Object.keys(g.nodes).length >= g.params.maxNodes) return { ok: false, reason: `node cap reached (${g.params.maxNodes})` };
  const dup = findNodeByFp(g, question);
  if (dup) return { ok: false, deduped: true, id: dup.id, reason: `same question as ${dup.id}` };
  const level = parent.level + 1;
  if (level > g.params.depth) return { ok: false, reason: `level ${level} exceeds depth ${g.params.depth}` };
  const id = `n${Object.keys(g.nodes).length + 1}`;
  g.nodes[id] = {
    id,
    level,
    parent: parentId,
    question,
    questionFp: fp(question),
    premise: premise || '',
    state: 'planned',
    reviewer: 'sister',
    cards: 0,
    decision: null,
    verdict: null,
    failReason: null,
    created: nowIso(),
    updated: nowIso(),
  };
  ensureDirs(runDir, id);
  return { ok: true, id, level };
}

function cmdNode(runDir, sub, rest, f) {
  const g = load(runDir);
  if (sub === 'add') {
    const parentId = f.parent;
    const question = f.question;
    if (!parentId || parentId === true) die('node add requires --parent <id>');
    if (!question || question === true) die('node add requires --question "…"');
    needId(g, parentId);
    const res = addNodeRecord(g, runDir, parentId, question, f.premise && f.premise !== true ? f.premise : '');
    if (!res.ok) {
      if (res.deduped) {
        console.log(JSON.stringify({ ok: false, deduped: true, existing: res.id, question: g.nodes[res.id].question, level: g.nodes[res.id].level, state: g.nodes[res.id].state }, null, 2));
      } else {
        console.error(`error: ${res.reason}`);
      }
      process.exit(1);
    }
    save(runDir, g);
    console.log(JSON.stringify({ ok: true, id: res.id, dir: nodeDir(runDir, res.id), level: res.level }, null, 2));
    return;
  }
  if (sub === 'status') {
    const id = rest[0];
    const to = rest[1];
    if (!id || !to) die('node status <id> <state>');
    const node = needId(g, id);
    const target = to === 'merged' || to === 'declined' || to === 'failed' ? to : to;
    if (target !== 'failed' && target !== 'declined' && !ORDER.includes(target)) die(`unknown state ${target}`);
    assertTransition(id, node.state, target);
    node.state = target;
    node.updated = nowIso();
    if (target === 'carding' && g.params.approve === 'plan') {
      const ok = g.approvals.some((a) => a.id === id && a.what === 'plan');
      if (!ok) {
        node.state = 'planned';
        die(`node ${id} needs an approved plan first: node misaka.mjs plan approve ${id}`);
      }
    }
    if (target === 'failed') node.failReason = f.reason && f.reason !== true ? f.reason : 'unspecified';
    if (target === 'merged' || target === 'declined') node.verdict = target;
    save(runDir, g);
    console.log(JSON.stringify({ ok: true, id, state: node.state, next: nextState(node.state) }, null, 2));
    return;
  }
  if (sub === 'list') {
    const rows = Object.values(g.nodes).map((n) => ({ id: n.id, level: n.level, parent: n.parent, state: n.state, verdict: n.verdict, question: n.question }));
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  die(`node subcommand: add | status | list`);
}

function cmdPlan(runDir, sub, rest, f) {
  const g = load(runDir);
  if (sub !== 'approve') die('plan approve <id>');
  const id = rest[0];
  if (!id) die('plan approve <id>');
  const node = needId(g, id);
  if (g.approvals.some((a) => a.id === id && a.what === 'plan')) die(`plan for ${id} already approved`);
  g.approvals.push({ id, what: 'plan', by: f.by && f.by !== true ? f.by : 'user', at: nowIso() });
  save(runDir, g);
  console.log(JSON.stringify({ ok: true, id, approved: 'plan', state: node.state }, null, 2));
}

function cmdPaths(runDir, sub, rest, f) {
  const g = load(runDir);
  if (sub === 'list' || sub === undefined) {
    const rows = g.paths.map((p) => ({ id: p.id, node: p.node, status: p.status, text: p.text, reason: p.reason }));
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (sub === 'add') {
    const node = f.node;
    const text = f.text;
    if (!node || node === true) die('paths add requires --node <id>');
    if (!text || text === true) die('paths add requires --text "…"');
    needId(g, node);
    const fingerprint = fp(text);
    const dup = g.paths.find((p) => p.fp === fingerprint);
    if (dup) {
      console.log(JSON.stringify({ ok: false, deduped: true, existing: dup.id, status: dup.status, text: dup.text }, null, 2));
      process.exit(1);
    }
    const id = `p${g.paths.length + 1}`;
    g.paths.push({ id, node, text, fp: fingerprint, status: 'open', reason: null, created: nowIso() });
    save(runDir, g);
    console.log(JSON.stringify({ ok: true, id, status: 'open' }, null, 2));
    return;
  }
  if (sub === 'resolve') {
    const id = rest[0];
    const as = f.as;
    if (!id) die('paths resolve <pid> --as opened|covered|declined');
    if (!['opened', 'covered', 'declined'].includes(as)) die('--as must be opened | covered | declined');
    const p = g.paths.find((x) => x.id === id);
    if (!p) die(`unknown path: ${id}`);
    if (as === 'declined' && (!f.reason || f.reason === true)) die('declining a path requires --reason "…" (the report lists declined paths with reasons)');
    p.status = as;
    p.reason = f.reason && f.reason !== true ? f.reason : null;
    p.updated = nowIso();
    save(runDir, g);
    console.log(JSON.stringify({ ok: true, id, status: as }, null, 2));
    return;
  }
  die('paths subcommand: list | add | resolve');
}

function cmdFork(runDir, sub, rest, f) {
  const g = load(runDir);
  if (sub === 'list' || sub === undefined) {
    console.log(JSON.stringify(g.pendingForks, null, 2));
    return;
  }
  if (sub === 'add') {
    const node = f.node;
    const q = f.question;
    if (!node || node === true) die('fork add requires --node <id>');
    if (!q || q === true) die('fork add requires --question "…"');
    needId(g, node);
    const hash = fp(q);
    const dup = g.pendingForks.find((x) => x.fp === hash);
    if (dup) {
      console.log(JSON.stringify({ ok: false, deduped: true, existing: dup.id, question: dup.question }, null, 2));
      process.exit(1);
    }
    const id = `f${g.pendingForks.length + 1}-${Date.now().toString(36)}`;
    g.pendingForks.push({ id, node, question: q, fp: hash, status: 'pending', created: nowIso() });
    save(runDir, g);
    console.log(JSON.stringify({ ok: true, id }, null, 2));
    return;
  }
  if (sub === 'resolve') {
    const id = rest[0];
    if (!id) die('fork resolve <fid> --as accept|reject|rewrite --note "…"');
    const fk = g.pendingForks.find((x) => x.id === id);
    if (!fk) die(`unknown fork: ${id}`);
    const as = f.as;
    if (!['accept', 'reject', 'rewrite'].includes(as)) die('--as must be accept | reject | rewrite');
    if (!f.note || f.note === true) die('fork resolution requires --note "…"');
    fk.status = as;
    fk.note = f.note;
    fk.resolvedAt = nowIso();
    save(runDir, g);
    console.log(JSON.stringify({ ok: true, id, status: as }, null, 2));
    return;
  }
  die('fork subcommand: list | add | resolve');
}

function cmdRelation(runDir, sub, rest, f) {
  const g = load(runDir);
  if (sub !== 'add') die('relation add --a n1 --b n2 --type T --note "…"');
  const a = f.a;
  const b = f.b;
  const type = f.type;
  if (!a || !b || !type) die('relation add requires --a --b --type');
  if (!REL_TYPES.includes(type)) die(`--type must be one of ${REL_TYPES.join(' | ')}`);
  needId(g, a);
  needId(g, b);
  if (a === b) die('self-relation rejected');
  const key = [a, b].sort().join('~') + '~' + type;
  if (g.relations.some((r) => [r.a, r.b].sort().join('~') + '~' + r.type === key)) die('relation already recorded');
  g.relations.push({ a, b, type, note: f.note && f.note !== true ? f.note : '', created: nowIso() });
  save(runDir, g);
  console.log(JSON.stringify({ ok: true }, null, 2));
}

function cmdIngest(runDir, rest, f, sub) {
  const g = load(runDir);
  let raw;
  const src = rest[0] || sub;
  if (src && src !== true) raw = readFileSync(resolve(src), 'utf8');
  else if (f.json && f.json !== true) raw = String(f.json);
  else die('ingest <result.json> | ingest --json "<workflow return value>"');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    die(`ingest: not JSON (${e.message})`);
  }
  const items = Array.isArray(data) ? data : data.nodes ? data.nodes : [data];
  const out = { ok: true, nodes: [], paths: { added: [], deduped: 0 }, forks: { added: [], deduped: 0 }, children: { added: [], skipped: [] } };

  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const id = it.id;
    if (!id || !g.nodes[id]) {
      out.nodes.push({ id: id || null, skipped: 'unknown node' });
      continue;
    }
    out.nodes.push({ id, ok: it.ok !== false, verdict: it.verdict || null, stage: it.stage || null });

    const addPath = (text) => {
      const t = String(text == null ? '' : text).trim();
      if (!t) return;
      const hash = fp(t);
      if (g.paths.some((p) => p.fp === hash)) {
        out.paths.deduped++;
        return;
      }
      const pid = `p${g.paths.length + 1}`;
      g.paths.push({ id: pid, node: id, text: t, fp: hash, status: 'open', reason: null, created: nowIso() });
      out.paths.added.push(pid);
    };
    (it.plan_paths || []).forEach(addPath);
    (it.new_paths || []).forEach(addPath);

    for (const q of it.forks || []) {
      const t = String(q == null ? '' : q).trim();
      if (!t) continue;
      const hash = fp(t);
      if (g.pendingForks.some((x) => x.fp === hash)) {
        out.forks.deduped++;
        continue;
      }
      const fid = `f${g.pendingForks.length + 1}-${Date.now().toString(36)}`;
      g.pendingForks.push({ id: fid, node: id, question: t, fp: hash, status: 'pending', created: nowIso() });
      out.forks.added.push(fid);
    }

    for (const nn of it.new_nodes || []) {
      if (!nn || !nn.question) continue;
      const res = addNodeRecord(g, runDir, id, String(nn.question).trim(), nn.premise ? String(nn.premise) : '');
      if (res.ok) out.children.added.push({ id: res.id, parent: id, level: res.level });
      else out.children.skipped.push({ parent: id, why: res.reason || 'deduped', existing: res.id || null, question: String(nn.question).slice(0, 80) });
    }
  }

  save(runDir, g);
  out.next =
    out.forks.added.length || g.pendingForks.some((x) => x.status === 'pending')
      ? 'ask the user to resolve pending forks, then reconcile'
      : out.children.added.length
        ? 'run node-run for the new level-1 nodes'
        : 'reconcile --level <current>';
  console.log(JSON.stringify(out, null, 2));
}

function cmdReconcile(runDir, f) {
  const g = load(runDir);
  const level = Number(f.level ?? g.level);
  const pending = g.pendingForks.filter((x) => x.status === 'pending');
  if (pending.length) die(`unresolved forks block the next level: ${pending.map((p) => p.id).join(', ')}`);
  const atLevel = Object.values(g.nodes).filter((n) => n.level === level);
  const unfinished = atLevel.filter((n) => !['merged', 'declined', 'failed'].includes(n.state));
  if (unfinished.length) die(`level ${level} not terminal: ${unfinished.map((n) => `${n.id}:${n.state}`).join(', ')}`);
  const openPaths = g.paths.filter((p) => p.status === 'open');
  const failed = atLevel.filter((n) => n.state === 'failed');
  const out = {
    ok: true,
    level,
    nextLevel: level + 1,
    terminal: atLevel.map((n) => ({ id: n.id, verdict: n.verdict ?? n.state })),
    failed: failed.map((n) => ({ id: n.id, reason: n.failReason })),
    openPaths: openPaths.map((p) => ({ id: p.id, node: p.node, text: p.text })),
    declinedPaths: g.paths.filter((p) => p.status === 'declined').map((p) => ({ id: p.id, text: p.text, reason: p.reason })),
    relations: g.relations.length,
    canDescend: level < g.params.depth,
    nextAction:
      level + 1 > g.params.depth
        ? 'report'
        : openPaths.length
          ? 'open next-level nodes from openPaths (node add), then run node-run'
          : 'no open paths: either close with report or add new paths first',
  };
  g.level = level + 1;
  save(runDir, g);
  console.log(JSON.stringify(out, null, 2));
}

function cmdVerify(runDir, f) {
  const g = load(runDir);
  const ids = f.node && f.node !== true ? [f.node] : Object.keys(g.nodes);
  const problems = [];
  const summary = { checked: 0, ok: 0, bad: 0, untyped: 0, files: [] };
  for (const id of ids) {
    const d = nodeDir(runDir, id);
    if (!existsSync(d)) continue;
    const node = g.nodes[id];
    const st = node && node.state;
    // A node that never ran (planned/declined) owes no citations; silence is correct, not a pass.
    if (st === 'planned' || st === 'declined') {
      summary.skipped = summary.skipped || [];
      summary.skipped.push({ node: id, state: st, detail: 'never ran — no citation obligation' });
      continue;
    }
    const src = join(d, 'SOURCES.md');
    if (!existsSync(src)) {
      problems.push({ node: id, file: 'SOURCES.md', status: 'missing', detail: 'no citation table' });
      continue;
    }
    const rows = parseSources(src);
    if (!rows.length) problems.push({ node: id, file: 'SOURCES.md', status: 'empty', detail: 'no parsable rows' });
    for (const r of rows) {
      summary.checked++;
      if (!CLAIM_TYPES.includes(r.type)) summary.untyped++;
      if (r.type === 'fact') {
        const abs = resolve(runDir, r.file);
        const res = verifyQuote(abs, r.page, r.offset, r.quote);
        if (res.ok) summary.ok++;
        else {
          summary.bad++;
          problems.push({ node: id, file: 'SOURCES.md', row: r.num, claim: r.claim, locator: `${r.file}#p${r.page}@${r.offset}`, status: res.status, detail: res.detail ?? '' });
        }
      } else {
        summary.ok++; // inference/interpretation/value carry no external locator obligation
      }
    }
    summary.files.push({ node: id, rows: rows.length });
  }
  const result = { ok: problems.length === 0, summary, problems };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(2);
}

function tree(g, root = 'n1', prefix = '') {
  const kids = Object.values(g.nodes).filter((n) => n.parent === root);
  const lines = [];
  kids.forEach((n, i) => {
    const last = i === kids.length - 1;
    lines.push(`${prefix}${last ? '└─' : '├─'} ${n.id} [${n.state}${n.verdict ? '/' + n.verdict : ''}] ${n.question}`);
    lines.push(...tree(g, n.id, prefix + (last ? '   ' : '│  ')));
  });
  return lines;
}

function cmdReport(runDir) {
  const g = load(runDir);
  const root = g.nodes.n1;
  const nodes = Object.values(g.nodes);
  const L = [];
  L.push(`# ${g.slug} — 研究报告`);
  L.push('');
  L.push(`> 问题：${g.question}`);
  L.push(`> 生成：${nowIso()}　深度：${g.params.depth}　节点：${nodes.length}　路径：${g.paths.length}`);
  L.push('');
  L.push('## 摘要');
  L.push('');
  L.push('<!-- TODO(agent): 一段话说清结论、边界与置信度；不要复述章节 -->');
  L.push('');
  L.push('## 章节');
  L.push('');
  let i = 0;
  for (const n of nodes) {
    i++;
    const d = `nodes/${n.id}`;
    L.push(`### ${i}. ${n.question}`);
    L.push('');
    L.push(`<!-- TODO(agent): 由 ${d}/synthesis*.md 压缩成 3-6 段；结论先写，论证后写 -->`);
    L.push('');
    L.push(`- 节点：\`${n.id}\`　状态：${n.state}　裁决：${n.verdict ?? '-'}`);
    L.push(`- 综述：${d}/synthesis.md${existsSync(join(runDir, d, 'synthesis-2.md')) ? `、${d}/synthesis-2.md` : ''}`);
    L.push(`- 红队：${d}/review-1.md　歧路：${d}/divergence-1.md　决策：${d}/decision.md`);
    L.push('');
  }
  L.push('## 图谱');
  L.push('');
  L.push('```');
  L.push(`${root.id} ${root.question}`);
  L.push(...tree(g));
  L.push('```');
  L.push('');
  L.push('## 附录 A　代价与用量');
  L.push('');
  L.push(`- 节点数：${nodes.length} / 上限 ${g.params.maxNodes}`);
  L.push(`- 调用估算：${nodes.length} × (2 + ${g.params.cardsPerNode} + 5)`);
  L.push(`- ally 用量：${JSON.stringify(g.usage.ally)}`);
  L.push('');
  L.push('## 附录 B　勘误');
  L.push('');
  const errata = nodes.filter((n) => existsSync(join(runDir, 'nodes', n.id, 'errata.md')));
  L.push(errata.length ? errata.map((n) => `- ${n.id}：见 \`nodes/${n.id}/errata.md\``).join('\n') : '- 无');
  L.push('');
  L.push('## 附录 C　未采纳路径');
  L.push('');
  const declined = g.paths.filter((p) => p.status === 'declined');
  const stillOpen = g.paths.filter((p) => p.status === 'open');
  if (declined.length) L.push(declined.map((p) => `- \`${p.id}\` ${p.text} —— 理由：${p.reason ?? '(未记录)'}`).join('\n'));
  else L.push('- 无（被否决的路径）');
  if (stillOpen.length) {
    L.push('');
    L.push(`未展开（open，本报告未覆盖 ${stillOpen.length} 条；不是"不存在"，是"没查"）：`);
    L.push('');
    L.push(stillOpen.map((p) => `- \`${p.id}\` ${p.text}`).join('\n'));
  }
  L.push('');
  L.push('## 附录 D　审查处置');
  L.push('');
  const reviews = nodes.filter((n) => existsSync(join(runDir, 'nodes', n.id, 'review-1.md')));
  L.push(reviews.length ? reviews.map((n) => `- ${n.id}：\`nodes/${n.id}/review-1.md\`（处置见 \`decision.md\`）`).join('\n') : '- 无');
  L.push('');
  L.push('## 参考文献');
  L.push('');
  const srcs = nodes.filter((n) => existsSync(join(runDir, 'nodes', n.id, 'SOURCES.md')));
  L.push(srcs.length ? srcs.map((n) => `- ${n.id}：\`nodes/${n.id}/SOURCES.md\``).join('\n') : '- 待补');
  L.push('');
  const outFile = join(runDir, 'final', `${g.slug}-final.md`);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, L.join('\n'));
  const graphFile = join(runDir, 'final', `${g.slug}-graph.md`);
  writeFileSync(graphFile, ['# 图谱', '', '```', `${root.id} ${root.question}`, ...tree(g), '```', ''].join('\n'));
  console.log(JSON.stringify({ ok: true, report: outFile, graph: graphFile, nodes: nodes.length, declinedPaths: declined.length }, null, 2));
}

function cmdStatus(runDir, f) {
  const g = load(runDir);
  const nodes = Object.values(g.nodes);
  const byState = nodes.reduce((a, n) => ((a[n.state] = (a[n.state] || 0) + 1), a), {});
  const info = {
    slug: g.slug,
    question: g.question,
    level: g.level,
    depth: g.params.depth,
    nodes: nodes.length,
    byState,
    pendingForks: g.pendingForks.filter((x) => x.status === 'pending').length,
    openPaths: g.paths.filter((p) => p.status === 'open').length,
    declinedPaths: g.paths.filter((p) => p.status === 'declined').length,
    relations: g.relations.length,
    failures: nodes.filter((n) => n.state === 'failed').map((n) => ({ id: n.id, reason: n.failReason })),
    resumable: nodes
      .filter((n) => !['merged', 'declined', 'failed'].includes(n.state))
      .map((n) => ({ id: n.id, state: n.state, next: nextState(n.state) })),
  };
  if (f.json) return console.log(JSON.stringify(info, null, 2));
  console.log(`${g.slug}  L${g.level}/${g.params.depth}  nodes ${nodes.length}`);
  console.log(`  ${Object.entries(byState).map(([k, v]) => `${k}:${v}`).join('  ')}`);
  for (const n of nodes) console.log(`  ${n.id.padEnd(4)} L${n.level} ${n.state.padEnd(10)} ${n.verdict ?? ''} ${n.question.slice(0, 60)}`);
  if (info.pendingForks) console.log(`  PENDING FORKS: ${info.pendingForks}`);
  if (info.failures.length) console.log(`  FAILED: ${info.failures.map((x) => x.id).join(', ')}`);
}

const { cmd, sub, rest, flags: f } = parseArgs(process.argv.slice(2));
const runDir = resolve(f.dir && f.dir !== true ? f.dir : process.cwd());
if (f.out && f.out !== true && cmd === 'init') {
  // handled inside init via runDir override
}
const runRoot = cmd === 'init' ? resolve(f.out && f.out !== true ? f.out : runDir) : runDir;

switch (cmd) {
  case 'init':
    cmdInit(runRoot, f);
    break;
  case 'node':
    cmdNode(runRoot, sub, rest, f);
    break;
  case 'plan':
    cmdPlan(runRoot, sub, rest, f);
    break;
  case 'paths':
    cmdPaths(runRoot, sub, rest, f);
    break;
  case 'fork':
    cmdFork(runRoot, sub, rest, f);
    break;
  case 'relation':
    cmdRelation(runRoot, sub, rest, f);
    break;
  case 'reconcile':
    cmdReconcile(runRoot, f);
    break;
  case 'ingest':
    cmdIngest(runRoot, rest, f, sub);
    break;
  case 'verify':
    cmdVerify(runRoot, f);
    break;
  case 'report':
    cmdReport(runRoot);
    break;
  case 'status':
    cmdStatus(runRoot, f);
    break;
  default:
    console.error(readFileSync(new URL(import.meta.url)).toString().split('\n').slice(2, 30).join('\n'));
    process.exit(1);
}
