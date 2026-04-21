// src/hooks/usePaste.js

// ─── Editor-native extraction ─────────────────────────────────────────────────
// Walk clipboard HTML from this editor and reconstruct raw markdown text.
function extractRaw(node) {
    if (node.nodeType === 3) return node.textContent.replace(/\u00a0/g, ' ');
    if (node.nodeType !== 1) return '';
    const tag = node.tagName.toLowerCase();
    if (node.classList.contains('md-marker'))        return node.textContent;
    if (node.classList.contains('md-rawcode-store')) return '';
    if (tag === 'img' && node.dataset.emojiId)       return `:${node.dataset.emojiId}:`;
    if (node.classList.contains('math-wrap')) {
        const mf = node.querySelector('math-field');
        return `$${mf?.dataset?.latex || mf?.getAttribute('value') || ''}$`;
    }
    if (tag === 'br') return '\n';
    const inner = Array.from(node.childNodes).map(extractRaw).join('');
    // Only wrap in markdown syntax if sibling md-markers aren't already handling it
    const siblingHasMarker = Array.from(node.parentElement?.children || [])
        .some(c => c !== node && c.classList?.contains('md-marker'));
    if (!siblingHasMarker) {
        if (tag === 'strong' || tag === 'b')                               return `**${inner}**`;
        if (tag === 'em'     || tag === 'i')                               return `*${inner}*`;
        if (node.classList.contains('md-underline') || tag === 'u')        return `__${inner}__`;
        if (node.classList.contains('md-strike') || tag === 's' || tag === 'strike') return `~~${inner}~~`;
        if (tag === 'code' && node.classList.contains('md-inline-code'))   return `\`${inner}\``;
    }
    return inner;
}

// ─── External HTML sanitiser ──────────────────────────────────────────────────
// Preserves inline formatting (bold, italic, color, font) from Google Docs,
// Word, VS Code etc. Strips structural junk and normalises block spacing.
function sanitiseExternalHtml(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;

    tmp.querySelectorAll('script,style,meta,link,head').forEach(el => el.remove());

    // Google Docs wraps in <b style="font-weight:normal"> — unwrap
    tmp.querySelectorAll('b[style*="font-weight:normal"], b[style*="font-weight: normal"]').forEach(el => {
        el.replaceWith(...el.childNodes);
    });

    // Remove spacer <br>s between block elements
    tmp.querySelectorAll('br').forEach(br => {
        const prev = br.previousElementSibling;
        const next = br.nextElementSibling;
        const parentTag = br.parentElement?.tagName?.toLowerCase();
        if (parentTag === 'div' || parentTag === 'body' ||
            (prev && /^(p|div|h[1-6]|li|blockquote)$/i.test(prev.tagName)) ||
            (next && /^(p|div|h[1-6]|li|blockquote)$/i.test(next.tagName))) {
            br.remove();
        }
    });

    // Convert inline-only divs to <p>
    tmp.querySelectorAll('div').forEach(div => {
        const hasBlockChild = [...div.children].some(c =>
            /^(p|div|h[1-6]|ul|ol|li|blockquote|pre|table)$/i.test(c.tagName)
        );
        if (!hasBlockChild) {
            const p = document.createElement('p');
            p.append(...div.childNodes);
            if (div.style.cssText) p.setAttribute('style', div.style.cssText);
            div.replaceWith(p);
        }
    });

    const ALLOWED_TAGS = new Set([
        'p','h1','h2','h3','h4','h5','h6',
        'b','strong','i','em','u','s','strike',
        'a','br','hr','span','code','pre',
        'ul','ol','li','blockquote',
        'table','thead','tbody','tr','th','td',
    ]);

    const walk = (node) => {
        if (node.nodeType !== 1) return;
        [...node.childNodes].forEach(walk);
        const tag = node.tagName.toLowerCase();
        if (!ALLOWED_TAGS.has(tag)) { node.replaceWith(...node.childNodes); return; }

        const keep = ['style', 'href', 'src', 'target', 'rel'];
        [...node.attributes].forEach(a => {
            if (!keep.includes(a.name.toLowerCase())) node.removeAttribute(a.name);
        });

        if (node.style?.cssText) {
            const fw  = node.style.fontWeight;
            const fs  = node.style.fontStyle;
            const ff  = node.style.fontFamily;
            const fz  = node.style.fontSize;
            const td  = node.style.textDecoration;
            const col = node.style.color;
            const bg  = node.style.backgroundColor;
            node.removeAttribute('style');

            if (fw === 'bold' || fw === '700' || parseInt(fw) >= 700) {
                const s = document.createElement('strong');
                s.append(...node.childNodes); node.appendChild(s);
            }
            if (fs === 'italic') {
                const s = document.createElement('em');
                s.append(...node.childNodes); node.appendChild(s);
            }
            if (td?.includes('underline'))    node.style.textDecoration = 'underline';
            if (td?.includes('line-through')) {
                const s = document.createElement('s');
                s.append(...node.childNodes); node.appendChild(s);
            }
            if (ff && !ff.includes('inherit')) node.style.fontFamily = ff;
            if (fz) node.style.fontSize = fz;
            if (col && col !== 'rgb(0, 0, 0)' && col !== '#000000' &&
                       col !== 'rgb(255, 255, 255)' && col !== '#ffffff' &&
                       col !== 'transparent') node.style.color = col;
            if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)')
                node.style.backgroundColor = bg;
        }

        if ((tag === 'span' || tag === 'div') &&
            !node.style?.cssText && node.childNodes.length === 0) node.remove();
    };

    [...tmp.childNodes].forEach(walk);
    return tmp.innerHTML;
}

// ─── Insert sanitised HTML at caret ──────────────────────────────────────────
function insertHtmlAtCaret(editorEl, html, plain) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;

    const BLOCK = new Set(['P','H1','H2','H3','H4','H5','H6',
                           'UL','OL','LI','BLOCKQUOTE','PRE','DIV','HR']);

    // Wrap bare inline/text nodes in <p>
    let i = 0;
    while (i < tmp.childNodes.length) {
        const node = tmp.childNodes[i];
        const isBlock = node.nodeType === 1 && BLOCK.has(node.nodeName);
        if (!isBlock) {
            const p = document.createElement('p');
            p.dataset.blockId = 'b' + Date.now() + i;
            while (tmp.childNodes[i] &&
                   !(tmp.childNodes[i].nodeType === 1 && BLOCK.has(tmp.childNodes[i].nodeName))) {
                p.appendChild(tmp.childNodes[i]);
            }
            tmp.insertBefore(p, tmp.childNodes[i] || null);
        }
        i++;
    }

    const sel = window.getSelection();
    if (!sel?.rangeCount) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();

    // Build normalized child list:
    // - strip leading/trailing empty blocks
    // - preserve internal empty blocks as blank <p> separators
    const isEmpty = c => !c.textContent.trim() && !c.querySelector('img');
    const allChildren = [...tmp.children];

    // Trim leading and trailing empty blocks
    let start = 0, end = allChildren.length - 1;
    while (start <= end && isEmpty(allChildren[start])) start++;
    while (end >= start && isEmpty(allChildren[end])) end--;
    const children = allChildren.slice(start, end + 1);

    if (children.length === 0) return;

    // Use text/plain's 

 //structure to know where blank lines should go.
    // If plain splits into the same number of paragraphs as content blocks,
    // we know each block is separated by a blank line.
    const plainParas = (plain || '').split(/\n\n+/).map(s => s.trim()).filter(Boolean);
    const insertBlanks = plainParas.length > 1 && plainParas.length === children.length;

    console.log('[insertHtml] children:', children.length, 'plainParas:', plainParas.length, 'insertBlanks:', insertBlanks);
    console.log('[insertHtml] children text:', children.map(c => c.textContent.trim().slice(0,30)));
    console.log('[insertHtml] plainParas:', plainParas.map(p => p.slice(0,30)));

    children.forEach((c, i) => {
        c.dataset.blockId = 'b' + Date.now() + i;
    });

    // Find host block at caret
    let hostBlock = range.startContainer;
    while (hostBlock && hostBlock !== editorEl &&
           !['P','H1','H2','H3','H4','H5','H6','LI'].includes(hostBlock.nodeName))
        hostBlock = hostBlock.parentNode;
    const inBlock = hostBlock && hostBlock !== editorEl;

    if (inBlock && children.length === 1) {
        // Single block — merge inline content at caret
        const frag = document.createDocumentFragment();
        [...children[0].childNodes].forEach(n => frag.appendChild(n.cloneNode(true)));
        range.insertNode(frag);
        sel.collapseToEnd();
    } else if (inBlock) {
        // Multiple blocks — split host at caret, pour blocks in
        const tailRange = document.createRange();
        tailRange.setStart(range.startContainer, range.startOffset);
        tailRange.setEnd(hostBlock, hostBlock.childNodes.length);
        const tail = tailRange.extractContents();

        // First block's content goes into the current host block
        [...children[0].childNodes].forEach(n => hostBlock.appendChild(n.cloneNode(true)));

        // Remaining blocks inserted after; if insertBlanks, add empty <p> between each
        let insertAfter = hostBlock;
        for (let j = 1; j < children.length; j++) {
            if (insertBlanks) {
                const blank = document.createElement('p');
                blank.innerHTML = '<br>';
                insertAfter.after(blank);
                insertAfter = blank;
            }
            const node = children[j].cloneNode(true);
            insertAfter.after(node);
            insertAfter = node;
        }

        // Reattach tail of original block to last inserted
        const tailEmpty = tail.childNodes.length === 0 ||
            (tail.childNodes.length === 1 && tail.firstChild?.nodeName === 'BR');
        if (!tailEmpty) insertAfter.appendChild(tail);

        const r = document.createRange();
        r.selectNodeContents(insertAfter); r.collapse(false);
        sel.removeAllRanges(); sel.addRange(r);
    } else {
        const frag = document.createDocumentFragment();
        children.forEach((c, j) => {
            if (insertBlanks && j > 0) {
                const blank = document.createElement('p');
                blank.innerHTML = '<br>';
                frag.appendChild(blank);
            }
            frag.appendChild(c.cloneNode(true));
        });
        range.insertNode(frag);
        sel.collapseToEnd();
    }

    editorEl.dispatchEvent(new Event('input', { bubbles: true }));
}

// ─── Main export ──────────────────────────────────────────────────────────────
export function attachPaste(editorEl, insertImageFromFile, onBlocksChange) {
    if (!editorEl) return () => {};

    const onPaste = async (e) => {
        if (e.target.closest?.('.md-codeblock[data-md-editing]')) return;

        const items = [...(e.clipboardData?.items || [])];

        // ── Image paste ───────────────────────────────────────────────
        const imgItem = items.find(it => it.type.startsWith('image/'));
        if (imgItem) {
            e.preventDefault();
            const file = imgItem.getAsFile();
            if (file) await insertImageFromFile(file, onBlocksChange);
            return;
        }

        e.preventDefault();

        const html  = e.clipboardData.getData('text/html')  || '';
        const plain = e.clipboardData.getData('text/plain') || '';

        // ── Ctrl+Shift+V: plain text only ─────────────────────────────
        if (e.shiftKey) {
            if (plain) document.execCommand('insertText', false, plain.replace(/\r\n|\r/g, '\n'));
            return;
        }

        // ── Editor-native: extract markdown, insert as text ───────────
        if (html.includes('<!--editor-native-copy-->')) {
            const sentinel = '<!--editor-native-copy-->';
            const cleanHtml = html.slice(html.indexOf(sentinel) + sentinel.length).trim();
            const tmp = document.createElement('div');
            tmp.innerHTML = cleanHtml;

            const BLOCK_TAGS = ['P','H1','H2','H3','H4','H5','H6','LI','BLOCKQUOTE','PRE','DIV'];
            const blockEls = [...tmp.children].filter(c => BLOCK_TAGS.includes(c.nodeName));

            let text;
            if (blockEls.length === 0) {
                text = extractRaw(tmp).trim();
            } else if (blockEls.length === 1) {
                text = (blockEls[0].dataset.mdSrc || extractRaw(blockEls[0])).trim();
            } else {
                text = blockEls
                    .map(b => (b.dataset.mdSrc || extractRaw(b)).trim())
                    .filter(t => t.length > 0)
                    .join('\n\n');
            }

            if (text) document.execCommand('insertText', false, text);
            editorEl.dispatchEvent(new Event('input', { bubbles: true }));
            return;
        }

        // ── External HTML: sanitise and insert with formatting ────────
        if (html) {
            const cleaned = sanitiseExternalHtml(html);
            insertHtmlAtCaret(editorEl, cleaned, plain);
            return;
        }

        // ── Plain text fallback ───────────────────────────────────────
        if (plain) document.execCommand('insertText', false, plain.replace(/\r\n|\r/g, '\n'));
    };

    editorEl.addEventListener('paste', onPaste);
    return () => editorEl.removeEventListener('paste', onPaste);
}