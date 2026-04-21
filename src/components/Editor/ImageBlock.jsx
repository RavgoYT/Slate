// src/components/Editor/ImageBlock.jsx
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import * as undoHistory from '../../hooks/undoHistory';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const MIN_DIM  = 24;
const HSIZ     = 10;   // handle square px
const ROT_LIFT = 32;   // px the rotate handle floats above the image top

const HANDLES = [
    { id:'nw', x:0,   y:0,   corner:true,  cursor:'nw-resize' },
    { id:'n',  x:0.5, y:0,   corner:false, cursor:'n-resize'  },
    { id:'ne', x:1,   y:0,   corner:true,  cursor:'ne-resize' },
    { id:'e',  x:1,   y:0.5, corner:false, cursor:'e-resize'  },
    { id:'se', x:1,   y:1,   corner:true,  cursor:'se-resize' },
    { id:'s',  x:0.5, y:1,   corner:false, cursor:'s-resize'  },
    { id:'sw', x:0,   y:1,   corner:true,  cursor:'sw-resize' },
    { id:'w',  x:0,   y:0.5, corner:false, cursor:'w-resize'  },
];

// ── Fullscreen viewer ─────────────────────────────────────────────────────────
const FullscreenViewer = ({ src, onClose }) => {
    const [visible, setVisible]   = useState(false);
    const [zoom, setZoom]         = useState(0.75);
    const [pan, setPan]           = useState({ x: 0, y: 0 });
    const [dragging, setDragging] = useState(false);
    const [closeHovered, setCloseHovered] = useState(false);
    const [maxZoom, setMaxZoom]   = useState(4);
    const imgRef     = useRef(null);
    const dragStart  = useRef(null);
    const zoomRef    = useRef(zoom);
    const panRef     = useRef(pan);
    const maxZoomRef = useRef(4);
    zoomRef.current    = zoom;
    panRef.current     = pan;
    maxZoomRef.current = maxZoom;

    // Once image loads, cap max zoom at whichever is smaller:
    // 400% or the zoom level where 1 image pixel = 1 screen pixel.
    // This prevents zooming into blur on low-res images while allowing
    // full detail exploration on high-res ones.
    const onImgLoad = useCallback(() => {
        if (!imgRef.current) return;
        const natural   = imgRef.current.naturalWidth;
        const displayed = imgRef.current.getBoundingClientRect().width || 1;
        // nativeZoom: factor needed to reach 1 image pixel per screen pixel
        const nativeZoom = (natural / displayed) * zoomRef.current;
        setMaxZoom(Math.min(4, Math.max(1, nativeZoom)));
    }, []);

    useEffect(() => { const t = requestAnimationFrame(() => setVisible(true)); return () => cancelAnimationFrame(t); }, []);

    // Esc closes
    useEffect(() => {
        const fn = e => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', fn, true);
        return () => document.removeEventListener('keydown', fn, true);
    }, [onClose]);

    // Lock body scroll
    useEffect(() => {
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prev; };
    }, []);

    // Scroll wheel zoom toward cursor
    useEffect(() => {
        const onWheel = (e) => {
            e.preventDefault();
            const delta   = e.deltaY < 0 ? 0.1 : -0.1;
            const oldZoom = zoomRef.current;
            const newZoom = Math.max(0.5, Math.min(maxZoomRef.current, oldZoom + delta * oldZoom));

            // Zoom toward cursor: adjust pan so point under cursor stays fixed
            const cx = e.clientX - window.innerWidth  / 2;
            const cy = e.clientY - window.innerHeight / 2;
            const scale = newZoom / oldZoom;
            setPan(p => ({
                x: cx + (p.x - cx) * scale,
                y: cy + (p.y - cy) * scale,
            }));
            setZoom(newZoom);
        };
        window.addEventListener('wheel', onWheel, { passive: false });
        return () => window.removeEventListener('wheel', onWheel);
    }, []);

    // Drag to pan
    const onMouseDown = (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        dragStart.current = { mx: e.clientX, my: e.clientY, px: panRef.current.x, py: panRef.current.y };
        setDragging(true);
    };
    useEffect(() => {
        const onMove = (e) => {
            if (!dragStart.current) return;
            setPan({
                x: dragStart.current.px + (e.clientX - dragStart.current.mx),
                y: dragStart.current.py + (e.clientY - dragStart.current.my),
            });
        };
        const onUp = () => { dragStart.current = null; setDragging(false); };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup',   onUp);
        return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    }, []);

    const resetView = () => { setZoom(0.75); setPan({ x: 0, y: 0 }); };

    const save = () => {
        const a = document.createElement('a');
        a.href = src; a.download = 'image'; a.click();
    };

    // Cursor: grabby only on the image when zoom > 100%
    const imgCursor = dragging ? 'grabbing' : (zoom > 1 ? 'grab' : 'default');

    return (
        <div
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}
            style={{
                position: 'fixed', inset: 0, zIndex: 9000,
                background: `rgba(0,0,0,${visible ? 0.88 : 0})`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'background 0.2s ease',
                cursor: 'default',
                overflow: 'hidden',
            }}
        >
            {/* Top-right controls */}
            <div
                onMouseDown={e => e.stopPropagation()}
                style={{
                    position: 'fixed', top: 14, right: 14,
                    display: 'flex', gap: 8, zIndex: 9001,
                    opacity: visible ? 1 : 0,
                    transform: visible ? 'translateY(0)' : 'translateY(-10px)',
                    transition: 'opacity 0.2s ease 0.06s, transform 0.2s ease 0.06s',
                }}>
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 2,
                    background: 'var(--island-backdrop, #1e1e2e)',
                    border: '1px solid var(--border-color, #44445a)',
                    borderRadius: 7, padding: '3px 5px',
                    boxShadow: '0 4px 18px rgba(0,0,0,0.45)',
                }}>
                    <FsvBtn title="Zoom out"  onClick={() => setZoom(z => Math.max(z - z * 0.2, 0.5))}>−</FsvBtn>
                    <FsvBtn title="Reset view" onClick={resetView}
                        style={{ minWidth: 46, fontFamily: 'monospace', fontSize: 12 }}>
                        {Math.round(zoom * 100)}%
                    </FsvBtn>
                    <FsvBtn title="Zoom in"   onClick={() => setZoom(z => Math.min(z + z * 0.2, maxZoom))}>+</FsvBtn>
                    <div className="img-tb-divider" />
                    <FsvBtn title="Save image" onClick={save}>↓</FsvBtn>
                    <FsvBtn title="Open in new tab" onClick={() => window.open(src, '_blank', 'noopener')}>↗</FsvBtn>
                </div>

                <div
                    onMouseEnter={() => setCloseHovered(true)}
                    onMouseLeave={() => setCloseHovered(false)}
                    style={{
                        background: closeHovered ? 'rgba(200,60,60,0.28)' : 'var(--island-backdrop, #1e1e2e)',
                        border: '1px solid var(--border-color, #44445a)',
                        borderRadius: 7, padding: '3px 5px',
                        boxShadow: '0 4px 18px rgba(0,0,0,0.45)',
                        transition: 'background 0.12s, color 0.12s',
                    }}
                >
                    <FsvBtn title="Close (Esc)" onClick={onClose} isClose closeHovered={closeHovered}>✕</FsvBtn>
                </div>
            </div>

            {/* Image — transformed by pan+zoom */}
            <img
                ref={imgRef}
                src={src} alt="" draggable={false}
                onLoad={onImgLoad}
                onMouseDown={zoom > 1 ? onMouseDown : undefined}
                style={{
                    maxWidth:  `${zoom * 100}vw`,
                    maxHeight: `${zoom * 100}vh`,
                    objectFit: 'contain', borderRadius: 5,
                    boxShadow: '0 12px 60px rgba(0,0,0,0.65)',
                    userSelect: 'none',
                    pointerEvents: 'auto',
                    cursor: imgCursor,
                    opacity:   visible ? 1 : 0,
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${visible ? 1 : 0.93})`,
                    transition: visible ? 'opacity 0.2s ease' : 'opacity 0.2s ease, transform 0.2s cubic-bezier(0.2,0,0.2,1)',
                }}
            />
        </div>
    );
};

// Button used inside the fullscreen viewer — matches .img-float-btn aesthetic
const FsvBtn = ({ children, onClick, title, style = {}, isClose = false, closeHovered = false }) => {
    const [hovered, setHovered] = useState(false);
    const defaultHoverBg  = 'var(--hover-bg, rgba(255,255,255,0.08))';
    return (
        <button
            title={title}
            onClick={onClick}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                background: 'transparent',
                border: 'none', borderRadius: 4,
                color: isClose && closeHovered ? '#e07070' : 'var(--text-color, #ccc)',
                fontSize: 14, width: 26, height: 26,
                cursor: 'pointer', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                padding: 0, lineHeight: 1,
                transition: 'color 0.12s',
                ...style,
            }}
        >{children}</button>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
const ImageBlock = ({
    id, src, srcFull,
    width:    initW,
    height:   initH,
    float:    initAlign = 'none',
    rotation: initRot   = 0,
    editorRef,
    onUpdate,
    onDelete,
    readOnly,
}) => {
    const [w,        setW]        = useState(initW);
    const [h,        setH]        = useState(initH);
    const [rot,      setRot]      = useState(initRot);
    const [align,    setAlign]    = useState(initAlign);
    const [selected, setSelected] = useState(false);
    const [fullscreen, setFullscreen] = useState(false);
    
    // rotating state for UI changes
    const [rotating, setRotating] = useState(false);
    const [liveAngle, setLiveAngle] = useState(initRot);

    const wrapRef = useRef(null);
    const hostRef = useRef(null);

    useEffect(() => {
        hostRef.current = wrapRef.current?.closest('.editor-image-block-host') ?? null;
    });

    // Sync from parent props
    useEffect(() => { setW(initW); setH(initH); }, [initW, initH]);
    useEffect(() => { setRot(initRot); setLiveAngle(initRot); }, [initRot]);
    useEffect(() => { setAlign(initAlign); }, [initAlign]);

    // ── Alignment → host div layout with solid footprint ─────────────────────
    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;

        // Ensure host is fully solid to prevent click-throughs
        host.style.userSelect = 'none';
        host.style.pointerEvents = 'auto';
        host.style.position = 'relative';
        
        // Prevent layout transitions from interfering with our FLIP drag animation
        if (!host.dataset.isDragging) {
            host.style.transition = 'margin 0.3s cubic-bezier(0.2, 0, 0.2, 1), float 0.3s cubic-bezier(0.2, 0, 0.2, 1)';
        }
        
        host.style.display = 'block';
        host.style.width = `${w}px`;
        host.style.height = `${h}px`; // Fixes the click-through bug! Blocks the text layer out completely.

        if (align === 'left') {
            host.style.float = 'left'; 
            host.style.margin = '4px 16px 8px 0';
            host.style.clear = 'none';
        } else if (align === 'right') {
            host.style.float = 'right'; 
            host.style.margin = '4px 0 8px 16px';
            host.style.clear = 'none';
        } else {
            host.style.float = 'none'; 
            host.style.margin = '8px auto';
            host.style.clear = 'both';
        }
    }, [align, w, h]);

    // ── z-index: lift above siblings when selected ──────────────────────────
    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        host.style.zIndex = selected ? '9999' : '';
    }, [selected]);

    // ── Undo / redo ──────────────────────────────────────────────────────────
    const snapshot = useCallback(() => ({ w, h, rot, align }), [w, h, rot, align]);

    const commit = useCallback((patch, prevSnap) => {
        if (prevSnap !== undefined) {
            const afterSnap = { ...prevSnap, ...patch, w: patch.width ?? prevSnap.w, h: patch.height ?? prevSnap.h, rot: patch.rotation ?? prevSnap.rot, align: patch.float ?? prevSnap.align };
            undoHistory.pushCustom(
                () => {
                    setW(prevSnap.w); setH(prevSnap.h);
                    setRot(prevSnap.rot); setLiveAngle(prevSnap.rot);
                    setAlign(prevSnap.align);
                    onUpdate?.({ width: prevSnap.w, height: prevSnap.h, rotation: prevSnap.rot, float: prevSnap.align });
                },
                () => {
                    setW(afterSnap.w); setH(afterSnap.h);
                    setRot(afterSnap.rot); setLiveAngle(afterSnap.rot);
                    setAlign(afterSnap.align);
                    onUpdate?.({ width: afterSnap.w, height: afterSnap.h, rotation: afterSnap.rot, float: afterSnap.align });
                },
            );
        }
        onUpdate?.(patch);
    }, [onUpdate]);

    // ── Click-outside deselect ────────────────────────────────────────────────
    useEffect(() => {
        if (!selected) return;
        const onDown = e => {
            // Deselect if clicking outside this image's wrap, toolbar, or handles.
            // Also deselect when clicking another image block.
            const inThisImage = wrapRef.current?.contains(e.target)
                || e.target.closest('.img-toolbar')
                || e.target.closest('.img-rot-handle');
            if (!inThisImage) setSelected(false);
        };
        // Use capture so we fire before the other image's mousedown selects it
        document.addEventListener('mousedown', onDown, true);
        return () => document.removeEventListener('mousedown', onDown, true);
    }, [selected]);

    // ── RESIZE ────────────────────────────────────────────────────────────────
const onHandleMouseDown = useCallback((e, hid) => {
        e.preventDefault(); e.stopPropagation();
        if (readOnly) return;
        const hDef   = HANDLES.find(h => h.id === hid);
        const snap   = snapshot();
        const startX = e.clientX, startY = e.clientY;
        const startW = w, startH = h;
        const pullE  = hid.includes('e'), pullW = hid.includes('w');
        const pullS  = hid.includes('s'), pullN = hid.includes('n');
        
        // --- Calculate Maximum Allowed Width ---
        const editor = editorRef?.current;
        const maxAvailWidth = editor ? editor.clientWidth : 3000;
        // Reserve 140px for text if floated. Use full width if centered.
        const maxW = align === 'none' ? maxAvailWidth : Math.max(MIN_DIM, maxAvailWidth - 140);

        let liveW = startW, liveH = startH;

        const onMove = me => {
            const rawDx = me.clientX - startX;
            const rawDy = me.clientY - startY;

            const rad = -rot * Math.PI / 180;
            const dx = rawDx * Math.cos(rad) - rawDy * Math.sin(rad);
            const dy = rawDx * Math.sin(rad) + rawDy * Math.cos(rad);

            const multX = align === 'none' ? 2 : 1;

            const dw = (pullE ? dx : pullW ? -dx : 0) * multX;
            const dh = pullS ? dy : pullN ? -dy : 0;

            if (hDef.corner) {
                let scale = Math.abs(dw / startW) >= Math.abs(dh / startH)
                    ? (startW + dw) / startW
                    : (startH + dh) / startH;
                
                // Prevent scaling past the calculated max width
                if (startW * scale > maxW) scale = maxW / startW;

                liveW = clamp(Math.round(startW * scale), MIN_DIM, maxW);
                liveH = clamp(Math.round(startH * scale), MIN_DIM, 3000);
            } else {
                if (pullE || pullW) liveW = clamp(Math.round(startW + dw), MIN_DIM, maxW);
                if (pullS || pullN) liveH = clamp(Math.round(startH + dh), MIN_DIM, 3000);
            }
            setW(liveW); setH(liveH);
        };
        const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup',   onUp);
            commit({ width: liveW, height: liveH }, snap);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup',   onUp);
    }, [readOnly, w, h, rot, align, snapshot, commit, editorRef]);

    // ── ROTATE ────────────────────────────────────────────────────────────────
    const rotClickCount = useRef(0);
    const rotClickTimer = useRef(null);

    const onRotMouseDown = useCallback(e => {
        if (readOnly) return;
        e.preventDefault(); e.stopPropagation();

        rotClickCount.current += 1;
        clearTimeout(rotClickTimer.current);
        if (rotClickCount.current >= 2) {
            rotClickCount.current = 0;
            const snap = snapshot();
            setRot(0);
            setLiveAngle(0);
            commit({ rotation: 0 }, snap);
            return;
        }
        rotClickTimer.current = setTimeout(() => { rotClickCount.current = 0; }, 300);

        setRotating(true);
        const snap = snapshot();
        const rect = wrapRef.current.getBoundingClientRect();
        const cx = rect.left + rect.width  / 2;
        const cy = rect.top  + rect.height / 2;
        let live = rot;

        const onMove = me => {
            const raw = Math.atan2(me.clientY - cy, me.clientX - cx) * 180 / Math.PI + 90;
            live = Math.round(((raw % 360) + 360) % 360);
            setRot(live);
            setLiveAngle(live);
        };
        const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup',   onUp);
            setRotating(false);
            commit({ rotation: live }, snap);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup',   onUp);
    }, [readOnly, rot, snapshot, commit]);

    // ── DRAG TO REORDER (FLIP Animation) ──────────────────────────────────────
    const imgClickCount = useRef(0);
    const imgClickTimer = useRef(null);

    const onImgMouseDown = useCallback(e => {
        if (readOnly || e.button !== 0) return;
        if (e.target.closest('.img-handle') || e.target.closest('.img-rot-handle') ||
            e.target.closest('.img-toolbar')) return;

        if (!selected) { e.stopPropagation(); setSelected(true); return; }

        // Double-click → fullscreen viewer
        imgClickCount.current += 1;
        clearTimeout(imgClickTimer.current);
        if (imgClickCount.current >= 2) {
            imgClickCount.current = 0;
            e.preventDefault(); e.stopPropagation();
            setFullscreen(true);
            return;
        }
        imgClickTimer.current = setTimeout(() => { imgClickCount.current = 0; }, 300);

        e.preventDefault(); e.stopPropagation();

        const host   = hostRef.current;
        const editor = editorRef?.current;
        if (!host || !editor) return;

        const siblings = [...editor.children].filter(el => el !== host);

        const indicator = document.createElement('div');
        // Removed transition from indicator so it rigidly snaps to block lines
        indicator.style.cssText = [
            'position:absolute', 'left:0', 'right:0', 'height:2px',
            'background:rgba(148,128,210,0.85)', 'pointer-events:none',
            'z-index:9998', 'border-radius:1px', 'display:none'
        ].join(';');
        editor.style.position = 'relative';
        editor.appendChild(indicator);

        let dropTarget = null;
        let hasMoved = false;
        const startY = e.clientY;

        const onMove = me => {
            let best = null, bestDist = Infinity;
            const rawY = me.clientY;

            for (const sib of siblings) {
                const r   = sib.getBoundingClientRect();
                const mid = r.top + r.height / 2;
                const d   = Math.abs(rawY - mid);
                if (d < bestDist) { bestDist = d; best = sib; }
            }

if (best) {
                const pos = rawY < best.getBoundingClientRect().top + best.getBoundingClientRect().height / 2 ? 'before' : 'after';
                dropTarget = { el: best, position: pos };
                
                // Use Math.round to snap exactly to the pixel grid, preventing blur/thickness shifts
                const targetTop = pos === 'before' ? best.offsetTop : best.offsetTop + best.offsetHeight;
                indicator.style.top = `${Math.round(targetTop)}px`;
                indicator.style.display = 'block';
            } else {
                indicator.style.display = 'none';
            }

            if (Math.abs(me.clientY - startY) > 5) hasMoved = true;
        };

        const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup',   onUp);
            indicator.remove();

            if (!hasMoved || !dropTarget) return;

            // --- FLIP Animation ---
            // 1. First: Record where it is right now
            const firstRect = host.getBoundingClientRect();

            // Move the actual DOM node
            host.dataset.isDragging = "true";
            if (dropTarget.position === 'before') {
                editor.insertBefore(host, dropTarget.el);
            } else {
                dropTarget.el.after(host);
            }

            // 2. Last: Record where it instantly snapped to
            const lastRect = host.getBoundingClientRect();
            const invertX = firstRect.left - lastRect.left;
            const invertY = firstRect.top - lastRect.top;

            // 3. Invert: Snap it visually back to the start position instantly
            host.style.transition = 'none';
            host.style.transform = `translate(${invertX}px, ${invertY}px)`;

            // 4. Play: Request animation frame so the browser registers the invert, then glide to 0,0
            requestAnimationFrame(() => {
                host.style.transition = 'transform 0.25s cubic-bezier(0.2, 0, 0, 1)';
                host.style.transform = 'translate(0px, 0px)';
                
                setTimeout(() => {
                    delete host.dataset.isDragging;
                    host.style.transition = 'margin 0.3s cubic-bezier(0.2, 0, 0.2, 1), float 0.3s cubic-bezier(0.2, 0, 0.2, 1)';
                    host.style.transform = 'none';
                }, 250);
            });

            editor.dispatchEvent(new Event('input', { bubbles: true }));
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup',   onUp);
    }, [readOnly, selected, editorRef]);

    const AlignBtn = ({ val, label, title: t }) => (
        <button
            className={`img-float-btn${align === val ? ' img-float-btn--active' : ''}`}
            title={t}
            onMouseDown={e => { e.preventDefault(); e.stopPropagation(); }}
            onClick={e => {
                e.preventDefault(); e.stopPropagation();
                const snap = snapshot();
                setAlign(val);
                commit({ float: val }, snap);
            }}
        >{label}</button>
    );

    const rotLabel = rotating ? `${liveAngle}°` : '';


    return (
        <>
        <span
            contentEditable={false}
            style={{
                display:  'inline-block',
                position: 'relative',
                overflow: 'visible',
                width:    `${w}px`,
                height:   `${h}px`,
                // No z-index here — host div owns the stacking context
            }}
        >
            <div
                ref={wrapRef}
                className="editor-image-block"
                data-image-id={id}
                style={{
                    display:         'block',
                    width:           '100%',
                    height:          '100%',
                    position:        'relative',
                    userSelect:      'none',
                    cursor:          readOnly ? 'default' : selected ? 'grab' : 'pointer',
                    outline:         selected ? '2px solid rgba(148,128,210,0.75)' : '2px solid transparent',
                    outlineOffset:   '1px',
                    borderRadius:    3,
                    transition:      'outline-color 0.12s',
                    transform:       `rotate(${rot}deg)`,
                    transformOrigin: 'center center',
                }}
                onMouseDown={onImgMouseDown}
            >
                <img
                    src={src}
                    alt=""
                    draggable={false}
                    style={{
                        display:       'block',
                        width:         '100%',
                        height:        '100%',
                        objectFit:     'fill',
                        borderRadius:  3,
                        pointerEvents: 'auto',
                        userSelect:    'none',
                    }}
                />

                {selected && !readOnly && (
                    <>
                        <div style={{
                            position:      'absolute',
                            top:           -ROT_LIFT + 9,
                            left:          'calc(50% - 1px)',
                            width:         2,
                            height:        ROT_LIFT - 9,
                            background:    'rgba(148,128,210,0.5)',
                            pointerEvents: 'none',
                            zIndex:        120,
                        }} />
                        
                        <div
                            className="img-rot-handle"
                            title="Drag to rotate  •  Double-click to reset"
                            onMouseDown={onRotMouseDown}
                            style={{
                                position:       'absolute',
                                top:            -ROT_LIFT - 9,
                                left:           '50%',
                                transform:      'translateX(-50%)',
                                minWidth:       rotating ? 36 : 18,
                                height:         18,
                                borderRadius:   9,
                                background:     'var(--island-backdrop, #1a1a2e)',
                                border:         '2px solid rgba(148,128,210,0.9)',
                                boxSizing:      'border-box',
                                cursor:         'crosshair',
                                zIndex:         121,
                                display:        'flex',
                                alignItems:     'center',
                                justifyContent: 'center',
                                fontSize:       10,
                                fontFamily:     rotating ? 'monospace' : 'inherit',
                                color:          'rgba(200,180,240,0.95)',
                                userSelect:     'none',
                                padding:        '0 6px',
                                transition:     'min-width 0.1s',
                                whiteSpace:     'nowrap',
                            }}
                        >{rotLabel}</div>
                        
                        {HANDLES.map(hDef => (
                            <div
                                key={hDef.id}
                                className="img-handle"
                                onMouseDown={e => onHandleMouseDown(e, hDef.id)}
                                style={{
                                    position:     'absolute',
                                    width:        HSIZ,
                                    height:       HSIZ,
                                    left:         `calc(${hDef.x * 100}% - ${HSIZ / 2}px)`,
                                    top:          `calc(${hDef.y * 100}% - ${HSIZ / 2}px)`,
                                    borderRadius: 2,
                                    background:   'var(--island-backdrop, #1a1a2e)',
                                    border:       '2px solid rgba(148,128,210,0.9)',
                                    boxSizing:    'border-box',
                                    cursor:       hDef.cursor,
                                    zIndex:       112,
                                }}
                            />
                        ))}
                    </>
                )}
            </div>

            {selected && !readOnly && (
                <div
                    className="img-toolbar"
                    onMouseDown={e => { e.preventDefault(); e.stopPropagation(); }}
                >
                    <AlignBtn val="left"  label="◧" title="Float left — text wraps right" />
                    <AlignBtn val="none"  label="▣" title="Center — full-width block, no text wrap" />
                    <AlignBtn val="right" label="◨" title="Float right — text wraps left" />
                    <div className="img-tb-divider" />
                    <button
                        className="img-float-btn img-float-btn--delete"
                        title="Delete image"
                        onMouseDown={e => { e.preventDefault(); e.stopPropagation(); }}
                        onClick={e => { e.preventDefault(); e.stopPropagation(); onDelete?.(); }}
                    >✕</button>
                </div>
            )}
            {/* Caret strips — inline to avoid React remounting inner components */}
            {['before', 'after'].map(side => {
                const pos = side === 'before'
                    ? { right: '100%', width: 20 }
                    : { left:  '100%', width: 20 };
                const handleKeyDown = (e) => {
                    const host   = wrapRef.current?.closest('.editor-image-block-host');
                    const editor = host?.parentElement;
                    if (!host || !editor) return;
                    if (e.key === 'Enter') {
                        e.preventDefault(); e.stopPropagation();
                        const p = document.createElement('p');
                        p.dataset.blockId = 'b' + Date.now();
                        p.innerHTML = '<br>';
                        if (side === 'before') host.before(p);
                        else                   host.after(p);
                        try {
                            const r = document.createRange();
                            r.setStart(p.firstChild || p, 0); r.collapse(true);
                            window.getSelection().removeAllRanges();
                            window.getSelection().addRange(r);
                        } catch (_) {}
                        editor.dispatchEvent(new Event('input', { bubbles: true }));
                    } else if (e.key === 'Backspace' || e.key === 'Delete') {
                        // Which strip should delete the image:
                        // left-float:   left (before) strip — it's the "before the image" position
                        // right-float:  right (after) strip — it's the "after the image" position
                        // center:       right (after) strip only — mirrors normal block backspace behavior
                        //               left strip should navigate/delete previous block, not the image
                        const shouldDelete =
                            (align === 'left'  && side === 'before') ||
                            (align === 'right' && side === 'after')  ||
                            (align === 'none'  && side === 'after');
                        if (shouldDelete) {
                            e.preventDefault(); e.stopPropagation();
                            onDelete?.();
                        }
                    }
                };
                return (
                    <div
                        key={side}
                        contentEditable
                        suppressContentEditableWarning
                        onKeyDown={handleKeyDown}
                        onMouseDown={e => e.stopPropagation()}
                        style={{
                            position:   'absolute',
                            top:        0,
                            bottom:     0,
                            ...pos,
                            zIndex:     200,
                            cursor:     'text',
                            fontSize:   `${h}px`,
                            lineHeight: `${h}px`,
                            color:      'transparent',
                            caretColor: 'var(--text-highlight-color, #9f8fd4)',
                            background: 'transparent',
                            outline:    'none',
                            border:     'none',
                            padding:    0,
                            margin:     0,
                            overflow:   'hidden',
                            userSelect: 'text',
                            whiteSpace: 'pre',
                        }}
                    >&#8203;</div>
                );
            })}
        </span>

        {/* Fullscreen viewer — portalled into body to escape all clipping/overflow */}
        {fullscreen && createPortal(
            <FullscreenViewer src={srcFull || src} onClose={() => setFullscreen(false)} />,
            document.body
        )}
        </>
    );
};

export default ImageBlock;