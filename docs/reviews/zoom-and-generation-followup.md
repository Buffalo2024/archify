# Zoom and generation-failure follow-up

This follows `b0ea86c2` on `codex/readable-diagram-layout`, based on
`dev@f86769d56884f3b80d7410220d8fc3f12515b9a2`. The main reference remains
`7158026e852f3aa6578c741e673b46d7878c92c1`; both remote branches were refreshed
before this follow-up. The maintainer requested investigation of generation
failures and manual zoom below 100%.

## Behavior

Manual camera zoom now spans 25–300%, in 25% steps. Reset remains 100% of the
Reader's fitted size. Smaller canvases center in the visible viewport;
long diagrams keep a visible reading region by adjusting document scroll.
Mobile wide diagrams account for native horizontal scrolling when centering.
Semantic focus still uses its existing zoom range. Reader geometry, Present,
and full-diagram export retain their separate contracts. The existing Viewer
chrome owns navigation placement; no additional layout owner was introduced.

Explicit Dataflow canvases now declare the same authored-height document-flow
contract as explicit Architecture canvases. Coordinates, aspect ratio, Reader
width and page dimensions are unchanged. Browser acceptance still requires
readable text, no horizontal overflow, an unclipped SVG, and normal document
scrolling; fixed-height clipping and internal scrollers are negative tests.

An automatic schema-v2 Workflow also declares intrinsic-height fitting when
its compiled canvas would otherwise have fixed-width viewport overflow. The
previous tall-group behavior remains. Explicit viewBox, schema-v1, compact
layouts and all routing constraints remain authoritative.

## Failure audit and limits

The prior 43-artifact comparison did not include five original attempts that
stopped before producing HTML. This follow-up audits those five, the two
original browser failures, and the subsequent failed Workflow trial, using
frozen candidate hashes and public command/receipt trajectories.

The two Dataflow inputs now pass without authoring changes. One ERD requires
a 20px waypoint correction. One Workflow requires releasing five optional
route/endpoint constraints, followed by the automatic-height fix above.
The latter two are separate authored repairs, not claims that the renderer
silently overrides explicit pins. Machine checks preserve every node,
relationship, label, role, source reference and other non-geometry field.

Four other authored inputs remain unsuccessful: two workflows still contain
crossings or ambiguous corridors; a Class and another Workflow expose
projected-text/readability failures after their first geometric defect is
repaired. A first routing exception can hide later failures, and a suggested
local fix can expose another gate. The investigation does not treat a locally
feasible route repair as proof that complete finalization will pass.

Private project JSON, source references, execution logs, HTML and screenshots
remain outside the repository and package. Public regression fixtures are
anonymous. No live installation, remote push, merge or release is included.

## Verification scope

Focused camera tests use real Chrome, including page-top/middle/bottom zoom,
360px wide-canvas native scrolling, reset, Finder/Focus, Present and export.
Independent review found two initial camera defects (offscreen long content
and narrow-screen centering); both were fixed and independently reproduced as
passing. The Dataflow gate change has clipping/internal-scroll negative tests;
the automatic Workflow case has implicit/explicit/v1 compatibility checks.

The complete integration receipt is recorded with the local follow-up gallery;
source-specific test results do not substitute for the final integration run.
CSS camera transforms retain the original document layout height when zoomed
out, so a long diagram can have empty space below its smaller overview.

## Final integration results

- All 43 existing artifact inputs pass candidate render/check/browser verification;
  SVG geometry matches the preceding candidate after removing intended root fit/type
  declarations. Main/dev comparisons reuse the same frozen base revisions and inputs.
- The eight failed inputs were also replayed across main, dev and candidate (24 arms;
  main has unsupported-type outcomes where appropriate). Two unchanged Dataflow
  inputs now pass. The two authored-repair artifacts pass all four finalize stages
  with the final extracted ZIP. Four audited inputs remain failed as described above.
- Focused real-Chrome camera coverage: 17 passed, no failures or skips. Real WebM
  decoding and the separate site-language integration gate passed.
- Full `npm test`: 2,501 passed, one failed, 92 optional browser tests skipped.
  The failure is the unchanged delivery-update slow-network 600ms deadline test;
  its entire eight-test file passed in isolation without source changes.
- Initial shared browser gate: 265 passed, 26 failed, no skips. Counts include
  parent and nested tests. One stale Radar source-formula assertion was replaced
  with numerical viewport behavior checks and a real-Chrome 25% full-map check.
  Other failures were CDP timeouts and subsequent cleanup errors. Every failing
  group was then rerun serially: 11 files, 93 tests passed, no failures or skips.
  This is not a claim that the initial complete browser run was green, or that
  resource contention has been proven to be the sole timeout cause.
- Independent review examined the final camera, height contracts and Radar tests.
  Frozen source hashes, all 146 extracted package files and clean package-manifest
  staging match the final canonical ZIP. No remote CI, merge or installation is claimed.

The local evidence folder `layout-followup` contains `acceptance.json`, the
original complete logs, `isolated-browser-test.json`, all isolated logs,
`fixed-input/summary.json`, `failure-replay/summary.json`,
`recovered/summary.json`, `integrity.json` and the interactive HTML index.
