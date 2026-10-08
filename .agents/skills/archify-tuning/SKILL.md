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
- **Deleted content is the accuracy signal.** A pass reached by removing an error state or merging lanes is a failure that counts as a success; check what the final candidate dropped.
- **Automatic layout must pass its own gates.** When a fully automatic draft (no `via`, sides, channels or label coordinates) fails composition checks, the renderer is at fault, not the agent.
- **Early diagnostics must match the browser gate.** A compile-time check stricter than `browser-check` is a false failure; a looser one defers the failure to the most expensive stage.
- **Traces explain more than outcomes.** Read where the agent was misled by a diagnostic or a document, not only whether it passed.

## Measures

| Level | Measure | Source |
|---|---|---|
| Primary | Benchmark first-draft pass rate; content kept from first draft to final | `replay.mjs`; `collect.mjs` |
| Secondary | Finalize failures and tool calls per diagram | `collect.mjs` on a new round |
| Visual | Crossings, bends, shared corridors, text size, then screenshots | Receipts and a browser |
| Guard | No benchmark draft or historical sample that passed now fails; every changed output inspected | `replay.mjs`, golden, Gallery |

A new round on a new project finds problems and shows a change broke nothing. It does not prove improvement: projects differ too much. Prove improvement on the benchmark, or by repeating one project two or three times.

## Loop

1. **Generate.** Pick a project not used before. Start one background subagent per diagram type with the prompt below and the same wording every round. Never edit the Archify tree the subagents use while they run; experiment in a separate worktree.
2. **Collect.** `node .agents/skills/archify-tuning/scripts/collect.mjs <round-root> --round <n>-<project> --dump` prints per-type tool calls, finalize runs and failures, diagnostic codes and the content lost, writes `<type>.trace.txt` and adds each first draft to the benchmark. Cross-check its counts with the subagents' own reports.
3. **Attribute** each failure to exactly one cause:

   | Cause | Test | Response |
   |---|---|---|
   | Renderer defect | A fully automatic draft fails its own composition checks | Fix the renderer |
   | Misleading diagnostic | Following the message fails or edits the wrong element | Fix its fix text or evidence |
   | Documentation gap | The agent asks something only an unread reference answers | Move the fact into a required read, with numbers |
   | Authoring error | The required reads already say it | Nothing, or one sentence |

4. **Prioritise** by how many rounds and types show it, times its harm to accuracy, over its cost. A problem seen every round needs a systematic fix, not one patch per round.
5. **Fix** the root cause once, in the shared path. Preserve authored geometry and pins; when the renderer cannot repair a draft itself, return a verified, actionable fix. Reject a change that only moves a metric, such as trading crossings for shared corridors.
6. **Verify.** Add a minimal test that fails before the fix. Run `node .agents/skills/archify-tuning/scripts/replay.mjs --base <dev-worktree>/archify` and expect no regressions. Find affected tests by searching for the changed functions and message text, not by file name. Regenerate examples and Gallery when output changes, run golden and inspect screenshots of changed outputs.
7. **Record.** Commit code, regenerated outputs and documentation separately. Integrate regularly so the full suite and CI run; do not let local commits pile up.

## Diagnostics and documentation

- A diagnostic names the element, the shortfall (target width, character budget or required gap) and one fix that works. It never points at a fix that cannot succeed.
- A compact receipt lists how many diagnostics of each code it omitted.
- Documentation answers questions traces show agents asking, in a required read, with measured numbers. Keep one paragraph per mode and every line under the 2,000-character read limit.

## Subagent prompt

```text
画 <project-path> 这个项目的<图类型>。

Use the Archify skill located at <archify-tree> (read <archify-tree>/SKILL.md first and follow it exactly, including the references it tells you to read). Do NOT install, update, or copy Archify anywhere; use the CLI directly as `node <archify-tree>/bin/archify.mjs ...`.

Constraints:
- Your working directory for all Archify commands and outputs is <round-root>/<type> (cd there; the skill's `.archify/<type>-<slug>-<timestamp>/` folder must be created under it, not inside the project).
- <project-path> is read-only source evidence. Do not create, modify, or delete any file in it (ignore its pre-existing untracked files). Pass it as `--repo-root` where the skill requires.
- Do not modify anything under <archify-tree>.
- Follow the skill's repair loop until finalize passes or the skill tells you to stop.

When done, reply concisely with: diagram type, absolute path of the final candidate JSON and final HTML, whether finalize passed (key status lines), and every repair iteration (diagnostic code + what you changed). Also list any point where the skill docs or CLI messages were unclear, contradictory, or sent you the wrong way.
```

`<round-root>/<type>` must appear verbatim in the prompt: `collect.mjs` finds each subagent by it.

## Benchmark

The benchmark lives outside the repository, in `$ARCHIFY_TUNING_BENCH` or `~/.local/share/archify-tuning/bench`, because first drafts carry content from the source projects, which may be private. Each entry is `<type>/<round>.json` with repository evidence stripped; `index.json` records its project, revision and first finalize result. Never commit benchmark drafts. `collect.mjs` reads Devin CLI session history through `node:sqlite` (Node 22.13 or later); other agents need their own trace export.
