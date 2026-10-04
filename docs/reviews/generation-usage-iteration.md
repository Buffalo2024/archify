# Generation usage iteration

The maintainer requested independent Agents to repeat the same project and
diagram task, retain their public execution records, interview them after
completion, and use reproduced findings to improve the implementation. This
continues `generation-repair-feedback.md`; better diagnostics alone did not
resolve the historical complex Workflow failures.

The work starts at `33c3245e02bfb94b92c9fe4d1a411e6bdacde548` on
`codex/readable-diagram-layout`, after integrating development head
`107b4fb18e8c76dbaac21657d84209f2be0cdeed`. Stable comparison is
`594f6087358610bd16e64e5602976020871b6bff`. The refreshed main/dev Skill trees
are identical to the prior frozen comparison packages; this is verified package
reuse, not a new package build. The feature branch runtime initially matches
`a0562538`.

## Scope and compatibility

Three reproduced implementation defects define the first iteration:

- ERD permits an explicit diagonal `straight` route, but its SVG omitted the
  provenance used by the artifact checker. Reuse the existing marker without
  changing the authored geometry. Endpoint sides, obstacles, via precedence,
  cardinality, and the remaining artifact checks stay authoritative.
- Dataflow's implicit 7px sublabel preference can fail the existing projected
  6px readability floor on a wider canvas even when its box has enough room.
  Raise only an unreadable implicit preference that fits the authored box,
  using the existing conservative reader budget. Keep readable output stable,
  the full text, node bounds, viewBox, and all flow coordinates.
- Workflow reserves routes greedily and can reject the complete scene after
  every individual route was locally feasible. For unpinned schema-v2 scenes,
  try a bounded deterministic alternative planning order only after a real
  whole-scene routing failure. Accept an alternative only when the complete
  compiler passes; otherwise preserve the original failure and diagnostics.
  Successful default output and schema-v1 behavior remain unchanged.
  A separate recovery can move automatic ports along their authored sides
  after reserving straight paths, only when all node geometry and protected
  paths remain identical. Absolute pins and authored sides stay authoritative.

This is shared rendering behavior with a narrow correction to the documented
ERD contract. It does not authorize lower quality thresholds, topology edits,
source removal, changing explicit geometry, live installation, release, remote
publication, or merge. Native ERD self references require a separate complete
loop implementation: merely removing the rejection allows a route to cross
its owning table. The reproduction and proposed acceptance cases are retained
as an unresolved capability, not included as an unsafe partial implementation.

## Evidence protocol

Each applicable arm uses the same pinned source, original request, diagram
type, Sol 6.1 medium model, and repair budget: one draft, two focused repairs,
and at most one additional retry justified by new evidence. Generators receive
the assigned frozen Skill and project, without old answers or implementation
hints. Post-run interviews are separate from the generation assignment.

Public command arguments, repository context, exit codes, duration, candidate
snapshots and hashes, and receipts are retained. Browser-capable commands run
serially; lock waits are separate from command duration. Private reasoning is
not collected. A semantic audit distinguishes geometric repairs from changes
to conditions, failure exits, source bindings, and main paths.

Same-JSON replay across main, dev, the preceding feature package, and the new
package isolates implementation effects. Independent fresh usage establishes
practical behavior but cannot, with one sample per arm, establish a reliable
success-rate claim. Browser gates and perceptual inspection remain separate
from static acceptance. Repository regression inputs are anonymous; real
project evidence remains in the local task artifact directory.

## Results and acceptance

The frozen i1 package is `47e22965f6cfb123cdb4be15363b51b94098a80461afc72d0e27713c96a607c3`.
Independent review found a fractional-height Dataflow edge case: fitted
descenders could extend 0.017–0.163 SVG units below a short box. The i2
package, `108d892ee8047194041715bd6a084093c0e53c5060fb38de5643ad394e132da9`,
adds a half-pixel inset before permitting font growth. Those three inputs now
retain their smaller font and correctly remain rejected for readability;
browser measurements put the text inside the box. Every other runtime file
is byte-identical between i1 and i2.

The controlled comparison contains 93 input snapshots, not 93 independent
projects: 43 previously successful diagrams and 50 historical or newly
authored failure-stage candidates. Main, dev, the prior feature package, and
i1 each ran validate/render/check on identical semantic content. Only the
output destination was relocated.

- Four previously failing inputs recover relative to the prior feature
  package: two MCO workflows, one Insights dataflow, and a Pixelle workflow.
  Each also passed complete finalize, including its browser gate, on i1.
- All 43 previously successful diagrams still pass; their normalized SVGs
  are unchanged. Main does not support 20 of those newer-type inputs; they
  are recorded as unsupported, not failures.
- All 93 inputs were replayed again on i2: 51 pass and 42 remain failures,
  with the same statuses and successful SVGs as i1. The remaining failures
  include different attempts of the same task, not 42 independent projects.
- The i1 repository gate passed 2,559 tests with 92 browser-dependent skips
  and no failures. After the inset change, all 21 affected new regression
  tests passed. Independent Workflow, ERD, and final Dataflow reviews found
  no remaining blockers within their implementation scope.
- The maintained browser suite passed 291/291 with no skips on i2. All four
  restored inputs also passed complete finalize on i2, including browser
  checks. These receipts remain separate from perceptual inspection.

Three Workflow projects (SkillRoster, Pixelle, and Kanban) were independently
drawn on each of four arms. All 12 runs exhausted their repair budgets without
delivery. Public commands, candidate snapshots, results, and five-question
post-run interviews are retained for every arm. This does **not** establish an
improvement in independent generation success rate. The three optimized runs
preserved semantic content through their internal repairs. An earlier Kanban
arm instead changed a return into a terminal; the semantic audit explicitly
excludes that change from geometry-only evidence.

A separate, assisted Kanban diagnosis recovered its final draft by changing
one explicit node width from 168 to 172. The automatic source font returned
from 7.8 to 8px, while the canvas grew from 1227 to 1229px; projection rose
from 5.912 to 6.054px. Complete finalize passed with all other semantic and
route fields unchanged. This is an input repair, not an engine-only recovery
or independent generation success.

The interviews suggested that readability checked only one node. Source
inspection disproved that mechanism: the checker scans all semantic text and
reports the worst projection. The previous 1240px canvas advice was valid for
the previous 8px font. Shrinking every node changed font fitting and therefore
changed the limiting constraint. An actionable follow-up is to expose this
dependency, rather than treating the interview's inference as a confirmed bug.

## Feedback iteration after the interviews

The new Pixelle run ended with an opaque `workflow/route-preset-conflict` on
a legal 66px straight segment. Isolated predicate measurements showed that
its label intersected a neighboring pinned return segment: clearance 0px,
required 4px. The new diagnostic retains the same code, rejection, and
verified-repair semantics while adding the actual predicate, both edges,
authored JSON paths, label rectangle, blocking segment, and measured distance.
Directional failures do not invent label evidence. The CLI's readability
advice also now warns that narrowing node boxes can shrink automatically
fitted text and invalidate the previous canvas-width bound.

The i3 frozen package is
`6c781def16c8c84e83728f889fa0a675201c7599974ca38effda90970b6d1529`.
All 93 controlled inputs were replayed: statuses and successful SVGs remained
identical to i2. Workflow and related diagnostic contracts passed 241/241;
the CLI repair-receipt suite passed 8/8. Independent review passed 22 focused
checks and confirmed public validate/partial-layout evidence propagation.

The original Pixelle Agent then resumed its own failed draft in an isolated
checkout with i3, without receiving the diagnosis or coordinate answer. Two
geometry repairs preserved all 26 nodes, 39 edges, text, conditions, sources,
and mainPath, but still failed. This continuation is separate from the 12
independent runs. The first repair used the new label evidence; it did not
produce complete delivery.

Further isolated measurement explains the remaining failure: adding
`labelDx=-12` activates the existing source-relative explicit-offset anchor.
The baseline label moves vertically from 429 to 386 as well as horizontally,
placing its rectangle inside the media node. The earlier label/return pair
is now clear, but a preceding node-label predicate rejects the scene before
the newly instrumented predicate. A disappearing diagnostic therefore cannot
be interpreted as complete acceptance. Changing this anchoring contract
needs a separate compatibility decision and representative layout evidence;
this patch preserves it and retains the exact reproduction.
One measured, explicitly assisted `labelAt` repair restored the original
vertical anchor but exposed a second pinned retry segment crossing that
label. It also remains a failed attempt; no artifact or browser acceptance is
claimed. This is evidence for considering the interacting return corridors
together, rather than counting the disappearance of one local conflict.

The final archive is
`b82412f4bc72ded149f05e0ee9df0831ea4e0ed9d929a172fd3462a0fcb69177`.
It differs from i3 only in one advice string explaining `labelAt` precedence
over `labelDx`/`labelDy`; exact replacement was verified and the four public
diagnostic tests passed again. This wording refinement does not change
rendering or acceptance decisions. The final extracted package was smoke
tested through a negative public receipt and successful complete finalize.
The full i1 repository gate and i2 browser gate are explicitly reused, with
the later affected diagnostics and fixed-input checks recorded above.

## Visual and performance limits

The four recovered diagrams were inspected in light and dark themes at
1366×900; the tall Pixelle diagram was also inspected through its middle and
bottom. Kanban's assisted output was inspected separately. Main structures
are visible, but some default-size context text remains small, especially in
Pixelle. Its 25%, 100% reset, and 150% zoom states were exercised after
transitions settled; magnification helps reading and requires panning. Passing
the existing 6px floor is not a claim of ideal perceptual readability.

The new Workflow fallback adds at most two alternative planning passes for
eligible unpinned failures (three plans total), or one port recovery pass for
the separate pinned-side case (two total). Each plan uses the existing maximum
four layout-feedback attempts. These branches are mutually exclusive; nested
repair verification cannot re-enter the fallback. Successful default output
does not enter either recovery path. Single-run timings are saved with the
commands, but concurrent test load prevents interpreting them as an isolated
performance benchmark.

Complex long shared corridors, exception fan-in, and additional retry-route
conflicts remain unresolved. Enlarging the shared-trunk exemption would hide
real ambiguity, and an isolated fan-in capacity experiment did not produce a
fully valid result. Native ERD self references remain outside this patch.
The local `usage-iteration` report links all frozen packages, source diffs,
public trajectories, interviews, semantic audits, per-command receipts,
screenshots, and unresolved diagnostic tickets. No live installation, remote
publication, or merge was performed.
