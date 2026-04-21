// useEditorPersistence.js

import { useEffect, useCallback } from 'react';

const EDITOR_CONTENT_KEY = 'editorContent';
const SAVE_INTERVAL = 2000; // Auto-save every 2 seconds

export function useEditorPersistence(contentRef) {
    // Load content on mount
    useEffect(() => {
        if (!contentRef.current) return;
        try {
            const saved = localStorage.getItem(EDITOR_CONTENT_KEY);
            if (saved) {
                contentRef.current.innerHTML = saved;
            }
        } catch (err) {
            console.error('Failed to load editor content:', err);
        }
    }, []);

    // Auto-save content periodically
    useEffect(() => {
        if (!contentRef.current) return;
        const interval = setInterval(() => {
            try {
                localStorage.setItem(EDITOR_CONTENT_KEY, contentRef.current.innerHTML);
            } catch (err) {
                console.error('Failed to save editor content:', err);
            }
        }, SAVE_INTERVAL);
        return () => clearInterval(interval);
    }, []);

    // Manual save function
    const saveContent = useCallback(() => {
        if (!contentRef.current) return;
        try {
            localStorage.setItem(EDITOR_CONTENT_KEY, contentRef.current.innerHTML);
        } catch (err) {
            console.error('Failed to save editor content:', err);
        }
    }, []);

    return { saveContent };
}

export function clearEditorContent() {
    localStorage.removeItem(EDITOR_CONTENT_KEY);
}
