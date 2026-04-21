import React, { useEffect, useRef } from 'react';
import './CommandPalette.css';

const CommandPalette = ({ isOpen, onClose }) => {
    const inputRef = useRef(null);

    useEffect(() => {
        if (isOpen) {
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [isOpen]);

    useEffect(() => {
        const handleKey = (e) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [onClose]);

    if (!isOpen) return null;

    return (
        <div className="cp-overlay" onClick={onClose}>
            <div className="cp-panel" onClick={e => e.stopPropagation()}>
                <div className="cp-search-row">
                    <span className="cp-icon">⌘</span>
                    <input
                        ref={inputRef}
                        className="cp-input"
                        type="text"
                        placeholder="Type a command..."
                    />
                    <kbd className="cp-esc" onClick={onClose}>Esc</kbd>
                </div>
                <div className="cp-empty">
                    No commands yet — coming soon.
                </div>
            </div>
        </div>
    );
};

export default CommandPalette;