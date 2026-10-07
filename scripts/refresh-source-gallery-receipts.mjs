import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {verifiedGalleryArtifact} from './source-backed-gallery.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=path.join(root,'website/examples');
const generatorCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
for(const id of ['bagel-inference','lance-query']) {
  const input=`${id}.architecture.json`;
  const output=`${id}.architecture.html`;
  const receipt=JSON.parse(fs.readFileSync(path.join(directory,`${id}.architecture.finalize-summary.json`),'utf8'));
  const source=fs.readFileSync(path.join(directory,input));
  const published={schemaVersion:receipt.schemaVersion,ok:receipt.ok,command:receipt.command,status:receipt.status,type:receipt.type,quality:receipt.quality,
    specification:{sha256:receipt.specification.sha256,bytes:receipt.specification.bytes},artifact:{sha256:receipt.artifact.sha256,bytes:receipt.artifact.bytes},gates:receipt.gates,
    repository:JSON.parse(source).meta.repository,generatorCommit,method:'Archify finalize with the pinned official checkout and a real Chrome browser',visualReview:'not-requested'};
  // Verify the complete candidate before replacing the existing receipt.
  const previous=fs.readFileSync(path.join(directory,`${id}.receipt.json`));
  try {
    fs.writeFileSync(path.join(directory,`${id}.receipt.json`),`${JSON.stringify(published,null,2)}\n`);
    verifiedGalleryArtifact(directory,{id,output},source);
  } catch(error) {
    fs.writeFileSync(path.join(directory,`${id}.receipt.json`),previous);
    throw error;
  }
  console.log(`${id}: refreshed verified source receipt`);
}
