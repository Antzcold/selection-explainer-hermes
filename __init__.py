"""Selection Explainer — Hermes Agent plugin (Python half).

``register(ctx)`` stores the host PluginContext in a small shared bridge module
(``_shared.py``) so the dashboard REST half (``dashboard/plugin_api.py``) can
call ``ctx.llm``. The desktop half (``desktop/plugin.js``) does the selection
UI and reaches the backend through ``ctx.rest`` →
``/api/plugins/selection-explainer-hermes/explain``.

``_shared.py`` is loaded by path (spec_from_file_location) from both this file
and ``plugin_api.py`` under one deterministic ``sys.modules`` key, so both
sides see the same module object even though the host imports each file
standalone, without a package.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any

_SHARED_KEY = "selection_explainer_hermes_shared"


def _shared() -> Any:
    mod = sys.modules.get(_SHARED_KEY)
    if mod is not None:
        return mod
    path = Path(__file__).resolve().with_name("_shared.py")
    spec = importlib.util.spec_from_file_location(_SHARED_KEY, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[_SHARED_KEY] = mod
    spec.loader.exec_module(mod)
    return mod


def register(ctx) -> None:
    """Bridge the host PluginContext to the REST half. No tools, no hooks."""
    _shared().ctx = ctx
    return None
