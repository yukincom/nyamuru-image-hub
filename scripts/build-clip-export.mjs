import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const target=resolve(root,'.local-clip-export/target');
const cargo=process.env.NYAMURU_CARGO||'cargo';
const offline=process.env.NYAMURU_CARGO_OFFLINE==='1'?['--offline']:[];
const args=['build','--release','--locked',...offline,'--manifest-path',resolve(root,'scripts/clip-export/Cargo.toml'),'--target-dir',target,'-p','nyamuru-clip-export'];
const result=spawnSync(cargo,args,{cwd:root,stdio:'inherit',env:process.env});
if(result.error){console.error('CLIP書き出しの構築にはRust 1.88以降が必要です。cargoをPATHに設定するかNYAMURU_CARGOで指定してください。');process.exit(1);}
if(result.status!==0)process.exit(result.status??1);
const ext=process.platform==='win32'?'.exe':'';
const name=`nyamuru-clip-export${ext}`;
const directory=resolve(root,'.local-clip-export/bin');mkdirSync(directory,{recursive:true});
copyFileSync(resolve(target,'release',name),resolve(directory,name));
if(process.platform!=='win32')chmodSync(resolve(directory,name),0o755);

const lineTraceManifest=resolve(root,'../line-trace-strokes/Cargo.toml');
if(existsSync(lineTraceManifest)){
  const traceTarget=resolve(root,'../line-trace-strokes/target');
  const traceCargoHome=resolve(root,'../line-trace-strokes/.local-cargo');
  const traceEnv={...process.env,...(existsSync(traceCargoHome)?{CARGO_HOME:traceCargoHome}:{})};
  const traceOffline=existsSync(traceCargoHome)?['--offline']:offline;
  const traceResult=spawnSync(cargo,['build','--release','--locked',...traceOffline,'--manifest-path',lineTraceManifest,'--target-dir',traceTarget,'-p','line-trace-cli'],{cwd:root,stdio:'inherit',env:traceEnv});
  if(traceResult.status===0){
    const traceBin=`line-trace-rs${ext}`,destBin=`nyamuru-line-trace${ext}`;
    copyFileSync(resolve(traceTarget,'release',traceBin),resolve(directory,destBin));
    if(process.platform!=='win32')chmodSync(resolve(directory,destBin),0o755);
  }
}
console.log('CLIP書き出しを準備しました。');
