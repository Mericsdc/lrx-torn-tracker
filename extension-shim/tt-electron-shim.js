/*
 * TornTracker – TornTools için Electron uyumluluk katmanı.
 * Electron, Chrome eklenti API'lerinin yalnızca bir kısmını destekler (alarms, notifications,
 * offscreen, action, permissions, storage.sync yok). TornTools'un arka plan servisi bu API'ler
 * olmadan açılışta çöker. Bu dosya eksik API'leri güvenli karşılıklarla doldurur.
 * TornTracker eklentiyi kurarken bu dosyayı background.js'in başına ve eklenti sayfalarına ekler.
 */
(() => {
  const g = globalThis;
  if (g.__ttElectronShim) return;
  g.__ttElectronShim = true;
  const c = g.chrome || (g.chrome = {});
  const warn = (...a) => { try { console.warn('[tt-shim]', ...a); } catch {} };

  const mkEvent = () => {
    const ls = new Set();
    return {
      addListener: (f) => ls.add(f),
      removeListener: (f) => ls.delete(f),
      hasListener: (f) => ls.has(f),
      hasListeners: () => ls.size > 0,
      _fire: (...a) => {
        for (const f of [...ls]) {
          try { const r = f(...a); if (r && typeof r.catch === 'function') r.catch((e) => warn(e)); } catch (e) { warn(e); }
        }
      },
    };
  };
  // Hem promise hem callback tarzını destekleyen sabit-dönüşlü fonksiyon
  const ok = (v) => (...args) => {
    const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
    const val = typeof v === 'function' ? v(...args) : v;
    if (cb) { try { cb(val); } catch {} }
    return Promise.resolve(val);
  };
  const setProp = (obj, key, val) => {
    try { obj[key] = val; } catch {}
    if (obj[key] !== val) { try { Object.defineProperty(obj, key, { value: val, configurable: true, writable: true }); } catch {} }
    return obj[key] === val;
  };
  const fill = (obj, key, val) => { if (obj && obj[key] == null) setProp(obj, key, val); };

  /* ---------------- alarms ---------------- */
  if (!c.alarms) {
    const alarms = new Map();
    const onAlarm = mkEvent();
    const clear = (name = '') => {
      const a = alarms.get(name);
      if (!a) return false;
      clearTimeout(a.t); clearInterval(a.i); alarms.delete(name);
      return true;
    };
    const create = (name, info) => {
      if (typeof name === 'object' && name !== null) { info = name; name = ''; }
      info = info || {};
      clear(name);
      const period = info.periodInMinutes ? Math.max(0.5, Number(info.periodInMinutes)) * 60_000 : null;
      const delay = info.when ? Math.max(0, info.when - Date.now())
        : info.delayInMinutes != null ? Math.max(0, Number(info.delayInMinutes)) * 60_000
          : (period || 0);
      const a = { name, periodInMinutes: info.periodInMinutes, scheduledTime: Date.now() + delay, t: null, i: null };
      const fire = () => {
        a.scheduledTime = Date.now() + (period || 0);
        onAlarm._fire({ name, scheduledTime: Date.now(), periodInMinutes: info.periodInMinutes });
      };
      a.t = setTimeout(() => {
        fire();
        if (period) a.i = setInterval(fire, period); else alarms.delete(name);
      }, delay);
      alarms.set(name, a);
      return Promise.resolve();
    };
    const pub = (a) => ({ name: a.name, scheduledTime: a.scheduledTime, periodInMinutes: a.periodInMinutes });
    setProp(c, 'alarms', {
      create,
      get: ok((n = '') => (alarms.has(n) ? pub(alarms.get(n)) : undefined)),
      getAll: ok(() => [...alarms.values()].map(pub)),
      clear: ok((n = '') => clear(n)),
      clearAll: ok(() => { const had = alarms.size > 0; for (const n of [...alarms.keys()]) clear(n); return had; }),
      onAlarm,
    });
  }

  /* ---------------- notifications ---------------- */
  if (!c.notifications) {
    const onClicked = mkEvent();
    let seq = 0;
    if (g.registration && typeof g.addEventListener === 'function') {
      g.addEventListener('notificationclick', (ev) => {
        const id = ev.notification && ev.notification.tag;
        if (id && String(id).startsWith('tt-')) onClicked._fire(id);
      });
    }
    setProp(c, 'notifications', {
      create: (id, opts) => {
        if (typeof id === 'object' && id !== null) { opts = id; id = undefined; }
        opts = opts || {};
        id = id || `tt-${Date.now()}-${++seq}`;
        try {
          const p = g.registration && g.registration.showNotification
            ? g.registration.showNotification(opts.title || 'TornTools', {
              body: opts.message || '', icon: opts.iconUrl, tag: id,
              requireInteraction: !!opts.requireInteraction, silent: !!opts.silent,
            })
            : null;
          if (p && p.catch) p.catch(() => {});
        } catch {}
        return Promise.resolve(id);
      },
      clear: ok(true), update: ok(true), getAll: ok({}), getPermissionLevel: ok('granted'),
      onClicked, onClosed: mkEvent(), onButtonClicked: mkEvent(),
    });
  }

  /* ---------------- offscreen / action / permissions ---------------- */
  fill(c, 'offscreen', {
    createDocument: ok(undefined), closeDocument: ok(undefined), hasDocument: ok(false),
    Reason: { AUDIO_PLAYBACK: 'AUDIO_PLAYBACK' },
  });
  fill(c, 'action', {
    setBadgeText: ok(undefined), getBadgeText: ok(''), setBadgeBackgroundColor: ok(undefined),
    getBadgeBackgroundColor: ok([0, 0, 0, 0]), setIcon: ok(undefined), setTitle: ok(undefined),
    getTitle: ok('TornTools'), setPopup: ok(undefined), onClicked: mkEvent(),
  });
  fill(c, 'permissions', {
    contains: ok(true), request: ok(true), remove: ok(true),
    getAll: ok({ origins: [], permissions: [] }), onAdded: mkEvent(), onRemoved: mkEvent(),
  });

  /* ---------------- runtime ---------------- */
  if (c.runtime) {
    fill(c.runtime, 'getContexts', ok([]));
    fill(c.runtime, 'openOptionsPage', ok(undefined));
  }

  /* ---------------- tabs ---------------- */
  if (!c.tabs) setProp(c, 'tabs', {});
  if (c.tabs) {
    fill(c.tabs, 'create', ok(undefined));
    fill(c.tabs, 'update', ok(undefined));
    fill(c.tabs, 'query', ok([]));
  }

  /* ---------------- storage.sync -> storage.local (önekli) ---------------- */
  if (c.storage && c.storage.local && !c.storage.sync) {
    const P = '__sync:';
    const L = c.storage.local;
    const call = (fn, ...a) => new Promise((res, rej) => {
      try {
        const r = fn.call(L, ...a, (v) => res(v));
        if (r && typeof r.then === 'function') r.then(res, rej);
      } catch (e) { rej(e); }
    });
    const sync = {
      get: (keys, cb) => {
        let req = keys;
        if (typeof keys === 'string') req = [P + keys];
        else if (Array.isArray(keys)) req = keys.map((k) => P + k);
        else if (keys && typeof keys === 'object') req = Object.keys(keys).map((k) => P + k);
        else req = null;
        const p = call(L.get, req).then((all) => {
          const out = {};
          if (keys && typeof keys === 'object' && !Array.isArray(keys)) Object.assign(out, keys);
          for (const [k, v] of Object.entries(all || {})) if (k.startsWith(P)) out[k.slice(P.length)] = v;
          return out;
        });
        if (cb) p.then(cb);
        return p;
      },
      set: (items, cb) => {
        const o = {};
        for (const [k, v] of Object.entries(items || {})) o[P + k] = v;
        const p = call(L.set, o);
        if (cb) p.then(() => cb());
        return p;
      },
      remove: (keys, cb) => {
        const list = (Array.isArray(keys) ? keys : [keys]).map((k) => P + k);
        const p = call(L.remove, list);
        if (cb) p.then(() => cb());
        return p;
      },
      clear: (cb) => {
        const p = call(L.get, null).then((all) => call(L.remove, Object.keys(all || {}).filter((k) => k.startsWith(P))));
        if (cb) p.then(() => cb());
        return p;
      },
      getBytesInUse: ok(0),
      QUOTA_BYTES: 102400,
      onChanged: mkEvent(),
    };
    setProp(c.storage, 'sync', sync);
  }

  /* ---------------- service worker yaşam döngüsü ----------------
   * Electron onInstalled/onStartup olaylarını güvenilir şekilde tetiklemiyor.
   * Kendi olaylarımızı koyup arka plan betiği yüklendikten sonra biz tetikliyoruz. */
  // Yeni Chromium'da `browser` ad alanı `chrome`'dan ayrı bir nesne olabiliyor → eksikleri ona da kopyala.
  const nsList = [c, g.browser].filter((x, i, a) => x && typeof x === 'object' && a.indexOf(x) === i);
  const mirror = (ns) => {
    if (ns === c) return;
    for (const k of ['alarms', 'notifications', 'offscreen', 'action', 'permissions']) fill(ns, k, c[k]);
    if (ns.runtime && c.runtime) for (const k of ['getContexts', 'openOptionsPage']) fill(ns.runtime, k, c.runtime[k]);
    if (!ns.tabs && c.tabs) setProp(ns, 'tabs', c.tabs);
    else if (ns.tabs && c.tabs) for (const k of ['create', 'update', 'query']) fill(ns.tabs, k, c.tabs[k]);
    if (ns.storage && c.storage) fill(ns.storage, 'sync', c.storage.sync);
  };
  nsList.forEach(mirror);

  const isSW = typeof g.ServiceWorkerGlobalScope !== 'undefined' && g instanceof g.ServiceWorkerGlobalScope;
  if (isSW && c.runtime) {
    const onInstalled = mkEvent();
    const onStartup = mkEvent();
    let replacedInstalled = false, replacedStartup = false;
    for (const ns of nsList) {
      if (!ns.runtime) continue;
      replacedInstalled = setProp(ns.runtime, 'onInstalled', onInstalled) || replacedInstalled;
      replacedStartup = setProp(ns.runtime, 'onStartup', onStartup) || replacedStartup;
    }
    if (replacedInstalled || replacedStartup) {
      setTimeout(async () => {
        try {
          const version = c.runtime.getManifest ? c.runtime.getManifest().version : '0';
          const KEY = '__ttElectronInstalledVersion';
          const got = await new Promise((res) => {
            try {
              const r = c.storage.local.get(KEY, (v) => res(v || {}));
              if (r && r.then) r.then((v) => res(v || {}), () => res({}));
            } catch { res({}); }
          });
          const prev = got[KEY];
          if (prev !== version) {
            const o = {}; o[KEY] = version;
            try { const r = c.storage.local.set(o); if (r && r.catch) r.catch(() => {}); } catch {}
            onInstalled._fire(prev ? { reason: 'update', previousVersion: prev } : { reason: 'install' });
          } else {
            onStartup._fire();
          }
        } catch (e) { warn('lifecycle', e); }
      }, 50);
    }
  }
})();
