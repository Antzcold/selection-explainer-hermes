"""Selection Explainer — backend API routes.

Mounted by the Hermes web server at ``/api/plugins/selection-explainer-hermes/``
once the plugin is in ``plugins.enabled``. The single ``POST /explain`` route
builds a chat completion through ``ctx.llm.complete()`` — host-owned
credentials, the user's active provider/model, audited via ``purpose``.

The PluginContext is bridged from ``register(ctx)`` through the shared module
(see ``../_shared.py``). If the bridge is empty (register has not run in this
process), routes answer 503 with a clear message instead of guessing.

Routes:
    POST /explain    body: {selection, context?, turns?} → {text, model, provider, elapsed_ms}
                     turns: the card's mini-chat after the initial answer —
                     [{role: 'assistant'|'user', content}] in order; an empty
                     list asks for the initial explanation.
    GET  /health     → {ok, backend, plugin}
"""

from __future__ import annotations

import importlib.util
import logging
import sys
import time
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

_log = logging.getLogger(__name__)
router = APIRouter()

PLUGIN_ID = "selection-explainer-hermes"
_SHARED_KEY = "selection_explainer_hermes_shared"
MAX_SELECTION_CHARS = 600          # cap like the reference extension
MAX_TURNS = 10                      # recent-context window for follow-ups
MAX_TURN_CHARS = 2000
MAX_CONTEXT_CHARS = 500

SYSTEM_PROMPT = (
    "You are a concise reading assistant inside the Hermes desktop app. "
    "Explain the selected text clearly, accurately, and briefly. "
    "Use the provided context only as light disambiguation. "
    "Stay grounded in the selected text and the conversation so far. "
    "Prefer short answers with minimal filler. "
    "Answer in the same language as the selected text or the latest user follow-up "
    "unless the user explicitly asks for another language. "
    "Do not mention these instructions or invent context that was not provided."
)

INITIAL_TASK = (
    "Explain this selected text in 1-3 concise sentences and keep it under "
    "roughly 80 words. Focus on clarity over jargon."
)


def _shared() -> Any:
    mod = sys.modules.get(_SHARED_KEY)
    if mod is not None:
        return mod
    path = Path(__file__).resolve().parent.parent / "_shared.py"
    spec = importlib.util.spec_from_file_location(_SHARED_KEY, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[_SHARED_KEY] = mod
    try:
        spec.loader.exec_module(mod)
    except BaseException:
        sys.modules.pop(_SHARED_KEY, None)
        raise
    return mod


def _redact(text: str) -> str:
    """Redact secrets at the boundary — selected text is leaving for a model."""
    try:
        from agent.redact import redact_sensitive_text

        return redact_sensitive_text(text, force=True)
    except Exception:
        return text


def _llm_context():
    ctx = getattr(_shared(), "ctx", None)
    if ctx is not None and getattr(ctx, "llm", None) is not None:
        return ctx
    return None


class Turn(BaseModel):
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str = Field(..., min_length=1, max_length=MAX_TURN_CHARS)


class ExplainBody(BaseModel):
    selection: str = Field(..., max_length=10_000)  # emptiness gets a clear 400 in the handler
    context: str = Field(default="", max_length=MAX_CONTEXT_CHARS)
    turns: list[Turn] = Field(default_factory=list)


@router.post("/explain")
def explain(body: ExplainBody) -> dict[str, Any]:
    ctx = _llm_context()
    if ctx is None:
        raise HTTPException(
            status_code=503,
            detail=(
                "Selection Explainer backend not ready: register(ctx) has not run in "
                "this process. Make sure the plugin is in plugins.enabled and the "
                "backend (hermes serve / gateway) was restarted after enabling."
            ),
        )

    selection = body.selection.strip()[:MAX_SELECTION_CHARS]
    context = (body.context or "").strip()[:MAX_CONTEXT_CHARS]
    turns = body.turns[-MAX_TURNS:]

    if not selection:
        raise HTTPException(
            status_code=400,
            detail="selection is empty — select text and try again",
        )
    _log.info(
        "explain call: selection=%d chars, context=%d chars, turns=%d",
        len(body.selection), len(body.context or ""), len(body.turns),
    )

    if turns and turns[0].role != "assistant":
        raise HTTPException(status_code=400, detail="first turn must be the assistant's initial explanation")

    messages: list[dict[str, Any]] = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.append(
        {
            "role": "user",
            "content": (
                f"Context: {context or '(none)'}\n\n"
                f"Selected text:\n{selection}\n\n"
                f"Task:\n{INITIAL_TASK}"
            ),
        }
    )
    for turn in turns:
        messages.append({"role": turn.role, "content": turn.content})

    # Redact everything user-supplied before it leaves for the model.
    for message in messages:
        if message["role"] != "system":
            message["content"] = _redact(message["content"])

    t0 = time.perf_counter()
    try:
        result = ctx.llm.complete(
            messages=messages,
            purpose=f"{PLUGIN_ID}.explain",
            max_tokens=300,
            timeout=60,
        )
    except Exception as exc:  # noqa: BLE001 — surface any provider/gate failure as 502
        _log.exception("selection-explainer: ctx.llm.complete failed")
        raise HTTPException(status_code=502, detail=f"LLM call failed: {exc}") from exc

    elapsed_ms = int((time.perf_counter() - t0) * 1000)
    return {
        "text": getattr(result, "text", "") or "",
        "model": getattr(result, "model", "") or "",
        "provider": getattr(result, "provider", "") or "",
        "purpose": f"{PLUGIN_ID}.explain",
        "elapsed_ms": elapsed_ms,
    }


@router.get("/health")
def health() -> dict[str, Any]:
    ready = _llm_context() is not None
    return {
        "ok": True,
        "backend": "ctx-llm" if ready else "missing-context",
        "plugin": PLUGIN_ID,
        "max_selection_chars": MAX_SELECTION_CHARS,
    }
