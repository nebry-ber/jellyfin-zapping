/*!
 * jellyfin-zapping — channel surfing for Jellyfin Live TV (web client)
 * https://github.com/nebry-ber/jellyfin-zapping — MIT License
 *
 * While a Live TV channel is playing:
 *  - ▲/▼ buttons, PageUp/PageDown (and ChannelUp/ChannelDown): next/previous channel
 *  - Backspace: last channel watched
 *  - ☰ button or G key: quick guide with what is on air on every channel
 *  - anti-stutter cushion: after the first stall, wait for a few seconds of buffer
 *    before resuming, so that bursty live sources play smoothly afterwards
 */
(function () {
  'use strict';
  if (window.__jellyfinZapping) return;
  window.__jellyfinZapping = true;

  // --- settings (edit here) --------------------------------------------------
  const BUFFER_TARGET = 20;   // seconds of cushion to build after a stall (0 = off)
  const BUFFER_MAX_WAIT = 30; // never hold playback longer than this

  // --- translations ------------------------------------------------------------
  const I18N = {
    en: { next: 'Next channel (PageUp)', prev: 'Previous channel (PageDown)', guide: 'Guide (G)',
          channels: 'Channels', close: 'Close (Esc)', loading: 'Loading…', failed: 'Channel change failed',
          holding: 'Building buffer…', cushion: 'Buffer {s} s' },
    it: { next: 'Canale successivo (PagSu)', prev: 'Canale precedente (PagGiù)', guide: 'Guida (G)',
          channels: 'Canali', close: 'Chiudi (Esc)', loading: 'Caricamento…', failed: 'Cambio canale non riuscito',
          holding: 'Accumulo margine…', cushion: 'Margine {s} s' },
    de: { next: 'Nächster Sender (Bild↑)', prev: 'Vorheriger Sender (Bild↓)', guide: 'Programm (G)',
          channels: 'Sender', close: 'Schließen (Esc)', loading: 'Wird geladen…', failed: 'Senderwechsel fehlgeschlagen',
          holding: 'Puffer wird aufgebaut…', cushion: 'Puffer {s} s' }
  };
  function lang() {
    const l = (document.documentElement.lang || navigator.language || 'en').slice(0, 2).toLowerCase();
    return I18N[l] ? l : 'en';
  }
  const t = (k, v) => (I18N[lang()][k] || I18N.en[k]).replace('{s}', v);

  // --- state --------------------------------------------------------------------
  let channels = null, current = null, previous = null, sessionId = null;
  let busy = false, live = false;

  const api = () => window.ApiClient;
  const ready = () => { const a = api(); return a && a.getCurrentUserId && a.getCurrentUserId(); };
  const byNumber = list => {
    const num = c => parseFloat(c.ChannelNumber) || 99999;
    return list.slice().sort((x, y) => num(x) - num(y) || x.Name.localeCompare(y.Name));
  };

  async function loadChannels(withProgram) {
    const a = api();
    const res = await a.getJSON(a.getUrl('LiveTv/Channels', {
      UserId: a.getCurrentUserId(), EnableImages: false, EnableUserData: false,
      AddCurrentProgram: !!withProgram
    }));
    channels = byNumber(res.Items);
    return channels;
  }

  // The web client is a controllable session: we find our own session and send it
  // a PlayNow command, so the regular Jellyfin player handles the switch.
  async function refreshState() {
    if (!ready()) return null;
    const a = api();
    const list = await a.getJSON(a.getUrl('Sessions', { DeviceId: a.deviceId() }));
    const s = list && list[0];
    if (!s) return null;
    sessionId = s.Id;
    const it = s.NowPlayingItem;
    if (it && it.Type === 'TvChannel') {
      if (current && current !== it.Id) previous = current;
      current = it.Id;
      return it;
    }
    return null;
  }

  async function playChannel(id) {
    const a = api();
    if (!sessionId) await refreshState();
    await a.ajax({
      type: 'POST',
      url: a.getUrl('Sessions/' + sessionId + '/Playing', { PlayCommand: 'PlayNow', ItemIds: id })
    });
    if (current && current !== id) previous = current;
    current = id;
    resetBuffering();
  }

  async function goTo(target) {
    if (!target || busy) return;
    busy = true;
    try {
      toast((target.ChannelNumber ? target.ChannelNumber + '  ' : '') + target.Name);
      await playChannel(target.Id);
    } catch (e) {
      console.warn('[zapping]', e);
      toast(t('failed'));
    } finally {
      setTimeout(() => { busy = false; }, 1500);
    }
  }

  async function zap(step) {
    if (busy) return;
    try {
      if (!channels) await loadChannels();
      await refreshState();
    } catch (e) { console.warn('[zapping]', e); return; }
    if (!current || !channels.length) return;
    let target;
    if (step === 0) {
      if (!previous) return;
      target = channels.find(c => c.Id === previous);
    } else {
      let i = channels.findIndex(c => c.Id === current);
      if (i < 0) i = 0;
      target = channels[(i + step + channels.length) % channels.length];
    }
    goTo(target);
  }

  // --- anti-stutter cushion -----------------------------------------------------
  let bufVideo = null, bufWaiting = false, bufHolding = false, bufSince = 0;
  function bufferedAhead(v) {
    for (let i = 0; i < v.buffered.length; i++) {
      if (v.buffered.start(i) <= v.currentTime + 0.5 && v.buffered.end(i) >= v.currentTime) {
        return v.buffered.end(i) - v.currentTime;
      }
    }
    return 0;
  }
  function resetBuffering() { bufWaiting = false; bufHolding = false; }
  function attachBuffering() {
    const v = document.querySelector('video');
    if (!v || v === bufVideo) return;
    bufVideo = v;
    resetBuffering();
    v.addEventListener('waiting', () => {
      if (!live || bufHolding) return;
      bufWaiting = true; bufSince = Date.now();
    });
  }
  setInterval(() => {
    const v = bufVideo;
    if (!BUFFER_TARGET || !v || !live) return;
    if (bufWaiting && !bufHolding && v.readyState >= 3) {
      // data is back: instead of resuming at once, build a cushion first
      bufHolding = true; bufWaiting = false; bufSince = Date.now();
      v.pause();
      toast(t('holding'));
    }
    if (bufHolding) {
      const ahead = bufferedAhead(v);
      const waited = (Date.now() - bufSince) / 1000;
      if (ahead >= BUFFER_TARGET || waited >= BUFFER_MAX_WAIT) {
        bufHolding = false;
        v.play().catch(() => {});
        toast(t('cushion', Math.round(ahead)));
      }
    }
  }, 500);

  // --- UI -----------------------------------------------------------------------
  const style = document.createElement('style');
  style.textContent = `
  #zap-box{position:fixed;right:18px;top:50%;transform:translateY(-50%);z-index:99999;
    display:none;flex-direction:column;gap:12px;opacity:0;transition:opacity .3s}
  #zap-box button{width:64px;height:64px;border-radius:50%;border:0;font-size:28px;
    background:rgba(0,0,0,.55);color:#fff;cursor:pointer}
  #zap-box button:hover{background:rgba(0,164,220,.85)}
  #zap-toast{position:fixed;left:50%;top:40px;transform:translateX(-50%);z-index:100001;
    background:rgba(0,0,0,.75);color:#fff;font-size:26px;padding:12px 26px;border-radius:10px;
    display:none;pointer-events:none}
  #zap-guide{position:fixed;left:0;top:0;bottom:0;width:min(520px,92vw);z-index:100000;
    background:rgba(16,16,20,.94);color:#eee;display:none;flex-direction:column;
    font-family:inherit;box-shadow:4px 0 24px rgba(0,0,0,.6)}
  #zap-guide header{display:flex;align-items:center;justify-content:space-between;
    padding:14px 18px;font-size:20px;border-bottom:1px solid rgba(255,255,255,.12)}
  #zap-guide header button{background:none;border:0;color:#fff;font-size:26px;cursor:pointer}
  #zap-guide ul{list-style:none;margin:0;padding:0;overflow-y:auto;flex:1}
  #zap-guide li{display:flex;gap:12px;align-items:center;padding:10px 18px;cursor:pointer;
    border-bottom:1px solid rgba(255,255,255,.05)}
  #zap-guide li:hover,#zap-guide li.sel{background:rgba(0,164,220,.35)}
  #zap-guide li.now{border-left:4px solid #00a4dc;padding-left:14px}
  #zap-guide .n{width:34px;text-align:right;opacity:.6;font-size:15px}
  #zap-guide .t{flex:1;min-width:0}
  #zap-guide .c{font-size:17px;font-weight:600}
  #zap-guide .p{font-size:14px;opacity:.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #zap-guide .bar{height:3px;background:rgba(255,255,255,.15);margin-top:5px;border-radius:2px}
  #zap-guide .bar i{display:block;height:100%;background:#00a4dc;border-radius:2px}`;
  document.head.appendChild(style);

  const box = document.createElement('div');
  box.id = 'zap-box';
  box.innerHTML = '<button>▲</button><button>☰</button><button>▼</button>';
  box.children[0].onclick = () => zap(+1);
  box.children[1].onclick = () => toggleGuide();
  box.children[2].onclick = () => zap(-1);

  const toastEl = document.createElement('div');
  toastEl.id = 'zap-toast';
  let toastTimer;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.style.display = 'none'; }, 2500);
  }

  // quick guide
  const guide = document.createElement('div');
  guide.id = 'zap-guide';
  guide.innerHTML = '<header><span></span><button>✕</button></header><ul></ul>';
  guide.querySelector('header button').onclick = () => toggleGuide(false);
  const guideList = guide.querySelector('ul');
  let guideOpen = false, guideSel = 0;

  function hhmm(d) { return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  async function fillGuide() {
    await loadChannels(true);
    const now = Date.now();
    guideList.innerHTML = channels.map((c, i) => {
      const p = c.CurrentProgram;
      let prog = '<div class="p">—</div>', bar = '';
      if (p && p.StartDate && p.EndDate) {
        const s = new Date(p.StartDate), e = new Date(p.EndDate);
        const pct = Math.max(0, Math.min(100, (now - s) / (e - s) * 100));
        prog = '<div class="p">' + hhmm(s) + '–' + hhmm(e) + '  ' + esc(p.Name) + '</div>';
        bar = '<div class="bar"><i style="width:' + pct.toFixed(0) + '%"></i></div>';
      }
      return '<li data-i="' + i + '" class="' + (c.Id === current ? 'now' : '') + '">' +
        '<span class="n">' + esc(c.ChannelNumber) + '</span>' +
        '<div class="t"><div class="c">' + esc(c.Name) + '</div>' + prog + bar + '</div></li>';
    }).join('');
    guideSel = Math.max(0, channels.findIndex(c => c.Id === current));
    markSel();
  }
  function markSel() {
    guideList.querySelectorAll('li').forEach((li, i) => li.classList.toggle('sel', i === guideSel));
    const li = guideList.children[guideSel];
    if (li) li.scrollIntoView({ block: 'center' });
  }
  guideList.addEventListener('click', ev => {
    const li = ev.target.closest('li[data-i]');
    if (!li) return;
    toggleGuide(false);
    goTo(channels[+li.dataset.i]);
  });
  async function toggleGuide(force) {
    guideOpen = typeof force === 'boolean' ? force : !guideOpen;
    guide.style.display = guideOpen ? 'flex' : 'none';
    if (guideOpen) {
      guide.querySelector('header span').textContent = t('channels');
      guideList.innerHTML = '<li>' + esc(t('loading')) + '</li>';
      try { await refreshState(); await fillGuide(); } catch (e) { console.warn('[zapping]', e); }
    }
  }

  // Jellyfin's player turns the mouse wheel into volume changes: keep the wheel
  // (and clicks) on our panels from reaching it, while still scrolling the list.
  // Capture phase on window runs before the player's own listeners.
  for (const type of ['wheel', 'mousewheel', 'DOMMouseScroll']) {
    window.addEventListener(type, ev => {
      if (ev.target instanceof Node && (guide.contains(ev.target) || box.contains(ev.target))) {
        ev.stopImmediatePropagation();
        ev.stopPropagation();
      }
    }, { capture: true, passive: true });
  }

  function mount() {
    box.children[0].title = t('next');
    box.children[1].title = t('guide');
    box.children[2].title = t('prev');
    guide.querySelector('header button').title = t('close');
    for (const el of [box, toastEl, guide]) if (!document.body.contains(el)) document.body.appendChild(el);
  }

  // buttons follow Jellyfin's own on-screen controls
  function osdVisible() {
    const osd = document.querySelector('.videoOsdBottom');
    return !!osd && !osd.classList.contains('videoOsdBottom-hidden');
  }
  function render() {
    mount();
    const show = live && osdVisible();
    box.style.display = live ? 'flex' : 'none';
    box.style.opacity = show ? '1' : '0';
    box.style.pointerEvents = show ? 'auto' : 'none';
    if (!live && guideOpen) toggleGuide(false);
  }
  new MutationObserver(render).observe(document.documentElement,
    { subtree: true, attributes: true, attributeFilter: ['class'] });

  async function poll() {
    try {
      const onVideo = /#\/video/.test(location.hash);
      live = onVideo && !!(await refreshState());
      if (live) attachBuffering();
    } catch (e) { live = false; }
    render();
  }
  setInterval(poll, 3000);
  window.addEventListener('hashchange', () => setTimeout(poll, 800));

  document.addEventListener('keydown', ev => {
    if (!live) return;
    if (/INPUT|TEXTAREA/.test(ev.target.tagName)) return;
    const k = ev.key;
    if (guideOpen) {
      if (k === 'ArrowDown') guideSel = Math.min(channels.length - 1, guideSel + 1);
      else if (k === 'ArrowUp') guideSel = Math.max(0, guideSel - 1);
      else if (k === 'Enter') { toggleGuide(false); goTo(channels[guideSel]); }
      else if (k === 'Escape' || k === 'g' || k === 'G' || k === 'Backspace') toggleGuide(false);
      else return;
      if (k === 'ArrowDown' || k === 'ArrowUp') markSel();
      ev.preventDefault(); ev.stopPropagation();
      return;
    }
    let step = null;
    if (k === 'PageUp' || k === 'ChannelUp') step = +1;
    else if (k === 'PageDown' || k === 'ChannelDown') step = -1;
    else if (k === 'Backspace') step = 0;
    else if (k === 'g' || k === 'G') { toggleGuide(true); ev.preventDefault(); ev.stopPropagation(); return; }
    if (step === null) return;
    ev.preventDefault();
    ev.stopPropagation();
    zap(step);
  }, true);
})();
