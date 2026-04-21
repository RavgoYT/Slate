// useEmojiTooltip.js
import { createRoot } from 'react-dom/client'
import React, { useState, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { twemojiUrl } from './useEmoji'

const R = React.createElement

// ───────────────────────────────────────────────────────────
// Singleton React root
// ───────────────────────────────────────────────────────────
let root = null
let host = null

function getRoot() {
    if (!host) {
        host = document.createElement('div')
        host.id = 'emoji-tooltip-host'
        document.body.appendChild(host)
        root = createRoot(host)
    }
    return root
}

// ───────────────────────────────────────────────────────────
// Tooltip Component
// ───────────────────────────────────────────────────────────
const Tooltip = ({ emoji, anchor }) => {

    const ref = useRef(null)

    const [revealed, setRevealed] = useState(false)
    const [pos, setPos] = useState({ top: -9999, left: -9999 })

    useLayoutEffect(() => {
        setRevealed(false)
    }, [emoji.id])

    function updatePosition() {
        if (!anchor || !ref.current) return

        const rect = anchor.getBoundingClientRect()

        const cw = ref.current.offsetWidth  || 200
        const ch = ref.current.offsetHeight || 80

        let left = rect.left + rect.width/2 - cw/2
        let top  = rect.top - ch - 10

        if (top < 8) top = rect.bottom + 10

        left = Math.max(8, Math.min(left, window.innerWidth - cw - 8))

        setPos({ top, left })
    }

    useLayoutEffect(() => {

        updatePosition()

        const onScroll = () => updatePosition()
        const onResize = () => updatePosition()

        window.addEventListener('scroll', onScroll, true)
        window.addEventListener('resize', onResize)

        return () => {
            window.removeEventListener('scroll', onScroll, true)
            window.removeEventListener('resize', onResize)
        }

    }, [anchor, emoji])

    return createPortal(

        R('div',
        {
            className: 'emoji-tooltip-bridge',
            style:{
                position:'fixed',
                zIndex:9999,
                top:pos.top - 20,
                left:pos.left - 20,
                padding:'20px',
                pointerEvents:'auto'
            }
        },

            R('div',
            {
                ref,
                className: `emoji-tooltip${revealed ? ' emoji-tooltip--revealed' : ''}`,
                style:{
                    position:'relative'
                }
            },

                R('img',{
                    src:twemojiUrl(emoji.unified),
                    alt:emoji.native,
                    className:'emoji-tooltip__img',
                    draggable:false
                }),

                R('div',{className:'emoji-tooltip__body'},

                    R('div',{className:'emoji-tooltip__id'},`:${emoji.id}:`),

                    !revealed
                        ? R('button',
                            {
                                className:'emoji-tooltip__learn-btn',
                                onMouseDown:e=>{
                                    e.preventDefault()
                                    e.stopPropagation()
                                    setRevealed(true)
                                }
                            },
                            'Click to learn more'
                        )
                        : R('div',
                            {className:'emoji-tooltip__desc'},
                            'This is a default emoji'
                        )
                )
            )
        ),

        document.body
    )
}

// ───────────────────────────────────────────────────────────
// Show / Hide
// ───────────────────────────────────────────────────────────
function showTooltip(emoji, anchor) {
    getRoot().render(
        R(Tooltip,{emoji,anchor})
    )
}

function hideTooltip() {
    root?.render(null)
}

// ───────────────────────────────────────────────────────────
// Main attachment
// ───────────────────────────────────────────────────────────
export function attachEmojiTooltip(editorEl){

    if(!editorEl) return ()=>{}

    let activeImg = null

    let showTimer = null

    function show(img){

        clearTimeout(showTimer)

        if(img === activeImg) return

        showTimer = setTimeout(()=>{

            activeImg = img

            showTooltip({
                id:img.dataset.emojiId,
                native:img.dataset.emojiNative || '',
                name:img.dataset.emojiId.replace(/_/g,' '),
                unified:(img.src.match(/\/([0-9a-f-]+)\.svg$/i)||[])[1] || '2753'
            }, img)

        },120) // Discord-style delay
    }

    function hide(){

        clearTimeout(showTimer)

        activeImg = null
        hideTooltip()
    }

    function onMove(e){

        const img = e.target.closest?.('img[data-emoji-id]')
        const tooltip = e.target.closest?.('.emoji-tooltip') || e.target.closest?.('.emoji-tooltip-bridge')

        if(img && editorEl.contains(img)){
            show(img)
        }
        else if(tooltip){
            // Keep tooltip visible
        }
        else if(activeImg){
            hide()
        }
    }

    editorEl.addEventListener('pointermove',onMove)

    return ()=>{

        editorEl.removeEventListener('pointermove',onMove)

        clearTimeout(showTimer)

        hideTooltip()
    }
}