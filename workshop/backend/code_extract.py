"""Regex-based extraction of a fenced Python code block from an LLM response.

Adapts the string-`find`/`rfind`-based `_extract_code()` in
capx/utils/launch_utils.py:159-183 into a regex form, kept independent of
capx since this backend process deliberately never imports it (see
workshop/backend/app.py's module docstring) — it only ever talks to the
sandbox worker containers over HTTP and to vLLM over HTTP.
"""

from __future__ import annotations

import re

_FENCED_PYTHON = re.compile(r"```python\s*\n(.*?)```", re.DOTALL)
_FENCED_ANY = re.compile(r"```[a-zA-Z0-9]*\s*\n(.*?)```", re.DOTALL)


def extract_code(text: str) -> str:
    """Extracts the first ```python fenced block, falling back to the first
    fenced block of any language, falling back to the whole response
    stripped (in case the model omitted fences entirely)."""
    match = _FENCED_PYTHON.search(text)
    if match is None:
        match = _FENCED_ANY.search(text)
    if match is None:
        return text.strip()
    return match.group(1).strip()


def extract_last_code_block(text: str) -> str | None:
    """Extracts the *last* fenced code block's body, or `None` if the
    response contains no fenced code block at all.

    Used by Agent Mode (workshop/backend/agent_loop.py) instead of
    `extract_code()` above, and deliberately does not fall back to treating
    the whole response as code: earlier fenced (or unfenced) blocks in an
    agentic response are commonly scratch/reasoning snippets the model wrote
    while thinking out loud, not code meant to run — only the last block is
    the model's actual next action. A response with no fenced block at all
    is itself meaningful here (see WORKSHOP_AGENT_PLAN.md §1.3): it's the
    signal the agent loop uses to detect "the model chose not to act", i.e.
    the model's own decision that the task is done.
    """
    matches = list(_FENCED_PYTHON.finditer(text)) or list(_FENCED_ANY.finditer(text))
    if not matches:
        return None
    return matches[-1].group(1).strip()
