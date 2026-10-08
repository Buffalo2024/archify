---
name: archify-tuning
description: Tune Archify's generation quality from evidence. Generate real diagrams through subagents, read their execution traces, attribute each failure, fix the root cause and prove the change on a fixed benchmark of first drafts. Use when asked to improve how good, accurate or fast generated Archify diagrams are, to run a generation round, or to judge whether a renderer, diagnostic or documentation change made generation better.
metadata:
  internal: true
---

# Archify Tuning

Users do not write diagram JSON; they describe a system and an agent authors it. Tune for that path: an agent's **first draft** should render as an accurate, readable diagram with few repairs. When the goals conflict, keep this order:

1. **Accurate**: no node, relationship, lane or condition is dropped or merged to pass a gate.
2. **Readable**: clear reading path, few bends and crossings, legible text.
3. **Fast**: few finalize failures and tool calls.

A change that makes gates pass while the diagram reads worse, or that makes agents delete content more often, is a regression.

## Principles

- **The first draft is the unit of measure.** Bundled examples carry hand-tuned widths and routes, so they hide defects that every fresh draft hits.
- **Deleted content is the accuracy signal.** A pass reached by removing an error state or merging lanes is a failure that looks like a success.
- **Automatic layout must pass its own gates.** When a fully automatic draft (no `via`, sides, channels or label coordinates) fails composition checks, the renderer is at fault, not the agent.
- **Early diagnostics must match the browser gate.** A compile-time check stricter than `browser-check` is a false failure; a looser one defers the failure to the most expensive stage.
- **Traces explain more than outcomes.** Read where a diagnostic or document misled the agent, not only whether it passed.

## Measures

| Level | Measure | Source |
|---|---|---|
| Primary | Benchmark first-draft pass rate, per type | `replay.mjs` |
| Primary | Content kept from first draft to final | `collect.mjs`, "lost" column |
| Secondary | Finalize failures and tool calls per diagram | `collect.mjs` on a new round |
| Visual | Crossings, bends, shared corridors and text size, then screenshots | Receipts, `shots.mjs` |
| Guard | No benchmark draft that passed on base fails on head; every changed output inspected | `replay.mjs`, golden, Gallery |

A new round on a new project finds problems and shows a change broke nothing. It does not prove improvement, because projects differ too much: prove improvement on the benchmark, or by repeating one project two or three times.

## Setup

- **Tuning home**: `$ARCHIFY_TUNING_HOME`, default `~/.local/share/archify-tuning`. It holds `journal.md`, `bench/`, `rounds/` and `replays/`. It stays outside the repository because drafts carry content from source projects, which may be private: never commit it.
- **Journal**: read `<tuning-home>/journal.md` before starting. It records the branch under tuning, the latest benchmark result, the open problems with evidence and the decisions already taken. Update it at the end of every iteration.
- **Head**: the worktree you change, in a durable directory. Run `npm ci` there so the full test suite can run.
- **Base**: a separate worktree of the comparison point, usually `dev`: `git worktree add <dir> origin/dev`. Pass its `archify` directory as `--base`.
- **Tools**: Node 22.13 or later (`collect.mjs` uses `node:sqlite` on Devin CLI session history; other agents need their own trace export) and Chrome or Chromium for `shots.mjs` (`ARCHIFY_CHROME` overrides discovery).

Scripts live in `.agents/skills/archify-tuning/scripts/`. `round`, `collect` and `replay` print their usage when run without arguments; `shots` uses the latest replay.

## Loop

1. **Baseline.** `node scripts/replay.mjs --base <base>/archify` and record the per-type pass rate in the journal.
2. **Generate.** Pick a project not used before (see the journal). `node scripts/round.mjs <project-path> [--types ...]` creates `<tuning-home>/rounds/<round>/` and `prompts.json`. Start each prompt as its own background subagent, unchanged. The Archify tree they use must stay untouched until every subagent finishes: experiment in a separate worktree meanwhile.
3. **Collect.** `node scripts/collect.mjs <round> --dump` prints, per type, tool calls, finalize runs and failures, whether the first draft was fully automatic (`draft`), what the final candidate dropped (`lost`) and the diagnostic codes. It writes `<type>.trace.txt` and `<type>/first-draft.json`, and adds each first draft to the benchmark. Cross-check its counts with the subagents' reports.
4. **Attribute** every failure to exactly one cause, using [Trace signals](references/trace-signals.md):

   | Cause | Test | Response |
   |---|---|---|
   | Renderer defect | A fully automatic draft fails its own composition checks | Fix the renderer |
   | Misleading diagnostic | Following the message fails or edits the wrong element | Fix its fix text or evidence |
   | Documentation gap | The agent needs a fact found only outside the required reads | Move the fact into a required read, with numbers |
   | Authoring error | The required reads already say it | Nothing, or one sentence |

5. **Prioritise** by how many rounds and types show the problem, times its harm to accuracy, over its cost. A problem seen every round needs a systematic fix, not one patch per round. Record the ranking in the journal.
6. **Fix** the root cause once, in the shared path. Preserve authored geometry and pins; when the renderer cannot repair a draft itself, return a verified, actionable fix. Reject a change that only moves a metric, such as trading crossings for shared corridors.
7. **Verify.**
   - Add a minimal test that fails before the fix.
   - Replay: `node scripts/replay.mjs --base <base>/archify`. Any REGRESSED entry blocks the change; investigate every FIXED and changed entry.
   - `node scripts/shots.mjs` and look at every pair it captures.
   - Find affected tests by searching for the changed functions and message text, not by file name, and run them. Regenerate examples and Gallery when output changes, then run golden.
8. **Record.** Commit code, regenerated outputs and documentation separately. Update the journal: benchmark result, problems closed and opened, approaches rejected. Integrate regularly through [CONTRIBUTING.md](../../../CONTRIBUTING.md) so the full suite and CI run. This skill does not authorise pushing, opening pull requests or installing Archify.

## Diagnostics and documentation

- A diagnostic names the element, the shortfall (target width, character budget or required gap) and one fix that works. It never points at a fix that cannot succeed.
- A compact receipt lists how many diagnostics of each code it omitted.
- Documentation answers questions traces show agents asking, in a required read, with measured numbers. Keep one paragraph per mode and every line under the 2,000-character read limit.

## Anti-patterns

- Counting failures while ignoring deleted content.
- Claiming an improvement from one round on a new project.
- Patching the same problem a little every round.
- Updating a pinned test value without checking that the diagram got better.
- Growing documentation until agents cannot read it whole.
