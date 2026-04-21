// Toolbar.jsx  — adds image insert button (🖼) near the emoji button
// Only the relevant section is shown as a diff; the full file is below.
// CHANGE SUMMARY:
//   1. Added image file-input ref + hidden <input type="file">
//   2. Added 🖼 TbBtn that triggers the file input
//   3. Wired cmd('image', file) through to App → Editor

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import EmojiPicker from '../Editor/EmojiPicker.jsx';
import { emojiImgHtml, loadEmojiData } from '../../hooks/useEmoji';
import '@fontsource/roboto';
import '@fontsource/open-sans';
import '@fontsource/lato';
import '@fontsource/poppins';
import '@fontsource/ubuntu';
import '@fontsource/inter';
import '@fontsource/playfair-display';
import '@fontsource/raleway';
import '@fontsource/merriweather';
import '@fontsource/montserrat';
import { GOOGLE_FONTS, getFontFamily, getRecentFonts, addRecentFont } from '../../utils/fonts';
import { getDefaultDocumentFont, getDefaultRecentFonts } from '../../hooks/useDocumentFont';
import './Toolbar.css';

// ── HSV helpers ────────────────────────────────────────────────────────────────
function hexToHsv(hex) {
    let r = parseInt(hex.slice(1,3),16)/255, g = parseInt(hex.slice(3,5),16)/255, b = parseInt(hex.slice(5,7),16)/255;
    const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max-min;
    let h=0, s=max===0?0:d/max, v=max;
    if(d!==0){
        if(max===r) h=((g-b)/d+(g<b?6:0))/6;
        else if(max===g) h=((b-r)/d+2)/6;
        else h=((r-g)/d+4)/6;
    }
    return {h:h*360,s,v};
}
function hsvToHex(h,s,v){
    h=h/360;
    let r,g,b;
    const i=Math.floor(h*6),f=h*6-i,p=v*(1-s),q=v*(1-f*s),t=v*(1-(1-f)*s);
    switch(i%6){case 0:r=v;g=t;b=p;break;case 1:r=q;g=v;b=p;break;case 2:r=p;g=v;b=t;break;case 3:r=p;g=q;b=v;break;case 4:r=t;g=p;b=v;break;default:r=v;g=p;b=q;}
    return '#'+[r,g,b].map(x=>Math.round(x*255).toString(16).padStart(2,'0')).join('');
}
function polarToSV(px,py,cx,cy,r){
    const dx=(px-cx)/r,dy=(py-cy)/r,dist=Math.sqrt(dx*dx+dy*dy);
    const nx=dist>1?dx/dist:dx,ny=dist>1?dy/dist:dy;
    return{s:Math.max(0,Math.min(1,(nx+1)/2)),v:Math.max(0,Math.min(1,(-ny+1)/2))};
}
function svToPolar(s,v,cx,cy,r){return{x:cx+(s*2-1)*r,y:cy+(-(v*2-1))*r};}

// ── Portal menu ────────────────────────────────────────────────────────────────
const PortalMenu = ({style, className, children}) => {
    const clamped = { ...style };
    if (clamped.left != null && clamped.width != null) {
        const maxLeft = window.innerWidth - Number(clamped.width) - 8;
        clamped.left = Math.max(8, Math.min(Number(clamped.left), maxLeft));
    }
    return createPortal(
        <div 
            className={`tb-dropdown__menu ${className||''}`} 
            style={clamped}
            onMouseDown={e => {
                // Prevent dropdown clicks from stealing editor focus
                if (e.target.tagName !== 'INPUT') e.preventDefault();
            }}
        >
            {children}
        </div>,
        document.body
    );
};

const Divider = () => <div className="tb-divider" />;

const TbBtn = ({title,active,disabled,onClick,children}) => (
    <button className={`tb-btn${active?' tb-btn--active':''}${disabled?' tb-btn--disabled':''}`}
        title={title} 
        onClick={onClick} 
        disabled={disabled}
        // FIX: Prevent the button from stealing the editor's focus cursor
        onMouseDown={e => e.preventDefault()}>
        {children}
    </button>
);

// ── Generic dropdown ───────────────────────────────────────────────────────────
const Dropdown = ({trigger,children,width=160,menuClass=''}) => {
    const [open,setOpen]=useState(false);
    const [pos,setPos]=useState({top:0,left:0});
    const triggerRef=useRef();
    const calcPos=useCallback(()=>{
        if(!triggerRef.current)return;
        const rect=triggerRef.current.getBoundingClientRect();
        setPos({top:rect.bottom+4,left:rect.left});
    },[]);
    useEffect(()=>{
        if(!open)return;
        const h=(e)=>{
            if(!triggerRef.current?.contains(e.target)){
                const menus=document.querySelectorAll('.tb-dropdown__menu');
                for(const m of menus){if(m.contains(e.target))return;}
                setOpen(false);
            }
        };
        document.addEventListener('mousedown',h);
        window.addEventListener('resize',calcPos);
        return()=>{document.removeEventListener('mousedown',h);window.removeEventListener('resize',calcPos);};
    },[open,calcPos]);
    return(
        <div style={{display:'inline-flex',alignItems:'center',flexShrink:0}}>
            <div ref={triggerRef}
                onMouseDown={e => { if (e.target.tagName !== 'INPUT') e.preventDefault(); }}
                onClick={()=>{if(!open){calcPos();setOpen(true);}else setOpen(false);}}>
                {trigger}
            </div>
            {open&&<PortalMenu className={menuClass} style={{position:'fixed',top:pos.top,left:pos.left,width}}>
                {children({close:()=>setOpen(false)})}
            </PortalMenu>}
        </div>
    );
};

// ── Color picker ───────────────────────────────────────────────────────────────
const ColorPicker = ({value,onChange,onSaveRecent,recentColors,showClear=false,onClear}) => {
    const svgRef=useRef();
    const [hsv,setHsv]=useState(()=>hexToHsv(value||'#d3d3d3'));
    const [hexInput,setHexInput]=useState(value||'#d3d3d3');
    const dragging=useRef(null);
    const W=160,R=W/2,RING=14,INNER=R-RING-2,SV_R=INNER-10;
    const commit=useCallback((nh)=>{const hex=hsvToHex(nh.h,nh.s,nh.v);setHexInput(hex);onChange(hex);},[onChange]);
    const handleMouseDown=(e)=>{
        e.preventDefault();
        if(!svgRef.current)return;
        const rect=svgRef.current.getBoundingClientRect();
        const x=e.clientX-rect.left,y=e.clientY-rect.top;
        const dx=x-R,dy=y-R,dist=Math.sqrt(dx*dx+dy*dy);
        if(dist>=INNER&&dist<=R+2){dragging.current='wheel';const nh={...hsv,h:(Math.atan2(dy,dx)*180/Math.PI+360)%360};setHsv(nh);commit(nh);}
        else if(dist<=SV_R+2){dragging.current='sv';const{s,v}=polarToSV(x,y,R,R,SV_R);const nh={...hsv,s,v};setHsv(nh);commit(nh);}
    };
    useEffect(()=>{
        const move=(e)=>{
            if(!dragging.current||!svgRef.current)return;
            const rect=svgRef.current.getBoundingClientRect();
            const x=e.clientX-rect.left,y=e.clientY-rect.top;
            if(dragging.current==='wheel'){const nh={...hsv,h:(Math.atan2(y-R,x-R)*180/Math.PI+360)%360};setHsv(nh);commit(nh);}
            else{const{s,v}=polarToSV(x,y,R,R,SV_R);const nh={...hsv,s,v};setHsv(nh);commit(nh);}
        };
        const up=()=>{dragging.current=null;};
        window.addEventListener('mousemove',move);window.addEventListener('mouseup',up);
        return()=>{window.removeEventListener('mousemove',move);window.removeEventListener('mouseup',up);};
    },[hsv,commit,R,SV_R]);
    const currentHex=hsvToHex(hsv.h,hsv.s,hsv.v);
    const hueHex=hsvToHex(hsv.h,1,1);
    const hueAngle=hsv.h*Math.PI/180;
    const hueThumbR=INNER+RING/2;
    const htx=R+hueThumbR*Math.cos(hueAngle),hty=R+hueThumbR*Math.sin(hueAngle);
    const{x:stx,y:sty}=svToPolar(hsv.s,hsv.v,R,R,SV_R);
    const uid=useRef(Math.random().toString(36).slice(2));
    const wgId=`cpw-${uid.current}`,bgId=`cpb-${uid.current}`,cId=`cpc-${uid.current}`;
    
    return(
        <div className="clr-panel">
            <svg ref={svgRef} width={W} height={W} style={{display:'block',cursor:'crosshair'}} onMouseDown={handleMouseDown}>
                <defs>
                    <linearGradient id={wgId} x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#fff"/><stop offset="100%" stopColor={hueHex}/></linearGradient>
                    <linearGradient id={bgId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="rgba(0,0,0,0)"/><stop offset="100%" stopColor="#000"/></linearGradient>
                    <clipPath id={cId}><circle cx={R} cy={R} r={SV_R}/></clipPath>
                </defs>
                {Array.from({length:360},(_,i)=>{
                    const a1=i*Math.PI/180,a2=(i+1)*Math.PI/180;
                    const x1o=R+R*Math.cos(a1),y1o=R+R*Math.sin(a1),x2o=R+R*Math.cos(a2),y2o=R+R*Math.sin(a2);
                    const x1i=R+INNER*Math.cos(a1),y1i=R+INNER*Math.sin(a1),x2i=R+INNER*Math.cos(a2),y2i=R+INNER*Math.sin(a2);
                    return<path key={i} d={`M${x1i},${y1i} L${x1o},${y1o} A${R},${R} 0 0,1 ${x2o},${y2o} L${x2i},${y2i} A${INNER},${INNER} 0 0,0 ${x1i},${y1i}`} fill={hsvToHex(i,1,1)}/>;
                })}
                <rect x={0} y={0} width={W} height={W} fill={`url(#${wgId})`} clipPath={`url(#${cId})`}/>
                <rect x={0} y={0} width={W} height={W} fill={`url(#${bgId})`} clipPath={`url(#${cId})`}/>
                <circle cx={htx} cy={hty} r={7} fill={hueHex} stroke="#fff" strokeWidth={2}/>
                <circle cx={stx} cy={sty} r={7} fill={currentHex} stroke="#fff" strokeWidth={2}/>
            </svg>
            <div className="clr-hex-row">
                <div className="clr-preview" style={{background:currentHex}}/>
                <div className="clr-hex-chip">
                    <input className="clr-hex-chip__input" value={hexInput} maxLength={7} spellCheck={false}
                        onChange={e=>{
                            const v=e.target.value; setHexInput(v);
                            if(/^#[0-9a-fA-F]{6}$/.test(v)){const nh=hexToHsv(v);setHsv(nh);onChange(v);}
                        }}/>
                </div>
                <button className="clr-done" onMouseDown={e => e.preventDefault()} onClick={()=>onSaveRecent?.(currentHex)}>✓</button>
            </div>
            {recentColors?.length>0&&(
                <div className="clr-recent-grid">
                    {recentColors.map((c,i)=>(
                        <button key={i} className="clr-swatch" style={{background:c}}
                            title={c}
                            onMouseDown={e => e.preventDefault()}
                            onClick={()=>{const nh=hexToHsv(c);setHsv(nh);setHexInput(c);onChange(c);}}/>
                    ))}
                </div>
            )}
            {showClear&&(
                <button className="clr-clear-btn" onMouseDown={e => e.preventDefault()} onClick={onClear}>
                    <span className="clr-clear-icon">✕</span> Clear highlight
                </button>
            )}
        </div>
    );
};

// ── Color button with picker popup ────────────────────────────────────────────
const RECENT_KEY = 'recentColors';
const getRecent  = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; } };
const addRecent  = (c) => { const arr = [c,...getRecent().filter(x=>x!==c)].slice(0,12); try { localStorage.setItem(RECENT_KEY,JSON.stringify(arr)); } catch {} };

const ColorBtn = ({title, value, onChange, icon, showClear=false, onClear}) => {
    const [open,setOpen]   = useState(false);
    const [pos,setPos]     = useState({top:0,left:0});
    const [recent,setRecent] = useState(getRecent);
    const btnRef = useRef();
    
    // calcPos
    const calcPos = useCallback(()=>{
        if(!btnRef.current)return;
        const rect=btnRef.current.getBoundingClientRect();
        setPos({top:rect.bottom+6,left:rect.left-80});
    },[]);

    useEffect(()=>{
        if(!open)return;
        const h=(e)=>{ if(!btnRef.current?.contains(e.target)){const menus=document.querySelectorAll('.clr-popup');for(const m of menus){if(m.contains(e.target))return;}setOpen(false);}};
        document.addEventListener('mousedown',h);
        return()=>document.removeEventListener('mousedown',h);
    },[open]);

    return(
        <>
            <button ref={btnRef} className="tb-btn tb-color-btn" title={title}
                onMouseDown={e => e.preventDefault()} // Prevents button from stealing focus
                onClick={()=>{if(!open){calcPos();setRecent(getRecent());}setOpen(p=>!p);}}>
                <span className="tb-color-icon">{icon}</span>
                <span className="tb-color-bar" style={{background: value==='__clear__'?'transparent':value, border: value==='__clear__'?'1px dashed var(--border-color)':'none'}}/>
            </button>
            {open&&createPortal(
                <div 
                    className="clr-popup" 
                    style={{position:'fixed',top:pos.top,left:pos.left}}
                    onMouseDown={e => { if (e.target.tagName !== 'INPUT') e.preventDefault(); }}
                >
                    <ColorPicker value={value==='__clear__'?'#d3d3d3':value} onChange={onChange}
                        onSaveRecent={c=>{addRecent(c);setRecent(getRecent());}}
                        recentColors={recent} showClear={showClear} onClear={onClear}/>
                </div>,
                document.body
            )}
        </>
    );
};

// ── Style dropdown ─────────────────────────────────────────────────────────────
const STYLE_OPTIONS = [
    {value:'p',  label:'Normal',    style:{fontSize:'13px'}},
    {value:'h0', label:'Title',     style:{fontSize:'22px',fontWeight:'700'}},
    {value:'h1', label:'Heading 1', style:{fontSize:'18px',fontWeight:'700'}},
    {value:'h2', label:'Heading 2', style:{fontSize:'15px',fontWeight:'600'}},
    {value:'h3', label:'Heading 3', style:{fontSize:'13px',fontWeight:'600'}},
    {value:'sub',label:'Subtext',   style:{fontSize:'11px',color:'var(--text-color-secondary)'}},
];
const StyleDropdown = ({value, onChange}) => (
    <Dropdown width={160}
        trigger={<button className="tb-dropdown__trigger">
            <span className="tb-dropdown__label">{STYLE_OPTIONS.find(o=>o.value===value)?.label||'Normal'}</span>
            <span className="tb-dropdown__caret">▾</span>
        </button>}>
        {({close})=>STYLE_OPTIONS.map(o=>(
            <button key={o.value} className="tb-dropdown__item" style={o.style}
                onMouseDown={e => e.preventDefault()}
                onClick={()=>{onChange(o.value);close();}}>{o.label}</button>
        ))}
    </Dropdown>
);

// ── Font dropdown ──────────────────────────────────────────────────────────────
const FontDropdown = ({value, recentFonts, onChange}) => {
    const allFonts   = GOOGLE_FONTS;
    const recentSet  = new Set(recentFonts);
    const otherFonts = allFonts.filter(f => !recentSet.has(f.name ?? f));
    const isMixed    = value === '' || value == null;
    return (
        <Dropdown width={200}
            trigger={<button className="tb-dropdown__trigger" style={{fontFamily: isMixed ? 'inherit' : getFontFamily(value)}}>
                <span className="tb-dropdown__label" style={{color: isMixed ? 'var(--text-color-secondary)' : ''}}>
                    {isMixed ? '—' : value}
                </span>
                <span className="tb-dropdown__caret">▾</span>
            </button>}>
            {({close})=>(
                <>
                    {recentFonts.length>0&&<>
                        <div style={{fontSize:'10px',color:'var(--text-color-secondary)',padding:'4px 10px 2px',userSelect:'none'}}>Recent</div>
                        {recentFonts.map(f=>(
                            <button key={f} className="tb-dropdown__item" style={{fontFamily:getFontFamily(f)}}
                                onMouseDown={e => e.preventDefault()}
                                onClick={()=>{onChange(f);close();}}>{f}</button>
                        ))}
                        <div style={{height:'1px',background:'var(--border-color)',margin:'4px 0'}}/>
                    </>}
                    {otherFonts.map(f=>(
                        <button key={f.name ?? f} className="tb-dropdown__item" style={{fontFamily: f.family ?? getFontFamily(f)}}
                            onMouseDown={e => e.preventDefault()}
                            onClick={()=>{onChange(f.name ?? f);close();}}>{f.name ?? f}</button>
                    ))}
                </>
            )}
        </Dropdown>
    );
};

// ── Font size ──────────────────────────────────────────────────────────────────
const FontSize = ({ value, onChange }) => {
    const isMixed = value === '' || value == null;
    const inputRef = useRef(null);
    const [draft, setDraft] = useState(isMixed ? '' : String(value));

    useEffect(() => {
        setDraft(value === '' || value == null ? '' : String(value));
    }, [value]);

    const commit = (v) => {
        const n = parseInt(v, 10);
        if (n >= 6 && n <= 200) {
            onChange(n);
            setDraft(String(n));
        } else {
            setDraft(value === '' || value == null ? '' : String(value));
        }
    };

    return (
        <div className="tb-fontsize">
            <button
                className="tb-fontsize__btn"
                onMouseDown={e => e.preventDefault()}
                onClick={() => { if (!isMixed) commit(Number(value) - 1); }}
            >
                −
            </button>

            <input
                ref={inputRef}
                className="tb-fontsize__input"
                type="number"
                value={draft}
                placeholder="—"
                onMouseDown={e => e.stopPropagation()}
                onChange={e => setDraft(e.target.value)}
                onBlur={e => commit(e.target.value)}
onKeyDown={e => {
    if (e.key === 'Enter') {
        e.preventDefault();   // stop editor command
        e.stopPropagation();  // stop bubbling

        commit(e.target.value);
        inputRef.current?.blur();
        return;
    }

    e.stopPropagation();
}}
            />

            <button
                className="tb-fontsize__btn"
                onMouseDown={e => e.preventDefault()}
                onClick={() => { if (!isMixed) commit(Number(value) + 1); }}
            >
                +
            </button>
        </div>
    );
};

// ── List dropdown ──────────────────────────────────────────────────────────────
const BULLET_STYLES = [
    {value:'disc',   label:'• Bullet'},
    {value:'circle', label:'◦ Circle'},
    {value:'square', label:'▪ Square'},
    {value:'arrow',  label:'▸ Arrow'},
];
const NUMBERED_STYLES = [
    {value:'decimal',     label:'1. Decimal'},
    {value:'lower-alpha', label:'a. Alpha'},
    {value:'upper-alpha', label:'A. Alpha'},
    {value:'lower-roman', label:'i. Roman'},
    {value:'upper-roman', label:'I. Roman'},
];

const ListDropdown = ({icon, styles, commandType, selectionState, onCommand}) => {
    const activeStyle = selectionState?.listTag === (commandType==='bulletList'?'UL':'OL')
        ? (selectionState?.listType||styles[0].value) : null;
    return(
        <Dropdown width={140}
            trigger={<button className={`tb-btn${activeStyle?' tb-btn--active':''}`} title={commandType==='bulletList'?'Bullet list':'Numbered list'}>{icon}</button>}>
            {({close})=>styles.map(s=>(
                <button key={s.value} className={`tb-dropdown__item${activeStyle===s.value?' tb-btn--active':''}`}
                    onMouseDown={e => e.preventDefault()}
                    onClick={()=>{
                        onCommand?.({type:commandType,value:{style:s.value,currentTag:selectionState?.listTag,currentStyle:selectionState?.listType}});
                        close();
                    }}>{s.label}</button>
            ))}
        </Dropdown>
    );
};

// ── Table picker ───────────────────────────────────────────────────────────────
const MAX_GRID = 15, CELL_W = 18, CELL_GAP = 3, MENU_PAD = 20;
const TablePicker = ({onInsert, onWidthChange}) => {
    const [gridSize, setGridSize] = useState({rows:8,cols:10});
    const [hovered,  setHovered]  = useState({r:0,c:0});
    const handleMouseEnter = (r,c) => {
        setHovered({ r: r + 1, c: c + 1 });
        const newRows = (r >= gridSize.rows - 2) ? Math.min(MAX_GRID, gridSize.rows + 2) : gridSize.rows;
        const newCols = (c >= gridSize.cols - 2) ? Math.min(MAX_GRID, gridSize.cols + 2) : gridSize.cols;
        if (newRows !== gridSize.rows || newCols !== gridSize.cols) {
            setGridSize({ rows: newRows, cols: newCols });
            onWidthChange?.(newCols * (CELL_W + CELL_GAP) + MENU_PAD);
        }
    };
    return (
        <div className="tb-table-picker">
            <div className="tb-table-picker__label">
                {hovered.r > 0 ? `${hovered.r} × ${hovered.c}` : 'Insert table'}
            </div>
            <div className="tb-table-picker__grid" style={{ gridTemplateColumns: `repeat(${gridSize.cols}, ${CELL_W}px)` }}>
                {Array.from({ length: gridSize.rows }, (_, r) =>
                    Array.from({ length: gridSize.cols }, (_, c) => (
                        <div key={`${r}-${c}`}
                            className={`tb-table-cell${r < hovered.r && c < hovered.c ? ' active' : ''}`}
                            onMouseEnter={() => handleMouseEnter(r, c)}
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => onInsert(hovered.r, hovered.c)}
                        />
                    ))
                )}
            </div>
        </div>
    );
};

const TableDropdown = ({ onInsert }) => {
    const [menuWidth, setMenuWidth] = useState(10 * (CELL_W + CELL_GAP) + MENU_PAD);
    return (
        <Dropdown width={menuWidth} menuClass="tb-table-menu"
            trigger={<button className="tb-btn" title="Insert table">⊞</button>}>
            {({ close }) => (
                <TablePicker
                    onInsert={(r, c) => { onInsert(r, c); close(); }}
                    onWidthChange={setMenuWidth}
                />
            )}
        </Dropdown>
    );
};

// ── Main Toolbar ───────────────────────────────────────────────────────────────
const Toolbar = ({onCommand, selectionState}) => {
    const [textStyle,     setTextStyle]   = useState('p');
    const [font,          setFont]        = useState(()=>getDefaultDocumentFont());
    const [recentFonts,   setRecentFonts] = useState(()=>getDefaultRecentFonts());
    const [fontSize,      setFontSize]    = useState(14);
    const [bold,          setBold]        = useState(false);
    const [italic,        setItalic]      = useState(false);
    const [underline,     setUnderline]   = useState(false);
    const [strikethrough, setStrike]      = useState(false);
    const [fontColor,     setFontColor]   = useState('#d3d3d3');
    const [hlColor,       setHlColor]     = useState('__clear__');
    const [align,         setAlign]       = useState('left');
    const [isLink,        setIsLink]      = useState(false);
    const [emojiOpen,     setEmojiOpen]   = useState(false);
    const emojiBtnRef  = useRef(null);

// ── Selection Guard ─────────────────────────────────────────────────────
const savedSelectionRef = useRef(null);

const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
        savedSelectionRef.current = sel.getRangeAt(0).cloneRange();
    }
};

const restoreSelection = () => {
    const range = savedSelectionRef.current;
    if (!range) return;

    const sel = window.getSelection();
    if (!sel) return;

    try {
        sel.removeAllRanges();
        sel.addRange(range);
    } catch {
        // DOM changed (table/math/image insertion etc)
        savedSelectionRef.current = null;
    }
};

    // ── Image insert ────────────────────────────────────────────────────────────
    const imageInputRef = useRef(null);

    const handleImageButtonClick = useCallback(() => {
        imageInputRef.current?.click();
    }, []);

    const handleImageFileChange = useCallback((e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        onCommand?.({ type: 'image', value: file });
        // Reset so the same file can be re-selected
        e.target.value = '';
    }, [onCommand]);

useEffect(() => {
        if (!selectionState) return;
        const { styleTag, fontFamily, fontSize: fs, bold: b, italic: i,
                underline: u, strike: s, align: a, isLink: lnk } = selectionState;
        if (styleTag)            setTextStyle(styleTag);
        if (fontFamily !== undefined) setFont(fontFamily ?? '');      // null = mixed → show blank
        if (fs !== undefined)         setFontSize(fs ?? '');          // null = mixed → show blank
        setBold(!!b); setItalic(!!i); setUnderline(!!u); setStrike(!!s);
        if (a) setAlign(a);
        setIsLink(!!lnk);
    }, [selectionState]);

    const cmd = (type, value) => {
    restoreSelection();
    onCommand?.({ type, value });
};

    useEffect(() => { loadEmojiData(); }, []);

    const handleEmojiInsert = (emoji) => {
        onCommand?.({ type: 'emoji', value: emoji });
        setEmojiOpen(false);
    };

    const handleFontChange = (fontName) => {
        setFont(fontName); cmd('font', fontName);
        addRecentFont(fontName); setRecentFonts(getRecentFonts());
    };

    return (
        <div
    className="toolbar"
    onMouseDown={e => {
        saveSelection();
        if (!e.target.closest('input, textarea, select')) e.preventDefault();
    }}
>
            <StyleDropdown value={textStyle} onChange={v => { setTextStyle(v); cmd('style', v); }}/>
            <Divider/>
            <FontDropdown value={font} recentFonts={recentFonts} onChange={handleFontChange}/>
            <Divider/>
            <FontSize value={fontSize} onChange={v => { setFontSize(v); cmd('fontSize', v); }}/>
            <Divider/>
            <TbBtn title="Bold (Ctrl+B)"      active={bold}          onClick={()=>{ setBold(p=>!p);      cmd('bold'); }}>        <strong>B</strong></TbBtn>
            <TbBtn title="Italic (Ctrl+I)"    active={italic}        onClick={()=>{ setItalic(p=>!p);    cmd('italic'); }}>      <em>I</em></TbBtn>
            <TbBtn title="Underline (Ctrl+U)" active={underline}     onClick={()=>{ setUnderline(p=>!p); cmd('underline'); }}>   <span style={{textDecoration:'underline'}}>U</span></TbBtn>
            <TbBtn title="Strikethrough"      active={strikethrough} onClick={()=>{ setStrike(p=>!p);    cmd('strikethrough'); }}><span style={{textDecoration:'line-through'}}>S</span></TbBtn>
            <Divider/>
            <ColorBtn title="Font color" value={fontColor}
                onChange={v=>{ setFontColor(v); cmd('fontColor', v); }} icon="A"/>
            <ColorBtn title="Highlight"  value={hlColor}
                onChange={v=>{ setHlColor(v); cmd('highlight', v); }}
                icon="▮"
                showClear={true}
                onClear={()=>{ setHlColor('__clear__'); cmd('highlight', '__clear__'); }}/>
            <Divider/>
            <ListDropdown icon="☰" styles={BULLET_STYLES}   commandType="bulletList"   selectionState={selectionState} onCommand={onCommand}/>
            <ListDropdown icon="①" styles={NUMBERED_STYLES} commandType="numberedList" selectionState={selectionState} onCommand={onCommand}/>
            <Divider/>
            <TbBtn title="Align left"   active={align==='left'}   onClick={()=>{ setAlign('left');   cmd('align','left'); }}>  ⬤≡</TbBtn>
            <TbBtn title="Align center" active={align==='center'} onClick={()=>{ setAlign('center'); cmd('align','center'); }}>≡</TbBtn>
            <TbBtn title="Align right"  active={align==='right'}  onClick={()=>{ setAlign('right');  cmd('align','right'); }}>  ≡⬤</TbBtn>
            <Divider/>
            <TbBtn title="Insert link" active={isLink} onClick={()=>cmd('link')}>🔗</TbBtn>
            <TableDropdown onInsert={(r,c)=>cmd('table',{rows:r,cols:c})}/>
            <Divider/>
            <TbBtn title="Insert equation (Ctrl+E)" onClick={() => cmd('math')}>
                <span style={{fontStyle:'italic', fontFamily:'serif', letterSpacing:'-1px', fontSize:'13px'}}>
                    x<sup style={{fontSize:'9px'}}>2</sup>
                </span>
            </TbBtn>
            <Divider/>

            {/* ── Image insert button ── */}
            <TbBtn title="Insert image" onClick={handleImageButtonClick}>
                🖼
            </TbBtn>
            {/* Hidden file input — accepts common image formats */}
            <input
                ref={imageInputRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                style={{ display: 'none' }}
                onChange={handleImageFileChange}
            />

            <Divider/>
            <button
                ref={emojiBtnRef}
                className={`tb-btn${emojiOpen ? ' tb-btn--active' : ''}`}
                title="Insert emoji"
                onMouseDown={e => e.preventDefault()}
                onClick={() => setEmojiOpen(p => !p)}
                style={{fontSize:'16px', fontFamily:"'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',sans-serif"}}
            >
                😀
            </button>
            {emojiOpen && (
                <EmojiPicker
                    anchorRef={emojiBtnRef}
                    onInsert={handleEmojiInsert}
                    onClose={() => setEmojiOpen(false)}
                />
            )}
        </div>
    );
};

export default Toolbar;