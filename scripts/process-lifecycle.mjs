import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const SIGNAL_NUMBERS = {
  SIGHUP: 1,
  SIGINT: 2,
  SIGQUIT: 3,
  SIGTERM: 15,
};

export function signalExitCode(signal) {
  return 128 + (SIGNAL_NUMBERS[signal] ?? 1);
}

export function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

export function watchInitialParent(
  onParentLost,
  {
    parentPid = process.ppid,
    currentParentPid = () => process.ppid,
    isAlive = processIsAlive,
    intervalMs = 500,
  } = {},
) {
  let notified = false;
  const timer = setInterval(() => {
    if (notified || (currentParentPid() === parentPid && isAlive(parentPid))) return;
    notified = true;
    onParentLost();
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

export function claimRunState(path, label) {
  if (existsSync(path)) {
    try {
      const existing = JSON.parse(readFileSync(path, 'utf8'));
      if (processIsAlive(Number(existing.pid))) {
        throw new Error(`${label}はすでに起動しています（PID ${existing.pid}）。先にそのプロセスを終了してください。`);
      }
    } catch (error) {
      if (error instanceof Error && /すでに起動/.test(error.message)) throw error;
    }
    rmSync(path, { force: true });
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`, { flag: 'wx' });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      const current = JSON.parse(readFileSync(path, 'utf8'));
      if (Number(current.pid) === process.pid) rmSync(path, { force: true });
    } catch {
      // 既に削除済み、または別プロセスが引き継いだ場合は触らない。
    }
  };
}
