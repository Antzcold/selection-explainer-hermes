"""Shared bridge module: holds the host PluginContext for the REST half.

Loaded under the fixed sys.modules key ``selection_explainer_hermes_shared``
by both ``__init__.py`` (register(ctx)) and ``dashboard/plugin_api.py``, so
the REST routes can reach ``ctx.llm`` with host-owned credentials.
"""

from __future__ import annotations

ctx = None
