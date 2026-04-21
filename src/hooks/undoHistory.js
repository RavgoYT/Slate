// src/hooks/undoHistory.js
//
// Global undo/redo coordinator.
//
// The browser's native execCommand('undo') handles text edits inside
// contentEditable automatically. But custom actions (image resize, rotate,
// alignment) live outside that system and need their own entries.
//
// This module keeps a SINGLE unified stack. Each entry is one of:
//
//   { type: 'text' }
//       A marker that says "there is at least one native text edit here".
//       Calling undo() on this entry delegates to execCommand('undo').
//
//   { type: 'custom', undo: fn, redo: fn, label?: string }
//       A custom action with explicit callbacks.
//       pushCustom(undoFn, redoFn) records it here AND clears the redo stack.
//
// The BottomToolbar subscribes via onChange() to re-render when the stacks
// change. ImageBlock calls pushCustom() instead of its own private stack.
//
// TEXT ENTRIES
// We bridge the native execCommand stack by listening for 'input' events on
// contentEditable elements. Each input event coalesces into one 'text' marker
// (so a burst of typing becomes one undo step, matching browser behaviour).
// When the user undoes a custom entry, a 'text' marker stays in sync.

const _undoStack = [];   // Array<Entry>
const _redoStack = [];   // Array<Entry>
const _listeners = new Set();

let _textCoalesceTimer = null;
let _suppressCoalesce = false;

function _notify() {
    for (const fn of _listeners) fn();
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function _pushText() {
    // Only push a text marker if the top of the undo stack isn't already one
    if (_suppressCoalesce) return;
    if (_undoStack.length && _undoStack[_undoStack.length - 1].type === 'text') return;
    _undoStack.push({ type: 'text' });
    // A new text edit invalidates the redo stack
    _redoStack.length = 0;
    _notify();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Subscribe to stack changes (for toolbar enabled-state updates).
 * Returns an unsubscribe function.
 */
export function subscribe(fn) {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
}

/** Current state — used to compute button enabled states. */
export function state() {
    return {
        canUndo: _undoStack.length > 0,
        canRedo: _redoStack.length > 0,
    };
}

/** Call after pushCustom to cancel any pending text-coalesce timer. */
export function cancelPendingCoalesce() {
    clearTimeout(_textCoalesceTimer);
    _textCoalesceTimer = null;
    _suppressCoalesce = true;
    setTimeout(() => { _suppressCoalesce = false; }, 0);
}

/**
 * Record a custom undoable action.
 * Call this BEFORE applying the change so that `undoFn` can restore the prior
 * state and `redoFn` can re-apply it.
 *
 * @param {() => void} undoFn  - Restores state before this action.
 * @param {() => void} redoFn  - Re-applies this action.
 * @param {string}    [label]  - Optional description for debugging.
 */
export function pushCustom(undoFn, redoFn, label = '', undoCaret = null, redoCaret = null) {
    _undoStack.push({ type: 'custom', undo: undoFn, redo: redoFn, label, undoCaret, redoCaret });
    _redoStack.length = 0;
    _notify();
}

// ── Caret save/restore helpers ───────────────────────────────────────────────
// Saves the caret as { blockId, offset } so it can be restored after an
// innerHTML swap. Uses character offset (not DOM node) so it survives re-render.

export function saveCaretPosition(container) {
    const sel = window.getSelection();
    if (!sel?.rangeCount) return null;
    const range = sel.getRangeAt(0);
    // Walk up to find the block element (direct child of container)
    let node = range.startContainer;
    while (node && node.parentElement !== container) node = node.parentElement;
    if (!node) return null;
    const blockId = node.dataset?.blockId;
    if (!blockId) return null;
    // Count character offset within that block
    let offset = 0;
    const countChars = (n, target, targetOffset) => {
        if (n === target) { offset += targetOffset; return true; }
        if (n.nodeType === 3) { offset += n.textContent.length; return false; }
        for (const child of n.childNodes) { if (countChars(child, target, targetOffset)) return true; }
        return false;
    };
    countChars(node, range.startContainer, range.startOffset);
    return { blockId, offset };
}

export function restoreCaretPosition(container, saved) {
    if (!saved) return;
    const block = container.querySelector(`[data-block-id="${saved.blockId}"]`);
    if (!block) return;
    let remain = saved.offset;
    const walk = (node) => {
        if (node.nodeType === 3) {
            if (remain <= node.textContent.length) {
                try {
                    const r = document.createRange();
                    r.setStart(node, remain); r.collapse(true);
                    const sel = window.getSelection();
                    sel.removeAllRanges(); sel.addRange(r);
                } catch (_) {}
                return true;
            }
            remain -= node.textContent.length; return false;
        }
        if (node.nodeType === 1 && node.tagName === 'BR') return false;
        for (const child of node.childNodes) { if (walk(child)) return true; }
        return false;
    };
    if (!walk(block)) {
        // fallback: end of block
        const r = document.createRange();
        r.selectNodeContents(block); r.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges(); sel.addRange(r);
    }
}

/**
 * Perform an undo. Delegates to execCommand for text entries, calls the stored
 * callback for custom entries.
 */
export function undo() {
    const entry = _undoStack.pop();
    if (!entry) return;
    _suppressCoalesce = true;
    if (entry.type === 'text') {
        _redoStack.push({ type: 'text' });
        _focusEditor();
        document.execCommand('undo');
    } else {
        _redoStack.push({ type: 'custom', undo: entry.undo, redo: entry.redo, label: entry.label });
        entry.undo();
        if (entry.undoCaret) restoreCaretPosition(entry.undoCaret.container, entry.undoCaret.saved);
    }
    _notify();
    clearTimeout(_textCoalesceTimer);
    _textCoalesceTimer = null;
    setTimeout(() => { _suppressCoalesce = false; }, 0);
}

/**
 * Perform a redo.
 */
export function redo() {
    const entry = _redoStack.pop();
    if (!entry) return;
    _suppressCoalesce = true;
    if (entry.type === 'text') {
        _undoStack.push({ type: 'text' });
        _focusEditor();
        document.execCommand('redo');
    } else {
        _undoStack.push({ type: 'custom', undo: entry.undo, redo: entry.redo, label: entry.label });
        entry.redo();
        if (entry.redoCaret) restoreCaretPosition(entry.redoCaret.container, entry.redoCaret.saved);
    }
    _notify();
    clearTimeout(_textCoalesceTimer);
    _textCoalesceTimer = null;
    setTimeout(() => { _suppressCoalesce = false; }, 0);
}

// ── Auto-capture text edits ───────────────────────────────────────────────────
// Push a text marker on each burst of input so the undo stack reflects that
// there is something to undo in the browser's native history.

function _onInput(e) {
    const el = e.target;
    if (el?.contentEditable !== 'true') return;
    clearTimeout(_textCoalesceTimer);
    _textCoalesceTimer = setTimeout(_pushText, 300);
}

// ── Global keyboard handler ───────────────────────────────────────────────────
// Attached once. Handles three cases:
//
// Ctrl+Z while focused in a contentEditable (text undo):
//   Let the browser perform the native undo, then sync our stacks and notify.
//   We flush any pending coalesce timer first so the text marker is present.
//
// Ctrl+Z outside a contentEditable (or with a custom entry on top):
//   Handle entirely via our stack — preventDefault, call undo().
//
// Ctrl+Y / Ctrl+Shift+Z (redo):
//   Mirror of the above.

function _isInEditor() {
    return document.activeElement?.contentEditable === 'true';
}

function _focusEditor() {
    if (_isInEditor()) return;
    const ed = document.querySelector('[contenteditable="true"]');
    ed?.focus();
}

if (typeof document !== 'undefined') {
    document.addEventListener('input', _onInput, true);

document.addEventListener('keydown', (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;

        const isUndo = e.key === 'z' && !e.shiftKey;
        const isRedo = e.key === 'y' || (e.key === 'z' && e.shiftKey);
        if (!isUndo && !isRedo) return;

        if (isUndo) {
            if (_undoStack.length === 0) return;
            e.preventDefault(); e.stopPropagation();
            clearTimeout(_textCoalesceTimer);
            _textCoalesceTimer = null;
            undo();
        } else {
            if (_redoStack.length === 0) return;
            e.preventDefault(); e.stopPropagation();
            redo();
        }
    }, true);
}