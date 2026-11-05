#!/usr/bin/env node
/**
 * doc.mjs — zero-dependency document index / reader / citation verifier.
 *
 * Page model (important, keep stable):
 *   .md / .markdown  -> one "page" per ATX heading section (# ... ######), 1-based
 *   .txt / others    -> fixed segments of SEGMENT chars, 1-based
 *   .pdf             -> real pages, only when `pdftotext` is on PATH; otherwise DEGRADED
 *
 * offset is a 0-based character offset *inside that page/section text*.
 *
 * Commands:
 *   node doc.mjs scan <dir> [--json]
 *   node doc.mjs outline <file>
 *   node doc.mjs read <file> [--page N] [--pages A-B] [--section N] [--max N]
 *   node doc.mjs find <term> <file...>
 *   node doc.mjs verify <file> --page N --offset N --quote "text"
 *
 * verify exit codes: 0 ok, 2 mismatch, 3 unreadable/degraded.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const SEGMENT = 3000;
const TEXT_EXT = new Set(['.md', '.markdown', '.txt', '.text', '.rst', '.org', '.csv', '.json', '.yaml', '.yml', '.html', '.htm', '.xml']);

export function havePdftotext() {
  try {
    execFileSync('pdftotext', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function norm(s) {
  return String(s)
    .replace(/\r\n/g, '\n')
    .replace(/[ \t\u00a0\u3000]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pdfPages(file) {
  const out = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\f');
}

function mdSections(text) {
  const lines = text.split(/\r?\n/);
  const units = [];
  let cur = { index: 1, heading: '(前言)', start: 0, lines: [] };
  let offset = 0;
  for (const line of lines) {
    if (/^#{1,6}\s+/.test(line)) {
      if (cur.lines.join('\n').trim() || units.length === 0) {
        units.push(cur);
      }
      cur = { index: units.length + 1, heading: line.replace(/^#{1,6}\s+/, '').trim(), start: offset, lines: [] };
    } else {
      cur.lines.push(line);
    }
    offset += line.length + 1;
  }
  units.push(cur);
  const kept = units
    .map((u) => ({ heading: u.heading, text: u.lines.join('\n') }))
    .filter((u) => u.text.trim() !== '' || u.heading !== '(前言)');
  return kept.map((u, i) => ({ index: i + 1, heading: u.heading, text: u.text }));
}

function txtSegments(text) {
  const units = [];
  for (let i = 0; i < text.length; i += SEGMENT) {
    units.push({ index: units.length + 1, heading: `segment ${units.length + 1}`, text: text.slice(i, i + SEGMENT) });
  }
  return units.length ? units : [{ index: 1, heading: 'segment 1', text: '' }];
}

/** @returns {{kind:string, degraded:boolean, units:{index:number,heading:string,text:string}[]}} */
export function loadUnits(file) {
  const abs = resolve(file);
  if (!existsSync(abs)) return { kind: 'missing', degraded: false, units: [] };
  const ext = extname(abs).toLowerCase();
  if (ext === '.pdf') {
    if (!havePdftotext()) return { kind: 'pdf', degraded: true, units: [] };
    const pages = pdfPages(abs);
    return { kind: 'pdf', degraded: false, units: pages.map((t, i) => ({ index: i + 1, heading: `page ${i + 1}`, text: t })) };
  }
  if (!TEXT_EXT.has(ext)) {
    const raw = readFileSync(abs);
    if (raw.includes(0)) return { kind: 'binary', degraded: true, units: [] };
    const text = raw.toString('utf8');
    return { kind: 'text', degraded: false, units: ext === '.md' || ext === '.markdown' ? mdSections(text) : txtSegments(text) };
  }
  const text = readFileSync(abs, 'utf8');
  return { kind: 'text', degraded: false, units: ext === '.md' || ext === '.markdown' ? mdSections(text) : txtSegments(text) };
}

/**
 * Verify a citation: quote must appear at `offset` inside page `page`.
 * Returns status: ok | offset-mismatch (same page, wrong offset) |
 *                 page-mismatch (elsewhere in doc) | not-found | degraded | unreadable
 */
export function verifyQuote(file, page, offset, quote) {
  const doc = loadUnits(file);
  if (doc.kind === 'missing') return { ok: false, status: 'unreadable', detail: 'file not found' };
  if (doc.degraded) return { ok: false, status: 'degraded', detail: `cannot read (${doc.kind})` };
  const q = norm(quote);
  if (!q) return { ok: false, status: 'unreadable', detail: 'empty quote' };
  const p = Number(page);
  const off = Number(offset);
  const unit = doc.units.find((u) => u.index === p);
  if (unit) {
    const at = norm(unit.text.slice(off, off + q.length + 8));
    if (at.startsWith(q)) return { ok: true, status: 'ok', page: p, offset: off };
    const idx = norm(unit.text).indexOf(q);
    if (idx >= 0) return { ok: false, status: 'offset-mismatch', page: p, offset: off, foundAt: idx };
    const rawIdx = unit.text.indexOf(quote);
    if (rawIdx >= 0) return { ok: false, status: 'offset-mismatch', page: p, offset: off, foundAt: rawIdx };
  }
  for (const u of doc.units) {
    const idx = norm(u.text).indexOf(q);
    if (idx >= 0) return { ok: false, status: 'page-mismatch', page: p, offset: off, foundPage: u.index, foundAt: idx };
  }
  return { ok: false, status: 'not-found', page: p, offset: off };
}

function sha(buf) {
  return createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

function cli(argv) {
  const [cmd, ...rest] = argv;
  const flag = (name, dflt) => {
    const i = rest.indexOf(`--${name}`);
    return i >= 0 && rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[i + 1] : dflt;
  };
  const positional = rest.filter((a) => !a.startsWith('--'));
  const out = (obj) => console.log(typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));

  switch (cmd) {
    case 'scan': {
      const dir = resolve(positional[0] ?? '.');
      const entries = walk(dir).map((f) => {
        const st = statSync(f);
        const ext = extname(f).toLowerCase();
        const doc = loadUnits(f);
        return {
          file: relative(dir, f).replace(/\\/g, '/'),
          bytes: st.size,
          ext,
          kind: doc.kind,
          degraded: doc.degraded,
          units: doc.units.length,
          sha: sha(readFileSync(f)),
        };
      });
      const indexFile = join(dir, '_index.json');
      writeFileSync(indexFile, JSON.stringify({ dir, scanned: new Date().toISOString(), entries }, null, 2));
      out({ index: indexFile, files: entries.length, degraded: entries.filter((e) => e.degraded).map((e) => e.file) });
      return 0;
    }
    case 'outline': {
      const file = positional[0];
      const doc = loadUnits(file);
      if (doc.degraded) {
        out({ error: 'degraded', kind: doc.kind, hint: 'install pdftotext for PDFs, or convert to .md/.txt' });
        return 3;
      }
      out({ file, kind: doc.kind, pages: doc.units.length, outline: doc.units.map((u) => ({ page: u.index, heading: u.heading, chars: u.text.length })) });
      return 0;
    }
    case 'read': {
      const file = positional[0];
      const doc = loadUnits(file);
      if (doc.degraded) {
        out({ error: 'degraded', kind: doc.kind });
        return 3;
      }
      const max = Number(flag('max', 4000));
      const pages = flag('pages');
      const one = flag('page', flag('section'));
      let units = doc.units;
      if (pages) {
        const [a, b] = String(pages).split('-').map(Number);
        units = doc.units.filter((u) => u.index >= a && u.index <= (b || a));
      } else if (one) {
        units = doc.units.filter((u) => u.index === Number(one));
      }
      out(units.map((u) => ({ page: u.index, heading: u.heading, text: u.text.slice(0, max) })));
      return 0;
    }
    case 'find': {
      const term = positional[0];
      const files = positional.slice(1);
      const hits = [];
      for (const f of files) {
        const doc = loadUnits(f);
        for (const u of doc.units) {
          let i = u.text.toLowerCase().indexOf(term.toLowerCase());
          while (i >= 0) {
            hits.push({ file: f, page: u.index, offset: i, snippet: u.text.slice(Math.max(0, i - 40), i + term.length + 40).replace(/\s+/g, ' ') });
            i = u.text.toLowerCase().indexOf(term.toLowerCase(), i + 1);
          }
        }
      }
      out(hits.slice(0, 200));
      return hits.length ? 0 : 1;
    }
    case 'verify': {
      const file = positional[0];
      const r = verifyQuote(file, flag('page'), flag('offset', 0), flag('quote', ''));
      out(r);
      return r.ok ? 0 : r.status === 'degraded' || r.status === 'unreadable' ? 3 : 2;
    }
    default:
      console.error('usage: node doc.mjs <scan|outline|read|find|verify> ...');
      return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('doc.mjs')) {
  process.exit(cli(process.argv.slice(2)));
}
