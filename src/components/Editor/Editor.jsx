// Editor.jsx
import React, {
    useState, useEffect, useRef, useCallback,
    useMemo, useLayoutEffect
} from 'react';
import { createRoot } from 'react-dom/client';
import { useDocumentFont } from '../../hooks/useDocumentFont';
import * as EditorCommands from '../../hooks/useEditorCommands';
import {
    initMathLive,
    insertMathFieldAtCursor,
    attachEditorMathHandlers,
    rehydrateMathInElement,
    extractMathForStorage,
    sanitizeStoredBlockHtml,
} from '../../hooks/useMathField';
import './Editor.css';
import './Markdown.css';
import { attachMarkdown, rehydrateMarkdown } from '../../hooks/useMarkDown.js';
import { attachPaste } from '../../hooks/usePaste.js';
import { attachEmojiAutocomplete } from '../../hooks/useEmojiAutocomplete';
import { attachEmojiTooltip } from '../../hooks/useEmojiTooltip';
import './EmojiPicker.css';
import ImageBlock from './ImageBlock';
import CodeBlock  from './CodeBlock';
import * as undoHistory from '../../hooks/undoHistory';

const tryAutoLinkify       = EditorCommands.tryAutoLinkify       || (() => {});
const tryColorChip         = EditorCommands.tryColorChip         || (() => {});
const handleEditorClick    = EditorCommands.handleEditorClick    || (() => {});
const initLinkTooltip      = EditorCommands.initLinkTooltip      || (() => {});
const initEditorTabHandler = EditorCommands.initEditorTabHandler || (() => {});

// ─────────────────────────────────────────────────────────────────────────────
// Paste sanitiser
// Strips foreign-app wrapper junk from clipboard HTML while preserving inline
// styles (font-family, font-size, color, etc.), semantic tags, and internal
// data attributes (math, markdown, block IDs).
// ─────────────────────────────────────────────────────────────────────────────

function _sanitisePastedHtml(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;

    tmp.querySelectorAll('script,style,meta,link,head').forEach(el => el.remove());

    const UNWRAP_CLASSES = /MsoNormal|MsoBodyText|gmail_|Apple-interchange|apple-converted/i;
    tmp.querySelectorAll('div,span').forEach(el => {
        const cls = el.getAttribute('class') || '';
        if (UNWRAP_CLASSES.test(cls)) el.replaceWith(...el.childNodes);
    });

    const ALLOWED_TAGS = new Set([
        'p','h1','h2','h3','h4','h5','h6',
        'b','strong','i','em','u','s','strike',
        'a','br','hr',
        'ul','ol','li',
        'pre','code',
        'table','thead','tbody','tr','th','td',
        'span','div',
        'math-field','math-wrap',
        'img',
    ]);

    const ALLOWED_STYLE_PROPS = new Set([
        'font-family','font-size','font-weight','font-style',
        'color','background-color','text-decoration',
        'text-align','line-height',
        'margin-left','padding-left',  // preserve indentation
    ]);

    const ALLOWED_ATTRS = new Set(['style','href','src','target','rel','contenteditable']);

    const walk = (node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const tag = node.tagName.toLowerCase();
        [...node.childNodes].forEach(walk);
        if (!ALLOWED_TAGS.has(tag)) { node.replaceWith(...node.childNodes); return; }

        const remove = [];
        for (const attr of node.attributes) {
            const n = attr.name.toLowerCase();
            if (ALLOWED_ATTRS.has(n) || n === 'class' || n.startsWith('data-')) continue;
            remove.push(n);
        }
        remove.forEach(a => node.removeAttribute(a));

        if (node.style?.cssText) {
            const kept = {};
            for (const prop of ALLOWED_STYLE_PROPS) {
                const val = node.style.getPropertyValue(prop);
                if (val) kept[prop] = val;
            }
            node.removeAttribute('style');
            for (const [prop, val] of Object.entries(kept)) node.style.setProperty(prop, val);
        }

        const cls = node.getAttribute('class') || '';
        const keep = (cls.match(/\b(md-[\w-]+|editor-[\w-]+|math-[\w-]+|list-style-[\w-]+)\b/g) || []).join(' ');
        if (keep) node.setAttribute('class', keep);
        else node.removeAttribute('class');
    };

    [...tmp.childNodes].forEach(walk);
    return tmp.innerHTML;
}

// ─────────────────────────────────────────────────────────────────────────────
// Block helpers
// ─────────────────────────────────────────────────────────────────────────────

let _id = 0;
const uid            = () => `b${++_id}`;
const emptyParagraph = () => ({ id: uid(), type: 'paragraph', html: '', tag: 'p', blockStyle: '' });
const pageBreakBlock = () => ({ id: uid(), type: 'page-break', html: '', tag: 'p', blockStyle: '' });
const STORAGE_KEY    = 'editor-blocks';

const imageBlock = (src, width = 320, height = 240, srcFull = '') => ({
    id: uid(), type: 'image-block', src, srcFull: srcFull || src, width, height,
    float: 'none', rotation: 0, tag: 'div', blockStyle: '', html: '',
});

const loadBlocks = () => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [emptyParagraph()];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed) || !parsed.length) return [emptyParagraph()];
        return parsed.map(b => ({
            ...b,
            id: uid(),
            html: b.type === 'image-block' ? '' : sanitizeStoredBlockHtml(b.html || ''),
        }));
    } catch { return [emptyParagraph()]; }
};

const saveBlocks = (blocks) => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(
            blocks.map(b => {
                if (b.type === 'image-block') {
                    const { type, src, srcFull, width, height, float: f, rotation, tag, blockStyle } = b;
                    return { type, src, srcFull: srcFull || src, width, height, float: f, rotation, tag: tag || 'div', blockStyle: blockStyle || '', html: '' };
                }
                const { type, html, tag, blockStyle } = b;
                const base = { type, html, tag: tag || 'p', blockStyle: blockStyle || '' };
                if (type === 'code-block') { base.rawcode = b.rawcode || ''; base.lang = b.lang || ''; }
                return base;
            })
        ));
    } catch {}
};

const splitIntoPages = (blocks) => {
    const pages = [[]];
    for (const b of blocks)
        b.type === 'page-break' ? pages.push([]) : pages[pages.length - 1].push(b);
    return pages;
};

const flattenPages = (pages) => {
    const out = [];
    for (let i = 0; i < pages.length; i++) {
        if (i > 0) out.push(pageBreakBlock());
        out.push(...(pages[i].length ? pages[i] : [emptyParagraph()]));
    }
    return out;
};

// ─────────────────────────────────────────────────────────────────────────────
// DOM helpers (shared between paged + pageless)
// ─────────────────────────────────────────────────────────────────────────────

const focusStart = (el) => {
    if (!el) return;
    el.focus();
    const sel = window.getSelection(), r = document.createRange();
    r.setStart(el.firstChild || el, 0); r.collapse(true);
    sel.removeAllRanges(); sel.addRange(r);
};

const focusEnd = (el) => {
    if (!el) return;
    el.focus();
    const sel = window.getSelection(), r = document.createRange();
    r.selectNodeContents(el); r.collapse(false);
    sel.removeAllRanges(); sel.addRange(r);
};

// Split the innerHTML of `el` at the current cursor position.
// Returns { before, after } as HTML strings.
const splitAtCursor = (el) => {
    const sel = window.getSelection();
    if (!sel.rangeCount) return { before: el.innerHTML, after: '' };
    const cur = sel.getRangeAt(0);
    const mk = (start, end) => {
        const r = document.createRange(); r.setStart(...start); r.setEnd(...end);
        const d = document.createElement('div'); d.appendChild(r.cloneContents());
        return d.innerHTML;
    };
    return {
        before: mk([el, 0],                              [cur.startContainer, cur.startOffset]),
        after:  mk([cur.startContainer, cur.startOffset], [el, el.childNodes.length]),
    };
};

// Wrap any bare text-node children of `el` in <p> tags so the block system
// always sees only element children.
const normaliseDOM = (el) => {
    for (const n of [...el.childNodes])
        if (n.nodeType === Node.TEXT_NODE && n.textContent.trim()) {
            const p = document.createElement('p');
            p.dataset.blockId = uid();
            el.insertBefore(p, n); p.appendChild(n);
        }
};

// Read the current DOM of a contentEditable div into the block array format.
const readBlocks = (el) => {
    normaliseDOM(el);
    const blocks = [...el.children].map(c => {
        if (c.classList.contains('page-break'))
            return { id: c.dataset.blockId || uid(), type: 'page-break', html: '', tag: 'p', blockStyle: '' };
        if (c.classList.contains('editor-table-wrapper')) {
            const tableEl = c.querySelector('.editor-inserted-table');
            return { id: c.dataset.blockId || uid(), type: 'table-wrapper', html: tableEl ? tableEl.outerHTML : '', tag: 'div', blockStyle: '' };
        }
        if (c.classList.contains('editor-code-block-host')) {
            return { id: c.dataset.blockId || uid(), type: 'code-block', rawcode: c.dataset.rawcode || '', lang: c.dataset.lang || '', tag: 'pre', blockStyle: '', html: '' };
        }
        // Legacy: plain <pre> from old storage (no host div)
        if (c.classList.contains('md-codeblock')) {
            const store = c.querySelector('.md-rawcode-store');
            return { id: c.dataset.blockId || uid(), type: 'code-block', rawcode: store?.textContent || c.dataset.rawcode || '', lang: c.dataset.lang || '', tag: 'pre', blockStyle: '', html: '' };
        }
        if (c.classList.contains('editor-image-block-host')) {
            return {
                id:       c.dataset.blockId || uid(),
                type:     'image-block',
                src:      c.dataset.src     ? decodeURIComponent(c.dataset.src)     : '',
                srcFull:  c.dataset.srcFull ? decodeURIComponent(c.dataset.srcFull) : '',
                width:    Number(c.dataset.width)    || 320,
                height:   Number(c.dataset.height)   || 240,
                float:    c.dataset.float    || 'none',
                rotation: Number(c.dataset.rotation) || 0,
                tag: 'div', blockStyle: '', html: '',
            };
        }
        const isEmpty = c.innerHTML === '<br>' || c.innerHTML === '';
        return {
            id:         c.dataset.blockId || uid(),
            type:       'paragraph',
            html:       isEmpty ? '' : extractMathForStorage(c.innerHTML),
            tag:        c.tagName.toLowerCase(),
            blockStyle: c.getAttribute('style') || '',
        };
    });
    return blocks.length ? blocks : [emptyParagraph()];
};

function isAtVeryStart(editable) {
    const sel = window.getSelection();
    if (!sel?.rangeCount) return false;
    const cur = sel.getRangeAt(0);
    if (!cur.collapsed) return false;
    const start = document.createRange();
    start.setStart(editable, 0); start.collapse(true);
    try { return cur.compareBoundaryPoints(Range.START_TO_START, start) === 0; }
    catch { return false; }
}

function getContrastColor(hex) {
    if (!hex || !hex.startsWith('#')) return null;
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return (0.299*r + 0.587*g + 0.114*b)/255 > 0.55 ? '#1a1a1a' : '#d3d3d3';
}

function getPageCssVars(pageColor) {
    if (!pageColor) return {};
    const text = getContrastColor(pageColor);
    if (!text) return {};
    const isLight = text === '#1a1a1a';
    return {
        '--page-text':           text,
        '--page-text-secondary': isLight ? 'rgba(26,26,26,0.4)'    : 'rgba(211,211,211,0.4)',
        '--page-border':         isLight ? 'rgba(0,0,0,0.12)'      : 'rgba(255,255,255,0.08)',
        '--page-th-bg':          isLight ? 'rgba(101,99,137,0.10)' : 'rgba(101,99,137,0.20)',
    };
}

function blockToHtml(b) {
    if (b.type === 'page-break')
        return `<div class="page-break" data-block-id="${b.id}" contenteditable="false"><span>Page Break</span></div>`;
    if (b.type === 'table-wrapper')
        return `<div class="editor-table-wrapper" data-block-id="${b.id}">${b.html}</div>`;
    if (b.type === 'code-block') {
        const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        return (
            `<div class="editor-code-block-host" contenteditable="false" ` +
            `data-block-id="${b.id}" ` +
            `data-rawcode="${esc(b.rawcode || '')}" ` +
            `data-lang="${esc(b.lang || '')}">` +
            `</div>`
        );
    }
    if (b.type === 'image-block') {
        return (
            `<div class="editor-image-block-host" contenteditable="false" ` +
            `data-block-id="${b.id}" ` +
            `data-src="${encodeURIComponent(b.src || '')}" ` +
            `data-src-full="${encodeURIComponent(b.srcFull || b.src || '')}" ` +
            `data-width="${b.width || 320}" ` +
            `data-height="${b.height || 240}" ` +
            `data-float="${b.float || 'none'}" ` +
            `data-rotation="${b.rotation || 0}">` +
            `</div>`
        );
    }
    const tag       = b.tag && b.tag !== 'div' ? b.tag : 'p';
    const styleAttr = b.blockStyle ? ` style="${b.blockStyle}"` : '';
    const content   = b.html || '<br>';
    return `<${tag} data-block-id="${b.id}"${styleAttr}>${content}</${tag}>`;
}

function rehydrateTables(container) {
    container.querySelectorAll('.editor-inserted-table').forEach(table => {
        const wrapper = table.closest('.editor-table-wrapper');
        if (!wrapper || wrapper.querySelector('.table-ctrl')) return;
        table._history = []; table._future = [];
        EditorCommands._rehydrateTable?.(wrapper, table);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Image block mounter
// ─────────────────────────────────────────────────────────────────────────────

function mountImageBlocks(container, blocksRef, onBlocksChange, editorContentRef, marginsPx) {
    container.querySelectorAll('.editor-image-block-host').forEach(host => {
        if (host.__imageRoot) return;
        const id       = host.dataset.blockId;
        const src      = decodeURIComponent(host.dataset.src || '');
        const srcFull  = decodeURIComponent(host.dataset.srcFull || host.dataset.src || '');
        const width    = Number(host.dataset.width)    || 320;
        const height   = Number(host.dataset.height)   || 240;
        const float    = host.dataset.float    || 'none';
        const rotation = Number(host.dataset.rotation) || 0;

        const syncAttrs = (patch) => {
            if (patch.src      !== undefined) host.dataset.src      = encodeURIComponent(patch.src);
            if (patch.srcFull  !== undefined) host.dataset.srcFull  = encodeURIComponent(patch.srcFull);
            if (patch.width    !== undefined) host.dataset.width    = patch.width;
            if (patch.height   !== undefined) host.dataset.height   = patch.height;
            if (patch.float    !== undefined) host.dataset.float    = patch.float;
            if (patch.rotation !== undefined) host.dataset.rotation = patch.rotation;
        };
        const mergeFromHost = (h) => ({
            id:       h.dataset.blockId,
            src:      decodeURIComponent(h.dataset.src     || ''),
            srcFull:  decodeURIComponent(h.dataset.srcFull || h.dataset.src || ''),
            width:    Number(h.dataset.width)    || 320,
            height:   Number(h.dataset.height)   || 240,
            float:    h.dataset.float    || 'none',
            rotation: Number(h.dataset.rotation) || 0,
        });
        const onUpdate = (patch) => {
            syncAttrs(patch);
            onBlocksChange(prev => {
                const next = prev.map(b => b.id === id ? { ...b, ...patch } : b);
                saveBlocks(next); return next;
            });
            renderBlock(mergeFromHost(host));
        };
        const onDelete = () => {
            const deletedBlock = blocksRef.current?.find(b => b.id === id);
            undoHistory.pushCustom(
                () => {
                    if (deletedBlock) onBlocksChange(prev => {
                        const next = [...prev, deletedBlock];
                        saveBlocks(next); return next;
                    });
                },
                () => {
                    onBlocksChange(prev => {
                        const next = prev.filter(b => b.id !== id);
                        return next.length ? next : [emptyParagraph()];
                    });
                    host.__imageRoot?.unmount(); host.remove();
                },
            );
            onBlocksChange(prev => {
                const next = prev.filter(b => b.id !== id);
                return next.length ? next : [emptyParagraph()];
            });
            host.__imageRoot?.unmount(); host.remove();
        };

        host.style.display = 'block';
        if (float === 'left')       { host.style.float = 'left';  host.style.margin = '4px 14px 8px 0'; }
        else if (float === 'right') { host.style.float = 'right'; host.style.margin = '4px 0 8px 14px'; }
        else                        { host.style.float = 'none';  host.style.margin = '8px auto'; }

        const renderBlock = (props) => {
            host.__imageRoot.render(
                <ImageBlock {...props}
                    editorRef={editorContentRef} marginsPx={marginsPx}
                    onUpdate={onUpdate} onDelete={onDelete} />
            );
        };
        host.__imageRoot = createRoot(host);
        renderBlock({ id, src, srcFull, width, height, float, rotation });
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Code block mounter  (mirrors mountImageBlocks exactly)
// ─────────────────────────────────────────────────────────────────────────────

function mountCodeBlocks(container, onBlocksChange) {
    container.querySelectorAll('.editor-code-block-host').forEach(host => {
        if (host.__codeRoot) return; // already mounted

        const id      = host.dataset.blockId;
        const rawcode = host.dataset.rawcode || '';
        const lang    = host.dataset.lang    || '';

        const onUpdate = (patch) => {
            if (patch.rawcode !== undefined) host.dataset.rawcode = patch.rawcode;
            if (patch.lang    !== undefined) host.dataset.lang    = patch.lang;
            onBlocksChange(prev => {
                const next = prev.map(b => b.id === id ? { ...b, ...patch } : b);
                saveBlocks(next); return next;
            });
        };

        const onDelete = () => {
            onBlocksChange(prev => {
                const next = prev.filter(b => b.id !== id);
                return next.length ? next : [emptyParagraph()];
            });
            host.__codeRoot?.unmount();
            host.remove();
            // Fire input so editor syncs
            container.dispatchEvent(new Event('input', { bubbles: true }));
        };

        host.__codeRoot = createRoot(host);
        host.__codeRoot.render(
            <CodeBlock
                id={id}
                rawcode={rawcode}
                lang={lang}
                onUpdate={onUpdate}
                onDelete={onDelete}
            />
        );
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Image insert helpers
// ─────────────────────────────────────────────────────────────────────────────

// Compress an image File into two data-URLs:
//   editorUrl — max 1600px edge, JPEG 0.88 — sharp at any editor display size,
//               visually indistinguishable from raw, ~3-6× smaller file
//   fullUrl   — max 1920px edge, JPEG 0.92 (PNG lossless) — fullscreen & export
function compressImageFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = reject;
        reader.onload = e => {
            const img = new Image();
            img.onerror = reject;
            img.onload = () => {
                const isPng = file.type === 'image/png';
                const { naturalWidth: origW, naturalHeight: origH } = img;

                const makeDataUrl = (maxEdge, quality) => {
                    let w = origW, h = origH;
                    if (w > maxEdge || h > maxEdge) {
                        if (w >= h) { h = Math.round(h * maxEdge / w); w = maxEdge; }
                        else        { w = Math.round(w * maxEdge / h); h = maxEdge; }
                    }
                    const c = document.createElement('canvas');
                    c.width = w; c.height = h;
                    c.getContext('2d').drawImage(img, 0, 0, w, h);
                    return {
                        url: isPng ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', quality),
                        w, h,
                    };
                };

                // Editor version: sharp, high-quality, still much smaller than raw
                const editor = makeDataUrl(1600, 0.88);
                // Fullscreen/export: highest quality
                const full   = makeDataUrl(1920, 0.92);

                resolve({ editorUrl: editor.url, editorW: editor.w, editorH: editor.h, fullUrl: full.url });
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

function getImageDimensions(src) {
    return new Promise((res) => {
        const img = new Image();
        img.onload = () => {
            const MAX = 480;
            let w = img.naturalWidth, h = img.naturalHeight;
            if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
            res({ width: w, height: h });
        };
        img.onerror = () => res({ width: 320, height: 240 });
        img.src = src;
    });
}

async function insertImageFromFile(file, onBlocksChange) {
    if (!file || !file.type.startsWith('image/')) return;
    const { editorUrl, editorW, editorH, fullUrl } = await compressImageFile(file);
    // Display dimensions: cap at 480px wide, preserve aspect ratio
    const MAX_DISPLAY = 480;
    let dispW = editorW, dispH = editorH;
    if (dispW > MAX_DISPLAY) { dispH = Math.round(dispH * MAX_DISPLAY / dispW); dispW = MAX_DISPLAY; }
    // src = editor-quality (lazy-loaded), srcFull = full-res (fullscreen + export)
    const newBlock = imageBlock(editorUrl, dispW, dispH, fullUrl);
    undoHistory.pushCustom(
        () => onBlocksChange(p => p.filter(b => b.id !== newBlock.id)),
        () => onBlocksChange(p => [...p, newBlock, emptyParagraph()]),
    );
    onBlocksChange(prev => [...prev, newBlock, emptyParagraph()]);
}

async function insertImageFromUrl(url, onBlocksChange) {
    const { width, height } = await getImageDimensions(url);
    onBlocksChange(prev => [...prev, imageBlock(url, width, height), emptyParagraph()]);
}

// ─────────────────────────────────────────────────────────────────────────────
// useEditorCore — the shared hook that powers both Pageless and Page views.
//
// Owns: DOM ref, block read/sync, keydown (Enter + Ctrl+Enter + Backspace),
//       paste (Ctrl+V with formatting, Ctrl+Shift+V plain), drag-drop images,
//       math/markdown/emoji attachment, link tooltip.
//
// `onEnter`  — called when the user presses plain Enter. Receives the split
//              result and must decide what to do (pageless does an in-DOM
//              split; paged calls onPageChange).
// `onCtrlEnter` — same but for Ctrl+Enter (page-break in pageless, explicit
//                 page-break in paged).
// `onBackspaceAtStart` — paged passes a handler; pageless ignores it.
// ─────────────────────────────────────────────────────────────────────────────

function useEditorCore({
    blocks,
    onBlocksChange,
    onEnter,
    onCtrlEnter,
    onBackspaceAtStart,
    marginsPx = { left:0, right:0, top:0, bottom:0 },
}) {
    const el        = useRef(null);
    const blocksRef = useRef(blocks);
    blocksRef.current = blocks;

    useDocumentFont(el);

    // ── Attach non-React handlers once on mount ──────────────────────────────
    useEffect(() => {
        if (!el.current) return;
        const cleanupMath     = attachEditorMathHandlers(el.current);
        const cleanupMd       = attachMarkdown(el.current);
        const cleanupEmoji    = attachEmojiAutocomplete(el.current);
        const cleanupEmojiTip = attachEmojiTooltip(el.current);
        const cleanupTooltip  = initLinkTooltip(el.current);
        return () => { cleanupMath(); cleanupMd(); cleanupEmoji(); cleanupEmojiTip(); cleanupTooltip?.(); };
    }, []); // eslint-disable-line

    // ── Drag-and-drop images ─────────────────────────────────────────────────
    useEffect(() => {
        const container = el.current;
        if (!container) return;
        const onDragOver = (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } };
        const onDrop     = async (e) => {
            const file = [...e.dataTransfer.files].find(f => f.type.startsWith('image/'));
            if (!file) return;
            e.preventDefault();
            await insertImageFromFile(file, onBlocksChange);
        };
        container.addEventListener('dragover', onDragOver);
        container.addEventListener('drop', onDrop);
        return () => { container.removeEventListener('dragover', onDragOver); container.removeEventListener('drop', onDrop); };
    }, [onBlocksChange]);

    // ── Copy: preserve all editor internals (markdown data-attrs, styles, lists) ─
    useEffect(() => {
        const container = el.current;
        if (!container) return;

        // Pure serialiser — writes editor-native HTML + plain text to clipboardData
        const _writeClipboard = (e, sel) => {
            const range = sel.getRangeAt(0);
            const frag  = range.cloneContents();
            const wrap  = document.createElement('div');
            wrap.appendChild(frag);

            wrap.querySelectorAll('[data-block-id]').forEach(n => n.dataset.blockId = uid());
            wrap.querySelectorAll(
                '.img-toolbar,.img-handle,.img-rot-handle,.editor-image-block-host'
            ).forEach(n => n.remove());

            // plain text: use a hidden clone so innerText gives us correct block
            // boundaries (each <p>/<h*>/etc becomes \n) without any manual walking.
            // We hide md-marker spans before reading so ** * ~ etc don't appear.
            const plainClone = wrap.cloneNode(true);
            plainClone.querySelectorAll('.md-marker').forEach(n => n.remove());
            // Briefly attach off-screen so innerText is computed correctly
            plainClone.style.cssText = 'position:fixed;left:-9999px;top:-9999px;white-space:pre-wrap';
            document.body.appendChild(plainClone);
            const plainText = plainClone.innerText.replace(/\n{3,}/g, '\n\n').trim();
            document.body.removeChild(plainClone);

            e.clipboardData.setData('text/html',  `<!--editor-native-copy-->${wrap.innerHTML}`);
            e.clipboardData.setData('text/plain', plainText);
        };

        const onCopy = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const sel = window.getSelection();
            if (!sel || sel.isCollapsed) return;
            _writeClipboard(e, sel);
        };

        const onCut = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const sel = window.getSelection();
            if (!sel || sel.isCollapsed) return;
            _writeClipboard(e, sel);
            sel.getRangeAt(0).deleteContents();
            container.dispatchEvent(new Event('input', { bubbles: true }));
        };

        container.addEventListener('copy', onCopy);
        container.addEventListener('cut',  onCut);
        return () => {
            container.removeEventListener('copy', onCopy);
            container.removeEventListener('cut',  onCut);
        };
    }, []); // eslint-disable-line

    // ── Paste ────────────────────────────────────────────────────────────────
    useEffect(() => {
        const container = el.current;
        if (!container) return;
        const cleanupPaste = attachPaste(container, insertImageFromFile, onBlocksChange);
        return cleanupPaste;
    }, [onBlocksChange]);

    // ── Keyboard handler ─────────────────────────────────────────────────────
    const handleKeyDown = useCallback((e) => {
        tryColorChip(e);   if (e.defaultPrevented) return;
        tryAutoLinkify(e); if (e.defaultPrevented) return;

        const mod = e.ctrlKey || e.metaKey;

        if (mod && e.key === 'e') {
            e.preventDefault(); e.stopPropagation();
            insertMathFieldAtCursor(null);
            return;
        }

        // ── Plain Enter: split current block at cursor ───────────────────────
        if (e.key === 'Enter' && !mod) {
            if (!el.current) return;
            const sel = window.getSelection();
            if (!sel.rangeCount) return;

            // Find the nearest block-level ancestor
            let anchor = sel.anchorNode;
            while (anchor && anchor !== el.current &&
                   !['P','H1','H2','H3','H4','H5','H6','LI'].includes(anchor.nodeName))
                anchor = anchor.parentNode;

            const pEl = (anchor && anchor !== el.current)
                ? anchor
                : sel.anchorNode?.parentElement?.closest('p,h1,h2,h3,h4,h5,h6')
                  || el.current.lastElementChild;

            // If we're inside a code block or other non-splittable element,
            // let the browser handle it natively
            if (pEl?.closest?.('.md-codeblock')) return;

            e.preventDefault();
            const { before, after } = pEl ? splitAtCursor(pEl) : { before: '', after: '' };
            onEnter?.({ pEl, before, after, el });
            return;
        }

        // ── Ctrl+Enter: insert page break ────────────────────────────────────
        if (mod && e.key === 'Enter') {
            e.preventDefault();
            if (!el.current) return;
            const sel = window.getSelection();
            if (!sel.rangeCount) return;
            let anchor = sel.anchorNode;
            while (anchor && anchor !== el.current &&
                   !['P','H1','H2','H3','H4','H5','H6','LI'].includes(anchor.nodeName))
                anchor = anchor.parentNode;
            const pEl = (anchor && anchor !== el.current)
                ? anchor
                : sel.anchorNode?.parentElement?.closest('p,h1,h2,h3,h4,h5,h6')
                  || el.current.lastElementChild;
            const { before, after } = pEl ? splitAtCursor(pEl) : { before: '', after: '' };
            onCtrlEnter?.({ pEl, before, after, el });
            return;
        }

        // ── Backspace at very start of content ───────────────────────────────
        if (e.key === 'Backspace' && el.current) {
            if (isAtVeryStart(el.current)) onBackspaceAtStart?.(e);
        }
    }, [onEnter, onCtrlEnter, onBackspaceAtStart]);

    // ── Mount / update image blocks ──────────────────────────────────────────
    const mountImages = useCallback(() => {
        if (!el.current) return;
        mountImageBlocks(el.current, blocksRef, onBlocksChange, el, marginsPx);
    }, [onBlocksChange, marginsPx]);

    // ── Mount code blocks ────────────────────────────────────────────────────
    const mountCode = useCallback(() => {
        if (!el.current) return;
        mountCodeBlocks(el.current, onBlocksChange);
    }, [onBlocksChange]);

    return { el, handleKeyDown, mountImages, mountCode };
}

// ─────────────────────────────────────────────────────────────────────────────
// PagelessView
// ─────────────────────────────────────────────────────────────────────────────

const PagelessView = ({ blocks, onBlocksChange }) => {
    const blocksRef = useRef(blocks);
    blocksRef.current = blocks;

    // ── Read DOM → block array and persist ───────────────────────────────────
    const flush = useCallback((container) => {
        if (!container) return null;
        normaliseDOM(container);
        const nb = readBlocks(container);
        return nb;
    }, []);

    const sync = useCallback((container) => {
        const r = flush(container);
        if (r) { onBlocksChange(r); saveBlocks(r); }
    }, [flush, onBlocksChange]);

    // ── Plain Enter: do an in-DOM split, then sync ────────────────────────────
const onEnter = useCallback(({ pEl, before, after, el }) => {
        if (!pEl || !el.current) return;
        const container = el.current;
        const _before = container.innerHTML;
        pEl.innerHTML = before || '<br>';
        const next = document.createElement('p');
        next.dataset.blockId = uid();
        const inheritStyle = pEl.getAttribute('style') || '';
        if (inheritStyle) next.setAttribute('style', inheritStyle);
        next.innerHTML = after || '<br>';
        pEl.after(next);
        focusStart(next);
        sync(el.current);
        const _after = container.innerHTML;
        undoHistory.pushCustom(
            () => { container.innerHTML = _before; },
            () => { container.innerHTML = _after; },
        );
        undoHistory.cancelPendingCoalesce();
    }, [sync]);

    // ── Ctrl+Enter: insert a page-break marker then sync ─────────────────────
    const onCtrlEnter = useCallback(({ pEl, before, after, el }) => {
        if (!el.current) return;
        normaliseDOM(el.current);
        if (pEl && pEl !== el.current) {
            pEl.innerHTML = before || '<br>';
            const pb = document.createElement('div');
            pb.className = 'page-break'; pb.contentEditable = 'false';
            pb.innerHTML = '<span>Page Break</span>'; pb.dataset.blockId = uid();
            const next = document.createElement('p');
            next.dataset.blockId = uid(); next.innerHTML = after || '<br>';
            pEl.after(pb); pb.after(next);
            const r = document.createRange();
            r.setStart(next.firstChild || next, 0); r.collapse(true);
            window.getSelection().removeAllRanges(); window.getSelection().addRange(r);
        } else {
            const sel = window.getSelection();
            const range = sel.getRangeAt(0); range.deleteContents();
            const pb = document.createElement('div');
            pb.className = 'page-break'; pb.contentEditable = 'false';
            pb.innerHTML = '<span>Page Break</span>'; pb.dataset.blockId = uid();
            const next = document.createElement('p'); next.dataset.blockId = uid();
            next.appendChild(document.createElement('br'));
            range.insertNode(next); range.insertNode(pb);
            const r = document.createRange(); r.setStart(next, 0); r.collapse(true);
            sel.removeAllRanges(); sel.addRange(r);
        }
        sync(el.current);
    }, [sync]);

    const { el, handleKeyDown, mountImages, mountCode } = useEditorCore({
        blocks, onBlocksChange, onEnter, onCtrlEnter,
    });

    // ── Initial DOM render ───────────────────────────────────────────────────
    useEffect(() => {
        if (!el.current) return;
        el.current.innerHTML = blocks.map(blockToHtml).join('');
        rehydrateTables(el.current);
        rehydrateMathInElement(el.current);
        rehydrateMarkdown(el.current);
        mountImages();
        mountCode();
        // Expose mountCode on the container so sealFence in useMarkDown can call it
        el.current.__mountCode = mountCode;
    }, []); // eslint-disable-line

    // ── Re-mount any image blocks that appear in state but not the DOM ────────
    useEffect(() => {
        if (!el.current) return;
        const missing = blocks
            .filter(b => b.type === 'image-block')
            .filter(b => !el.current.querySelector(`[data-block-id="${b.id}"]`));
        if (!missing.length) return;
        missing.forEach(b => {
            const host = document.createElement('div');
            host.className = 'editor-image-block-host'; host.contentEditable = 'false';
            host.dataset.blockId  = b.id;
            host.dataset.src      = encodeURIComponent(b.src || '');
            host.dataset.srcFull  = encodeURIComponent(b.srcFull || b.src || '');
            host.dataset.width    = b.width    || 320;
            host.dataset.height   = b.height   || 240;
            host.dataset.float    = b.float    || 'none';
            host.dataset.rotation = b.rotation || 0;
            el.current.appendChild(host);
        });
        mountImages();
    }, [blocks, mountImages]);

    // ── Flush on unmount ─────────────────────────────────────────────────────
    const syncRef = useRef(sync);
    syncRef.current = sync;
    useEffect(() => () => {
        const r = el.current ? flush(el.current) : null;
        if (r) { syncRef.current(el.current); saveBlocks(r); }
    }, [flush]); // eslint-disable-line

    return (
        <div className="editor-pageless-wrap">
            <div ref={el} className="editor-content editor-pageless" contentEditable
                suppressContentEditableWarning spellCheck data-placeholder="Start writing…"
                onInput={e => sync(e.currentTarget)}
                onKeyDown={handleKeyDown}
                onClick={handleEditorClick} />
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// Page  (single page inside PagedView)
// ─────────────────────────────────────────────────────────────────────────────

const Page = React.memo(({ pageIndex, blocks, structuralVersion, totalPages,
    pageDimensions, marginsPx, pageColor,
    onPageChange, onOverflow, onMergeIntoPrev, registerRef, onBlocksChange }) => {

    const contentHeight  = pageDimensions.height - marginsPx.top - marginsPx.bottom;
    const skipNextInput  = useRef(false);
    const prevStructural = useRef(-1);
    const overflowSched  = useRef(false);

    // ── Plain Enter: call onPageChange with an explicit block split ───────────
    const onEnter = useCallback(({ pEl, before, after }) => {
        const inheritStyle = pEl?.getAttribute?.('style') || '';
        const afterId = uid();
        skipNextInput.current = true;
        requestAnimationFrame(() => {
            const newBlock = elRef.current?.querySelector(`[data-block-id="${afterId}"]`);
            if (newBlock) focusStart(newBlock);
        });
        onPageChange(pageIndex, null, {
            explicitBreakAt:  pEl?.dataset?.blockId || uid(),
            beforeHtml:       before,
            afterHtml:        after,
            afterId,
            beforeTag:        pEl?.tagName?.toLowerCase() || 'p',
            beforeBlockStyle: pEl?.getAttribute?.('style') || '',
            afterBlockStyle:  inheritStyle,
        });
    }, [pageIndex, onPageChange]);

    // ── Ctrl+Enter: explicit page-break split ────────────────────────────────
    const onCtrlEnter = useCallback(({ pEl, before, after }) => {
        const afterId = uid();
        skipNextInput.current = true;
        requestAnimationFrame(() => {
            const newBlock = elRef.current?.querySelector(`[data-block-id="${afterId}"]`);
            if (newBlock) focusStart(newBlock);
        });
        onPageChange(pageIndex, null, {
            explicitBreakAt:  pEl?.dataset?.blockId || uid(),
            beforeHtml:       before,
            afterHtml:        after,
            afterId,
            beforeTag:        pEl?.tagName?.toLowerCase() || 'p',
            beforeBlockStyle: pEl?.getAttribute?.('style') || '',
        });
    }, [pageIndex, onPageChange]);

    // ── Backspace at very start: merge into previous page ────────────────────
    const onBackspaceAtStart = useCallback((e) => {
        if (pageIndex <= 0) return;
        e.preventDefault();
        skipNextInput.current = true;
        onMergeIntoPrev(pageIndex);
    }, [pageIndex, onMergeIntoPrev]);

    const { el: elRef, handleKeyDown, mountImages, mountCode } = useEditorCore({
        blocks, onBlocksChange, onEnter, onCtrlEnter, onBackspaceAtStart, marginsPx,
    });

    useEffect(() => { registerRef(pageIndex, elRef); return () => registerRef(pageIndex, null); }, [pageIndex, registerRef, elRef]);

    // ── Structural re-render (when blocks array changes shape) ────────────────
    useEffect(() => {
        if (!elRef.current || prevStructural.current === structuralVersion) return;
        prevStructural.current = structuralVersion;
        elRef.current.innerHTML = blocks
            .filter(b => b.type === 'paragraph' || b.type === 'table-wrapper' || b.type === 'code-block' || b.type === 'image-block')
            .map(blockToHtml).join('');
        rehydrateTables(elRef.current);
        rehydrateMathInElement(elRef.current);
        rehydrateMarkdown(elRef.current);
        mountImages();
        mountCode();
    }, [blocks, structuralVersion, mountImages, mountCode]);

    // ── Mount any new image blocks ────────────────────────────────────────────
    useEffect(() => {
        if (!elRef.current) return;
        const missing = blocks
            .filter(b => b.type === 'image-block')
            .filter(b => !elRef.current.querySelector(`[data-block-id="${b.id}"]`));
        if (!missing.length) return;
        missing.forEach(b => {
            const host = document.createElement('div');
            host.className = 'editor-image-block-host'; host.contentEditable = 'false';
            host.dataset.blockId = b.id; host.dataset.src = encodeURIComponent(b.src || '');
            host.dataset.width = b.width || 320; host.dataset.height = b.height || 240;
            host.dataset.float = b.float || 'none'; host.dataset.rotation = b.rotation || 0;
            elRef.current.appendChild(host);
        });
        mountImages();
    }, [blocks, mountImages]);

    // ── Overflow detection ────────────────────────────────────────────────────
    useLayoutEffect(() => {
        if (!elRef.current || pageIndex >= totalPages) return;
        const over = elRef.current.scrollHeight > contentHeight + 4;
        if (over && !overflowSched.current) {
            overflowSched.current = true;
            requestAnimationFrame(() => {
                if (!elRef.current || pageIndex >= totalPages) { overflowSched.current = false; return; }
                if (elRef.current.scrollHeight > contentHeight + 4) onOverflow(pageIndex);
                else overflowSched.current = false;
            });
        } else if (!over) {
            overflowSched.current = false;
        }
    });

    // ── Sync DOM → blocks on input ────────────────────────────────────────────
    const syncBlocks = useCallback(() => {
        if (!elRef.current || skipNextInput.current) { skipNextInput.current = false; return; }
        onPageChange(pageIndex, readBlocks(elRef.current));
    }, [pageIndex, onPageChange]);

    // ── Paste overflow split (paged-only concern) ────────────────────────────
    const handlePaste = useCallback((e) => {

        e.preventDefault();


        setTimeout(() => {
            if (!elRef.current) return;
            let didSplit = false;
            [...elRef.current.querySelectorAll('p')].forEach(p => {
                if (p.scrollHeight <= contentHeight) return;
                const words = (p.innerText || '').split(/(\s+)/);
                if (words.length <= 2) return;
                const mid = Math.ceil(words.length / 2);
                p.innerHTML = words.slice(0, mid).join('') || '<br>';
                const next = document.createElement('p');
                next.dataset.blockId = uid();
                next.innerHTML = words.slice(mid).join('') || '<br>';
                p.after(next); didSplit = true;
            });
            if (didSplit) syncBlocks();
            else onPageChange(pageIndex, readBlocks(elRef.current));
        }, 0);
    }, [contentHeight, syncBlocks, pageIndex, onPageChange]);

    const pageStyle = { width: pageDimensions.width, backgroundColor: pageColor, ...getPageCssVars(pageColor) };

    return (
        <div className="editor-page" style={pageStyle} data-page={pageIndex + 1}>
            <div style={{ paddingTop: marginsPx.top, paddingBottom: marginsPx.bottom, paddingLeft: marginsPx.left, paddingRight: marginsPx.right, boxSizing: 'border-box' }}>
                <div ref={elRef} className="editor-content editor-paged" contentEditable
                    suppressContentEditableWarning spellCheck
                    style={{ minHeight: contentHeight }}
                    onInput={syncBlocks} onKeyDown={handleKeyDown}
                    onPaste={handlePaste} onClick={handleEditorClick} />
            </div>
        </div>
    );
});

// ─────────────────────────────────────────────────────────────────────────────
// PagedView
// ─────────────────────────────────────────────────────────────────────────────

const PagedView = ({ blocks, onBlocksChange, pageDimensions, marginsPx, pageColor }) => {
    const pages = useMemo(() =>
        splitIntoPages(blocks).map(p => p.length ? p : [emptyParagraph()]),
    [blocks]);

    const pageCountRef = useRef(pages.length);
    pageCountRef.current = pages.length;

    const pageRefs     = useRef({});
    const pendingFocus = useRef(null);
    const [structuralVersion, setStructuralVersion] = useState(0);
    const bump = useCallback(() => setStructuralVersion(v => v + 1), []);

    const registerRef = useCallback((idx, ref) => {
        if (ref) pageRefs.current[idx] = ref; else delete pageRefs.current[idx];
    }, []);

    // Apply any pending focus requests after render
    useEffect(() => {
        const req = pendingFocus.current;
        if (!req) return;
        pendingFocus.current = null;
        const target = pageRefs.current[req.pageIndex]?.current;
        if (!target) return;
        if (req.atEnd) focusEnd(target); else focusStart(target);
    });

    const handleOverflow = useCallback((pageIndex) => {
        onBlocksChange(prev => {
            const pgs = splitIntoPages(prev);
            const pg  = pgs[pageIndex];
            if (!pg || pg.length <= 1) return prev;
            const moved = pg.pop();
            if (!pgs[pageIndex + 1]) pgs[pageIndex + 1] = [];
            pgs[pageIndex + 1] = [moved, ...pgs[pageIndex + 1]];
            const flat = flattenPages(pgs); saveBlocks(flat); return flat;
        });
        bump();
        pendingFocus.current = { pageIndex: pageIndex + 1, atEnd: false };
    }, [onBlocksChange, bump]);

    const handlePageChange = useCallback((pageIndex, newBlocks, opts) => {
        if (opts) bump();
        onBlocksChange(prev => {
            const pgs = splitIntoPages(prev);
            if (opts?.explicitBreakAt !== undefined) {
                const pg     = pgs[pageIndex];
                const idx    = pg.findIndex(b => b.id === opts.explicitBreakAt);
                const before = idx >= 0 ? pg.slice(0, idx) : pg;
                const pivot  = idx >= 0 ? { ...pg[idx], html: opts.beforeHtml, tag: opts.beforeTag || pg[idx].tag, blockStyle: opts.beforeBlockStyle || pg[idx].blockStyle } : null;
                const after  = idx >= 0 ? pg.slice(idx + 1) : [];
                const newThis = pivot ? [...before, pivot] : before;
                const newNext = [{ id: opts.afterId, type: 'paragraph', html: opts.afterHtml, tag: 'p', blockStyle: opts.afterBlockStyle || '' }, ...after];
                pgs.splice(pageIndex, 1,
                    newThis.length ? newThis : [emptyParagraph()],
                    newNext.length ? newNext : [emptyParagraph()]);
                pendingFocus.current = { pageIndex: pageIndex + 1, atEnd: false };
            } else if (newBlocks) {
                pgs[pageIndex] = newBlocks;
            }
            const flat = flattenPages(pgs); saveBlocks(flat); return flat;
        });
    }, [onBlocksChange, bump]);

    const handleMergeIntoPrev = useCallback((pageIndex) => {
        if (pageIndex === 0) return;
        onBlocksChange(prev => {
            const pgs = splitIntoPages(prev);
            if (pageIndex >= pgs.length) return prev;
            pgs[pageIndex - 1] = [...pgs[pageIndex - 1], ...pgs[pageIndex]];
            pgs.splice(pageIndex, 1);
            const flat = flattenPages(pgs); saveBlocks(flat); return flat;
        });
        bump();
        pendingFocus.current = { pageIndex: pageIndex - 1, atEnd: true };
    }, [onBlocksChange, bump]);

    // ── Ctrl+A select-all across pages, then Delete/Backspace clears all ──────
    const wrapRef         = useRef(null);
    const selectAllActive = useRef(false);

    useEffect(() => {
        const wrap = wrapRef.current;
        if (!wrap) return;
        const handler = (e) => {
            const mod = e.ctrlKey || e.metaKey;
            if (mod && e.key === 'a') {
                e.preventDefault(); e.stopPropagation();
                const idxs = Object.keys(pageRefs.current).map(Number).sort((a, b) => a - b);
                if (!idxs.length) return;
                const first = pageRefs.current[idxs[0]]?.current;
                const last  = pageRefs.current[idxs[idxs.length - 1]]?.current;
                if (!first || !last) return;
                const range = document.createRange();
                range.setStart(first, 0); range.setEnd(last, last.childNodes.length);
                window.getSelection().removeAllRanges();
                window.getSelection().addRange(range);
                selectAllActive.current = true;
                return;
            }
            if (e.key !== 'Backspace' && e.key !== 'Delete') { selectAllActive.current = false; return; }
            if (selectAllActive.current) {
                e.preventDefault(); e.stopPropagation();
                selectAllActive.current = false;
                const fresh = [emptyParagraph()];
                bump(); onBlocksChange(fresh); saveBlocks(fresh);
                pendingFocus.current = { pageIndex: 0, atEnd: false };
            }
        };
        wrap.addEventListener('keydown', handler, true);
        return () => wrap.removeEventListener('keydown', handler, true);
    }, [onBlocksChange, bump]);

    return (
        <div className="editor-paged-wrap" ref={wrapRef}>
            {pages.map((pageBlocks, i) => (
                <Page key={i} pageIndex={i} blocks={pageBlocks}
                    structuralVersion={structuralVersion}
                    totalPages={pageCountRef.current}
                    pageDimensions={pageDimensions} marginsPx={marginsPx} pageColor={pageColor}
                    onPageChange={handlePageChange} onOverflow={handleOverflow}
                    onMergeIntoPrev={handleMergeIntoPrev} registerRef={registerRef}
                    onBlocksChange={onBlocksChange} />
            ))}
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// Editor root
// ─────────────────────────────────────────────────────────────────────────────

const Editor = ({ setup, pageDimensions, marginsPx, onInsertImage }) => {
    useEffect(() => {
        try { localStorage.removeItem('editorContent'); } catch {}
        initEditorTabHandler();
        initMathLive();
    }, []);

    const [blocks, setBlocks] = useState(loadBlocks);
    useEffect(() => { saveBlocks(blocks); }, [blocks]);
    const setBlocksStable = useCallback(u => setBlocks(typeof u === 'function' ? u : () => u), []);

    useEffect(() => {
        const handler = (file) => insertImageFromFile(file, setBlocksStable);
        // Expose for useEditorCommands 'image' case (toolbar file-picker path)
        window.__editorInsertImage = handler;
        if (onInsertImage) onInsertImage(handler);
        return () => { if (window.__editorInsertImage === handler) delete window.__editorInsertImage; };
    }, [onInsertImage, setBlocksStable]);

    if (setup.mode === 'pageless')
        return <PagelessView blocks={blocks} onBlocksChange={setBlocks} />;

    return <PagedView blocks={blocks} onBlocksChange={setBlocksStable}
        pageDimensions={pageDimensions} marginsPx={marginsPx} pageColor={setup.pageColor} />;
};

export default Editor;