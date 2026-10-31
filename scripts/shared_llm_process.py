"""Suspend a same-user local LLM and restore its exact launch after image work.

Launch data stays in this guardian's memory. Explicit resume permits restoration;
shutdown or EOF without a resume only finishes image cleanup.
"""
import ctypes
import errno
import json
import os
import select
from pathlib import Path
import signal
import stat
import subprocess
import sys
import time
from urllib import request
from uuid import uuid4
from image_generation_lock import create_generation_lease, close_generation_lease, activate_generation_lease, ROOT as LEASE_ROOT


class SessionError(RuntimeError):
    pass


class BSDInfo(ctypes.Structure):
    _fields_ = [(name, ctypes.c_uint32) for name in (
        'flags', 'status', 'xstatus', 'pid', 'ppid', 'uid', 'gid', 'ruid', 'rgid',
        'svuid', 'svgid', 'reserved')] + [
        ('comm', ctypes.c_char * 16), ('name', ctypes.c_char * 32)] + [
        (name, ctypes.c_uint32) for name in ('nfiles', 'pgid', 'jobc', 'tdev', 'tpgid', 'nice')
    ] + [('seconds', ctypes.c_uint64), ('micros', ctypes.c_uint64)]


def identity(pid):
    if sys.platform == 'darwin':
        library = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
        info = BSDInfo()
        size = library.proc_pidinfo(pid, 3, 0, ctypes.byref(info), ctypes.sizeof(info))
        if not size and ctypes.get_errno() in (0, errno.ESRCH, errno.EINVAL):
            return None
        if size != ctypes.sizeof(info):
            raise SessionError('共有LLMのプロセス情報を取得できません')
        if info.uid != os.getuid():
            raise SessionError('共有LLMの実行ユーザーが異なります')
        return None if info.status == 5 else (pid, info.seconds, info.micros)
    if sys.platform.startswith('linux'):
        try:
            path = Path(f'/proc/{pid}')
            if path.stat().st_uid != os.getuid():
                raise SessionError('共有LLMの実行ユーザーが異なります')
            fields = (path / 'stat').read_text().rsplit(')', 1)[1].split()
            return None if fields[0] == 'Z' else (pid, fields[19])
        except FileNotFoundError:
            return None
    raise SessionError('共有LLMの自動復帰はmacOS・Linuxに対応しています')


def parse_procargs(data):
    """KERN_PROCARGS2: argc, executable, padding, argv[argc], environ."""
    count = int.from_bytes(data[:4], sys.byteorder)
    end = data.find(b'\0', 4)
    if not 1 <= count <= 65_536 or end < 0:
        raise SessionError('共有LLMの起動引数を取得できません')
    pos = end + 1
    while pos < len(data) and data[pos] == 0:
        pos += 1
    parts = data[pos:].split(b'\0')
    if len(parts) < count + 1:
        raise SessionError('共有LLMの起動引数が不完全です')
    args = [os.fsdecode(value) for value in parts[:count]]
    env = {}
    for value in parts[count:]:
        if b'=' in value:
            key, content = os.fsdecode(value).split('=', 1)
            if key:
                env[key] = content
    if not args[0] or not env:
        raise SessionError('共有LLMの実行環境を取得できません')
    return args, env


def process_launch(pid):
    if sys.platform == 'darwin':
        libc = ctypes.CDLL(None, use_errno=True)
        mib = (ctypes.c_int * 3)(1, 49, pid)
        size = ctypes.c_size_t(1024 * 1024)
        buffer = ctypes.create_string_buffer(size.value)
        if libc.sysctl(mib, 3, buffer, ctypes.byref(size), None, 0):
            raise SessionError('共有LLMの起動設定を取得できません')
        return parse_procargs(buffer.raw[:size.value])
    path = Path(f'/proc/{pid}')
    raw_args = (path / 'cmdline').read_bytes().split(b'\0')
    if raw_args and raw_args[-1] == b'':
        raw_args.pop()  # Only the terminator; preserve a trailing empty argv entry.
    args = [os.fsdecode(value) for value in raw_args]
    env = dict(os.fsdecode(value).split('=', 1) for value in (path / 'environ').read_bytes().split(b'\0') if b'=' in value)
    return args, env


def lsof(*args):
    result = subprocess.run(['lsof', '-nP', *args], capture_output=True, timeout=5)
    if result.returncode not in (0, 1):
        raise SessionError('共有LLMの接続プロセスを確認できません')
    return os.fsdecode(result.stdout).splitlines()


def listener(port):
    pids = {int(line[1:]) for line in lsof('-a', f'-iTCP:{port}', '-sTCP:LISTEN', '-Fp') if line.startswith('p')}
    if len(pids) > 1:
        raise SessionError('同じポートの複数プロセスを区別できません')
    return next(iter(pids), None)


def snapshot(port):
    pid = listener(port)
    if not pid:
        raise SessionError('共有LLMが停止したため、もう一度生成を開始してください')
    stamp = identity(pid)
    args, env = process_launch(pid)
    locations = lsof('-a', '-p', str(pid), '-d', 'cwd,1,2', '-Ffn')
    paths = {}
    fd = None
    for value in locations:
        if value.startswith('f'):
            fd = value[1:]
        elif value.startswith('n'):
            paths[fd] = value[1:]
    cwd = paths.get('cwd')
    if not stamp or not cwd or not Path(cwd).is_dir() or not Path(args[0]).is_absolute() or not os.access(args[0], os.X_OK):
        raise SessionError('共有LLMを同じ設定で再起動する準備ができません')
    if identity(pid) != stamp or listener(port) != pid:
        raise SessionError('確認中に共有LLMのプロセスが変わりました')
    return {'pid': pid, 'identity': stamp, 'args': args, 'env': env, 'cwd': cwd, 'streams': paths}


def stop_original(saved, port, timeout=25, sleep=time.sleep, now=time.monotonic):
    if identity(saved['pid']) != saved['identity'] or listener(port) != saved['pid']:
        raise SessionError('共有LLMが入れ替わったため一時停止しませんでした')
    os.kill(saved['pid'], signal.SIGTERM)
    saved['stop_requested'] = True
    deadline = now() + timeout
    while identity(saved['pid']) == saved['identity']:
        if now() >= deadline:
            raise SessionError('共有LLMの終了を確認できません。画像生成は開始していません')
        sleep(0.1)
    if listener(port) is not None:
        raise SessionError('別のサーバーがLLMの接続先で起動しました')


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise SessionError('ローカルサービスの転送応答は受け付けません')


def restored_ready(port):
    opener = request.build_opener(request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(f'http://127.0.0.1:{port}/v1/models', timeout=2) as response:
            value = json.loads(response.read(1024 * 1024))
            return value.get('object') == 'list' and bool(value.get('data'))
    except (OSError, ValueError):
        return False


def restart(saved, port, fallback_log, sleep=time.sleep, now=time.monotonic, should_restore=lambda: True):
    if not saved.get('stop_requested') or not should_restore():
        return False
    while identity(saved['pid']) == saved['identity']:
        if not should_restore():
            return False
        # SIGTERM cannot be revoked. Keep recovery responsibility after a slow stop.
        sleep(0.5)
    if listener(port) is not None:
        raise SessionError('別のLLMが接続先で起動したため、元のLLMは再起動していません')
    if not should_restore():
        return False
    streams = []
    try:
        for fd in ('1', '2'):
            name = saved['streams'].get(fd)
            if not name or not Path(name).is_file() or not stat.S_ISREG(Path(name).stat().st_mode):
                name = fallback_log
            Path(name).parent.mkdir(parents=True, exist_ok=True)
            streams.append(open(name, 'ab', buffering=0))
        if not should_restore():
            return False
        child = subprocess.Popen(saved['args'], cwd=saved['cwd'], env=saved['env'],
                                 stdin=subprocess.DEVNULL, stdout=streams[0], stderr=streams[1], start_new_session=True)
    finally:
        for stream in streams:
            stream.close()
    deadline = now() + 120
    while now() < deadline:
        allowed = should_restore()
        ready = False
        if allowed:
            if child.poll() is not None:
                raise SessionError('共有LLMが再起動中に終了しました。サーバーのログを確認してください')
            ready = listener(port) == child.pid and restored_ready(port)
            allowed = should_restore()  # Shutdown can arrive during the HTTP readiness check.
        if not allowed:
            # This child was launched here; a shutdown during startup must not
            # leave it resident. Never signal the previously borrowed listener.
            child.terminate()
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=5)
            return False
        if ready:
            return True
        sleep(0.5)
    raise SessionError('共有LLMを再起動しましたが、接続の復帰を時間内に確認できませんでした')


def emit(state, **fields):
    try:
        print(json.dumps({'state': state, **fields}, ensure_ascii=False), flush=True)
    except (BrokenPipeError, OSError):
        pass  # The parent can exit while restoration still needs to finish.


class SessionCommands:
    """Read completion/shutdown without a reader thread or a second worker."""
    def __init__(self, stream):
        self.stream = stream
        try:
            self.fd = stream.fileno()
        except (AttributeError, OSError, ValueError):
            self.fd = None
        self.resume = False
        self.shutdown = False
        self.eof = False
        self.buffer = b''

    def read(self, block=False):
        if self.eof:
            return False
        if self.fd is None:
            chunk = self.stream.readline().encode()
        else:
            if not select.select([self.fd], [], [], None if block else 0)[0]:
                return False
            chunk = os.read(self.fd, 4096)
        if not chunk:
            self.eof = True
            if not self.resume or self.buffer:
                self.shutdown = True
            return False
        self.buffer += chunk
        while b'\n' in self.buffer:
            line, self.buffer = self.buffer.split(b'\n', 1)
            if line == b'resume':
                self.resume = True
            else:
                # Only explicit task completion permits restoration.
                self.shutdown = True
        return True

    def wait(self):
        while not (self.resume or self.shutdown):
            if not self.read(block=True):
                break

    def allows_restore(self):
        # Drain shutdown even if resume arrived earlier during image cleanup.
        while self.read():
            pass
        return not self.shutdown


def run_session(port, fallback_log, restore=True, token=None, lease_root=LEASE_ROOT):
    saved = None
    start_problem = None
    cleanup_problem = None
    lease = None
    commands = SessionCommands(sys.stdin)
    restored = False
    token = token or str(uuid4())
    try:
        lease = create_generation_lease(token, lease_root, active=False)
        if restore:
            saved = snapshot(port)
            stop_original(saved, port)
        activate_generation_lease(token, lease_root)
        emit('paused')
        commands.wait()
    except BaseException as failure:
        start_problem = failure
    finally:
        try:
            if lease is not None:
                records = close_generation_lease(token, lease_root)
                from image_generation_lock import await_api_release
                await_api_release(records, on_wait=lambda message: emit('waiting', message=message))
            if saved is not None and saved.get('stop_requested') and commands.allows_restore():
                restored = bool(restart(saved, port, fallback_log, should_restore=commands.allows_restore))
            # A start error does not leave recovery work once the external
            # barrier and our own stop have both been resolved.
            if lease is not None:
                lease.unlink(missing_ok=True)
        except BaseException as failure:
            cleanup_problem = failure
    problem = cleanup_problem if cleanup_problem is not None else start_problem
    if problem is not None:
        message = str(problem) if isinstance(problem, SessionError) else '共有LLMの一時停止・復帰を完了できませんでした。起動権限とサーバーのログを確認してください'
        emit('error', message=message)
        return 1
    emit('restored', was_running=restored)
    return 0


if __name__ == '__main__':
    if len(sys.argv) != 5 or sys.argv[1] not in ('--session', '--images-only') or not sys.argv[2].isdigit() or not 1 <= int(sys.argv[2]) <= 65535:
        raise SystemExit(2)
    raise SystemExit(run_session(int(sys.argv[2]), sys.argv[3], sys.argv[1] == '--session', sys.argv[4]))
