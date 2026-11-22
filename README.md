# selection-explainer-hermes

A Hermes desktop-app port of
[Antzcold/browserchat-selection-explainer](https://github.com/Antzcold/browserchat-selection-explainer):
select text anywhere in the Hermes desktop app → an **Explain** chip appears →
a floating mini-assistant explains the selection and answers follow-up
questions.

The key architectural difference from the Chrome original: explanations do
**not** go to a hard-coded Ollama Cloud API with your own key. They go through
the plugin's Python backend, which calls **`ctx.llm`** — the host-owned LLM
lane. No API keys, no provider config; the plugin runs against whatever
provider and model the user's Hermes profile currently uses and follows
provider switches automatically. Every call is audited (`purpose:
selection-explainer-hermes.explain`) and redacted for secrets before it
leaves the machine.

## What you get

- **Auto-chip**: highlight text anywhere in the app window (chat, files,
  terminal, preview) — a small `✦ Explain` chip appears next to the selection.
- **Floating card**: initial explanation in 1–3 concise sentences (~80 words,
  same language as the selection), plus a **follow-up mini-chat** per
  selection (ephemeral, gone when the card closes).
- **⌘K palette**: `Explain Selection` command.
- **Keybind**: `⌘⇧E` (user-rebindable), `Esc` closes.
- **Statusbar chip** on the right for one-click explain of the current
  selection.
- **600-character selection cap** like the original (defense in depth: enforced
  client- and server-side).

## Layout

```
selection-explainer-hermes/
├── plugin.yaml               # manifest (no tools, no hooks — UI + API plugin)
├── __init__.py               # register(ctx): bridges ctx into _shared
├── _shared.py                # ctx bridge module (loaded by path, one sys.modules key)
├── dashboard/
│   ├── manifest.json         # hidden tab + api discovery for the web server
│   └── plugin_api.py         # POST /explain → ctx.llm.complete(...)
└── desktop/
    └── plugin.js             # chip + floating card + palette + keybind + statusbar
```

## Install (dev)

```bash
./deploy.sh                                   # rsync into ~/.hermes/plugins/<id>
hermes -p default plugins enable selection-explainer-hermes   # Python half gate
```

Then **restart the Hermes desktop app backend** (quit & reopen the app) and
flip on the desktop half under **Settings → Plugins** (unified desktop halves
are opt-in by design).

## Multi-profile setups (important)

The desktop half (chip, floating card) is **app-global**: it loads in every
window of the desktop app, whatever profile that window is on. The Python half
is **per profile**: the multiplex gateway mounts `/api/plugins/<id>/…` only for
profiles that carry the package in their own
`~/.hermes/profiles/<p>/plugins/` **and** list it in their own
`plugins.enabled`. Symptom when a profile is skipped: the chip appears, the
card opens, and every explain request fails with `404 {"detail":"Not Found"}`.

Roll out to the default root **and every profile** in one go:

```bash
./deploy.sh --all-profiles
```

Or by hand, per profile: copy the package into
`~/.hermes/profiles/<p>/plugins/selection-explainer-hermes/`, then
`hermes -p <p> plugins enable selection-explainer-hermes`. (The CLI refuses to
enable a package that lives only in the default root, so the copy is not
optional.)

Explanations always answer with **that profile's** active model — `ctx.llm`
binds per profile — which is usually what you want in a multi-bot setup.

## Verify

```bash
hermes -p default plugins doctor selection-explainer-hermes
curl -s http://127.0.0.1:9119/api/plugins/selection-explainer-hermes/health
```

Then select any text in the app → chip → Explain.

## Credits & license

Port of the Chrome extension "Selection Explainer" by Antzcold (MIT). Hermes
plugin structure follows the official unified-package contract
(`plugin.yaml` + `dashboard/plugin_api.py` + `desktop/plugin.js`). MIT.
