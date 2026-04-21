import React, { useState, useEffect, useCallback } from 'react';
import * as undoHistory from '../../hooks/undoHistory';
import './BottomToolbar.css';

const MIN_ZOOM = 25;
const MAX_ZOOM = 300;
const STEP     = 10;

function applyZoom(zoom) {
    const target = document.querySelector('.editor-zoom-wrap');
    if (!target) return;
    const scale = zoom / 100;
    target.style.transform = `scale(${scale})`;
    const inner = target.firstElementChild;
    if (inner) {
        const naturalH = inner.scrollHeight || inner.offsetHeight;
        target.style.height = naturalH ? `${naturalH * scale}px` : '';
    }
    try { localStorage.setItem('editorZoom', String(zoom)); } catch {}
}

function useUndoRedoState() {
    const [s, setS] = useState(() => undoHistory.state());
    useEffect(() => undoHistory.subscribe(() => setS(undoHistory.state())), []);
    return s;
}

const BottomToolbar = () => {
    const [zoom, setZoom] = useState(() => {
        try { return Number(localStorage.getItem('editorZoom')) || 100; } catch { return 100; }
    });

    const { canUndo, canRedo } = useUndoRedoState();

    // Apply zoom whenever it changes
    useEffect(() => { applyZoom(zoom); }, [zoom]);

    // Re-apply on resize (inner content height may have changed)
    useEffect(() => {
        const onResize = () => applyZoom(zoom);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [zoom]);

    // Intercept Ctrl++/Ctrl−/Ctrl+0 before the browser handles them
    useEffect(() => {
        const onKeyDown = (e) => {
            const mod = e.ctrlKey || e.metaKey;
            if (!mod) return;
            if (e.key === '=' || e.key === '+') {
                e.preventDefault();
                setZoom(p => Math.min(p + STEP, MAX_ZOOM));
            } else if (e.key === '-') {
                e.preventDefault();
                setZoom(p => Math.max(p - STEP, MIN_ZOOM));
            } else if (e.key === '0') {
                e.preventDefault();
                setZoom(100);
            }
        };
        window.addEventListener('keydown', onKeyDown, { capture: true });
        return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
    }, []);

    const undo = useCallback(() => undoHistory.undo(), []);
    const redo = useCallback(() => undoHistory.redo(), []);

    return (
        <div className="bottom-toolbar">
            {/* Zoom */}
            <div className="toolbar-group">
                <button className="toolbar-btn" onClick={() => setZoom(p => Math.max(p - STEP, MIN_ZOOM))}
                    title="Zoom out (Ctrl+−)" disabled={zoom <= MIN_ZOOM}>−</button>
                <button className="toolbar-btn zoom-label" onClick={() => setZoom(100)}
                    title="Reset zoom (Ctrl+0)">{zoom}%</button>
                <button className="toolbar-btn" onClick={() => setZoom(p => Math.min(p + STEP, MAX_ZOOM))}
                    title="Zoom in (Ctrl++)" disabled={zoom >= MAX_ZOOM}>+</button>
            </div>

            {/* Undo / Redo */}
            <div className="toolbar-group">
                <button className="toolbar-btn" onClick={undo}
                    title="Undo (Ctrl+Z)" disabled={!canUndo}>↩</button>
                <button className="toolbar-btn" onClick={redo}
                    title="Redo (Ctrl+Y)" disabled={!canRedo}>↪</button>
            </div>
        </div>
    );
};

export default BottomToolbar;