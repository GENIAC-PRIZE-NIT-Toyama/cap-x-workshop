"""Jinja2 rendering for participant-authored System Prompt / Feedback Prompt
templates (Agent Mode — see WORKSHOP_AGENT_PLAN.md §1.2).

Both templates are free text a workshop participant writes and edits in the
browser, then this backend process renders. That makes them untrusted input
rendered server-side, exactly the shape of a classic SSTI (Server-Side
Template Injection) vector — a plain `jinja2.Environment` would let a
template body do things like `{{ ''.__class__.__mro__[1].__subclasses__() }}`
to reach arbitrary Python objects and, from there, the backend host process
itself (not the sandboxed worker container — this file runs in the plain
`app.py` process, which is *not* sandboxed). `SandboxedEnvironment` is the
load-bearing mitigation here: it blocks attribute/item access to unsafe
internals while still supporting everything a template needs for this use
case (variable interpolation, `{% for %}`/`{% if %}`, filters).

`StrictUndefined` (instead of Jinja2's default `Undefined`, which silently
renders missing variables as empty string) is the other deliberate choice:
a typo'd variable name (`{{ tsak_instruction }}`) should surface as a clear
error naming the available variables, not silently produce a blank prompt
that's hard to notice mid-workshop.
"""

from __future__ import annotations

from typing import Any

from jinja2 import StrictUndefined, TemplateError
from jinja2.sandbox import SandboxedEnvironment

_ENV = SandboxedEnvironment(undefined=StrictUndefined, autoescape=False)


class PromptRenderError(Exception):
    """A template failed to render — bad Jinja2 syntax, or a reference to a
    variable that isn't in `variables` (most commonly a typo)."""


def render_template(template_str: str, variables: dict[str, Any]) -> str:
    """Renders `template_str` as a sandboxed Jinja2 template against
    `variables`. Raises `PromptRenderError` (with the available variable
    names listed, for typo'd `{{ ... }}` references) instead of letting a
    template error surface as a raw Jinja2 traceback."""
    try:
        return _ENV.from_string(template_str).render(**variables)
    except TemplateError as exc:
        available = ", ".join(sorted(variables.keys()))
        raise PromptRenderError(f"{exc}. 使える変数: {available}") from exc
