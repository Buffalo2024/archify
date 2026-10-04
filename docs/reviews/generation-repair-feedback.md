# Generation repair feedback

The maintainer approved this follow-up after reviewing eight failed generation
trajectories, their frozen candidates and public execution receipts. The source
base is `d6d3bc0b` on `codex/readable-diagram-layout`; the refreshed development
base remains `f86769d56884f3b80d7410220d8fc3f12515b9a2` and the stable comparison is
`7158026e852f3aa6578c741e673b46d7878c92c1`.

## Problem and agreed scope

Automatic routes can produce real crossings or label conflicts. Subsequent
repairs sometimes add incompatible route/side constraints, then consume their
budget correcting one newly exposed defect at a time. A local suggestion does
not establish whole-diagram feasibility. ERD/Class failures previously withheld
usable layout measurements, and Workflow v2 treated every decrease in column as
a semantic loop. The approved outcome is more reliable diagnosis and repair,
with preserved meaning, explicit authored geometry and truthful failed exits.

This is shared renderer and CLI behavior plus an authoring contract change.
Expose complete/partial/unavailable measurements through `validate --layout-json`
for Workflow, ERD, Class and Dataflow while preserving Architecture's established
report. Keep `ok: false` and exit 1 on rejected inputs. Diagnose unsupported
Dataflow capacity explicitly. Preserve geometric evidence and state the scope
of a proposed patch. Summaries should show omitted error families and provide
optional inspection arguments with repository context.

Workflow v2's spatial ordering becomes an inspection signal instead of a hard
semantic rejection; node references and directed main-path adjacency remain
required, and schema-v1 compatibility remains unchanged. Improve automatic
routing and label placement only through bounded deterministic candidates;
explicit route/side/label coordinates remain authoritative. Keep repair guidance
in the existing authoring and delivery contracts, including behavior conditions,
source bindings and main-path retention.

## Non-goals and evidence boundaries

No live Skill installation, release identity change, remote publication or merge
is included. Do not repeat the already completed authored-height/zoom fixes.
Do not increase retry budgets or substitute a different model to claim progress.
Private repository inputs, raw traces and screenshots stay outside tracked files;
repository regressions use anonymous examples.

Same-input base/candidate checks establish engine behavior; isolated Agent trials
with frozen project revisions establish actual usage evidence. A manually
repaired final input does not count as autonomous generation improvement. Every
passing artifact still needs the normal complete delivery gates; a layout report
or endpoint-only repair is not artifact acceptance. Perceptual review remains
separate from automatic checks.

## Validation

The combined runtime package was frozen as `candidate-r3-6298644b763f`
(146 files, official Node 22.23.2 / bundled zlib). Source and extracted-package
hashes matched before and after the experiments. The canonical ZIP was rebuilt;
checked-in examples and their golden SVGs did not change.

- Public CLI/finalize/boundary checks: 39/39 passed. Final ERD/Class evidence
  checks: 15/15 passed, including legacy row/col/pos fields, finite geometry,
  endpoint-patch scope and complete large piped reports.
- Independent Workflow checks: 130/130 passed. A 450-input preset/side matrix
  produced no newly rejected input and no changed SVG among mutual passes.
- The 43 previously successful gallery inputs passed validate/render/check.
  Their normalized SVGs matched the previous `d6d3bc0b` candidate in every case.
  Two Sequence differences against main/dev predate this batch.
- The 16 frozen first/last failure snapshots remain 2 static passes and 14
  failures on both dev and the candidate. Fifteen now return complete/partial
  measurements; one source-line error correctly returns unavailable. These
  measurements do not approve a failed artifact.
- Fresh independent Sol 6.1 medium generation used the same pinned projects,
  requests and repair budget per applicable arm. Main had 1/2 automatic
  successes (ERD/Class unsupported); dev 2/4; candidate 4/4, requiring 2, 4, 1
  and 2 finalize attempts for Workflow, ERD, Class and Dataflow respectively.
  Four initial fixture runs with incorrect local-path origins were archived
  as environment-invalid and excluded; replacements used verified origins.
  One run per arm cannot establish a reliable success-rate improvement.
- A further 7-input same-JSON replay distinguishes the mechanism: only the
  final Workflow changes from rejection on main/dev to acceptance on candidate,
  because its complete, connected main path travels left in two places. Its
  partial layout report also matches the observed one-edge local routing repair.
  The other three final candidates already pass dev. Their independently
  generated success is not evidence that the new renderer alone caused it.
- Independent source/semantic checks found no blocking content defect in the
  four candidate artifacts. ERD replaced one unsupported self-reference edge
  with the retained FK field and an explicit explanatory card; topology did
  change and self-loop rendering remains unsupported. A failed dev Workflow
  shortened its mainPath, so that baseline is not a geometry-only repair trace.
- Four candidate artifacts were inspected at 1366 x 900 in light/dark themes.
  No overlapping fields or misconnected line ends were observed. Dense ERD
  fields and Workflow secondary labels remain small at overview scale;
  the ERD was also checked at 25%, reset, and 150%. Zoom behavior comes from
  the preceding Viewer work, not this batch.

Full `npm test` completed with 2541 passed, 0 failed and 92 optional browser
skips (2633 total). Golden, Viewer, brand, validator and release-identity
freshness checks passed in that run. The maintained Chrome browser suite ran
291 tests with 288 passes and 3 reported failures: two independent CDP timeouts
and the enclosing export test failure. Both affected files then passed a serial
rerun, 23/23, without source or assertion changes. Preserve the original nonzero
full-run receipt; the evidence is full coverage plus focused successful retry,
not a clean first run. No functional regression was confirmed within this scope.

## Remaining limits

This batch improves actionable failure feedback and removes one false main-path
constraint. It does not claim to solve arbitrary Workflow routing. The bounded
corridor-offset experiment regressed a frozen input and was reverted. Historical
complex Workflow originals still fail real routing checks, and ERD self-loop
rendering remains a separate capability. Continue with those frozen inputs and
preserve semantic steps; do not shorten the process merely to clear a gate.

Private inputs, commands, candidate hashes, stage receipts, independent reviews,
screenshots and the readable comparison page remain in the local task artifact
folder (`layout-followup/trajectory-improvement`). Repository tests use anonymous
fixtures. No remote CI, PR, merge, release or live installation is claimed.
