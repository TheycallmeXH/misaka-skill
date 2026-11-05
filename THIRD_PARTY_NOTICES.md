# Third-party notices

## Runtime dependencies

None. `scripts/*.mjs` use only Node.js built-in modules (`node:fs`, `node:path`,
`node:zlib`, `node:crypto`, `node:url`, `node:child_process`). Node.js itself is
covered by the Node.js license and is not redistributed here.

## Design references (no code or text copied)

| Project | Licence | What was used |
|---|---|---|
| [MISAKA](https://github.com/Luciole-Studio/Misaka-Agent) — Copyright 2026 Luciole Studio | Apache-2.0 | The research-graph workflow described in its public documentation: stage sequencing, ally/reviewer boundary, reconciliation vocabulary, artifact layout. This repository reimplements those ideas from scratch; no file from MISAKA is included. See `NOTICE`. |

## Vendored or adapted code

None. Every file in this repository was written for this project.

## Trademarks

"MISAKA" belongs to its respective owners. It is used here descriptively, to
name the design origin of the workflow, without any claim of affiliation or
endorsement.
