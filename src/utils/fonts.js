// All document fonts (Google fonts + Excalifont, alphabetically sorted)
export const GOOGLE_FONTS = [
    { name: 'Arial', family: 'Arial, sans-serif' },
    { name: 'Brush Script MT', family: '"Brush Script MT", cursive' },
    { name: 'Calibri', family: 'Calibri, sans-serif' },
    { name: 'Cambria', family: 'Cambria, serif' },
    { name: 'Comic Sans MS', family: '"Comic Sans MS", cursive' },
    { name: 'Consolas', family: 'Consolas, monospace' },
    { name: 'Courier New', family: '"Courier New", monospace' },
    { name: 'Excalifont', family: 'Excalifont, sans-serif' },
    { name: 'Garamond', family: 'Garamond, serif' },
    { name: 'Georgia', family: 'Georgia, serif' },
    { name: 'Impact', family: 'Impact, sans-serif' },
    { name: 'Inter', family: 'Inter, sans-serif' },
    { name: 'Lato', family: 'Lato, sans-serif' },
    { name: 'Lucida Console', family: '"Lucida Console", monospace' },
    { name: 'Merriweather', family: 'Merriweather, serif' },
    { name: 'Montserrat', family: 'Montserrat, sans-serif' },
    { name: 'Open Sans', family: '"Open Sans", sans-serif' },
    { name: 'Palatino Linotype', family: '"Palatino Linotype", serif' },
    { name: 'Playfair Display', family: '"Playfair Display", serif' },
    { name: 'Poppins', family: 'Poppins, sans-serif' },
    { name: 'Raleway', family: 'Raleway, sans-serif' },
    { name: 'Roboto', family: 'Roboto, sans-serif' },
    { name: 'Roboto Mono', family: '"Roboto Mono", monospace' },
    { name: 'Tahoma', family: 'Tahoma, sans-serif' },
    { name: 'Times New Roman', family: '"Times New Roman", serif' },
    { name: 'Trebuchet MS', family: '"Trebuchet MS", sans-serif' },
    { name: 'Ubuntu', family: 'Ubuntu, sans-serif' },
    { name: 'Verdana', family: 'Verdana, sans-serif' },
];

// Get font family string for applying to document
export function getFontFamily(fontName) {
    const font = GOOGLE_FONTS.find(f => f.name === fontName);
    if (font) return font.family;
    // Fallback to the name itself
    return fontName;
}

// Manage recent document fonts
const RECENT_FONTS_KEY = 'recentDocumentFonts';
const MAX_RECENT = 5;

export function getRecentFonts() {
    try {
        const stored = localStorage.getItem(RECENT_FONTS_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch {
        return [];
    }
}

export function addRecentFont(fontName) {
    try {
        const recent = getRecentFonts();
        const updated = [fontName, ...recent.filter(f => f !== fontName)].slice(0, MAX_RECENT);
        localStorage.setItem(RECENT_FONTS_KEY, JSON.stringify(updated));
    } catch (err) {
        console.error('Failed to save recent font:', err);
    }
}
