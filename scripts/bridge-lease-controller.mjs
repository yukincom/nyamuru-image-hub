import { randomUUID } from 'node:crypto';

export class BridgeLeaseController {
  constructor({ checkBridge, launchBridge, waitForBridge, stopBridge, bridgeIsRunning, createToken = randomUUID }) {
    this.checkBridge = checkBridge;
    this.launchBridge = launchBridge;
    this.waitForBridge = waitForBridge;
    this.stopBridge = stopBridge;
    this.bridgeIsRunning = bridgeIsRunning;
    this.createToken = createToken;
    this.bridgeChild = null;
    this.ensureTask = null;
    this.leases = new Set();
    this.queue = Promise.resolve();
    this.closed = false;
  }

  exclusive(task) {
    const next = this.queue.then(task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  async ensureBridge() {
    if (this.ensureTask) return this.ensureTask;
    this.ensureTask = (async () => {
      if (this.bridgeChild && !this.bridgeIsRunning(this.bridgeChild)) this.bridgeChild = null;
      const state = await this.checkBridge();
      if (state === 'ready') return { managed: Boolean(this.bridgeChild), started: false };
      if (state === 'foreign') throw new Error('ポート8787で別のローカルサービスが起動しています');

      const child = this.launchBridge();
      this.bridgeChild = child;
      try {
        await this.waitForBridge(child);
      } catch (error) {
        if (this.bridgeChild === child) this.bridgeChild = null;
        await this.stopBridge(child).catch(() => undefined);
        throw error;
      }
      return { managed: true, started: true };
    })();
    try {
      return await this.ensureTask;
    } finally {
      this.ensureTask = null;
    }
  }

  async acquire() {
    return this.exclusive(async () => {
      if (this.closed) throw new Error('ローカル起動管理は終了しています');
      const readiness = await this.ensureBridge();
      const token = this.createToken();
      this.leases.add(token);
      return { token, ...readiness };
    });
  }

  async release(token) {
    return this.exclusive(async () => {
      const released = this.leases.delete(token);
      if (!released || this.leases.size || !this.bridgeChild) return { released, stopped: false };
      const child = this.bridgeChild;
      this.bridgeChild = null;
      await this.stopBridge(child);
      return { released: true, stopped: true };
    });
  }

  async close() {
    this.closed = true;
    return this.exclusive(async () => {
      this.leases.clear();
      if (!this.bridgeChild) return;
      const child = this.bridgeChild;
      this.bridgeChild = null;
      await this.stopBridge(child);
    });
  }
}

/** Tie an app-owned text model to the explicit operation leases that requested it. */
export class PanelActionLeaseController {
  constructor({ llmController, bridgeLeases }) {
    this.llmController = llmController;
    this.bridgeLeases = bridgeLeases;
    this.leases = new Map();
    this.queue = Promise.resolve();
    this.closed = false;
    this.imageToken = null;
    this.imageRecovery = null;
    this.imageShutdown = null;
  }

  exclusive(task) {
    const next = this.queue.then(task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  async prepare(token, requestedAlias = '') {
    if (this.imageToken) throw new Error('画像生成が終わり、文章LLMが復帰するまでお待ちください');
    return this.exclusive(async () => {
      if (this.imageToken) throw new Error('画像生成が終わり、文章LLMが復帰するまでお待ちください');
      if (this.closed || !this.bridgeLeases.has(token)) {
        throw new Error('先にローカル連携を準備してください');
      }
      const requestedModel = typeof this.llmController.modelIdentity === 'function'
        ? this.llmController.modelIdentity(requestedAlias)
        : requestedAlias;
      const current = this.leases.get(token);
      if (current) {
        if (current.modelAlias !== requestedModel) throw new Error('この操作では別のLLMモデルがすでに準備されています');
        return current;
      }
      if ([...this.leases.values()].some(readiness => readiness.modelAlias !== requestedModel)) {
        throw new Error('別のLLMモデルを使う操作が実行中です');
      }
      const readiness = await this.llmController.ensure(requestedAlias);
      // A cancelled operation must not leave a late-starting model resident.
      if (!this.bridgeLeases.has(token)) {
        if (!this.leases.size) await this.llmController.unload();
        throw new Error('ローカル連携の利用が終了しています');
      }
      this.leases.set(token, readiness);
      return readiness;
    });
  }

  async suspendForImages(token, { requiresLlm = true } = {}) {
    return this.exclusive(async () => {
      if (this.closed || !this.bridgeLeases.has(token) || requiresLlm && !this.leases.has(token)) {
        throw new Error('先に画像生成指示の英訳を準備してください');
      }
      if (this.imageToken === token) return;
      if (this.imageToken || this.leases.size !== Number(this.leases.has(token))) throw new Error('別の文章処理が実行中です。完了後に生成してください');
      this.imageToken = token;
      this.imageShutdown = new AbortController();
      try {
        this.imageRecovery = await this.llmController.suspendForImages(token, { signal: this.imageShutdown.signal });
      } catch (error) {
        this.imageToken = null;
        this.imageShutdown = null;
        throw error;
      }
    });
  }

  async submitImage(token, submit) {
    // Keep release/pagehide behind the in-flight bridge submission. Its uploads
    // can take time even while the Comfy queue still appears empty.
    return this.exclusive(async () => {
      if (this.closed || this.imageToken !== token || !this.imageRecovery) throw new Error('画像生成の一時停止情報がありません');
      return submit();
    });
  }

  async release(token, { shutdown = false } = {}) {
    // Shutdown must reach a guardian even while submit/resume holds the queue.
    if (shutdown && this.imageToken === token) this.imageShutdown?.abort();
    return this.exclusive(async () => {
      const released = this.leases.delete(token);
      if (this.imageToken === token) {
        try {
          const restored = await (shutdown || this.closed || this.imageShutdown?.signal.aborted
            ? this.imageRecovery.shutdown() : this.imageRecovery.resume());
          return { released, stopped: true, restored };
        } finally {
          this.imageToken = null;
          this.imageRecovery = null;
          this.imageShutdown = null;
        }
      }
      if (!released || this.leases.size) return { released, stopped: false };
      return { released: true, stopped: await this.llmController.unload() };
    });
  }

  async close() {
    this.closed = true;
    this.imageShutdown?.abort();
    return this.exclusive(async () => {
      this.leases.clear();
      try { await this.imageRecovery?.shutdown(); }
      finally {
        this.imageToken = null;
        this.imageRecovery = null;
        this.imageShutdown = null;
        await this.llmController.close();
      }
    });
  }
}
