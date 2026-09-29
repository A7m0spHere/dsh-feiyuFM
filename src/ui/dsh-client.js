// Original client bundle using the verified DSH module/slot contracts.
window.__ModuleLoader__.load({
  id: 'dsh-feiyufm-core',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;
    const css = `
      .fishfm{--ink:var(--dsw-alias-label-primary,#20323e);--muted:var(--dsw-alias-label-secondary,#6e7e87);--line:color-mix(in srgb,var(--ink) 12%,transparent);--blue:#347fba;box-sizing:border-box;color:var(--ink);font-family:"Segoe UI","Microsoft YaHei",sans-serif;height:100%;overflow:auto;padding:36px clamp(20px,4vw,64px);background:var(--dsw-alias-background-primary,transparent)}
      .fishfm *{box-sizing:border-box}.fishfm .fm-wrap{max-width:940px;margin:auto}.fishfm .fm-top{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:32px}.fishfm .fm-eyebrow{font:600 11px/1.5 "Segoe UI",sans-serif;letter-spacing:3px;color:var(--blue)}.fishfm h1{font-size:29px;letter-spacing:-1px;margin:6px 0}.fishfm p{color:var(--muted);font-size:13px;line-height:1.8;margin:6px 0}.fishfm button,.fishfm input{font:inherit}.fishfm button{cursor:pointer}.fishfm button:disabled{opacity:.45;cursor:not-allowed}.fishfm button:focus-visible,.fishfm input:focus-visible{outline:3px solid #57a9e2;outline-offset:4px}.fishfm .fm-button{background:transparent;color:var(--ink);border:1px solid var(--line);border-radius:10px;padding:9px 15px;font-size:13px}.fishfm .fm-button:hover:not(:disabled){background:color-mix(in srgb,var(--blue) 9%,transparent)}.fishfm .fm-primary{background:var(--blue);color:white;border-color:var(--blue)}.fishfm .fm-primary:hover:not(:disabled){background:#286b9e}.fishfm .fm-live{font-size:12px;display:flex;align-items:center;gap:7px;color:var(--muted)}.fishfm .fm-dot{width:7px;height:7px;background:#4b9e89;border-radius:50%}.fishfm .fm-dot[data-off=true]{background:#b88b52}
      .fishfm .fm-now{display:grid;grid-template-columns:110px 1fr;gap:25px;align-items:center;padding:26px;border:1px solid var(--line);border-radius:20px;background:linear-gradient(115deg,color-mix(in srgb,var(--blue) 9%,transparent),transparent 70%);margin-bottom:28px}.fishfm .fm-record{border-radius:50%;width:100px;height:100px;background:repeating-radial-gradient(circle at center,#283f50 0px,#283f50 3px,#30495b 4px,#30495b 5px);display:grid;place-items:center;box-shadow:0 8px 20px #122b3d18}.fishfm .fm-record span{display:grid;place-items:center;width:37px;height:37px;border-radius:50%;background:#aad2e9;color:#234354;font-size:21px}.fishfm .fm-track{font-size:20px;font-weight:600;overflow-wrap:anywhere}.fishfm .fm-controls{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.fishfm .fm-progress{height:3px;background:var(--line);border-radius:3px;margin:12px 0 5px;overflow:hidden}.fishfm .fm-progress span{display:block;height:100%;background:var(--blue)}.fishfm .fm-time{font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}.fishfm .fm-grid{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(240px,1fr);gap:28px}.fishfm section{margin-bottom:26px}.fishfm h2{font-size:15px;margin:0 0 14px;display:flex;align-items:center;gap:10px}.fishfm h2 small{font-size:10px;letter-spacing:1.5px;color:var(--muted);font-weight:400}.fishfm .fm-box{border:1px solid var(--line);border-radius:14px;padding:0 18px}.fishfm .fm-row{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:17px 0}.fishfm .fm-row+.fm-row{border-top:1px solid var(--line)}.fishfm .fm-label{font-size:14px;font-weight:500}.fishfm .fm-row p{font-size:12px;line-height:1.6;margin:4px 0 0}.fishfm .fm-toggle{flex-shrink:0;width:38px;height:23px;border:0;border-radius:20px;background:color-mix(in srgb,var(--ink) 20%,transparent);padding:3px;transition:background .15s}.fishfm .fm-toggle[aria-checked=true]{background:var(--blue)}.fishfm .fm-toggle span{display:block;width:17px;height:17px;border-radius:50%;background:white;box-shadow:0 1px 3px #0002;transition:transform .15s}.fishfm .fm-toggle[aria-checked=true] span{transform:translateX(15px)}.fishfm .fm-rate{padding:0 0 18px}.fishfm .fm-rate-head{display:flex;justify-content:space-between;font-size:12px;margin-bottom:10px;color:var(--muted)}.fishfm .fm-rate output{color:var(--blue);font-weight:700}.fishfm input[type=range]{width:100%;accent-color:var(--blue);cursor:pointer}.fishfm .fm-modes{display:grid;grid-template-columns:1fr 1fr;gap:8px}.fishfm .fm-mode{text-align:left;border:1px solid var(--line);border-radius:12px;padding:13px;background:transparent;color:var(--ink)}.fishfm .fm-mode[aria-pressed=true]{border-color:var(--blue);background:color-mix(in srgb,var(--blue) 9%,transparent)}.fishfm .fm-mode strong{font-size:13px;display:block}.fishfm .fm-mode span{font-size:11px;color:var(--muted);display:block;margin-top:5px;line-height:1.6}.fishfm .fm-platform{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 0;font-size:13px}.fishfm .fm-platform+.fm-platform{border-top:1px solid var(--line)}.fishfm .fm-badge{font-size:11px;color:var(--muted);border:1px solid var(--line);padding:3px 8px;border-radius:20px}.fishfm .fm-notice{padding:12px 15px;border-radius:10px;background:color-mix(in srgb,#c48a36 12%,transparent);font-size:12px;line-height:1.7;margin-bottom:18px}.fishfm .fm-foot{padding-top:18px;border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:15px;font-size:11px;color:var(--muted);line-height:1.8}.fishfm .fm-save{min-height:20px;font-size:12px;color:var(--muted)}
      .fishfm .fm-qr-box{margin:8px 0 16px;padding:18px;text-align:center;background:color-mix(in srgb,var(--blue) 5%,transparent);border:1px solid var(--line);border-radius:13px}.fishfm .fm-qr-box p{font-size:12px;margin-top:10px}.fishfm .fm-qr-box img{background:#fff;padding:9px;border-radius:8px}.fishfm .fm-import{font-size:12px;color:var(--muted);line-height:1.7;margin-top:10px}
      @media(max-width:700px){.fishfm{padding:24px 18px}.fishfm .fm-grid{grid-template-columns:1fr;gap:0}.fishfm .fm-now{grid-template-columns:64px 1fr;padding:18px;gap:16px}.fishfm .fm-record{width:64px;height:64px}.fishfm .fm-top{align-items:flex-start}.fishfm .fm-foot{flex-direction:column}.fishfm h1{font-size:25px}}
      @media(prefers-reduced-motion:reduce){.fishfm *{transition:none!important}}
    `;

    function createController(connection) {
      let state = { snapshot: null, platforms: {}, busy: false, connected: false, error: '', notice: '', login: null, imported: null };
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
          if (listeners.size === 1) { refresh(); timer = setInterval(() => { if (!document.hidden) refresh(); }, 2000); }
          return () => { listeners.delete(fn); if (!listeners.size) { clearInterval(timer); ++epoch; read?.abort(); read = null; } };
        },
        refresh,
        async command(type, value) {
          if (disposed || state.busy || !state.connected) return;
          ++epoch; read?.abort(); read = null;
          emit({ busy: true, error: '', notice: '正在保存…' });
          write = new AbortController();
          const timeout = setTimeout(() => write?.abort(), 25000);
          try {
            const result = await connection.rpc.call('/api', 'fishfm/command', { type, value }, write.signal);
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
          emit({ busy: true, error: '', notice: action === 'poll' ? '正在确认手机扫码…' : '正在连接音乐平台…' });
          write = new AbortController();
          const timeout = setTimeout(() => write?.abort(), action === 'import' ? 90000 : 45000);
          try {
            const result = await connection.rpc.call('/api', endpoint, { provider }, write.signal);
            if (!result.ok) throw result.error;
            const value = result.value;
            const login = Object.hasOwn(value, 'login') ? value.login : state.login;
            if (action === 'poll' && login) login.qrImage = state.login?.qrImage;
            emit({ snapshot: value.snapshot, platforms: value.platforms ?? state.platforms,
              login,
              imported: Object.hasOwn(value, 'imported') ? value.imported : state.imported, connected: true, error: '',
              notice: action === 'logout' ? '已退出网易云账号，本机凭据已删除。'
                : action === 'import'
                ? `已读取${value.imported?.source || '平台音乐'}：新增 ${value.imported?.imported ?? 0} 首，当前共 ${value.imported?.total ?? 0} 首${value.imported?.degraded ? '（数量不足或已降级，详见提示）' : ''}`
                : value.login?.status === 'authorized' ? '登录成功，可以导入音乐。'
                : value.login?.status === 'scanned' ? '已扫码，请在手机上确认登录。'
                : value.login?.status === 'expired' ? '二维码已过期，请重新获取。'
                : action === 'begin' ? '请用网易云音乐 App 扫描二维码。' : '等待手机确认…' });
          } catch (error) {
            emit({ connected: false, error: failure(error), notice: '登录步骤未完成，可重新扫码或刷新重试。',
              login: action === 'begin' ? null : { ...(state.login ?? {}), status: 'error' } });
          } finally { clearTimeout(timeout); write = null; emit({ busy: false }); }
        },
        dispose() { disposed = true; ++epoch; clearInterval(timer); read?.abort(); write?.abort(); listeners.clear(); },
      };
    }
    const minutes = ms => { const s = Math.floor(Math.max(0, ms || 0) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
    const modes = [['normal', '日常', '开始自主听歌，保留声音设置'], ['focus', '专注', '开始听歌、减少切换，保留声音'], ['silent', '静听', '开始自主听歌，电脑静音'], ['off', '关闭', '暂停并关闭自主听歌与声音']];
    function Panel({ controller, back, close }) {
      const state = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot);
      const snapshot = state.snapshot;
      const settings = snapshot?.settings || {};
      const [rate, setRate] = React.useState(20);
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
      function toggle(title, description, field, command) {
        return h('div', { className: 'fm-row' }, h('div', null, h('div', { className: 'fm-label' }, title), h('p', null, description)),
          h('button', { type: 'button', className: 'fm-toggle', role: 'switch', 'aria-label': title, 'aria-checked': Boolean(settings[field]), disabled,
            onClick: () => controller.command(command, !settings[field]) }, h('span')));
      }
      const button = (label, type, blocked = false) => h('button', { type: 'button', className: 'fm-button', disabled: disabled || blocked, onClick: () => controller.command(type) }, label);
      return h('div', { className: 'fishfm' }, h('div', { className: 'fm-wrap' },
        h('header', { className: 'fm-top' }, h('div', null, h('div', { className: 'fm-eyebrow' }, 'FISHFM / 肥鱼电台'), h('h1', null, '给工作配一点音乐'), h('p', null, '听歌的节奏，由你决定。')),
          h('button', { type: 'button', className: 'fm-button', onClick: close || back }, close ? '关闭设置' : '返回对话')),
        h('div', { className: 'fm-now' }, h('div', { className: 'fm-record', 'aria-hidden': true }, h('span', null, '♪')),
          h('div', null, h('div', { className: 'fm-live' }, h('i', { className: 'fm-dot', 'data-off': !state.connected }), !state.connected ? (snapshot ? '连接已断开 · 显示上次状态' : '正在连接音乐服务') : playing ? '正在播放' : snapshot?.paused ? '已暂停 · 不会自动恢复' : '等待音乐'),
            h('div', { className: 'fm-track' }, current?.track?.title || '还没有正在播放的音乐'),
            h('p', null, current?.track?.artist || '可以先设置听歌方式，再连接音乐平台。'),
            current && h(React.Fragment, null, h('div', { className: 'fm-progress' }, h('span', { style: { width: `${Math.min(100, 100 * (current.positionMs || 0) / (current.track.durationMs || 1))}%` } })), h('div', { className: 'fm-time' }, `${minutes(current.positionMs)} / ${current.track.durationMs ? minutes(current.track.durationMs) : '--:--'}`)),
            h('div', { className: 'fm-controls' }, button(snapshot?.paused ? '继续播放' : '暂停', snapshot?.paused ? 'resume' : 'pause', !current), button('下一首', 'next', !current && !snapshot?.queue?.length), button('今天别听歌了', 'stopForToday')))),
        state.error && h('div', { className: 'fm-notice', role: 'alert' }, state.error, ' ', h('button', { className: 'fm-button', type: 'button', disabled: state.busy, onClick: controller.refresh }, '重新连接')),
        snapshot?.lastError && h('div', { className: 'fm-notice', role: 'status' }, `播放尚未成功：${snapshot.lastError.code || 'playback_failed'}。请核对平台连接和曲目权限。`),
        snapshot?.blockUntil > Date.now() && h('div', { className: 'fm-notice' }, '今天已停止自主听歌。到期后仍会保持暂停，直到你主动恢复。'),
        h('div', { className: 'fm-grid' }, h('div', null,
          h('section', null, h('h2', null, '听歌偏好', h('small', null, 'PREFERENCES')), h('div', { className: 'fm-box' },
            toggle('DeepSeek 自主听歌', '允许自主选歌、自动续播和偏好成长。', 'listening', 'setListening'),
            toggle('电脑输出声音', '关闭后静音，不等同于暂停播放。', 'humanPlayback', 'setHumanPlayback'),
            toggle('探索新音乐', '尝试发现陌生歌曲；没有候选时回到熟悉的音乐。', 'discovery', 'setDiscovery'),
            h('div', { className: 'fm-rate' }, h('div', { className: 'fm-rate-head' }, h('label', { htmlFor: rateId }, '新歌探索率'), h('output', { htmlFor: rateId }, `${rate}%`)),
              h('input', { id: rateId, 'aria-label': '新歌探索率', type: 'range', min: 0, max: 100, step: 1, value: rate, disabled: disabled || !settings.discovery, onChange: e => setRate(Number(e.target.value)) }),
              h('div', { className: 'fm-controls' }, h('button', { type: 'button', className: 'fm-button', disabled: disabled || !settings.discovery || rate === Math.round(settings.discoveryRate * 100), onClick: () => controller.command('setDiscoveryRate', rate / 100) }, '保存探索率'))))),
          h('div', { className: 'fm-save', role: 'status', 'aria-live': 'polite' }, state.notice || '开关与模式即时保存；探索率调整后点击保存。')),
          h('div', null, h('section', null, h('h2', null, '快捷模式', h('small', null, 'MODES')), h('div', { className: 'fm-modes' }, modes.map(([id, title, desc]) => h('button', { type: 'button', key: id, className: 'fm-mode', 'aria-pressed': mode === id, disabled, onClick: () => controller.command('setMode', id) }, h('strong', null, title), h('span', null, desc)))),
              mode === 'manual' && h('p', null, '当前为仅手动点播：声音开启，自主听歌关闭。')),
            h('section', null, h('h2', null, '音乐平台', h('small', null, 'CONNECTIONS')), h('div', { className: 'fm-box' }, [['netease', '网易云音乐'], ['qq', 'QQ 音乐']].map(([id, title]) => {
              const platform = state.platforms?.[id];
              const label = !snapshot ? '读取中' : !platform?.installed ? '接口尚未接入' : ({ authorized: '已登录', expired: '登录已过期', signed_out: '未登录', login_required: platform.account?.pending ? '等待扫码' : '未登录' }[platform.account?.status] || '未连接');
              const available = id === 'netease' && platform?.installed;
              return h('div', { className: 'fm-platform', key: id }, h('span', null, title),
                h('div', { className: 'fm-controls', style: { marginTop: 0 } },
                  h('span', { className: 'fm-badge' }, label),
                  available && (platform?.account?.status === 'authorized'
                    ? h(React.Fragment, null, h('button', { type: 'button', className: 'fm-button fm-primary', disabled: state.busy || !state.connected, onClick: () => controller.platformAction('import', id) }, '导入我的音乐'),
                      h('button', { type: 'button', className: 'fm-button', disabled: state.busy || !state.connected, onClick: () => controller.platformAction('logout', id) }, '退出账号'))
                    : !state.login && h('button', { type: 'button', className: 'fm-button fm-primary', disabled: state.busy || !state.connected, onClick: () => controller.platformAction('begin', id) }, '扫码登录'))));
            }),
            state.login?.provider === 'netease' && h('div', { className: 'fm-qr-box' },
              h('div', { className: 'fm-label' }, state.login.status === 'authorized' ? '网易云音乐已连接' : state.login.status === 'scanned' ? '已扫码，请在手机上确认' : state.login.status === 'expired' ? '二维码已过期' : '使用网易云音乐 App 扫描'),
              state.login.qrImage && !['authorized', 'expired', 'error'].includes(state.login.status) && h('img', { src: state.login.qrImage, width: 176, height: 176, alt: '网易云音乐登录二维码', style: { display: 'block', margin: '14px auto', imageRendering: 'pixelated' } }),
              h('p', { role: 'status', 'aria-live': 'polite' }, state.login.status === 'authorized' ? '账号凭据已加密保存在本机，可开始导入。' : state.login.status === 'expired' ? '请重新获取二维码后再试。' : '扫码进度会自动刷新，确认后即可导入音乐。'),
              ['expired', 'error'].includes(state.login.status) && h('button', { type: 'button', className: 'fm-button fm-primary', disabled: state.busy || !state.connected, onClick: () => controller.platformAction('begin', 'netease') }, '重新获取二维码')),
            state.imported && h('p', { className: 'fm-import', role: 'status', 'aria-live': 'polite' }, `最近导入：${state.imported.source || '平台音乐'} · 新增 ${state.imported.imported ?? 0} 首，累计 ${state.imported.total ?? 0} 首${state.imported.degraded && state.imported.reason ? ` · ${state.imported.reason}` : ''}`),
            h('p', null, '网易云扫码登录后可导入音乐。QQ 当前尚无已核实的接口，暂不可登录。设置和凭据都保存在本机。')))),
        h('footer', { className: 'fm-foot' }, h('span', null, '设置保存在本机 · 关闭面板不结束音乐服务'), h('span', null, '本地规则选歌 · 不新增模型请求'))));
    }

    function Icon() {
      return h('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, 'aria-hidden': true }, h('path', { d: 'M5 15v-3a7 7 0 0 1 14 0v3M5 13H4a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h3v-6H5Zm14 0h1a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-3v-6h2Z' }));
    }
    function apply(ctx) {
      const controller = createController(ctx.connection);
      ctx.effect(() => {
        const style = document.createElement('style'); style.dataset.plugin = 'fishfm'; style.textContent = css; document.head.appendChild(style);
        return () => { controller.dispose(); style.remove(); };
      });
      const inject = () => ({ controller, back: () => ctx.layout.selectPanel('conversation') });
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'fishfm', inject }, Panel));
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'fishfm', order: 25, label: () => '肥鱼电台' }, Icon));
      ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'fishfm', order: 65, label: () => '肥鱼电台', inject }, Panel));
    }
    return { apply, inject: ['slots', 'connection', 'layout'] };
  },
});
