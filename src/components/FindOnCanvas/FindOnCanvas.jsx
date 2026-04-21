import React, { useEffect, useRef } from 'react';
import './FindOnCanvas.css';

const FindOnCanvas = ({ isOpen, onClose }) => {
    const inputRef = useRef(null);

    useEffect(() => {
        if (isOpen) setTimeout(() => inputRef.current?.focus(), 50);
    }, [isOpen]);

    useEffect(() => {
        const handleKey = (e) => {
            if (e.key === 'Escape') onClose();
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                e.preventDefault();
                // already open, do nothing
            }
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [onClose]);

    if (!isOpen) return null;

    return (
        <div className="foc-overlay" onClick={onClose}>
            <div className="foc-panel" onClick={e => e.stopPropagation()}>
                <div className="foc-header">Find on canvas</div>
                <div className="foc-search-row">
                    <span className="foc-icon">🔍</span>
                    <input
                        ref={inputRef}
                        className="foc-input"
                        type="text"
                        placeholder="Search elements..."
                    />
                    <kbd className="foc-esc" onClick={onClose}>Esc</kbd>
                </div>
                <div className="foc-empty">
                    No results — start typing to search.
                </div>
            </div>
        </div>
    );
};

export default FindOnCanvas;