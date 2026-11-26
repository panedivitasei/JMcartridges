// Look of the JMcartridges window, light and dark, scoped under `.jm` so nothing here can restyle Steam.
import { JM_LOGO_DARK, JM_LOGO_LIGHT } from "./logo.ts";

const LIGHT = `
  --bg:#FFFFFF; --text:#222222; --body:#444444; --lead:#555555; --label:#666666; --muted:#8A8A8A; --soon:#9A9A9A;
  --line:#E6E6E6; --card-line:#E2E2E2; --input-line:#CFCFCF; --button-line:#D6D6D6; --button-text:#333333;
  --ink:#0D0D0D; --on-ink:#FFFFFF; --green:#738F32; --focus:#111111; --input-bg:#FFFFFF; --hover:#F1F1F1;
  --picked:#EAF2D9; --picked-line:#C8E0A0; --skeleton:#DCDCDC; --red:#8A2E2E;
  --paper:linear-gradient(180deg,#FFFFFF 0%,#ECECEC 90%);
  --card:linear-gradient(180deg,#FFFFFF 0%,#F3F3F3 90%);
  --ink-fill:linear-gradient(180deg,#0D0D0D 0%,#3A3A3A 100%);
  --title:linear-gradient(180deg,#0F0F0F 7%,#2B2B2B 63%,#333333 80%);
  --header:linear-gradient(180deg,#FFFFFF 0%,#F2F2F2 60%,#FFFFFF 100%);
  --well:linear-gradient(180deg,#8C8C8C 0%,#B8B8B8 24%,#E3E3E3 62%,#F0F0F0 88%);
  --chip:linear-gradient(180deg,#FFFFFF 0%,#E4E4E4 90%);
  --art-empty:#EDEDED;
`;

const DARK = `
  --bg:#181818; --text:#ECECEC; --body:#CFCFCF; --lead:#BDBDBD; --label:#A8A8A8; --muted:#8C8C8C; --soon:#6E6E6E;
  --line:#2C2C2C; --card-line:#303030; --input-line:#474747; --button-line:#414141; --button-text:#E0E0E0;
  --ink:#F2F2F2; --on-ink:#111111; --green:#738F32; --focus:#F0F0F0; --input-bg:#121212; --hover:#262626;
  --picked:#26301A; --picked-line:#4A5E24; --skeleton:#333333; --red:#C44848;
  --paper:linear-gradient(180deg,#2C2C2C 0%,#202020 90%);
  --card:linear-gradient(180deg,#1F1F1F 0%,#1A1A1A 90%);
  --ink-fill:linear-gradient(180deg,#F5F5F5 0%,#CFCFCF 100%);
  --title:linear-gradient(180deg,#2B2B2B 7%,#383838 63%,#3E3E3E 80%);
  --header:linear-gradient(180deg,#1B1B1B 0%,#232323 60%,#1B1B1B 100%);
  --well:linear-gradient(180deg,#0C0C0C 0%,#141414 24%,#1E1E1E 62%,#262626 88%);
  --chip:linear-gradient(180deg,#363636 0%,#282828 90%);
  --art-empty:#242424;
`;

export const JM_CSS = `
.jm.jm-light{${LIGHT}}
.jm.jm-dark{${DARK}}
.jm{position:relative;display:flex;flex-direction:column;height:100vh;min-height:0;box-sizing:border-box;background:var(--bg);color:var(--text);
  font-family:"Noto Sans","Motiva Sans","Segoe UI",Arial,sans-serif;font-size:13px;line-height:1.362;text-align:left;overflow:hidden;-webkit-font-smoothing:antialiased}
.jm *,.jm *::before,.jm *::after{box-sizing:border-box}
.jm.jm-inline{display:block;height:auto;overflow:visible;background:transparent}
.jm-float .jm-overlay{position:fixed;inset:0;z-index:50}
.jm-grow{flex:1 1 auto;min-width:0}
.jm-row{display:flex;align-items:center;gap:8px;min-width:0}
.jm-muted{color:var(--muted)}
.jm-label{color:var(--label);font-size:12px;margin:0 0 5px}
.jm-error{color:var(--red);font-size:12px}
.jm-ok{color:var(--green);font-size:12px;font-weight:600}

/* Right padding keeps the header's controls clear of Steam's close button. */
.jm-header{display:flex;align-items:center;gap:14px;padding:14px 48px 14px 24px;background:var(--header);border-bottom:1px solid var(--line);flex:0 0 auto}
/* Steam's draggable title band overlays the header and swallows clicks, so clickable controls are marked no-drag and
   lifted above it, and in the popup (html.jm-popup, set by window.tsx) the band lets clicks through. */
.jm-header .jm-input,.jm-header .jm-btn,.jm-overlay .jm-card{-webkit-app-region:no-drag}
.jm-header .jm-input,.jm-header .jm-btn{position:relative;z-index:3}
html.jm-popup .title-area{pointer-events:none}
html.jm-popup .title-area .title-bar-actions{pointer-events:auto}
.jm-logo{width:92px;height:60px;flex:0 0 auto;background:center/contain no-repeat}
.jm.jm-light .jm-logo{background-image:url(${JM_LOGO_LIGHT})}
.jm.jm-dark .jm-logo{background-image:url(${JM_LOGO_DARK})}

.jm-bar{display:flex;align-items:center;gap:14px;padding:12px 24px;flex:0 0 auto;border-bottom:1px solid var(--line)}
.jm-summary{font-size:14px;color:var(--body);white-space:nowrap}
.jm-progress{flex:1 1 auto;display:flex;align-items:center;gap:10px;min-width:0}
.jm-track{flex:1 1 auto;height:10px;background:var(--well);border:1px solid var(--input-line);min-width:40px}
.jm-fill{height:100%;background:linear-gradient(180deg,#738F32 0%,#8EDB46 100%);transition:width .2s linear}
.jm-progress-text{font-size:12px;color:var(--label);white-space:nowrap}

.jm-main{display:flex;gap:24px;padding:20px 24px 24px;flex:1 1 auto;min-height:0}
.jm-card{display:flex;flex-direction:column;min-height:0;background:var(--card);border:1px solid var(--card-line)}
.jm-card-title{display:flex;align-items:center;gap:10px;height:30px;flex:0 0 30px;padding:0 12px;background:var(--title);color:#FFFFFF;font-size:13px;white-space:nowrap}
.jm-card-title .jm-side{margin-left:auto;color:#BDBDBD;font-size:12px;overflow:hidden;text-overflow:ellipsis}
.jm-card-body{padding:14px;overflow-y:auto;overflow-x:hidden;min-height:0;flex:1 1 auto}
.jm-list{flex:0 0 340px}
.jm-detail{flex:1 1 auto;min-width:0}

.jm-btn{display:inline-flex;align-items:center;justify-content:center;min-width:96px;height:36px;padding:0 18px;border:1px solid var(--button-line);border-radius:0;
  background:var(--paper);color:var(--button-text);font:inherit;font-size:13px;cursor:pointer;white-space:nowrap;outline:none;margin:0}
.jm-btn:hover:not(:disabled){background:var(--ink-fill);border-color:var(--ink);color:var(--on-ink)}
.jm-btn:focus-visible{box-shadow:0 0 0 2px var(--bg),0 0 0 4px var(--focus)}
.jm-btn:disabled{opacity:.45;cursor:default}
.jm-btn.jm-primary{background:var(--ink-fill);border-color:var(--ink);color:var(--on-ink);font-weight:600}
.jm-btn.jm-primary:hover:not(:disabled){background:linear-gradient(180deg,#738F32 0%,#8EDB46 100%);border-color:var(--green);color:#FFFFFF}
.jm-btn.jm-small{min-width:0;height:28px;padding:0 12px;font-size:12px}
.jm-link{border:0;background:none;padding:0;margin:0;font:inherit;font-size:12px;color:var(--label);cursor:pointer;text-decoration:underline;outline:none}
.jm-link:hover:not(:disabled){color:var(--text)}
.jm-link:disabled{opacity:.45;cursor:default;text-decoration:none}

.jm-seg{display:inline-flex}
.jm-seg button{height:24px;min-width:0;padding:0 10px;white-space:nowrap;border:1px solid #5A5A5A;border-left-width:0;border-radius:0;background:transparent;color:#DADADA;font:inherit;font-size:12px;cursor:pointer;outline:none;margin:0}
.jm-seg button:first-child{border-left-width:1px}
.jm-seg button.jm-on{background:#F2F2F2;color:#111111;border-color:#F2F2F2}
.jm-seg.jm-plain button{height:30px;padding:0 14px;border-color:var(--button-line);background:var(--paper);color:var(--button-text)}
.jm-seg.jm-plain button.jm-on{background:var(--ink-fill);color:var(--on-ink);border-color:var(--ink)}

.jm-input,.jm-textarea{width:100%;height:32px;padding:7px 9px;border:1px solid var(--input-line);border-radius:0;background:var(--input-bg);color:var(--text);font:inherit;font-size:13px;outline:none;margin:0}
.jm-textarea{height:auto;min-height:96px;resize:vertical;line-height:1.45}
.jm-input:focus,.jm-textarea:focus{box-shadow:0 0 0 2px var(--bg),0 0 0 4px var(--focus)}
.jm-input::placeholder,.jm-textarea::placeholder{color:var(--soon)}
.jm-search{width:280px;height:36px}

.jm-dot{width:15px;height:15px;flex:0 0 15px;border-radius:50%;border:2px solid #8C8C8C;background:var(--well)}
.jm-dot.jm-on{border-color:var(--green);background:linear-gradient(180deg,#738F32 0%,#8EDB46 100%)}
.jm-check{display:flex;align-items:center;gap:8px;cursor:pointer;color:var(--body);user-select:none}

.jm-chip{display:inline-flex;align-items:center;height:22px;padding:0 8px;border:1px solid var(--button-line);background:var(--chip);color:var(--body);font-size:12px;white-space:nowrap}
.jm-chip.jm-ready{background:linear-gradient(180deg,#738F32 0%,#8EDB46 100%);border-color:var(--green);color:#FFFFFF}
.jm-chip.jm-ask{background:var(--ink-fill);border-color:var(--ink);color:var(--on-ink)}

.jm-list .jm-card-body{padding:0}
.jm-game{display:flex;align-items:center;gap:10px;width:100%;padding:8px 12px;border:0;border-bottom:1px solid var(--line);border-left:3px solid transparent;background:transparent;color:var(--text);
  font:inherit;text-align:left;cursor:pointer;outline:none;margin:0;border-radius:0}
.jm-game:hover{background:var(--hover)}
.jm-game.jm-picked{background:var(--picked);border-left-color:var(--green)}
.jm-game-name{flex:1 1 auto;min-width:0;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.jm-thumb{width:32px;height:48px;flex:0 0 32px;background:var(--art-empty) center/cover no-repeat;border:1px solid var(--card-line)}
.jm-empty{padding:28px 14px;color:var(--muted);text-align:center}

.jm-section{margin:0 0 18px}
.jm-section-head{display:flex;align-items:center;gap:10px;margin:0 0 8px;padding:0 0 6px;border-bottom:1px solid var(--line)}
.jm-section-head h3{margin:0;font-size:13px;font-weight:600;color:var(--text);text-transform:none;letter-spacing:0}

.jm-cols{display:flex;flex-wrap:wrap;gap:0 24px}
.jm-foot.jm-cols{flex-wrap:wrap;gap:0 24px;align-items:center}
.jm-col{flex:1 1 420px;min-width:0}
.jm-preview{position:relative;height:150px;background:var(--art-empty) center/cover no-repeat;border:1px solid var(--card-line);overflow:hidden}
.jm-preview-shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0) 45%,rgba(0,0,0,.72) 100%)}
.jm-preview-logo{position:absolute;left:18px;bottom:16px;max-width:42%;max-height:58%;object-fit:contain;object-position:left bottom}
.jm-preview-title{position:absolute;left:18px;bottom:14px;right:18px;color:#FFFFFF;font-size:26px;font-weight:600;text-shadow:0 1px 3px rgba(0,0,0,.7);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.jm-preview-info{display:flex;gap:14px;padding:12px 0 0}
.jm-preview-portrait{width:74px;height:111px;flex:0 0 74px;background:var(--art-empty) center/cover no-repeat;border:1px solid var(--card-line)}
.jm-preview-text{flex:1 1 auto;min-width:0}
.jm-preview-name{font-size:16px;font-weight:600;margin:0 0 4px;color:var(--text)}
.jm-preview-meta{font-size:12px;color:var(--label);margin:0 0 6px}
.jm-preview-desc{color:var(--body);display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-line}

.jm-art{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start}
.jm-tile{display:flex;flex-direction:column;gap:6px;min-width:0}
.jm-tile-pic{position:relative;display:block;height:108px;padding:0;margin:0;border:1px solid var(--card-line);border-radius:0;background:var(--art-empty) center/cover no-repeat;cursor:pointer;outline:none}
.jm-tile-pic.jm-contain{background-size:contain}
.jm-tile-pic.jm-none{display:flex;align-items:center;justify-content:center;width:100%;color:var(--muted);font:inherit;font-size:12px;white-space:nowrap}
.jm-tile-pic:hover{border-color:var(--ink)}
.jm-tile-pic:focus-visible{box-shadow:0 0 0 2px var(--bg),0 0 0 4px var(--focus)}
.jm-tile-pic.jm-checker{background-color:var(--art-empty);background-image:none}
.jm-tile-foot{display:flex;flex-direction:column;gap:2px;font-size:12px;color:var(--label);white-space:nowrap}
.jm-tile-foot b{font-weight:600;color:var(--text)}
.jm-tile-links{display:flex;flex-wrap:wrap;gap:2px 10px}

.jm-form{display:grid;grid-template-columns:1fr 1fr;gap:12px 14px}
.jm-form .jm-wide{grid-column:1 / -1}
.jm-field{min-width:0}
.jm-actions{display:flex;align-items:center;gap:10px;margin-top:14px}

.jm-results{margin-top:8px;border:1px solid var(--line);max-height:168px;overflow-y:auto}
.jm-result{display:flex;align-items:center;gap:10px;padding:6px 10px;border-bottom:1px solid var(--line)}
.jm-result:last-child{border-bottom:0}
.jm-result-details{margin-left:8px;font-size:12px}

.jm-overlay{position:absolute;inset:0;z-index:5;display:flex;align-items:center;justify-content:center;padding:32px;background:rgba(0,0,0,.45)}
.jm-overlay .jm-card{width:100%;max-width:880px;max-height:100%;background:var(--card);box-shadow:0 12px 40px rgba(0,0,0,.35)}
.jm-overlay .jm-card.jm-narrow{max-width:520px}
.jm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px}
.jm-grid.jm-grid-wide{grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}
.jm-option{position:relative;display:block;width:100%;padding:0;margin:0;border:1px solid var(--card-line);border-radius:0;background:var(--art-empty);cursor:pointer;outline:none;overflow:hidden}
.jm-option img{display:block;width:100%;height:100%;object-fit:cover}
.jm-option.jm-contain img{object-fit:contain}
.jm-option.jm-picked{outline:3px solid var(--green);outline-offset:-3px}
.jm-option:hover{border-color:var(--ink)}
.jm-option-tag{position:absolute;left:0;bottom:0;padding:1px 6px;background:rgba(0,0,0,.66);color:#FFFFFF;font-size:11px}
.jm-foot{display:flex;align-items:center;gap:10px;padding:12px 14px;border-top:1px solid var(--line);flex:0 0 auto;flex-wrap:wrap}
.jm-opt-row{display:flex;align-items:center;gap:12px;margin:0 0 12px}
.jm-opt-row > .jm-opt-name{flex:0 0 150px;color:var(--label);font-size:12px}
.jm-opt-row > .jm-input.jm-short{flex:0 0 90px;width:90px}
.jm-source{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--line);color:var(--body)}
/* Chip that opens a menu (widgets.tsx Select). */
.jm-select{position:relative;display:inline-flex;flex:0 0 auto}
.jm-select-button{display:inline-flex;align-items:center;gap:7px;cursor:pointer;font:inherit;font-size:12px}
.jm-select-button:disabled{cursor:default;opacity:.6}
.jm-select-mark{width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid currentColor}
.jm-select-list{position:absolute;top:calc(100% + 2px);left:0;z-index:6;min-width:100%;display:flex;flex-direction:column;background:var(--card);border:1px solid var(--input-line);box-shadow:0 8px 20px rgba(0,0,0,.4)}
.jm-select-list button{height:30px;padding:0 12px;border:0;border-radius:0;background:transparent;color:var(--body);font:inherit;font-size:13px;text-align:left;white-space:nowrap;cursor:pointer}
.jm-select-list button:hover{background:var(--well)}
.jm-select-list button.jm-on{color:var(--text);font-weight:600}
.jm-source-block{margin:0 0 14px}
.jm-source-block.jm-held{opacity:.6}
.jm-source-name{display:flex;align-items:center;gap:10px;min-width:0}
/* Grip a source is dragged by, drawn as three short lines. */
.jm-grip{flex:0 0 14px;width:14px;height:14px;cursor:grab;touch-action:none;opacity:.55;background:linear-gradient(var(--body),var(--body)) 0 2px/100% 2px no-repeat,linear-gradient(var(--body),var(--body)) 0 6px/100% 2px no-repeat,linear-gradient(var(--body),var(--body)) 0 10px/100% 2px no-repeat}
.jm-grip.jm-fixed{visibility:hidden;cursor:default}
.jm-grip:hover,.jm-held .jm-grip{opacity:1}
.jm-held .jm-grip{cursor:grabbing}
.jm-source-block .jm-form{margin:10px 0 0}
.jm-check.jm-off{cursor:default;opacity:.55}
.jm-input.jm-bad{border-color:var(--red)}
.jm-input.jm-kept::placeholder{color:var(--body);letter-spacing:2px}

.jm-panel{display:flex;align-items:center;gap:14px;padding:12px 14px;margin:0 0 12px;background:var(--card);border:1px solid var(--card-line);color:var(--text)}
.jm-panel .jm-logo{width:71px;height:46px}
`;
