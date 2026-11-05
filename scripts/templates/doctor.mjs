#!/usr/bin/env node
/**
 * doctor.mjs — 环境自检。zero dependency.
 *   node doctor.mjs [--json]
 * 检查：node 版本、pdftotext、claude/codex CLI（ally 前置）、git、run 目录可写。
 * 任何一项缺失都只影响对应能力，不阻塞主流程；输出里 must_have=false 表示可降级。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function probe(bin, args = ['--version']) {
  try {
    const out = execFileSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000 });
    return { ok: true, version: String(out).split('\n')[0].trim().slice(0, 120) };
  } catch (e) {
    return { ok: false, error: e.code === 'ENOENT' ? 'not on PATH' : String(e.message).slice(0, 120) };
  }
}

const nodeMajor = Number(process.versions.node.split('.')[0]);
const report = {
  generated: new Date().toISOString(),
  checks: [
    { name: 'node', must_have: true, ok: nodeMajor >= 20, detail: process.versions.node, hint: '需要 Node >= 20（ESM + fetch）' },
    { name: 'pdftotext', must_have: false, ...probe('pdftotext', ['-v']), hint: '缺则 PDF 不可读（降级：转 md/txt）；md/txt 不受影响' },
    { name: 'claude', must_have: false, ...probe('claude'), hint: '缺则 ally(claude) 关闭，任务卡回落 subagent' },
    { name: 'codex', must_have: false, ...probe('codex'), hint: '缺则 ally(codex) 关闭，任务卡回落 subagent' },
    { name: 'git', must_have: false, ...probe('git', ['--version']), hint: '仅用于你自己提交产物；本 skill 不自动 commit' },
  ],
};

// write probe
try {
  const d = join(tmpdir(), 'misaka-doctor-' + process.pid);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'probe.txt'), 'ok');
  rmSync(d, { recursive: true, force: true });
  report.checks.push({ name: 'tmp-writable', must_have: true, ok: true, detail: tmpdir() });
} catch (e) {
  report.checks.push({ name: 'tmp-writable', must_have: true, ok: false, detail: String(e.message).slice(0, 120) });
}

report.ally = {
  claude: report.checks.find((c) => c.name === 'claude').ok,
  codex: report.checks.find((c) => c.name === 'codex').ok,
  note: 'allies 只承接任务卡，永远不接红队卡（reviewer 恒为 sister）',
};
report.blocked = report.checks.filter((c) => c.must_have && !c.ok).map((c) => c.name);
report.degraded = report.checks.filter((c) => !c.must_have && !c.ok).map((c) => c.name);
report.ok = report.blocked.length === 0;

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const c of report.checks) {
    console.log(`${c.ok ? 'ok  ' : 'MISS'} ${c.name.padEnd(14)} ${c.must_have ? '(required)' : '(optional)'} ${c.detail ?? c.error ?? ''}`);
    if (!c.ok && c.hint) console.log(`     → ${c.hint}`);
  }
  console.log(`\nally: claude=${report.ally.claude} codex=${report.ally.codex}`);
  console.log(report.ok ? 'ready' : `blocked: ${report.blocked.join(', ')}`);
}
process.exit(report.ok ? 0 : 1);
