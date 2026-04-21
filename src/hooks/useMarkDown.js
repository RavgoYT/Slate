// useMarkdown.js v22 — math-wrap aware: surgical render around live math nodes

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// ─── DOM Helpers ──────────────────────────────────────────────────────────────

let _id = 0; const mkId = () => 'md' + (++_id)
const mkEl = (tag, props = {}, html = '') => {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) k.startsWith('data-') ? e.setAttribute(k, v) : e[k] = v
  if (html) e.innerHTML = html
  return e
}
const mkP = () => mkEl('p', { 'data-blockId': mkId() }, '<br>')
const up = (node, sel) => (node?.nodeType === 3 ? node.parentElement : node)?.closest?.(sel) || null
const selNode = () => window.getSelection()?.getRangeAt(0)?.startContainer || null

// ─── Caret Management ─────────────────────────────────────────────────────────
//
// math-wrap nodes are treated as a single opaque atom (1 character) by the
// caret offset system. This is stable across re-renders because we don't rely
// on the random data-math-id string length.

function caretOffset(el) {
  const sel = window.getSelection()
  if (!sel?.rangeCount) return 0
  const r = sel.getRangeAt(0)
  let count = 0
  function nodeRawLen(node) {
    if (node.nodeType === 3) return node.textContent.length
    if (node.nodeType === 1 && node.tagName === 'IMG' && node.dataset.emojiId) return node.dataset.emojiId.length + 2
    if (node.nodeType === 1 && node.classList?.contains('math-wrap')) return 1
    if (node.nodeType === 1 && node.tagName === 'BR') return 0
    let len = 0; for (const c of node.childNodes) len += nodeRawLen(c)
    return len
  }
  function walk(node) {
    if (node === r.startContainer) {
      if (node.nodeType === 3) { count += r.startOffset; return true }
      for (let i = 0; i < r.startOffset; i++) count += nodeRawLen(node.childNodes[i])
      return true
    }
    if (node.nodeType === 3) { count += node.textContent.length; return false }
    if (node.nodeType === 1 && node.tagName === 'IMG' && node.dataset.emojiId) {
      count += node.dataset.emojiId.length + 2; return false
    }
    if (node.nodeType === 1 && node.classList?.contains('math-wrap')) {
      count += 1; return false
    }
    if (node.nodeType === 1 && node.tagName === 'BR') return false
    for (const child of node.childNodes) { if (walk(child)) return true }
    return false
  }
  walk(el)
  return count
}

function setCaret(el, off) {
  const sel = window.getSelection(); if (!sel) return
  let remain = Math.max(0, off)
  function walk(node) {
    if (node.nodeType === 3) {
      const len = node.textContent.length
      if (remain <= len) {
        const r = document.createRange(); r.setStart(node, remain); r.collapse(true)
        sel.removeAllRanges(); sel.addRange(r); return true
      }
      remain -= len; return false
    }
    if (node.nodeType === 1 && node.tagName === 'IMG' && node.dataset.emojiId) {
      const len = node.dataset.emojiId.length + 2
      if (remain <= len) {
        const r = document.createRange(); r.setStartAfter(node); r.collapse(true)
        sel.removeAllRanges(); sel.addRange(r); return true
      }
      remain -= len; return false
    }
    // FIX: Strictly evaluate 0 and 1 so the caret stays on the correct side
    if (node.nodeType === 1 && node.classList?.contains('math-wrap')) {
      if (remain === 0) {
        const r = document.createRange(); r.setStartBefore(node); r.collapse(true)
        sel.removeAllRanges(); sel.addRange(r); return true
      }
      if (remain === 1) {
        const r = document.createRange(); r.setStartAfter(node); r.collapse(true)
        sel.removeAllRanges(); sel.addRange(r); return true
      }
      remain -= 1; return false
    }
    if (node.nodeType === 1 && node.tagName === 'BR') return false
    for (const child of node.childNodes) { if (walk(child)) return true }
    return false
  }
  if (!walk(el)) {
    const r = document.createRange(); r.selectNodeContents(el); r.collapse(false)
    sel.removeAllRanges(); sel.addRange(r)
  }
}

const caretToStart = el => setCaret(el, 0)
const caretToEnd = el => setCaret(el, el.textContent.length)
const atStart = el => {
  const sel = window.getSelection()
  if (!sel?.rangeCount || !sel.getRangeAt(0).collapsed) return false
  const r = document.createRange()
  r.setStart(el, 0); r.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset)
  return !r.toString().length
}

const focusAfter = (getEl, end) => setTimeout(() => getEl()?.isConnected && (end ? caretToEnd : caretToStart)(getEl()), 0)
const isAfterInDom = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

function nudgeOutOfMarker() {
  const sel = window.getSelection(), r = sel?.rangeCount && sel.getRangeAt(0)
  if (!r?.collapsed) return
  const marker = (r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer)?.closest?.('.md-marker')
  if (marker) { const after = document.createRange(); after.setStartAfter(marker); after.collapse(true); sel.removeAllRanges(); sel.addRange(after) }
}

// ─── Raw Text & Parsing ───────────────────────────────────────────────────────

// Store math nodes globally to preserve them during HTML wipes.
// Key: data-math-id string. Value: the live math-wrap DOM node.
const mathNodesMap = new Map();

const domToRaw = node => {
  if (!node) return ''
  if (node.nodeType === 3) return node.textContent
  const tag = node.tagName?.toLowerCase()
  if (!tag || tag === 'br') return ''
  if (node.classList?.contains('md-marker')) return node.textContent
  if (tag === 'img' && node.dataset.emojiId) return `:${node.dataset.emojiId}:`

  // Preserve live math-wrap nodes: detach to map, return placeholder
  if (node.classList?.contains('math-wrap')) {
    let id = node.getAttribute('data-math-id');
    if (!id) {
      id = 'm' + Math.random().toString(36).slice(2);
      node.setAttribute('data-math-id', id);
    }
    mathNodesMap.set(id, node);
    return `\x00${id}\x00`;
  }

  return Array.from(node.childNodes).map(domToRaw).join('')
}

const getRaw = b => b.dataset.mdCommitted ? b.dataset.mdSrc || b.textContent || '' : domToRaw(b)
const hasMarkdown = raw => /[*_~`|\[\\:\x00]/.test(raw)

const MARKERS = ['***', '**', '*', '__', '~~', '`', '||']
const KIND = { '***': 'bolditalic', '**': 'bold', '*': 'italic', '__': 'underline', '~~': 'strike', '`': 'code', '||': 'spoiler' }
const ESCAPE_TOKENS = ['*', '~', '_', '`', '|', '[', '#', '-', '>', '\\']

function findClose(raw, start, marker) {
  for (let i = start; i < raw.length; i++) {
    if (raw[i] === '\\') { i++; continue }
    if (raw.startsWith(marker, i)) {
      const c = raw.slice(start, i)
      if (!c.length || (c.length > 0 && c.split('').every(ch => ch === marker[0]))) continue
      return i
    }
  }
  return -1
}

const TWEMOJI_BASE = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/'
const _emojiImg = (id) => {
  const flat = window.__emojiFlat
  const emoji = flat?.find(e => e.id === id)
  if (!emoji) {
    return `<span class="md-emoji-pending" data-emoji-id="${id}">:${id}:</span>`
  }
  return `<img src="${TWEMOJI_BASE}${emoji.unified.toLowerCase()}.svg" alt="${emoji.native}" class="md-emoji" data-emoji-id="${id}" data-emoji-native="${emoji.native}" draggable="false" data-noresize="true" />`
}

function tokenize(raw) {
  const tokens = []; let i = 0
  while (i < raw.length) {

    const parseMath = (startStr, endStr, offset) => {
      if (raw.startsWith(startStr, i)) {
        const end = raw.indexOf(endStr, i + offset);
        if (end > i) {
          const latex = raw.slice(i + offset, end);
          const id = 'm' + Math.random().toString(36).slice(2);
          if (window._buildMathWrap) {
            const node = window._buildMathWrap(latex);
            node.setAttribute('data-math-id', id);
            // Mark as restored — mount handler must not steal focus
            node.dataset.noFocus = '1';
            mathNodesMap.set(id, node);
            tokens.push({ type: 'math-node', id });
          } else {
            tokens.push({ type: 'text', text: raw.slice(i, end + endStr.length) });
          }
          i = end + endStr.length; return true;
        }
      }
      return false;
    };

    if (parseMath('\\[', '\\]', 2)) continue;
    if (parseMath('$$', '$$', 2)) continue;

    // Single dollar inline math
    if (raw[i] === '$' && i + 1 < raw.length && raw[i+1] !== ' ' && raw[i+1] !== '$') {
      const end = raw.indexOf('$', i + 1);
      if (end > i && raw[end-1] !== ' ' && raw[end-1] !== '\\') {
        const latex = raw.slice(i + 1, end);
        const id = 'm' + Math.random().toString(36).slice(2);
        if (window._buildMathWrap) {
          const node = window._buildMathWrap(latex);
          node.setAttribute('data-math-id', id);
          node.dataset.noFocus = '1';
          mathNodesMap.set(id, node);
          tokens.push({ type: 'math-node', id });
        } else {
          tokens.push({ type: 'text', text: raw.slice(i, end + 1) });
        }
        i = end + 1; continue;
      }
    }

    if (raw[i] === '\\' && i + 1 < raw.length) {
      const tok = ESCAPE_TOKENS.find(t => raw.startsWith(t, i + 1))
      if (tok) { tokens.push({ type: 'escape', raw: '\\' + tok, text: tok }); i += 1 + tok.length; continue }
    }
    if (raw[i] === '[') {
      const cb = raw.indexOf(']', i + 1), cp = raw.indexOf(')', cb + 2)
      if (cb > -1 && raw[cb + 1] === '(' && cp > -1) {
        tokens.push({ type: 'link', label: raw.slice(i + 1, cb), url: raw.slice(cb + 2, cp) })
        i = cp + 1; continue
      }
    }
    if (raw[i] === ':') {
      const end = raw.indexOf(':', i + 1)
      if (end > i + 1) {
        const id = raw.slice(i + 1, end)
        if (/^[a-zA-Z0-9_+\-]+$/.test(id)) {
          tokens.push({ type: 'emoji', id })
          i = end + 1; continue
        }
      }
    }
    // Restore already-parsed math nodes (from domToRaw placeholders)
    if (raw[i] === '\x00') {
      const end = raw.indexOf('\x00', i + 1);
      if (end > i) {
        tokens.push({ type: 'math-node', id: raw.slice(i + 1, end) });
        i = end + 1; continue;
      }
    }
    const m = MARKERS.find(m => raw.startsWith(m, i))
    if (m) {
      const end = findClose(raw, i + m.length, m)
      if (end > -1) {
        tokens.push({ type: 'styled', marker: m, kind: KIND[m], content: raw.slice(i + m.length, end) })
        i = end + m.length; continue
      }
    }
    const last = tokens[tokens.length - 1]
    if (last?.type === 'text') last.text += raw[i]
    else tokens.push({ type: 'text', text: raw[i] })
    i++
  }
  return tokens
}

const wrap = (k, i) => k === 'bolditalic' ? `<strong><em>${i}</em></strong>` : k === 'bold' ? `<strong>${i}</strong>` : k === 'italic' ? `<em>${i}</em>` : k === 'underline' ? `<span class="md-underline">${i}</span>` : k === 'strike' ? `<span class="md-strike">${i}</span>` : k === 'code' ? `<code class="md-inline-code">${i}</code>` : `<span class="md-spoiler">${i}</span>`

const renderInline = raw => tokenize(raw).map(t =>
  t.type === 'text'   ? esc(t.text) :
  t.type === 'escape' ? `<span class="md-marker">\\</span>${esc(t.text)}` :
  t.type === 'emoji'  ? (_emojiImg(t.id) || esc(`:${t.id}:`)) :
  t.type === 'math-node' ? `<span class="math-restore" data-math-id="${t.id}"></span>` :
  t.type === 'link'   ? `<span class="md-marker">[</span>${esc(t.label)}<span class="md-marker">](${esc(t.url)})</span>` :
  `<span class="md-marker">${esc(t.marker)}</span>${wrap(t.kind, renderInline(t.content))}<span class="md-marker">${esc(t.marker)}</span>`
).join('')

const renderClean = raw => tokenize(raw).map(t =>
  t.type === 'text' || t.type === 'escape' ? esc(t.text) :
  t.type === 'emoji' ? (_emojiImg(t.id) || esc(`:${t.id}:`)) :
  t.type === 'math-node' ? `<span class="math-restore" data-math-id="${t.id}"></span>` :
  t.type === 'link'  ? `<a href="${esc(/^https?:\/\//.test(t.url) ? t.url : 'https://' + t.url)}" class="md-link" target="_blank" rel="noopener noreferrer">${esc(t.label)}</a>` :
  wrap(t.kind, renderClean(t.content))
).join('')

// ─── Block State & Execution ──────────────────────────────────────────────────

function setHtmlAndRestore(block, newHtml) {
  block.innerHTML = newHtml;
  block.querySelectorAll('.math-restore').forEach(span => {
    const id = span.getAttribute('data-math-id');
    const originalNode = mathNodesMap.get(id);
    if (originalNode) {
      span.replaceWith(originalNode);
      mathNodesMap.delete(id);
    }
  });
}

// Returns true if block has any live .math-wrap nodes in the DOM
const _hasMathWrap = b => !!b?.querySelector?.('.math-wrap')

// Render only the non-math text/inline runs around live math-wrap nodes,
// leaving the math-wrap nodes themselves completely untouched in the DOM.
// renderFn is renderInline (live) or renderClean (committed).
function _renderAroundMath(block, renderFn) {
  // Snapshot children so we can mutate safely
  const kids = [...block.childNodes]
  let run = []

  const flushRun = () => {
    if (!run.length) return
    const raw = run.map(n => domToRaw(n)).join('')
    if (hasMarkdown(raw)) {
      const tmp = document.createElement('span')
      tmp.innerHTML = renderFn(raw)
      const anchor = run[0]
      const parent = anchor.parentNode
      if (parent) {
        ;[...tmp.childNodes].forEach(c => parent.insertBefore(c, anchor))
        run.forEach(n => { try { parent.removeChild(n) } catch {} })
      }
    }
    run = []
  }

  for (const child of kids) {
    if (child.classList?.contains('math-wrap')) {
      flushRun()
      // math-wrap stays in place — no touch
    } else {
      run.push(child)
    }
  }
  flushRun()
}

function applyLive(block) {
  // If block contains live math-wraps, only re-render the text around them
  if (_hasMathWrap(block)) {
    const off = caretOffset(block);
    _renderAroundMath(block, renderInline)
    const raw = domToRaw(block)
    block.dataset.mdLive = '1'; block.dataset.mdSrc = raw
    delete block.dataset.mdCommitted
    try { setCaret(block, off); nudgeOutOfMarker() } catch (_) {} // <-- FIX: Restore caret
    return
  }
  const raw = getRaw(block)
  if (!hasMarkdown(raw)) {
    if (block.dataset.mdLive) {
      const off = caretOffset(block)
      block.textContent = raw; delete block.dataset.mdLive; delete block.dataset.mdSrc
      try { setCaret(block, off) } catch (_) {}
    }
    return
  }
  const off = caretOffset(block), newHtml = renderInline(raw)
  if (block.innerHTML === newHtml) return
  setHtmlAndRestore(block, newHtml)
  block.dataset.mdLive = '1'; block.dataset.mdSrc = raw
  delete block.dataset.mdCommitted
  try { setCaret(block, Math.min(off, raw.length)); nudgeOutOfMarker() } catch (_) {}
}

function commitBlock(block) {
  if (block.dataset.mdCommitted) return
  // Never commit a block that contains a focused math-field — doing so would
  // re-render the innerHTML and destroy the live custom element.
  const ae = document.activeElement
  if (ae?.tagName === 'MATH-FIELD' && block.contains(ae)) return
  // If block contains live math-wraps, render clean HTML only around them
  // (surgically, never wiping innerHTML which would destroy the custom elements).
  if (_hasMathWrap(block)) {
    _renderAroundMath(block, renderClean)
    const raw = domToRaw(block)
    block.dataset.mdCommitted = '1'; block.dataset.mdSrc = raw
    delete block.dataset.mdLive; wireSpoilers(block)
    return
  }
  const raw = block.dataset.mdLive ? getRaw(block) : (block.dataset.mdSrc || getRaw(block))
  if (!raw || !hasMarkdown(raw)) {
    if (block.dataset.mdLive) { block.textContent = raw; delete block.dataset.mdLive; delete block.dataset.mdSrc }
    return
  }
  setHtmlAndRestore(block, renderClean(raw))
  block.dataset.mdCommitted = '1'; block.dataset.mdSrc = raw
  delete block.dataset.mdLive; wireSpoilers(block)
}

function uncommitBlock(block) {
  if (!block.dataset.mdCommitted) return
  // If block has live math-wraps: render inline around them surgically
  if (_hasMathWrap(block)) {
    _renderAroundMath(block, renderInline)
    const raw = domToRaw(block)
    block.dataset.mdLive = '1'; block.dataset.mdSrc = raw
    delete block.dataset.mdCommitted
    return
  }
  const raw = block.dataset.mdSrc || domToRaw(block)
  setHtmlAndRestore(block, renderInline(raw))
  block.dataset.mdLive = '1'; block.dataset.mdSrc = raw
  delete block.dataset.mdCommitted
}

function getBlock(editorEl) {
  let n = selNode()
  if (n?.nodeType === 3) n = n.parentElement
  const cell = n?.closest?.('td, th')
  if (cell && editorEl.contains(cell)) return cell
  while (n && n !== editorEl && n.parentElement !== editorEl) n = n.parentElement
  if (!n || n === editorEl) return null
  return (n.tagName === 'UL' || n.tagName === 'OL') && n.classList.contains('md-list') ? selNode()?.closest?.('li') ?? n : n
}

// ─── Events ───────────────────────────────────────────────────────────────────

export function attachMarkdown(editorEl) {
  if (!editorEl) return () => {}
  const fire = () => editorEl.dispatchEvent(new Event('input', { bubbles: true }))
  let activeBlock = null, lastSelNode = null

  const setActive = b => { if (b !== activeBlock) { activeBlock?.isConnected && commitBlock(activeBlock); activeBlock = b } }

  // Helper: is a math-field currently focused (inside or as activeElement)?
  const isMathFocused = () => {
    const f = document.activeElement
    return f?.tagName === 'MATH-FIELD' || !!f?.closest?.('math-field, .math-wrap')
  }

  const onInput = () => {
    // Never touch the DOM while a math-field has focus — its input events
    // bubble up here but applyLive would wipe the block's innerHTML.
    if (isMathFocused()) return

    if (window.__skipMarkdownSync) {
      window.__skipMarkdownSync = false;
      const b = getBlock(editorEl);
      if (b) {
        // Update the source tracker so Markdown knows about the new emoji
        b.dataset.mdLive = '1';
        b.dataset.mdSrc = domToRaw(b);
      }
      return;
    }
    const b = getBlock(editorEl)
    if (b) {
      setActive(b)
      !b.dataset.mdBlock && b.tagName !== 'PRE' && applyLive(b)
    }
  }

  const onKeyDown = e => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return

    // If we're editing a code block, Enter is handled by c.onkeydown — don't intercept here
    if (e.key === 'Enter' && e.target?.closest?.('.md-codeblock[data-md-editing]')) return

    const block = getBlock(editorEl)

if (block?.dataset.mdCommitted) {
      const isPrint = e.key.length === 1, isDel = e.key === 'Backspace' || e.key === 'Delete'
      if (isPrint || isDel) {
        e.preventDefault()
        
        // Capture caret BEFORE modifying the DOM
        const off = caretOffset(block); 
        
        uncommitBlock(block); 
        activeBlock = block;
        
        // Restore the caret so the browser knows exactly where to type
        try { setCaret(block, off) } catch (_) {} 

        // Re-dispatch key so the browser applies it to the now-live DOM natively.
        // This preserves the native execCommand('undo') stack for ALL blocks!
        if (isPrint) {
          document.execCommand('insertText', false, e.key)
        } else if (e.key === 'Backspace' && off > 0) {
          document.execCommand('delete')
        } else if (e.key === 'Delete') {
          document.execCommand('forwardDelete')
        }
        return
      }
    }

    if (e.key === 'Backspace' && block && selNode() && window.getSelection().getRangeAt(0).collapsed && atStart(block)) {
      const prev = block.previousElementSibling
      if (prev?.dataset.mdCommitted) {
        e.preventDefault()
        const prevRaw = prev.dataset.mdSrc || domToRaw(prev) || '', merged = prevRaw + getRaw(block)
        prev.textContent = merged
        delete prev.dataset.mdLive; delete prev.dataset.mdSrc; delete prev.dataset.mdCommitted
        block.remove(); fire()
        if (activeBlock && activeBlock !== prev && activeBlock.isConnected) commitBlock(activeBlock)
        activeBlock = prev; applyLive(prev)
        try { setCaret(prev, prevRaw.length) } catch (_) {}
        return
      }
    }
    if (e.key === 'Enter' && handleEnter(e, editorEl, fire)) fire()
    if (e.key === 'Backspace' && handleBackspace(e, editorEl, fire)) fire()
    if (e.key === 'Delete' && handleDelete(e, editorEl, fire)) fire()
  }

  const onSelChange = () => {
    const node = selNode()
    if (node === lastSelNode) return
    lastSelNode = node
    // When focus moves into a math-field the selection lands in shadow DOM —
    // getBlock() returns null. Don't commit the active block, it still "owns"
    // the math-wrap that just received focus.
    if (isMathFocused()) return
    const block = getBlock(editorEl)
    if (!block || block === activeBlock) return
    activeBlock?.isConnected && commitBlock(activeBlock)
    activeBlock = block
    if (block.dataset.mdCommitted) uncommitBlock(block)
  }

  const onMouseDown = e => {
    const l = e.target.closest?.('.md-link'), s = e.target.closest?.('.md-spoiler')
    if (l) return e.preventDefault(), window.open(l.href, l.target || '_blank')
    if (s) return e.preventDefault(), s.classList.toggle('md-spoiler--revealed')
    // Clicks on math-wraps go to the math-field — don't uncommit
    if (e.target.closest?.('.math-wrap')) return
    let n = e.target
    while (n && n !== editorEl && n.parentElement !== editorEl) n = n.parentElement
    if (n && n !== editorEl && n.dataset.mdCommitted) uncommitBlock(n)
  }

  const onBlur = (e) => {
    // If focus is moving to a math-field that's INSIDE this editor, don't
    // commit the active block — the math-field is part of it.
    // Check relatedTarget first (synchronous, most reliable when it works).
    const related = e.relatedTarget
    if (related?.tagName === 'MATH-FIELD' || related?.closest?.('.math-wrap')) return
    // Custom elements (math-field) may not set relatedTarget reliably — defer
    // one tick so document.activeElement has settled.
    const blurredBlock = activeBlock
    setTimeout(() => {
      const ae = document.activeElement
      if (ae?.tagName === 'MATH-FIELD' && editorEl.contains(ae)) return
      if (blurredBlock?.isConnected) commitBlock(blurredBlock)
      if (activeBlock === blurredBlock) activeBlock = null
    }, 0)
  }

  editorEl.addEventListener('input', onInput)
  editorEl.addEventListener('keydown', onKeyDown)
  editorEl.addEventListener('mousedown', onMouseDown)
  editorEl.addEventListener('blur', onBlur, true)
  document.addEventListener('selectionchange', onSelChange)

  return () => {
    editorEl.removeEventListener('input', onInput); editorEl.removeEventListener('keydown', onKeyDown)
    editorEl.removeEventListener('mousedown', onMouseDown); editorEl.removeEventListener('blur', onBlur, true)
    document.removeEventListener('selectionchange', onSelChange)
  }
}

// ─── Block Generators & Enter Handlers ────────────────────────────────────────

const replBlock = (b, el, fire) => { b.replaceWith(el); const p = mkP(); el.after(p); fire(); focusAfter(() => p, false); return true }

function handleEnter(e, editorEl, fire) {
  const bqMulti = up(selNode(), 'blockquote.md-bq-multi')
  if (bqMulti && editorEl.contains(bqMulti)) {
    e.preventDefault(); const r = window.getSelection()?.getRangeAt?.(0)
    if (r) {
      let n = r.startContainer; if (n.nodeType === 3) n = n.parentElement
      const l = n === bqMulti ? bqMulti.querySelector('p:last-child') : n.closest('p') ?? n
      if (!(l?.innerText || l?.textContent || '').trim()) {
        l?.remove(); const p = mkP(); bqMulti.after(p); fire()
        focusAfter(() => bqMulti.nextElementSibling, false); return true
      }
    }
    return document.execCommand('insertParagraph'), true
  }

  const bqSingle = up(selNode(), 'blockquote.md-bq-single')
  if (bqSingle && editorEl.contains(bqSingle)) {
    e.preventDefault(); const p = mkP(); bqSingle.after(p); fire(); focusAfter(() => bqSingle.nextElementSibling, false); return true
  }

  const li = up(selNode(), 'li')
  if (li && editorEl.contains(li)) {
    e.preventDefault(); const list = li.closest('.md-list'); if (!list) return false
    if (!(li.innerText || li.textContent || '').trim()) {
      const p = mkP(); list.after(p)
      if (!li.previousElementSibling && !li.nextElementSibling) list.remove()
      else li.remove()
      fire(); focusAfter(() => list.nextElementSibling, false)
    } else {
      const nLi = mkEl('li', {}, '<br>'); li.after(nLi); fire(); focusAfter(() => li.nextElementSibling, false)
    }
    return true
  }

  const b = getBlock(editorEl)
  if (!b || b.dataset.mdBlock === '1' || ['LI', 'BLOCKQUOTE', 'TD', 'TH'].includes(b.tagName)) return false

  const raw = getRaw(b).trim()
  if (!raw) return false

  let m = raw.match(/^(#{1,3}) (.+)$/); if (m) return e.preventDefault(), replBlock(b, mkEl(`h${m[1].length}`, { className: `md-heading md-h${m[1].length}`, 'data-md': '1', 'data-md-block': '1', 'data-md-src': raw, 'data-blockId': b.dataset.blockId || mkId() }, renderClean(m[2])), fire)
  m = raw.match(/^-# (.+)$/); if (m) return e.preventDefault(), replBlock(b, mkEl('p', { className: 'md-subtext', 'data-md': '1', 'data-md-block': '1', 'data-md-src': raw, 'data-blockId': b.dataset.blockId || mkId() }, renderClean(m[1])), fire)
  m = raw.match(/^>> (.+)$/); if (m) return e.preventDefault(), replBlock(b, mkEl('blockquote', { className: 'md-blockquote md-bq-single', 'data-md': '1', 'data-md-block': '1', 'data-blockId': b.dataset.blockId || mkId() }, renderClean(m[1])), fire)
  m = raw.match(/^>>> ?(.*)$/); if (m) { e.preventDefault(); const bq = mkEl('blockquote', { className: 'md-blockquote md-bq-multi', 'data-md': '1', 'data-md-block': '1', 'data-blockId': b.dataset.blockId || mkId(), contentEditable: 'true' }, `<p>${m[1].trim() ? renderClean(m[1].trim()) : '<br>'}</p>`); b.replaceWith(bq); fire(); return caretToEnd(bq), true }

  m = raw.match(/^[-*+] (.*)$/); if (m) return e.preventDefault(), makeLi(b, m[1], false, editorEl, fire), true
  m = raw.match(/^\d+[\.\)] (.*)$/); if (m) return e.preventDefault(), makeLi(b, m[1], true, editorEl, fire), true

  m = raw.match(/^```(\w*)$/); if (m) {
    e.preventDefault(); const pnd = editorEl.querySelector('[data-md-fence-pending]')
    if (!pnd) { b.dataset.mdFencePending = '1'; b.dataset.mdFenceLang = m[1] || ''; b.textContent = raw; const p = mkP(); b.after(p); fire(); focusAfter(() => b.nextElementSibling, false) }
    else isAfterInDom(pnd, b) ? sealFence(pnd, b, editorEl, fire) : sealFence(b, pnd, editorEl, fire)
    return true
  }

  if (b.dataset.mdLive) { e.preventDefault(); commitBlock(b); const p = mkP(); b.after(p); fire(); focusAfter(() => p, false); return true }
  return false
}

function handleDelete(e, editorEl, fire) {
  const sel = window.getSelection()
  if (!sel?.rangeCount || !sel.getRangeAt(0).collapsed) return false
  const b = getBlock(editorEl); if (!b) return false
  const next = b.nextElementSibling
  const nextIsCode = next?.classList.contains('editor-code-block-host') || next?.classList.contains('md-codeblock')
  if (nextIsCode) {
    const r = sel.getRangeAt(0)
    const endRange = document.createRange()
    endRange.selectNodeContents(b); endRange.collapse(false)
    const atEnd = r.compareBoundaryPoints(Range.START_TO_START, endRange) >= 0
    if (atEnd) { e.preventDefault(); next.__codeRoot?.unmount(); next.remove(); fire(); return true }
  }
  return false
}

function handleBackspace(e, editorEl, fire) {
  const sel = window.getSelection()
  if (!sel?.rangeCount || !sel.getRangeAt(0).collapsed) return false
  const b = getBlock(editorEl); if (!b) return false

  const bqm = up(selNode(), 'blockquote.md-bq-multi')
  if (bqm && editorEl.contains(bqm) && atStart(bqm)) {
    e.preventDefault(); const p = mkP(); const c = (bqm.innerText || '').trim(); if (c) p.textContent = c
    bqm.replaceWith(p); fire(); focusAfter(() => p, true); return true
  }

  const prev = b.previousElementSibling
  const prevIsCode = prev?.classList.contains('editor-code-block-host') || prev?.classList.contains('md-codeblock')
  if (prevIsCode && atStart(b)) {
    e.preventDefault();
    // Don't delete — move caret to the right strip of the code block
    const rightStrip = prev.querySelector?.('.code-strip-after');
    if (rightStrip) {
      rightStrip.focus();
      try {
        const r = document.createRange();
        r.setStart(rightStrip.firstChild || rightStrip, 0); r.collapse(true);
        window.getSelection().removeAllRanges(); window.getSelection().addRange(r);
      } catch (_) {}
    }
    return true
  }

  const li = up(selNode(), 'li')
  if (li && editorEl.contains(li) && !(li.innerText || li.textContent || '').trim()) {
    e.preventDefault(); const list = li.closest('.md-list'), p = mkP(); list.after(p)
    if (!li.previousElementSibling && !li.nextElementSibling) list.remove()
    else li.remove()
    fire(); focusAfter(() => list.nextElementSibling ?? p, false); return true
  }

  if (b.dataset.mdCommitted && atStart(b)) { e.preventDefault(); uncommitBlock(b); caretToStart(b); return true }
  return false
}

// ─── Code Blocks ──────────────────────────────────────────────────────────────
// enterEdit / exitEdit / wireCodeClick / buildPre are REMOVED.
// Code blocks are now React components (CodeBlock.jsx) mounted by mountCodeBlocks()
// in Editor.jsx. useMarkDown.js only creates the host div when sealing a fence.

function sealFence(op, cl, editorEl, fire) {
  const lines = []; let n = op.nextElementSibling
  while (n && n !== cl) { lines.push((n.innerText || n.textContent || '').replace(/\n$/, '')); const nx = n.nextElementSibling; n.remove(); n = nx }
  cl.remove()
  const host = buildCodeHost(lines.join('\n'), (op.dataset.mdFenceLang || '').trim(), op.dataset.blockId || mkId())
  op.replaceWith(host)
  const p = mkP(); host.after(p); fire()
  // Mount the React CodeBlock component immediately — don't wait for page reload
  editorEl.__mountCode?.()
  focusAfter(() => host.nextElementSibling ?? p, false)
}

function buildCodeHost(raw, lang, id) {
  const host = document.createElement('div')
  host.className = 'editor-code-block-host'
  host.contentEditable = 'false'
  host.dataset.blockId = id
  host.dataset.rawcode = raw
  host.dataset.lang    = lang
  return host
}
// ─── Utilities ────────────────────────────────────────────────────────────────

function makeLi(block, content, numbered, editorEl, fire) {
  const tag = numbered ? 'ol' : 'ul'; let list = block.previousElementSibling
  if (!list || list.tagName.toLowerCase() !== tag || !list.classList.contains('md-list')) { list = mkEl(tag, { className: 'md-list', 'data-md': '1' }); block.before(list) }
  const li = mkEl('li', {}, content ? renderClean(content) : '<br>'); wireSpoilers(li); list.appendChild(li); block.remove(); fire(); focusAfter(() => list.lastElementChild, true)
}

function wireSpoilers(root) { root.querySelectorAll?.('.md-spoiler').forEach(() => {}) }

export function rehydrateMarkdown(el) {
  if (!el) return
  el.querySelectorAll('.md-spoiler').forEach(() => {})
  // Code block hosts are owned by React (CodeBlock.jsx) — skip entirely.
  // Legacy <pre class="md-codeblock"> from old localStorage: convert to host divs.
  el.querySelectorAll('pre.md-codeblock').forEach(pre => {
    if (pre.closest('.editor-code-block-host')) return;
    const store = pre.querySelector('.md-rawcode-store')
    const raw   = store?.textContent || pre.dataset.rawcode || ''
    const lang  = pre.dataset.lang || ''
    const id    = pre.dataset.blockId || pre.dataset.blockid || mkId()
    const host  = buildCodeHost(raw, lang, id)
    pre.replaceWith(host)
  })
  el.querySelectorAll('[data-md-committed]').forEach(b => { const s = b.dataset.mdSrc; if (s) { setHtmlAndRestore(b, renderClean(s)); wireSpoilers(b) } })
  el.querySelectorAll('[data-md-live]').forEach(b => {
    const raw = domToRaw(b)
    if (raw && hasMarkdown(raw)) { setHtmlAndRestore(b, renderClean(raw)); b.dataset.mdCommitted = '1'; b.dataset.mdSrc = raw; delete b.dataset.mdLive; wireSpoilers(b) }
    else if (raw) { b.textContent = raw; delete b.dataset.mdLive; delete b.dataset.mdSrc }
  })
  el.querySelectorAll('[data-md-src]').forEach(b => {
    if (!b.dataset.mdCommitted && !b.dataset.mdLive) { const s = b.dataset.mdSrc; if (s && hasMarkdown(s)) { setHtmlAndRestore(b, renderClean(s)); b.dataset.mdCommitted = '1'; wireSpoilers(b) } }
  })
}