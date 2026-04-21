// EmojiPicker.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
    loadEmojiData,
    searchEmoji,
    getEmojisByCategory,
    getFrequentEmojis,
    addRecentEmoji,
    twemojiUrl,
    CATEGORY_META,
} from '../../hooks/useEmoji';
import './EmojiPicker.css';

// ── EmojiImg: lazy-loaded twemoji image ───────────────────────────────────────
const EmojiImg = ({ unified, native, size = 22, className = '' }) => (
    <img
        src={twemojiUrl(unified)}
        alt={native}
        width={size}
        height={size}
        className={className}
        draggable={false}
        loading="lazy"
        decoding="async"
        onError={e => { e.target.style.display = 'none'; }}
    />
);

// ── Main EmojiPicker ──────────────────────────────────────────────────────────
const EmojiPicker = ({ anchorRef, onInsert, onClose }) => {
    const [loaded,      setLoaded]    = useState(false);
    const [query,       setQuery]     = useState('');
    const [activecat,   setActiveCat] = useState('frequent');
    const [hoveredEmoji,setHovered]   = useState(null);
    const [emojis,      setEmojis]    = useState([]);
    const [pos,         setPos]       = useState({ top: 0, left: 0 });

    const searchRef   = useRef(null);
    const gridWrapRef = useRef(null);
    const panelRef    = useRef(null);

    // ── Position below anchor ─────────────────────────────────────────────────
    const calcPos = useCallback(() => {
        if (!anchorRef?.current) return;
        const rect = anchorRef.current.getBoundingClientRect();
        const pickerW = 400;
        // Max height = viewport minus some margin
        const maxH = Math.min(480, window.innerHeight - rect.bottom - 16);
        let left = rect.left - pickerW / 2 + rect.width / 2;
        let top  = rect.bottom + 6;
        left = Math.max(8, Math.min(left, window.innerWidth - pickerW - 8));
        // Flip up if not enough space below (need at least 300px)
        if (maxH < 300) top = rect.top - 480 - 6;
        setPos({ top, left, pickerW, maxH: maxH < 300 ? 480 : maxH });
    }, [anchorRef]);

    useEffect(() => {
        calcPos();
        window.addEventListener('resize', calcPos);
        return () => window.removeEventListener('resize', calcPos);
    }, [calcPos]);

    // ── Load emoji data ───────────────────────────────────────────────────────
    useEffect(() => {
        loadEmojiData().then(() => {
            setLoaded(true);
            const frequent = getFrequentEmojis();
            setEmojis(frequent.length ? frequent : getEmojisByCategory('people'));
        });
    }, []);

    // ── Close on outside click ────────────────────────────────────────────────
    useEffect(() => {
        const handler = (e) => {
            if (panelRef.current && !panelRef.current.contains(e.target) &&
                !anchorRef?.current?.contains(e.target)) {
                onClose();
            }
        };
        const t = setTimeout(() => document.addEventListener('mousedown', handler), 50);
        return () => { clearTimeout(t); document.removeEventListener('mousedown', handler); };
    }, [onClose, anchorRef]);

    // ── Keyboard: Escape closes ───────────────────────────────────────────────
    useEffect(() => {
        const handler = (e) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [onClose]);

    // ── Focus search on open ──────────────────────────────────────────────────
    useEffect(() => {
        if (loaded) setTimeout(() => searchRef.current?.focus(), 60);
    }, [loaded]);

    // ── Search / category change ──────────────────────────────────────────────
    useEffect(() => {
        if (!loaded) return;
        if (query.trim()) {
            setEmojis(searchEmoji(query));
        } else {
            setEmojis(getEmojisByCategory(activecat));
        }
    }, [query, activecat, loaded]);

    const handleCatClick = (catId) => {
        setQuery('');
        setActiveCat(catId);
        gridWrapRef.current?.scrollTo({ top: 0 });
    };

    const handleInsert = useCallback((emoji) => {
        addRecentEmoji(emoji.id);
        onInsert(emoji);
    }, [onInsert]);

    // ── Render ────────────────────────────────────────────────────────────────
    const pickerW = pos.pickerW || 400;
    const maxH    = pos.maxH    || 480;
    // Body height = maxH minus search (~52px) minus footer (~36px)
    const bodyH   = Math.max(200, maxH - 52 - 36 - 2);

    const picker = (
        <div
            ref={panelRef}
            className="emoji-picker"
            style={{ top: pos.top, left: pos.left, width: pickerW }}
            onMouseDown={e => e.preventDefault()}
        >
            {/* Search */}
            <div className="emoji-picker__search-wrap">
                <div className="emoji-picker__search-row">
                    <span className="emoji-picker__search-icon">🔍</span>
                    <input
                        ref={searchRef}
                        className="emoji-picker__search"
                        placeholder="Find the perfect emoji…"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        spellCheck={false}
                    />
                </div>
            </div>

            {/* Body */}
            <div className="emoji-picker__body" style={{ height: bodyH }}>
                {/* Sidebar */}
                <div className="emoji-picker__sidebar">
                    {CATEGORY_META.map(cat => (
                        <button
                            key={cat.id}
                            className={`emoji-picker__cat-btn${activecat === cat.id && !query ? ' emoji-picker__cat-btn--active' : ''}`}
                            title={cat.label}
                            onClick={() => handleCatClick(cat.id)}
                        >
                            {cat.icon}
                        </button>
                    ))}
                </div>

                {/* Grid */}
                <div className="emoji-picker__grid-wrap" ref={gridWrapRef}>
                    {!loaded ? (
                        <div className="emoji-picker__loading">
                            <div className="emoji-picker__spinner" />
                            Loading emojis…
                        </div>
                    ) : emojis.length === 0 ? (
                        <div className="emoji-picker__empty">
                            <div className="emoji-picker__empty-icon">🔍</div>
                            No emojis found for "{query}"
                        </div>
                    ) : (
                        <>
                            <div className="emoji-picker__section-label">
                                {query ? 'Search results' : (CATEGORY_META.find(c => c.id === activecat)?.label || '')}
                            </div>
                            <div className="emoji-picker__grid">
                                {emojis.map(emoji => (
                                    <button
                                        key={emoji.id}
                                        className="emoji-picker__emoji-btn"
                                        onClick={() => handleInsert(emoji)}
                                        onMouseEnter={e => setHovered(emoji)}
                                        onMouseLeave={() => setHovered(null)}
                                    >
                                        <EmojiImg unified={emoji.unified} native={emoji.native} size={24} />
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Footer tooltip */}
            <div className="emoji-picker__footer">
                {hoveredEmoji ? (
                    <>
                        <EmojiImg
                            unified={hoveredEmoji.unified}
                            native={hoveredEmoji.native}
                            size={20}
                            className="emoji-picker__footer-emoji"
                        />
                        <span className="emoji-picker__footer-name">
                            <span>:{hoveredEmoji.id}:</span>
                            {' '}— Click to apply
                        </span>
                    </>
                ) : (
                    <span className="emoji-picker__footer-hint">
                        Hover an emoji to preview
                    </span>
                )}
            </div>

        </div>
    );

    return createPortal(picker, document.body);
};

export default EmojiPicker;


// ── Inline autocomplete popup ─────────────────────────────────────────────────
export const EmojiAutocomplete = ({ results, activeIndex, onSelect, onClose, anchorRect, query }) => {
    const listRef = useRef(null);

    // Scroll active item into view
    useEffect(() => {
        if (!listRef.current) return;
        const active = listRef.current.querySelector('.emoji-autocomplete__item--active');
        active?.scrollIntoView({ block: 'nearest' });
    }, [activeIndex]);

    if (!results.length) return null;

    const POPUP_W = 300;
    let left = (anchorRect?.left ?? 0);
    let top  = (anchorRect?.top ?? 0) - 8;

    left = Math.max(8, Math.min(left, window.innerWidth - POPUP_W - 8));

    return createPortal(
        <div
            className="emoji-autocomplete"
            style={{ top, left, width: POPUP_W, transform: 'translateY(-100%)' }}
            onMouseDown={e => e.preventDefault()}
        >
            <div className="emoji-autocomplete__header">
                Emoji matching <span className="emoji-autocomplete__query">:{query || ''}:</span>
            </div>
            <div className="emoji-autocomplete__list" ref={listRef}>
                {results.map((emoji, i) => (
                    <button
                        key={emoji.id}
                        className={`emoji-autocomplete__item${i === activeIndex ? ' emoji-autocomplete__item--active' : ''}`}
                        onClick={() => onSelect(emoji)}
                    >
                        <img
                            src={twemojiUrl(emoji.unified)}
                            alt={emoji.native}
                            width={22}
                            height={22}
                            className="emoji-ac-img"
                            loading="lazy"
                        />
                        <span className="emoji-autocomplete__item-name">:{emoji.id}:</span>
                    </button>
                ))}
            </div>
        </div>,
        document.body
    );
};