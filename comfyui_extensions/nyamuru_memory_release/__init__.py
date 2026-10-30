"""Observe ComfyUI worker-side cache reset; never unload on the HTTP thread."""

from __future__ import annotations

import functools
import gc
import ipaddress
from uuid import UUID


PROTOCOL = 1
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}


class ReleaseObserver:
    """One pending token, protected by ComfyUI's existing queue mutex."""

    def __init__(self, server, model_management, collect=gc.collect):
        self.server = server
        self.queue = server.prompt_queue
        self.models = model_management
        self.collect = collect
        self.record = None

    def _idle(self):
        remaining = self.queue.get_tasks_remaining()
        if type(remaining) is not int or remaining < 0:
            raise RuntimeError("queue state unavailable")
        return remaining == 0

    def _loaded(self):
        models = self.models.current_loaded_models
        if not isinstance(models, list):
            raise RuntimeError("loaded models unavailable")
        return len(models)

    def _generation(self):
        generation = self.queue.task_counter
        if type(generation) is not int or generation < 0:
            raise RuntimeError("queue generation unavailable")
        return generation

    @staticmethod
    def _token(token):
        if not isinstance(token, str):
            raise ValueError("token must be a canonical UUID")
        try:
            if str(UUID(token)) != token:
                raise ValueError
        except ValueError:
            raise ValueError("token must be a canonical UUID") from None
        return token

    def _result(self, token, state, *, error=None):
        result = {"protocol": PROTOCOL, "token": token, "state": state,
                  "queue_idle": self._idle(), "loaded_model_count": self._loaded()}
        if error:
            result["error"] = error
        return result

    def request(self, token):
        token = self._token(token)
        with self.queue.mutex:
            if not self._idle():
                return self._result(token, "busy", error="queue_active")
            if self.record and self.record["state"] == "pending":
                # q.get() can begin waiting just after the original flag
                # notification. Wake that idle wait without setting flags
                # again; the same pending release remains the only request.
                self.queue.not_empty.notify()
                if self.record["token"] != token:
                    return self._result(token, "busy", error="another_release_pending")
                return self._result(token, "pending")
            if self.record and self.record["token"] == token:
                if self.record["state"] == "failed":
                    return self._result(token, "failed", error=self.record["error"])
                if self.record["state"] == "released" and self._loaded() == 0 \
                        and self.record["generation"] == self._generation():
                    return self._result(token, "released")
            # New token, a reset that overlapped a queued job, or a job that ran
            # after the previous confirmation needs a NEW observed reset. A
            # duplicate pending request never re-sets flags.
            self.record = {"token": token, "state": "pending", "generation": None}
            try:
                self.queue.set_flag("unload_models", True)
                self.queue.set_flag("free_memory", True)
            except Exception as exc:
                self.record.update(state="failed", error=f"release_request_failed: {type(exc).__name__}")
            return self._result(token, self.record["state"], error=self.record.get("error"))

    def after_reset(self, executor, had_caches, reset_error=None):
        # Constructor reset has no previous cache to clear and proves nothing.
        if not had_caches or getattr(executor, "server", None) is not self.server:
            return
        with self.queue.mutex:
            if not self.record or self.record["state"] != "pending":
                return
            if reset_error is not None:
                self.record.update(state="failed", error=f"cache_reset_failed: {type(reset_error).__name__}")
                return
            try:
                if not self._idle():
                    self.record.update(state="busy")
                    return
                # main.py has already unloaded models before calling reset.
                # Confirm after the original reset and actual collection, not
                # when flags are accepted/consumed or execution_end is emitted.
                self.collect()
                self.models.soft_empty_cache()
                if self._loaded() != 0:
                    self.record.update(state="busy")
                    return
                self.record.update(state="released", generation=self._generation())
            except Exception as exc:
                self.record.update(state="failed", error=f"release_confirmation_failed: {type(exc).__name__}")


def install(server, executor_class, model_management, web, *, collect=gc.collect):
    """Install exactly one reset observer and two small routes."""
    marker = "_nyamuru_memory_release_observer"
    existing = getattr(executor_class, marker, None)
    if existing is not None:
        if existing.server is not server:
            raise RuntimeError("memory release observer already belongs to another server")
        return existing
    observer = ReleaseObserver(server, model_management, collect)
    original_reset = executor_class.reset

    @functools.wraps(original_reset)
    def reset(executor, *args, **kwargs):
        had_caches = hasattr(executor, "caches")
        try:
            result = original_reset(executor, *args, **kwargs)
        except Exception as exc:
            observer.after_reset(executor, had_caches, reset_error=exc)
            raise
        observer.after_reset(executor, had_caches)
        return result

    def loopback(request):
        try:
            return ipaddress.ip_address(request.remote).is_loopback
        except (ValueError, TypeError):
            return False

    @server.routes.get("/nyamuru/memory/capabilities")
    async def capabilities(request):
        if not loopback(request):
            return web.json_response({"error": "loopback_required"}, status=403)
        return web.json_response({"protocol": PROTOCOL})

    @server.routes.post("/nyamuru/memory/release")
    async def release(request):
        if not loopback(request):
            return web.json_response({"error": "loopback_required"}, status=403)
        try:
            body = await request.json()
            if not isinstance(body, dict) or set(body) != {"token"}:
                raise ValueError("body must contain token only")
            result = observer.request(body["token"])
        except ValueError as exc:
            return web.json_response({"error": str(exc)}, status=400)
        except Exception as exc:
            return web.json_response({"error": f"observation_unavailable: {type(exc).__name__}"}, status=503)
        return web.json_response(result)

    executor_class.reset = reset
    setattr(executor_class, marker, observer)
    return observer


def _bootstrap():
    from aiohttp import web
    import execution
    import comfy.model_management
    from server import PromptServer

    install(PromptServer.instance, execution.PromptExecutor, comfy.model_management, web)


_bootstrap()
