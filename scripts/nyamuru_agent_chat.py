"""Stateless, local-only agent completion transport. No editor tools run here."""

from __future__ import annotations

import json
import re
from http.client import HTTPException
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import ProxyHandler, Request, build_opener

from nyamuru_agent_connection import NoRedirect
from nyamuru_agent_tools import agent_tools


MAX_REQUEST_BYTES = 256 * 1024
MAX_RESPONSE_BYTES = 256 * 1024
MAX_MESSAGES = 48
MAX_TOOL_CALLS = 4
SYSTEM_PROMPT_PATH = Path(__file__).with_name("agent_system_prompt.txt")


class AgentChatUnavailable(RuntimeError):
    """A local completion could not be obtained or safely decoded."""


def _encoded(value):
    try:
        return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
    except (ValueError, TypeError, UnicodeError, RecursionError):
        raise ValueError("エージェントのデータ形式が正しくありません") from None


def _identifier(value, label, maximum=128):
    if not isinstance(value, str) or not 1 <= len(value) <= maximum or not re.fullmatch(r"[A-Za-z0-9_.:-]+", value):
        raise ValueError(f"{label}の形式が正しくありません")
    return value


def _tool_calls(raw):
    if not isinstance(raw, list) or not 1 <= len(raw) <= MAX_TOOL_CALLS:
        raise ValueError("ツール呼び出しは1〜4件で指定してください")
    calls = []
    ids = set()
    for item in raw:
        if not isinstance(item, dict) or item.get("type") != "function" or not isinstance(item.get("function"), dict):
            raise ValueError("ツール呼び出しの形式が正しくありません")
        call_id = _identifier(item.get("id"), "ツール呼び出しID")
        if call_id in ids:
            raise ValueError("ツール呼び出しIDが重複しています")
        ids.add(call_id)
        function = item["function"]
        name = _identifier(function.get("name"), "ツール名")
        arguments = function.get("arguments")
        if not isinstance(arguments, str):
            raise ValueError("ツール引数はJSON文字列で指定してください")
        # The UI checks the name and argument schema, reports a tool error, and
        # lets the model correct it. Keep malformed argument strings intact.
        calls.append({"id": call_id, "type": "function", "function": {"name": name, "arguments": arguments}})
    return calls


def _assistant(raw):
    if not isinstance(raw, dict) or raw.get("role") != "assistant":
        raise ValueError("アシスタント応答の形式が正しくありません")
    content = raw.get("content")
    if content is not None and not isinstance(content, str):
        raise ValueError("アシスタント応答の本文が正しくありません")
    result = {"role": "assistant", "content": content}
    if raw.get("tool_calls"):
        result["tool_calls"] = _tool_calls(raw["tool_calls"])
    elif raw.get("tool_calls") not in (None, []):
        raise ValueError("ツール呼び出しの形式が正しくありません")
    if not result.get("tool_calls") and not content:
        raise ValueError("アシスタント応答が空です")
    return result


def _messages(raw):
    if not isinstance(raw, list) or not 1 <= len(raw) <= MAX_MESSAGES:
        raise ValueError("会話履歴は1〜48件で指定してください")
    messages = []
    pending = set()
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError("会話履歴の形式が正しくありません")
        role = item.get("role")
        if role == "tool":
            call_id = _identifier(item.get("tool_call_id"), "ツール結果ID")
            if call_id not in pending or not isinstance(item.get("content"), str):
                raise ValueError("ツール呼び出しと結果が対応していません")
            pending.remove(call_id)
            messages.append({"role": "tool", "tool_call_id": call_id, "content": item["content"]})
            continue
        if pending:
            raise ValueError("ツール呼び出しの結果が不足しています")
        if role == "user":
            if not isinstance(item.get("content"), str):
                raise ValueError("利用者の発言は文字列で指定してください")
            messages.append({"role": "user", "content": item["content"]})
        elif role == "assistant":
            message = _assistant(item)
            pending = {call["id"] for call in message.get("tool_calls", [])}
            messages.append(message)
        else:
            raise ValueError("会話履歴には利用者・アシスタント・ツール結果だけを指定してください")
    if pending:
        raise ValueError("ツール呼び出しの結果が不足しています")
    return messages


def _request_data(body):
    if not isinstance(body, dict):
        raise ValueError("エージェントへの入力形式が正しくありません")
    if len(_encoded(body)) > MAX_REQUEST_BYTES:
        raise ValueError("エージェントへの入力が長すぎます")
    profile = body.get("profile")
    if not isinstance(profile, dict):
        raise ValueError("プロフィールの形式が正しくありません")
    for key, maximum in (("name", 100), ("tone", 2000)):
        if not isinstance(profile.get(key), str) or len(profile[key]) > maximum:
            raise ValueError("プロフィールの形式が正しくありません")
    if not isinstance(body.get("context"), dict):
        raise ValueError("原稿情報の形式が正しくありません")
    if not isinstance(body.get("allow_edits"), bool):
        raise ValueError("編集可否の形式が正しくありません")
    data = {"profile": {"name": profile["name"], "tone": profile["tone"]}, "context": body["context"]}
    return data, _messages(body.get("messages")), body["allow_edits"]


class AgentChatService:
    def __init__(self, endpoint: str, request_model: str | None = None):
        try:
            if not isinstance(endpoint, str) or any(ord(char) <= 32 or ord(char) == 127 for char in endpoint):
                raise ValueError
            url = urlsplit(endpoint)
            if (url.scheme != "http" or url.hostname not in ("127.0.0.1", "localhost", "::1")
                    or url.username is not None or url.password is not None
                    or url.path != "/v1/chat/completions" or url.query or url.fragment):
                raise ValueError
            if url.port is not None and not 1 <= url.port <= 65535:
                raise ValueError
        except ValueError:
            raise ValueError("エージェント用LLMはlocalhostのHTTPチャット接続先を指定してください") from None
        if request_model is not None and (not isinstance(request_model, str) or not request_model or len(request_model) > 200):
            raise ValueError("LLMのモデル指定が正しくありません")
        self.endpoint = endpoint
        self.request_model = request_model

    def respond(self, body):
        data, messages, allow_edits = _request_data(body)
        try:
            # Read bytes rather than universal-newline text, preserving the
            # approved prompt exactly, including its final newline.
            prompt = SYSTEM_PROMPT_PATH.read_bytes().decode("utf-8")
        except (OSError, UnicodeError):
            raise AgentChatUnavailable("エージェントの設定を読み込めませんでした") from None
        payload = {
            "messages": [
                {"role": "system", "content": prompt},
                {"role": "user", "content": _encoded(data).decode("utf-8")},
                *messages,
            ],
            "temperature": 0.2, "max_tokens": 4096, "stream": False,
            "tools": agent_tools(allow_edits), "tool_choice": "auto",
        }
        if self.request_model is not None:
            payload["model"] = self.request_model
        request = Request(self.endpoint, data=_encoded(payload), headers={"Content-Type": "application/json", "Accept": "application/json"}, method="POST")
        opener = build_opener(ProxyHandler({}), NoRedirect())
        try:
            with opener.open(request, timeout=120) as response:
                raw = response.read(MAX_RESPONSE_BYTES + 1)
        except (HTTPError, URLError, HTTPException, OSError, ValueError):
            raise AgentChatUnavailable("ローカルLLMに接続できませんでした") from None
        if len(raw) > MAX_RESPONSE_BYTES:
            raise AgentChatUnavailable("ローカルLLMの応答が長すぎます")
        try:
            completion = json.loads(raw)
            if not isinstance(completion, dict) or not isinstance(completion.get("choices"), list) or len(completion["choices"]) != 1:
                raise ValueError
            choice = completion["choices"][0]
            if not isinstance(choice, dict) or choice.get("finish_reason") not in (None, "stop", "tool_calls"):
                raise ValueError
            message = _assistant(choice.get("message"))
            model = completion.get("model", "")
            if not isinstance(model, str):
                raise ValueError
            # A local server can return a full filesystem model path.
            model = model.replace("\\", "/").rsplit("/", 1)[-1][:200]
            if model.lower().endswith(".gguf"):
                model = model[:-5]
            result = {"message": message, "model": model}
            _encoded(result)
            return result
        except (ValueError, TypeError, UnicodeError, RecursionError):
            raise AgentChatUnavailable("ローカルLLMの応答形式を確認できませんでした") from None
