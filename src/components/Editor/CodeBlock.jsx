// src/components/Editor/CodeBlock.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';

const SvgCopy = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2"/>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
);
const SvgCheck = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12"/>
    </svg>
);

const CodeBlock = ({ id, rawcode: initRawcode = '', lang: initLang = '', onUpdate, onDelete }) => {
    const [rawcode,  setRawcode]  = useState(initRawcode);
    const [lang,     setLang]     = useState(initLang);
    const [editing,  setEditing]  = useState(false);
    const [copied,   setCopied]   = useState(false);
    const [height,   setHeight]   = useState(0);

    const codeRef     = useRef(null);
    const langRef     = useRef(null);
    const preRef      = useRef(null);
    const hostRef     = useRef(null);
    const commitTimer = useRef(null);

    useEffect(() => {
        const el = codeRef.current;
        if (el) hostRef.current = el.closest('.editor-code-block-host') ?? null;
    });

    useEffect(() => { setRawcode(initRawcode); }, [initRawcode]);
    useEffect(() => { setLang(initLang); },     [initLang]);

    // Measure pre height for strips
    useEffect(() => {
        const pre = preRef.current;
        if (!pre) return;
        const measure = () => setHeight(pre.getBoundingClientRect().height);
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(pre);
        return () => ro.disconnect();
    }, []);

    // hljs in display mode
    useEffect(() => {
        if (editing) return;
        const c = codeRef.current;
        if (!c) return;
        c.textContent = rawcode;
        c.className   = `md-code-el${lang ? ` language-${lang}` : ''}`;
        c.removeAttribute('data-highlighted');
        requestAnimationFrame(() => {
            if (c.isConnected && window.__hljs) window.__hljs.highlightElement(c);
        });
    }, [rawcode, lang, editing]);

    const enterEdit = useCallback(() => {
        if (editing) return;
        setEditing(true);
        requestAnimationFrame(() => {
            const c = codeRef.current;
            if (!c) return;
            c.textContent = rawcode;
            c.removeAttribute('data-highlighted');
            c.contentEditable = 'true';
            c.spellcheck = false;
            c.focus();
            try {
                const r = document.createRange();
                r.setStart(c.firstChild ?? c, 0); r.collapse(true);
                window.getSelection().removeAllRanges(); window.getSelection().addRange(r);
            } catch (_) {}
        });
    }, [editing, rawcode]);

    const exitEdit = useCallback(() => {
        if (!editing) return;
        clearTimeout(commitTimer.current);
        const c = codeRef.current;
        const l = langRef.current;

        const readCodeText = (el) => {
            let out = '';
            const walk = (node) => {
                if (node.nodeType === 3) { out += node.textContent; return; }
                if (node.nodeName === 'BR') { out += '\n'; return; }
                if (node.nodeName === 'DIV' || node.nodeName === 'P') {
                    if (out.length && !out.endsWith('\n')) out += '\n';
                }
                for (const child of node.childNodes) walk(child);
            };
            walk(el);
            return out.replace(/\n$/, '');
        };

        const newCode = c ? readCodeText(c) : rawcode;
        const newLang = l ? (l.innerText || '').trim() : lang;

        if (c) c.contentEditable = 'false';
        if (l) { l.contentEditable = 'false'; l.textContent = newLang; }

        setRawcode(newCode);
        setLang(newLang);
        setEditing(false);

        const host = hostRef.current;
        if (host) { host.dataset.rawcode = newCode; host.dataset.lang = newLang; }
        onUpdate?.({ rawcode: newCode, lang: newLang });

        const editor = host?.parentElement;
        if (editor) editor.dispatchEvent(new Event('input', { bubbles: true }));
    }, [editing, rawcode, lang, onUpdate]);

    const scheduleExit = useCallback(() => {
        clearTimeout(commitTimer.current);
        commitTimer.current = setTimeout(exitEdit, 150);
    }, [exitEdit]);
    const cancelExit = useCallback(() => clearTimeout(commitTimer.current), []);

    const handleCopy = useCallback((e) => {
        e.stopPropagation();
        const fb = () => {
            const t = Object.assign(document.createElement('textarea'), { value: rawcode });
            document.body.append(t); t.select(); document.execCommand('copy'); t.remove();
        };
        navigator.clipboard ? navigator.clipboard.writeText(rawcode).catch(fb) : fb();
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    }, [rawcode]);

    const onCodeKeyDown = useCallback((e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); exitEdit(); return; }
        if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
            e.preventDefault(); e.stopPropagation();
            document.execCommand('insertText', false, '\n');
            return;
        }
        e.stopPropagation();
    }, [exitEdit]);

    const onLangKeyDown = useCallback((e) => {
        if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault(); e.stopPropagation();
            if (e.key === 'Enter') codeRef.current?.focus();
        }
        e.stopPropagation();
    }, []);

    const onCodePaste = useCallback((e) => {
        e.preventDefault(); e.stopPropagation();
        const text = e.clipboardData?.getData('text/plain') || '';
        if (text) document.execCommand('insertText', false, text);
    }, []);

    // Focus the right strip (after) — used when backspacing from line below
    const focusRightStrip = useCallback(() => {
        const host = hostRef.current;
        if (!host) return;
        const strip = host.querySelector('.code-strip-after');
        if (!strip) return;
        strip.focus();
        try {
            const r = document.createRange();
            r.setStart(strip.firstChild || strip, 0); r.collapse(true);
            window.getSelection().removeAllRanges(); window.getSelection().addRange(r);
        } catch (_) {}
    }, []);

    // ── Strip keydown ─────────────────────────────────────────────────
    // LEFT strip (before):
    //   Enter     → insert newline ABOVE code block (push it down)
    //   Backspace → native backspace behaviour against the block above
    //               (delete empty prev line, or last char of prev line)
    //
    // RIGHT strip (after):
    //   Enter     → insert newline BELOW code block, move caret there
    //   Backspace → delete the code block
    const stripKeyDown = useCallback((e, side) => {
        const host   = hostRef.current;
        const editor = host?.parentElement;
        if (!host || !editor) return;

        if (e.key === 'Enter') {
            e.preventDefault(); e.stopPropagation();
            const p = document.createElement('p');
            p.dataset.blockId = 'b' + Date.now();
            p.innerHTML = '<br>';
            if (side === 'before') {
                // Insert ABOVE — push code block down, caret stays above
                host.before(p);
            } else {
                // Insert BELOW — caret moves there
                host.after(p);
            }
            try {
                p.focus();
                const r = document.createRange();
                r.setStart(p.firstChild || p, 0); r.collapse(true);
                window.getSelection().removeAllRanges();
                window.getSelection().addRange(r);
            } catch (_) {}
            editor.dispatchEvent(new Event('input', { bubbles: true }));

        } else if (e.key === 'Backspace' || e.key === 'Delete') {
            if (side === 'before') {
                // Left strip backspace — act on the block ABOVE naturally.
                // Place caret at end of previous sibling and let browser handle it.
                e.preventDefault(); e.stopPropagation();
                const prev = host.previousElementSibling;
                if (!prev) return;
                // If prev is empty (just <br>), remove it
                const isEmpty = prev.innerHTML === '<br>' || prev.innerHTML === '' || prev.textContent === '';
                if (isEmpty) {
                    prev.remove();
                    editor.dispatchEvent(new Event('input', { bubbles: true }));
                } else {
                    // Move caret to end of prev block
                    try {
                        prev.focus();
                        const r = document.createRange();
                        r.selectNodeContents(prev); r.collapse(false);
                        window.getSelection().removeAllRanges();
                        window.getSelection().addRange(r);
                        // Now fire a native delete so the last char is removed
                        document.execCommand('delete');
                    } catch (_) {}
                }
            } else {
                // Right strip backspace — delete the code block
                e.preventDefault(); e.stopPropagation();
                onDelete?.();
            }
        }
    }, [onDelete]);

    return (
        <>
        <span
            contentEditable={false}
            style={{
                display:  'block',
                position: 'relative',
                overflow: 'visible',
            }}
        >
            <pre
                ref={preRef}
                className={`md-codeblock${editing ? ' md-codeblock--editing' : ''}`}
                data-md="1"
                data-block-id={id}
                data-lang={lang}
                data-rawcode={rawcode}
                style={{ margin: 0 }}
                onClick={!editing ? enterEdit : undefined}
            >
                <span
                    ref={langRef}
                    className="md-code-lang"
                    contentEditable={editing ? 'true' : 'false'}
                    suppressContentEditableWarning
                    spellCheck={false}
                    onKeyDown={editing ? onLangKeyDown : undefined}
                    onFocus={editing   ? cancelExit    : undefined}
                    onBlur={editing    ? scheduleExit  : undefined}
                    style={{ pointerEvents: editing ? 'auto' : 'none', userSelect: editing ? 'text' : 'none' }}
                >{lang}</span>

                <code
                    ref={codeRef}
                    className={`md-code-el${lang ? ` language-${lang}` : ''}`}
                    contentEditable={editing ? 'true' : 'false'}
                    suppressContentEditableWarning
                    spellCheck={false}
                    onKeyDown={editing ? onCodeKeyDown : undefined}
                    onPaste={editing   ? onCodePaste   : undefined}
                    onFocus={editing   ? cancelExit    : undefined}
                    onBlur={editing    ? scheduleExit  : undefined}
                    style={{ outline: 'none' }}
                />

                <div className="md-rawcode-store" hidden>{rawcode}</div>

                <button
                    className="md-code-copy"
                    title="Copy"
                    onMouseDown={e => e.preventDefault()}
                    onClick={handleCopy}
                >
                    {copied ? <SvgCheck /> : <SvgCopy />}
                </button>
            </pre>

            {/* Caret strips — click targets only. Single &#8203; char so caret
                always snaps to one position. Selection is locked via onSelect. */}
            {height > 0 && ['before', 'after'].map(side => (
                <div
                    key={side}
                    className={`code-strip-${side}`}
                    contentEditable
                    suppressContentEditableWarning
                    onKeyDown={e => stripKeyDown(e, side)}
                    onMouseDown={e => e.stopPropagation()}
                    onSelect={e => {
                        // Lock caret to position 0 — no wandering inside strip
                        const el = e.currentTarget;
                        try {
                            const r = document.createRange();
                            r.setStart(el.firstChild || el, 0); r.collapse(true);
                            window.getSelection().removeAllRanges();
                            window.getSelection().addRange(r);
                        } catch (_) {}
                    }}
                    style={{
                        position:   'absolute',
                        top:        0,
                        height:     height,
                        width:      40,
                        ...(side === 'before'
                            ? { right: '100%' }
                            : { left:  '100%' }),
                        zIndex:     200,
                        cursor:     'text',
                        caretColor: 'var(--text-highlight-color, #9f8fd4)',
                        color:      'transparent',
                        // background: 'rgba(255,0,0,0.4)', // debug — remove later
                        outline:    'none',
                        border:     'none',
                        padding:    0,
                        margin:     0,
                        overflow:   'hidden',
                        userSelect: 'none',
                        whiteSpace: 'pre',
                        fontSize:   height + 'px',
                        lineHeight: height + 'px',
                        // Caret sits at right edge for before-strip, left edge for after-strip
                        textAlign:  side === 'before' ? 'right' : 'left',
                    }}
                >&#8203;</div>
            ))}
        </span>
        </>
    );
};

export default CodeBlock;