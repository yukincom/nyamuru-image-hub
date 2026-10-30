import { spawn } from 'node:child_process';
import { access, readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { watchInitialParent } from './process-lifecycle.mjs';
import { suspendSharedLlm } from './shared-llm-session.mjs';

const thisFile = fileURLToPath(import.meta.url);
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const isRunning = (child) => child.exitCode === null && child.signalCode === null && !child.spawnError;

export const LLM_MODE_MANAGED = 'managed';
export const LLM_MODE_AUTO = 'auto';
export const LLM_MODE_EXTERNAL_SHARED = 'external-shared';
export const SHARED_LLM_MODEL = 'default_model';

export function llmOwnershipMode(env = process.env) {
  const mode = (env.NYAMURU_PANEL_ACTION_LLM_MODE || LLM_MODE_AUTO).trim();
  if (![LLM_MODE_AUTO, LLM_MODE_MANAGED, LLM_MODE_EXTERNAL_SHARED].includes(mode)) {
    throw new Error('NYAMURU_PANEL_ACTION_LLM_MODEは auto・managed・external-shared を指定してください');
  }
  return mode;
}

export function llmTarget(env = process.env) {
  const url = new URL(env.NYAMURU_PANEL_ACTION_LLM_URL || 'http://127.0.0.1:8080/v1/chat/completions');
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash || url.pathname !== '/v1/chat/completions') {
    throw new Error('LLM接続先にはlocalhostの /v1/chat/completions を指定してください');
  }
  return { modelsUrl: `${url.origin}/v1/models`, host: url.hostname.replace(/^\[|\]$/gu, ''), port: url.port || '80' };
}

export function parseModelAliases(config) {
  const models = new Map();
  for (const line of config.split(/\r?\n/u)) {
    const text = line.trim();
    const separator = text.indexOf('=');
    if (text.startsWith('#') || separator < 1 || !text.slice(separator + 1).trim()) continue;
    const alias = text.slice(0, separator).trim();
    // start_server.sh resolves the first matching alias, so mirror that exact rule.
    if (!models.has(alias)) models.set(alias, text.slice(separator + 1).trim());
  }
  return models;
}

export function selectModelAlias(config, requested = '') {
  const models = parseModelAliases(config);
  const alias = requested.trim() || models.keys().next().value;
  if (!alias || !models.has(alias) || ['list', 'help', '--help', '-h'].includes(alias)) {
    throw new Error('MLXの起動モデルを models.conf で確認してください');
  }
  return alias;
}

export async function existingLlmLauncher(env = process.env, requestedAlias = '') {
  const root = resolve(env.MLX_SERVER_DIR || resolve(homedir(), 'mlx-server'));
  const config = resolve(env.MLX_MODELS_CONFIG || resolve(root, 'models.conf'));
  try {
    await access(resolve(root, 'start_server.sh'));
    await access(resolve(root, '.venv/bin/activate'));
    const contents = await readFile(config, 'utf8');
    const alias = selectModelAlias(contents, requestedAlias || env.NYAMURU_MLX_MODEL_ALIAS);
    return { root, alias, model: parseModelAliases(contents).get(alias) };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error('既存のMLX起動環境が見つかりません。MLX_SERVER_DIRに start_server.sh・models.conf・.venv のあるフォルダを指定してください（自動インストールはしません）');
    }
    throw error;
  }
}

export async function checkLlmState(modelsUrl, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(modelsUrl, { signal: AbortSignal.timeout(1_500), redirect: 'error' });
    if (!response.ok) return 'foreign';
    const value = await response.json();
    const modelIds = value?.object === 'list' && Array.isArray(value.data)
      ? value.data.flatMap((model) => model?.object === 'model' && typeof model.id === 'string' && model.id.length ? [model.id] : [])
      : [];
    if (!modelIds.length) return 'foreign';
    return 'ready';
  } catch (error) {
    // Refused connections alone allow a launch. An occupied but unresponsive port is not ours to replace.
    return error?.cause?.code === 'ECONNREFUSED' ? 'missing' : 'unavailable';
  }
}

function launchLlm({ root, alias }, target, env) {
  const child = spawn(process.execPath, [thisFile, '--run-launcher', root, alias, String(process.pid)], {
    cwd: root,
    env: { ...env, MLX_SERVER_DIR: root, MLX_HOST: target.host, MLX_PORT: target.port,
      HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  child.once('error', (error) => { child.spawnError = error; });
  return child;
}

async function stopLlm(child) {
  if (!isRunning(child)) return;
  const exited = new Promise((done) => child.once('exit', done));
  child.kill('SIGTERM');
  await exited; // The runner below bounds shutdown and watches for supervisor loss.
}

/** A guardian retains its record until ComfyUI exit AND original-server recovery finish.
 * Fail closed on an interrupted guardian record; never silently start a competing LLM.
 */
export async function hasImageGenerationSession(root = resolve(thisFile, '../../.astro/image-generation')) {
  try { return (await readdir(root)).some(name => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.json$/u.test(name)); }
  catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

// Ordinary text tasks borrow external servers. Image tasks have a separate reversible suspension.
export class LocalLlmController {
  constructor({ env = process.env, check, launcher, launch, running = isRunning, stop = stopLlm,
    suspendShared, imageSession = hasImageGenerationSession, sleep = delay, now = Date.now, timeoutMs = 120_000 } = {}) {
    this.env = env;
    this.ownershipMode = llmOwnershipMode(env);
    this.check = check || (() => checkLlmState(llmTarget(env).modelsUrl));
    this.launcher = launcher || ((requestedAlias) => existingLlmLauncher(env, requestedAlias));
    this.launch = launch || ((config) => launchLlm(config, llmTarget(env), env));
    this.suspendShared = suspendShared || ((restore, token) => suspendSharedLlm({ env, port: llmTarget(env).port, restore, token }));
    Object.assign(this, { running, stop, sleep, now, timeoutMs, imageSession });
    this.child = null;
    this.childAlias = '';
    this.task = null;
    this.taskAlias = '';
    this.closed = false;
  }

  modelIdentity(requestedAlias = '') {
    return this.ownershipMode === LLM_MODE_EXTERNAL_SHARED
      || (this.ownershipMode === LLM_MODE_AUTO && (!this.child || !this.running(this.child)))
      ? SHARED_LLM_MODEL : requestedAlias.trim();
  }

  async ensure(requestedAlias = '') {
    if (this.closed) throw new Error('ローカル起動管理は終了しています');
    const alias = this.modelIdentity(requestedAlias);
    if (this.task) {
      if (alias !== this.taskAlias) throw new Error('別のLLMモデルを同時には準備できません');
      return this.task;
    }
    this.taskAlias = alias;
    this.task = this.prepare(requestedAlias.trim());
    try { return await this.task; } finally { this.task = null; this.taskAlias = ''; }
  }

  async assertImageSessionIdle() {
    if (await this.imageSession()) throw new Error('ComfyUIの実行または文章LLMの復帰処理が残っています。完了を待ってください。続く場合は復帰ログを確認してください');
  }

  async prepare(requestedAlias) {
    await this.assertImageSessionIdle();
    if (this.child && !this.running(this.child)) {
      this.child = null;
      this.childAlias = '';
    }
    if (this.ownershipMode === LLM_MODE_AUTO && !this.child) {
      const state = await this.check();
      if (this.closed) throw new Error('ローカル起動管理は終了しています');
      if (state === 'ready') {
        return { started: false, managed: false, modelAlias: SHARED_LLM_MODEL, ownershipMode: LLM_MODE_EXTERNAL_SHARED };
      }
      if (state !== 'missing') throw new Error('LLMの接続先が応答しないか、別のサービスです。既存サービスは停止・置換していません');
    }
    if (this.ownershipMode === LLM_MODE_EXTERNAL_SHARED) {
      const state = await this.check();
      if (this.closed) throw new Error('ローカル起動管理は終了しています');
      if (state === 'ready') {
        return {
          started: false,
          managed: false,
          modelAlias: SHARED_LLM_MODEL,
          ownershipMode: LLM_MODE_EXTERNAL_SHARED,
        };
      }
      if (state === 'missing') {
        throw new Error('共有LLMに接続できません。中央のMLXサーバーを起動してから再試行してください（単体モードへの自動切替はしません）');
      }
      throw new Error('共有LLMの接続先が応答しないか、OpenAI互換サービスではありません。既存サービスは停止・置換していません');
    }
    let config = requestedAlias ? await this.launcher(requestedAlias) : null;
    if (this.child && config && this.childAlias !== config.alias) {
      throw new Error('起動中のapp所有LLMが環境設定のモデルと異なります');
    }
    const state = await this.check(config);
    if (this.closed) throw new Error('ローカル起動管理は終了しています');
    if (state === 'ready') {
      if (!this.child && requestedAlias) {
        throw new Error('管理対象外のLLMが接続先で起動しています。単体モードでは既存サービスを停止・切替していません');
      }
      if (this.child && config && this.childAlias !== config.alias) {
        throw new Error('起動中のapp所有LLMが環境設定のモデルと異なります');
      }
      return {
        started: false,
        managed: Boolean(this.child),
        modelAlias: config?.alias ?? this.childAlias,
        ownershipMode: LLM_MODE_MANAGED,
      };
    }
    if (state !== 'missing') throw new Error('LLMの接続先が応答しないか、別のサービスです。既存サービスは停止・置換していません');
    // A running owned process must not be replaced just because its port briefly refused a connection.
    config = this.child ? config : config ?? await this.launcher('');
    if (this.closed) throw new Error('ローカル起動管理は終了しています');
    await this.assertImageSessionIdle();
    if (this.closed) throw new Error('ローカル起動管理は終了しています');
    const started = !this.child;
    const child = this.child || this.launch(config);
    this.child = child;
    this.childAlias = config.alias;
    const deadline = this.now() + this.timeoutMs;
    try {
      while (!this.closed && this.now() < deadline) {
        if (!this.running(child)) throw new Error('MLXサーバーが起動前に終了しました。起動ターミナルの表示を確認してください');
        const current = await this.check(config);
        if (this.closed) break;
        if (current === 'ready') {
          return { started, managed: true, modelAlias: config.alias, ownershipMode: LLM_MODE_MANAGED };
        }
        if (current === 'foreign') throw new Error('起動先でOpenAI互換のMLXサービスを確認できませんでした');
        await this.sleep(300);
      }
      throw new Error(this.closed ? 'ローカル起動管理は終了しています' : 'MLXサーバーの準備が2分以内に完了しませんでした。起動ターミナルの表示を確認してください');
    } catch (error) {
      if (this.child === child) {
        try {
          await this.stop(child);
        } finally {
          if (!this.running(child)) {
            this.child = null;
            this.childAlias = '';
          }
        }
      }
      throw error;
    }
  }

  async close() {
    this.closed = true;
    await this.unload();
  }

  async suspendForImages(token) {
    if (this.closed) throw new Error('ローカル起動管理は終了しています');
    await this.assertImageSessionIdle();
    if (this.closed) throw new Error('ローカル起動管理は終了しています');
    const state = await this.check();
    if (this.closed) throw new Error('ローカル起動管理は終了しています');
    if (state !== 'ready' && state !== 'missing') {
      throw new Error('LLMの接続先が応答しないか、別のサービスです。既存サービスは停止・置換していません');
    }
    if (this.child) {
      if (!await this.unload()) throw new Error('文章LLMの終了を確認できませんでした');
      if (this.closed) throw new Error('ローカル起動管理は終了しています');
      return this.suspendShared(false, token); // Wait for ComfyUI exit; the LLM was originally off.
    }
    return this.suspendShared(state === 'ready', token);
  }

  /** Stop an app-owned model after one explicit task, while allowing a later task to start it again. */
  async unload() {
    await this.task?.catch(() => undefined);
    const child = this.child;
    if (!child) return false;
    await this.stop(child);
    const stopped = !this.running(child);
    if (this.child === child && stopped) {
      this.child = null;
      this.childAlias = '';
    }
    return stopped;
  }
}

// The existing launcher execs MLX in place. This small parent keeps that exact child from being orphaned.
export function runnerHasParent(expectedParentPid, currentParentPid = process.ppid) {
  return Number.isSafeInteger(expectedParentPid) && expectedParentPid > 1 && currentParentPid === expectedParentPid;
}

if (process.argv[1] && resolve(process.argv[1]) === thisFile && process.argv[2] === '--run-launcher') {
  const [, , , root, alias, parentArgument] = process.argv;
  const parentPid = Number(parentArgument);
  if (!runnerHasParent(parentPid)) process.exit(1);
  const child = spawn('/bin/bash', [resolve(root, 'start_server.sh'), alias], { cwd: root, env: process.env, stdio: ['ignore', 'inherit', 'inherit'] });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 2_000);
    timer.unref();
  };
  const unwatch = watchInitialParent(stop, { parentPid });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT']) process.on(signal, stop);
  child.once('error', () => { unwatch(); process.exit(1); });
  child.once('exit', (code) => { unwatch(); process.exit(code ?? 0); });
}
