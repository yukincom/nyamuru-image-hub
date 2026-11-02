"""Delete only the exact completed prompt outputs retained by Nyamuru."""
from __future__ import annotations

import ipaddress
import hashlib
import os
import re
import stat
from pathlib import PurePosixPath


def delete_outputs(queue, roots, outputs):
    if not isinstance(outputs, list) or not 1 <= len(outputs) <= 5:
        raise ValueError('outputs must contain one to five completed images')
    checked = []
    for item in outputs:
        required = {'prompt_id', 'node', 'index', 'image'}
        if not isinstance(item, dict) or set(item) not in (required, required | {'sha256'}):
            raise ValueError('output identity is required')
        prompt_id, node, index, image = (item[k] for k in ('prompt_id', 'node', 'index', 'image'))
        if not isinstance(prompt_id, str) or not isinstance(node, str) or type(index) is not int or index < 0:
            raise ValueError('invalid output identity')
        digest = item.get('sha256')
        if digest is not None and (not isinstance(digest, str) or not re.fullmatch('[0-9a-f]{64}', digest)):
            raise ValueError('invalid output digest')
        history = queue.get_history(prompt_id).get(prompt_id)
        if history is not None:
            try:
                actual = history['outputs'][node]['images'][index]
            except (TypeError, KeyError, IndexError):
                raise ValueError('completed prompt output is unavailable') from None
            if actual != image:
                raise ValueError('output does not match completed prompt')
        elif digest is None:
            raise ValueError('completed prompt output is unavailable')
        if not isinstance(image, dict) or set(image) != {'filename', 'subfolder', 'type'}:
            raise ValueError('output does not match completed prompt')
        name, subfolder, kind = (image[k] for k in ('filename', 'subfolder', 'type'))
        if kind not in ('output', 'temp') or not isinstance(name, str) or not name.endswith('.png') \
                or not name or '/' in name or '\\' in name or '\x00' in name \
                or not isinstance(subfolder, str) or '\\' in subfolder or '\x00' in subfolder \
                or subfolder.startswith('/') or any(p in ('.', '..') for p in subfolder.split('/')):
            raise ValueError('invalid output path')
        checked.append((roots[kind](), PurePosixPath(subfolder).parts, name, digest))
    # A persisted content identity also works after the owned ComfyUI runtime has exited.
    opened = []
    try:
        for root, parts, name, digest in checked:
            fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                for part in parts:
                    child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                    os.close(fd)
                    fd = child
            except BaseException:
                os.close(fd)
                raise
            opened.append((fd, name))
            if digest is not None:
                try:
                    image_fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
                except FileNotFoundError:
                    continue
                with os.fdopen(image_fd, 'rb') as stream:
                    if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode) or hashlib.file_digest(stream, 'sha256').hexdigest() != digest:
                        raise ValueError('output content has changed')
        # Check all identities and bytes before deleting any file; missing files allow retries.
        for fd, name in opened:
            try:
                os.unlink(name, dir_fd=fd)
            except FileNotFoundError:
                pass
    finally:
        for fd, _ in opened:
            os.close(fd)
    return outputs


def install(server, web, roots):
    if getattr(server, '_nyamuru_output_cleanup_installed', False):
        return
    @server.routes.post('/nyamuru/outputs/delete')
    async def cleanup(request):
        try:
            if not ipaddress.ip_address(request.remote).is_loopback:
                return web.json_response({'error': 'loopback_required'}, status=403)
            body = await request.json()
            if not isinstance(body, dict) or set(body) != {'outputs'}:
                raise ValueError('body must contain outputs only')
            result = delete_outputs(server.prompt_queue, roots, body['outputs'])
            return web.json_response({'deleted': result})
        except (ValueError, TypeError) as exc:
            return web.json_response({'error': str(exc)}, status=400)
        except OSError as exc:
            return web.json_response({'error': f'output_cleanup_failed: {type(exc).__name__}'}, status=503)
    server._nyamuru_output_cleanup_installed = True
