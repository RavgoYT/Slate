import { useState, useCallback } from 'react';

// ── Paper size definitions — add more here anytime ────────────────────────────
export const PAPER_SIZES = [
    { label: 'Letter (8.5" × 11")',   width: 816,  height: 1056 },
    { label: 'A4 (210 × 297 mm)',     width: 794,  height: 1123 },
    { label: 'Legal (8.5" × 14")',    width: 816,  height: 1344 },
    { label: 'Tabloid (11" × 17")',   width: 1056, height: 1632 },
    { label: 'A3 (297 × 420 mm)',     width: 1123, height: 1587 },
    { label: 'A5 (148 × 210 mm)',     width: 559,  height: 794  },
    { label: 'Executive (7.25"×10")', width: 696,  height: 960  },
];

export const DEFAULT_SETUP = {
    mode:        'pageless',
    orientation: 'portrait',
    paperSize:   PAPER_SIZES[0],
    pageColor:   '#ffffff',
    margins:     { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 },
};

export function usePageSetup() {
    const [setup, setSetup] = useState(() => {
        try {
            const saved = localStorage.getItem('pageSetup');
            if (!saved) return DEFAULT_SETUP;
            const parsed = JSON.parse(saved);
            // Re-hydrate paperSize object from label match
            if (parsed.paperSize?.label) {
                parsed.paperSize = PAPER_SIZES.find(p => p.label === parsed.paperSize.label) || PAPER_SIZES[0];
            }
            return { ...DEFAULT_SETUP, ...parsed };
        } catch { return DEFAULT_SETUP; }
    });

    const updateSetup = useCallback((patch) => {
        setSetup(prev => {
            const next = { ...prev, ...patch };
            localStorage.setItem('pageSetup', JSON.stringify(next));
            return next;
        });
    }, []);

    const pageDimensions = (() => {
        const { width, height } = setup.paperSize;
        return setup.orientation === 'landscape'
            ? { width: height, height: width }
            : { width, height };
    })();

    const marginsPx = {
        top:    Math.round(setup.margins.top    * 96),
        bottom: Math.round(setup.margins.bottom * 96),
        left:   Math.round(setup.margins.left   * 96),
        right:  Math.round(setup.margins.right  * 96),
    };

    const marginsCss = {
        top:    `${Math.max(0, setup.margins.top)}in`,
        bottom: `${setup.margins.bottom}in`,
        left:   `${setup.margins.left}in`,
        right:  `${setup.margins.right}in`,
    };

    return { setup, updateSetup, pageDimensions, marginsPx, marginsCss };
}