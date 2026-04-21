// useEmoji.js
// Emoji data loading (emoji-mart format via CDN), fuzzy search, and recents.

const EMOJI_DATA_URL = 'https://cdn.jsdelivr.net/npm/@emoji-mart/data@1.1.2/sets/14/twitter.json';
const TWEMOJI_BASE   = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/';
const RECENTS_KEY    = 'emoji-recents';   // kept for backward compat migration
const FREQUENT_KEY   = 'emoji-frequent';  // { emojiId: useCount }
const MAX_FREQUENT   = 36;

// ── Module-level cache ────────────────────────────────────────────────────────
let _data      = null;   // raw emoji-mart JSON
let _flat      = null;   // flat array of {id, name, keywords, unified, native, category}
let _loadProm  = null;   // in-flight promise

// ── Category metadata ─────────────────────────────────────────────────────────
export const CATEGORY_META = [
  { id: 'frequent',  label: 'Frequently Used', icon: '🕐' },
  { id: 'people',    label: 'Smileys & People', icon: '😀' },
  { id: 'nature',    label: 'Animals & Nature', icon: '🐶' },
  { id: 'foods',     label: 'Food & Drink',     icon: '🍎' },
  { id: 'activity',  label: 'Activities',       icon: '⚽' },
  { id: 'places',    label: 'Travel & Places',  icon: '✈️' },
  { id: 'objects',   label: 'Objects',          icon: '💡' },
  { id: 'symbols',   label: 'Symbols',          icon: '❤️' },
  { id: 'flags',     label: 'Flags',            icon: '🏳️' },
];

// ── Twemoji URL from unified codepoint ────────────────────────────────────────
export function twemojiUrl(unified) {
  // unified is like '1f600' or '1f1fa-1f1f8'
  return `${TWEMOJI_BASE}${unified.toLowerCase()}.svg`;
}

// ── Load emoji data from CDN ──────────────────────────────────────────────────
export function loadEmojiData() {
  if (_flat) return Promise.resolve(_flat);
  if (_loadProm) return _loadProm;

  _loadProm = fetch(EMOJI_DATA_URL)
    .then(r => r.json())
    .then(data => {
      _data = data;
      _flat = _buildFlat(data);
      window.__emojiFlat = _flat; // expose for useMarkdown.js tokenizer
      
      // Re-render any pending emoji placeholders already in the DOM
      document.querySelectorAll('span.md-emoji-pending[data-emoji-id]').forEach(span => {
        const id = span.dataset.emojiId;
        const emoji = _flat.find(e => e.id === id);
        if (emoji) {
          const img = document.createElement('img');
          img.src = `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${emoji.unified.toLowerCase()}.svg`;
          img.alt = emoji.native;
          img.className = 'md-emoji';
          img.dataset.emojiId = id;
          img.dataset.emojiNative = emoji.native;
          // FIX: Removed contentEditable='false' to fix cursor, highlight, and backspace bugs
          img.draggable = false;
          img.setAttribute('data-noresize', 'true');
          span.replaceWith(img);
        }
      });
      return _flat;
    })
    .catch(err => {
      console.error('[useEmoji] Failed to load emoji data:', err);
      _loadProm = null;
      return [];
    });

  return _loadProm;
}

function _buildFlat(data) {
  const flat = [];
  // Build category lookup: emojiId → categoryId
  const catMap = {};
  for (const cat of (data.categories || [])) {
    for (const id of (cat.emojis || [])) catMap[id] = cat.id;
  }

  for (const [id, emoji] of Object.entries(data.emojis || {})) {
    const skin = emoji.skins?.[0];
    if (!skin) continue;
    flat.push({
      id,
      name:     emoji.name || id,
      keywords: emoji.keywords || [],
      unified:  skin.unified,
      native:   skin.native || '',
      category: catMap[id] || 'objects',
      // OPTIMIZATION: Pre-compute tokens once during load instead of during every search stroke
      idTokens: _tokenize(id),
      kwTokens: (emoji.keywords || []).flatMap(_tokenize)
    });
  }
  return flat;
}

// ── Discord-style token-based fuzzy scoring ──────────────────────────────────
export function searchEmoji(query, limit = 48) {
  if (!_flat || !query) return [];
  const q = query.toLowerCase().trim();
  if (!q) return [];

  // Build frequency map for usage boost
  const freqMap = _getFreqMap();
  const maxFreq = Math.max(1, ...Object.values(freqMap));

  const results = [];
  for (const emoji of _flat) {
    const base = _scoreEmoji(emoji, q);
    if (base <= 0) continue;
    // Usage boost: up to +80 proportional to use frequency
    const usageBoost = freqMap[emoji.id]
      ? Math.round(80 * (freqMap[emoji.id] / maxFreq))
      : 0;
    results.push({ emoji, score: base + usageBoost });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit).map(r => r.emoji);
}

// Tokenize an emoji id/name: "crying_cat_face" → ["crying","cat","face"]
function _tokenize(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '_').split('_').filter(Boolean);
}

// Score a single token against the query string.
function _scoreToken(token, q) {
  if (!token || !q) return 0;

  // 1. Prefix match
  if (token.startsWith(q)) {
    const excess = token.length - q.length;
    return Math.max(100 - excess * 3, 60);
  }

  // 2. Substring match
  const idx = token.indexOf(q);
  if (idx > 0) {
    const depthPenalty = idx * 8;
    const excess = token.length - (idx + q.length);
    return Math.max(55 - depthPenalty - excess * 2, 10);
  }

  // 3. Ordered subsequence / fuzzy match
  let qi = 0, matchAt = -1;
  for (let i = 0; i < token.length && qi < q.length; i++) {
    if (token[i] === q[qi]) {
      if (matchAt === -1) matchAt = i;
      qi++;
    }
  }
  if (qi === q.length) {
    const spread = token.length - (matchAt ?? 0);
    const penalty = spread * 5 + (token.length - q.length) * 3;
    return Math.max(25 - penalty, 5);
  }

  return 0;
}

function _scoreEmoji(emoji, q) {
  // Exact id match
  if (emoji.id === q) return 300;

  // OPTIMIZATION: Use pre-computed tokens
  let bestTokenScore = 0;
  for (let i = 0; i < emoji.idTokens.length; i++) {
    const ts = _scoreToken(emoji.idTokens[i], q);
    if (ts > 0) {
      // Earlier tokens get up to 20% bonus
      const posBonus = Math.round(ts * (0.2 * (1 - i / emoji.idTokens.length)));
      bestTokenScore = Math.max(bestTokenScore, ts + posBonus);
    }
  }

  const fullScore = _scoreToken(emoji.idTokens.join(''), q);

  let kwScore = 0;
  for (const kt of emoji.kwTokens) {
    const s = _scoreToken(kt, q);
    if (s > kwScore) kwScore = Math.min(s, 45); 
  }

  return Math.max(bestTokenScore, fullScore, kwScore);
}

// ── Get emojis by category ────────────────────────────────────────────────────
export function getEmojisByCategory(categoryId) {
  if (!_flat) return [];
  if (categoryId === 'frequent') return getFrequentEmojis();
  return _flat.filter(e => e.category === categoryId);
}

// ── Frequency map helpers ─────────────────────────────────────────────────────
function _getFreqMap() {
  try {
    return JSON.parse(localStorage.getItem(FREQUENT_KEY) || '{}');
  } catch { return {}; }
}

function _setFreqMap(map) {
  try {
    localStorage.setItem(FREQUENT_KEY, JSON.stringify(map));
  } catch {}
}

// ── Frequently used emojis ────────────────────────────────────────────────────
export function getFrequentEmojis() {
  if (!_flat) return [];
  const map = _getFreqMap();
  _migrateLegacyRecents(map);
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_FREQUENT)
    .map(([id]) => _flat.find(e => e.id === id))
    .filter(Boolean);
}

function _migrateLegacyRecents(map) {
  try {
    const legacy = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]');
    if (!legacy.length) return;
    let changed = false;
    legacy.forEach((id, i) => {
      if (!map[id]) { map[id] = legacy.length - i; changed = true; }
    });
    if (changed) {
      _setFreqMap(map);
      localStorage.removeItem(RECENTS_KEY);
    }
  } catch {}
}

// ── Track emoji usage (increment count) ──────────────────────────────────────
export function addRecentEmoji(emojiId) {
  const map = _getFreqMap();
  map[emojiId] = (map[emojiId] || 0) + 1;
  _setFreqMap(map);
}

export { addRecentEmoji as trackEmojiUse };

// ── Emoji lookup by id ────────────────────────────────────────────────────────
export function getEmojiById(id) {
  return _flat?.find(e => e.id === id) || null;
}

// ── Build emoji img element HTML string ──────────────────────────────────────
export function emojiImgHtml(emoji) {
  const url = twemojiUrl(emoji.unified);
  // FIX: Removed contenteditable="false" to fix cursor, highlight, and backspace bugs
  return `<img src="${url}" alt="${emoji.native}" class="md-emoji" data-emoji-id="${emoji.id}" data-emoji-native="${emoji.native}" draggable="false" data-noresize="true" />`;
}

// ── Check if data is loaded ───────────────────────────────────────────────────
export function isEmojiDataLoaded() {
  return _flat !== null;
}