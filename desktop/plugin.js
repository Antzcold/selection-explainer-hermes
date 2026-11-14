// Selection Explainer — Hermes desktop half (unified package).
// A port of the "browserchat-selection-explainer" Chrome extension for the
// Hermes desktop app: an action chip appears next to selected text anywhere in
// the app window; clicking it opens a floating mini-assistant card that explains
// the selection and answers follow-ups. Explanations come from the plugin's
// Python half via ctx.rest → /api/plugins/selection-explainer-hermes/explain,
// which calls ctx.llm with host-owned credentials (the user's active model).
//
// Plain ESM, loaded uncompiled. The chip/card UI is plain DOM (like the
// extension original); palette, keybind and the statusbar chip use the SDK.

import { host, PALETTE_AREA, KEYBINDS_AREA, Tip } from '@hermes/plugin-sdk'
import { jsx } from 'react/jsx-runtime'

const ID = 'selection-explainer-hermes'
const MIN_SELECTION = 3
const MAX_SELECTION = 600
const GLOBAL_KEY = '__selectionExplainerController'

const STYLE = `
.se-chip {
  position: fixed; z-index: 2147483000;
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 10px; border-radius: 8px; cursor: pointer;
  font: 500 12px/1.2 var(--font-sans, ui-sans-serif, system-ui, sans-serif);
  color: var(--foreground, #eee);
  background: var(--card, #1c1c1c);
  border: 1px solid var(--border, rgba(255,255,255,.14));
  box-shadow: 0 4px 16px rgba(0,0,0,.35);
  transition: opacity .12s ease, transform .12s ease;
  opacity: 0; transform: translateY(2px);
  user-select: none;
}
.se-chip.se-visible { opacity: 1; transform: translateY(0); }
.se-chip:hover { border-color: var(--accent, #7aa2f7); }
.se-chip .se-dot { width: 6px; height: 6px; border-radius: 3px; background: var(--accent, #7aa2f7); }

.se-card {
  position: fixed; z-index: 2147483001;
  width: 400px; max-width: calc(100vw - 24px);
  max-height: min(420px, calc(100vh - 32px));
  display: flex; flex-direction: column;
  border-radius: 12px;
  background: var(--card, #1c1c1c);
  border: 1px solid var(--border, rgba(255,255,255,.14));
  box-shadow: 0 12px 40px rgba(0,0,0,.45);
  color: var(--foreground, #eee);
  font: 400 13px/1.45 var(--font-sans, ui-sans-serif, system-ui, sans-serif);
  overflow: hidden;
}
.se-card * { box-sizing: border-box; }
.se-head {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px 8px 12px;
  border-bottom: 1px solid var(--border, rgba(255,255,255,.10));
  font-weight: 600; font-size: 12px;
  color: var(--muted-foreground, var(--foreground, #eee));
  flex: none;
}
.se-head .se-spacer { flex: 1; }
.se-close {
  border: 0; background: transparent; cursor: pointer; color: inherit;
  font-size: 14px; line-height: 1; padding: 2px 6px; border-radius: 6px; opacity: .7;
}
.se-close:hover { opacity: 1; background: rgba(128,128,128,.18); }
.se-quote {
  padding: 8px 12px; flex: none;
  font-size: 12px; color: var(--muted-foreground, rgba(238,238,238,.75));
  border-left: 2px solid var(--accent, #7aa2f7);
  background: rgba(128,128,128,.08);
  max-height: 64px; overflow: hidden;
  white-space: pre-wrap; word-break: break-word;
}
.se-log {
  flex: 1; overflow-y: auto; padding: 10px 12px;
  display: flex; flex-direction: column; gap: 8px;
}
.se-msg { white-space: pre-wrap; word-break: break-word; font-size: 13px; }
.se-msg.se-user {
  align-self: flex-end; max-width: 86%;
  background: rgba(128,128,128,.16); border-radius: 10px; padding: 6px 10px;
}
.se-msg.se-assistant { align-self: stretch; }
.se-msg.se-error { color: #f07178; font-size: 12px; }
.se-busy { display: inline-flex; gap: 4px; align-items: center; color: var(--muted-foreground, #999); font-size: 12px; }
.se-busy i { width: 5px; height: 5px; border-radius: 50%; background: var(--accent, #7aa2f7); animation: se-bounce 1s infinite ease-in-out; }
.se-busy i:nth-child(2) { animation-delay: .15s; }
.se-busy i:nth-child(3) { animation-delay: .3s; }
@keyframes se-bounce { 0%, 80%, 100% { transform: translateY(0); opacity: .5; } 40% { transform: translateY(-4px); opacity: 1; } }
.se-ask { display: flex; gap: 6px; padding: 8px 10px 10px 12px; border-top: 1px solid var(--border, rgba(255,255,255,.10)); flex: none; }
.se-input {
  flex: 1; resize: none; min-height: 32px; max-height: 88px;
  padding: 6px 9px; border-radius: 8px; font: inherit; color: inherit;
  background: rgba(128,128,128,.12);
  border: 1px solid var(--border, rgba(255,255,255,.14));
  outline: none;
}
.se-input:focus { border-color: var(--accent, #7aa2f7); }
.se-send {
  flex: none; border-radius: 8px; cursor: pointer; padding: 0 12px;
  font: 500 12px/1 var(--font-sans, ui-sans-serif, system-ui, sans-serif);
  color: var(--foreground, #fff);
  background: var(--accent, #7aa2f7);
  border: 1px solid transparent;
}
.se-send:disabled { opacity: .45; cursor: default; }
.se-foot {
  flex: none; display: flex; justify-content: space-between; gap: 8px;
  padding: 4px 12px 6px; font-size: 10.5px;
  color: var(--muted-foreground, rgba(238,238,238,.45));
}
`

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

function createController(ctx) {
  let style = null
  let chip = null
  let card = null
  let selection = ''      // the fixed selection this card explains
  let contextLabel = ''
  let turns = []          // [{role, content}] mini-chat after the initial answer
  let busy = false
  let requestSeq = 0
  let chipTimer = null

  // ---------- helpers ----------
  function ensureStyle() {
    style = document.getElementById('se-style')
    if (!style) {
      style = el('style')
      style.id = 'se-style'
      style.textContent = STYLE
      document.head.appendChild(style)
    }
  }

  function getSelectionInfo() {
    try {
      const sel = document.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
      const text = String(sel.toString() || '').trim()
      if (text.length < MIN_SELECTION || text.length > MAX_SELECTION) return null
      const rect = sel.getRangeAt(0).getBoundingClientRect()
      if (!rect || (rect.width === 0 && rect.height === 0)) return null
      return { text, rect }
    } catch {
      return null
    }
  }

  function insideOwn(node) {
    return node instanceof Node && (chip?.contains(node) || card?.contains(node))
  }

  function clamp(x, min, max) { return Math.min(Math.max(x, min), max) }

  // ---------- chip ----------
  function showChip(info) {
    hideChip()
    chip = el('div', 'se-chip')
    chip.appendChild(el('span', 'se-dot'))
    chip.appendChild(el('span', null, 'Explain'))
    chip.addEventListener('mousedown', (e) => e.preventDefault())
    chip.addEventListener('click', () => { hideChip(); openCard(info) })
    document.body.appendChild(chip)
    const top = clamp(info.rect.bottom + 7, 8, window.innerHeight - 30)
    const left = clamp(info.rect.left, 8, window.innerWidth - 110)
    chip.style.top = `${Math.round(top)}px`
    chip.style.left = `${Math.round(left)}px`
    requestAnimationFrame(() => chip && chip.classList.add('se-visible'))
  }

  function hideChip() {
    if (chip) { chip.remove(); chip = null }
  }

  // ---------- card ----------
  function openCard(info) {
    selection = info.text
    contextLabel = String(host.state?.model?.get?.() ?? '').slice(0, 60)
    turns = []
    busy = false
    requestSeq++
    buildCard(info.rect)
    void runExplain()
  }

  function buildCard(rect) {
    closeCard(false)
    card = el('div', 'se-card')

    const head = el('div', 'se-head')
    head.appendChild(el('span', null, '✦ Selection Explainer'))
    head.appendChild(el('span', 'se-spacer'))
    const close = el('button', 'se-close', '✕')
    close.title = 'Close (Esc)'
    close.addEventListener('click', () => closeCard())
    head.appendChild(close)
    card.appendChild(head)

    const quote = el('div', 'se-quote')
    const preview = selection.length > 180 ? `${selection.slice(0, 180)}…` : selection
    quote.appendChild(el('span', null, preview))
    card.appendChild(quote)

    const log = el('div', 'se-log')
    card.appendChild(log)

    const ask = el('div', 'se-ask')
    const input = el('textarea', 'se-input')
    input.rows = 1
    input.placeholder = 'Ask a follow-up…'
    const send = el('button', 'se-send', 'Send')
    const submit = () => {
      const q = input.value.trim()
      if (!q || busy) return
      input.value = ''
      sendFollowup(q)
    }
    send.addEventListener('click', submit)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
    })
    ask.appendChild(input)
    ask.appendChild(send)
    card.appendChild(ask)

    const foot = el('div', 'se-foot')
    foot.appendChild(el('span', 'se-model', ''))
    foot.appendChild(el('span', 'se-elapsed', ''))
    card.appendChild(foot)

    document.body.appendChild(card)

    const width = 400
    let top = rect.bottom + 8
    if (top + 260 > window.innerHeight) top = Math.max(8, rect.top - 268)
    card.style.top = `${clamp(Math.round(top), 8, window.innerHeight - 60)}px`
    card.style.left = `${clamp(Math.round(rect.left), 8, window.innerWidth - width - 8)}px`

    card._log = log
    card._input = input
    card._send = send
    card._model = foot.firstChild
    card._elapsed = foot.lastChild
  }

  function closeCard(notifyOwner = true) {
    if (card) { card.remove(); card = null }
    if (notifyOwner) { requestSeq++ }
    selection = ''
    turns = []
    busy = false
  }

  function addMsg(role, content) {
    if (!card) return null
    const node = el('div', `se-msg ${role === 'user' ? 'se-user' : 'se-assistant'}`)
    node.textContent = content
    card._log.appendChild(node)
    card._log.scrollTop = card._log.scrollHeight
    return node
  }

  function setBusy(on) {
    busy = on
    if (!card) return
    card._send.disabled = on
    card._input.disabled = on
    if (!on) card._input.focus()
  }

  async function callBackend(payload) {
    return ctx.rest('/explain', { method: 'POST', body: payload })
  }

  async function runExplain() {
    const seq = requestSeq
    setBusy(true)
    const busyNode = el('div', 'se-busy')
    for (let i = 0; i < 3; i++) busyNode.appendChild(el('i'))
    card && card._log.appendChild(busyNode)
    card && (card._log.scrollTop = card._log.scrollHeight)
    try {
      const res = await callBackend({ selection, context: contextLabel, turns: [] })
      if (seq !== requestSeq || !card) return
      busyNode.remove()
      const text = String(res?.text || '').trim() || '(empty response)'
      turns.push({ role: 'assistant', content: text })
      addMsg('assistant', text)
      card._model.textContent = `${res?.provider || ''}${res?.model ? ' · ' + res.model : ''}`
      card._elapsed.textContent = res?.elapsed_ms ? `${res.elapsed_ms} ms` : ''
    } catch (err) {
      if (seq !== requestSeq || !card) return
      busyNode.remove()
      addMsg('error', `⚠ ${err?.message || 'request failed'}`)
      host.notify({ kind: 'error', message: 'Selection Explainer request failed — is the plugin enabled?' })
    } finally {
      if (seq === requestSeq) setBusy(false)
    }
  }

  async function sendFollowup(question) {
    const seq = requestSeq
    setBusy(true)
    addMsg('user', question)
    const busyNode = el('div', 'se-busy')
    for (let i = 0; i < 3; i++) busyNode.appendChild(el('i'))
    card && card._log.appendChild(busyNode)
    card && (card._log.scrollTop = card._log.scrollHeight)
    try {
      const payload = {
        selection,
        context: contextLabel,
        turns: [...turns, { role: 'user', content: question }],
      }
      const res = await callBackend(payload)
      if (seq !== requestSeq || !card) return
      busyNode.remove()
      const text = String(res?.text || '').trim() || '(empty response)'
      turns.push({ role: 'user', content: question })
      turns.push({ role: 'assistant', content: text })
      addMsg('assistant', text)
      card._elapsed.textContent = res?.elapsed_ms ? `${res.elapsed_ms} ms` : ''
    } catch (err) {
      if (seq !== requestSeq || !card) return
      busyNode.remove()
      addMsg('error', `⚠ ${err?.message || 'request failed'}`)
    } finally {
      if (seq === requestSeq) setBusy(false)
    }
  }

  // ---------- events ----------
  function onSelectionSettled() {
    if (card) return // card open: keep the original selection
    const info = getSelectionInfo()
    if (info) showChip(info)
    else hideChip()
  }

  function onSelectionChange() {
    if (chipTimer) clearTimeout(chipTimer)
    chipTimer = setTimeout(onSelectionSettled, 220)
  }

  function onMouseDown(e) {
    if (insideOwn(e.target)) return
    hideChip()
  }

  function onKeydown(e) {
    if (e.key === 'Escape') {
      const hadCard = !!card
      closeCard()
      hideChip()
      if (hadCard) e.stopPropagation()
    }
  }

  function explainNow() {
    const info = getSelectionInfo()
    if (!info) {
      host.notify({ kind: 'info', message: 'Select some text first, then run Explain Selection.' })
      return
    }
    hideChip()
    openCard(info)
  }

  function start() {
    ensureStyle()
    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeydown, true)
  }

  function teardown() {
    if (chipTimer) clearTimeout(chipTimer)
    document.removeEventListener('selectionchange', onSelectionChange)
    document.removeEventListener('mousedown', onMouseDown)
    document.removeEventListener('keydown', onKeydown, true)
    hideChip()
    closeCard()
    if (style) { style.remove(); style = null }
  }

  return { start, teardown, explainNow }
}

function StatusChip({ controller }) {
  return jsx(Tip, {
    label: 'Selection Explainer — explain the current selection',
    children: jsx('button', {
      type: 'button',
      className: 'se-status-chip',
      onClick: () => controller.explainNow(),
      style: {
        border: 0, background: 'transparent', cursor: 'pointer',
        color: 'var(--muted-foreground, inherit)', fontSize: '11px',
        padding: '0 6px', height: '100%',
      },
      children: '✦ Explain',
    }),
  })
}

export default {
  id: ID,
  name: 'Selection Explainer',
  defaultEnabled: false,
  register(ctx) {
    // Hot reload safety: tear down any previous instance first.
    const prev = globalThis[GLOBAL_KEY]
    if (prev && typeof prev.teardown === 'function') prev.teardown()

    const controller = createController(ctx)
    globalThis[GLOBAL_KEY] = controller
    controller.start()

    ctx.register({
      id: `${ID}.palette`,
      area: PALETTE_AREA,
      data: {
        id: `${ID}.explain`,
        label: 'Explain Selection',
        keywords: ['explain', 'selection', 'ai', 'selection-explainer'],
        run: () => controller.explainNow(),
      },
    })

    ctx.register({
      id: `${ID}.keybind`,
      area: KEYBINDS_AREA,
      data: {
        id: `${ID}.explain`,
        label: 'Explain Selection',
        category: 'Selection Explainer',
        defaults: ['mod+shift+e'],
        run: () => controller.explainNow(),
      },
    })

    ctx.register({
      id: `${ID}.status-chip`,
      area: 'statusBar.right',
      order: 150,
      render: () => jsx(StatusChip, { controller }),
    })
  },
}
