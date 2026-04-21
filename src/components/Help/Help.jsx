// Help.jsx — fixed: was referencing undefined HELP_KEYS, now uses SHORTCUTS
import React, { useEffect } from 'react';
import './Help.css';

const SHORTCUTS = {
    Tools: [
        { label: 'Hand (panning tool)', keys: ['H'] },
        { label: 'Selection', keys: ['V', '1'] },
        { label: 'Rectangle', keys: ['R', '2'] },
        { label: 'Diamond', keys: ['D', '3'] },
        { label: 'Ellipse', keys: ['O', '4'] },
        { label: 'Arrow', keys: ['A', '5'] },
        { label: 'Line', keys: ['L', '6'] },
        { label: 'Draw', keys: ['P', '7'] },
        { label: 'Text', keys: ['T', '8'] },
        { label: 'Insert image', keys: ['9'] },
        { label: 'Eraser', keys: ['E', '0'] },
        { label: 'Frame tool', keys: ['F'] },
        { label: 'Laser pointer', keys: ['K'] },
    ],
    Editor: [
        { label: 'Reset the canvas', keys: ['Ctrl+Delete'] },
        { label: 'Delete', keys: ['Delete'] },
        { label: 'Cut', keys: ['Ctrl+X'] },
        { label: 'Copy', keys: ['Ctrl+C'] },
        { label: 'Paste', keys: ['Ctrl+V'] },
        { label: 'Select all', keys: ['Ctrl+A'] },
        { label: 'Undo', keys: ['Ctrl+Z'] },
        { label: 'Redo', keys: ['Ctrl+Y'] },
        { label: 'Zoom in', keys: ['Ctrl++'] },
        { label: 'Zoom out', keys: ['Ctrl+-'] },
        { label: 'Reset zoom', keys: ['Ctrl+0'] },
        { label: 'Find on canvas', keys: ['Ctrl+F'] },
        { label: 'Command palette', keys: ['Ctrl+/'] },
    ],
};

const LINKS = [
    { label: 'Documentation', icon: '📖' },
    { label: 'Read our blog', icon: '✏️' },
    { label: 'Found an issue? Submit', icon: '🐛' },
    { label: 'YouTube', icon: '▶️' },
];

const Help = ({ isOpen, onClose }) => {
    useEffect(() => {
        const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [onClose]);

    if (!isOpen) return null;

    return (
        <div className="help-overlay" onClick={onClose}>
            <div className="help-panel" onClick={e => e.stopPropagation()}>
                <div className="help-header">
                    <h2 className="help-title">Help <kbd className="help-kbd">Ctrl + Shift + ?</kbd></h2>
                    <button className="help-close" onClick={onClose}>✕</button>
                </div>

                <div className="help-links">
                    {LINKS.map(l => (
                        <button key={l.label} className="help-link-btn">
                            <span>{l.icon}</span> {l.label}
                        </button>
                    ))}
                </div>

                <h3 className="help-section-title">Keyboard shortcuts</h3>

                <div className="help-shortcuts">
                    {Object.entries(SHORTCUTS).map(([section, items]) => (
                        <div key={section} className="help-shortcuts-col">
                            <div className="help-shortcuts-heading">{section}</div>
                            {items.map(item => (
                                <div key={item.label} className="help-shortcut-row">
                                    <span className="help-shortcut-label">{item.label}</span>
                                    <span className="help-shortcut-keys">
                                        {item.keys.map((k, i) => (
                                            <React.Fragment key={k}>
                                                {i > 0 && <span className="help-or">or</span>}
                                                <kbd className="help-kbd">{k}</kbd>
                                            </React.Fragment>
                                        ))}
                                    </span>
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default Help;