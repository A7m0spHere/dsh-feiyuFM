// PHL-inspired tokens and timing. Source/provenance: THIRD_PARTY_NOTICES.md.
export const css = `
  .fishfm,.fm-float {
    --fm-canvas:hsl(220 20% 96%); --fm-surface:hsl(0 0% 100%);
    --fm-raised:hsl(0 0% 100%); --fm-sunken:hsl(220 20% 97%);
    --fm-hover:hsl(220 24% 95.5%); --fm-line:hsl(220 16% 90%);
    --fm-line-strong:hsl(220 14% 82%); --fm-ink:hsl(222 30% 13%);
    --fm-muted:hsl(220 10% 38%); --fm-faint:hsl(220 10% 45%);
    --fm-accent:hsl(219 84% 55%); --fm-accent-hover:hsl(219 84% 50%);
    --fm-accent-soft:hsl(219 84% 96%); --fm-accent-ink:hsl(219 74% 42%);
    --fm-on-accent:white; --fm-ok:hsl(152 62% 38%);
    --fm-warn:hsl(33 92% 46%); --fm-danger:hsl(356 70% 51%);
    --fm-shadow:0 8px 28px hsl(222 44% 22% / .08);
    --fm-popup-shadow:0 12px 38px hsl(222 44% 22% / .16);
    --fm-ease:cubic-bezier(.22,.61,.36,1);
    --fm-spring:cubic-bezier(.2,.8,.3,1.15);
    --fm-press:90ms; --fm-fast:160ms; --fm-base:220ms; --fm-page:260ms;
    --fm-sheen:650ms; --fm-motion-shift:6px;
    box-sizing:border-box; color:var(--fm-ink); font-family:inherit; font-size:13px; line-height:1.5;
    color-scheme:light;
  }
  :is([data-ds-dark-theme],.dark,[data-theme=dark]) :is(.fishfm,.fm-float),
  :is(.fishfm,.fm-float)[data-theme=dark] {
    --fm-canvas:hsl(224 18% 8%); --fm-surface:hsl(222 16% 12.5%);
    --fm-raised:hsl(222 15% 15%); --fm-sunken:hsl(224 18% 10%);
    --fm-hover:hsl(222 14% 18%); --fm-line:hsl(222 12% 21%);
    --fm-line-strong:hsl(222 10% 30%); --fm-ink:hsl(220 22% 93%);
    --fm-muted:hsl(220 9% 64%); --fm-faint:hsl(220 8% 56%);
    --fm-accent:hsl(216 88% 62%); --fm-accent-hover:hsl(216 88% 67%);
    --fm-accent-soft:hsl(216 60% 20%); --fm-accent-ink:hsl(216 88% 72%);
    --fm-on-accent:hsl(220 40% 8%); --fm-ok:hsl(152 55% 46%);
    --fm-warn:hsl(36 90% 56%); --fm-danger:hsl(356 72% 60%);
    --fm-shadow:0 8px 28px hsl(224 60% 2% / .2);
    --fm-popup-shadow:0 12px 38px hsl(224 60% 2% / .4); color-scheme:dark;
  }
  :is(.fishfm,.fm-float)[data-motion=reduced] {
    --fm-press:50ms; --fm-fast:88ms; --fm-base:121ms; --fm-page:143ms;
    --fm-sheen:358ms; --fm-motion-shift:2px;
  }
  :is(.fishfm,.fm-float)[data-motion=off] {
    --fm-press:0ms; --fm-fast:0ms; --fm-base:0ms; --fm-page:0ms; --fm-motion-shift:0px;
  }
  :is(.fishfm,.fm-float) * { box-sizing:border-box; }
  :is(.fishfm,.fm-float) button,:is(.fishfm,.fm-float) input,
  :is(.fishfm,.fm-float) select { font:inherit; }
  :is(.fishfm,.fm-float) button { cursor:pointer; }
  :is(.fishfm,.fm-float) button:disabled { opacity:.45; cursor:default; }
  :is(.fishfm,.fm-float) :focus-visible { outline:2px solid var(--fm-accent); outline-offset:3px; }
  .fishfm { container-type:inline-size; container-name:fishfm; width:100%;
    max-width:1120px; margin:auto; padding:16px; background:var(--fm-canvas);
    height:100%; min-height:0; overflow:auto; overscroll-behavior:contain;
    animation:fm-page-in var(--fm-page) var(--fm-ease) both; }
  .fishfm h1,.fishfm h2,.fishfm p { margin:0; }
  .fm-doll-anchor { position:sticky; top:0; height:0; z-index:5; pointer-events:none; }
  .fm-doll-layer { display:block; position:absolute; top:0; left:0; pointer-events:none; }
  .fm-art .fm-effects-toggle { position:relative; margin-top:8px; z-index:6; }
  .fm-effects-toggle::before { content:''; position:absolute; inset:-5px; }
  .fm-top { display:flex; align-items:flex-start; flex-wrap:wrap; gap:12px;
    margin-bottom:12px; }
  .fm-heading { display:flex; align-items:center; gap:10px; min-width:0; flex:1; }
  .fm-brand { display:grid; place-items:center; width:36px; height:36px;
    flex:none; border-radius:9px; background:var(--fm-accent-soft); color:var(--fm-accent-ink); }
  .fishfm .fm-eyebrow { color:var(--fm-faint); font-size:10px; letter-spacing:.12em; }
  .fishfm h1 { font-size:20px; font-weight:650; letter-spacing:-.3px; }
  .fm-subtitle { margin-top:2px!important; color:var(--fm-muted); font-size:12px; }
  .fm-top-actions { display:flex; gap:6px; flex-wrap:wrap; }
  .fm-button { position:relative; display:inline-flex; align-items:center;
    justify-content:center; gap:7px; min-height:34px; padding:6px 12px; border:1px solid var(--fm-line);
    border-radius:7px; background:var(--fm-surface); color:var(--fm-ink);
    font-size:12px; font-weight:500; transition:background-color var(--fm-fast) var(--fm-ease),
    border-color var(--fm-fast) var(--fm-ease),transform var(--fm-press) var(--fm-ease); }
  .fm-button:hover:not(:disabled) { background:var(--fm-hover); border-color:var(--fm-line-strong); }
  .fm-button:active:not(:disabled),.fm-float-icon:active:not(:disabled) { transform:scale(.97); }
  .fm-primary { background:var(--fm-accent); border-color:transparent; color:var(--fm-on-accent); overflow:hidden; }
  .fm-primary:hover:not(:disabled) { background:var(--fm-accent-hover); border-color:transparent; }
  .fm-primary:after { content:''; pointer-events:none; position:absolute; inset:0;
    background:linear-gradient(110deg,transparent 20%,color-mix(in srgb,var(--fm-on-accent) 20%,transparent) 50%,transparent 80%);
    transform:translateX(-120%); transition:transform var(--fm-sheen) var(--fm-ease); }
  .fm-primary:hover:after { transform:translateX(120%); }
  .fm-widget-pref[aria-pressed=true] { color:var(--fm-accent-ink); background:var(--fm-accent-soft); }
  .fm-hero { display:grid; grid-template-columns:minmax(0,1fr) 88px; align-items:center; gap:10px 14px;
    padding:16px; margin-bottom:12px; background:var(--fm-surface); border:1px solid var(--fm-line);
    border-radius:12px; box-shadow:var(--fm-shadow); animation:fm-rise var(--fm-page) var(--fm-ease) both; }
  .fm-art { grid-column:2; grid-row:1 / span 2; display:grid; place-items:center;
    background:transparent; }
  .fm-art img { width:88px; height:106px; object-fit:contain; animation:fm-swap var(--fm-base) var(--fm-ease); }
  .fm-art picture,.fm-float-art picture { display:block; width:100%; }
  .fm-hero-copy { grid-column:1; grid-row:1; min-width:0; }
  .fm-live,.fm-float-status { display:flex; align-items:center; gap:7px; color:var(--fm-muted); font-size:11px; }
  .fm-dot,.fm-float-dot { display:inline-block; width:6px; height:6px; flex:none;
    border-radius:50%; background:var(--fm-ok); }
  .fm-dot[data-off=true],.fm-float-dot[data-off=true] { background:var(--fm-warn); }
  .fm-track { margin:6px 0 3px!important; font-size:22px; font-weight:650;
    letter-spacing:-.5px; line-height:1.3; overflow-wrap:anywhere; }
  .fm-artist { color:var(--fm-muted); font-size:12px; }
  .fm-track-swap { animation:fm-swap var(--fm-fast) var(--fm-ease) both; }
  .fm-progress { height:4px; overflow:hidden; margin:10px 0 5px; border-radius:99px; background:var(--fm-line); }
  .fm-progress span { display:block; height:100%; border-radius:inherit; background:var(--fm-accent);
    transition:width var(--fm-fast) linear; }
  .fm-time { display:flex; justify-content:space-between; gap:8px; color:var(--fm-faint);
    font-size:10px; font-variant-numeric:tabular-nums; }
  .fm-controls { grid-column:1; display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
  .fm-controls .fm-feedback-actions { margin-left:auto; }
  .fm-track-origin { text-align:center; overflow-wrap:anywhere; }
  .fm-feedback-note { grid-column:1/-1; color:var(--fm-muted); font-size:11px; overflow-wrap:anywhere; }
  .fm-wave { display:flex; align-items:center; gap:2px; height:12px; }
  .fm-wave i { width:2px; height:8px; background:var(--fm-ok); border-radius:2px;
    animation:fm-wave 850ms ease-in-out infinite alternate; }
  .fm-wave i:nth-child(2) { animation-delay:-300ms; height:12px; }
  .fm-wave i:nth-child(3) { animation-delay:-550ms; }
  .fm-grid { display:grid; grid-template-columns:minmax(0,1fr) minmax(300px,.7fr); align-items:start; gap:12px; }
  .fm-management { display:grid; grid-template-columns:minmax(0,1.15fr) minmax(0,1fr) minmax(0,1fr); align-items:start; gap:12px; margin-top:12px; }
  .fm-management>section>h2 { margin-top:0; }
  .fm-main-column,.fm-controls-column { min-width:0; }
  .fm-grid>*>section:first-child h2 { margin-top:0; }
  .fishfm section { min-width:0; }
  .fishfm h2 { display:flex; gap:8px; align-items:baseline; margin:12px 0 6px;
    font-size:13px; font-weight:600; }
  .fishfm h2 small { color:var(--fm-faint); font-size:9px; font-weight:500; letter-spacing:.1em; }
  .fm-card { padding:4px 14px; border:1px solid var(--fm-line); border-radius:9px; background:var(--fm-surface); }
  .fm-persona-card { padding:12px; }
  .fm-recommendation-status { margin:8px 0!important; padding:7px 9px; border-radius:6px; background:var(--fm-sunken); color:var(--fm-muted); font-size:11px; overflow-wrap:anywhere; }
  .fm-error-details { margin-top:6px; font-size:10px; }
  .fm-picks-head { display:flex; align-items:center; flex-wrap:wrap; gap:8px; }
  .fm-picks-head .fm-note { flex:1 1 160px; }
  .fm-picks { margin:8px 0; }
  .fm-pick { display:flex; align-items:center; gap:9px; width:100%; padding:7px 0; text-align:left;
    color:var(--fm-ink); background:transparent; border:0; border-bottom:1px solid var(--fm-line); }
  .fm-pick:last-child { border-bottom:0; }
  .fm-pick:hover:not(:disabled) { color:var(--fm-accent-ink); }
  .fm-pick-index { flex:none; width:16px; color:var(--fm-faint); font-size:10px; }
  .fm-pick-copy { min-width:0; flex:1; }
  .fm-pick-copy strong,.fm-pick-copy>span { display:block; overflow-wrap:anywhere; }
  .fm-pick-copy strong { font-size:12px; font-weight:550; }
  .fm-pick-copy>span { color:var(--fm-muted); font-size:11px; }
  .fm-pick-copy .fm-pick-reason { margin-top:3px; font-size:10px; }
  .fm-pick-play { flex:none; font-size:10px; color:var(--fm-accent-ink); }
  .fm-section-head { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; }
  .fm-facts { display:flex; flex-wrap:wrap; gap:5px; margin:8px 0; }
  .fm-fact { padding:3px 7px; border-radius:6px; background:var(--fm-sunken); color:var(--fm-muted); font-size:11px; overflow-wrap:anywhere; min-width:0; }
  .fm-summary { padding-top:10px; border-top:1px solid var(--fm-line); margin-top:10px; }
  .fishfm .fm-summary-text { margin:8px 0; white-space:pre-wrap; overflow-wrap:anywhere; line-height:1.65; font-size:13px; }
  .fm-summary-actions { display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin-top:8px; }
  .fm-summary-actions select { flex:1 1 180px; min-width:0; width:100%; max-width:100%; min-height:34px; padding:6px 9px; color:var(--fm-ink); background:var(--fm-surface); border:1px solid var(--fm-line); border-radius:7px; }
  .fm-token-strip { display:grid; grid-template-columns:1fr 1fr; gap:5px 12px; padding:10px; margin:10px 0 4px; background:var(--fm-sunken); border-radius:7px; }
  .fm-token-strip div { display:flex; align-items:baseline; flex-wrap:wrap; gap:3px 8px; min-width:0; }
  .fm-token-strip span,.fm-token-strip p { color:var(--fm-muted); font-size:10px; overflow-wrap:anywhere; }
  .fm-token-strip strong { font-size:16px; font-weight:600; font-variant-numeric:tabular-nums; overflow-wrap:anywhere; }
  .fm-token-strip small { font-size:10px; color:var(--fm-faint); font-weight:400; }
  .fm-token-strip p { grid-column:1/-1; }
  .fishfm details>summary { cursor:pointer; font-size:12px; line-height:1.7; overflow-wrap:anywhere; }
  .fm-disclosure { border-top:1px solid var(--fm-line); }
  .fm-disclosure:first-of-type { border-top:0; }
  .fm-disclosure>summary { padding:8px 0; }
  .fm-disclosure-meta { margin-left:8px; color:var(--fm-faint); font-size:10px; font-weight:400; }
  .fm-disclosure-body { padding-bottom:10px; }
  .fm-check-row { display:flex; align-items:center; gap:8px; font-size:12px; }
  .fm-check-row input { margin:0; accent-color:var(--fm-accent); }
  .fm-budget-row { display:flex; align-items:flex-end; flex-wrap:wrap; gap:8px; padding:8px 0; }
  .fm-budget-row label { display:flex; flex:1 1 180px; align-items:center; justify-content:space-between; gap:12px; }
  .fishfm input[type=number] { width:100px; min-width:0; min-height:34px; padding:6px 8px; color:var(--fm-ink); background:var(--fm-surface); border:1px solid var(--fm-line); border-radius:7px; }
  .fm-call-history { padding:12px 0 0; }
  .fm-call { margin-top:10px; padding:10px; background:var(--fm-sunken); border-radius:6px; overflow-wrap:anywhere; }
  .fm-call .fm-note { margin-bottom:0!important; }
  .fm-input-library { padding:9px 12px; border:1px solid var(--fm-line); border-radius:9px; background:var(--fm-surface); }
  .fm-input-library>summary { font-weight:550; }
  .fm-input-library[open]>summary { margin-bottom:8px; }
  .fm-platform-details { margin-top:8px; }
  .fm-platform-details section>h2 { display:none; }
  .fm-platform-details .fm-card { padding:0; border:0; }
  .fm-platform-details .fm-platform-actions { width:100%; min-width:0; }
  .fm-platform-actions select { max-width:100%; min-width:0; min-height:32px; padding:5px 8px; border:1px solid var(--fm-line); border-radius:6px; background:var(--fm-surface); color:var(--fm-ink); }
  .fm-profile-details>summary,.fm-interface-details>summary { padding:8px 0; font-weight:550; }
  .fm-interface-details { margin-top:0; }
  .fm-reply { grid-column:1/-1; border-top:1px solid var(--fm-line); padding-top:10px; min-width:0; }
  .fm-reply .fm-label { display:inline; margin-right:8px; color:var(--fm-accent-ink); font-size:11px; }
  .fishfm .fm-reply-text { display:inline; font-size:12px; line-height:1.6; overflow-wrap:anywhere; }
  .fm-reply details { color:var(--fm-muted); font-size:11px; }
  .fm-reply details { margin-top:6px; }
  .fm-reply details p { margin-top:6px; overflow-wrap:anywhere; }
  .fm-feedback-actions { display:flex; flex-wrap:wrap; gap:7px; }
  .fm-feedback-button[aria-pressed=true] { background:var(--fm-accent-soft); color:var(--fm-accent-ink); border-color:var(--fm-accent); }
  .fm-reset-confirm { padding:12px; border:1px solid var(--fm-line); border-radius:7px; background:var(--fm-sunken); }
  .fm-reset-confirm .fm-check-row { margin:10px 0; align-items:flex-start; font-size:11px; }
  .fm-reset-confirm input { flex:none; margin-top:2px; }
  .fm-model-playlist { margin:10px 0; border:1px solid var(--fm-line); border-radius:7px; overflow:hidden; }
  .fm-recommended-tracks>summary { padding:6px 0; color:var(--fm-muted); }
  .fm-model-song { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:7px 9px; border-bottom:1px solid var(--fm-line); }
  .fm-model-song:last-child { border-bottom:0; }
  .fm-model-song div { min-width:0; }
  .fm-model-song strong,.fm-model-song div>span { display:block; overflow-wrap:anywhere; }
  .fm-model-song strong { font-size:12px; font-weight:500; }
  .fm-model-song div>span { margin-top:3px; font-size:10px; color:var(--fm-muted); }
  .fm-row { display:flex; align-items:center; justify-content:space-between; gap:14px;
    padding:9px 0; border-bottom:1px solid var(--fm-line); }
  .fm-label { font-size:12px; font-weight:550; }
  .fm-row>div { min-width:0; }
  .fm-row p { margin-top:3px; color:var(--fm-muted); font-size:11px; overflow-wrap:anywhere; }
  .fm-profile-details .fm-row { flex-wrap:wrap; gap:6px; }
  .fm-profile-details .fm-row>span { overflow-wrap:anywhere; min-width:0; }
  .fm-toggle { width:32px; height:19px; padding:2px; border:0; border-radius:99px;
    flex:none; background:var(--fm-line-strong); transition:background var(--fm-fast) var(--fm-ease); }
  .fm-toggle[aria-checked=true] { background:var(--fm-accent); }
  .fm-toggle span { display:block; width:15px; height:15px; border-radius:50%; background:white;
    box-shadow:0 1px 3px hsl(222 44% 22% / .2); transition:transform var(--fm-base) var(--fm-spring); }
  .fm-toggle[aria-checked=true] span { transform:translateX(13px); }
  .fm-rate { padding:9px 0; }
  .fm-rate-head,.fm-save-line { display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .fm-rate-head output { color:var(--fm-accent-ink); font-size:11px; font-variant-numeric:tabular-nums; }
  .fm-rate input { display:block; width:100%; height:4px; margin:11px 0; accent-color:var(--fm-accent); }
  .fm-save-line { align-items:flex-start; }
  .fm-save { color:var(--fm-muted); font-size:10px; overflow-wrap:anywhere; }
  .fm-modes { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:5px; }
  .fm-mode { position:relative; display:grid; place-items:center;
    min-height:36px; padding:6px; border:1px solid var(--fm-line); border-radius:7px;
    text-align:center; background:var(--fm-surface); color:var(--fm-ink);
    transition:background var(--fm-base) var(--fm-ease),border-color var(--fm-base) var(--fm-ease),transform var(--fm-press) var(--fm-ease); }
  .fm-mode strong { font-size:12px; font-weight:550; }
  .fm-mode span { position:absolute; width:1px; height:1px; padding:0; margin:-1px;
    overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
  .fm-mode:hover:not(:disabled) { background:var(--fm-hover); }
  .fm-mode:active:not(:disabled) { transform:scale(.98); }
  .fm-mode[data-selected=true] { border-color:var(--fm-accent); background:var(--fm-accent-soft); }
  .fm-mode[data-selected=true] strong { color:var(--fm-accent-ink); }
  .fm-platform { display:flex; flex-wrap:wrap; align-items:center; gap:9px;
    padding:9px 0; border-bottom:1px solid var(--fm-line); }
  .fm-platform:last-child { border-bottom:0; }
  .fm-platform-mark { display:grid; place-items:center; width:26px; height:26px;
    border-radius:6px; background:var(--fm-sunken); color:var(--fm-accent-ink); font-size:12px; }
  .fm-platform-name { display:flex; align-items:center; gap:9px; flex:1; min-width:100px; font-size:12px; font-weight:500; }
  .fm-platform-actions { display:flex; flex-wrap:wrap; align-items:center; gap:6px; }
  .fm-badge { padding:2px 6px; border:1px solid var(--fm-line); border-radius:5px;
    color:var(--fm-muted); font-size:10px; white-space:nowrap; }
  .fm-badge[data-ok=true] { color:var(--fm-ok); background:color-mix(in srgb,var(--fm-ok) 8%,var(--fm-surface)); }
  .fm-platform-note,.fm-note { margin:7px 0!important; color:var(--fm-muted); font-size:11px; line-height:1.6; overflow-wrap:anywhere; }
  .fm-notice,.fm-import { padding:10px 12px; margin:10px 0; background:var(--fm-accent-soft);
    color:var(--fm-accent-ink); border:1px solid var(--fm-line); border-radius:7px; font-size:11px;
    overflow-wrap:anywhere; animation:fm-swap var(--fm-fast) var(--fm-ease); }
  .fm-notice[data-error=true] { background:color-mix(in srgb,var(--fm-danger) 8%,var(--fm-surface)); color:var(--fm-danger); }
  .fm-login { padding:14px; margin:10px 0; background:var(--fm-sunken);
    border:1px solid var(--fm-line); border-radius:8px; text-align:center; font-size:12px; }
  .fm-login img { display:block; width:170px; height:170px; max-width:100%; margin:12px auto; border-radius:5px; }
  .fm-login .fm-button { margin:8px 3px 0; }
  .fm-attempts { margin:8px 0; font-size:10px; color:var(--fm-muted); }
  .fm-attempts-title { margin:6px 0; font-weight:550; }
  .fm-attempt { display:flex; align-items:center; justify-content:space-between; padding:7px 0; border-top:1px solid var(--fm-line); }
  .fm-attempt-note { margin-left:8px; color:var(--fm-faint); }
  .fm-motion-row { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px; padding:8px 0; }
  .fm-motion-row select { padding:5px 8px; border:1px solid var(--fm-line); border-radius:6px;
    color:var(--fm-ink); background:var(--fm-surface); font-size:11px; }
  .fm-widget-note { display:flex; gap:8px; align-items:center; padding:8px 0; color:var(--fm-muted); font-size:11px; }
  .fm-widget-note .fm-button { margin-left:auto; }
  .fm-foot { display:flex; flex-wrap:wrap; justify-content:space-between; gap:8px;
    margin-top:14px; padding-top:10px; border-top:1px solid var(--fm-line); color:var(--fm-faint); font-size:10px; }
  .fm-library-head { display:flex; align-items:center; flex-wrap:wrap; justify-content:space-between; gap:8px; margin:18px 0 8px; }
  .fm-library-head h2 { margin:0; }
  .fm-library-search { width:min(220px,100%); min-height:32px; padding:6px 10px;
    border:1px solid var(--fm-line); border-radius:7px; background:var(--fm-surface); color:var(--fm-ink); font-size:12px; }
  .fm-library-list { border:1px solid var(--fm-line); border-radius:9px; overflow:hidden; background:var(--fm-surface); }
  .fm-song { display:flex; align-items:center; gap:9px; width:100%; padding:8px 10px;
    border:0; border-bottom:1px solid var(--fm-line); text-align:left; background:transparent; color:var(--fm-ink);
    transition:background var(--fm-fast) var(--fm-ease); }
  .fm-song:last-child { border-bottom:0; }
  .fm-song:hover:not(:disabled) { background:var(--fm-hover); }
  .fm-song[data-current=true] { background:var(--fm-accent-soft); }
  .fm-song-index { width:24px; flex:none; text-align:center; color:var(--fm-faint); font-size:10px; }
  .fm-song-copy { display:block; min-width:0; flex:1; }
  .fm-song-title,.fm-song-artist { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .fm-song-title { font-size:12px; font-weight:500; }
  .fm-song-artist { margin-top:2px; color:var(--fm-muted); font-size:10px; }
  .fm-song-duration { color:var(--fm-faint); font-variant-numeric:tabular-nums; font-size:10px; }
  .fm-song svg { color:var(--fm-accent-ink); }
  .fm-library-empty { padding:24px 16px; text-align:center; color:var(--fm-muted); font-size:12px; }
  .fm-library-foot { display:flex; justify-content:space-between; align-items:center; gap:10px;
    margin-top:8px; color:var(--fm-faint); font-size:10px; }
  .fm-library-pages { display:flex; align-items:center; gap:7px; }
  .fm-library-pages .fm-button { min-height:28px; padding:3px 8px; font-size:11px; }
  .fm-float { position:absolute; z-index:25; pointer-events:auto; width:310px; max-width:calc(100% - 24px); }
  .fm-float-pill { display:flex; align-items:center; gap:6px; padding:6px;
    border:1px solid var(--fm-line); border-radius:11px; background:var(--fm-raised); box-shadow:var(--fm-popup-shadow); }
  .fm-float-art { display:grid; place-items:center; width:34px; height:38px; flex:none;
    background:transparent; }
  .fm-float-art img { display:block; width:34px; height:38px; object-fit:contain; animation:fm-swap var(--fm-fast) var(--fm-ease); }
  .fm-float-trigger { display:flex; align-items:center; gap:8px; min-width:0; flex:1; padding:0;
    border:0; background:transparent; color:inherit; text-align:left; }
  .fm-float-copy { display:block; min-width:0; flex:1; }
  .fm-float-title,.fm-float-artist { display:block; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
  .fm-float-title { font-size:11px; font-weight:550; line-height:1.35; }
  .fm-float-artist { margin-top:2px; color:var(--fm-muted); font-size:10px; line-height:1.35; }
  .fm-float-status { margin-top:2px; font-size:9px; line-height:1.3; }
  .fm-float-actions { display:flex; align-items:center; gap:2px; }
  .fm-float-icon,.fm-float-handle { display:grid; place-items:center; width:29px; height:29px;
    flex:none; padding:0; border:0; border-radius:6px; background:transparent; color:var(--fm-muted);
    transition:background var(--fm-fast) var(--fm-ease),transform var(--fm-press) var(--fm-ease); }
  .fm-float-icon:hover,.fm-float-handle:hover { background:var(--fm-hover); color:var(--fm-accent-ink); }
  .fm-float-handle { width:17px; touch-action:none; cursor:grab!important; }
  .fm-float-handle:active { cursor:grabbing!important; }
  .fm-float-handle svg { width:13px; height:13px; }
  .fm-float-drawer,.fm-float-menu { position:absolute; right:0; bottom:calc(100% + 9px);
    border:1px solid var(--fm-line); border-radius:10px; background:var(--fm-raised);
    box-shadow:var(--fm-popup-shadow); transform-origin:bottom right;
    animation:fm-pop-in var(--fm-base) var(--fm-ease) both; }
  .fm-float[data-edge=left] :is(.fm-float-drawer,.fm-float-menu) { left:0; right:auto; transform-origin:bottom left; }
  .fm-float[data-pop-side=below] :is(.fm-float-drawer,.fm-float-menu) { top:calc(100% + 9px); bottom:auto; transform-origin:top right; }
  .fm-float[data-edge=left][data-pop-side=below] :is(.fm-float-drawer,.fm-float-menu) { transform-origin:top left; }
  :is(.fm-float-drawer,.fm-float-menu)[data-phase=exit] { animation:fm-pop-out var(--fm-fast) var(--fm-ease) both; pointer-events:none; }
  .fm-float-drawer { width:min(330px,calc(100vw - 28px)); overflow:hidden; max-height:var(--fm-pop-max,70vh); }
  .fm-float-drawer-head { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:0 12px 7px; }
  .fm-float-drawer-label { color:var(--fm-muted); font-size:10px; font-weight:550; }
  .fm-float-drawer-body { padding:0 12px 13px; overflow:auto; max-height:calc(var(--fm-pop-max,70vh) - 52px); }
  .fm-float-track { padding:5px 0 0; }
  .fm-float-track strong { display:block; font-size:14px; line-height:1.4; overflow-wrap:anywhere; }
  .fm-float-track span { display:block; margin-top:3px; color:var(--fm-muted); font-size:11px; }
  .fm-float-controls { display:grid; grid-template-columns:1fr 1fr; gap:7px; margin-top:13px; }
  .fm-float-empty { padding:8px 0; color:var(--fm-muted); font-size:11px; }
  .fm-float-menu { z-index:3; width:220px; padding:5px; max-height:var(--fm-pop-max,70vh); overflow:auto; }
  .fm-float-menu button { display:flex; align-items:center; justify-content:space-between; gap:10px;
    width:100%; min-height:33px; padding:6px 9px; border:0; border-radius:5px;
    background:transparent; color:var(--fm-ink); text-align:left; font-size:11px; }
  .fm-float-menu button:hover,.fm-float-menu button:focus-visible { background:var(--fm-hover); }
  .fm-menu-section { padding:6px 9px 4px; color:var(--fm-faint); font-size:9px; }
  .fm-menu-check { color:var(--fm-accent-ink); font-weight:600; }
  .fm-menu-sep { height:1px; margin:5px 4px; background:var(--fm-line); }
  .fm-float-hint { padding:6px 8px 3px; color:var(--fm-faint); font-size:9px; }
  .fm-handle { display:grid; place-items:center; width:100%; height:24px; padding:0;
    border:0; background:transparent; touch-action:none; cursor:grab!important; }
  .fm-handle-bar { width:30px; height:3px; border-radius:9px; background:var(--fm-line-strong); }
  @keyframes fm-page-in { from{opacity:0;transform:translateY(var(--fm-motion-shift));filter:blur(1px)} to{opacity:1;transform:none;filter:none} }
  @keyframes fm-rise { from{opacity:0;transform:translateY(var(--fm-motion-shift))} to{opacity:1;transform:none} }
  @keyframes fm-swap { from{opacity:0;transform:translateY(var(--fm-motion-shift))} to{opacity:1;transform:none} }
  @keyframes fm-pop-in { from{opacity:0;transform:translateY(var(--fm-motion-shift)) scale(.97)} to{opacity:1;transform:none} }
  @keyframes fm-pop-out { from{opacity:1;transform:none} to{opacity:0;transform:translateY(var(--fm-motion-shift)) scale(.98)} }
  @keyframes fm-wave { from{transform:scaleY(.35)} to{transform:scaleY(1)} }
  @keyframes fm-settle { from{transform:scale(.985)} to{transform:scale(1)} }
  .fm-float[data-dragging=false] .fm-float-pill { animation:fm-settle var(--fm-base) var(--fm-ease); }
  .fishfm[data-view=settings] .fm-grid { grid-template-columns:1fr; }
  .fishfm[data-view=settings] .fm-management { grid-template-columns:1fr; }
  @container fishfm (max-width:740px) { .fm-grid,.fm-management{grid-template-columns:1fr;gap:12px} .fm-hero{grid-template-columns:minmax(0,1fr) 80px;padding:14px;gap:10px} .fm-art img{width:80px;height:96px} .fm-track{font-size:21px} }
  @container fishfm (max-width:460px) { .fm-top{gap:8px} .fm-heading{flex:1 1 108px;gap:8px} .fm-brand{width:28px;height:28px} .fishfm h1{font-size:18px;white-space:nowrap} .fm-top-actions{width:auto;flex-shrink:0} .fm-top-actions .fm-button{padding:6px 8px;gap:5px} .fm-subtitle{display:none} .fm-hero{grid-template-columns:minmax(0,1fr) 64px;padding:12px;gap:8px} .fm-art img{width:64px;height:82px} .fm-track{font-size:18px} .fm-controls .fm-button{padding:5px 8px;min-height:32px;font-size:11px} .fm-controls .fm-feedback-actions{margin-left:0} .fm-library-search{width:100%} .fm-summary-actions .fm-button{width:100%} .fm-library-foot{flex-wrap:wrap} .fm-profile-details .fm-badge{white-space:normal} }
  @container fishfm (max-width:460px) { .fm-art{grid-row:1} .fm-controls{grid-column:1/-1} }
  @media(max-width:600px) { .fishfm{padding:12px} .fm-float{width:290px} }
  @media(prefers-reduced-motion:reduce) { :is(.fishfm,.fm-float) *, :is(.fishfm,.fm-float){animation:none!important;transition:none!important;scroll-behavior:auto!important} }
  :is(.fishfm,.fm-float)[data-motion=off] *, :is(.fishfm,.fm-float)[data-motion=off]{animation:none!important;transition:none!important}
  :is(.fishfm,.fm-float)[data-motion=reduced] .fm-wave i { animation:none; }
`;
