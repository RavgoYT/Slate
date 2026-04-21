import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import MenuItems from './MenuItems';
import './Sidebar.css';

// ── Preferences panel ──────────────────────────────────────────────────────────
const PreferencesPanel = ({ anchorRef, onZenMode, onViewMode, onPageSetup, onClose, onPanelMouseEnter, onPanelMouseLeave }) => {
    const [pos, setPos] = useState({ top: -9999, left: -9999 });
    const panelRef = useRef(null);

    const updatePos = useCallback(() => {
        if (!anchorRef.current) return;
        const rect = anchorRef.current.getBoundingClientRect();
        const MARGIN = 12; // min gap from bottom of viewport
        // Measure the actual panel height after render if possible, else estimate
        const panelEl = panelRef.current || document.querySelector('.prefs-panel');
        const panelHeight = panelEl ? panelEl.offsetHeight : 420;
        const maxTop = window.innerHeight - panelHeight - MARGIN;
        setPos({
            top:  Math.min(rect.top, Math.max(MARGIN, maxTop)),
            left: rect.right + 8,
        });
    }, [anchorRef]);

    useEffect(() => {
        updatePos();
        window.addEventListener('resize', updatePos);
        return () => window.removeEventListener('resize', updatePos);
    }, [updatePos]);

    // Hardcoded allowlist of system fonts
    const SYSTEM_FONTS_ALLOWLIST = ['Excalifont', 'Nunito'];
    const [fonts, setFonts] = useState([]);
    const [fontIdx, setFontIdx] = useState(0);

    useEffect(() => {
        const families = new Set();
        try {
            for (const sheet of document.styleSheets) {
                let rules;
                try { rules = sheet.cssRules; } catch { continue; }
                for (const rule of rules) {
                    if (rule instanceof CSSFontFaceRule) {
                        const f = rule.style.getPropertyValue('font-family').replace(/['"]/g,'').trim();
                        if (f && SYSTEM_FONTS_ALLOWLIST.includes(f)) families.add(f);
                    }
                }
            }
        } catch {}
        const loaded = [...families];
        setFonts(loaded);
        const saved = localStorage.getItem('systemFont');
        if (saved) {
            const idx = loaded.indexOf(saved);
            if (idx >= 0) setFontIdx(idx);
        }
    }, []);

    const applyFont = (idx) => {
        const font = fonts[idx];
        if (!font) return;
        setFontIdx(idx);
        localStorage.setItem('systemFont', font);
        document.body.style.fontFamily = font;
    };
    const prev = () => applyFont((fontIdx - 1 + fonts.length) % fonts.length);
    const next = () => applyFont((fontIdx + 1) % fonts.length);

    return createPortal(
        <div ref={panelRef} className="prefs-panel" style={{ top: pos.top, left: pos.left }}
            onMouseEnter={onPanelMouseEnter} onMouseLeave={onPanelMouseLeave}>
            <div className="prefs-title">Preferences</div>

            {fonts.length > 0 && (
                <div className="prefs-section">
                    <span className="prefs-label">System font</span>
                    <div className="prefs-font-cycle">
                        <button className="prefs-font-arrow" onClick={prev}>‹</button>
                        <span className="prefs-font-name" style={{ fontFamily: fonts[fontIdx] }}>
                            {fonts[fontIdx]}
                        </span>
                        <button className="prefs-font-arrow" onClick={next}>›</button>
                    </div>
                </div>
            )}

            <div className="prefs-divider" />

            <div className="prefs-section">
                <span className="prefs-label">Zen mode</span>
                <span className="prefs-desc">Hides all UI for distraction-free editing</span>
                <button className="prefs-mode-btn" onClick={() => { onZenMode(); onClose(); }}>
                    Enter Zen mode
                </button>
            </div>

            <div className="prefs-divider" />

            <div className="prefs-section">
                <span className="prefs-label">View mode</span>
                <span className="prefs-desc">Read-only canvas, hides editing tools</span>
                <button className="prefs-mode-btn" onClick={() => { onViewMode(); onClose(); }}>
                    Enter View mode
                </button>
            </div>

            <div className="prefs-divider" />

            <div className="prefs-section">
                <span className="prefs-label">Canvas settings</span>
                <span className="prefs-desc">Page size, margins, orientation</span>
                <button className="prefs-mode-btn" onClick={() => { onPageSetup(); onClose(); }}>
                    Page setup…
                </button>
            </div>
        </div>,
        document.body
    );
};

// ── Sidebar ────────────────────────────────────────────────────────────────────
const Sidebar = ({
    onCommandPalette, onFindOnCanvas, onHelp,
    onThemeChange, onCanvasChange, resetCanvasTrigger,
    onZenMode, onViewMode, onPageSetup
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [prefsOpen, setPrefsOpen] = useState(false);
    const sidebarRef = useRef();
    const prefsAnchorRef = useRef();   // ref on the Preferences menu item
    const closeTimerRef = useRef();

    const toggle = () => setIsOpen(p => !p);
    const close  = () => { setIsOpen(false); setPrefsOpen(false); };

    // Open prefs on hover with a small delay so accidental passes don't trigger
    const handlePrefsMouseEnter = () => {
        clearTimeout(closeTimerRef.current);
        setPrefsOpen(true);
    };
    const handlePrefsMouseLeave = () => {
        closeTimerRef.current = setTimeout(() => setPrefsOpen(false), 200);
    };
    const handlePanelMouseEnter = () => clearTimeout(closeTimerRef.current);
    const handlePanelMouseLeave = () => {
        closeTimerRef.current = setTimeout(() => setPrefsOpen(false), 200);
    };

    useEffect(() => () => clearTimeout(closeTimerRef.current), []);

    useEffect(() => {
        if (!isOpen) { setPrefsOpen(false); return; }
        const handler = (e) => {
            if (
                !e.target.closest('.sidebar') &&
                !e.target.closest('.hamburger') &&
                !e.target.closest('.prefs-panel')
            ) close();
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [isOpen]);

    return (
        <>
            <button className="hamburger" onClick={toggle} aria-label="Open menu">
                <span className={`hamburger-line${isOpen?' open':''}`} />
                <span className={`hamburger-line${isOpen?' open':''}`} />
                <span className={`hamburger-line${isOpen?' open':''}`} />
            </button>

            <div ref={sidebarRef} className={`sidebar${isOpen?' sidebar--open':''}`}>
                <MenuItems
                    onClose={close}
                    onCommandPalette={() => { close(); onCommandPalette(); }}
                    onFindOnCanvas={() => { close(); onFindOnCanvas(); }}
                    onHelp={() => { close(); onHelp(); }}
                    onThemeChange={onThemeChange}
                    onCanvasChange={onCanvasChange}
                    resetCanvasTrigger={resetCanvasTrigger}
                    prefsOpen={prefsOpen}
                    onTogglePrefs={() => setPrefsOpen(p => !p)}
                    prefsAnchorRef={prefsAnchorRef}
                    onPrefsMouseEnter={handlePrefsMouseEnter}
                    onPrefsMouseLeave={handlePrefsMouseLeave}
                />
            </div>

            {isOpen && prefsOpen && (
                <PreferencesPanel
                    anchorRef={prefsAnchorRef}
                    onZenMode={onZenMode}
                    onViewMode={onViewMode}
                    onPageSetup={onPageSetup}
                    onClose={close}
                    onPanelMouseEnter={handlePanelMouseEnter}
                    onPanelMouseLeave={handlePanelMouseLeave}
                />
            )}
        </>
    );
};

export default Sidebar;