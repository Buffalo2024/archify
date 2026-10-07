# Labs examples

These diagrams were authored with the repository's Archify Skill on `labs/subarchitecture`. They are focused views of official source code. Each node has source links, including nodes inside a child view.

| Example | Official repository revision | Child views |
| --- | --- | --- |
| BAGEL inference | [a2fa77dd8caeefc41e6607ae0ec17408d3f4ee9f](https://github.com/ByteDance-Seed/Bagel/tree/a2fa77dd8caeefc41e6607ae0ec17408d3f4ee9f) | Context assembly and one MoT decoder layer |
| Lance dataset query | [75c7762d426b425f9999be6eb497e105f20b20fc](https://github.com/lance-format/lance/tree/75c7762d426b425f9999be6eb497e105f20b20fc) | Query planning and the Rust to Python Arrow stream |

BAGEL follows `InterleaveInferencer`, cache updates, text completion, flow sampling and VAE decoding. The context child shows text, vision and VAE paths. These paths depend on the requested output mode. The MoT child shows the full decoder computation. Its VAE feed-forward branch runs in generation mode. Classifier-free guidance passes and TaylorSeer shortcuts are outside this view. The drawing is a functional decomposition of shared model code.

Lance follows the Python scanner binding, Rust physical planning, DataFusion execution, projected fragment reads and Arrow batches. Its plan child shows ordinary scans and nearest queries. Filtering, sorting, limits and column takes depend on the query. Some operations may be pushed down or omitted. Aggregation, full-text and minhash search, overlays, index maintenance and writes are outside this view.

## Rebuild from official code

Clone the two official repositories and check out the revisions above. From the Archify root, run these commands with the matching paths. Chrome must be available for the browser gate.

```sh
node archify/bin/archify.mjs finalize architecture website/examples/bagel-inference.architecture.json website/examples/bagel-inference.architecture.html --repo-root /path/to/Bagel --quality showcase --json
node archify/bin/archify.mjs finalize architecture website/examples/lance-query.architecture.json website/examples/lance-query.architecture.html --repo-root /path/to/lance --quality showcase --json
node scripts/refresh-source-gallery-receipts.mjs
node scripts/build-gallery.mjs docs
```

The HTML files here are frozen, verified build inputs for the Gallery. Ordinary site builds check their JSON and HTML digests against the passing finalize records. They do not download external repositories. Changed inputs or failed browser gates require regeneration. These external source examples are kept outside the standalone Skill ZIP.

Use LF line endings for the frozen JSON and HTML files before running finalize. The receipts verify the exact bytes stored by Git.

## Interaction evidence

The three examples and all five children were checked in real Chrome at 1920 × 1080, 1366 × 768 and 1280 × 720. Every complete child graph fits these viewports. Checks also exercised actual SVG downloads, independent main and child targets, parent selection, and return scroll position. At 1366 × 768, BAGEL context labels measure about 13.2 CSS pixels. Selecting a component keeps the graph size stable. [Screenshots and sizing evidence](../../docs/issue-269-visual-evidence/responsive/README.md) record the results. Taller authored graphs can still use page scrolling when a complete fit would make the labels too small.

The [walkthrough](https://github.com/Puuuuup/archify/tree/labs/subarchitecture#try-subarchitecture-in-labs) plays directly in the Labs README. It uses actual browser captures and clicks. Its English narration uses local Kokoro. English and Chinese captions follow separately synthesized sentence durations. The [composition source](../../videos/archify-subarchitecture/README.md) explains reproduction.
