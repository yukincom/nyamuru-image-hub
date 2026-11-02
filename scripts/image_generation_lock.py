"""Cross-process submission barrier shared by the bridge and restoration guardian."""
from contextlib import contextmanager
import json
import os
import signal
import time
from pathlib import Path
from uuid import UUID

ROOT = Path(__file__).absolute().parents[1] / '.astro' / 'image-generation'


def lease_path(token, root=ROOT):
    try:
        if str(UUID(token)) != token:
            raise ValueError()
    except (ValueError, TypeError, AttributeError):
        raise ValueError('画像生成の利用情報が正しくありません') from None
    return Path(root) / f'{token}.json'


def create_generation_lease(token, root=ROOT, *, active=True, owner=None):
    path = lease_path(token, root)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump({'active': active, **({'owner': owner} if owner else {})}, stream)
    return path


@contextmanager
def locked_lease(token, root=ROOT, *, on_wait=None, timeout=None):
    import fcntl
    try:
        fd = os.open(lease_path(token, root), os.O_RDWR | getattr(os, 'O_NOFOLLOW', 0))
    except OSError:
        raise ValueError('画像生成の利用が終了しています') from None
    with os.fdopen(fd, 'r+') as stream:
        deadline = time.monotonic() + timeout if timeout is not None else None
        while True:
            try:
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if on_wait:
                    on_wait()
                if deadline is not None and time.monotonic() >= deadline:
                    raise ValueError('生成workerの終了を確認できませんでした')
                time.sleep(.1)
        # Closing the final inherited descriptor releases flock. An explicit
        # LOCK_UN here would also unlock a still-running ComfyUI child.
        yield stream


@contextmanager
def hold_generation_lease(token, root=ROOT):
    with locked_lease(token, root) as stream:
        if json.load(stream).get('active') is not True:
            raise ValueError('画像生成の利用が終了しています')
        yield stream.fileno()


def validate_generation_fd(token, fd, root=ROOT):
    """A worker must inherit the same active lease inode as its submitting bridge."""
    if not isinstance(fd, int) or fd < 3:
        raise ValueError('ComfyUIの起動許可がありません')
    actual = os.fstat(fd)
    expected = lease_path(token, root).stat(follow_symlinks=False)
    if (actual.st_dev, actual.st_ino) != (expected.st_dev, expected.st_ino) \
            or json.loads(os.pread(fd, 1024 * 1024, 0)).get('active') is not True:
        raise ValueError('ComfyUIの起動許可が一致しません')


def close_generation_lease(token, root=ROOT, *, on_wait=None, timeout=None):
    # Wait for every already-entered submission, then prohibit late HTTP handlers.
    with locked_lease(token, root, on_wait=on_wait, timeout=timeout) as stream:
        value = json.load(stream)
        value['active'] = False
        stream.seek(0)
        json.dump(value, stream)
        stream.truncate()
        stream.flush()
        os.fsync(stream.fileno())
        return value.get('api_submissions', [])


def record_generation_job(fd, job_id, root, *, worker=None):
    value = json.loads(os.pread(fd, 1024 * 1024, 0))
    jobs = value.setdefault('jobs', [])
    job = next((item for item in jobs if item['job_id'] == job_id), None)
    if job is None:
        job = {'job_id': job_id, 'root': str(Path(root).resolve())}
        jobs.append(job)
    if worker:
        job['worker'] = worker
    raw = json.dumps(value).encode()
    os.pwrite(fd, raw, 0)
    os.ftruncate(fd, len(raw))
    os.fsync(fd)


def request_generation_shutdown(token, root=ROOT, *, terminate=False):
    """Cancel markers reach an inherited flock holder before waiting for its descriptor."""
    from shared_llm_process import identity, process_launch
    value = json.loads(lease_path(token, root).read_text())
    for job in value.get('jobs', []):
        job_id = job['job_id']
        UUID(job_id)
        directory = Path(job['root']) / job_id
        if not (directory / 'request.json').is_file():
            continue
        try:
            with (directory / 'cancel-request.json').open('x') as stream:
                json.dump({'requested': True}, stream)
        except FileExistsError:
            pass
        worker = job.get('worker')
        if not terminate or not worker or not worker.get('identity') or worker['pid'] == os.getpid():
            continue
        stamp = tuple(worker['identity'])
        try:
            if identity(worker['pid']) != stamp:
                continue
            # A terminating Linux worker can deny environ before releasing its FD.
            # Cleanup needs only argv and the unchanged process identity.
            args, _ = process_launch(worker['pid'], include_env=False)
            def argument(flag):
                index = args.index(flag) + 1 if flag in args else len(args)
                return args[index] if index < len(args) else None
            script = str(Path(__file__).with_name('qwen_generation.py'))
            if script in args and argument('--run') == job_id and argument('--image-session-token') == token \
                    and identity(worker['pid']) == stamp:
                os.kill(worker['pid'], signal.SIGTERM)
        except (OSError, RuntimeError):
            if identity(worker['pid']) == stamp:
                raise  # A genuine permission/observation failure must remain visible.
    return value


def record_api_submission(fd, endpoint, correlation_id, *, prompt_id=None, terminal=False, cancel_record=None):
    """The worker owns this inherited flock. Persist before touching an external queue."""
    value = json.loads(os.pread(fd, 1024 * 1024, 0))
    if value.get('active') is not True:
        raise ValueError('画像生成の利用が終了しています')
    records = value.setdefault('api_submissions', [])
    item = next((item for item in records if item['correlation_id'] == correlation_id), None)
    changes = {'terminal': terminal}
    if prompt_id:
        changes['prompt_id'] = prompt_id
    if cancel_record:
        changes['cancel_record'] = str(cancel_record)
    if item is None:
        item = {'endpoint': endpoint, 'correlation_id': correlation_id, 'terminal': False}
        records.append(item)
    elif all(item.get(key) == incoming for key, incoming in changes.items()):
        return
    item.update(changes)
    raw = json.dumps(value).encode('utf-8')
    os.pwrite(fd, raw, 0)
    os.ftruncate(fd, len(raw))
    os.fsync(fd)


def await_api_release(records, *, client_factory=None, sleep=None, on_wait=None,
                      should_shutdown=lambda: False, now=time.monotonic, timeout=60):
    """FD closure is only the start: external jobs and cache release must also finish."""
    if not records:
        return
    if client_factory is None:
        from comfy_client import ComfyClient
        client_factory = lambda endpoint: ComfyClient(endpoint, timeout=3)
    if sleep is None:
        from time import sleep
    clients = {item['endpoint']: client_factory(item['endpoint']) for item in records}
    from comfy_client import ComfyServerMissing
    deadline = now() + timeout
    missing = {}
    absent_servers = set()
    while True:
        waiting = None
        try:
            for item in records:
                if item.get('terminal'):
                    continue
                client = clients[item['endpoint']]
                try:
                    prompt_id = item.get('prompt_id') or client.find_prompt(item['correlation_id'])
                except ComfyServerMissing:
                    if not should_shutdown():
                        raise
                    item.update(terminal=True, outcome='interrupted')
                    absent_servers.add(item['endpoint'])
                    continue
                if prompt_id:
                    item['prompt_id'] = prompt_id
                result = client.prompt_state(prompt_id) if prompt_id else {'state': 'unknown', 'missing': True}
                if should_shutdown() and prompt_id and result['state'] in ('running', 'queued') and not item.get('cancelled'):
                    receipt = client.cancel(prompt_id)
                    if receipt.get('cancelled'):
                        item['cancelled'] = True
                state = result['state']
                if result.get('server_missing') and should_shutdown():
                    item.update(terminal=True, outcome='interrupted')
                    absent_servers.add(item['endpoint'])
                    continue
                if state == 'unknown' and result.get('missing') is True:
                    key = item['correlation_id']
                    missing[key] = missing.get(key, 0) + 1
                    if missing[key] >= 2:
                        item.update(terminal=True, outcome='cancelled' if item.get('cancelled') else 'interrupted')
                        continue
                else:
                    missing.pop(item['correlation_id'], None)
                if state == 'unknown' and result.get('missing') is True and item.get('cancel_record'):
                    try:
                        receipt = json.loads(Path(item['cancel_record']).read_text())
                        if receipt.get('prompt_id') == prompt_id and receipt.get('cancelled') is True:
                            state = 'failed'
                    except FileNotFoundError:
                        pass
                if state in ('succeeded', 'failed'):
                    item['terminal'] = True
                else:
                    waiting = '生成の結果が未確定です。ComfyUIの接続と実行状況を確認してください' if state == 'unknown' else 'ComfyUIの生成完了を待っています'
            if waiting is None:
                for endpoint, client in clients.items():
                    if endpoint in absent_servers:
                        continue
                    if not client.release_models():
                        if should_shutdown() and getattr(client, 'last_release_status', '') == 'server_missing':
                            absent_servers.add(endpoint)
                            continue
                        waiting = 'ComfyUIの他の処理と画像モデルの解放を待っています'
                        break
            if waiting is None:
                return
        except (OSError, ValueError) as exc:
            waiting = str(exc)
        if on_wait:
            on_wait(waiting)
        if now() >= deadline:
            raise ValueError(f'生成の後片付けを確認できませんでした: {waiting}')
        sleep(2)


def recover_abandoned_leases(root=ROOT):
    """A killed guardian cannot run finally; reconcile only its unlocked, ownerless work."""
    from shared_llm_process import identity
    pending, recovered = [], 0
    for path in Path(root).glob('*.json'):
        try:
            UUID(path.stem)
            value = json.loads(path.read_text())
            owner = value.get('owner')
            if not owner or identity(owner['pid']) == tuple(owner['identity']):
                pending.append(path.stem)
                continue
            request_generation_shutdown(path.stem, root, terminate=True)
            records = close_generation_lease(path.stem, root, timeout=5)
            await_api_release(records, should_shutdown=lambda: True, timeout=6)
            archive = path.parent / 'archive'
            archive.mkdir(exist_ok=True)
            target = archive / path.name
            if target.exists():
                raise ValueError('同じ終了記録があるため上書きしていません')
            path.rename(target)
            recovered += 1
        except (OSError, ValueError, KeyError, RuntimeError):
            pending.append(path.stem)
    return {'blocked': bool(pending), 'recovered': recovered}


def activate_generation_lease(token, root=ROOT):
    # Only the guardian may enable submission after the LLM has fully exited.
    with locked_lease(token, root) as stream:
        value = json.load(stream)
        value['active'] = True
        stream.seek(0)
        json.dump(value, stream)
        stream.truncate()
        stream.flush()
