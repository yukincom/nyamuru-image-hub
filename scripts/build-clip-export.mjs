import { spawnSync } from 'node:child_process';
import { mkdirSync, copyFileSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const target=resolve(root,'.local-clip-export/target');
const cargo=process.env.NYAMURU_CARGO||'cargo';
const args=['build','--release','--locked','--manifest-path',resolve(root,'scripts/clip-export/Cargo.toml'),'--target-dir',target,'-p','nyamuru-clip-export'];
const result=spawnSync(cargo,args,{cwd:root,stdio:'inherit',env:process.env});
if(result.error){console.error('CLIP書き出しの構築にはRust 1.88以降が必要です。cargoをPATHに設定するかNYAMURU_CARGOで指定してください。');process.exit(1);}
if(result.status!==0)process.exit(result.status??1);
const name=process.platform==='win32'?'nyamuru-clip-export.exe':'nyamuru-clip-export';
const directory=resolve(root,'.local-clip-export/bin');mkdirSync(directory,{recursive:true});
copyFileSync(resolve(target,'release',name),resolve(directory,name));
if(process.platform!=='win32')chmodSync(resolve(directory,name),0o755);
console.log('CLIP書き出しを準備しました。');
