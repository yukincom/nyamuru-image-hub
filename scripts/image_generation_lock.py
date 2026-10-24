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
            or json.loads(os.pread(fd, 128, 0)).get('active') is not True:
        raise ValueError('ComfyUIの起動許可が一致しません')


def close_generation_lease(token, root=ROOT):
    # Wait for every already-entered submission, then prohibit late HTTP handlers.
    with locked_lease(token, root) as stream:
        stream.seek(0)
        json.dump({'active': False}, stream)
        stream.truncate()
        stream.flush()


def activate_generation_lease(token, root=ROOT):
    # Only the guardian may enable submission after the LLM has fully exited.
    with locked_lease(token, root) as stream:
        stream.seek(0)
        json.dump({'active': True}, stream)
        stream.truncate()
        stream.flush()
