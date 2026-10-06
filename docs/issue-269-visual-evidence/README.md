# Subarchitecture refresh evidence

Comparison base: `68b77b73eaf12297356d122968d9b7b8767be278` (`dev`). The candidate is the merged source accompanying these artifacts. Scope follows the [maintainer's request](https://github.com/tt-a1i/archify/pull/269#issuecomment-5909452518): bounded component internals, laptop readability, return navigation, independent child exports, and preserved parent behavior.

## Try the interactive example

Download [the self-contained Transformer artifact](../gallery/artifacts/transformer-layer.architecture.html) and open it locally in Chrome. Its [typed source](../../archify/examples/transformer-layer.architecture.json) is included.

1. Select **Transformer Layer** in the main graph and open its internals from Semantic Passport.
2. Inspect a child component; use **Back to model**, Close, or Escape to return.
3. Open the child again. In Export, select **Current subarchitecture**, then export SVG or PNG. The default target is the main architecture.

## Visual evidence

Screenshots use light theme, Classic preset, device scale 1, and still motion. The child graph occupies the available width; Semantic Passport moves below it on laptop screens. The back control stays visible. Narrower screens retain horizontal scrolling for the graph.

| Main, 1366 × 768 | Child, 1366 × 768 |
| --- | --- |
| ![Main architecture](1366x768-main.png) | ![Complete child architecture](1366x768-child.png) |

[Child at 1280 × 720](1280x720-child.png), [independent child PNG](transformer-child.png), and [independent child SVG](transformer-child.svg) are also included. The PNG and SVG contain the child graph without the drawer, Passport, or parent graph. The laptop screenshots were visually inspected for complete topology and readable primary labels; automated bounds/text-size checks are separate evidence.

## Compatibility and automated evidence

[receipt.json](receipt.json) records measured laptop geometry and fixed-input base/candidate comparisons. Five unchanged inputs cover two Architecture examples, Workflow, Sequence, and ERD. Their canonical SVG bytes match the base. Exported SVG graph attributes match in all three theme variants, and decoded PNG/JPEG/WebP pixels match. This compares old inputs on both revisions; regenerated goldens alone are not the compatibility evidence.

The maintained regressions are reproducible from the repository root:

```sh
node --test test/subarchitecture-*.test.mjs test/architecture-compiler.test.mjs
ARCHIFY_CHROME=/path/to/chrome node --test test/subarchitecture-browser.test.mjs
ARCHIFY_CHROME=/path/to/chrome node --test test/desktop-reader-browser.test.mjs test/export-browser.test.mjs
node test/golden.mjs
node --test test/gallery.test.mjs test/guide.test.mjs test/guide-page.test.mjs test/readme-showcase.test.mjs
```

The browser regression covers pointer/keyboard entry, Escape, deep links, parent layout/camera/scroll preservation, local focus and motion, themes/presets, child export isolation, and rejected tampered export roots. The representative example additionally checks 1366 × 768 and 1280 × 720 viewports.

## Practical limits

Children remain one level deep, with 1–12 local components and no cross-scope connections. Print, Embed, Route, Reachability, and WebM retain their main-graph behavior. Child SVG/raster/clipboard exports and its optional Share Card are supported. At narrow viewport widths the child uses scrolling rather than compressing an arbitrarily large graph.

In this example, child primary labels measure approximately 12.6 px at 1366 × 768 and 11.4 px at 1280 × 720. Opening a populated Passport spends some of the graph's height budget; the latter viewport then measures approximately 9.7 px. This is a practical limit of fitting the entire graph and its selected-component details into a short laptop viewport. Exported graph dimensions remain independent of that viewport.

Remote engineering CI on the updated head is required before integration. Windows full-suite failures are recorded in the PR description; local focused checks are not a substitute for that remote result.
