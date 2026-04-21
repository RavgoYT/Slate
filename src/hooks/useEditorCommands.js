// src/hooks/useEditorCommands.js
import { useCallback, useEffect, useRef } from 'react';
import { emojiImgHtml, addRecentEmoji } from './useEmoji';
import { insertMathFieldAtCursor } from './useMathField';
import * as undoHistory from './undoHistory';

// ── Selection state reader ────────────────────────────────────────────────────
export function readSelectionState() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const node = sel.anchorNode;
    const el   = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    if (!el) return null;
    let editable = el;
    while (editable && editable.contentEditable !== 'true') editable = editable.parentElement;
    if (!editable) return null;
    const computed = window.getComputedStyle(el);
    let blockEl = el;
    while (blockEl && blockEl !== editable) {
        const tag = blockEl.tagName?.toLowerCase();
        if (['p','h1','h2','h3','h4','h5','h6','li'].includes(tag)) break;
        blockEl = blockEl.parentElement;
    }
    const blockTag = blockEl?.tagName?.toLowerCase() || 'p';
    let styleTag = blockTag === 'li' ? 'p' : blockTag;
    if (blockTag === 'h1' && parseFloat(blockEl?.style?.fontSize) >= 24) styleTag = 'h0';

    const _readFont = (startEl) => {
        let fontEl = startEl, ff = '';
        while (fontEl && fontEl !== editable && !ff) {
            if (fontEl.tagName === 'MATH-FIELD') break;
            if (fontEl.style?.fontFamily) {
                const f = fontEl.style.fontFamily;
                if (!f.toLowerCase().includes('katex') && !f.toLowerCase().includes('math')) ff = f;
            }
            fontEl = fontEl.parentElement;
        }
        if (!ff) ff = window.getComputedStyle(startEl).fontFamily;
        if (ff.toLowerCase().includes('katex') || ff.toLowerCase().includes('math')) ff = '';
        return ff.replace(/['"]/g, '').split(',')[0].trim();
    };

    const anchorFont = _readFont(el);
    let fontFamily = anchorFont;
    if (!sel.isCollapsed) {
        const focusNode = sel.focusNode;
        const focusEl = focusNode?.nodeType === Node.ELEMENT_NODE ? focusNode : focusNode?.parentElement;
        if (focusEl && focusEl !== el) {
            const focusFont = _readFont(focusEl);
            if (focusFont && focusFont !== anchorFont) fontFamily = null;
        }
    }

    const anchorSize = Math.round(parseFloat(computed.fontSize) || 14);
    let fontSize = anchorSize;
    if (!sel.isCollapsed) {
        const focusNode = sel.focusNode;
        const focusEl = focusNode?.nodeType === Node.ELEMENT_NODE ? focusNode : focusNode?.parentElement;
        if (focusEl && focusEl !== el) {
            const focusSize = Math.round(parseFloat(window.getComputedStyle(focusEl).fontSize) || 14);
            if (focusSize !== anchorSize) fontSize = null;
        }
    }

    const bold      = document.queryCommandState('bold');
    const italic    = document.queryCommandState('italic');
    const underline = document.queryCommandState('underline');
    const strike    = document.queryCommandState('strikeThrough');
    const isLink    = !!_getAncestorTag(node, 'A');
    const alignMap  = { justifyLeft:'left', justifyCenter:'center', justifyRight:'right', justifyFull:'justify' };
    let align = 'left';
    for (const [cmd, val] of Object.entries(alignMap))
        if (document.queryCommandState(cmd)) { align = val; break; }
    let listType = null, listTag = null;
    let listEl = sel.anchorNode;
    while (listEl) {
        if (listEl.nodeName === 'UL' || listEl.nodeName === 'OL') {
            listTag  = listEl.nodeName;
            listType = listEl.classList.contains('list-style-arrow') ? 'arrow'
                     : listEl.style.listStyleType || (listTag === 'UL' ? 'disc' : 'decimal');
            break;
        }
        listEl = listEl.parentNode;
    }
    return { styleTag, fontFamily, fontSize, bold, italic, underline, strike, align, listTag, listType, isLink };
}

// ── Auto-linkify ──────────────────────────────────────────────────────────────
export function tryAutoLinkify(e) {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    const sel = window.getSelection();
    if (!sel?.rangeCount) return;
    const range = sel.getRangeAt(0);
    const container = range.startContainer;
    if (container.nodeType !== Node.TEXT_NODE) return;
    const text = container.textContent, offset = range.startOffset;
    const before = text.slice(0, offset);
    const urlMatch = before.match(/((?:https?:\/\/|www\.)[^\s]+)$/);
    if (!urlMatch || _getAncestorTag(container, 'A')) return;
    e.preventDefault();
    const rawUrl = urlMatch[1], href = rawUrl.startsWith('www.') ? 'https://' + rawUrl : rawUrl;
    const urlStart = offset - rawUrl.length;
    const a = document.createElement('a');
    a.href = href; a.textContent = rawUrl; a.target = '_blank'; a.rel = 'noopener noreferrer';
    const beforeNode = document.createTextNode(text.slice(0, urlStart));
    const afterNode  = document.createTextNode((e.key === ' ' ? '\u00A0' : '\n') + text.slice(offset));
    const parent = container.parentNode;
    parent.replaceChild(afterNode, container);
    parent.insertBefore(a, afterNode);
    parent.insertBefore(beforeNode, a);
    const nr = document.createRange();
    nr.setStart(afterNode, 1); nr.collapse(true);
    sel.removeAllRanges(); sel.addRange(nr);
}

// ── Inline color chip ─────────────────────────────────────────────────────────
export function tryColorChip(e) {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    const sel = window.getSelection();
    if (!sel?.rangeCount) return;
    const range = sel.getRangeAt(0);
    const container = range.startContainer;
    if (container.nodeType !== Node.TEXT_NODE) return;
    const text = container.textContent, offset = range.startOffset;
    const before = text.slice(0, offset);
    const colorMatch =
        before.match(/(rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*[\d.]+\s*)?\))$/) ||
        before.match(/(#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?)$/);
    if (!colorMatch) return;
    e.preventDefault();
    const colorStr = colorMatch[1], colorStart = offset - colorStr.length;
    const chip = document.createElement('span');
    chip.className = 'editor-color-chip'; chip.contentEditable = 'false'; chip.dataset.color = colorStr;
    const swatch = document.createElement('span');
    swatch.className = 'editor-color-chip__swatch'; swatch.style.background = colorStr;
    const label = document.createElement('span');
    label.className = 'editor-color-chip__label'; label.textContent = colorStr;
    chip.appendChild(swatch); chip.appendChild(label);
    const beforeNode = document.createTextNode(text.slice(0, colorStart));
    const afterNode  = document.createTextNode((e.key === ' ' ? '\u00A0' : '\n') + text.slice(offset));
    const parent = container.parentNode;
    parent.replaceChild(afterNode, container);
    parent.insertBefore(chip, afterNode); parent.insertBefore(beforeNode, chip);
    const nr = document.createRange();
    nr.setStart(afterNode, 1); nr.collapse(true);
    sel.removeAllRanges(); sel.addRange(nr);
}

// ── Link click handler ────────────────────────────────────────────────────────
export function handleEditorClick(e) {
    const link = e.target.closest('a[href]');
    if (!link) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    e.preventDefault();
    window.open(link.href, '_blank', 'noopener,noreferrer');
}

// ── Link tooltip ──────────────────────────────────────────────────────────────
let _tooltip = null, _tooltipHideTimer = null;
export function initLinkTooltip(editorRoot) {
    if (!editorRoot) return;
    const show = (link) => {
        clearTimeout(_tooltipHideTimer);
        if (!_tooltip) { _tooltip = document.createElement('div'); _tooltip.className = 'editor-link-tooltip'; document.body.appendChild(_tooltip); }
        _tooltip.textContent = link.href;
        _tooltip.classList.remove('visible');
        const rect = link.getBoundingClientRect();
        _tooltip.style.left = `${rect.left + rect.width / 2}px`;
        _tooltip.style.top  = `${rect.top - 8}px`;
        requestAnimationFrame(() => _tooltip?.classList.add('visible'));
    };
    const hide = () => { _tooltipHideTimer = setTimeout(() => _tooltip?.classList.remove('visible'), 120); };
    const onOver = (e) => { const l = e.target.closest('a[href]'); if (l) show(l); };
    const onOut  = (e) => { const l = e.target.closest('a[href]'); if (l) hide(); };
    editorRoot.addEventListener('mouseover', onOver);
    editorRoot.addEventListener('mouseout',  onOut);
    return () => {
        editorRoot.removeEventListener('mouseover', onOver);
        editorRoot.removeEventListener('mouseout',  onOut);
        _tooltip?.remove(); _tooltip = null;
    };
}

// ── Main hook ─────────────────────────────────────────────────────────────────
export function useEditorCommands() {
    const savedRange = useRef(null);

    // Track selection continuously so we always have it when a toolbar button is clicked.
    // We can't rely on onBlur (fires too late) or onMouseDown (bubble phase, too late).
    // selectionchange fires whenever the selection changes inside the document.
    useEffect(() => {
        const onSelChange = () => {
            const sel = window.getSelection();
            if (!sel || !sel.rangeCount) return;
            // Only save if the selection is inside an editor contenteditable
            const node = sel.anchorNode;
            let el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
            while (el) {
                if (el.contentEditable === 'true') {
                    savedRange.current = sel.getRangeAt(0).cloneRange();
                    return;
                }
                el = el.parentElement;
            }
        };
        document.addEventListener('selectionchange', onSelChange);
        return () => document.removeEventListener('selectionchange', onSelChange);
    }, []);

    const saveSelection = useCallback(() => {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
            savedRange.current = sel.getRangeAt(0).cloneRange();
        }
    }, []);

    const restoreSelection = useCallback(() => {
        const range = savedRange.current;
        if (!range) return false;
        try {
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            return true;
        } catch { return false; }
    }, []);

    const withSelection = useCallback((fn) => {
        const range = savedRange.current;
        if (range) {
            // Find the owning contenteditable and focus it — execCommand requires
            // document.activeElement to be a contenteditable, and some browsers move
            // focus even when e.preventDefault() was called on the toolbar button.
            const editable = _getEditableFromRange(range);
            if (editable) editable.focus({ preventScroll: true });
            // Restore the exact selection the user had before clicking the toolbar
            try {
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
            } catch {}
        }
        fn();
    }, []);

    const handleCommand = useCallback(({ type, value }) => {
        withSelection(() => {
            switch (type) {
                case 'style': {
                    const tagMap   = { p:'p', h0:'h1', sub:'p', h1:'h1', h2:'h2', h3:'h3' };
                    const styleMap = {
                        h0:  { fontSize:'26px', fontWeight:'700', color:'' },
                        sub: { fontSize:'17px', fontWeight:'',    color:'var(--text-color-secondary)' },
                        h1:  { fontSize:'22px', fontWeight:'700', color:'' },
                        h2:  { fontSize:'18px', fontWeight:'600', color:'' },
                        h3:  { fontSize:'15px', fontWeight:'600', color:'' },
                        p:   { fontSize:'',     fontWeight:'',    color:'' },
                    };
                    document.execCommand('formatBlock', false, tagMap[value] || 'p');
                    const s = styleMap[value], el = _anchorBlock();
                    if (s && el) { el.style.fontSize = s.fontSize; el.style.fontWeight = s.fontWeight; el.style.color = s.color; }
                    break;
                }
case 'font': {
                    const sel = window.getSelection();
                    if (!sel || sel.isCollapsed) break;
                    const range = sel.getRangeAt(0);
                    const editable = _getEditableFromRange(range);
                    if (!editable) break;

                    { const _before = editable.innerHTML;
                      setTimeout(() => { const _after = editable.innerHTML; undoHistory.pushCustom(() => { editable.innerHTML = _before; }, () => { editable.innerHTML = _after; }); }, 0); }

                    // Snapshot start/end before DOM mutations invalidate them
                    const startContainer = range.startContainer;
                    const startOffset    = range.startOffset;
                    const endContainer   = range.endContainer;
                    const endOffset      = range.endOffset;

                    const textNodes = _collectTextNodesInRange(range, editable);
                    for (const { node, startOffset: so, endOffset: eo } of textNodes) {
                        let target = node;
                        if (eo < node.textContent.length) target.splitText(eo);
                        const effectiveStart = (target === node) ? so : 0;
                        if (effectiveStart > 0) { target.splitText(effectiveStart); target = target.nextSibling; }
                        if (!target || !target.textContent) continue;
                        const parent = target.parentElement;
                        if (parent && parent !== editable && parent.tagName === 'SPAN' && !parent.style.fontSize && !parent.style.color && !parent.style.fontWeight) {
                            parent.style.fontFamily = value;
                        } else {
                            const span = document.createElement('span');
                            span.style.fontFamily = value;
                            target.parentNode.insertBefore(span, target);
                            span.appendChild(target);
                        }
                    }
                    _applyFontToBlocksInRange(range, editable, value);
                    editable.normalize();

                    // Re-select using snapshotted containers (normalize may have merged nodes)
                    try {
                        const nr = document.createRange();
                        nr.setStart(startContainer, Math.min(startOffset, startContainer.textContent?.length ?? 0));
                        nr.setEnd(endContainer,     Math.min(endOffset,   endContainer.textContent?.length   ?? 0));
                        sel.removeAllRanges(); sel.addRange(nr);
                        savedRange.current = nr.cloneRange();
                    } catch { /* containers may be gone after normalize — leave selection as-is */ }
                    break;
                }
case 'fontSize': {
                    const sel = window.getSelection();
                    if (!sel || sel.isCollapsed) break;
                    const range = sel.getRangeAt(0);
                    const editable = _getEditableFromRange(range);
                    if (!editable) break;

                    { const _before = editable.innerHTML;
                      setTimeout(() => { const _after = editable.innerHTML; undoHistory.pushCustom(() => { editable.innerHTML = _before; }, () => { editable.innerHTML = _after; }); }, 0); }

                    const startContainer = range.startContainer;
                    const startOffset    = range.startOffset;
                    const endContainer   = range.endContainer;
                    const endOffset      = range.endOffset;

                    const textNodes = _collectTextNodesInRange(range, editable);
                    for (const { node, startOffset: so, endOffset: eo } of textNodes) {
                        let target = node;
                        if (eo < node.textContent.length) target.splitText(eo);
                        const effectiveStart = (target === node) ? so : 0;
                        if (effectiveStart > 0) { target.splitText(effectiveStart); target = target.nextSibling; }
                        if (!target || !target.textContent) continue;
                        const parent = target.parentElement;
                        if (parent && parent !== editable && parent.tagName === 'SPAN' && !parent.style.fontFamily && !parent.style.color && !parent.style.fontWeight) {
                            parent.style.fontSize = `${value}px`;
                        } else {
                            const span = document.createElement('span');
                            span.style.fontSize = `${value}px`;
                            target.parentNode.insertBefore(span, target);
                            span.appendChild(target);
                        }
                    }
                    const blocks = editable.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li');
                    for (const block of blocks) {
                        if (range.intersectsNode(block)) block.style.fontSize = `${value}px`;
                    }
                    editable.normalize();

                    try {
                        const nr = document.createRange();
                        nr.setStart(startContainer, Math.min(startOffset, startContainer.textContent?.length ?? 0));
                        nr.setEnd(endContainer,     Math.min(endOffset,   endContainer.textContent?.length   ?? 0));
                        sel.removeAllRanges(); sel.addRange(nr);
                        savedRange.current = nr.cloneRange();
                    } catch {}
                    break;
                }
                case 'bold':          document.execCommand('bold');          break;
                case 'italic':        document.execCommand('italic');        break;
                case 'underline':     document.execCommand('underline');     break;
                case 'strikethrough': document.execCommand('strikeThrough'); break;
                case 'fontColor':     document.execCommand('foreColor', false, value); break;
                case 'highlight':
                    if (value === '__clear__') _clearHighlight(window.getSelection()?.rangeCount ? window.getSelection().getRangeAt(0) : savedRange.current);
                    else document.execCommand('hiliteColor', false, value);
                    break;
case 'bulletList':
                case 'numberedList': {
                    const isUL = type === 'bulletList';
                    const { style, currentTag, currentStyle } = value;
                    const sel = window.getSelection();
                    const liveRange = sel?.rangeCount ? sel.getRangeAt(0) : savedRange.current;
                    const editable = _getEditableFromRange(liveRange);
                    if (!editable) break;
                    const _listBefore = editable.innerHTML;
                    const myTag = isUL ? 'UL' : 'OL', oppTag = isUL ? 'OL' : 'UL';
                    if (currentTag === myTag && currentStyle === style) _unwrapList(myTag);
                    else if (currentTag === myTag) { const list = _findListFromSel(myTag); if (list) _applyListStyle(style, list); }
                    else { if (currentTag === oppTag) { _unwrapList(oppTag); } _insertList(editable, myTag, style); }
                    const _listAfter = editable.innerHTML;
                    undoHistory.pushCustom(() => { editable.innerHTML = _listBefore; }, () => { editable.innerHTML = _listAfter; });
                    break;
                }
                case 'align': {
                    const map = { left:'justifyLeft', center:'justifyCenter', right:'justifyRight', justify:'justifyFull' };
                    document.execCommand(map[value] || 'justifyLeft');
                    break;
                }
                case 'link': {
                    const sel = window.getSelection();
                    const range = (sel?.rangeCount ? sel.getRangeAt(0) : null) || savedRange.current;
                    if (!range) break;
                    const anchorEl = _getAncestorTag(range.commonAncestorContainer, 'A');
                    if (anchorEl) { document.execCommand('unlink'); break; }
                    const savedRangeClone = range.cloneRange(), selectedText = range.toString();
                    _showLinkPrompt((url) => {
                        if (!url) return;
                        try { const s = window.getSelection(); s.removeAllRanges(); s.addRange(savedRangeClone); } catch {}
                        if (selectedText) {
                            document.execCommand('createLink', false, url);
                            document.querySelectorAll('.editor-content a').forEach(a => { a.target='_blank'; a.rel='noopener noreferrer'; });
                        } else {
                            const a = document.createElement('a');
                            a.href=url; a.textContent=url; a.target='_blank'; a.rel='noopener noreferrer';
                            try { savedRangeClone.deleteContents(); savedRangeClone.insertNode(a); } catch {}
                        }
                    });
                    break;
                }
                case 'table': {
                    const { rows, cols } = value;
                    if (!rows || !cols) break;
                    const table = _createTable(rows, cols);
                    const wrapper = document.createElement('div');
                    wrapper.className = 'editor-table-wrapper';
                    _buildTableControls(wrapper, table);
                    wrapper.insertBefore(table, wrapper.firstChild);
                    _initTableUndo(table);
                    const sel = window.getSelection();
                    const liveRange = sel?.rangeCount ? sel.getRangeAt(0) : savedRange.current;
                    const editable = _getEditableFromRange(liveRange) || document.querySelector('.editor-content');
                    if (editable) {
                        editable.appendChild(wrapper);
                        const after = document.createElement('p'); after.innerHTML = '<br>';
                        editable.appendChild(after);
                        const firstCell = table.querySelector('th, td');
                        if (firstCell) { _focusCell(firstCell); }
                    }
                    break;
                }
case 'emoji': {
                    const emoji = value;
                    if (!emoji) break;
                    
                    // 1. Ensure the editor has focus so execCommand targets it
                    const sel = window.getSelection();
                    const emojiRange = sel?.rangeCount ? sel.getRangeAt(0) : savedRange.current;
                    const editable = _getEditableFromRange(emojiRange) || document.querySelector('.editor-content');
                    if (editable) editable.focus();
                    
                    // 2. Tell Markdown to skip rewriting the DOM to preserve native undo
                    window.__skipMarkdownSync = true;
                    
                    // 3. Let the browser natively insert the image
                    document.execCommand('insertHTML', false, emojiImgHtml(emoji));
                    
                    // 4. Update recents and isolate the undo step
                    addRecentEmoji(emoji.id);
                    setTimeout(() => undoHistory.cancelPendingCoalesce(), 0);
                    
                    break;
                }
                case 'math': {
                    const sel = window.getSelection();
                    const mathRange = sel?.rangeCount ? sel.getRangeAt(0) : savedRange.current;
                    insertMathFieldAtCursor(mathRange);
                    break;
                }
                case 'image': {
                    // value is a File object — delegate to the registered handler if present
                    if (typeof window.__editorInsertImage === 'function') {
                        window.__editorInsertImage(value);
                    }
                    break;
                }
                default: console.warn('[useEditorCommands] Unknown command:', type);
            }
        });
    }, [withSelection]);

    return { handleCommand, saveSelection };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function _anchorBlock() {
    const sel = window.getSelection();
    if (!sel?.anchorNode) return null;
    let el = sel.anchorNode;
    while (el && el.nodeType !== Node.ELEMENT_NODE) el = el.parentNode;
    return el;
}
function _getAncestorTag(node, tag) {
    let el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    while (el) { if (el.tagName === tag) return el; el = el.parentElement; }
    return null;
}
function _getEditableFromRange(range) {
    if (!range) return null;
    let el = range.commonAncestorContainer;
    if (el.nodeType !== Node.ELEMENT_NODE) el = el.parentElement;
    while (el) { if (el.contentEditable === 'true') return el; el = el.parentElement; }
    return null;
}
function _findListFromSel(tag) {
    const sel = window.getSelection();
    if (!sel?.anchorNode) return null;
    let el = sel.anchorNode;
    while (el) { if (el.nodeName === tag) return el; el = el.parentNode; }
    return null;
}
function _applyListStyle(styleValue, listEl) {
    if (!listEl) return;
    if (styleValue === 'arrow') { listEl.style.listStyle='none'; listEl.style.paddingLeft='1.5em'; listEl.classList.add('list-style-arrow'); }
    else { listEl.style.listStyleType=styleValue; listEl.style.paddingLeft=''; listEl.classList.remove('list-style-arrow'); }
}
function _insertList(editable, tag, style) {
    const sel = window.getSelection();
    if (!sel?.rangeCount) return;
    const range = sel.getRangeAt(0);
    let blocks = [...editable.children].filter(c => ['P','H1','H2','H3','H4','H5','H6'].includes(c.tagName) && range.intersectsNode(c));
    if (!blocks.length) {
        let node = range.startContainer;
        while (node && node.parentNode !== editable) node = node.parentNode;
        if (node && ['P','H1','H2','H3','H4','H5','H6'].includes(node.tagName)) blocks = [node];
    }
    if (!blocks.length) return;
    const list = document.createElement(tag);
    _applyListStyle(style, list);
    blocks[0].before(list);
    for (const block of blocks) {
        const li = document.createElement('li'); li.innerHTML = block.innerHTML || '<br>';
        list.appendChild(li); block.remove();
    }
    const firstLi = list.querySelector('li');
    if (firstLi) { const nr = document.createRange(); nr.setStart(firstLi,0); nr.collapse(true); sel.removeAllRanges(); sel.addRange(nr); }
}
function _unwrapList(tag) {
    const list = _findListFromSel(tag);
    if (!list) return;
    const frag = document.createDocumentFragment();
    for (const li of [...list.querySelectorAll('li')]) {
        const p = document.createElement('p'); p.innerHTML = li.innerHTML || '<br>'; frag.appendChild(p);
    }
    list.replaceWith(frag);
}
function _collectTextNodesInRange(range, root) {
    const result = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
        if (!range.intersectsNode(node)) continue;
        result.push({
            node,
            startOffset: node === range.startContainer ? range.startOffset : 0,
            endOffset:   node === range.endContainer   ? range.endOffset   : node.textContent.length,
        });
    }
    return result;
}
function _applyFontToBlocksInRange(range, editable, fontFamily) {
    const blocks = editable.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li');
    for (const block of blocks) {
        if (!range.intersectsNode(block)) continue;
        block.style.fontFamily = fontFamily;
        for (const child of [...block.childNodes]) {
            if (child.nodeName === 'BR') {
                const span = document.createElement('span');
                span.style.fontFamily = fontFamily;
                block.insertBefore(span, child);
                span.appendChild(child);
                break;
            }
        }
    }
}
function _clearHighlight(range) {
    if (!range) return;
    try {
        const editable = _getEditableFromRange(range);
        if (!editable) return;
        editable.querySelectorAll('[style]').forEach(el => {
            if (range.intersectsNode(el)) {
                el.style.backgroundColor = ''; el.style.background = '';
                if (!el.getAttribute('style')?.trim()) el.removeAttribute('style');
            }
        });
    } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Table helpers (unchanged from original)
// ─────────────────────────────────────────────────────────────────────────────

function _createTable(rows, cols) {
    const table = document.createElement('table');
    table.className = 'editor-inserted-table'; table.style.width = '100%';
    for (let r = 0; r < rows; r++) {
        const tr = document.createElement('tr');
        for (let c = 0; c < cols; c++) {
            const cell = document.createElement(r === 0 ? 'th' : 'td');
            cell.contentEditable = 'true'; cell.innerHTML = '<br>'; tr.appendChild(cell);
        }
        table.appendChild(tr);
    }
    return table;
}
function _initTableUndo(table) { table._history = []; table._future = []; }
function _snapshotTable(table) {
    return [...table.querySelectorAll('tr')].map(tr =>
        [...tr.children].map(cell => ({
            tag: cell.tagName,
            html: cell.innerHTML.replace(/<div class="(col|row)-resize-handle"[^>]*><\/div>/g, ''),
            style: cell.getAttribute('style') || '',
            rowStyle: tr.getAttribute('style') || '',
        }))
    );
}
function _restoreTableSnapshot(table, snapshot) {
    [...table.querySelectorAll('tr')].forEach(tr => tr.remove());
    for (const rowData of snapshot) {
        if (!rowData.length) continue;
        const tr = document.createElement('tr');
        if (rowData[0].rowStyle) tr.setAttribute('style', rowData[0].rowStyle);
        for (const d of rowData) {
            const cell = document.createElement(d.tag);
            cell.contentEditable = 'true'; cell.innerHTML = d.html;
            if (d.style) cell.setAttribute('style', d.style);
            tr.appendChild(cell);
        }
        table.appendChild(tr);
    }
    _buildResizeHandles(table);
}
function _pushTableHistory(table) {
    if (!table._history) _initTableUndo(table);
    table._history.push(_snapshotTable(table)); table._future = [];
    if (table._history.length > 50) table._history.shift();
}
let _tableUndoListenerAttached = false;
function _ensureTableUndoListener() {
    if (_tableUndoListenerAttached) return;
    _tableUndoListenerAttached = true;
    document.addEventListener('keydown', (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        const isUndo = e.key === 'z' && !e.shiftKey;
        const isRedo = e.key === 'y' || (e.key === 'z' && e.shiftKey);
        if (!isUndo && !isRedo) return;
        const sel = window.getSelection();
        if (!sel?.anchorNode) return;
        let node = sel.anchorNode, table = null;
        while (node) { if (node.nodeName === 'TABLE' && node.classList?.contains('editor-inserted-table')) { table = node; break; } node = node.parentNode; }
        if (!table) return;
        e.preventDefault(); e.stopPropagation();
        if (isUndo && table._history?.length) { table._future.push(_snapshotTable(table)); _restoreTableSnapshot(table, table._history.pop()); }
        else if (isRedo && table._future?.length) { table._history.push(_snapshotTable(table)); _restoreTableSnapshot(table, table._future.pop()); }
        const wrapper = table.closest('.editor-table-wrapper');
        if (wrapper) _positionControls(wrapper, table);
    }, true);
}

let _editorTabListenerAttached = false;
export function initEditorTabHandler() {
    if (_editorTabListenerAttached) return;
    _editorTabListenerAttached = true;
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') return;
        const sel = window.getSelection();
        if (!sel?.anchorNode) return;
        let activeCell = null, activeTable = null;
        let node = sel.anchorNode.nodeType === Node.ELEMENT_NODE
            ? sel.anchorNode : sel.anchorNode.parentElement;
        while (node) {
            if (node.nodeName === 'TH' || node.nodeName === 'TD') {
                const tbl = node.closest('table.editor-inserted-table');
                if (tbl) { activeCell = node; activeTable = tbl; break; }
            }
            node = node.parentElement;
        }
        if (activeCell && activeTable) {
            e.preventDefault(); e.stopPropagation();
            const allCells = [...activeTable.querySelectorAll('th, td')];
            const idx = allCells.indexOf(activeCell);
            if (idx === -1) return;
            if (!e.shiftKey && idx < allCells.length - 1) _focusCell(allCells[idx + 1]);
            else if (e.shiftKey && idx > 0)              _focusCell(allCells[idx - 1]);
            return;
        }
        let editorEl = sel.anchorNode.nodeType === Node.ELEMENT_NODE
            ? sel.anchorNode : sel.anchorNode.parentElement;
        while (editorEl) {
            if (editorEl.classList?.contains('editor-content')) break;
            editorEl = editorEl.parentElement;
        }
        if (!editorEl) return;
        e.preventDefault(); e.stopPropagation();
        if (!e.shiftKey) document.execCommand('insertHTML', false, '&nbsp;&nbsp;&nbsp;&nbsp;');
    }, true);
}

function _focusCell(cell) {
    if (!cell) return;
    cell.focus();
    Promise.resolve().then(() => {
        if (!cell.isConnected) return;
        const range = document.createRange();
        range.setStart(cell, 0); range.collapse(true);
        const sel = window.getSelection();
        if (sel) { sel.removeAllRanges(); sel.addRange(range); }
    });
}

function _buildTableControls(wrapper, table) {
    _ensureTableUndoListener();
    const colCtrl = document.createElement('div');
    colCtrl.className = 'table-ctrl table-ctrl--col';
    const addColBtn = document.createElement('button');
    addColBtn.className = 'table-ctrl-half table-ctrl-half--top'; addColBtn.title = 'Add column'; addColBtn.textContent = '+';
    addColBtn.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation(); _pushTableHistory(table);
        table.querySelectorAll('tr').forEach((tr, i) => {
            const cell = document.createElement(i===0?'th':'td'); cell.contentEditable='true'; cell.innerHTML='<br>'; tr.appendChild(cell);
        });
        _buildResizeHandles(table); _positionControls(wrapper, table);
    });
    const rmColBtn = document.createElement('button');
    rmColBtn.className = 'table-ctrl-half table-ctrl-half--bottom'; rmColBtn.title = 'Remove last column'; rmColBtn.textContent = '−';
    rmColBtn.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation();
        if ((table.querySelector('tr')?.children.length||0) <= 1) return;
        _pushTableHistory(table);
        table.querySelectorAll('tr').forEach(tr => { const cells=[...tr.children]; if(cells.length) cells[cells.length-1].remove(); });
        _buildResizeHandles(table); _positionControls(wrapper, table);
    });
    colCtrl.appendChild(addColBtn); colCtrl.appendChild(rmColBtn);
    const rowCtrl = document.createElement('div');
    rowCtrl.className = 'table-ctrl table-ctrl--row';
    const addRowBtn = document.createElement('button');
    addRowBtn.className = 'table-ctrl-half table-ctrl-half--left'; addRowBtn.title = 'Add row'; addRowBtn.textContent = '+';
    addRowBtn.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation();
        const colCount = table.querySelector('tr')?.children.length || 1;
        _pushTableHistory(table);
        const tr = document.createElement('tr');
        for (let c=0; c<colCount; c++) { const td=document.createElement('td'); td.contentEditable='true'; td.innerHTML='<br>'; tr.appendChild(td); }
        table.appendChild(tr); _buildResizeHandles(table); _positionControls(wrapper, table);
    });
    const rmRowBtn = document.createElement('button');
    rmRowBtn.className = 'table-ctrl-half table-ctrl-half--right'; rmRowBtn.title = 'Remove last row'; rmRowBtn.textContent = '−';
    rmRowBtn.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation();
        const rows = table.querySelectorAll('tr');
        if (rows.length <= 1) return;
        _pushTableHistory(table); rows[rows.length-1].remove();
        _buildResizeHandles(table); _positionControls(wrapper, table);
    });
    rowCtrl.appendChild(addRowBtn); rowCtrl.appendChild(rmRowBtn);
    wrapper.appendChild(colCtrl); wrapper.appendChild(rowCtrl);
    _buildResizeHandles(table);
    requestAnimationFrame(() => _positionControls(wrapper, table));
    if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => _positionControls(wrapper, table));
        ro.observe(table);
    }
}

function _positionControls(wrapper, table, _retries) {
    const colCtrl = wrapper.querySelector('.table-ctrl--col');
    const rowCtrl = wrapper.querySelector('.table-ctrl--row');
    if (!colCtrl || !rowCtrl) return;
    const w = table.offsetWidth, h = table.offsetHeight;
    if ((w === 0 || h === 0) && (_retries || 0) < 5) {
        requestAnimationFrame(() => _positionControls(wrapper, table, (_retries || 0) + 1));
        return;
    }
    colCtrl.style.left   = `${w + 4}px`;
    colCtrl.style.top    = '0';
    colCtrl.style.height = `${h}px`;
    rowCtrl.style.top    = `${h + 4}px`;
    rowCtrl.style.left   = '0';
    rowCtrl.style.width  = `${w}px`;
}

function _buildResizeHandles(table) {
    table.querySelectorAll('.col-resize-handle, .row-resize-handle').forEach(h => h.remove());
    const rows = [...table.querySelectorAll('tr')];
    rows.forEach((tr, rowIdx) => {
        [...tr.children].forEach((cell, colIdx, cells) => {
            if (colIdx < cells.length - 1) {
                const ch = document.createElement('div');
                ch.className = 'col-resize-handle'; ch.contentEditable = 'false';
                _attachColResize(ch, table, colIdx); cell.appendChild(ch);
            }
            if (colIdx === 0 && rowIdx < rows.length - 1) {
                const rh = document.createElement('div');
                rh.className = 'row-resize-handle'; rh.contentEditable = 'false';
                _attachRowResize(rh, tr); cell.appendChild(rh);
            }
        });
    });
}

function _attachColResize(handle, table, colIndex) {
    handle.addEventListener('dblclick', (e) => {
        e.preventDefault(); e.stopPropagation();
        const rows = [...table.querySelectorAll('tr')]; let maxW = 60;
        rows.forEach(tr => {
            const cell = [...tr.children][colIndex]; if (!cell) return;
            const clone = cell.cloneNode(true);
            clone.style.cssText = 'position:absolute;visibility:hidden;width:auto;white-space:nowrap;padding:8px 12px;';
            document.body.appendChild(clone); maxW = Math.max(maxW, clone.offsetWidth); document.body.removeChild(clone);
        });
        const totalW = table.offsetWidth, pct = `${(maxW/totalW)*100}%`;
        rows.forEach(tr => { const c=[...tr.children]; if(c[colIndex]) c[colIndex].style.width=pct; });
    });
    handle.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation(); handle.classList.add('dragging');
        const startX=e.clientX, cols=[...(table.querySelector('tr')?.children||[])], totalW=table.offsetWidth;
        const startThis=cols[colIndex]?.offsetWidth||0, startNext=cols[colIndex+1]?.offsetWidth||0;
        const onMove = (me) => {
            const d=me.clientX-startX, pct=(w)=>`${(Math.max(40,w)/totalW)*100}%`;
            table.querySelectorAll('tr').forEach(tr => {
                const c=[...tr.children];
                if(c[colIndex]) c[colIndex].style.width=pct(startThis+d);
                if(c[colIndex+1]) c[colIndex+1].style.width=pct(startNext-d);
            });
        };
        const onUp = () => { handle.classList.remove('dragging'); window.removeEventListener('mousemove',onMove); window.removeEventListener('mouseup',onUp); };
        window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
    });
}

function _attachRowResize(handle, tr) {
    handle.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation(); handle.classList.add('dragging');
        const startY=e.clientY, startH=tr.offsetHeight;
        const onMove = (me) => {
            const newH=Math.max(28,startH+me.clientY-startY);
            tr.style.height=`${newH}px`; [...tr.children].forEach(cell => { cell.style.height=`${newH}px`; });
        };
        const onUp = () => { handle.classList.remove('dragging'); window.removeEventListener('mousemove',onMove); window.removeEventListener('mouseup',onUp); };
        window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
    });
}

function _showLinkPrompt(onConfirm) {
    document.getElementById('__editor-link-prompt')?.remove();
    const sel = window.getSelection();
    const rect = sel?.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
    const prompt = document.createElement('div');
    prompt.id = '__editor-link-prompt';
    prompt.innerHTML = `<input type="text" placeholder="https://" value="https://" spellcheck="false"/><button class="confirm">Insert</button><button class="cancel">✕</button>`;
    prompt.style.cssText = `position:fixed;z-index:9999;top:${rect?rect.bottom+8:120}px;left:${rect?Math.max(8,rect.left):200}px;display:flex;align-items:center;gap:6px;background:var(--island-backdrop,#1e1e2e);border:1px solid var(--border-color,#444);border-radius:8px;padding:8px 10px;box-shadow:0 6px 24px rgba(0,0,0,0.4);font-family:inherit;`;
    const input = prompt.querySelector('input');
    input.style.cssText = `background:var(--hover-bg,#2a2a3a);border:1px solid var(--border-color,#555);border-radius:5px;color:var(--text-color,#ccc);font-size:13px;padding:5px 8px;outline:none;width:220px;`;
    prompt.querySelector('.confirm').style.cssText = `background:rgba(101,99,137,0.35);border:1px solid #7ca5d6;border-radius:5px;color:#7ca5d6;font-size:13px;padding:5px 10px;cursor:pointer;`;
    prompt.querySelector('.cancel').style.cssText  = `background:transparent;border:none;color:var(--text-color-secondary,#888);font-size:14px;cursor:pointer;padding:4px 6px;`;
    const close = () => prompt.remove();
    prompt.querySelector('.confirm').addEventListener('click', () => {
        let url = input.value.trim(); close();
        if (!url || url === 'https://') return;
        if (url.startsWith('www.')) url = 'https://' + url;
        onConfirm(url);
    });
    prompt.querySelector('.cancel').addEventListener('click', close);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); prompt.querySelector('.confirm').click(); }
        if (e.key === 'Escape') close();
        e.stopPropagation();
    });
    document.body.appendChild(prompt);
    requestAnimationFrame(() => { input.focus(); input.select(); });
    const outside = (e) => { if (!prompt.contains(e.target)) { close(); document.removeEventListener('mousedown', outside); } };
    setTimeout(() => document.addEventListener('mousedown', outside), 100);
}

export function _rehydrateTable(wrapper, table) {
    wrapper.querySelectorAll('.table-ctrl, .table-ctrl-half').forEach(el => el.remove());
    table.querySelectorAll('.col-resize-handle, .row-resize-handle').forEach(h => h.remove());
    table._history = []; table._future = [];
    _buildTableControls(wrapper, table);
}