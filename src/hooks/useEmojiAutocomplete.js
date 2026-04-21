// useEmojiAutocomplete.js
// Attaches inline emoji autocomplete to a contenteditable editor element.
// Detects :query patterns, shows a floating popup, handles keyboard nav,
// and inserts <img> twemoji on selection or on complete :emoji_name: commit.

import { createRoot } from 'react-dom/client';
import React from 'react';
import {
    loadEmojiData,
    searchEmoji,
    getEmojiById,
    addRecentEmoji,
    emojiImgHtml,
    isEmojiDataLoaded,
} from './useEmoji';
import { EmojiAutocomplete } from '../components/Editor/EmojiPicker';
import * as undoHistory from './undoHistory';

// ── Module state ──────────────────────────────────────────────────────────────
// One popup at a time across all editor instances
let _popupEl    = null;
let _popupRoot  = null;
let _popupState = null; // { editorEl, query, results, activeIndex, anchorRect }

function _destroyPopup() {
    if (_popupRoot) {
        try { _popupRoot.unmount(); } catch (_) {}
        _popupRoot = null;
    }
    if (_popupEl && _popupEl.parentNode) {
        _popupEl.parentNode.removeChild(_popupEl);
    }
    _popupEl    = null;
    _popupState = null;
}

function _ensurePopupEl() {
    if (!_popupEl) {
        _popupEl = document.createElement('div');
        _popupEl.id = 'emoji-autocomplete-portal';
        document.body.appendChild(_popupEl);
        _popupRoot = createRoot(_popupEl);
    }
    return _popupRoot;
}

function _renderPopup(state, onSelect, onClose) {
    const root = _ensurePopupEl();
    _popupState = state;
    root.render(
        React.createElement(EmojiAutocomplete, {
            results:     state.results,
            activeIndex: state.activeIndex,
            anchorRect:  state.anchorRect,
            query:       state.query,
            onSelect,
            onClose,
        })
    );
}

// ── Caret rect helper ─────────────────────────────────────────────────────────
function _getCaretRect() {
    const sel = window.getSelection();
    if (!sel?.rangeCount) return null;
    const range = sel.getRangeAt(0).cloneRange();
    range.collapse(true);
    const rects = range.getClientRects();
    if (rects.length) return rects[0];
    // Fallback: insert a zero-width span
    const span = document.createElement('span');
    span.textContent = '\u200b';
    range.insertNode(span);
    const rect = span.getBoundingClientRect();
    span.parentNode?.removeChild(span);
    return rect;
}

// ── Get the :query before caret ───────────────────────────────────────────────
function _getColonQuery() {
    const sel = window.getSelection();
    if (!sel?.rangeCount) return null;
    const range  = sel.getRangeAt(0);
    const node   = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return null;
    const text   = node.textContent;
    const offset = range.startOffset;
    const before = text.slice(0, offset);
    // Find the last colon before caret that starts a potential emoji name
    const match  = before.match(/:([a-zA-Z0-9_+\-]*)$/);
    if (!match) return null;
    return { query: match[1], colonOffset: offset - match[0].length, node, offset };
}

// ── Replace :query with emoji img ─────────────────────────────────────────────
function _insertEmoji(emoji, colonInfo, editorEl) {
    const { node, colonOffset, offset } = colonInfo;
    const sel = window.getSelection();

    const range = document.createRange();
    range.setStart(node, colonOffset);
    range.setEnd(node, offset);
    sel.removeAllRanges();
    sel.addRange(range);

    // Tell Markdown to skip rewriting the DOM on this specific action
    window.__skipMarkdownSync = true;
    document.execCommand('insertHTML', false, emojiImgHtml(emoji));

    setTimeout(() => undoHistory.cancelPendingCoalesce(), 0);
}

// ── Check if a complete :emoji_name: was just typed ──────────────────────────
function _checkInstantCommit(editorEl) {
    const sel = window.getSelection();
    if (!sel?.rangeCount) return false;
    const range  = sel.getRangeAt(0);
    const node   = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return false;
    const text   = node.textContent;
    const offset = range.startOffset;

    const before = text.slice(0, offset);
    const match  = before.match(/:([a-zA-Z0-9_+\-]+):$/);
    if (!match) return false;

    const emojiId = match[1];
    if (!isEmojiDataLoaded()) return false;
    const emoji = getEmojiById(emojiId);
    if (!emoji) return false;

    const endOffset   = offset;
    const startOffset = offset - match[0].length;

    const r = document.createRange();
    r.setStart(node, startOffset);
    r.setEnd(node, endOffset);
    sel.removeAllRanges();
    sel.addRange(r);

    // Tell Markdown to skip rewriting the DOM on this specific action
    window.__skipMarkdownSync = true;
    document.execCommand('insertHTML', false, emojiImgHtml(emoji));
    addRecentEmoji(emoji.id);

    setTimeout(() => undoHistory.cancelPendingCoalesce(), 0);
    return true;
}
// ── Main attach function ──────────────────────────────────────────────────────
export function attachEmojiAutocomplete(editorEl) {
    if (!editorEl) return () => {};

    // Kick off data load eagerly
    loadEmojiData();

    let currentColonInfo = null;
    let activeIndex      = 0;
    let currentResults   = [];

    const close = () => {
        _destroyPopup();
        currentColonInfo = null;
        activeIndex      = 0;
        currentResults   = [];
    };

    const selectEmoji = (emoji) => {
        if (!currentColonInfo) return;
        addRecentEmoji(emoji.id);
        _insertEmoji(emoji, currentColonInfo, editorEl);
        close();
    };

    const updatePopup = (colonInfo) => {
        const q = colonInfo.query;
        if (q.length < 1) { close(); return; }

        const results = searchEmoji(q, 8);
        currentResults   = results;
        currentColonInfo = colonInfo;

        if (!results.length) { close(); return; }

        const rect = _getCaretRect();
        _renderPopup(
            { results, activeIndex, anchorRect: rect, query: q },
            selectEmoji,
            close,
        );
    };

    const onInput = () => {
        // Check for instant :emoji_name: commit first
        if (_checkInstantCommit(editorEl)) { close(); return; }

        // Then check for in-progress :query
        const colonInfo = _getColonQuery();
        if (!colonInfo || colonInfo.query.length < 1) { close(); return; }
        updatePopup(colonInfo);
    };

    const onKeyDown = (e) => {
        if (!_popupState || !currentResults.length) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            activeIndex = (activeIndex + 1) % currentResults.length;
            _renderPopup(
                { results: currentResults, activeIndex, anchorRect: _getCaretRect(), query: currentColonInfo?.query || '' },
                selectEmoji, close,
            );
            return;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            activeIndex = (activeIndex - 1 + currentResults.length) % currentResults.length;
            _renderPopup(
                { results: currentResults, activeIndex, anchorRect: _getCaretRect(), query: currentColonInfo?.query || '' },
                selectEmoji, close,
            );
            return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
            if (currentResults[activeIndex]) {
                e.preventDefault();
                e.stopPropagation();
                selectEmoji(currentResults[activeIndex]);
                return;
            }
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            close();
            return;
        }
    };

    const onBlur = () => {
        // Small delay so clicks on the popup register first
        setTimeout(close, 150);
    };

    editorEl.addEventListener('input',   onInput);
    editorEl.addEventListener('keydown', onKeyDown, true); // capture so we intercept before useMarkdown
    editorEl.addEventListener('blur',    onBlur, true);

    return () => {
        editorEl.removeEventListener('input',   onInput);
        editorEl.removeEventListener('keydown', onKeyDown, true);
        editorEl.removeEventListener('blur',    onBlur, true);
        close();
    };
}