import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from 'parse5';

const cloudflare = process.env.ARCHIFY_SITE_TARGET === 'cloudflare';
const output = new URL(cloudflare ? '../dist-cloudflare/' : '../dist/', import.meta.url);
const nodes = node => [node, ...(node.childNodes || []).flatMap(nodes)];
const attr = (node, name) => node?.attrs?.find(item => item.name === name)?.value;
const pages = ['index', 'start', 'guide', 'gallery', 'community'];

test('built deployment uses host-compatible generated assets and canonical metadata', () => {
  for (const page of pages) {
    const dom = parse(fs.readFileSync(new URL(`${page}.html`, output), 'utf8'));
    const all = nodes(dom);
    const canonical = all.find(node => node.tagName === 'link' && attr(node, 'rel') === 'canonical');
    assert.equal(attr(canonical, 'href'), cloudflare ? `https://archify.si/${page === 'index' ? '' : page}` : undefined, page);
    const generatedAssets = all.flatMap(node => ['src', 'href'].map(name => attr(node, name))).filter(value => value?.includes('/_astro/'));
    for (const asset of generatedAssets) {
      assert.ok(asset.startsWith(cloudflare ? '/_astro/' : '/archify/_astro/'), asset);
      const relative = asset.replace(cloudflare ? /^\// : /^\/archify\//, '').split(/[?#]/)[0];
      assert.ok(fs.existsSync(new URL(relative, output)), asset);
    }
    for (const property of ['og:url', 'og:image']) {
      const meta = all.find(node => attr(node, 'property') === property);
      if (meta) assert.ok(attr(meta, 'content').startsWith(cloudflare ? 'https://archify.si/' : 'https://tt-a1i.github.io/archify/'), `${page}: ${property}`);
    }
  }
});

test('deployment preserves standalone proof and updater bytes and only Cloudflare gets a 404', () => {
  for (const file of ['gallery/artifacts/agent-tool-call.workflow.html', 'skill-updates/archify/stable.json', 'assets/site-language.js']) {
    assert.deepEqual(fs.readFileSync(new URL(file, output)), fs.readFileSync(new URL(`../../docs/${file}`, import.meta.url)), file);
  }
  assert.equal(fs.existsSync(new URL('404.html', output)), cloudflare);
  if (cloudflare) {
    const dom = parse(fs.readFileSync(new URL('404.html', output), 'utf8'));
    assert.ok(nodes(dom).some(node => node.tagName === 'a' && attr(node, 'href') === '/'));
  }
});
