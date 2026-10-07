// Public synthetic evidence, fixed input and browser conditions on both revisions.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const beforeRoot = process.argv[2];
if (!beforeRoot) throw new Error('Usage: node scripts/capture-workflow-reader-width.mjs <baseline-checkout> [output-directory]');
const output = path.resolve(process.argv[3] || path.join(root, 'docs/assets/reviews/workflow-reader-width'));
fs.mkdirSync(output, { recursive: true });
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-workflow-width-'));
const browser = new ChromeVisualBrowser(findChrome());
const records = [];
try {
  for (const name of ['five-stage-stack', 'execution-failure-stack']) {
    const input = path.join(root, 'test/fixtures/reader-readability', `${name}.workflow.json`);
    let baselineHtml;
    for (const [revision, checkout] of [['before', path.resolve(beforeRoot)], ['after', root]]) {
      const artifact = path.join(scratch, `${name}-${revision}.html`);
      execFileSync(process.execPath, [path.join(checkout, 'archify/bin/archify.mjs'), 'render', 'workflow', input, artifact, '--quality', 'showcase']);
      const html = fs.readFileSync(artifact, 'utf8');
      if (revision === 'before') baselineHtml = html;
      else assert.equal(html.replace('data-reader-fit="width-first"', 'data-reader-fit="intrinsic-height"'), baselineHtml, 'Only the reader-fit declaration may differ');
      const screenshot = `${name}-${revision}.png`;
      const metrics = await browser.inspect({ artifactPath: artifact, width: 1440, height: 1000,
        theme: 'light', screenshotPath: path.join(output, screenshot) });
      const session = await browser.sessionPromise;
      const measured = await browser.cdp.send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
        const svg = document.querySelector('.diagram-container svg');
        const fonts = [...svg.querySelectorAll('text[data-node-label]')].map(el => {
          const matrix = el.getScreenCTM();
          return {text: el.textContent.trim(), pixelFont: parseFloat(getComputedStyle(el).fontSize) * Math.hypot(matrix.a, matrix.b)};
        });
        const dock = document.querySelector('.diagram-nav');
        const rect = dock && dock.getBoundingClientRect();
        const coveredNodes = rect ? [...svg.querySelectorAll('g[data-node-id]')].filter(el => {
          const r = el.getBoundingClientRect();
          return r.right > rect.left && r.left < rect.right && r.bottom > rect.top && r.top < rect.bottom;
        }).map(el => el.getAttribute('data-node-id')) : [];
        return {scrollY, scrollHeight: document.documentElement.scrollHeight,
          pageScrollPx: document.documentElement.scrollHeight - innerHeight,
          overflowX: document.documentElement.scrollWidth > innerWidth,
          zoom: document.querySelector('[data-view-percent]')?.textContent || null,
          minimumActualNodeFontPx: Math.min(...fonts.map(f => f.pixelFont)), fonts, dockCoveredNodesAtPageTop: coveredNodes,
          dockOverlapsSvgAtPageTop: Boolean(rect && svg.getBoundingClientRect().bottom > rect.top && svg.getBoundingClientRect().right > rect.left)};
      })()` }, session);
      assert.equal(measured.result.value.zoom, '100%');
      assert.equal(measured.result.value.scrollY, 0);
      assert.equal(measured.result.value.overflowX, false);
      const scroll = await browser.cdp.send('Runtime.evaluate', {returnByValue: true, awaitPromise: true, expression: `(async () => {
        scrollTo(0, document.documentElement.scrollHeight); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const bottoms = [...document.querySelectorAll('.diagram-container svg g[data-node-id]')].map(el => el.getBoundingClientRect().bottom);
        return {scrollY, lowestNodeBottom: Math.max(...bottoms), allNodesAboveViewportBottom: Math.max(...bottoms) <= innerHeight};
      })()`}, session);
      records.push({name, revision, screenshot, viewport: [1440,1000], theme:'light', preset:'signal-flow',
        readerFit: metrics.readerFit, svgWidth: metrics.diagramWidth, viewBoxWidth: metrics.viewBoxWidth,
        gateMinimumProjectedNodeTextPx: metrics.minimumProjectedNodeTextPx,
        ...measured.result.value, bottomScroll: scroll.result.value});
    }
  }
  fs.writeFileSync(path.join(output, 'measurements.json'), JSON.stringify({baseline: 'e23fc2c5c8cf1aaa3864e7966f8b8ec43dc2bebd', records}, null, 2) + '\n');
} finally {
  await browser.close();
  fs.rmSync(scratch, {recursive:true, force:true});
}
