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
  await browser.cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' });
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.exportAlerts=[];window.alert=message=>exportAlerts.push(String(message));' });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  async function run(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  }
  const click = await createViewerClick({ send, run, timeout: 5000 });
  async function checkArtifact(artifact) {
    await send('Page.navigate', { url: pathToFileURL(artifact).href });
    await run(`new Promise((resolve,reject)=>{const start=performance.now();function sample(){
      if(window.Archify?.focus&&Archify.viewerChromeLayout?.whenStable)return resolve();
      if(performance.now()-start>5000)return reject(new Error('Viewer did not initialize'));
      requestAnimationFrame(sample);
    }sample();})`);
    await run('Archify.viewerChromeLayout.whenStable()');
    const origin = await run(`document.querySelector('svg [data-edge-from]')?.getAttribute('data-edge-from')`);
    assert.ok(origin, `${artifact} provides an authored relationship`);
    assert.equal(await run(`Archify.focus.set(${JSON.stringify(origin)}) && Archify.focus.reach('downstream')`), true);
    const before = await run('Archify.focus.reachabilitySnapshot()');
    assert(before?.nodeIds.length > 1);
    await click('#btn-export');
    const opened = await run(`({snapshot:Archify.focus.reachabilitySnapshot(),
      open:Archify.exportMenu.isOpen(),
      enabled:!document.querySelector('[data-action="reach-share-card"]').disabled,
      hidden:document.querySelector('[data-action="reach-share-card"]').hidden})`);
    assert.deepEqual(opened.snapshot, before, `${artifact} keeps Reach available to Export`);
    assert.equal(opened.open, true);
    assert.equal(opened.enabled, true);
    assert.equal(opened.hidden, false);
    await click('#btn-export');
    assert.deepEqual(await run('Archify.focus.reachabilitySnapshot()'), before);
    await click('#btn-export');
    await run(`document.getElementById('export-menu').addEventListener('click', event=>{
      if(event.target.closest('[data-action="reach-share-card"]')){
        window.exportSelectionClick={trusted:event.isTrusted,snapshot:Archify.focus.reachabilitySnapshot()};
      }
    }, {capture:true,once:true})`);
    await click('#export-menu [data-action="reach-share-card"]');
    assert.deepEqual(await run('exportSelectionClick'), { trusted: true, snapshot: before },
      `${artifact} passes the snapshot to the trusted menu-item action`);
    await run(`new Promise((resolve,reject)=>{const start=performance.now();function sample(){
      const root=document.documentElement;
      if(root.getAttribute('data-last-export-variant')==='reach')return resolve();
      const error=root.getAttribute('data-last-export-error');
      if(error)return reject(new Error(error));
      if(performance.now()-start>5000)return reject(new Error('Reach Share Card did not complete'));
      requestAnimationFrame(sample);
    }sample();})`);
    assert.deepEqual(await run(`['width','height'].map(key=>Number(document.documentElement.getAttribute('data-last-export-'+key)))`), [1200, 630]);
    assert.deepEqual(await run('exportAlerts'), []);
    assert.equal(await run(`Archify.focus.set(${JSON.stringify(origin)}, {toggle:false}) && Archify.focus.reach('downstream')`), true);
    await run(`document.querySelector('.header-row').click()`);
    assert.equal(await run('Archify.focus.reachabilitySnapshot()'), null);
    assert.equal(await run('Archify.focus.active()'), null);
  }
  await checkArtifact(file);
  const repoRoot = path.resolve(skillRoot, '..');
  const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
  const links = new Set(Array.from(readme.matchAll(/\]\((examples\/[^)\s]+\.html)\)/g), match => match[1]));
  const examples = fs.readdirSync(path.join(repoRoot, 'examples'))
    .filter(name => name.endsWith('.architecture.json'))
    .map(name => JSON.parse(fs.readFileSync(path.join(repoRoot, 'examples', name), 'utf8')).meta.output)
    .filter(output => links.has(output));
  assert.ok(examples.length, 'README links architecture examples with authoritative inputs');
  for (const example of examples) await checkArtifact(path.join(repoRoot, example));
});
