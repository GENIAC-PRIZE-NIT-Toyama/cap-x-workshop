"""Minimal streaming client for a local, OpenAI-compatible vLLM endpoint.

This backend process is intentionally the only thing that talks to the LLM
(see workshop/README.md and session_manager.py's module docstring for why the
sandbox worker containers themselves have no network route out to anything
but the fixed perception-proxy containers) — vLLM stays on the LAN, never
proxied through the Cloudflare Tunnel or reachable from a worker container.

The streaming shape mirrors capx/llm/client.py's `query_model_streaming`
chat-wire branch (capx/llm/client.py:285-299), trimmed to what the workshop
actually needs: no Responses-API wire, no reasoning-delta handling, no
retries — this is a teaching tool hitting one already-running local vLLM
server, not the multi-provider eval harness capx/llm/client.py serves.
"""

from __future__ import annotations

import os
from collections.abc import Iterator

from openai import OpenAI

DEFAULT_BASE_URL = "http://127.0.0.1:8000/v1"
DEFAULT_MODEL = "default"


def _client() -> OpenAI:
    base_url = os.environ.get("WORKSHOP_VLLM_BASE_URL", DEFAULT_BASE_URL)
    # vLLM's OpenAI-compatible server doesn't check API keys by default; the
    # SDK still requires a non-empty string.
    return OpenAI(base_url=base_url, api_key=os.environ.get("WORKSHOP_VLLM_API_KEY", "not-needed"))


def _model_name() -> str:
    return os.environ.get("WORKSHOP_VLLM_MODEL", DEFAULT_MODEL)


def stream_chat_completion(messages: list[dict[str, str]], settings: dict[str, float]) -> Iterator[str]:
    """Yields content deltas from the vLLM chat completion stream.

    `settings` is forwarded as-is as extra keyword args to
    `chat.completions.create` (e.g. `{"temperature": 0.7}`) so new generation
    parameters (top_p, max_tokens, ...) can be added later without changing
    this function's signature.
    """
    client = _client()
    stream = client.chat.completions.create(
        model=_model_name(),
        messages=messages,
        stream=True,
        **settings,
    )
    for chunk in stream:
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta
        if delta and delta.content:
            yield delta.content
