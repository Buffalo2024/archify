import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// External repository examples are finalized against immutable checkouts.
// Their verified outputs are build inputs, so ordinary site builds stay offline.
export function verifiedGalleryArtifact(directory, item, sourceBuffer) {
  const receipt = JSON.parse(fs.readFileSync(path.join(directory, `${item.id}.receipt.json`), 'utf8'));
  const artifact = fs.readFileSync(path.join(directory, item.output));
  // Git stores these text inputs with LF. Verify that exact representation
  // before accepting a receipt, including files written by Windows authoring tools.
  if (sourceBuffer.includes(Buffer.from('\r\n')) || artifact.includes(Buffer.from('\r\n'))) {
    throw new Error(`${item.id}: frozen Gallery inputs must use LF line endings; convert the input and rerun finalize`);
  }
  const hash = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
  const source = JSON.parse(sourceBuffer.toString('utf8'));
  if (receipt.ok !== true || receipt.quality !== 'showcase'
      || ['validate', 'deliver', 'check', 'browser-check'].some((gate) => receipt.gates?.[gate] !== 'pass')
      || receipt.specification?.sha256 !== hash(sourceBuffer)
      || receipt.artifact?.sha256 !== hash(artifact)
      || receipt.repository?.url !== source.meta?.repository?.url
      || receipt.repository?.revision !== source.meta?.repository?.revision) {
    throw new Error(`${item.id}: source-backed example changed or lacks a passing finalize receipt; regenerate against its pinned repository`);
  }
  return artifact;
}
