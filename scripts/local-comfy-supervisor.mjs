import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { mkdirSync, openSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { watchInitialParent } from './process-lifecycle.mjs';

const thisFile = fileURLToPath(import.meta.url);
const delay = ms => new Promise(done => setTimeout(done, ms));
const running = child => child.exitCode === null && child.signalCode === null && !child.spawnError;
const tokenPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function comfyTarget(value) {
  const url = new URL(value);
  if(url.protocol !== 'http:' || !['localhost','127.0.0.1','[::1]'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('ComfyUI接続先にはlocalhostのHTTPポートを指定してください');
  }
  return { endpoint:url.origin, host:url.hostname.replace(/^\[|\]$/gu,''), port:url.port || '80' };
}

// This is argv parsing, never a shell command. Desktop stores its launch options as text.
function launchArguments(value = '') {
  const words = []; let word = '', quote = '', escaped = false;
  for(const char of value.trim()) {
    if(escaped) { word += char; escaped = false; }
    else if(char === '\\' && quote !== "'") escaped = true;
    else if(quote) { if(char === quote) quote = ''; else word += char; }
    else if(char === '"' || char === "'") quote = char;
    else if(/\s/u.test(char)) { if(word) { words.push(word); word = ''; } }
    else word += char;
  }
  if(quote || escaped) throw new Error('Comfy Desktopの起動引数を確認してください');
  if(word) words.push(word);
  return words.filter((word,index) => {
    if(['--listen','--port','--auto-launch','--disable-auto-launch'].includes(word) || /^(?:--listen|--port)=/u.test(word)) return false;
    return !(['--listen','--port'].includes(words[index-1]) && !word.startsWith('--'));
  });
}

export async function existingComfyLauncher(endpoint, { env = process.env, home = homedir() } = {}) {
  const target = comfyTarget(endpoint);
  const configRoot = env.NYAMURU_COMFY_DESKTOP_CONFIG || resolve(home,'Library/Application Support/Comfy Desktop');
  let root = env.NYAMURU_COMFYUI_DIR, instance, settings = {};
  if(!root) {
    try {
      const instances = JSON.parse(await readFile(resolve(configRoot,'installations.json'),'utf8'));
      instance = instances.filter(item => item.status === 'installed' && item.sourceId !== 'cloud' && typeof item.installPath === 'string')
        .sort((a,b) => (b.lastLaunchedAt ?? 0) - (a.lastLaunchedAt ?? 0))[0];
      if(!instance) throw new Error('no local installation');
      root = resolve(instance.installPath,'ComfyUI');
      settings = JSON.parse(await readFile(resolve(configRoot,'settings.json'),'utf8'));
    } catch {
      throw new Error('導入済みのComfyUIが見つかりません。Comfy Desktopのローカル環境、またはNYAMURU_COMFYUI_DIRを確認してください');
    }
  }
  root = resolve(root);
  const python = env.NYAMURU_COMFYUI_PYTHON || resolve(root,process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python3');
  const main = resolve(root,'main.py');
  await Promise.all([access(python),access(main)]).catch(() => { throw new Error('既存のComfyUI本体とPythonを確認してください。環境の自動インストールは行いません'); });
  const args = ['-s',main,...launchArguments(instance?.launchArgs)];
  if(instance) {
    const modelPaths = resolve(configRoot,'instance-model-paths',`${instance.id}.yaml`);
    await access(modelPaths).catch(() => { throw new Error('Comfy Desktopのモデル参照設定が見つかりません'); });
    if(!args.includes('--extra-model-paths-config')) args.push('--extra-model-paths-config',modelPaths);
    for(const [key,flag] of [['inputDir','--input-directory'],['outputDir','--output-directory']]) {
      if(typeof settings[key] === 'string' && settings[key] && !args.includes(flag)) args.push(flag,settings[key]);
    }
  }
  args.push('--listen',target.host,'--port',target.port,'--disable-auto-launch');
  return { root, python, args };
}

export async function checkComfyState(endpoint, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(`${endpoint}/system_stats`,{ signal:AbortSignal.timeout(1_500),redirect:'error' });
    if(!response.ok) return 'foreign';
    const value = await response.json();
    return typeof value?.system?.comfyui_version === 'string' && Array.isArray(value.devices) ? 'ready' : 'foreign';
  } catch(error) {
    return error?.cause?.code === 'ECONNREFUSED' ? 'missing' : 'unavailable';
  }
}

async function queueIsIdle(endpoint) {
  const response = await fetch(`${endpoint}/queue`,{ signal:AbortSignal.timeout(1_500),redirect:'error' });
  const value = response.ok && await response.json();
  return Array.isArray(value?.queue_running) && Array.isArray(value?.queue_pending)
    && !value.queue_running.length && !value.queue_pending.length;
}

function launchComfy(config, repoRoot) {
  const log = resolve(repoRoot,'.astro/comfyui.log'); mkdirSync(dirname(log),{ recursive:true });
  const fd = openSync(log,'a');
  try {
    const child = spawn(process.execPath,[thisFile,'--run',JSON.stringify(config),String(process.pid)],{
      cwd:config.root, env:process.env, stdio:['ignore',fd,fd],
    });
    child.once('error',error => { child.spawnError = error; });
    return child;
  } finally { closeSync(fd); }
}

async function stopComfy(child) {
  if(!running(child)) return;
  const exited = new Promise(done => child.once('exit',done));
  child.kill('SIGTERM');
  await exited; // The runner bounds Python shutdown and also watches for parent loss.
}

/** One runtime lease belongs to a generation dialog, independently of translation/model leases. */
export class LocalComfyController {
  constructor({ repoRoot, check = checkComfyState, launcher = existingComfyLauncher,
    launch = config => launchComfy(config,repoRoot), stop = stopComfy, isRunning = running,
    idle = queueIsIdle, busy = () => false, sleep = delay, now = Date.now, timeoutMs = 150_000 } = {}) {
    Object.assign(this,{ check,launcher,launch,stop,isRunning,idle,busy,sleep,now,timeoutMs });
    this.child = null; this.endpoint = ''; this.leases = new Set(); this.queue = Promise.resolve(); this.closed = false; this.reaper = null;
  }
  exclusive(task) { const next = this.queue.then(task); this.queue = next.catch(() => undefined); return next; }
  acquire(token,value) {
    if(!tokenPattern.test(token)) throw new Error('生成画面の起動情報が不正です');
    const {endpoint} = comfyTarget(value);
    return this.exclusive(async () => {
      if(this.closed) throw new Error('ComfyUIの起動管理は終了しています');
      if(this.endpoint && this.endpoint !== endpoint && (this.leases.size || this.child)) throw new Error('別のComfyUI接続を使用中です');
      if(this.child && !this.isRunning(this.child)) this.child = null;
      const state = await this.check(endpoint);
      let started = false;
      if(state !== 'ready') {
        if(state !== 'missing') throw new Error('ComfyUIの接続先が応答しないか、別のサービスです');
        if(!this.child) {
          this.child = this.launch(await this.launcher(endpoint)); started = true;
        }
        try {
          const deadline = this.now() + this.timeoutMs;
          while(await this.check(endpoint) !== 'ready') {
            if(!this.isRunning(this.child) || this.now() >= deadline) throw new Error('ComfyUIを起動できませんでした。起動ログ .astro/comfyui.log を確認してください');
            await this.sleep(250);
          }
        } catch(error) {
          if(!this.leases.size) { await this.stop(this.child); this.child = null; }
          throw error;
        }
      }
      this.endpoint = endpoint; this.leases.add(token);
      return { started, managed:Boolean(this.child) };
    });
  }
  async stopIfIdle() {
    if(this.leases.size || !this.child) return false;
    if(!this.isRunning(this.child)) { this.child = null; return false; }
    if(this.busy() || !await this.idle(this.endpoint)) return false;
    await this.stop(this.child); this.child = null; this.endpoint = ''; clearTimeout(this.reaper); this.reaper = null; return true;
  }
  scheduleStop() {
    if(this.reaper || !this.child) return;
    this.reaper = setTimeout(() => {
      this.reaper = null;
      void this.exclusive(async () => {
        try { await this.stopIfIdle(); }
        finally { if(!this.leases.size && this.child) this.scheduleStop(); }
      }).catch(error => console.error('ComfyUI終了確認:',error.message));
    },1_000);
    this.reaper.unref();
  }
  release(token) {
    return this.exclusive(async () => {
      const released = this.leases.delete(token);
      let stopped;
      try { stopped = await this.stopIfIdle(); }
      finally { if(!this.leases.size && this.child) this.scheduleStop(); }
      return { released, stopped, managed:Boolean(this.child) };
    });
  }
  async close() {
    this.closed = true;
    return this.exclusive(async () => {
      this.leases.clear(); clearTimeout(this.reaper); this.reaper = null;
      if(this.child) { await this.stop(this.child); this.child = null; }
    });
  }
}

if(process.argv[1] && resolve(process.argv[1]) === thisFile && process.argv[2] === '--run') {
  const config = JSON.parse(process.argv[3]), parentPid = Number(process.argv[4]);
  if(!Number.isSafeInteger(parentPid) || parentPid <= 1 || process.ppid !== parentPid) process.exit(1);
  const child = spawn(config.python,config.args,{ cwd:config.root,env:process.env,stdio:['ignore','inherit','inherit'],detached:process.platform !== 'win32' });
  let stopping = false;
  const signalChild = signal => {
    try { if(process.platform === 'win32') child.kill(signal); else process.kill(-child.pid,signal); }
    catch(error) { if(error.code !== 'ESRCH') throw error; }
  };
  const stop = () => {
    if(stopping) return; stopping = true; signalChild('SIGTERM');
    const timer = setTimeout(() => signalChild('SIGKILL'),5_000); timer.unref();
  };
  const unwatch = watchInitialParent(stop,{ parentPid });
  for(const signal of ['SIGINT','SIGTERM','SIGHUP','SIGQUIT']) process.on(signal,stop);
  child.once('error',error => { console.error(error.message); unwatch(); process.exit(1); });
  child.once('exit',code => { unwatch(); process.exit(code ?? 0); });
}
