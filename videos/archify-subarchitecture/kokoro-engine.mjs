import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const result=spawnSync(process.env.HYPERFRAMES_PYTHON,[fileURLToPath(new URL('kokoro-engine.py',import.meta.url)),...process.argv.slice(2)],{stdio:'inherit'});
process.exit(result.status??1);
