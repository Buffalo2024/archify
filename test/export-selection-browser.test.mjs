import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findChrome } from '../archify/bin/visual-check.mjs';
import { desktopBrowser } from './helpers/desktop-browser.mjs';
import { createViewerClick } from './helpers/viewer-click.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;

test('Export menu preserves authored reach until genuine outside dismissal', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run real-browser Export selection checks.',
}, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-export-selection-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'architecture.html');
  execFileSync(process.execPath, [
    path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'),
    path.join(skillRoot, 'examples/web-app.architecture.json'),
    file,
  ]);
  const browser = desktopBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  async function run(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  }
  const click = await createViewerClick({ send, run, timeout: 5000 });
  await send('Page.navigate', { url: pathToFileURL(file).href });
  await run(`new Promise((resolve,reject)=>{const start=performance.now();function sample(){
    if(window.Archify?.focus&&Archify.viewerChromeLayout?.whenStable)return resolve();
    if(performance.now()-start>5000)return reject(new Error('Viewer did not initialize'));
    requestAnimationFrame(sample);
  }sample();})`);
  assert.equal(await run(`Archify.focus.set('api') && Archify.focus.reach('downstream')`), true);
  const before = await run('Archify.focus.reachabilitySnapshot()');
  assert(before?.nodeIds.length > 1);
  await click('#btn-export');
  const opened = await run(`({snapshot:Archify.focus.reachabilitySnapshot(),
    open:Archify.exportMenu.isOpen(),
    enabled:!document.querySelector('[data-action="reach-share-card"]').disabled,
    hidden:document.querySelector('[data-action="reach-share-card"]').hidden})`);
  assert.deepEqual(opened.snapshot, before);
  assert.equal(opened.open, true);
  assert.equal(opened.enabled, true);
  assert.equal(opened.hidden, false);
  await click('#btn-export');
  assert.deepEqual(await run('Archify.focus.reachabilitySnapshot()'), before);
  await run(`document.querySelector('.header-row').click()`);
  assert.equal(await run('Archify.focus.reachabilitySnapshot()'), null);
  assert.equal(await run('Archify.focus.active()'), null);
});
