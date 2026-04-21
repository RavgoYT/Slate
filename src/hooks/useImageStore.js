// src/hooks/useImageStore.js
//
// Stores image data URLs in IndexedDB — no size limit, fully local/private.
// Two stores:
//   'images'      — display version (max 1600px, used in editor)
//   'images-full' — full resolution (used in fullscreen viewer)

const DB_NAME    = 'scratchpad-images';
const DB_VERSION = 2;
const STORE_DISP = 'images';
const STORE_FULL = 'images-full';

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_DISP))
                db.createObjectStore(STORE_DISP, { keyPath: 'id' });
            if (!db.objectStoreNames.contains(STORE_FULL))
                db.createObjectStore(STORE_FULL, { keyPath: 'id' });
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror   = (e) => reject(e.target.error);
    });
}

function putInStore(storeName, id, dataUrl) {
    return openDB().then(db => new Promise((resolve, reject) => {
        const tx  = db.transaction(storeName, 'readwrite');
        const req = tx.objectStore(storeName).put({ id, dataUrl });
        req.onsuccess = () => resolve();
        req.onerror   = (e) => reject(e.target.error);
    }));
}

function deleteFromStore(storeName, id) {
    return openDB().then(db => new Promise((resolve, reject) => {
        const tx  = db.transaction(storeName, 'readwrite');
        const req = tx.objectStore(storeName).delete(id);
        req.onsuccess = () => resolve();
        req.onerror   = (e) => reject(e.target.error);
    }));
}

export const saveImage     = (id, dataUrl) => putInStore(STORE_DISP, id, dataUrl);
export const saveImageFull = (id, dataUrl) => putInStore(STORE_FULL, id, dataUrl);

export async function deleteImage(id) {
    await Promise.all([
        deleteFromStore(STORE_DISP, id),
        deleteFromStore(STORE_FULL, id),
    ]);
}

export async function loadAllImages() {
    const db = await openDB();
    const getAll = (storeName) => new Promise((resolve, reject) => {
        const req = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror   = (e) => reject(e.target.error);
    });
    const [dispRows, fullRows] = await Promise.all([getAll(STORE_DISP), getAll(STORE_FULL)]);
    const map = {};
    for (const row of dispRows) map[row.id] = { src: row.dataUrl, srcFull: row.dataUrl };
    for (const row of fullRows) {
        if (map[row.id]) map[row.id].srcFull = row.dataUrl;
        else             map[row.id] = { src: '', srcFull: row.dataUrl };
    }
    return map;
}

export async function pruneImages(referencedIds) {
    const db = await openDB();
    const getAllKeys = (storeName) => new Promise((resolve, reject) => {
        const req = db.transaction(storeName, 'readonly').objectStore(storeName).getAllKeys();
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror   = (e) => reject(e.target.error);
    });
    const [dispKeys, fullKeys] = await Promise.all([getAllKeys(STORE_DISP), getAllKeys(STORE_FULL)]);
    const toDelete = [...new Set([...dispKeys, ...fullKeys])].filter(id => !referencedIds.has(id));
    await Promise.all(toDelete.map(deleteImage));
}