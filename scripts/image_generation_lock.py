"""Cross-process submission barrier shared by the bridge and restoration guardian."""
from contextlib import contextmanager
import json
import os
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


def create_generation_lease(token, root=ROOT, *, active=True):
    path = lease_path(token, root)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump({'active': active}, stream)
    return path


@contextmanager
def locked_lease(token, root=ROOT):
    import fcntl
    try:
        fd = os.open(lease_path(token, root), os.O_RDWR | getattr(os, 'O_NOFOLLOW', 0))
    except OSError:
        raise ValueError('画像生成の利用が終了しています') from None
    with os.fdopen(fd, 'r+') as stream:
        fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
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


def close_generation_lease(token, root=ROOT):
    # Wait for every already-entered submission, then prohibit late HTTP handlers.
    with locked_lease(token, root) as stream:
        value = json.load(stream)
        value['active'] = False
        stream.seek(0)
        json.dump(value, stream)
        stream.truncate()
        stream.flush()
        os.fsync(stream.fileno())
        return value.get('api_submissions', [])


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


def await_api_release(records, *, client_factory=None, sleep=None, on_wait=None):
    """FD closure is only the start: external jobs and cache release must also finish."""
    if not records:
        return
    if client_factory is None:
        from comfy_client import ComfyClient
        client_factory = ComfyClient
    if sleep is None:
        from time import sleep
    clients = {item['endpoint']: client_factory(item['endpoint']) for item in records}
    while True:
        waiting = None
        try:
            for item in records:
                if item.get('terminal'):
                    continue
                client = clients[item['endpoint']]
                prompt_id = item.get('prompt_id') or client.find_prompt(item['correlation_id'])
                if prompt_id:
                    item['prompt_id'] = prompt_id
                result = client.prompt_state(prompt_id) if prompt_id else {'state': 'unknown'}
                state = result['state']
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
                for client in clients.values():
                    if not client.release_models():
                        waiting = 'ComfyUIの他の処理と画像モデルの解放を待っています'
                        break
            if waiting is None:
                return
        except (OSError, ValueError) as exc:
            waiting = str(exc)
        if on_wait:
            on_wait(waiting)
        sleep(2)


def activate_generation_lease(token, root=ROOT):
    # Only the guardian may enable submission after the LLM has fully exited.
    with locked_lease(token, root) as stream:
        stream.seek(0)
        json.dump({'active': True}, stream)
        stream.truncate()
        stream.flush()
