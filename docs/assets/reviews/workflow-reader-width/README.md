# Workflow stack reading width

Comparison base: `e23fc2c5c8cf1aaa3864e7966f8b8ec43dc2bebd` (`dev`). The candidate changes only the existing automatic stacked-Workflow Reader declaration from `intrinsic-height` to `width-first`. The inputs are original synthetic public examples, not redactions or copies of a private project. They illustrate two layout shapes; they are not an agent generation benchmark and do not establish a first-pass success rate.

All four screenshots use Chrome, **1440 × 1000**, light theme, `signal-flow`, showcase quality, camera **100%**, and page top. No private source or internal project content is included. The browser waits for fonts and layout settling, then captures the viewport. The JSON records actual primary-label pixel font sizes from computed fonts and SVG screen transforms, document scrolling, horizontal overflow, and a separate bottom-scroll observation.

| Synthetic input | dev before | Candidate after | Minimum actual primary-label font | Document scroll beyond viewport | Horizontal overflow |
| --- | --- | --- | --- | --- | --- |
| [One lane, five stages](../../../../test/fixtures/reader-readability/five-stage-stack.workflow.json) | [Before](five-stage-stack-before.png) | [After](five-stage-stack-after.png) | 12.04 → 15.00 px | 136 → 289 px | false → false |
| [Execution and failure lanes](../../../../test/fixtures/reader-readability/execution-failure-stack.workflow.json) | [Before](execution-failure-stack-before.png) | [After](execution-failure-stack-after.png) | 10.24 → 15.00 px | 199 → 549 px | false → false |

Both candidates reach the existing 1.5× SVG enlargement cap. Larger labels cost more vertical page scrolling. The Dock temporarily overlays the SVG area at the viewport floor on the initial screen; no primary node rectangles intersect the Dock in these examples. Bottom scrolling exposes the remaining stages completely. This evidence does not establish that the balance is optimal: maintainers should judge the before/after images and the readability-versus-overview tradeoff. The existing `visual-check` reports minimum projected text conservatively with a scale capped at 1, so its 8px result is distinct from the actual displayed primary-label font measurements above.

## Reproduce

Use official Node 22, Chrome, and install both root and `archify/` dependencies in the candidate. Use a clean checkout or archive of the pinned base as `/tmp/archify-pr4-baseline`, with its renderer dependencies installed. From the candidate repository root:

```sh
export ARCHIFY_CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
node scripts/capture-workflow-reader-width.mjs /tmp/archify-pr4-baseline /tmp/workflow-reader-width-evidence
node archify/bin/archify.mjs render workflow test/fixtures/reader-readability/five-stage-stack.workflow.json /tmp/five-stage-stack.html --quality showcase
node archify/bin/archify.mjs render workflow test/fixtures/reader-readability/execution-failure-stack.workflow.json /tmp/execution-failure-stack.html --quality showcase
node archify/bin/archify.mjs visual-check /tmp/five-stage-stack.html --json
node archify/bin/archify.mjs visual-check /tmp/execution-failure-stack.html --json
node --test test/workflow-compiler.test.mjs
node test/golden.mjs
npm --prefix archify run check:validators
node --test test/desktop-reader-browser.test.mjs test/reader-layout-browser.test.mjs
```

The capture output directory must not already contain the screenshot names (the browser writes them exclusively). [Measurements](measurements.json) preserve the full per-label values. Browser checks establish containment, readability floors, the enlargement cap, and retained authored geometry; they are separate from maintainer perceptual review. Embed, Present, and print remain on their previous layout path.
