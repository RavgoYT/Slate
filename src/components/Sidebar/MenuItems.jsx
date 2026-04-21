import React, { useState, useEffect } from 'react';

const MenuItem = ({ icon, label, shortcut, onClick, highlight, hasSubmenu, submenuOpen, itemRef, onMouseEnter, onMouseLeave }) => (
    <button ref={itemRef} className={`menu-item${highlight?' highlight':''}${submenuOpen?' menu-item--active':''}`} onClick={onClick} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
        <span className="menu-item__icon">{icon}</span>
        <span className="menu-item__label">{label}</span>
        {shortcut && <span className="menu-item__shortcut">{shortcut}</span>}
        {hasSubmenu && <span className="menu-item__arrow">›</span>}
    </button>
);

const ThemeSwitcher = ({ onThemeChange }) => {
    const [theme, setTheme] = useState('dark');
    useEffect(() => {
        const stored = localStorage.getItem('theme') || 'dark';
        setTheme(stored);
        applyTheme(stored);
    }, []);
    const applyTheme = (t) => {
        if (t === 'system') {
            const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
        } else {
            document.documentElement.setAttribute('data-theme', t);
        }
        localStorage.setItem('theme', t);
        onThemeChange?.(t);
    };
    const apply = (t) => { setTheme(t); applyTheme(t); };
    useEffect(() => {
        if (theme !== 'system') return;
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const h = () => applyTheme('system');
        mq.addEventListener('change', h);
        return () => mq.removeEventListener('change', h);
    }, [theme]);
    return (
        <div className="theme-switcher">
            <span className="menu-section-label">Theme</span>
            <div className="theme-switcher__buttons">
                <button className={`theme-btn${theme==='light'?' active':''}`} onClick={() => apply('light')} title="Light">☀️</button>
                <button className={`theme-btn${theme==='dark'?' active':''}`} onClick={() => apply('dark')} title="Dark">🌙</button>
                <button className={`theme-btn${theme==='system'?' active':''}`} onClick={() => apply('system')} title="System">🖥️</button>
            </div>
        </div>
    );
};

const CANVAS_COLORS = [
    { label: 'Canvas 1', cssVar: '--canvas-bg-1' },
    { label: 'Canvas 2', cssVar: '--canvas-bg-2' },
    { label: 'Canvas 3', cssVar: '--canvas-bg-3' },
    { label: 'Canvas 4', cssVar: '--canvas-bg-4' },
    { label: 'Canvas 5', cssVar: '--canvas-bg-5' },
];
const CanvasBackground = ({ onCanvasChange, resetTrigger }) => {
    const [selected, setSelected] = useState('--canvas-bg-1');
    const [colorMap, setColorMap] = useState({});
    const updateColors = () => {
        const styles = getComputedStyle(document.documentElement);
        const m = {};
        CANVAS_COLORS.forEach(({ cssVar }) => { m[cssVar] = styles.getPropertyValue(cssVar).trim(); });
        setColorMap(m);
    };
    useEffect(() => {
        updateColors();
        const obs = new MutationObserver(updateColors);
        obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        return () => obs.disconnect();
    }, []);
    useEffect(() => { setSelected('--canvas-bg-1'); onCanvasChange?.('--canvas-bg-1'); }, [resetTrigger]);
    return (
        <div className="canvas-bg">
            <span className="menu-section-label">Canvas background</span>
            <div className="canvas-bg__swatches">
                {CANVAS_COLORS.map(({ label, cssVar }) => (
                    <button key={cssVar}
                        className={`swatch${selected===cssVar?' active':''}`}
                        style={{ backgroundColor: colorMap[cssVar] || '#000' }}
                        onClick={() => { setSelected(cssVar); onCanvasChange?.(cssVar); }}
                        title={label} />
                ))}
            </div>
        </div>
    );
};

const MenuItems = ({
    onClose, onCommandPalette, onFindOnCanvas, onHelp,
    onThemeChange, onCanvasChange, resetCanvasTrigger,
    prefsOpen, onTogglePrefs, prefsAnchorRef, onPrefsMouseEnter, onPrefsMouseLeave
}) => (
    <nav className="menu-items">
        <MenuItem icon="📂" label="Open" shortcut="Ctrl+O" onClick={onClose} />
        <MenuItem icon="💾" label="Save to..." onClick={onClose} />
        <MenuItem icon="📤" label="Export" onClick={onClose} />
        <MenuItem icon="⌘" label="Command palette" shortcut="Ctrl+/" onClick={onCommandPalette} />
        <MenuItem icon="🔍" label="Find on canvas" shortcut="Ctrl+F" onClick={onFindOnCanvas} />

        <div className="menu-divider" />

        <MenuItem icon="✨" label="Scratchpad+" highlight onClick={onClose} />
        <MenuItem icon="🐙" label="GitHub" onClick={() => { window.open('https://github.com','_blank'); onClose(); }} />
        <MenuItem icon="𝕏"  label="Follow us" onClick={onClose} />
        <MenuItem icon="💬" label="Discord chat" onClick={onClose} />
        <MenuItem icon="🔑" label="Sign up" highlight onClick={onClose} />

        <div className="menu-divider" />

        <MenuItem icon="⚙️" label="Preferences"
            hasSubmenu submenuOpen={prefsOpen}
            onClick={onTogglePrefs}
            itemRef={prefsAnchorRef}
            onMouseEnter={onPrefsMouseEnter}
            onMouseLeave={onPrefsMouseLeave} />
        <MenuItem icon="❓" label="Help" shortcut="?" onClick={() => { onClose(); onHelp(); }} />
        <MenuItem icon="🗑️" label="Reset the canvas" onClick={onClose} />

        <div className="menu-divider" />

        <ThemeSwitcher onThemeChange={onThemeChange} />
        <CanvasBackground onCanvasChange={onCanvasChange} resetTrigger={resetCanvasTrigger} />
    </nav>
);

export default MenuItems;