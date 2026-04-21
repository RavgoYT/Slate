// App.jsx
import DocumentScrollbar from './components/DocumentScrollbar/DocumentScrollbar';
import React, { useState, useEffect } from 'react';
import './styles/App.css';

import Toolbar from './components/Toolbar/Toolbar';
import './components/Toolbar/Toolbar.css';

import Sidebar from './components/Sidebar/Sidebar';
import './components/Sidebar/Sidebar.css';

import CommandPalette from './components/CommandPalette/CommandPalette';
import FindOnCanvas from './components/FindOnCanvas/FindOnCanvas';
import BottomToolbar from './components/BottomToolbar/BottomToolbar';
import Help from './components/Help/Help';
import './components/Help/Help.css';

import Editor from './components/Editor/Editor';
import './components/Editor/Editor.css';
import PageSetupModal from './components/Editor/PageSetupModal';
import './components/Editor/PageSetupModal.css';
import { usePageSetup } from './components/Editor/usePageSetup';

import { useEditorCommands, readSelectionState } from './hooks/useEditorCommands';

const App = () => {
    const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
    const [findOnCanvasOpen, setFindOnCanvasOpen]     = useState(false);
    const [helpOpen, setHelpOpen]                     = useState(false);
    const [pageSetupOpen, setPageSetupOpen]           = useState(false);
    const [selectedCanvasVar, setSelectedCanvasVar]   = useState('--canvas-bg-1');
    const [resetCanvasTrigger, setResetCanvasTrigger] = useState(0);
    const [canvasColor, setCanvasColor]               = useState('');
    const [zenMode, setZenMode]                       = useState(false);
    const [viewMode, setViewMode]                     = useState(false);
    const [selectionState, setSelectionState]         = useState(null);

    const { setup, updateSetup, pageDimensions, marginsPx, marginsCss } = usePageSetup();
    const { handleCommand } = useEditorCommands();

    useEffect(() => {
        const handleKey = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === '/') {
                e.preventDefault();
                setCommandPaletteOpen(p => !p);
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                e.preventDefault();
                setFindOnCanvasOpen(p => !p);
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
                // Only trigger if the focus is inside the editor, not a toolbar button
                const active = document.activeElement;
                const inEditor = active?.closest?.('.editor-content') || active?.closest?.('.editor-pageless') || active?.tagName === 'MATH-FIELD';
                if (inEditor) {
                    e.preventDefault();
                    handleCommand({ type: 'math' });
                }
            }
            if (e.key === '?' && e.ctrlKey && !e.metaKey) setHelpOpen(p => !p);
            if (e.key === 'Escape') {
                if (zenMode) setZenMode(false);
                if (viewMode) setViewMode(false);
            }
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [zenMode, viewMode]);

    useEffect(() => {
        const updateColor = () => {
            const styles = getComputedStyle(document.documentElement);
            setCanvasColor(styles.getPropertyValue(selectedCanvasVar).trim());
        };
        updateColor();
        const obs = new MutationObserver(updateColor);
        obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        return () => obs.disconnect();
    }, [selectedCanvasVar]);

    useEffect(() => {
        const onSelectionChange = () => {
            const state = readSelectionState();
            if (state) setSelectionState(state);
        };
        document.addEventListener('selectionchange', onSelectionChange);
        return () => document.removeEventListener('selectionchange', onSelectionChange);
    }, []);

    const handleThemeChange = () => {
        setSelectedCanvasVar('--canvas-bg-1');
        setResetCanvasTrigger(p => p + 1);
    };

    const handleZenMode = () => {
        setZenMode(p => !p);
        if (viewMode) setViewMode(false);
    };

    const handleViewMode = () => {
        setViewMode(p => !p);
        if (zenMode) setZenMode(false);
    };

return (
<div
            className={`App${zenMode?' zen-mode':''}${viewMode?' view-mode':''}`}
            style={{ backgroundColor: canvasColor }}
        >
            <Toolbar onCommand={handleCommand} selectionState={selectionState} />

            <Sidebar
                onCommandPalette={() => setCommandPaletteOpen(true)}
                onFindOnCanvas={() => setFindOnCanvasOpen(true)}
                onHelp={() => setHelpOpen(true)}
                onThemeChange={handleThemeChange}
                onCanvasChange={setSelectedCanvasVar}
                resetCanvasTrigger={resetCanvasTrigger}
                onZenMode={handleZenMode}
                onViewMode={handleViewMode}
                onPageSetup={() => setPageSetupOpen(true)}
                zenMode={zenMode}
                viewMode={viewMode}
            />

            {/* editor-zoom-wrap is the scale target for BottomToolbar zoom */}
            <div className="editor-zoom-wrap">
                <Editor
                    setup={setup}
                    pageDimensions={pageDimensions}
                    marginsPx={marginsPx}
                    marginsCss={marginsCss}
                />
            </div>

            <CommandPalette isOpen={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} />
            <DocumentScrollbar />
            <FindOnCanvas   isOpen={findOnCanvasOpen}   onClose={() => setFindOnCanvasOpen(false)} />
            <Help           isOpen={helpOpen}           onClose={() => setHelpOpen(false)} />

            {pageSetupOpen && (
                <PageSetupModal
                    setup={setup}
                    canvasColor={canvasColor}
                    onSave={updateSetup}
                    onClose={() => setPageSetupOpen(false)}
                />
            )}

            <BottomToolbar />
            <button className="help-btn" onClick={() => setHelpOpen(true)} title="Help (?)">?</button>

            {zenMode && (
                <button className="zen-exit-btn" onClick={() => setZenMode(false)}>Exit Zen mode</button>
            )}
            {viewMode && (
                <button className="view-exit-btn" onClick={() => setViewMode(false)}>Exit View mode</button>
            )}
        </div>
    );
};

export default App;