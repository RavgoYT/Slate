// src/hooks/useMathField.js
//
// Inline <math-field> wrapped in a contenteditable="false" span.
//
// KEY DESIGN DECISIONS vs the old version:
//
//  1. NO zero-width-space (ZWS) sentinel nodes. ZWS caused useMarkdown's
//     caretOffset/setCaret to miscalculate offsets, producing caret jumps on
//     every keystroke near a math field. Instead we rely on the browser's
//     natural behaviour: the caret lands before/after the CE=false span.
//
//  2. NO input event dispatch from _insertMathField. Firing 'input' after
//     inserting the node triggered applyLive → domToRaw → innerHTML wipe,
//     which destroyed the just-inserted math-wrap before it had mounted.
//     useMarkdown already treats math-wrap nodes as opaque (returns \x00id\x00
//     from domToRaw and restores from mathNodesMap) — so no extra event needed.
//
//  3. The block's mdCommitted flag is cleared immediately when we insert, and
//     mdLive is set so that getRaw / applyLive work correctly on subsequent
//     keystrokes.
//
//  4. $...$ inline syntax: the tokenizer (in useMarkdown) creates a wrap node
//     and stores it in mathNodesMap with a stable id. setHtmlAndRestore then
//     replaces <span class="math-restore" data-math-id="..."> with that node.
//     This path works correctly as long as _buildMathWrap is synchronous —
//     which it is (mount event fires async but the node itself is created sync).

const MATHLIVE_CDN = 'https://cdn.jsdelivr.net/npm/mathlive';

let _loaded  = false;
let _loading = false;
let _queue   = [];

export function initMathLive() {
    if (_loaded || _loading) return;
    _loading = true;
    import(/* @vite-ignore */ MATHLIVE_CDN)
        .then(() => {
            _loaded  = true;
            _loading = false;
            try {
                if (typeof MathfieldElement !== 'undefined') {
                    MathfieldElement.plonkSound      = null;
                    MathfieldElement.keypressSound   = null;
                    MathfieldElement.soundsDirectory = null;
                }
            } catch {}
            _queue.forEach(fn => fn());
            _queue = [];
        })
        .catch(err => { _loading = false; console.warn('[MathLive] failed to load:', err); });
}

function whenLoaded(fn) {
    if (_loaded) fn(); else _queue.push(fn);
}

// ── Public API ────────────────────────────────────────────────────────────────

export function insertMathFieldAtCursor(savedRange) {
    whenLoaded(() => {
        const sel = window.getSelection();
        let range = null;

        if (sel && sel.rangeCount) {
            range = sel.getRangeAt(0).cloneRange();
        } else if (savedRange) {
            range = savedRange.cloneRange();
        } else {
            range = _currentRange();
        }

        if (!range) return;

        _insertMathField(range);
    });
}

function _insertMathField(range) {
    const wrap = _buildMathWrap();

    // FIX: Insert a non-breaking space after the math-wrap.
    // This gives the arrow keys a plain text node to safely land on when navigating right,
    // preventing Chrome from pushing the caret back to the left side of the uneditable span.
    const space = document.createTextNode('\u00A0');

    range.deleteContents();
    
    // insertNode puts nodes at the start of the range, so we insert space first, then wrap.
    // This results in [wrap, space] in the correct DOM order.
    range.insertNode(space);
    range.insertNode(wrap);

    const block = wrap.closest('[data-md-committed], [data-md-live]');
    if (block) {
        delete block.dataset.mdCommitted;
        block.dataset.mdLive = '1';
    }

    // Trigger input event so the editor knows about the change
    const editor = wrap.closest('.editor-content');
    if (editor) editor.dispatchEvent(new Event('input', { bubbles: true }));

    // Focus the math field reliably
    setTimeout(() => {
        const mf = wrap.querySelector('math-field');
        if (mf) mf.focus();
    }, 10);
}

export function attachEditorMathHandlers(editorEl) {
    if (!editorEl) return () => {};

    const onKeyDown = (e) => {
        if (_isInsideMathField(e.target)) return;

        const sel = window.getSelection();
        if (!sel?.rangeCount) return;
        const range = sel.getRangeAt(0);
        if (!range.collapsed) return;

        if (e.key === 'ArrowRight') {
            const wrap = _getAdjacentWrap(range, 'after');
            if (wrap) {
                e.preventDefault();
                const mf = wrap.querySelector('math-field');
                if (mf) { mf.focus(); try { mf.executeCommand('moveToMathfieldStart'); } catch {} }
            }
        }
        if (e.key === 'ArrowLeft') {
            const wrap = _getAdjacentWrap(range, 'before');
            if (wrap) {
                e.preventDefault();
                const mf = wrap.querySelector('math-field');
                if (mf) { mf.focus(); try { mf.executeCommand('moveToMathfieldEnd'); } catch {} }
            }
        }
        if (e.key === 'Backspace') {
            const wrap = _getAdjacentWrap(range, 'before');
            if (wrap) { e.preventDefault(); _removeWrap(wrap, editorEl); }
        }
        if (e.key === 'Delete') {
            const wrap = _getAdjacentWrap(range, 'after');
            if (wrap) { e.preventDefault(); _removeWrap(wrap, editorEl); }
        }
    };

    editorEl.addEventListener('keydown', onKeyDown);
    return () => editorEl.removeEventListener('keydown', onKeyDown);
}

function _isInsideMathField(target) {
    if (!target) return false;
    if (target.tagName === 'MATH-FIELD') return true;
    return !!target.closest?.('math-field');
}

function _removeWrap(wrap, editorEl) {
    const parent = wrap.parentElement;
    wrap.remove();
    if (parent) {
        // Clean up any leftover empty text nodes
        _cleanEmptyTextNodes(parent);
        parent.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

function _cleanEmptyTextNodes(el) {
    for (const child of [...el.childNodes]) {
        if (child.nodeType === Node.TEXT_NODE && child.textContent === '') {
            child.remove();
        }
    }
}

// ── Adjacent wrap detection ───────────────────────────────────────────────────

function _getAdjacentWrap(range, direction) {
    const container = range.startContainer;
    const offset    = range.startOffset;
    const isWrap    = (n) => n?.classList?.contains('math-wrap');

    if (direction === 'after') {
        if (container.nodeType === Node.TEXT_NODE) {
            // Only at the very end of this text node
            if (offset === container.textContent.length) {
                const sib = container.nextSibling;
                return isWrap(sib) ? sib : null;
            }
        }
        if (container.nodeType === Node.ELEMENT_NODE) {
            const child = container.childNodes[offset];
            return isWrap(child) ? child : null;
        }
    }

    if (direction === 'before') {
        if (container.nodeType === Node.TEXT_NODE) {
            // Only at the very start of this text node
            if (offset === 0) {
                const sib = container.previousSibling;
                return isWrap(sib) ? sib : null;
            }
        }
        if (container.nodeType === Node.ELEMENT_NODE && offset > 0) {
            const child = container.childNodes[offset - 1];
            return isWrap(child) ? child : null;
        }
    }
    return null;
}

function _isValidRangeNode(n) {
    return n?.closest?.('.editor-content') && !n?.closest?.('button');
}

// Global cursor tracker — updated on every selectionchange outside buttons
let _lastRange = null;
document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    if (sel?.rangeCount) {
        const r = sel.getRangeAt(0);
        let n = r.startContainer;
        if (n.nodeType === Node.TEXT_NODE) n = n.parentNode;
        if (_isValidRangeNode(n)) {
            _lastRange = r.cloneRange();
        }
    }
});

function _currentRange() {
    const sel = window.getSelection();
    if (sel?.rangeCount) {
        const r = sel.getRangeAt(0);
        let n = r.startContainer;
        if (n.nodeType === Node.TEXT_NODE) n = n.parentNode;
        if (_isValidRangeNode(n)) return r.cloneRange();
    }
    return _lastRange;
}

// ── Build & insert math-field wrap ───────────────────────────────────────────



// ── _buildMathWrap ────────────────────────────────────────────────────────────
// Synchronously constructs the CE=false span + math-field. Safe to call from
// the tokenizer (useMarkdown) and from _insertMathField alike.

function _buildMathWrap(initialLatex = '') {
    const wrap = document.createElement('span');
    wrap.className        = 'math-wrap';
    wrap.contentEditable  = 'false';
    wrap.dataset.mathwrap = '1';

    const mf = document.createElement('math-field');
    mf.setAttribute('math-virtual-keyboard-policy', 'manual');
    mf.setAttribute('smart-fence',       'true');
    mf.setAttribute('smart-superscript', 'true');
    mf.dataset.mathfield = '1';
    mf.dataset.latex     = initialLatex;

    // Keep dataset.latex in sync as the user edits
    mf.addEventListener('input', () => { mf.dataset.latex = mf.value ?? ''; });

    const NAV = new Set(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Tab']);

    mf.addEventListener('keydown', (e) => {
        if (!NAV.has(e.key)) e.stopPropagation();
        if (e.key === 'Escape') {
            e.preventDefault();
            _exitField(mf, wrap, true);
        }
    });
    mf.addEventListener('keyup',    (e) => { if (!NAV.has(e.key)) e.stopPropagation(); });
    mf.addEventListener('keypress', (e) => { if (!NAV.has(e.key)) e.stopPropagation(); });

    mf.addEventListener('move-out', (e) => {
        e.preventDefault();
        const dir = e.detail?.direction ?? e.direction;
        _exitField(mf, wrap, dir !== 'backward');
    });

    wrap.addEventListener('click', (e) => {
        e.stopPropagation();
        mf.focus();
    });

    mf.addEventListener('mount', () => {
        // Silence sounds
        try {
            MathfieldElement.plonkSound      = null;
            MathfieldElement.keypressSound   = null;
            MathfieldElement.soundsDirectory = null;
        } catch {}
        try { mf.menuItems = []; } catch {}

        // Configure shortcuts
        try {
            mf.inlineShortcuts = {
                ...(mf.inlineShortcuts ?? {}),
                '+-': '\\pm', '-+': '\\mp',
                'inf': '\\infty', 'infty': '\\infty',
                'pi': '\\pi', 'theta': '\\theta',
                'alpha': '\\alpha', 'beta': '\\beta', 'gamma': '\\gamma',
                'delta': '\\Delta', 'lambda': '\\lambda', 'sigma': '\\sigma',
                'omega': '\\omega', 'phi': '\\phi', 'psi': '\\psi',
                'mu': '\\mu', 'tau': '\\tau', 'sqrt': '\\sqrt{#?}',
                'sum': '\\sum', 'int': '\\int',
            };
        } catch {}

        // Set the initial value and focus only when inserted interactively
        // (not when restored from $...$ syntax via useMarkdown tokenizer,
        // where the node is inserted into already-rendered HTML and focusing
        // would steal the user's caret).
        if (initialLatex) {
            mf.value = initialLatex;
            try { mf.executeCommand('moveToMathfieldEnd'); } catch {}
        }

        // Only auto-focus if the wrap is connected to the document and was
        // just inserted (not being restored from serialised markdown).
        if (wrap.isConnected && !wrap.dataset.noFocus) {
            mf.focus();
        }
    }, { once: true });

    // Fallback: if mount fires late, set value anyway
    setTimeout(() => {
        if (!mf.value && initialLatex) mf.value = initialLatex;
    }, 20);

    wrap.appendChild(mf);
    return wrap;
}

function _exitField(mf, wrap, after) {
    mf.blur();
    const parent = wrap.parentNode;
    if (!parent) return;
    const editorEl = _findEditorContent(wrap);
    const siblings = [...parent.childNodes];
    const idx      = siblings.indexOf(wrap);
    const range    = document.createRange();

    if (after) {
        let next = siblings[idx + 1];
        if (!next || next.nodeType !== Node.TEXT_NODE) {
            next = document.createTextNode('\u00A0');
            parent.insertBefore(next, wrap.nextSibling);
        }
        // FIX: Place caret cleanly past the space to avoid Chrome's boundary jump bug
        if (next.textContent === '\u00A0') {
            range.setStart(next, 1);
        } else {
            range.setStart(next, 0);
        }
    } else {
        let prev = siblings[idx - 1];
        if (!prev || prev.nodeType !== Node.TEXT_NODE) {
            prev = document.createTextNode('\u00A0');
            parent.insertBefore(prev, wrap);
        }
        if (prev.textContent === '\u00A0') {
            range.setStart(prev, 0);
        } else {
            range.setStart(prev, prev.textContent.length);
        }
    }
    range.collapse(true);
    if (editorEl) editorEl.focus({ preventScroll: true });
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
}

function _findEditorContent(el) {
    let n = el?.parentElement;
    while (n) {
        if (n.classList?.contains('editor-content')) return n;
        n = n.parentElement;
    }
    return null;
}

// ── Storage helpers ───────────────────────────────────────────────────────────

export function extractMathForStorage(html) {
    if (!html.includes('math-wrap') && !html.includes('math-field') && !html.includes('\\[')) return html;
    const div = document.createElement('div');
    div.innerHTML = html;
    div.querySelectorAll('span.math-wrap, span[data-mathwrap]').forEach(wrap => {
        const mf    = wrap.querySelector('math-field');
        const latex = mf?.dataset?.latex || mf?.getAttribute('value') || '';
        wrap.replaceWith(document.createTextNode(`\\[${latex.trim()}\\]`));
    });
    div.querySelectorAll('math-field').forEach(mf => {
        const latex = mf.dataset?.latex || mf.getAttribute('data-latex') || mf.getAttribute('value') || '';
        mf.replaceWith(document.createTextNode(`\\[${latex.trim()}\\]`));
    });
    return div.innerHTML;
}

export function sanitizeStoredBlockHtml(html) {
    if (!html) return html;
    if (!html.includes('math-') && !html.includes('\\[')) return html;
    return extractMathForStorage(html);
}

window._buildMathWrap = _buildMathWrap; // Expose for useMarkdown tokenizer

// ── Rehydration (on load from localStorage) ───────────────────────────────────

export function rehydrateMathInElement(container) {
    if (!container) return;
    whenLoaded(() => _rehydrate(container));
}
window._rehydrateMathInElement = rehydrateMathInElement;

function _rehydrate(container) {
    const textNodes = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            if (!node.textContent.includes('\\[')) return NodeFilter.FILTER_REJECT;
            let p = node.parentElement;
            while (p && p !== container) {
                if (p.tagName === 'MATH-FIELD' || p.classList?.contains('math-wrap')) return NodeFilter.FILTER_REJECT;
                p = p.parentElement;
            }
            return NodeFilter.FILTER_ACCEPT;
        }
    });
    let node;
    while ((node = walker.nextNode())) textNodes.push(node);

    for (const textNode of textNodes) {
        const text = textNode.textContent;
        const re   = /\\\[([^\]]*(?:\][^\[])*?)\\\]/g;
        let match, lastIndex = 0;
        const parts = [];
        while ((match = re.exec(text)) !== null) {
            if (match.index > lastIndex) parts.push({ type: 'text', value: text.slice(lastIndex, match.index) });
            parts.push({ type: 'math', latex: match[1] });
            lastIndex = match.index + match[0].length;
        }
        if (lastIndex < text.length) parts.push({ type: 'text', value: text.slice(lastIndex) });
        if (!parts.some(p => p.type === 'math')) continue;

        const frag = document.createDocumentFragment();
        for (const part of parts) {
            if (part.type === 'text') {
                if (part.value) frag.appendChild(document.createTextNode(part.value));
            } else {
                // Mark as restored so _buildMathWrap's mount handler won't steal focus
                const w = _buildMathWrap(part.latex);
                w.dataset.noFocus = '1';
                frag.appendChild(w);
            }
        }
        textNode.parentNode?.replaceChild(frag, textNode);
    }
}