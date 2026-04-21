// components/DocumentScrollbar/DocumentScrollbar.jsx

import React, { useEffect, useRef, useState, useCallback } from 'react';
import './DocumentScrollbar.css';

function collectHeadings(root) {
    if (!root) return [];
    return Array.from(root.querySelectorAll('h1, h2, h3, h4'));
}
function getLevel(el) {
    switch (el.tagName?.toUpperCase()) {
        case 'H1': return 1; case 'H2': return 2; case 'H3': return 3; default: return 4;
    }
}
function getLabel(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.md-marker').forEach(n => n.remove());
    return (clone.textContent || '').trim().slice(0, 52);
}
function getOffsetFromScroller(el, scroller) {
    let top = 0, cur = el;
    while (cur && cur !== scroller) { top += cur.offsetTop || 0; cur = cur.offsetParent; }
    return top;
}

const TICK_WIDTH  = { 1: 18, 2: 12, 3: 8, 4: 5 };
const TICK_HEIGHT = { 1: 2,  2: 1.5, 3: 1.5, 4: 1 };
const PILL_HEIGHT_APPROX = 28; // px per item, used to clamp pill near edges

const DocumentScrollbar = ({ rightOffset = 130 }) => {
    const trackRef        = useRef(null);
    const thumbRef        = useRef(null);
    const isDragging      = useRef(false);
    const dragStartY      = useRef(0);
    const dragStartScroll = useRef(0);

    const [markers, setMarkers]       = useState([]);
    const [thumbStyle, setThumbStyle] = useState({ top: '0%', height: '10%' });
    const [hoveredIdx, setHoveredIdx] = useState(null);
    const [isDrag, setIsDrag]         = useState(false);
    const [visible, setVisible]       = useState(false);

    const getScroller = useCallback(() => document.querySelector('.App'), []);
    const getContent  = useCallback(() =>
        document.querySelector('.editor-pageless')   ||
        document.querySelector('.editor-paged-wrap') ||
        document.querySelector('.editor-zoom-wrap'), []);

    const updateThumb = useCallback(() => {
        const s = getScroller();
        if (!s) return;
        const { scrollTop, scrollHeight, clientHeight } = s;
        if (scrollHeight <= clientHeight + 2) { setVisible(false); return; }
        setVisible(true);
        const ratio    = clientHeight / scrollHeight;
        const thumbH   = Math.max(ratio * 100, 3);
        const progress = scrollTop / (scrollHeight - clientHeight);
        setThumbStyle({ top: `${(100 - thumbH) * progress}%`, height: `${thumbH}%` });
    }, [getScroller]);

    const updateMarkers = useCallback(() => {
        const s = getScroller(), c = getContent();
        if (!s || !c) return;
        const scrollH = s.scrollHeight;
        if (!scrollH) return;
        setMarkers(collectHeadings(c).map(el => ({
            pct:   Math.min((getOffsetFromScroller(el, s) / scrollH) * 100, 99.5),
            label: getLabel(el),
            level: getLevel(el),
            el,
        })));
    }, [getScroller, getContent]);

    useEffect(() => {
        const s = getScroller();
        if (!s) return;
        const onScroll = () => updateThumb();
        s.addEventListener('scroll', onScroll, { passive: true });
        updateThumb(); updateMarkers();
        const content = getContent();
        let mo = null;
        if (content) {
            mo = new MutationObserver(() => { updateMarkers(); updateThumb(); });
            mo.observe(content, { childList: true, subtree: true, characterData: true,
                attributes: true, attributeFilter: ['class', 'data-md-committed', 'data-md-src'] });
        }
        const ro = new ResizeObserver(() => { updateThumb(); updateMarkers(); });
        ro.observe(s);
        return () => { s.removeEventListener('scroll', onScroll); mo?.disconnect(); ro.disconnect(); };
    }, [getScroller, getContent, updateThumb, updateMarkers]);

    const onThumbMouseDown = useCallback((e) => {
        e.preventDefault();
        isDragging.current      = true;
        dragStartY.current      = e.clientY;
        dragStartScroll.current = getScroller()?.scrollTop ?? 0;
        document.body.style.userSelect = 'none';
        setIsDrag(true);
    }, [getScroller]);

    useEffect(() => {
        const onMove = (e) => {
            if (!isDragging.current) return;
            const s = getScroller(), track = trackRef.current;
            if (!s || !track) return;
            const { scrollHeight, clientHeight } = s;
            s.scrollTop = Math.max(0, Math.min(
                dragStartScroll.current + (e.clientY - dragStartY.current) / track.clientHeight * scrollHeight,
                scrollHeight - clientHeight
            ));
        };
        const onUp = () => { isDragging.current = false; document.body.style.userSelect = ''; setIsDrag(false); };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    }, [getScroller]);

    const onTrackClick = useCallback((e) => {
        if (thumbRef.current?.contains(e.target)) return;
        const s = getScroller(), track = trackRef.current;
        if (!s || !track) return;
        const rect = track.getBoundingClientRect();
        const { scrollHeight, clientHeight } = s;
        s.scrollTo({ top: ((e.clientY - rect.top) / rect.height) * (scrollHeight - clientHeight), behavior: 'smooth' });
    }, [getScroller]);

    const jumpTo = useCallback((marker) => {
        const s = getScroller();
        if (!s || !marker.el?.isConnected) return;
        s.scrollTo({ top: Math.max(0, getOffsetFromScroller(marker.el, s) - 48), behavior: 'smooth' });
    }, [getScroller]);

    if (!visible) return null;

    // ── Pill position: anchored to the hovered marker's pct ──────────────────
    // We clamp so the pill doesn't overflow the track bounds.
    // The pill is ~(markers.length * PILL_HEIGHT_APPROX + 20)px tall.
    const pillItems     = markers.length;
    const trackPx       = Math.min(Math.max(window.innerHeight * 0.55, 96), 580);
    const pillEstPx     = pillItems * PILL_HEIGHT_APPROX + 20;
    const hovM          = hoveredIdx !== null ? markers[hoveredIdx] : null;
    const anchorPct     = hovM ? hovM.pct : 50;
    // Convert anchorPct → px within track, then offset up by half pill height
    const anchorPx      = (anchorPct / 100) * trackPx;
    const pillTopPx     = Math.max(0, Math.min(anchorPx - pillEstPx / 2, trackPx - pillEstPx));
    const pillTopStyle  = pillItems > 0 ? { top: `${pillTopPx}px` } : { top: '50%', transform: 'translateY(-50%)' };

    return (
        <div className="doc-scrollbar" style={{ right: rightOffset }} aria-hidden="true">

            {/* ── Big outline pill ──────────────────────────────────────────── */}
            <div
                className={`doc-scrollbar__outline${hoveredIdx !== null ? ' is-open' : ''}`}
                style={pillTopStyle}
            >
                {markers.map((m, i) => (
                    <button
                        key={i}
                        className={`doc-scrollbar__outline-item doc-scrollbar__outline-item--h${m.level}${i === hoveredIdx ? ' is-active' : ''}`}
                        onClick={e => { e.stopPropagation(); jumpTo(m); }}
                        onMouseEnter={() => setHoveredIdx(i)}
                        onMouseLeave={() => setHoveredIdx(null)}
                        tabIndex={-1}
                        aria-label={`Jump to: ${m.label}`}
                    >
                        {m.label}
                    </button>
                ))}
            </div>

            {/* ── Dash markers ─────────────────────────────────────────────── */}
            {markers.map((m, i) => (
                <button
                    key={i}
                    className={`doc-scrollbar__marker doc-scrollbar__marker--h${m.level}${i === hoveredIdx ? ' is-hovered' : ''}`}
                    style={{ top: `calc(${m.pct}% - 1px)` }}
                    onClick={e => { e.stopPropagation(); jumpTo(m); }}
                    onMouseEnter={() => setHoveredIdx(i)}
                    onMouseLeave={() => setHoveredIdx(null)}
                    tabIndex={-1}
                    aria-label={`Jump to: ${m.label}`}
                >
                    <span
                        className="doc-scrollbar__marker-line"
                        style={{ '--tick-w': `${TICK_WIDTH[m.level]}px`, '--tick-h': `${TICK_HEIGHT[m.level]}px` }}
                    />
                </button>
            ))}

            {/* ── Track ────────────────────────────────────────────────────── */}
            <div
                ref={trackRef}
                className={`doc-scrollbar__track${isDrag ? ' is-dragging' : ''}`}
                onClick={onTrackClick}
            >
                <div
                    ref={thumbRef}
                    className={`doc-scrollbar__thumb${isDrag ? ' is-dragging' : ''}`}
                    style={thumbStyle}
                    onMouseDown={onThumbMouseDown}
                />
            </div>

        </div>
    );
};

export default DocumentScrollbar;