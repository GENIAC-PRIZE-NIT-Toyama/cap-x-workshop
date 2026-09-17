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
