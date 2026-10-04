# Readable automatic diagram layout

Comparison base: `dev@f86769d56884f3b80d7410220d8fc3f12515b9a2`.
The additional reference is `main@7158026e852f3aa6578c741e673b46d7878c92c1`.

The maintainer requested this change on 2026-10-04 after reviewing real
generated diagrams, and explicitly authorized revising defaults when that
improves readability while retaining performance and compatibility.

## Problem and selected behavior

Long Sequence and Waterfall diagrams were fitted to the viewport height even
when substantial horizontal room was available. A single-table ERD had the
opposite problem: a 456px canvas grew to 1827px on a large desktop. Increasing
the waterfall's authored axis width used more space but did not improve its
screen text size, so the fix belongs primarily in the Reader.

- Automatic Sequence and Waterfall canvases use desktop reading width and
  normal vertical page scrolling. Present remains available for a full overview.
- Automatic canvases stop enlarging at 1.5 times their authored width. The
  existing 960px shell floor keeps the header and controls usable; it does not
  force the drawing itself to grow.
- A Sequence with neither `meta.viewBox` nor `meta.column_fit` defaults to the
  existing spread layout. Explicit fixed columns and an explicit viewBox with
  omitted fit retain their historical geometry.
- The advisory Sequence width measurement counts content visible in READ.
  Fine-detail text and its group-contained label plates remain in the artifact
  and existing validity checks, but no longer disguise visible unused space.

This changes automatic presentation defaults, not topology, time values,
schema validity, quality thresholds, source evidence, or waterfall axis width.
Other diagram families retain height fitting, subject to the automatic
enlargement cap. Explicit viewBox, embed, print and presentation retain their
own sizing behavior. The cap does not limit user zoom; camera 100% remains
relative to the fitted Reader size.

## Fixed-input compatibility and visual evidence

The local comparison froze 43 original candidates across all ten diagram
types. Only each arm's output path changed; source content hashes were checked.
Private project inputs and captures remain outside the repository and package.
Committed regression fixtures use anonymous content.

| Arm | Supported inputs | Render and artifact checks | Browser result |
| --- | ---: | ---: | --- |
| main | 23 | 23 passed | 21 passed; 2 existing dataflow failures |
| dev | 43 | 43 passed | 41 passed; the same 2 failures |
| candidate | 43 | 43 passed | 41 passed; the same 2 failures |

The 20 unsupported main cases are marked unsupported, not passed or failed.
The 109 browser runs measured four desktop viewports and produced 436 light
and dark screenshots. Candidate introduced no new failure in this corpus.
All 43 viewBoxes stayed identical; 41 SVGs were byte-identical to dev. Only
the two automatic Sequence samples changed their column positions as intended.

At 1440px viewport width, four long Waterfall drawings grew from 688–764px to
1346px on screen, retaining their complete authored geometry and scrolling.
The small 456px ERD stopped at 684px instead of 1827px at 2048px viewport width.
The reported Sequence cases spread their participants or, where already
spread, retained their geometry while gaining reading width.

An independent reviewer inspected dense representatives of all ten types and
the reported cases. Existing small member/context text in some Class/Tree
samples remains a separate readability limitation; this is not a claim that
every possible diagram is now comfortable at overview scale.

## Actual authoring and interaction checks

Ten fresh independent GPT-6.1 Sol medium agents used a frozen candidate package,
empty output directories, and the original repository commits and requests.
Nine produced artifacts passing all four finalize gates. One Workflow stopped
at a route-preset conflict; replaying that exact input on main, dev and candidate
returned the same error, edge and measured route. All failed attempts, public
commands, candidate snapshots, timing and token records were retained. These
fresh runs validate normal use; they are not a controlled speed comparison.

The nine completed artifacts passed screenshot capture, and were independently
visually inspected. Fresh Sequence authoring omitted viewBox and column fit,
confirming the automatic spread default; the new long Waterfall and small ERD
also used the intended automatic behavior.

Five actual diagrams at 1440×900 and 2048×1320 passed zoom/reset,
Present/return, notes-panel placement/collapse, and scrolling to the last
legend without horizontal overflow. Complete SVG and PNG exports of a long
Waterfall, long Sequence and small ERD retained their final content. Sixteen
actual viewport resize observations returned consistent dimensions without
oscillation; stable-layout waits took 319–364ms in that bounded run. No speedup
or general performance guarantee is inferred from those measurements.

## Reproduction and generated artifacts

Public regression coverage is in `test/sequence-column-fit.test.mjs`,
`test/sequence-width-review.test.mjs`, and `test/reader-layout-browser.test.mjs`.
It covers explicit-geometry compatibility, visible versus hidden width,
retained numeric validity checks, long reading canvases, small-canvas scale,
presentation, reset, export, and layout settling.

The Viewer template, both sets of bundled examples, the legacy web-app Viewer
blocks, Checkout comparison and receipt, Gallery artifacts, README proof and
canonical ZIP were rebuilt from the combined source. Guide and Start were
also regenerated; outputs with unchanged authoritative content stay unchanged.
The ZIP used official Node 22.23.2 with bundled zlib `1.3.1-e00f703`. Extracted
package smoke checks run outside the checkout without node_modules.

Local validation used official Node 22.23.2 and desktop Chrome:

- Independent focused review: 27 passed, no failures or skips.
- Shared `npm run test:browser`: 286 passed, no failures or skips.
- `npm run test:webm`: completed successfully; the exported video decoded into
  ten sampled frames with ten distinct frames, and site-language integration
  passed all seven tests.
- The extracted ZIP passed complete finalize for an automatic Sequence, a
  48-row Waterfall and a small ERD. All 146 packaged files matched the frozen
  package used by the authoring agents and fixed-input comparison.
- The full `npm test` run completed 2,592 tests: 2,500 passed, 91 skipped,
  and one update-check deadline failure:
  `delivery-update.test.mjs` expected `check-failed` but received `timeout` at
  the 600ms deadline. The test and update-check implementation are unchanged
  from dev. The isolated test and then its entire eight-test file passed on
  recheck; the original failure is retained, and its exact scheduling/IO cause
  was not established. It is not described as an initially green full suite.

Optional/platform skips are separate from browser passes. These checks bound
the no-regression claim to the recorded inputs, environments and interactions.
