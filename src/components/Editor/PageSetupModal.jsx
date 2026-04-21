import React, { useState, useEffect, useRef } from 'react';
import { PAPER_SIZES } from './usePageSetup';
import './PageSetupModal.css';

const PageSetupModal = ({ setup, onSave, onClose }) => {
    const [draft, setDraft] = useState({ ...setup, margins: { ...setup.margins } });
    const bodyShellRef = useRef(null);
    const bodyInnerRef = useRef(null);

    // Animate height when mode changes by measuring actual content height
    useEffect(() => {
        const shell = bodyShellRef.current;
        const inner = bodyInnerRef.current;
        if (!shell || !inner) return;
        // Lock to current pixel height
        const from = shell.offsetHeight;
        shell.style.height = from + 'px';
        // Read new natural height after React updates the content
        requestAnimationFrame(() => {
            const to = inner.scrollHeight;
            shell.style.transition = 'height 0.28s cubic-bezier(0.4, 0, 0.2, 1)';
            shell.style.height = to + 'px';
            const onEnd = () => {
                shell.style.height = '';
                shell.style.transition = '';
                shell.removeEventListener('transitionend', onEnd);
            };
            shell.addEventListener('transitionend', onEnd);
        });
    }, [draft.mode]);

    const patch = (key, val) => setDraft(d => ({ ...d, [key]: val }));
    const patchMargin = (side, val) => {
        const num = parseFloat(val);
        if (isNaN(num) || num < 0) return;
        setDraft(d => ({ ...d, margins: { ...d.margins, [side]: num } }));
    };

    const handleSave = () => { onSave(draft); onClose(); };

    const dims = (() => {
        const { width, height } = draft.paperSize;
        return draft.orientation === 'landscape' ? { w: height, h: width } : { w: width, h: height };
    })();

    return (
        <div className="psm-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="psm-modal">
                <h2 className="psm-title">Page setup</h2>

                {/* Mode tabs */}
                <div className="psm-tabs">
                    <button className={`psm-tab${draft.mode==='pages'?' psm-tab--active':''}`}
                        onClick={() => patch('mode','pages')}>Pages</button>
                    <button className={`psm-tab${draft.mode==='pageless'?' psm-tab--active':''}`}
                        onClick={() => patch('mode','pageless')}>Pageless</button>
                </div>

                {draft.mode === 'pages' && (
                    <div className="psm-body" key={draft.mode}>

                        {/* Orientation */}
                        <div className="psm-field">
                            <label className="psm-label">Orientation</label>
                            <div className="psm-radio-group">
                                {['portrait','landscape'].map(o => (
                                    <label key={o} className="psm-radio">
                                        <input type="radio" name="orientation"
                                            checked={draft.orientation===o}
                                            onChange={() => patch('orientation', o)} />
                                        <span className="psm-radio__dot" />
                                        <span>{o.charAt(0).toUpperCase()+o.slice(1)}</span>
                                    </label>
                                ))}
                            </div>
                        </div>

                        {/* Paper size + page color row */}
                        <div className="psm-row">
                            <div className="psm-field psm-field--grow">
                                <label className="psm-label">Paper size</label>
                                <select className="psm-select"
                                    value={draft.paperSize.label}
                                    onChange={e => patch('paperSize', PAPER_SIZES.find(p => p.label === e.target.value))}>
                                    {PAPER_SIZES.map(p => (
                                        <option key={p.label} value={p.label}>{p.label}</option>
                                    ))}
                                </select>
                                <span className="psm-dims">{dims.w} × {dims.h} px</span>
                            </div>
                            <div className="psm-field psm-field--shrink">
                                <label className="psm-label">Page color</label>
                                <div className="psm-color-wrap">
                                    <input type="color" className="psm-color-input"
                                        value={draft.pageColor}
                                        onChange={e => patch('pageColor', e.target.value)} />
                                    <span className="psm-color-preview" style={{ backgroundColor: draft.pageColor }} />
                                </div>
                            </div>
                        </div>

                        {/* Margins */}
                        <div className="psm-field">
                            <label className="psm-label">Margins (inches)</label>
                            <div className="psm-margins-grid">
                                {['top','bottom','left','right'].map(side => (
                                    <div key={side} className="psm-margin-field">
                                        <span className="psm-margin-label">{side.charAt(0).toUpperCase()+side.slice(1)}</span>
                                        <input type="number" className="psm-margin-input"
                                            min="0" max="4" step="0.25"
                                            value={draft.margins[side]}
                                            onChange={e => patchMargin(side, e.target.value)} />
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {draft.mode === 'pageless' && (
                    <div className="psm-body" key={draft.mode}>
                        <p className="psm-pageless-note">
                            Pageless mode gives you an uninterrupted writing surface with no page breaks. Content flows continuously.
                        </p>
                    </div>
                )}

                <div className="psm-footer">
                    <button className="psm-btn psm-btn--cancel" onClick={onClose}>Cancel</button>
                    <button className="psm-btn psm-btn--ok" onClick={handleSave}>OK</button>
                </div>
            </div>
        </div>
    );
};

export default PageSetupModal;