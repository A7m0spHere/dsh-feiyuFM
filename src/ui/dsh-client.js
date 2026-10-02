// FishFM DSH client: one Core-backed settings page and one frame overlay.
window.__ModuleLoader__.load({
  id: 'dsh-feiyufm-core',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;
    const css = `
      .fishfm,.fishfm *{box-sizing:border-box}
      .fishfm{--fm-ink:var(--dsw-alias-label-primary,#253447);--fm-muted:var(--dsw-alias-label-secondary,#718094);--fm-line:color-mix(in srgb,var(--fm-ink) 12%,transparent);--fm-blue:#536ba9;--fm-blue-soft:color-mix(in srgb,var(--fm-blue) 10%,transparent);--fm-card:color-mix(in srgb,var(--dsw-alias-background-primary,#fff) 92%,var(--fm-blue) 3%);--fm-shadow:0 16px 44px color-mix(in srgb,#162b4d 11%,transparent);height:100%;min-height:100%;overflow:auto;padding:clamp(20px,4vw,48px);background:var(--dsw-alias-background-primary,transparent);color:var(--fm-ink);font:14px/1.55 "Aptos","Microsoft YaHei UI","Microsoft YaHei",sans-serif;scrollbar-gutter:stable}
      .fishfm button,.fishfm input{font:inherit}.fishfm button{color:inherit;cursor:pointer}.fishfm button:disabled{opacity:.45;cursor:not-allowed}.fishfm button:focus-visible,.fishfm input:focus-visible{outline:3px solid #77a8dc;outline-offset:3px}.fishfm .fm-wrap{width:min(1060px,100%);margin:0 auto}.fishfm .fm-top{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:0 0 25px}.fishfm .fm-brand{display:flex;align-items:center;gap:12px}.fishfm .fm-brand-mark{display:grid;place-items:center;width:40px;height:40px;border-radius:13px;background:linear-gradient(145deg,#728bc5,#435b98);color:#fff;box-shadow:0 7px 18px #435b982b}.fishfm .fm-brand-mark svg{width:21px;height:21px}.fishfm .fm-eyebrow{font-size:10px;font-weight:750;letter-spacing:2.1px;color:var(--fm-blue)}.fishfm h1{font-size:clamp(23px,3vw,30px);line-height:1.16;letter-spacing:-.7px;margin:3px 0 0}.fishfm h2{display:flex;align-items:baseline;gap:9px;font-size:15px;line-height:1.3;margin:0 0 13px}.fishfm h2 small{font-size:9px;letter-spacing:1.5px;font-weight:650;color:var(--fm-muted)}.fishfm p{color:var(--fm-muted);font-size:12px;line-height:1.7;margin:6px 0}.fishfm .fm-button{min-height:36px;padding:8px 13px;border:1px solid var(--fm-line);border-radius:11px;background:color-mix(in srgb,var(--fm-card) 85%,transparent);font-size:12px;font-weight:650;transition:background .16s ease,border-color .16s ease,transform .16s ease}.fishfm .fm-button:hover:not(:disabled){background:var(--fm-blue-soft);border-color:color-mix(in srgb,var(--fm-blue) 36%,var(--fm-line));transform:translateY(-1px)}.fishfm .fm-primary{background:var(--fm-blue);border-color:var(--fm-blue);color:#fff}.fishfm .fm-primary:hover:not(:disabled){background:#435b98;border-color:#435b98}.fishfm .fm-subtle{background:transparent}.fishfm .fm-top-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
      .fishfm .fm-hero{position:relative;display:grid;grid-template-columns:minmax(165px,.7fr) minmax(0,1.6fr);gap:clamp(18px,4vw,48px);align-items:center;min-height:248px;padding:clamp(18px,3vw,32px);margin-bottom:26px;border:1px solid color-mix(in srgb,var(--fm-blue) 18%,var(--fm-line));border-radius:26px;overflow:hidden;background:radial-gradient(ellipse at 12% 80%,color-mix(in srgb,#a9badb 24%,transparent),transparent 36%),linear-gradient(117deg,color-mix(in srgb,var(--fm-blue) 8%,var(--fm-card)),color-mix(in srgb,var(--fm-card) 91%,#d9e3f4));box-shadow:var(--fm-shadow)}.fishfm .fm-hero:after{content:"";position:absolute;inset:auto -12% -74% 28%;height:180px;border:1px solid color-mix(in srgb,var(--fm-blue) 12%,transparent);border-radius:50%;pointer-events:none}.fishfm .fm-art{display:grid;place-items:center;min-width:0;min-height:180px;position:relative;z-index:1}.fishfm .fm-art img{width:min(100%,220px);max-height:218px;object-fit:contain;filter:drop-shadow(0 12px 16px #253a5b25);animation:fm-float 5.2s ease-in-out infinite}.fishfm .fm-art[data-rest=true] img{animation-duration:7s}.fishfm .fm-hero-copy{min-width:0;position:relative;z-index:1}.fishfm .fm-live{display:flex;align-items:center;gap:8px;color:var(--fm-muted);font-size:11px;font-weight:700;letter-spacing:.02em}.fishfm .fm-dot{width:7px;height:7px;flex:none;border-radius:50%;background:#56a18a;box-shadow:0 0 0 4px #56a18a20}.fishfm .fm-dot[data-off=true]{background:#bf9257;box-shadow:0 0 0 4px #bf925720}.fishfm .fm-track{margin:11px 0 0;font-size:clamp(20px,3vw,29px);font-weight:760;line-height:1.2;letter-spacing:-.5px;overflow-wrap:anywhere}.fishfm .fm-artist{margin:5px 0 0;font-size:13px}.fishfm .fm-progress{height:4px;border-radius:8px;overflow:hidden;background:color-mix(in srgb,var(--fm-ink) 13%,transparent);margin:17px 0 6px}.fishfm .fm-progress span{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#536ba9,#83a7d6);transition:width .35s ease}.fishfm .fm-time{display:flex;justify-content:space-between;color:var(--fm-muted);font-size:10px;font-variant-numeric:tabular-nums}.fishfm .fm-controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:15px}.fishfm .fm-controls .fm-button{min-width:88px}
      .fishfm .fm-grid{display:grid;grid-template-columns:minmax(0,1.17fr) minmax(300px,.83fr);gap:22px;align-items:start}.fishfm section{min-width:0;margin-bottom:22px}.fishfm .fm-card{border:1px solid var(--fm-line);border-radius:17px;background:var(--fm-card);padding:0 17px;box-shadow:0 6px 20px color-mix(in srgb,#172944 4%,transparent)}.fishfm .fm-card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 0 10px;border-bottom:1px solid var(--fm-line)}.fishfm .fm-card-head strong{font-size:12px}.fishfm .fm-card-head small{font-size:10px;color:var(--fm-muted)}.fishfm .fm-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 0}.fishfm .fm-row+.fm-row{border-top:1px solid var(--fm-line)}.fishfm .fm-label{font-size:13px;font-weight:700}.fishfm .fm-row p{max-width:440px;margin:3px 0 0;font-size:11px}.fishfm .fm-toggle{width:39px;height:24px;flex:none;border:0;border-radius:99px;padding:3px;background:color-mix(in srgb,var(--fm-ink) 19%,transparent);transition:background .16s ease}.fishfm .fm-toggle[aria-checked=true]{background:#536ba9}.fishfm .fm-toggle span{display:block;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 4px #10223c30;transition:transform .16s ease}.fishfm .fm-toggle[aria-checked=true] span{transform:translateX(15px)}.fishfm .fm-rate{padding:5px 0 15px}.fishfm .fm-rate-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;font-size:11px;color:var(--fm-muted)}.fishfm .fm-rate output{color:var(--fm-blue);font-weight:800;font-variant-numeric:tabular-nums}.fishfm input[type=range]{width:100%;accent-color:var(--fm-blue);cursor:pointer}.fishfm .fm-save-line{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:6px}.fishfm .fm-save{min-height:17px;color:var(--fm-muted);font-size:10px}.fishfm .fm-modes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.fishfm .fm-mode{position:relative;text-align:left;min-height:78px;padding:12px;border:1px solid var(--fm-line);border-radius:14px;background:var(--fm-card);transition:background .16s ease,border-color .16s ease,transform .16s ease}.fishfm .fm-mode:hover:not(:disabled){transform:translateY(-2px);border-color:color-mix(in srgb,var(--fm-blue) 40%,var(--fm-line))}.fishfm .fm-mode[aria-pressed=true]{border-color:var(--fm-blue);background:var(--fm-blue-soft);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--fm-blue) 18%,transparent)}.fishfm .fm-mode strong{display:block;font-size:12px}.fishfm .fm-mode span{display:block;margin-top:4px;color:var(--fm-muted);font-size:10px;line-height:1.5}.fishfm .fm-manual{margin:9px 0 0!important;font-size:10px!important}
      .fishfm .fm-platform{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 0}.fishfm .fm-platform+.fm-platform{border-top:1px solid var(--fm-line)}.fishfm .fm-platform-name{display:flex;align-items:center;gap:9px;font-weight:700;font-size:12px}.fishfm .fm-platform-mark{display:grid;place-items:center;width:28px;height:28px;border-radius:9px;background:var(--fm-blue-soft);color:var(--fm-blue);font-size:13px;font-weight:800}.fishfm .fm-platform-actions{display:flex;align-items:center;justify-content:flex-end;gap:7px;flex-wrap:wrap}.fishfm .fm-badge{display:inline-flex;align-items:center;min-height:23px;padding:3px 8px;border:1px solid var(--fm-line);border-radius:99px;color:var(--fm-muted);font-size:10px;white-space:nowrap}.fishfm .fm-badge[data-ok=true]{border-color:#61a58b42;background:#61a58b12;color:#4c9076}.fishfm .fm-qr-box{margin:7px 0 13px;padding:16px;text-align:center;border:1px solid color-mix(in srgb,var(--fm-blue) 19%,var(--fm-line));border-radius:15px;background:var(--fm-blue-soft)}.fishfm .fm-qr-box img{display:block;width:172px;height:172px;margin:12px auto 8px;padding:8px;border-radius:12px;background:#fff;image-rendering:pixelated;box-shadow:0 5px 20px #23395714}.fishfm .fm-qr-box p{max-width:420px;margin:7px auto 0;font-size:11px}.fishfm .fm-import{margin:10px 0;padding:10px 12px;border-radius:12px;background:color-mix(in srgb,var(--fm-blue) 7%,transparent);color:var(--fm-muted);font-size:11px;line-height:1.7}.fishfm .fm-import strong{color:var(--fm-ink)}.fishfm .fm-attempts{margin:10px 0 12px;padding:10px 12px;border:1px solid var(--fm-line);border-radius:12px;background:color-mix(in srgb,var(--fm-card) 92%,transparent)}.fishfm .fm-attempts-title{margin:0 0 6px;color:var(--fm-muted);font-size:10px;font-weight:750;letter-spacing:.04em}.fishfm .fm-attempt{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:5px 0;color:var(--fm-muted);font-size:10px}.fishfm .fm-attempt+.fm-attempt{border-top:1px solid var(--fm-line)}.fishfm .fm-attempt strong{color:var(--fm-ink);font-size:10px}.fishfm .fm-attempt-note{display:block;margin-top:2px;max-width:460px;overflow-wrap:anywhere;line-height:1.5}.fishfm .fm-notice{margin:0 0 17px;padding:12px 14px;border:1px solid #c68d4a55;border-radius:13px;background:color-mix(in srgb,#c68d4a 10%,var(--fm-card));color:var(--fm-ink);font-size:11px;line-height:1.65}.fishfm .fm-notice[data-error=true]{border-color:#c0646450;background:color-mix(in srgb,#c06464 9%,var(--fm-card))}.fishfm .fm-notice .fm-button{margin-left:8px}.fishfm .fm-foot{display:flex;justify-content:space-between;gap:12px;padding-top:15px;border-top:1px solid var(--fm-line);color:var(--fm-muted);font-size:10px}.fishfm .fm-widget-pref{display:flex;align-items:center;gap:8px;color:var(--fm-muted);font-size:10px}
      @keyframes fm-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
      .fm-float{position:absolute;z-index:2;width:min(340px,calc(100vw - 28px));max-width:calc(100% - 24px);pointer-events:auto;color:#263651;font:12px/1.45 "Aptos","Microsoft YaHei UI","Microsoft YaHei",sans-serif}.fm-float *{box-sizing:border-box}.fm-float button{font:inherit}.fm-float button:focus-visible{outline:3px solid #83a7d6;outline-offset:3px}.fm-float-pill{display:flex;align-items:center;gap:7px;min-height:64px;padding:7px 9px;border:1px solid #536ba966;border-radius:19px;background:color-mix(in srgb,var(--dsw-alias-background-primary,#fff) 90%,#dfe8f7);box-shadow:0 14px 36px #1a2b4630;backdrop-filter:blur(14px)}.fm-float-art{display:grid;place-items:center;width:44px;height:46px;flex:none;overflow:hidden;border-radius:13px;background:linear-gradient(145deg,#e6edf8,#f8f9fb)}.fm-float-art img{width:58px;height:58px;object-fit:contain}.fm-float-trigger{display:flex;align-items:center;gap:9px;min-width:0;flex:1;padding:0;border:0;background:transparent;text-align:left}.fm-float-copy{min-width:0;flex:1}.fm-float-title{display:block;overflow:hidden;color:var(--fm-ink,#263651);font-size:11px;font-weight:750;text-overflow:ellipsis;white-space:nowrap}.fm-float-artist{display:block;overflow:hidden;margin-top:2px;color:var(--fm-muted,#718094);font-size:10px;text-overflow:ellipsis;white-space:nowrap}.fm-float-status{display:flex;align-items:center;gap:5px;margin-top:4px;color:var(--fm-muted,#718094);font-size:9px}.fm-float-dot{width:6px;height:6px;flex:none;border-radius:50%;background:#59a28a}.fm-float-dot[data-off=true]{background:#b5905d}.fm-float-actions{display:flex;align-items:center;gap:3px}.fm-float-icon{display:grid;place-items:center;width:30px;height:32px;border:0;border-radius:10px;background:transparent;color:#536ba9}.fm-float-icon:hover{background:#536ba91a}.fm-float-icon svg{width:16px;height:16px}.fm-float-drag{width:21px;touch-action:none;cursor:grab}.fm-float-drag:active{cursor:grabbing}.fm-float-drag svg{width:14px;height:14px}.fm-float-more svg{width:17px;height:17px}.fm-float-drawer{position:absolute;right:0;bottom:calc(100% + 12px);width:min(356px,calc(100vw - 28px));max-height:min(74vh,560px);overflow:hidden;border:1px solid #536ba955;border-radius:21px;background:color-mix(in srgb,var(--dsw-alias-background-primary,#fff) 94%,#e9eff8);box-shadow:0 22px 60px #17294335;backdrop-filter:blur(18px);animation:fm-rise .2s cubic-bezier(.16,1,.3,1)}.fm-float[data-edge=left] .fm-float-drawer{right:auto;left:0}.fm-float-drawer-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0 15px 7px}.fm-float-drawer-label{color:#718094;font-size:9px;font-weight:800;letter-spacing:1.6px}.fm-float-drawer-body{overflow:auto;max-height:calc(min(74vh,560px) - 28px);padding:0 15px 15px}.fm-float-track{padding:9px 2px 0}.fm-float-track strong{display:block;overflow:hidden;font-size:15px;text-overflow:ellipsis;white-space:nowrap}.fm-float-track span{display:block;margin-top:3px;color:#718094;font-size:11px}.fm-float-drawer .fm-progress{margin:13px 0 6px}.fm-float-controls{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:13px}.fm-float-controls .fm-button{min-height:40px;border-radius:12px;background:#536ba9;color:#fff}.fm-float-controls .fm-button:last-child{background:#536ba914;color:#435b98}.fm-float-empty{padding:10px 0;color:#718094;font-size:11px}.fm-float-menu{position:absolute;right:0;bottom:calc(100% + 11px);z-index:3;width:225px;padding:7px;border:1px solid #536ba94a;border-radius:15px;background:color-mix(in srgb,var(--dsw-alias-background-primary,#fff) 96%,#e9eff8);box-shadow:0 16px 44px #17294330;backdrop-filter:blur(16px);animation:fm-rise .16s ease-out}.fm-float[data-edge=left] .fm-float-menu{right:auto;left:0}.fm-float-menu button{display:flex;align-items:center;justify-content:space-between;width:100%;min-height:35px;padding:7px 9px;border:0;border-radius:9px;background:transparent;color:#263651;text-align:left;font-size:10px}.fm-float-menu button:hover{background:#536ba912}.fm-float-menu .fm-menu-section{padding:7px 9px 4px;color:#8491a3;font-size:9px;font-weight:750;letter-spacing:.08em}.fm-menu-check{color:#536ba9;font-weight:800}.fm-menu-sep{height:1px;margin:5px 4px;background:#26365115}.fm-float-hint{margin:8px 2px 0;color:#718094;font-size:9px}.fm-float-handle{display:flex;align-items:center;justify-content:center;width:21px;height:28px;margin-right:2px;border:0;border-radius:8px;background:transparent;color:#7186b1}.fm-float-handle:hover{background:#536ba912}.fm-float-handle svg{width:12px;height:15px}.fm-float-drawer .fm-handle{display:flex;align-items:center;justify-content:center;width:100%;height:28px;padding:0;border:0;background:transparent;touch-action:none;cursor:grab}.fm-float-drawer .fm-handle:active{cursor:grabbing}.fm-float-drawer .fm-handle-bar{width:38px;height:4px;border-radius:9px;background:#aebbd0}
      @keyframes fm-rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
      .fishfm{container-type:inline-size;container-name:fishfm}
      @container fishfm (max-width:760px){.fishfm .fm-grid{grid-template-columns:1fr;gap:4px}.fishfm .fm-top{flex-wrap:wrap;align-items:flex-start}.fishfm .fm-top-actions{justify-content:flex-start}.fishfm .fm-hero{grid-template-columns:minmax(98px,.42fr) minmax(0,1fr);gap:12px;min-height:200px;padding:18px;border-radius:20px}.fishfm .fm-art{min-height:140px}.fishfm .fm-art img{max-height:150px}.fishfm .fm-foot{flex-direction:column}}
      @container fishfm (max-width:440px){.fishfm .fm-hero{grid-template-columns:1fr;gap:0}.fishfm .fm-art{position:absolute;right:-7px;top:8px;width:110px;height:110px;min-height:0;opacity:.45}.fishfm .fm-art img{max-height:115px}.fishfm .fm-hero-copy{position:relative}.fishfm .fm-track{max-width:72%}.fishfm .fm-platform{align-items:flex-start;flex-direction:column}.fishfm .fm-platform-actions{width:100%;justify-content:flex-start}}
      .fm-float button:disabled{opacity:.45;cursor:not-allowed}
      @media(max-width:760px){.fishfm{padding:20px 16px}.fishfm .fm-hero{grid-template-columns:minmax(98px,.42fr) minmax(0,1fr);gap:12px;min-height:200px;padding:18px;border-radius:20px}.fishfm .fm-art{min-height:140px}.fishfm .fm-art img{max-height:150px}.fishfm .fm-grid{grid-template-columns:1fr;gap:4px}.fishfm .fm-top{align-items:flex-start}.fishfm .fm-foot{flex-direction:column}.fishfm .fm-widget-pref{display:none}}
      @media(max-width:440px){.fishfm .fm-hero{grid-template-columns:1fr;gap:0}.fishfm .fm-art{position:absolute;right:-7px;top:8px;width:110px;height:110px;min-height:0;opacity:.45}.fishfm .fm-art img{max-height:115px}.fishfm .fm-hero-copy{position:relative}.fishfm .fm-track{max-width:72%}.fishfm .fm-modes{gap:7px}.fishfm .fm-mode{min-height:72px;padding:10px}.fishfm .fm-platform{align-items:flex-start;flex-direction:column}.fishfm .fm-platform-actions{width:100%;justify-content:flex-start}.fm-float{position:absolute;left:12px!important;right:12px!important;top:auto!important;bottom:12px!important;width:auto;max-width:none}.fm-float-drawer,.fm-float[data-edge=left] .fm-float-drawer{position:absolute;left:0;right:0;bottom:calc(100% + 9px);width:100%;max-height:66vh;border-radius:20px}.fm-float-drawer-body{max-height:calc(66vh - 28px)}}
      @media(prefers-reduced-motion:reduce){.fishfm *, .fm-float *{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
      [data-ds-dark-theme] .fishfm{--fm-blue:#91a9dd;--fm-blue-soft:color-mix(in srgb,#91a9dd 16%,transparent);--fm-card:color-mix(in srgb,var(--dsw-alias-background-primary,#20242a) 94%,#50699f 6%);--fm-shadow:0 16px 44px #0004}
      [data-ds-dark-theme] .fishfm .fm-hero{background:radial-gradient(ellipse at 12% 80%,#7589ad30,transparent 36%),linear-gradient(117deg,#40547e2b,#5b6e9620)}
      [data-ds-dark-theme] .fm-float-pill,[data-ds-dark-theme] .fm-float-drawer,[data-ds-dark-theme] .fm-float-menu{background:color-mix(in srgb,var(--dsw-alias-background-primary,#20242a) 93%,#40547e)}
      [data-ds-dark-theme] .fm-float-title,[data-ds-dark-theme] .fm-float-menu button{color:#e0e7f2}
    `;

    const WIDGET_VISIBLE_KEY = 'fishfm.widget.visible.v1';
    const WIDGET_POSITION_KEY = 'fishfm.widget.position.v1';
    const readPreference = (key, fallback) => {
      try {
        const value = window.localStorage.getItem(key);
        return value === null ? fallback : JSON.parse(value);
      } catch { return fallback; }
    };
    const writePreference = (key, value) => {
      try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage can be disabled */ }
    };

    function createController(connection) {
      let state = {
        snapshot: null, platforms: {}, busy: false, connected: false, error: '', notice: '',
        login: null, imported: null, importAttempts: [], library: { total: 0, tracks: [] },
        widgetVisible: readPreference(WIDGET_VISIBLE_KEY, true) !== false,
        widgetPosition: readPreference(WIDGET_POSITION_KEY, null),
      };
      let epoch = 0, timer, read, write, disposed = false;
      const listeners = new Set();
      const emit = (patch) => { if (!disposed) { state = { ...state, ...patch }; listeners.forEach(fn => fn()); } };
      const failure = error => `${error?.message || '音乐服务连接失败，请刷新重试。'}${error?.code ? ` (${error.code})` : ''}`;
      async function refresh() {
        if (disposed || state.busy || read) return;
        const version = ++epoch;
        const controller = new AbortController();
        read = controller;
        const timeout = setTimeout(() => controller.abort(), 18000);
        try {
          const result = await connection.rpc.call('/api', 'fishfm/state', {}, controller.signal);
          if (version !== epoch) return;
          if (!result.ok) throw result.error;
          emit({ ...result.value, connected: true, error: '' });
        } catch (error) {
          if (version === epoch) emit({ connected: false, error: failure(error) });
        } finally {
          clearTimeout(timeout);
          if (read === controller) read = null;
        }
      }
      return {
        getSnapshot: () => state,
        subscribe(fn) {
          listeners.add(fn);
          if (listeners.size === 1) { refresh(); timer = setInterval(() => { if (!document.hidden) refresh(); }, 2200); }
          return () => { listeners.delete(fn); if (!listeners.size) { clearInterval(timer); ++epoch; read?.abort(); read = null; } };
        },
        refresh,
        setWidgetVisible(visible) {
          const next = Boolean(visible);
          writePreference(WIDGET_VISIBLE_KEY, next);
          emit({ widgetVisible: next });
        },
        setWidgetPosition(position) {
          const next = position && ['left', 'right'].includes(position.edge) && Number.isFinite(position.top)
            ? { edge: position.edge, top: Math.round(position.top) } : null;
          writePreference(WIDGET_POSITION_KEY, next);
          emit({ widgetPosition: next });
        },
        async command(type, value) {
          if (disposed || state.busy || !state.connected) return;
          ++epoch; read?.abort(); read = null;
          emit({ busy: true, error: '', notice: '正在保存…' });
          write = new AbortController();
          const timeout = setTimeout(() => write?.abort(), 25000);
          try {
            const result = await connection.rpc.call('/api', 'fishfm/command', type === 'requestTrack' ? { type, track: value } : { type, value }, write.signal);
            if (!result.ok) throw result.error;
            emit({ snapshot: result.value.snapshot, notice: '已保存到本机' });
          } catch (error) { emit({ connected: false, error: failure(error), notice: '未确认保存，请刷新核对' }); }
          finally { clearTimeout(timeout); write = null; emit({ busy: false }); }
        },
        async platformAction(action, provider) {
          if (disposed || state.busy || !state.connected) return;
          const endpoint = ({ begin: 'fishfm/login-start', poll: 'fishfm/login-poll', import: 'fishfm/import', logout: 'fishfm/logout' })[action];
          if (!endpoint) return;
          ++epoch; read?.abort(); read = null;
          const progress = action === 'poll' ? '正在确认手机扫码…'
            : action === 'import' ? '正在读取近期记录；若不可用会继续尝试喜欢列表和用户歌单…'
              : action === 'begin' ? '正在向网易云申请二维码…' : '正在连接音乐平台…';
          emit({ busy: true, error: '', notice: progress, importAttempts: action === 'import' ? [] : state.importAttempts });
          write = new AbortController();
          const timeout = setTimeout(() => write?.abort(), action === 'import' ? 120000 : 45000);
          try {
            const result = await connection.rpc.call('/api', endpoint, { provider }, write.signal);
            if (!result.ok) throw result.error;
            const value = result.value;
            const login = Object.hasOwn(value, 'login') ? value.login : state.login;
            if (action === 'poll' && login) login.qrImage = state.login?.qrImage;
            emit({ snapshot: value.snapshot, platforms: value.platforms ?? state.platforms, library: value.library ?? state.library, login,
              imported: action === 'logout' ? null : Object.hasOwn(value, 'imported') ? value.imported : state.imported,
              importAttempts: action === 'import' ? value.attempts ?? [] : state.importAttempts,
              connected: true, error: '',
              notice: action === 'logout' ? '已退出网易云账号，本机凭据已删除。'
                : action === 'import'
                  ? `已读取${sourceNames[value.imported?.source] || '平台音乐'}：本次新增 ${value.imported?.imported ?? 0} 首，当前共 ${value.imported?.total ?? 0} 首${value.imported?.source !== 'recent' ? '，使用备用来源' : ''}${value.imported?.total < value.imported?.requested ? '，返回数量不足目标，仍可播放' : ''}`
                  : value.login?.identityError || (value.login?.status === 'authorized' ? '登录成功，可以导入音乐。'
                    : value.login?.status === 'scanned' ? '已扫码，请在手机上确认登录。'
                      : value.login?.status === 'expired' ? '二维码已过期，请重新获取。'
                        : action === 'begin' ? '请用网易云音乐 App 扫描二维码。' : '等待手机确认…') });
          } catch (error) {
            const details = error?.details ?? {};
            let latest = {};
            try {
              const refreshed = await connection.rpc.call('/api', 'fishfm/state', {}, write.signal);
              if (refreshed?.ok) latest = refreshed.value;
            } catch { /* the periodic snapshot will retry */ }
            const accountStatus = latest.platforms?.[provider]?.account?.status;
            const login = action === 'begin' || action === 'poll'
              ? { ...(state.login ?? {}), provider, status: 'error', qrExpired: false, identityError: error.message,
                canRetryValidation: action === 'poll' && details.stage === 'login_status',
                canRetryCheck: action === 'poll' && details.stage === 'login_qr_check' }
              : accountStatus === 'login_required' ? null
              : accountStatus === 'expired' ? { provider, status: 'expired', qrExpired: false, identityError: error.message }
                : accountStatus === 'authorized' ? { ...(state.login ?? {}), provider, status: 'authorized' }
                  : { ...(state.login ?? {}), provider, status: 'error' };
            emit({ ...latest, connected: true, error: failure(error), notice: action === 'import' ? '导入没有写入空批次，可检查失败阶段后重试。' : '登录步骤未完成，可重新扫码或刷新重试。',
              importAttempts: action === 'import' ? details.attempts ?? [] : state.importAttempts,
              login });
          } finally { clearTimeout(timeout); write = null; emit({ busy: false }); }
        },
        dispose() { disposed = true; ++epoch; clearInterval(timer); read?.abort(); write?.abort(); listeners.clear(); },
      };
    }

    const minutes = ms => { const seconds = Math.floor(Math.max(0, ms || 0) / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; };
    const progressPercent = current => {
      const duration = current?.track?.durationMs;
      return Number.isFinite(duration) && duration > 0
        ? Math.min(100, 100 * Math.max(0, current.positionMs || 0) / duration) : 0;
    };
    const modes = [['normal', '日常', '自主选歌 · 保留声音'], ['focus', '专注', '减少中途切换'], ['silent', '静听', '自主播放 · 电脑静音'], ['off', '关闭', '暂停并停止自动听歌']];
    const sourceNames = { recent: '近期记录', liked: '喜欢列表', playlist: '用户歌单' };
    const stageNames = { login_status: '读取登录状态', user_record: '请求近期记录', likelist: '读取喜欢列表', user_playlist: '读取用户歌单', playlist_detail: '读取歌单详情', song_detail: '读取歌曲详情', accountInfo: '读取登录状态', recentTracks: '请求近期记录', likedTracks: '读取喜欢列表', playlists: '读取用户歌单', playlistTracks: '读取歌单详情', songDetails: '读取歌曲详情' };

    function Svg({ type }) {
      const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
      if (type === 'headphones') return h('svg', common, h('path', { d: 'M4 13v-1a8 8 0 0 1 16 0v1' }), h('path', { d: 'M4 13h3v7H5a1 1 0 0 1-1-1v-6Zm16 0h-3v7h2a1 1 0 0 0 1-1v-6Z' }));
      if (type === 'more') return h('svg', common, h('circle', { cx: 5, cy: 12, r: 1, fill: 'currentColor' }), h('circle', { cx: 12, cy: 12, r: 1, fill: 'currentColor' }), h('circle', { cx: 19, cy: 12, r: 1, fill: 'currentColor' }));
      if (type === 'play') return h('svg', common, h('path', { d: 'm8 5 11 7-11 7V5Z', fill: 'currentColor', stroke: 'none' }));
      if (type === 'pause') return h('svg', common, h('path', { d: 'M8 5v14M16 5v14', strokeWidth: 2.7 }));
      if (type === 'next') return h('svg', common, h('path', { d: 'M6 5v14l10-7L6 5Z', fill: 'currentColor', stroke: 'none' }), h('path', { d: 'M19 5v14' }));
      if (type === 'close') return h('svg', common, h('path', { d: 'm6 6 12 12M18 6 6 18' }));
      if (type === 'grip') return h('svg', common, h('circle', { cx: 8, cy: 6, r: 1, fill: 'currentColor' }), h('circle', { cx: 16, cy: 6, r: 1, fill: 'currentColor' }), h('circle', { cx: 8, cy: 12, r: 1, fill: 'currentColor' }), h('circle', { cx: 16, cy: 12, r: 1, fill: 'currentColor' }), h('circle', { cx: 8, cy: 18, r: 1, fill: 'currentColor' }), h('circle', { cx: 16, cy: 18, r: 1, fill: 'currentColor' }));
      return h('svg', common, h('path', { d: 'M5 12h14M12 5l7 7-7 7' }));
    }

    // Adapted from dsh-api-dashboard v1.4.5 client/client.js:92-135 under MIT.
    // Pointer-driven downward swipe closes the quick-control drawer; Escape and
    // the close button remain available to keyboard users.
    function SwipeHandle({ onClose }) {
      const st = React.useRef({ y0: 0, dy: 0, t0: 0, drawer: null, dragging: false, done: false });
      const setT = (el, dy, anim) => {
        if (!el) return;
        el.style.transition = anim ? 'transform .24s ease' : 'none';
        el.style.transform = dy > 0 ? `translateY(${dy}px)` : '';
      };
      const down = (e) => {
        const s = st.current;
        if (s.done) return;
        s.y0 = e.clientY; s.dy = 0; s.t0 = Date.now(); s.dragging = true;
        s.drawer = e.currentTarget.closest('.fm-float-drawer');
        if (s.drawer) s.drawer.style.transition = 'none';
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* PointerCapture is optional */ }
      };
      const move = (e) => {
        const s = st.current;
        if (!s.dragging) return;
        s.dy = Math.max(0, e.clientY - s.y0);
        setT(s.drawer, s.dy, false);
      };
      const end = () => {
        const s = st.current;
        if (!s.dragging || s.done) return;
        s.dragging = false;
        const elapsed = Math.max(1, Date.now() - s.t0);
        const fast = s.dy > 24 && s.dy / elapsed > .55;
        if (s.dy > 72 || fast) {
          s.done = true;
          if (s.drawer) { s.drawer.style.transition = 'transform .2s ease-in'; s.drawer.style.transform = 'translateY(100%)'; }
          setTimeout(onClose, 180);
        } else setT(s.drawer, 0, true);
      };
      return h('button', { type: 'button', className: 'fm-handle', 'aria-label': '向下滑动或按下收起快捷控制', title: '向下滑动收起',
        onPointerDown: down, onPointerMove: move, onPointerUp: end, onPointerCancel: end,
        onClick: (e) => { if (e.detail === 0) onClose(); } }, h('span', { className: 'fm-handle-bar' }));
    }

    function Panel({ controller, back, close }) {
      const state = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot);
      const snapshot = state.snapshot;
      const settings = snapshot?.settings || {};
      const [rate, setRate] = React.useState(20);
      const [selectedTrack, setSelectedTrack] = React.useState('');
      const rateId = React.useId();
      React.useEffect(() => { if (snapshot) setRate(Math.round(settings.discoveryRate * 100)); }, [settings.discoveryRate]);
      React.useEffect(() => {
        if (!['waiting', 'scanned'].includes(state.login?.status)) return undefined;
        const poll = setInterval(() => controller.platformAction('poll', state.login.provider), 2500);
        return () => clearInterval(poll);
      }, [state.login?.status, state.login?.provider, controller]);
      const disabled = state.busy || !state.connected || !snapshot;
      const mode = !settings.listening ? (!settings.humanPlayback ? 'off' : 'manual') : !settings.humanPlayback ? 'silent' : settings.strategy === 'focus' ? 'focus' : 'normal';
      const current = snapshot?.current;
      const playing = snapshot?.status === 'playing';
      const art = playing ? 'whale-listening' : snapshot?.status === 'selecting' ? 'whale-dj' : 'whale-idle';
      function toggle(title, description, field, command) {
        return h('div', { className: 'fm-row', key: field }, h('div', null, h('div', { className: 'fm-label' }, title), h('p', null, description)),
          h('button', { type: 'button', className: 'fm-toggle', role: 'switch', 'aria-label': title, 'aria-checked': Boolean(settings[field]), disabled,
            onClick: () => controller.command(command, !settings[field]) }, h('span')));
      }
      const button = (label, type, blocked = false, extra = {}) => h('button', { type: 'button', className: 'fm-button', disabled: disabled || blocked, onClick: () => controller.command(type), ...extra }, label);
      const platformRows = [['netease', '网易云音乐', '网'], ['qq', 'QQ 音乐', 'Q']].map(([id, title, mark]) => {
        const platform = state.platforms?.[id];
        const label = !snapshot ? '读取中' : !platform?.installed ? '接口尚未接入' : ({
          authorized: '已登录', expired: '登录已过期', signed_out: '未登录',
          login_required: platform.account?.pending ? '等待扫码' : '未登录',
        }[platform.account?.status] || '未连接');
        const available = id === 'netease' && platform?.installed;
        const action = platform?.account?.status === 'authorized'
          ? h(React.Fragment, null,
            h('button', { type: 'button', className: 'fm-button fm-primary', disabled: state.busy || !state.connected,
              onClick: () => controller.platformAction('import', id) }, '导入我的音乐'),
            h('button', { type: 'button', className: 'fm-button fm-subtle', disabled: state.busy || !state.connected,
              onClick: () => controller.platformAction('logout', id) }, '退出'))
          : available && !state.login && h('button', { type: 'button', className: 'fm-button fm-primary', disabled: state.busy || !state.connected,
            onClick: () => controller.platformAction('begin', id) }, '扫码登录');
        return h('div', { className: 'fm-platform', key: id },
          h('div', { className: 'fm-platform-name' }, h('span', { className: 'fm-platform-mark', 'aria-hidden': true }, mark), title),
          h('div', { className: 'fm-platform-actions' }, h('span', { className: 'fm-badge', 'data-ok': platform?.account?.status === 'authorized' || undefined }, label), action));
      });
      const loginPanel = state.login?.provider === 'netease'
        ? h('div', { className: 'fm-qr-box' },
          h('div', { className: 'fm-label' }, state.login.status === 'authorized' ? '网易云音乐已连接'
            : state.login.status === 'scanned' ? '已扫码，请在手机上确认'
              : state.login.status === 'expired' ? state.login.qrExpired === false ? '登录已失效' : '二维码已过期'
                : state.login.status === 'error' ? state.login.canRetryValidation ? '登录校验未通过' : '登录未完成' : '使用网易云音乐 App 扫描'),
          state.login.qrImage && !['authorized', 'expired', 'error'].includes(state.login.status)
            && h('img', { src: state.login.qrImage, width: 172, height: 172, alt: '网易云音乐登录二维码' }),
          h('p', { role: 'status', 'aria-live': 'polite' }, state.login.identityError || (state.login.status === 'authorized'
            ? state.login.accountId ? `账号已连接（ID ${state.login.accountId}），可以导入音乐。` : '账号已连接；导入前会自动补读账号 ID。'
            : state.login.status === 'expired' ? '请重新获取二维码后再试。' : '手机确认后会自动读取账号状态，随后即可导入音乐。')),
          (state.login.canRetryValidation || state.login.canRetryCheck) && state.login.status === 'error'
            && h('button', { type: 'button', className: 'fm-button', disabled: state.busy || !state.connected,
              onClick: () => controller.platformAction('poll', 'netease') }, state.login.canRetryValidation ? '重试登录校验' : '重试扫码检测'),
          ['expired', 'error'].includes(state.login.status)
            && h('button', { type: 'button', className: 'fm-button fm-primary', disabled: state.busy || !state.connected,
              onClick: () => controller.platformAction('begin', 'netease') }, '重新获取二维码'))
        : null;
      const importNotice = state.imported
        ? h('div', { className: 'fm-import', role: 'status', 'aria-live': 'polite' },
          h('strong', null, `最近导入：${sourceNames[state.imported.source] || state.imported.source || '平台音乐'}`),
          ` · 新增 ${state.imported.imported ?? 0} 首，当前共 ${state.imported.total ?? 0} 首`,
          state.imported.degraded && state.imported.reason ? h('span', null, ` · ${state.imported.reason}`) : null)
        : null;
      const attempts = Array.isArray(state.importAttempts) && state.importAttempts.length
        ? h('div', { className: 'fm-attempts' }, h('div', { className: 'fm-attempts-title' }, '本次来源尝试'),
          state.importAttempts.map((row, index) => h('div', { className: 'fm-attempt', key: `${row.source}-${index}` },
            h('div', null, h('strong', null, sourceNames[row.source] || row.source),
              h('span', { className: 'fm-attempt-note' }, row.ok
                ? `可用 · ${row.count} 首`
                : `${stageNames[row.stage] || '请求'}失败${row.code ? ` · ${row.code}` : ''}${row.httpStatus ? ` · HTTP ${row.httpStatus}` : ''}${row.platformCode ? ` · 接口码 ${row.platformCode}` : ''}${row.reason ? ` · ${row.reason}` : ''}`)),
            h('span', { className: 'fm-badge', 'data-ok': row.ok || undefined }, row.ok ? `${row.count} 首` : '失败'))))
        : null;
      const platformSection = h('section', null,
        h('h2', null, '音乐平台', h('small', null, 'ACCOUNTS')),
        h('div', { className: 'fm-card' }, platformRows, loginPanel, importNotice, attempts,
          h('p', null, '近期记录优先；读取失败会继续尝试喜欢列表和你创建的歌单。账号凭据只保存在本机加密存储。QQ 音乐接口尚未核实，目前不会显示虚假的登录入口。')));

      return h('div', { className: 'fishfm' }, h('div', { className: 'fm-wrap' },
        h('header', { className: 'fm-top' },
          h('div', { className: 'fm-brand' }, h('span', { className: 'fm-brand-mark', 'aria-hidden': true }, h(Svg, { type: 'headphones' })),
            h('div', null, h('div', { className: 'fm-eyebrow' }, 'FISHFM / 肥鱼电台'), h('h1', null, '工作时，放点喜欢的音乐'))),
          h('div', { className: 'fm-top-actions' }, h('button', { type: 'button', className: 'fm-button fm-subtle',
            'aria-pressed': state.widgetVisible, onClick: () => controller.setWidgetVisible(!state.widgetVisible) }, state.widgetVisible ? '离开面板后显示悬浮条' : '离开面板后隐藏悬浮条'),
          h('button', { type: 'button', className: 'fm-button', onClick: close || back }, close ? '关闭设置' : '返回对话'))),
        h('section', { className: 'fm-hero', 'aria-label': '当前播放' },
          h('div', { className: 'fm-art', 'data-rest': !playing }, h('img', { src: `/fishfm/assets/${art}.png`, alt: '鲸鱼娘音乐状态' })),
          h('div', { className: 'fm-hero-copy' },
            h('div', { className: 'fm-live' }, h('i', { className: 'fm-dot', 'data-off': !state.connected || !playing }),
              !state.connected ? snapshot ? '音乐服务断开 · 显示上次状态' : '正在连接本地音乐服务' : playing ? '正在播放' : snapshot?.paused ? '已暂停 · 不会自动恢复' : '电台待命'),
            h('div', { className: 'fm-track' }, current?.track?.title || '还没有正在播放的音乐'),
            h('p', { className: 'fm-artist' }, current?.track?.artist || '选择一种听歌方式，再连接音乐平台。'),
            current && h(React.Fragment, null,
              h('div', { className: 'fm-progress', 'aria-label': '播放进度' }, h('span', { style: { width: `${progressPercent(current)}%` } })),
              h('div', { className: 'fm-time' }, h('span', null, minutes(current.positionMs)), h('span', null, current.track.durationMs ? minutes(current.track.durationMs) : '--:--'))),
            h('div', { className: 'fm-controls' }, button(!current ? '开始听歌' : snapshot?.paused ? '继续播放' : '暂停', !current || snapshot?.paused ? 'resume' : 'pause', !current && !state.library?.total && !snapshot?.queue?.length),
              button('下一首', 'next', !current && !snapshot?.queue?.length && !state.library?.total), button('今天停止', 'stopForToday')),
            state.library?.tracks?.length > 0 && h('div', { className: 'fm-controls' },
              h('select', { className: 'fm-button', 'aria-label': '选择已导入曲目', value: selectedTrack, disabled,
                style: { maxWidth: '100%', minWidth: 0 }, onChange: event => setSelectedTrack(event.target.value) },
                h('option', { value: '' }, '选择已导入曲目'), ...state.library.tracks.map(track =>
                  h('option', { key: `${track.provider}:${track.providerTrackId}`, value: `${track.provider}:${track.providerTrackId}` }, `${track.title || track.providerTrackId} · ${track.artist || track.provider}`))),
              h('button', { type: 'button', className: 'fm-button', disabled: disabled || !selectedTrack,
                onClick: () => { const track = state.library.tracks.find(row => `${row.provider}:${row.providerTrackId}` === selectedTrack); if (track) controller.command('requestTrack', track); } }, '播放这首')))),
        state.error && h('div', { className: 'fm-notice', 'data-error': true, role: 'alert' }, state.error,
          ' ', h('button', { className: 'fm-button', type: 'button', disabled: state.busy, onClick: controller.refresh }, '重新连接')),
        snapshot?.lastError && h('div', { className: 'fm-notice', role: 'status' }, `播放尚未成功：${snapshot.lastError.code || 'playback_failed'}。请核对平台连接和曲目权限。`),
        snapshot?.blockUntil > Date.now() && h('div', { className: 'fm-notice' }, '今天已停止自主听歌。到期后仍会保持暂停，直到你主动恢复。'),
        h('div', { className: 'fm-grid' },
          h('div', null,
            h('section', null, h('h2', null, '听歌偏好', h('small', null, 'PREFERENCES')), h('div', { className: 'fm-card' },
              toggle('DeepSeek 自主听歌', '允许自动选歌、续播，并从实际收听中成长。', 'listening', 'setListening'),
              toggle('电脑输出声音', '关闭后仍记录播放进度，但不会让电脑发声。', 'humanPlayback', 'setHumanPlayback'),
              toggle('探索新音乐', '有可用候选时尝试发现陌生歌曲。', 'discovery', 'setDiscovery'),
              h('div', { className: 'fm-rate' }, h('div', { className: 'fm-rate-head' }, h('label', { htmlFor: rateId }, '新歌探索率'), h('output', { htmlFor: rateId }, `${rate}%`)),
                h('input', { id: rateId, 'aria-label': '新歌探索率', type: 'range', min: 0, max: 100, step: 1, value: rate, disabled: disabled || !settings.discovery,
                  onChange: e => setRate(Number(e.target.value)) }),
                h('div', { className: 'fm-save-line' }, h('span', { className: 'fm-save', role: 'status', 'aria-live': 'polite' }, state.notice || '开关即时保存；探索率需点击保存。'),
                  h('button', { type: 'button', className: 'fm-button', disabled: disabled || !settings.discovery || rate === Math.round(settings.discoveryRate * 100),
                    onClick: () => controller.command('setDiscoveryRate', rate / 100) }, '保存'))))),
            platformSection),
          h('div', null,
            h('section', null, h('h2', null, '快捷模式', h('small', null, 'MODES')), h('div', { className: 'fm-modes' }, modes.map(([id, title, desc]) =>
              h('button', { type: 'button', key: id, className: 'fm-mode', 'aria-pressed': mode === id, disabled,
                onClick: () => controller.command('setMode', id) }, h('strong', null, title), h('span', null, desc)))),
              mode === 'manual' && h('p', { className: 'fm-manual' }, '当前为仅手动点播：声音开启，自主听歌关闭。')),
            h('div', { className: 'fm-widget-pref', role: 'status' }, h(Svg, { type: 'grip' }),
              state.widgetVisible ? '悬浮条会在离开此面板后显示，可拖动并吸附到左右边缘。' : '悬浮条已隐藏，可随时重新显示。'))),
        h('footer', { className: 'fm-foot' }, h('span', null, '设置和登录材料保存在本机 · 关闭面板不会结束音乐服务'), h('span', null, '本地规则选歌 · 不新增模型请求'))));
    }

    function FloatingPlayer({ controller, layout, usePanelInfo }) {
      const state = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot);
      const activePanelId = typeof usePanelInfo === 'function' ? usePanelInfo(info => info.activePanelId) : null;
      const [expanded, setExpanded] = React.useState(false);
      const [menuOpen, setMenuOpen] = React.useState(false);
      const [dragPosition, setDragPosition] = React.useState(null);
      const rootRef = React.useRef(null);
      const triggerRef = React.useRef(null);
      const priorFocus = React.useRef(null);
      const drag = React.useRef(null);
      // Slot entries may add a zero-size wrapper. Position against the shell's
      // actual overlay frame, which owns absolute positioning and edge docking.
      const frameRect = () => {
        const root = rootRef.current;
        return (root?.closest?.('[data-shell-overlay]') ?? root?.parentElement)?.getBoundingClientRect();
      };
      const snapshot = state.snapshot;
      const current = snapshot?.current;
      const playing = snapshot?.status === 'playing';
      const paused = snapshot?.paused === true;
      const settings = snapshot?.settings || {};
      const mode = !settings.listening ? (settings.humanPlayback ? 'manual' : 'off') : !settings.humanPlayback ? 'silent' : settings.strategy === 'focus' ? 'focus' : 'normal';
      const image = playing ? 'whale-listening' : snapshot?.status === 'selecting' ? 'whale-dj' : 'whale-idle';
      const blocked = !state.connected || state.busy;
      function openDrawer() { priorFocus.current = document.activeElement; setMenuOpen(false); setExpanded(true); }
      function openMenu() { priorFocus.current = document.activeElement; setExpanded(false); setMenuOpen(true); }
      function closeOverlay() { setExpanded(false); setMenuOpen(false); }
      React.useEffect(() => {
        if (!expanded && !menuOpen) { priorFocus.current?.focus?.(); return undefined; }
        const onKeyDown = event => {
          if (event.key === 'Escape') { event.preventDefault(); closeOverlay(); }
        };
        const onOutside = event => { if (!rootRef.current?.contains(event.target)) closeOverlay(); };
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('pointerdown', onOutside, true);
        const focusTarget = rootRef.current?.querySelector(expanded ? '.fm-drawer-close' : '.fm-float-menu button');
        focusTarget?.focus?.();
        return () => { document.removeEventListener('keydown', onKeyDown); document.removeEventListener('pointerdown', onOutside, true); };
      }, [expanded, menuOpen]);
      React.useEffect(() => {
        const keepInFrame = () => {
          const root = rootRef.current;
          const position = controller.getSnapshot().widgetPosition;
          const frame = frameRect();
          const rect = root?.getBoundingClientRect();
          if (!position || !frame || !rect || frame.height <= 0) return;
          const top = Math.max(4, Math.min(position.top, frame.height - rect.height - 4));
          if (top !== position.top) controller.setWidgetPosition({ edge: position.edge, top });
        };
        window.addEventListener('resize', keepInFrame);
        return () => window.removeEventListener('resize', keepInFrame);
      }, [controller, state.widgetPosition]);
      function dragStart(event) {
        if (event.button !== undefined && event.button !== 0) return;
        const root = rootRef.current;
        const rect = root?.getBoundingClientRect();
        const frame = frameRect();
        if (!rect || !frame) return;
        drag.current = { startX: event.clientX, startY: event.clientY, left: rect.left - frame.left, top: rect.top - frame.top,
          width: rect.width, height: rect.height, frameWidth: frame.width, frameHeight: frame.height };
        closeOverlay();
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* PointerCapture is optional */ }
        event.preventDefault();
      }
      function dragMove(event) {
        if (!drag.current) return;
        const next = drag.current;
        next.left = Math.max(4, Math.min(next.frameWidth - next.width - 4, next.left + event.clientX - next.startX));
        next.top = Math.max(4, Math.min(next.frameHeight - next.height - 4, next.top + event.clientY - next.startY));
        next.startX = event.clientX; next.startY = event.clientY;
        setDragPosition({ left: next.left, top: next.top });
      }
      function dragEnd() {
        if (!drag.current) return;
        const next = drag.current;
        const edge = next.left + next.width / 2 < next.frameWidth / 2 ? 'left' : 'right';
        controller.setWidgetPosition({ edge, top: Math.max(4, Math.min(next.top, next.frameHeight - next.height - 4)) });
        drag.current = null;
        setDragPosition(null);
      }
      function nudge(event) {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const frame = frameRect();
        const rect = rootRef.current?.getBoundingClientRect();
        if (!frame || !rect) return;
        let edge = state.widgetPosition?.edge ?? 'right';
        let top = state.widgetPosition?.top ?? frame.height - rect.height - 18;
        if (event.key === 'ArrowLeft') edge = 'left';
        if (event.key === 'ArrowRight') edge = 'right';
        if (event.key === 'ArrowUp') top -= 16;
        if (event.key === 'ArrowDown') top += 16;
        controller.setWidgetPosition({ edge, top: Math.max(4, Math.min(frame.height - rect.height - 4, top)) });
      }
      if (!state.widgetVisible || activePanelId === 'fishfm') return null;
      const position = state.widgetPosition;
      const style = dragPosition
        ? { left: `${dragPosition.left}px`, top: `${dragPosition.top}px`, right: 'auto', bottom: 'auto' }
        : position?.edge === 'left'
          ? { left: '16px', right: 'auto', top: `${position.top}px`, bottom: 'auto' }
          : position?.edge === 'right'
            ? { right: '16px', left: 'auto', top: `${position.top}px`, bottom: 'auto' }
            : { right: '16px', bottom: '16px', left: 'auto', top: 'auto' };
      return h('div', { ref: rootRef, className: 'fm-float', style, 'data-edge': dragPosition ? 'right' : position?.edge || 'right' },
        expanded && h('div', { id: 'fishfm-quick-controls', className: 'fm-float-drawer', role: 'dialog', 'aria-label': '音乐快捷控制', 'aria-modal': false },
          h(SwipeHandle, { onClose: () => setExpanded(false) }),
          h('div', { className: 'fm-float-drawer-head' }, h('span', { className: 'fm-float-drawer-label' }, 'FISHFM / 快捷控制'),
            h('button', { type: 'button', className: 'fm-float-icon fm-drawer-close', 'aria-label': '收起快捷控制', onClick: closeOverlay }, h(Svg, { type: 'close' }))),
          h('div', { className: 'fm-float-drawer-body' },
            current ? h(React.Fragment, null,
              h('div', { className: 'fm-float-track' }, h('strong', null, current.track?.title || '正在播放'), h('span', null, current.track?.artist || '未知艺人')),
              h('div', { className: 'fm-progress' }, h('span', { style: { width: `${progressPercent(current)}%` } })),
              h('div', { className: 'fm-time' }, h('span', null, playing ? '正在播放' : paused ? '已暂停' : '等待音乐'),
                h('span', null, `${minutes(current.positionMs)} / ${current.track?.durationMs ? minutes(current.track.durationMs) : '--:--'}`)))
              : h('div', { className: 'fm-float-empty' }, snapshot ? '当前没有播放曲目。可以打开电台设置或导入音乐。' : state.connected ? '正在读取播放状态…' : '本地音乐服务暂时无法连接。'),
            h('div', { className: 'fm-float-controls' },
              h('button', { type: 'button', className: 'fm-button', disabled: blocked || (!current && !state.library?.total && !snapshot?.queue?.length),
                'aria-label': !current ? '开始听歌' : paused ? '继续播放' : '暂停', onClick: () => controller.command(!current || paused ? 'resume' : 'pause') }, h(Svg, { type: !current || paused ? 'play' : 'pause' }), !current ? '开始听歌' : paused ? '继续播放' : '暂停'),
              h('button', { type: 'button', className: 'fm-button', disabled: blocked || (!current && !snapshot?.queue?.length && !state.library?.total),
                'aria-label': '播放下一首', onClick: () => controller.command('next') }, h(Svg, { type: 'next' }), '下一首')))),
        menuOpen && h('div', { className: 'fm-float-menu', role: 'menu', 'aria-label': '音乐快捷菜单' },
          h('div', { className: 'fm-menu-section' }, '快捷模式'),
          modes.map(([id, title]) => h('button', { type: 'button', key: id, role: 'menuitemradio', 'aria-checked': mode === id, disabled: blocked,
            onClick: () => { closeOverlay(); controller.command('setMode', id); } }, h('span', null, title), mode === id && h('span', { className: 'fm-menu-check', 'aria-hidden': true }, '✓'))),
          h('div', { className: 'fm-menu-sep' }),
          h('button', { type: 'button', role: 'menuitemcheckbox', 'aria-checked': Boolean(settings.listening), disabled: blocked,
            onClick: () => controller.command('setListening', !settings.listening) }, h('span', null, 'DeepSeek 自主听歌'), h('span', { className: 'fm-menu-check' }, settings.listening ? '✓' : '')),
          h('button', { type: 'button', role: 'menuitemcheckbox', 'aria-checked': Boolean(settings.humanPlayback), disabled: blocked,
            onClick: () => controller.command('setHumanPlayback', !settings.humanPlayback) }, h('span', null, '电脑输出声音'), h('span', { className: 'fm-menu-check' }, settings.humanPlayback ? '✓' : '')),
          h('button', { type: 'button', role: 'menuitemcheckbox', 'aria-checked': Boolean(settings.discovery), disabled: blocked,
            onClick: () => controller.command('setDiscovery', !settings.discovery) }, h('span', null, '探索新音乐'), h('span', { className: 'fm-menu-check' }, settings.discovery ? '✓' : '')),
          h('div', { className: 'fm-menu-sep' }),
          h('button', { type: 'button', role: 'menuitem', onClick: () => { closeOverlay(); layout.selectPanel('fishfm'); } }, h('span', null, '打开肥鱼电台设置'), h(Svg, { type: 'arrow' })),
          h('button', { type: 'button', role: 'menuitem', onClick: () => { controller.setWidgetVisible(false); closeOverlay(); } }, h('span', null, '隐藏悬浮条'), h('span', null, '×')),
          h('div', { className: 'fm-float-hint' }, `当前模式：${modes.find(([id]) => id === mode)?.[1] || '手动点播'}`)),
        h('div', { className: 'fm-float-pill' },
          h('button', { type: 'button', className: 'fm-float-handle', 'aria-label': '拖动悬浮条；使用方向键移动并吸附边缘', title: '拖动；方向键可移动',
            onPointerDown: dragStart, onPointerMove: dragMove, onPointerUp: dragEnd, onPointerCancel: dragEnd, onKeyDown: nudge }, h(Svg, { type: 'grip' })),
          h('button', { ref: triggerRef, type: 'button', className: 'fm-float-trigger', 'aria-expanded': expanded, 'aria-controls': 'fishfm-quick-controls',
            onClick: () => expanded ? closeOverlay() : openDrawer() },
            h('span', { className: 'fm-float-art', 'aria-hidden': true }, h('img', { src: `/fishfm/assets/${image}.png`, alt: '' })),
            h('span', { className: 'fm-float-copy' }, h('span', { className: 'fm-float-title' }, current?.track?.title || '肥鱼电台 · 待命'),
              h('span', { className: 'fm-float-artist' }, current?.track?.artist || (state.connected ? '点击展开快捷控制' : '连接本地音乐服务中')),
              h('span', { className: 'fm-float-status' }, h('i', { className: 'fm-float-dot', 'data-off': !state.connected || !playing }),
                !state.connected ? '连接中断' : playing ? '正在播放' : paused ? '已暂停' : '等待音乐'))),
          h('div', { className: 'fm-float-actions' }, h('button', { type: 'button', className: 'fm-float-icon fm-float-more', 'aria-label': '更多音乐设置',
            'aria-haspopup': 'menu', 'aria-expanded': menuOpen, onClick: () => menuOpen ? closeOverlay() : openMenu() }, h(Svg, { type: 'more' })))),
      );
    }

    function Icon() {
      return h('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, 'aria-hidden': true },
        h('path', { d: 'M9 18V5l12-2v13M9 18c0 1.1-1.3 2-3 2s-3-.9-3-2 1.3-2 3-2 3 .9 3 2Zm12-2c0 1.1-1.3 2-3 2s-3-.9-3-2 1.3-2 3-2 3 .9 3 2Z' }));
    }

    function apply(ctx) {
      const controller = createController(ctx.connection);
      ctx.effect(() => {
        const style = document.createElement('style'); style.dataset.plugin = 'fishfm'; style.textContent = css; document.head.appendChild(style);
        return () => { controller.dispose(); style.remove(); };
      });
      // DSH 0.2.0-rc.1 maps null to the Conversation; 'conversation' is not a
      // registered third-party main panel key.
      const inject = () => ({ controller, back: () => ctx.layout.selectPanel(null) });
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'fishfm', inject }, Panel));
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'fishfm', order: 25, label: () => '肥鱼电台' }, Icon));
      ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'fishfm', order: 65, label: () => '肥鱼电台', inject }, Panel));
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'fishfm.player', order: 30,
        inject: () => ({ controller, layout: ctx.layout }) }, FloatingPlayer));
    }
    return { apply, inject: ['slots', 'connection', 'layout'] };
  },
});
