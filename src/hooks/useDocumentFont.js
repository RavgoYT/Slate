// src/hooks/useDocumentFont.js
import { useState, useEffect, useCallback } from 'react';
import { getFontFamily, getRecentFonts, addRecentFont } from '../utils/fonts';

const DOCUMENT_FONT_KEY = 'documentFont';

export function useDocumentFont(contentRef) {
    const [font, setFont] = useState(() => {
        try { return localStorage.getItem(DOCUMENT_FONT_KEY) || 'Roboto'; }
        catch { return 'Roboto'; }
    });
    const [recentFonts, setRecentFonts] = useState(() => getRecentFonts());

    // Apply the base document font once on mount only.
    // We intentionally do NOT re-run this when `font` changes, because:
    //   (a) the toolbar font command applies per-selection spans,
    //   (b) re-applying the base font on every change clobbers those spans.
    // The base font is only meaningful as the initial default for new content.
    useEffect(() => {
        if (!contentRef.current) return;
        contentRef.current.style.fontFamily = getFontFamily(font);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const changeFont = useCallback((fontName) => {
        setFont(fontName);
        try {
            localStorage.setItem(DOCUMENT_FONT_KEY, fontName);
            addRecentFont(fontName);
            setRecentFonts(getRecentFonts());
        } catch (err) {
            console.error('Failed to save document font:', err);
        }
        // Apply immediately to the editor base (for new unformatted typing)
        if (contentRef.current) {
            contentRef.current.style.fontFamily = getFontFamily(fontName);
        }
    }, [contentRef]);

    return { font, changeFont, recentFonts };
}

export function getDefaultDocumentFont() {
    try { return localStorage.getItem(DOCUMENT_FONT_KEY) || 'Roboto'; }
    catch { return 'Roboto'; }
}

export function getDefaultRecentFonts() {
    return getRecentFonts();
}