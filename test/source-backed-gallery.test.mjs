import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {verifiedGalleryArtifact} from '../scripts/source-backed-gallery.mjs';

const directory=new URL('../website/examples/',import.meta.url);
for(const id of ['bagel-inference','lance-query']) {
  test(`${id} publishes only its finalized source and artifact`,()=>{
    const item={id,input:`${id}.architecture.json`,output:`${id}.architecture.html`};
    const source=fs.readFileSync(new URL(item.input,directory));
    const output=verifiedGalleryArtifact(fileURLToPath(directory),item,source);
    assert.ok(output.length>0);
    assert.throws(()=>verifiedGalleryArtifact(fileURLToPath(directory),item,Buffer.concat([source,Buffer.from(' ')])),/changed or lacks/);
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'archify-source-gallery-'));
    try {
      fs.copyFileSync(new URL(`${id}.receipt.json`,directory),path.join(tmp,`${id}.receipt.json`));
      fs.writeFileSync(path.join(tmp,item.output),Buffer.concat([output,Buffer.from('changed')]));
      assert.throws(()=>verifiedGalleryArtifact(tmp,item,source),/changed or lacks/);
      fs.writeFileSync(path.join(tmp,item.output),output);
      const receipt=JSON.parse(fs.readFileSync(path.join(tmp,`${id}.receipt.json`)));
      receipt.gates['browser-check']='not-run';
      fs.writeFileSync(path.join(tmp,`${id}.receipt.json`),JSON.stringify(receipt));
      assert.throws(()=>verifiedGalleryArtifact(tmp,item,source),/changed or lacks/);
    } finally {fs.rmSync(tmp,{recursive:true,force:true});}
  });
}

test('frozen Gallery inputs reject CRLF before Git normalization changes their verified bytes',()=>{
  const id='bagel-inference';
  const item={id,input:`${id}.architecture.json`,output:`${id}.architecture.html`};
  const source=Buffer.from(fs.readFileSync(new URL(item.input,directory),'utf8').replace(/\r?\n/g,'\r\n'));
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'archify-source-gallery-crlf-'));
  try {
    const receipt=JSON.parse(fs.readFileSync(new URL(`${id}.receipt.json`,directory),'utf8'));
    receipt.specification.sha256=createHash('sha256').update(source).digest('hex');
    receipt.specification.bytes=source.length;
    fs.writeFileSync(path.join(tmp,`${id}.receipt.json`),JSON.stringify(receipt));
    fs.copyFileSync(new URL(item.output,directory),path.join(tmp,item.output));
    assert.throws(()=>verifiedGalleryArtifact(tmp,item,source),/LF line endings/);
  } finally {fs.rmSync(tmp,{recursive:true,force:true});}
});
