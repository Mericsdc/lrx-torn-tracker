/* =========================================================
   LRX Faction sayfası (events.js, faction-tools.js ve travel-radar.js'ten sonra yüklenir)
   Sekmeler:
   - OC & Özet: kendi OC'n, OC'ye girmeyenler, devam eden OC'ler (eksik eşyalı satır -> Armory Utilities), 7g/30g üye raporu
   - Aktivite: canlı Online/Idle/Offline dağılımı, 24s TCT adım çizgisi, 7x24 TCT ısı haritası, tam liste, 2 üye karşılaştırma
   - Travel Radar: yurt dışına giden / yurt dışındaki / dönen üyeler, rota, ayrık aktivite & sağlık eksenleri, geçiş tabanlı ETA
   - Armory: 30 günlük armory geçmişi (kim ne kullandı/ödünç aldı/doldurdu)
   - Chain: canlı chain durumu ve geçmiş chain bonus raporları
   - Yükseltme Simülatörü: respect harcamadan dal sıralaması (1×/2×/4×/8×/16×/32×) maliyet hesabı
   Torn kuralları: veriler yalnızca Torn API'den gelir; Torn sayfası okunmaz, hiçbir şeye tıklanmaz.
   ========================================================= */
(() => {
  Object.assign(I18N, { 'nav.faction': ['Faction', 'Faction'] });
  Object.assign(VIEW_META, {
    faction: {
      tr: ['Faction', 'OC takibi, aktivite, travel radar, armory, chain ve yükseltme simülatörü'],
      en: ['Faction', 'OC tracking, activity, travel radar, armory history, chains and upgrade simulator'],
    },
  });

  const T = 'https://www.torn.com/';
  const OC_URL = T + 'factions.php?step=your#/tab=crimes';
  const ARMORY_UTILITIES_URL = T + 'factions.php?step=your#/tab=armoury&start=0&sub=utilities';
  const CHAIN_URL = T + 'factions.php?step=your#/war/chain';
  const UPGRADES_URL = T + 'factions.php?step=your#/tab=upgrades';

  // What the user is typing into the add forms (recruitment watchlist, alliance, graffiti), kept here so that
  // every re-render (60 s tick, 2-minute reload, report progress) writes it back into the inputs.
  const freshDrafts = () => ({
    wl: { id: '', name: '', tag: '', note: '' },
    al: { name: '', tag: '', id: '', rel: 'ally', note: '' },
    gf: { cat: '', text: '' },
  });
  const DRAFT_FIELDS = {
    'fac-wl-id': ['wl', 'id'], 'fac-wl-name': ['wl', 'name'], 'fac-wl-tag': ['wl', 'tag'], 'fac-wl-note': ['wl', 'note'],
    'fac-al-name': ['al', 'name'], 'fac-al-tag': ['al', 'tag'], 'fac-al-id': ['al', 'id'], 'fac-al-rel': ['al', 'rel'], 'fac-al-note': ['al', 'note'],
    'fac-gf-cat': ['gf', 'cat'], 'fac-gf-text': ['gf', 'text'],
  };

  const fac = {
    tab: lsGet('tt.fac.tab', 'oc'),
    scopeKey: '',
    facSeq: 0, actSeq: 0, radSeq: 0, repSeq: 0, armSeq: 0, chSeq: 0, upgSeq: 0, wsSeq: 0, memberSeq: 0,
    d: null, err: null,
    rep: null, repErr: null, repTimer: null, repDays: Number(lsGet('tt.fac.repDays', '7')) === 30 ? 30 : 7,
    // act: the local Torn roster reply (Activity tab, and the Radar on the Local source).
    // radShared: the Faction Hub reply, used only by the Radar on the Shared source (its members have no days/last).
    act: null, actErr: null, actQ: '', actFilter: 'all', actSort: 'last', cmpA: 0, cmpB: 0,
    radShared: null, radSharedErr: null,
    radState: 'all', radCountry: 'all', radAct: 'all', radQ: '', radSource: 'local',
    drafts: freshDrafts(),
    arm: null, armErr: null, armCat: 'all', armQ: '',
    ch: null, chErr: null,
    upg: null, upgErr: null, upgSel: null, upgRespectOverride: null, upgBranch: 'all',
    ws: null, wsErr: null, wsDays: [7, 30, 90].includes(Number(lsGet('tt.fac.wsDays', '7'))) ? Number(lsGet('tt.fac.wsDays', '7')) : 7,
    wsTenure: lsGet('tt.fac.wsTenure', '1') !== '0',
    wsMetric: lsGet('tt.fac.wsMetric', 'activity'),
    memQ: '', memFilter: 'all', memSort: 'last',
    memCols: new Set((() => { const l = typeof lsList === 'function' ? lsList('tt.fac.memCols') : []; return l.length ? l : ['battlestats', 'oc', 'activity7d', 'xanax7d', 'gym7d']; })()),
    openMemberId: 0,
    memMetric: lsGet('tt.fac.memMetric', 'battlestats'),
    memStat: lsGet('tt.fac.memStat', 'total'),
    memMode: lsGet('tt.fac.memMode', 'value') === 'gain' ? 'gain' : 'value',
    memRange: lsGet('tt.fac.memRange', '30d'),
    memberSeries: null,
  };

  function currentScopeKey() {
    const p = state.overview?.player;
    return `${Number(p?.id) || 0}:${Number(p?.faction?.faction_id) || 0}`;
  }
  function syncScope() {
    const k = currentScopeKey();
    if (fac.scopeKey && k !== '0:0' && fac.scopeKey !== k) {
      fac.d = null; fac.err = null;
      fac.rep = null; fac.repErr = null; clearTimeout(fac.repTimer);
      fac.act = null; fac.actErr = null;
      fac.radShared = null; fac.radSharedErr = null;
      fac.arm = null; fac.armErr = null;
      fac.ch = null; fac.chErr = null;
      fac.upg = null; fac.upgErr = null; fac.upgSel = null;
      fac.ws = null; fac.wsErr = null; fac.openMemberId = 0; fac.memberSeries = null;
      fac.drafts = freshDrafts();
      fac.facSeq++; fac.actSeq++; fac.radSeq++; fac.repSeq++; fac.armSeq++; fac.chSeq++; fac.upgSeq++; fac.wsSeq++; fac.memberSeq++;
    }
    if (k !== '0:0') fac.scopeKey = k;
  }

  const nowS = () => Math.floor(nowTct() / 1000);
  const profile = (id) => `${T}profiles.php?XID=${id}`;
  const nameBtn = (id, name) => `<a class="fac-name" href="${profile(id)}">${esc(name)}</a>`; // torn.com bağlantıları uygulama içi sekmede açılır
  const hms = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 3600)}${tr('sa', 'h')} ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}${tr('dk', 'm')} ${String(s % 60).padStart(2, '0')}${tr('sn', 's')}`; };
  const dayLabel = (d) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString(state.lang === 'en' ? 'en-GB' : 'tr-TR', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—');
  const tsFmt = (ts) => (ts ? new Date(ts * 1000).toLocaleString(state.lang === 'en' ? 'en-GB' : 'tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) : '—');
  const isoHm = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  };
  const isoHms = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')} TCT`;
  };
  // HH:MM for a time today (TCT = UTC), "20 Nov 14:05" for any other day.
  const isoWhen = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const hm = isoHm(iso);
    if (d.toISOString().slice(0, 10) === new Date(nowTct()).toISOString().slice(0, 10)) return hm;
    const day = d.toLocaleDateString(state.lang === 'en' ? 'en-GB' : 'tr-TR', { day: '2-digit', month: 'short', timeZone: 'UTC' });
    return `${day} ${hm}`;
  };
  const ageText = (sec) => {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    if (s < 60) return tr(`${s} sn önce`, `${s}s ago`);
    const m = Math.floor(s / 60);
    if (m < 60) return tr(`${m} dk önce`, `${m}m ago`);
    return tr(`${Math.floor(m / 60)} sa ${m % 60} dk önce`, `${Math.floor(m / 60)}h ${m % 60}m ago`);
  };
  // Torn's last action (unix seconds) in the UI language. Torn's own English text ("10 minutes ago") is the fallback
  // only when there is no timestamp. Returns escaped HTML.
  const lastSeen = (ts, rel = '') => {
    const t = Number(ts) || 0;
    if (t < 1e9) return esc(rel || '—');
    const s = Math.max(0, Math.floor(nowTct() / 1000 - t));
    if (s < 60) return tr('şimdi', 'just now');
    const m = Math.floor(s / 60);
    if (m < 60) return tr(`${m} dk önce`, `${m} ${m === 1 ? 'minute' : 'minutes'} ago`);
    const h = Math.floor(m / 60);
    if (h < 24) return tr(`${h} sa önce`, `${h} ${h === 1 ? 'hour' : 'hours'} ago`);
    const d = Math.floor(h / 24);
    return tr(`${d} gün önce`, `${d} ${d === 1 ? 'day' : 'days'} ago`);
  };
  // Seconds since an ISO observation time; falls back to the age the server computed when there is none.
  const ageSince = (iso, fallbackSec = null) => {
    const ms = Date.parse(iso || '');
    return Number.isFinite(ms) ? Math.max(0, Math.floor((Date.now() - ms) / 1000)) : fallbackSec;
  };

  /* Travel states (travel-radar.js) in the Radar tab's wording, shared by the Radar and the member drawer. */
  const TRAVEL_STATE = {
    outbound: ['blue', '↗', ['Gidiş', 'Outbound']],
    abroad: ['tq', '🌍', ['Yurt dışı', 'Abroad']],
    inbound: ['green', '↙', ['Dönüş', 'Inbound']],
    none_observed: ['dim', '•', ['Torn\'da', 'In Torn']],
    unknown: ['warn', '?', ['Bilinmiyor', 'Unknown']],
  };
  const travelStateText = (s) => tr(...(TRAVEL_STATE[s] || TRAVEL_STATE.unknown)[2]);
  const countryName = (code) => window.LRXTravelRadar?.countryName?.(code) || (code ? String(code).toUpperCase() : '');
  // "Torn → Japan", "Japan → Torn", "Japan" (abroad), "Torn" (back home); '' when the route is not known.
  function travelRoute(stateKey, origin, destination) {
    if (stateKey === 'outbound') return destination && destination !== 'torn' ? `Torn → ${countryName(destination)}` : '';
    if (stateKey === 'inbound') return origin && origin !== 'torn' ? `${countryName(origin)} → Torn` : 'Torn';
    if (stateKey === 'abroad') return destination && destination !== 'torn' ? countryName(destination) : '';
    if (stateKey === 'none_observed') return 'Torn';
    return '';
  }

  // Window labels such as "30d (12d data)" when the stored history is shorter than the window.
  const windowText = (days, cov) => {
    const pair = window.LRXFactionWorkspace?.windowLabel?.(days, cov) || [`${days}g`, `${days}d`];
    return tr(pair[0], pair[1]);
  };
  // Gym columns come from the contributors history, which can cover fewer days than the personal stats.
  const gymCoverage = (cov) => (cov && cov.gymActualDays !== undefined ? { actualDays: cov.gymActualDays, complete: cov.gymComplete } : cov);

  // A player without a faction gets the server's (already translated) message instead of empty sections.
  const notInFactionBox = (d) => `<div class="alert info">${esc(d?.error || tr('Bir faction\'da değilsin.', 'You are not in a faction.'))}</div>`;
  // Shared first lines of the workspace tabs: loading, the fetch error or the factionless message; '' when ready.
  function wsGate() {
    if (!fac.ws) return fac.wsErr ? errorBox(fac.wsErr) : loadingBox();
    if (fac.ws.notInFaction) return notInFactionBox(fac.ws);
    return '';
  }

  // Labels saved by older versions as Turkish data ('Takip', 'Genel', 'Officer') and the new empty defaults.
  const wlTagText = (t) => (!t || t === 'Takip' ? tr('Takip', 'Watching') : t);
  const gfCatText = (c) => (!c || c === 'Genel' ? tr('Genel', 'General') : c);
  const authorText = (a) => (!a || a === 'Officer' ? tr('Yetkili', 'Officer') : a);

  const SOURCE_LABEL = {
    torn_self: ['Doğrulanmış (Torn API)', 'Verified (Torn API)'],
    verified: ['Doğrulanmış', 'Verified'],
    member_shared: ['Doğrulanmış (üye paylaşımı)', 'Verified (shared by member)'],
    ffscouter: ['FFScouter tahmini', 'FFScouter estimate'],
    rank_estimate: ['Kaba tahmin (rütbeden)', 'Rough estimate (from rank)'],
    torn_personalstats: ['Torn kişisel istatistikleri', 'Torn personal stats'],
    torn_contributors: ['Torn faction katkı listesi', 'Torn faction contributors'],
  };
  const sourceText = (s) => (SOURCE_LABEL[s] ? tr(...SOURCE_LABEL[s]) : String(s || '—'));
  const STATE_TR = { Traveling: ['uçakta', 'Traveling'], Abroad: ['yurt dışında', 'Abroad'], Hospital: ['hastanede', 'In Hospital'], Jail: ['hapiste', 'In Jail'], Federal: ['federal hapiste', 'In Federal Jail'], Okay: ['müsait', 'Okay'] };
  const stateText = (s) => { const t = STATE_TR[s]; return t ? tr(t[0], t[1]) : esc(s || ''); };
  const ROLE_TR = { leader: ['Lider', 'Leader'], 'co-leader': ['Eş lider', 'Co-leader'] };
  const DOW_TR = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
  const DOW_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const ARM_LABELS = {
    all: ['Hepsi', 'All'], used: ['Kullandı', 'Used'], loaned: ['Ödünç', 'Loaned'], returned: ['İade', 'Returned'],
    filled: ['Doldurdu', 'Filled'], deposited: ['Yatırdı', 'Deposited'], retrieved: ['Aldı', 'Retrieved'], other: ['Diğer', 'Other'],
  };

  function visibleTabs() {
    const out = [['oc', '🕵️', tr('OC & Özet', 'OC & Overview')]];
    if (feat('faction.members')) out.push(['members', '👥', tr('Üyeler', 'Members')]);
    if (feat('faction.activity')) out.push(['activity', '📊', tr('Aktivite', 'Activity')]);
    if (feat('faction.travelRadar')) out.push(['radar', '🛰️', tr('Travel Radar', 'Travel Radar')]);
    if (feat('faction.stats')) out.push(['stats', '📈', tr('Stats', 'Stats')]);
    if (feat('faction.gym')) out.push(['gym', '🏋️', tr('Faction Gym', 'Faction Gym')]);
    if (feat('faction.bank')) out.push(['bank', '🏦', tr('Banka', 'Bank')]);
    if (feat('faction.recruitment')) out.push(['recruitment', '📋', tr('Başvurular', 'Recruitment')]);
    if (feat('faction.transfers')) out.push(['transfers', '⇄', tr('Transfers', 'Transfers')]);
    if (feat('faction.alliance')) out.push(['alliance', '🤝', tr('Alliance & Graffiti', 'Alliance & Graffiti')]);
    if (feat('faction.armory')) out.push(['armory', '🧰', tr('Armory', 'Armory')]);
    if (feat('faction.chains')) out.push(['chains', '⛓', tr('Chain', 'Chains')]);
    if (feat('faction.upgrades')) out.push(['upgrades', '🌳', tr('Yükseltmeler', 'Upgrades')]);
    return out;
  }
  function activeTab() {
    const tabs = visibleTabs();
    return tabs.some(([k]) => k === fac.tab) ? fac.tab : 'oc';
  }

  /* ---------- Veri ---------- */
  async function fetchFaction(force = false) {
    syncScope();
    const seq = ++fac.facSeq;
    try {
      const res = await api(`/api/faction${force ? '?force=1' : ''}`);
      if (seq !== fac.facSeq) return fac.d;
      fac.d = res; fac.err = null;
    } catch (e) {
      if (seq !== fac.facSeq) return fac.d;
      fac.err = e;
    }
    checkOcNotify();
    return fac.d;
  }
  async function fetchReport(start = false) {
    syncScope();
    const seq = ++fac.repSeq;
    try {
      const res = await api(`/api/faction/report?days=${fac.repDays}`, start ? { method: 'POST' } : {});
      if (seq !== fac.repSeq) return fac.rep;
      fac.rep = res; fac.repErr = null;
    } catch (e) {
      if (seq !== fac.repSeq) return fac.rep;
      fac.repErr = e;
    }
    // Rapor hazırlanırken sayfa açıksa 4 sn'de bir ilerlemeyi göster
    clearTimeout(fac.repTimer);
    if (fac.rep?.job?.running && state.view === 'faction') fac.repTimer = setTimeout(() => fetchReport().then(render), 4000);
  }
  const authRevoked = (e) => e?.status === 401 || e?.status === 403 || e?.code === 'NO_KEY' || e?.code === 'KEY_ACCESS';
  // The local Torn roster (Activity tab and the Local radar). Its transitions drive the travel radar notifications.
  async function fetchActivity(force = false) {
    syncScope();
    const seq = ++fac.actSeq;
    try {
      const res = await api(`/api/faction/activity${force ? '?force=1' : ''}`);
      if (seq !== fac.actSeq) return fac.act;
      fac.act = res; fac.actErr = null;
      checkTravelRadarNotify(res);
    } catch (e) {
      if (seq !== fac.actSeq) return fac.act;
      fac.actErr = e;
      // Auth/permission revocation never keeps stale private data on screen
      if (authRevoked(e)) fac.act = null;
    }
    return fac.act;
  }
  // The Faction Hub view for the Radar's Shared source, kept apart from fac.act so the Activity tab never reads it.
  async function fetchSharedRadar(force = false) {
    syncScope();
    const seq = ++fac.radSeq;
    try {
      const res = await api(`/api/faction/activity?source=shared${force ? '&force=1' : ''}`);
      if (seq !== fac.radSeq) return fac.radShared;
      fac.radShared = res; fac.radSharedErr = null;
      checkTravelRadarNotify(res);
    } catch (e) {
      if (seq !== fac.radSeq) return fac.radShared;
      fac.radSharedErr = e;
      if (authRevoked(e)) fac.radShared = null;
    }
    return fac.radShared;
  }
  const radarShared = () => fac.radSource === 'shared';
  const radarData = () => (radarShared() ? fac.radShared : fac.act);
  const radarErr = () => (radarShared() ? fac.radSharedErr : fac.actErr);
  const fetchRadar = (force = false) => (radarShared() ? fetchSharedRadar(force) : fetchActivity(force));
  async function fetchWorkspace(force = false, section = 'all') {
    syncScope();
    const seq = ++fac.wsSeq;
    const qs = [`days=${fac.wsDays}`, `tenure=${fac.wsTenure ? 'tenure' : 'all'}`, `section=${encodeURIComponent(section)}`];
    if (force) qs.push('force=1');
    try {
      const res = await api(`/api/faction/workspace?${qs.join('&')}`);
      if (seq !== fac.wsSeq) return fac.ws;
      fac.ws = res; fac.wsErr = null;
    } catch (e) {
      if (seq !== fac.wsSeq) return fac.ws;
      fac.wsErr = e;
      if (authRevoked(e)) fac.ws = null;
    }
    return fac.ws;
  }
  async function fetchMemberSeries(playerId) {
    const pid = Number(playerId);
    if (!pid) return;
    const seq = ++fac.memberSeq;
    fac.memberSeries = { loading: true, playerId: pid, metric: fac.memMetric, mode: fac.memMode, range: fac.memRange, stat: fac.memStat, data: null, error: null };
    render();
    try {
      const qs = `metric=${encodeURIComponent(fac.memMetric)}&mode=${encodeURIComponent(fac.memMode)}&range=${encodeURIComponent(fac.memRange)}&stat=${encodeURIComponent(fac.memStat)}`;
      const res = await api(`/api/faction/members/${pid}/series?${qs}`);
      if (seq !== fac.memberSeq || fac.openMemberId !== pid) return;
      fac.memberSeries = { loading: false, playerId: pid, metric: fac.memMetric, mode: fac.memMode, range: fac.memRange, stat: fac.memStat, data: res, error: null };
    } catch (e) {
      if (seq !== fac.memberSeq || fac.openMemberId !== pid) return;
      fac.memberSeries = { loading: false, playerId: pid, metric: fac.memMetric, mode: fac.memMode, range: fac.memRange, stat: fac.memStat, data: null, error: e };
    }
    render();
  }
  async function fetchArmory(force = false) {
    syncScope();
    const seq = ++fac.armSeq;
    try {
      const res = await api(`/api/faction/armory${force ? '?force=1' : ''}`);
      if (seq !== fac.armSeq) return fac.arm;
      fac.arm = res; fac.armErr = null;
    } catch (e) {
      if (seq !== fac.armSeq) return fac.arm;
      fac.armErr = e;
    }
    return fac.arm;
  }
  async function fetchChains(force = false) {
    syncScope();
    const seq = ++fac.chSeq;
    try {
      const res = await api(`/api/faction/chains${force ? '?force=1' : ''}`);
      if (seq !== fac.chSeq) return fac.ch;
      fac.ch = res; fac.chErr = null;
    } catch (e) {
      if (seq !== fac.chSeq) return fac.ch;
      fac.chErr = e;
    }
    return fac.ch;
  }
  async function fetchUpgrades(force = false) {
    syncScope();
    const seq = ++fac.upgSeq;
    try {
      const res = await api(`/api/faction/upgrades${force ? '?force=1' : ''}`);
      if (seq !== fac.upgSeq) return fac.upg;
      fac.upg = res; fac.upgErr = null;
      if (!fac.upgSel || force) fac.upgSel = { ...(fac.upg.currentLevels || {}) };
    } catch (e) {
      if (seq !== fac.upgSeq) return fac.upg;
      fac.upgErr = e;
    }
    return fac.upg;
  }
  const WS_TABS = new Set(['members', 'stats', 'gym', 'bank', 'recruitment', 'transfers', 'alliance']);
  // `refresh` (the 2-minute loop) refetches the live roster views even when they are loaded; the server's
  // 2-minute roster cache keeps that to at most one Torn roster call per cycle.
  async function loadTabData(tab, force = false, { refresh = false } = {}) {
    if (tab === 'activity') {
      if (force || refresh || !fac.act) { await fetchActivity(force); render(); }
    } else if (tab === 'radar') {
      if (force || refresh || !radarData()) { await fetchRadar(force); render(); }
    } else if (WS_TABS.has(tab)) {
      const needBank = tab === 'bank' && (!fac.ws || fac.ws.bank?.status === 'idle');
      const needRec = tab === 'recruitment' && (!fac.ws || fac.ws.recruitment?.status === 'idle');
      if (force || !fac.ws || needBank || needRec) {
        await fetchWorkspace(force, tab);
        render();
      }
      if (tab === 'members' && fac.openMemberId && (!fac.memberSeries || fac.memberSeries.playerId !== fac.openMemberId)) {
        await fetchMemberSeries(fac.openMemberId);
      }
    }
    else if (tab === 'armory' && (force || !fac.arm)) { await fetchArmory(force); render(); }
    else if (tab === 'chains' && (force || !fac.ch)) { await fetchChains(force); render(); }
    else if (tab === 'upgrades' && (force || !fac.upg)) { await fetchUpgrades(force); render(); }
  }
  async function loadFaction(force = false, opts = {}) {
    syncScope();
    const el = $('#faction-body');
    if (!fac.d && el) el.innerHTML = loadingBox();
    await fetchFaction(force);
    render();
    const tab = activeTab();
    if (fac.d?.access?.allowed) { fetchReport().then(render); }
    if (fac.d?.access?.inFaction && tab !== 'oc') await loadTabData(tab, force, { refresh: Boolean(opts?.refresh) });
  }

  /* ---------- Bildirimler ---------- */
  // Radar keys are one per observed transition; once a snapshot has passed they are never read again.
  const RADAR_KEY = 'lrx.radar.';
  const RADAR_KEY_MAX_AGE_MS = 2 * 86400_000;
  function pruneRadarKeys(now = Date.now()) {
    try {
      const old = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith(RADAR_KEY)) continue;
        const at = Number(localStorage.getItem(k));
        if (!(at > 0) || now - at > RADAR_KEY_MAX_AGE_MS) old.push(k);
      }
      for (const k of old) localStorage.removeItem(k);
    } catch {}
  }
  function notifyOnce(key, title, body, url) {
    let seen = null; try { seen = localStorage.getItem(key); } catch {}
    if (seen) return;
    try { localStorage.setItem(key, String(Date.now())); } catch {}
    if (key.startsWith(RADAR_KEY)) pruneRadarKeys();
    if (feat('notify')) notify(key, title, body, url ? { url } : {});
  }
  function checkTravelRadarNotify(data) {
    if (!data || !feat('page.faction') || !feat('faction.travelRadar') || !feat('notify') || !feat('notify.travelRadar')) return;
    const trList = Array.isArray(data.transitions) ? data.transitions : [];
    const byId = new Map((data.travel || []).map((r) => [r.playerId, r]));
    for (const item of trList) {
      if (item.toState !== 'inbound') continue;
      const row = byId.get(item.playerId);
      const cname = window.LRXTravelRadar?.countryName?.(item.origin) || item.origin || '';
      const name = row?.displayName || `#${item.playerId}`;
      notifyOnce(
        `lrx.radar.${item.transitionId}`,
        '🛰️ ' + tr('Faction üyesi Torn\'a dönüyor', 'Faction member returning to Torn'),
        cname ? `${name} · ${cname} → Torn` : `${name} → Torn`,
        profile(item.playerId),
      );
    }
  }
  function checkOcNotify() {
    const d = fac.d; if (!d || !feat('page.faction')) return;
    const my = d.myOc;
    if (feat('notify.oc') && my && !my.error) {
      let prev = null; try { prev = localStorage.getItem('lrx.oc.prev'); } catch {}
      const cur = my.inOc ? String(my.crime.id) : 'none';
      if (prev && prev !== 'none' && cur === 'none') {
        notifyOnce(`lrx.oc.done.${prev}`, '🕵️ ' + tr('OC\'n bitti', 'Your OC has ended'), tr('Şu an bir OC\'de değilsin: yeni bir OC\'ye katılabilirsin.', 'You are no longer in an OC: you can join a new one.'), OC_URL);
      }
      try { localStorage.setItem('lrx.oc.prev', cur); } catch {}
      if (my.inOc && my.slot?.item && !my.slot.item.ok) {
        notifyOnce(`lrx.oc.item.${my.crime.id}`, '🧰 ' + tr('OC eşyan eksik', 'OC item missing'),
          tr(`${my.crime.name} · ${my.slot.role}: ${my.slot.item.name} gerekiyor. Yoksa OC gecikir.`, `${my.crime.name} · ${my.slot.role}: needs ${my.slot.item.name}. The OC will be delayed without it.`), ARMORY_UTILITIES_URL);
      }
    }
    // Lider / yetkili: geciken ya da eşyası eksik OC'ler
    if (feat('notify.factionOc') && d.access?.allowed && d.oc?.crimes) {
      for (const c of d.oc.crimes) {
        const probs = [...c.missing.map((m) => `${m.name}: ${m.item}`), ...c.away.map((a) => `${a.name}: ${stateText(a.state)}`)];
        if (!c.delayed && !c.missing.length) continue;
        notifyOnce(`lrx.foc.${c.id}.${c.missing.map((m) => m.id).join('-')}.${c.delayed ? 'd' : ''}`,
          `⏳ ${c.delayed ? tr('OC gecikiyor', 'OC delayed') : tr('OC eşyası eksik', 'OC item missing')}: ${c.name}`,
          probs.join(' · ') || tr('Planlama bitti ama OC başlamadı.', 'Planning is done but the OC has not started.'), c.delayed ? OC_URL : ARMORY_UTILITIES_URL);
      }
    }
  }
  // Kendi OC'nin planlaması bittiğinde (ready_at) bir kez bildir
  setInterval(() => {
    const my = fac.d?.myOc;
    if (!my?.inOc || !my.crime.readyAt || !feat('page.faction') || !feat('notify.oc')) return;
    const left = my.crime.readyAt - nowS();
    if (left <= 0 && left > -600) notifyOnce(`lrx.oc.ready.${my.crime.id}`, '🕵️ ' + tr('OC planlaması bitti', 'OC planning finished'), tr(`${my.crime.name} başlamaya hazır.`, `${my.crime.name} is ready to start.`), OC_URL);
  }, 30_000);
  // Arka planda 5 dakikada bir (yalnızca bildirimler açıksa): OC verisi API'den, Torn sayfası okunmaz
  setInterval(() => {
    if (!feat('page.faction') || !feat('notify') || !(feat('notify.oc') || feat('notify.factionOc'))) return;
    if (state.overview?.player?.faction && !Number(state.overview.player.faction.faction_id)) return;
    fetchFaction().then(() => { if (state.view === 'faction') render(); });
  }, 5 * 60_000);
  setTimeout(() => { if (feat('page.faction') && !fac.d) fetchFaction(); }, 20_000);

  /* ---------- Sekme 1: OC & Özet ---------- */
  function myOcCard(my) {
    const head = `<div class="card-head wrap"><h3>🕵️ ${tr('Senin OC\'n', 'Your OC')}</h3>
      <button class="btn sm ghost" type="button" data-open-url="${OC_URL}" data-tab-label="Organized Crimes">${tr('Torn\'da OC sayfası', 'OC page in Torn')} ↗</button></div>`;
    if (!my) return `<article class="glass card">${head}${loadingBox()}</article>`;
    if (my.error) return `<article class="glass card">${head}<div class="alert danger">${esc(my.error)}</div></article>`;
    if (!my.inOc) return `<article class="glass card">${head}<div class="fac-line"><span class="chip warn">${tr('OC\'de değilsin', 'Not in an OC')}</span> <span class="muted">${tr('Torn\'daki OC sekmesinden boş bir slota katılabilirsin.', 'You can join an open slot on the OC tab in Torn.')}</span></div></article>`;
    const c = my.crime, s = my.slot;
    const left = c.readyAt ? c.readyAt - nowS() : null;
    const armoryTitle = esc(tr('Faction Armory → Utilities sayfasını aç', 'Open Faction Armory → Utilities'));
    const item = s?.item ? (s.item.ok
      ? `<span class="chip green">✓ ${esc(s.item.name)}</span>`
      : `<button class="chip danger fac-armory-link" type="button" data-open-url="${ARMORY_UTILITIES_URL}" data-tab-label="Armory · Utilities" title="${armoryTitle}">✗ ${esc(s.item.name)} ${tr('eksik', 'missing')} ↗</button>`) : `<span class="muted">${tr('eşya gerekmiyor', 'no item needed')}</span>`;
    return `<article class="glass card">${head}
      <div class="fac-grid">
        <div><small class="muted">${tr('Suç', 'Crime')}</small><b>${esc(c.name)}</b> <span class="muted">· ${tr('zorluk', 'difficulty')} ${c.difficulty}</span></div>
        <div><small class="muted">${tr('Durum', 'Status')}</small><b>${esc(c.status)}</b> <span class="muted">· ${c.filled}/${c.total} ${tr('slot dolu', 'slots filled')}</span></div>
        <div><small class="muted">${tr('Rolün', 'Your role')}</small><b>${esc(s?.role || '—')}</b>${s?.cpr != null ? ` <span class="muted">· CPR ${s.cpr}</span>` : ''}</div>
        <div><small class="muted">${tr('Eşya', 'Item')}</small>${item}</div>
        <div><small class="muted">${tr('Planlama', 'Planning')}</small>${left == null ? '—' : left > 0 ? `<b>${human(left)}</b> ${tr('kaldı', 'left')}` : `<span class="chip warn">${tr('bitti', 'done')}</span>`}</div>
      </div></article>`;
  }

  function lockedCard(a) {
    // inFaction null means the check failed (unknown), which is not the same as having no faction
    const why = a.inFaction === false ? tr('Bir faction\'da değilsin.', 'You are not in a faction.')
      : a.inFaction == null ? tr('Faction üyeliğin şu anda kontrol edilemedi. Biraz sonra tekrar dene.', 'Your faction membership could not be checked right now. Please try again shortly.')
      : a.apiAccess === false
        ? tr(`Pozisyonun (${esc(a.position)}) için "Faction API Access" izni yok. Torn bu izin olmadan OC verisini vermez.`, `Your position (${esc(a.position)}) does not have the "Faction API Access" permission. Torn does not share OC data without it.`)
        : tr(`Pozisyonun (${esc(a.position)}) için "Organised Crimes" yetkisi yok.`, `Your position (${esc(a.position)}) does not have the "Organised Crimes" permission.`);
    return `<article class="glass card fac-lock">
      <div class="card-head"><h3>🔒 ${tr('OC takibi ve haftalık rapor', 'OC tracking and weekly report')}</h3></div>
      <p>${tr('Bu bölüm yalnızca faction liderine, eş lidere ve liderin pozisyonuna <b>Organised Crimes</b> yetkisi verdiği üyelere açık. O pozisyonda <b>Faction API Access</b> de açık olmalı.', 'This section is only for the faction leader, the co-leader and members in positions the leader has given the <b>Organised Crimes</b> permission. That position also needs <b>Faction API Access</b>.')}</p>
      <p class="muted">${why} ${tr('Yetkiyi lider oyunda verir: Faction → Controls → Positions. İzin verildikten sonra en geç 10 dakikada burada açılır.', 'The leader grants it in game: Faction → Controls → Positions. Once granted, it unlocks here within 10 minutes.')}</p>
    </article>`;
  }

  function notInOcCard(oc) {
    const rows = oc.notInOc.map((m) => `<tr>
      <td>${nameBtn(m.id, m.name)}</td><td class="num">${m.level}</td><td>${esc(m.position)}</td>
      <td><i class="fac-dot ${m.lastStatus === 'Online' ? 'on' : m.lastStatus === 'Idle' ? 'idle' : ''}"></i>${lastSeen(m.last, m.lastRel)}</td>
      <td>${m.state && m.state !== 'Okay' ? `<span class="chip ${m.state === 'Hospital' || m.state === 'Jail' ? 'danger' : 'blue'}">${stateText(m.state)}</span>` : `<span class="muted">${stateText('Okay')}</span>`}</td>
      <td class="num">${m.days}</td></tr>`).join('');
    return `<article class="glass card">
      <div class="card-head wrap"><h3>🚫 ${tr('OC\'ye girmeyenler', 'Not in an OC')} <span class="muted">(${oc.notInOc.length})</span></h3>
        <span class="muted">${tr('Son görülene göre sıralı · isme tıkla: profil', 'Sorted by last seen · click a name to open the profile')}</span></div>
      ${oc.notInOc.length ? `<div class="tbl-wrap"><table class="tbl compact">
        <thead><tr><th>${tr('Üye', 'Member')}</th><th class="num">Lv</th><th>${tr('Pozisyon', 'Position')}</th><th>${tr('Son görülme', 'Last seen')}</th><th>${tr('Durum', 'Status')}</th><th class="num">${tr('Gün', 'Days')}</th></tr></thead>
        <tbody>${rows}</tbody></table></div>` : `<div class="muted">${tr('Herkes bir OC\'de 🎉', 'Everyone is in an OC 🎉')}</div>`}
    </article>`;
  }

  function crimesCard(oc) {
    const now = nowS();
    const hasMissing = oc.crimes.some((c) => c.missing.length);
    const armoryTitle = esc(tr('Faction Armory → Utilities sayfasını aç', 'Open Faction Armory → Utilities'));
    const rows = oc.crimes.map((c) => {
      const probs = [
        ...c.missing.map((m) => `<span class="chip danger">🧰 ${esc(m.name)}: ${esc(m.item)}</span>`),
        ...c.away.map((a) => (a.state === 'Traveling' || a.state === 'Abroad') && feat('faction.travelRadar')
          ? `<button type="button" class="chip blue fac-radar-jump" data-open-radar-player="${esc(a.name)}" title="${esc(tr('Travel Radar\'da göster', 'Show in Travel Radar'))}">🛰️ ${esc(a.name)}: ${stateText(a.state)}</button>`
          : `<span class="chip blue">${esc(a.name)}: ${stateText(a.state)}${a.until ? ` · ${human(a.until - now)}` : ''}</span>`),
        ...(c.open ? [`<span class="chip warn">${c.open} ${tr('boş slot', c.open > 1 ? 'open slots' : 'open slot')}</span>`] : []),
      ];
      const when = c.delayed ? `<span class="chip danger">${tr('gecikiyor', 'delayed')}</span>`
        : c.status === 'Planning' && c.readyAt ? tr(`${human(c.readyAt - now)} <span class="muted">sonra hazır</span>`, `<span class="muted">ready in</span> ${human(c.readyAt - now)}`)
        : c.status === 'Recruiting' && c.expiredAt ? `<span class="muted">${tr('dolmazsa', 'expires in')}</span> ${human(c.expiredAt - now)}` : '—';
      const cls = [c.delayed ? 'fac-bad' : '', c.missing.length ? 'fac-armory-row' : ''].filter(Boolean).join(' ');
      const armory = c.missing.length
        ? ` data-open-url="${ARMORY_UTILITIES_URL}" data-tab-label="Armory · Utilities" tabindex="0" role="link" title="${armoryTitle}"`
        : '';
      return `<tr${cls ? ` class="${cls}"` : ''}${armory}><td><b>${esc(c.name)}</b> <span class="muted">· ${c.difficulty}</span></td>
        <td><span class="chip ${c.status === 'Planning' ? 'tq' : 'dim'}">${esc(c.status)}</span></td>
        <td class="num">${c.filled}/${c.total}</td><td>${when}</td><td class="fac-probs">${probs.join(' ') || `<span class="muted">${tr('sorun yok', 'no issues')}</span>`}</td></tr>`;
    }).join('');
    const hint = hasMissing
      ? tr('Önce gecikenler ve eşyası eksik olanlar · eşyası eksik satıra tıkla: Armory Utilities', 'Delayed and missing-item OCs first · click a missing-item row: Armory Utilities')
      : tr('Önce gecikenler ve eşyası eksik olanlar', 'Delayed and missing-item OCs first');
    return `<article class="glass card">
      <div class="card-head wrap"><h3>⏳ ${tr('Devam eden OC\'ler', 'Ongoing OCs')} <span class="muted">(${oc.crimes.length})</span></h3>
        <span class="muted">${hint}</span></div>
      ${oc.crimes.length ? `<div class="tbl-wrap"><table class="tbl compact">
        <thead><tr><th>${tr('Suç', 'Crime')}</th><th>${tr('Durum', 'Status')}</th><th class="num">${tr('Slot', 'Slots')}</th><th>${tr('Zaman', 'Time')}</th><th>${tr('Sorunlar', 'Issues')}</th></tr></thead>
        <tbody>${rows}</tbody></table></div>` : `<div class="muted">${tr('Şu an devam eden OC yok.', 'No ongoing OCs right now.')}</div>`}
    </article>`;
  }

  const BOARDS = [
    ['activity', '⏱', ['En aktif 10', 'Top 10 most active'], ['Oynama süresi', 'Time played'], hms],
    ['gym', '🏋', ['En çok gym yapan 10', 'Top 10 bodybuilders'], ['Harcanan E', 'Energy spent'], n0],
    ['xanax', '💊', ['En çok Xanax alan 10', 'Top 10 Xanax users'], ['Xanax', 'Xanax'], n0],
    ['crimes', '🕵️', ['En çok suç işleyen 10', 'Top 10 criminals'], ['Suç', 'Crimes'], n0],
    ['blood', '🩸', ['En çok kan bağışlayan 10', 'Top 10 blood donors'], ['Torba', 'Bags filled'], n0],
    ['oc', '🎯', ['En çok OC yapan 10', 'Top 10 OC participants'], ['OC', 'OCs'], n0],
    ['idle', '💤', ['En az oynayan 10', '10 least active'], ['Oynama süresi', 'Time played'], hms],
  ];
  function reportCard() {
    const r = fac.rep;
    const head = (extra = '') => `<div class="card-head wrap"><h3>📊 ${tr('Üye performans raporu', 'Member performance report')}</h3>${extra}</div>`;
    if (!r) return `<article class="glass card">${head()}${fac.repErr ? errorBox(fac.repErr) : loadingBox()}</article>`;
    const j = r.job || {};
    const run = j.running;
    const pctDone = j.total ? Math.round((j.done / j.total) * 100) : 0;
    const range = r.range?.from ? `${dayLabel(r.range.from)} – ${dayLabel(r.range.to)}` : '';
    const periodToggle = `<div class="toggle" role="group" aria-label="${tr('Dönem', 'Period')}">
      <button type="button" data-fac-rep-days="7" class="${fac.repDays === 7 ? 'active' : ''}">7${tr('G', 'D')}</button>
      <button type="button" data-fac-rep-days="30" class="${fac.repDays === 30 ? 'active' : ''}">30${tr('G', 'D')}</button>
    </div>`;
    const btn = `<span class="fac-head-r">${periodToggle}${range ? `<span class="muted">${range}${r.range?.actualDays ? ` · ${r.range.actualDays}${tr('g', 'd')}` : ''}</span>` : ''}
      <button class="btn sm ghost" type="button" id="fac-rep-refresh" ${run ? 'disabled' : ''}>↻ ${tr('Yenile', 'Refresh')}</button></span>`;
    const progress = run ? `<div class="fac-progress"><div class="storage-bar"><i style="width:${pctDone}%;background:var(--tq)"></i></div>
      <small class="muted">${tr(`Üye istatistikleri çekiliyor: ${j.done}/${j.total} · dakikada ~40 istek (Torn sınırının altında)`, `Fetching member stats: ${j.done}/${j.total} · ~40 requests a minute (below Torn's limit)`)}</small></div>` : '';
    const err = j.error ? `<div class="alert danger">${esc(j.error)}</div>` : '';
    const table = ([key, icon, title, col, fmt]) => {
      const list = r.boards?.[key] || [];
      let note = '';
      if (key === 'gym') note = r.gymRange?.error ? esc(r.gymRange.error) : !r.gymRange?.from ? tr('Gym verisi her gün kaydedilir; fark yarından itibaren görünür.', 'Gym data is recorded daily; changes show from tomorrow.') : r.gymRange.days < fac.repDays ? tr(`Son ${r.gymRange.days} gün (${fac.repDays} günlük kayıt birikiyor)`, `Last ${r.gymRange.days} day${r.gymRange.days === 1 ? '' : 's'} (building ${fac.repDays}d history)`) : '';
      return `<div class="fac-board"><div class="fac-board-h">${icon} ${tr(...title)}</div>
        <table class="tbl compact"><thead><tr><th>${tr('İsim', 'Name')}</th><th class="num">${tr(...col)}</th></tr></thead>
        <tbody>${list.map((x) => `<tr><td>${nameBtn(x.id, x.name)}</td><td class="num mono">${fmt(x.value)}</td></tr>`).join('') || `<tr><td colspan="2" class="muted">${run ? tr('hazırlanıyor…', 'building…') : tr('veri yok', 'no data')}</td></tr>`}</tbody></table>
        ${note ? `<small class="muted">${note}</small>` : ''}</div>`;
    };
    return `<article class="glass card">${head(btn)}${progress}${err}
      <div class="fac-boards">${BOARDS.map(table).join('')}</div>
      <p class="muted sl-note">${tr(
        'Torn API\'deki kişisel istatistiklerin dönem farkı (Torn günlük kayıt tutar; 40 güne kadar saklanır). Gym enerjisi faction katkı listesinden gelir. Veriler yalnızca bu bilgisayarda saklanır.',
        'Change in personal stats over the chosen period from the Torn API (daily records kept up to 40 days). Gym Energy comes from the faction contributors list. Data stays on this computer.')}</p>
    </article>`;
  }

  /* ---------- Tazelik & 24s TCT Adım Çizgisi Yardımcıları ---------- */
  function renderFreshnessBar(d, refreshBtnId, showSourceToggle = false) {
    const f = d?.freshness || null;
    const isShared = d?.sourceMode === 'shared' || f?.source === 'shared_hub';
    const srcLabel = isShared ? tr('Ortak · Faction Hub', 'Shared · Faction Hub') : tr('Yerel · Torn roster', 'Local · Torn roster');
    const obs = f?.observedAt ? isoHms(f.observedAt) : '—';
    const age = f?.observedAt ? ageText(Math.max(0, Math.floor((Date.now() - Date.parse(f.observedAt)) / 1000))) : '';
    const stale = f?.state === 'stale' || Boolean(f?.staleFallback);
    const badge = f
      ? `<span class="chip ${stale ? 'warn' : 'green'}">${stale ? `⚠ ${tr('Eski veri', 'Stale')}` : `● ${tr('Güncel', 'Fresh')}`}</span>`
      : '';
    const sourceToggle = showSourceToggle ? `<div class="toggle" role="group" aria-label="${tr('Kaynak', 'Source')}">
      <button type="button" data-fac-rad-src="local" class="${fac.radSource === 'local' ? 'active' : ''}">${tr('Yerel', 'Local')}</button>
      <button type="button" data-fac-rad-src="shared" class="${fac.radSource === 'shared' ? 'active' : ''}">${tr('Ortak', 'Shared')}</button>
    </div>` : '';
    const fallbackNote = d?.hubFallbackReason && fac.radSource === 'shared'
      ? `<div class="fac-fresh-note muted">${tr('Ortak Hub şu an kullanılamıyor; yerel Torn verisi gösteriliyor.', 'Shared Hub unavailable right now; showing local Torn roster.')}</div>`
      : f?.staleFallback
        ? `<div class="fac-fresh-note warn-text">⚠ ${tr('Geçici kaynak hatası nedeniyle önceki anlık görüntü gösteriliyor.', 'Showing last snapshot due to a temporary upstream error.')} ${esc(f.staleMessage || '')}</div>`
        : '';
    return `<div class="fac-fresh-bar">
      <div class="fac-fresh-meta">
        <span class="chip dim">${srcLabel}</span>
        ${badge}
        <span class="mono sub-text">${tr('Gözlem', 'Observed')}: <b>${obs}</b>${age ? ` (${age})` : ''}</span>
      </div>
      <div class="fac-head-r">
        ${sourceToggle}
        <button class="btn sm ghost" type="button" id="${refreshBtnId}">↻ ${tr('Yenile', 'Refresh')}</button>
      </div>
    </div>${fallbackNote}`;
  }

  function renderActivityTimelineSvg(timeline, totalMembers) {
    const pts = Array.isArray(timeline) ? timeline.filter((p) => Number(p?.at) > 0).sort((a, b) => a.at - b.at) : [];
    const denom = Math.max(1, Number(totalMembers) || Math.max(0, ...pts.map((p) => Number(p.total) || 0)));
    if (pts.length < 2) {
      return `<article class="glass card">
        <div class="card-head wrap">
          <div><h3>📈 ${tr('24 Saatlik Aktivite (TCT Adım Çizgisi)', '24h Activity (TCT Step-Line)')}</h3>
            <span class="muted">${tr('Payda', 'Denominator')}: ${denom} ${tr('üye', 'members')}</span></div>
        </div>
        <div class="fac-step-empty muted">${tr('24 saatlik TCT adım çizgisi için en az 2 örnek bekleniyor. Uygulama açık kaldıkça her 5 dakikada bir kaydedilir.', 'Waiting for at least 2 snapshots to plot the 24h TCT step-line. Snapshots record every 5 minutes while the app runs.')}</div>
      </article>`;
    }

    const W = 720, H = 172, padL = 34, padR = 14, padT = 14, padB = 26;
    const endMs = Math.max(Date.now(), pts[pts.length - 1].at);
    const startMs = endMs - 24 * 3600_000;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const xOf = (ms) => padL + Math.max(0, Math.min(1, (ms - startMs) / (24 * 3600_000))) * plotW;
    const yOf = (val) => padT + plotH - Math.max(0, Math.min(1, val / denom)) * plotH;

    const GAP_MS = 35 * 60_000;
    const onlineSegs = [];
    const activeSegs = [];
    const gaps = [];
    let curOn = [], curAct = [];
    const flush = () => {
      if (curOn.length >= 2) onlineSegs.push(curOn.join(' '));
      if (curAct.length >= 2) activeSegs.push(curAct.join(' '));
      curOn = []; curAct = [];
    };

    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const prev = i > 0 ? pts[i - 1] : null;
      const x = xOf(p.at).toFixed(1);
      const yOn = yOf(Number(p.online) || 0).toFixed(1);
      const yAct = yOf((Number(p.online) || 0) + (Number(p.idle) || 0)).toFixed(1);
      if (prev && (p.at - prev.at) > GAP_MS) {
        flush();
        gaps.push({ x1: xOf(prev.at), x2: xOf(p.at) });
      }
      if (curOn.length) {
        const prevYOn = yOf(Number(prev.online) || 0).toFixed(1);
        const prevYAct = yOf((Number(prev.online) || 0) + (Number(prev.idle) || 0)).toFixed(1);
        curOn.push(`L ${x} ${prevYOn} L ${x} ${yOn}`);
        curAct.push(`L ${x} ${prevYAct} L ${x} ${yAct}`);
      } else {
        curOn.push(`M ${x} ${yOn}`);
        curAct.push(`M ${x} ${yAct}`);
      }
    }
    flush();

    const yTicks = [0, Math.round(denom / 2), denom];
    const gridLines = yTicks.map((v) => {
      const y = yOf(v).toFixed(1);
      return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" class="fac-step-grid"/><text x="${padL - 6}" y="${Number(y) + 4}" text-anchor="end" class="fac-step-lbl">${v}</text>`;
    }).join('');
    const xTicks = [0, 6, 12, 18, 24].map((h) => {
      const ms = startMs + h * 3600_000;
      const x = xOf(ms).toFixed(1);
      const d = new Date(ms);
      const lbl = `${String(d.getUTCHours()).padStart(2, '0')}:00`;
      return `<text x="${x}" y="${H - 6}" text-anchor="middle" class="fac-step-lbl">${lbl}</text>`;
    }).join('');
    const gapRects = gaps.map((g) => `<rect x="${g.x1.toFixed(1)}" y="${padT}" width="${Math.max(2, g.x2 - g.x1).toFixed(1)}" height="${plotH}" class="fac-step-gap"><title>${esc(tr('Veri kesintisi / örnek yok', 'Outage / missing samples'))}</title></rect>`).join('');
    const dots = pts.slice(-48).map((p) => {
      const x = xOf(p.at).toFixed(1);
      const yOn = yOf(Number(p.online) || 0).toFixed(1);
      const tip = `${isoHm(p.observedAt || new Date(p.at).toISOString())} TCT · ${tr('Çevrimiçi', 'Online')}: ${p.online} · ${tr('Beklemede', 'Idle')}: ${p.idle} / ${p.total || denom}`;
      return `<circle cx="${x}" cy="${yOn}" r="2.6" class="fac-step-dot"><title>${esc(tip)}</title></circle>`;
    }).join('');

    return `<article class="glass card">
      <div class="card-head wrap">
        <div>
          <h3>📈 ${tr('24 Saatlik Aktivite (TCT Adım Çizgisi)', '24h Activity (TCT Step-Line)')}</h3>
          <span class="muted">${tr('Payda', 'Denominator')}: <b class="mono">${denom}</b> ${tr('üye', 'members')} · ${pts.length} ${tr('örnek', 'samples')}${gaps.length ? ` · ${gaps.length} ${tr('kesinti aralığı', 'gap(s)')}` : ''}</span>
        </div>
        <div class="fac-step-legend">
          <span><i class="fac-lg-on"></i> ${tr('Çevrimiçi', 'Online')}</span>
          <span><i class="fac-lg-act"></i> ${tr('Çevrimiçi + Beklemede', 'Online + Idle')}</span>
          ${gaps.length ? `<span><i class="fac-lg-gap"></i> ${tr('Kesinti', 'Gap')}</span>` : ''}
        </div>
      </div>
      <div class="fac-step-wrap">
        <svg viewBox="0 0 ${W} ${H}" class="fac-step-svg" role="img" aria-label="${esc(tr('24 saatlik TCT aktivite grafiği', '24h TCT activity chart'))}">
          ${gridLines}
          ${gapRects}
          ${activeSegs.map((s) => `<path d="${s}" class="fac-step-line-act" fill="none"/>`).join('')}
          ${onlineSegs.map((s) => `<path d="${s}" class="fac-step-line-on" fill="none"/>`).join('')}
          ${dots}
          ${xTicks}
        </svg>
      </div>
    </article>`;
  }

  /* ---------- Sekme 2: Aktivite Dashboard (/dashboard/activity) ---------- */
  function renderActivityTab() {
    if (!fac.act) return fac.actErr ? errorBox(fac.actErr) : loadingBox();
    if (fac.act.notInFaction) return notInFactionBox(fac.act);
    const d = fac.act;
    // Every count defaults to 0 so a partial reply never prints "undefined"
    const c = Object.fromEntries(['total', 'online', 'idle', 'offline', 'okay', 'hospital', 'traveling', 'abroad', 'jail', 'inOc'].map((k) => [k, Number(d.counts?.[k]) || 0]));
    const total = Math.max(1, c.total || 0);
    const hm = d.heatmap || { grid: [], maxAvg: 0, totalSamples: 0 };
    const dows = state.lang === 'en' ? DOW_EN : DOW_TR;

    const repById = new Map((fac.rep?.rows || []).map((r) => [r.id, r]));

    // Live distribution + stacked bar + freshness strip
    const dist = `<article class="glass card">
      ${renderFreshnessBar(d, 'fac-act-refresh', false)}
      <div class="card-head wrap">
        <h3>🟢 ${tr('Canlı Faction Aktivitesi', 'Live Faction Activity')}</h3>
        <span class="fac-head-r">
          <span class="chip green">● ${tr('Çevrimiçi', 'Online')}: ${c.online}</span>
          <span class="chip warn">● ${tr('Beklemede', 'Idle')}: ${c.idle}</span>
          <span class="chip dim">● ${tr('Çevrimdışı', 'Offline')}: ${c.offline}</span>
        </span>
      </div>
      <div class="storage-bar fac-act-bar">
        <i style="width:${(c.online / total) * 100}%;background:var(--ok)" title="${tr('Çevrimiçi', 'Online')}: ${c.online}"></i>
        <i style="width:${(c.idle / total) * 100}%;background:var(--warn)" title="${tr('Beklemede', 'Idle')}: ${c.idle}"></i>
        <i style="width:${(c.offline / total) * 100}%;background:var(--muted-2)" title="${tr('Çevrimdışı', 'Offline')}: ${c.offline}"></i>
      </div>
      <div class="chip-row fac-state-chips">
        <span class="chip ok">✓ ${tr('Müsait', 'Okay')}: ${c.okay}</span>
        <span class="chip danger">🏥 ${tr('Hastane', 'Hospital')}: ${c.hospital}</span>
        ${feat('faction.travelRadar')
          ? `<button type="button" class="chip blue fac-radar-jump" data-open-radar-state="outbound">✈ ${tr('Uçakta', 'Traveling')}: ${c.traveling} ↗</button>
             <button type="button" class="chip blue fac-radar-jump" data-open-radar-state="abroad">🌍 ${tr('Yurt dışı', 'Abroad')}: ${c.abroad} ↗</button>`
          : `<span class="chip blue">✈ ${tr('Uçakta', 'Traveling')}: ${c.traveling}</span>
             <span class="chip blue">🌍 ${tr('Yurt dışı', 'Abroad')}: ${c.abroad}</span>`}
        <span class="chip warn">⛓ ${tr('Hapis', 'Jail')}: ${c.jail}</span>
        <span class="chip tq">🕵️ ${tr('OC\'de', 'In OC')}: ${c.inOc}/${c.total}</span>
      </div>
    </article>`;

    const stepChartCard = renderActivityTimelineSvg(d.timeline, c.total);

    // 7x24 UTC/TCT Activity Heatmap
    const hoursHead = Array.from({ length: 24 }, (_, h) => `<th class="mono">${String(h).padStart(2, '0')}</th>`).join('');
    const hmRows = hm.grid.map((row, dayIdx) => `<tr><th class="fac-hm-dow">${dows[dayIdx]}</th>${row.map((cell) => {
      const ratio = hm.maxAvg > 0 && cell.samples ? Math.min(1, cell.avgActive / hm.maxAvg) : 0;
      const lvl = !cell.samples ? 0 : ratio >= 0.75 ? 4 : ratio >= 0.5 ? 3 : ratio >= 0.25 ? 2 : 1;
      const tip = cell.samples
        ? `${dows[dayIdx]} ${String(cell.hour).padStart(2, '0')}:00 TCT · ${tr('Ort. çevrimiçi', 'Avg online')}: ${cell.avgOnline.toFixed(1)} · ${tr('Beklemede', 'Idle')}: ${cell.avgIdle.toFixed(1)} (${cell.samples} ${tr('örnek', 'samples')})`
        : `${dows[dayIdx]} ${String(cell.hour).padStart(2, '0')}:00 TCT · ${tr('henüz örnek yok', 'no sample yet')}`;
      return `<td class="fac-hm-cell lvl-${lvl}" title="${esc(tip)}"></td>`;
    }).join('')}</tr>`).join('');

    const hmMeta = [
      hm.peakHour ? `${tr('En yoğun saat', 'Peak hour')}: <b class="mono">${String(hm.peakHour.hour).padStart(2, '0')}:00 TCT</b> (${hm.peakHour.avg.toFixed(1)})` : null,
      hm.quietHour ? `${tr('En sakin saat', 'Quietest hour')}: <b class="mono">${String(hm.quietHour.hour).padStart(2, '0')}:00 TCT</b> (${hm.quietHour.avg.toFixed(1)})` : null,
      `${hm.totalSamples} ${tr('örnek kaydedildi', 'snapshots recorded')}`,
    ].filter(Boolean).join(' · ');

    const heatmapCard = `<article class="glass card">
      <div class="card-head wrap">
        <div><h3>🔥 ${tr('Saatlik Aktivite Isı Haritası (TCT)', 'Hourly Activity Heatmap (TCT)')}</h3>
          <span class="muted">${hmMeta}</span></div>
        <span class="sub-text">${tr('Uygulama açık kaldıkça her 15 dk\'da bir otomatik birikir', 'Builds automatically every 15 min while the app runs')}</span>
      </div>
      <div class="tbl-wrap"><table class="fac-hm"><thead><tr><th></th>${hoursHead}</tr></thead><tbody>${hmRows}</tbody></table></div>
    </article>`;

    // Side-by-side Member Comparison
    const members = (d.members || []).map((m) => ({
      ...m,
      name: String(m.name || `#${m.id}`),
      position: String(m.position || ''),
      level: Number(m.level) || 0,
      days: m.days != null && Number.isFinite(Number(m.days)) ? Number(m.days) : null,
      last: Number(m.last) || 0,
      lastRel: String(m.lastRel || ''),
    }));
    const per = `(${fac.repDays}${tr('g', 'd')})`;
    const mA = members.find((m) => m.id === fac.cmpA) || members[0];
    const mB = members.find((m) => m.id === fac.cmpB) || members[1] || members[0];
    const rA = mA ? repById.get(mA.id) : null;
    const rB = mB ? repById.get(mB.id) : null;
    const cmpMetric = (label, a, b, fmt = n0) => {
      const aWin = a != null && b != null && a > b;
      const bWin = a != null && b != null && b > a;
      return `<tr><td>${label}</td><td class="num mono ${aWin ? 'pos' : ''}">${a != null ? fmt(a) : '—'}</td><td class="num mono ${bWin ? 'pos' : ''}">${b != null ? fmt(b) : '—'}</td></tr>`;
    };
    const cmpCard = members.length >= 2 ? `<article class="glass card">
      <div class="card-head wrap">
        <h3>⚖️ ${tr('Üye Karşılaştırma', 'Member Comparison')}</h3>
        <div class="fac-cmp-pick">
          <select id="fac-cmp-a">${members.map((m) => `<option value="${m.id}"${m.id === mA?.id ? ' selected' : ''}>${esc(m.name)} (Lv ${m.level})</option>`).join('')}</select>
          <span class="muted">vs</span>
          <select id="fac-cmp-b">${members.map((m) => `<option value="${m.id}"${m.id === mB?.id ? ' selected' : ''}>${esc(m.name)} (Lv ${m.level})</option>`).join('')}</select>
        </div>
      </div>
      <div class="tbl-wrap"><table class="tbl compact">
        <thead><tr><th>${tr('Metrik', 'Metric')}</th><th class="num">${mA ? nameBtn(mA.id, mA.name) : '—'}</th><th class="num">${mB ? nameBtn(mB.id, mB.name) : '—'}</th></tr></thead>
        <tbody>
          ${cmpMetric(tr('Seviye', 'Level'), mA?.level, mB?.level)}
          ${cmpMetric(tr('Faction günü', 'Days in faction'), mA?.days, mB?.days)}
          ${cmpMetric(`${tr('Oynama süresi', 'Time played')} ${per}`, rA?.activity, rB?.activity, hms)}
          ${cmpMetric(`Xanax ${per}`, rA?.xanax, rB?.xanax)}
          ${cmpMetric(`Gym E ${per}`, rA?.gym, rB?.gym)}
          ${cmpMetric(`${tr('Suç', 'Crimes')} ${per}`, rA?.crimes, rB?.crimes)}
          ${cmpMetric(`OC ${per}`, rA?.oc, rB?.oc)}
        </tbody>
      </table></div>
    </article>` : '';

    // Filterable full member roster
    const q = fac.actQ.trim().toLowerCase();
    let list = members.filter((m) => {
      if (q && !m.name.toLowerCase().includes(q) && !m.position.toLowerCase().includes(q)) return false;
      if (fac.actFilter === 'online' && m.lastStatus !== 'Online') return false;
      if (fac.actFilter === 'idle' && m.lastStatus !== 'Idle') return false;
      if (fac.actFilter === 'offline' && m.lastStatus !== 'Offline') return false;
      if (fac.actFilter === 'away' && m.state === 'Okay') return false;
      return true;
    });
    const sorters = {
      last: (a, b) => b.last - a.last,
      level: (a, b) => b.level - a.level,
      days: (a, b) => (b.days ?? -1) - (a.days ?? -1),
      activity: (a, b) => (repById.get(b.id)?.activity ?? -1) - (repById.get(a.id)?.activity ?? -1),
      xanax: (a, b) => (repById.get(b.id)?.xanax ?? -1) - (repById.get(a.id)?.xanax ?? -1),
      gym: (a, b) => (repById.get(b.id)?.gym ?? -1) - (repById.get(a.id)?.gym ?? -1),
    };
    list.sort(sorters[fac.actSort] || sorters.last);
    const hasStats = repById.size > 0;
    const opt = (v, label, cur) => `<option value="${v}"${v === cur ? ' selected' : ''}>${label}</option>`;

    const rosterRows = list.map((m) => {
      const r = repById.get(m.id);
      return `<tr>
        <td>${nameBtn(m.id, m.name)}</td>
        <td class="num mono">${m.level}</td>
        <td>${esc(m.position)}</td>
        <td><i class="fac-dot ${m.lastStatus === 'Online' ? 'on' : m.lastStatus === 'Idle' ? 'idle' : ''}"></i>${lastSeen(m.last, m.lastRel)}</td>
        <td>${m.state && m.state !== 'Okay' ? `<span class="chip ${m.state === 'Hospital' || m.state === 'Jail' ? 'danger' : 'blue'}">${stateText(m.state)}</span>` : `<span class="muted">${stateText('Okay')}</span>`}</td>
        <td class="num mono">${n0(m.days)}</td>
        <td>${m.inOc ? `<span class="chip green">OC</span>` : `<span class="chip dim">—</span>`}</td>
        ${hasStats ? `<td class="num mono">${r?.activity != null ? hms(r.activity) : '—'}</td><td class="num mono">${r?.xanax != null ? n0(r.xanax) : '—'}</td><td class="num mono">${r?.gym != null ? n0(r.gym) : '—'}</td>` : ''}
      </tr>`;
    }).join('');

    const rosterCard = `<article class="glass card">
      <div class="card-head wrap">
        <h3>👥 ${tr('Tüm Üyeler', 'All Members')} <span class="chip">${list.length} / ${members.length}</span></h3>
        <div class="fac-act-tools">
          <input class="input" id="fac-act-q" type="search" placeholder="${tr('Üye veya pozisyon ara…', 'Search member or position…')}" value="${esc(fac.actQ)}">
          <div class="toggle" role="group">
            <button type="button" data-fac-af="all" class="${fac.actFilter === 'all' ? 'active' : ''}">${tr('Hepsi', 'All')}</button>
            <button type="button" data-fac-af="online" class="${fac.actFilter === 'online' ? 'active' : ''}">${tr('Çevrimiçi', 'Online')}</button>
            <button type="button" data-fac-af="idle" class="${fac.actFilter === 'idle' ? 'active' : ''}">${tr('Beklemede', 'Idle')}</button>
            <button type="button" data-fac-af="offline" class="${fac.actFilter === 'offline' ? 'active' : ''}">${tr('Çevrimdışı', 'Offline')}</button>
            <button type="button" data-fac-af="away" class="${fac.actFilter === 'away' ? 'active' : ''}">${tr('Müsait değil', 'Away')}</button>
          </div>
          <select id="fac-act-sort">
            ${opt('last', tr('Son görülme', 'Last seen'), fac.actSort)}
            ${opt('level', tr('Seviye', 'Level'), fac.actSort)}
            ${opt('days', tr('Faction günü', 'Days'), fac.actSort)}
            ${hasStats ? opt('activity', `${tr('Oynama süresi', 'Time played')} ${per}`, fac.actSort) : ''}
            ${hasStats ? opt('xanax', `Xanax ${per}`, fac.actSort) : ''}
            ${hasStats ? opt('gym', `Gym E ${per}`, fac.actSort) : ''}
          </select>
        </div>
      </div>
      <div class="tbl-wrap"><table class="tbl compact">
        <thead><tr>
          <th>${tr('Üye', 'Member')}</th><th class="num">Lv</th><th>${tr('Pozisyon', 'Position')}</th>
          <th>${tr('Son görülme', 'Last seen')}</th><th>${tr('Durum', 'Status')}</th><th class="num">${tr('Gün', 'Days')}</th><th>OC</th>
          ${hasStats ? `<th class="num">${tr('Süre', 'Played')} ${per}</th><th class="num">Xanax</th><th class="num">Gym E</th>` : ''}
        </tr></thead>
        <tbody>${rosterRows || `<tr><td colspan="${hasStats ? 10 : 7}" class="muted">${tr('Eşleşen üye yok.', 'No matching members.')}</td></tr>`}</tbody>
      </table></div>
    </article>`;

    return dist + stepChartCard + heatmapCard + cmpCard + rosterCard;
  }

  /* ---------- Sekme 2.5: Faction Travel Radar (P0.3) ---------- */
  function renderRadarTab() {
    const d = radarData();
    const err = radarErr();
    if (!d && !err) return loadingBox();
    if (!d && err) {
      return `<article class="glass card">${errorBox(err)}
        <div class="fac-radar-retry"><button class="btn sm ghost" type="button" id="fac-rad-refresh">↻ ${tr('Tekrar dene', 'Retry')}</button></div>
      </article>`;
    }
    if (d.notInFaction) return notInFactionBox(d);
    const travel = Array.isArray(d.travel) ? d.travel : [];
    const sum = { outbound: 0, abroad: 0, inbound: 0, unknown: 0, totalTravel: travel.length, ...(d.travelSummary || {}) };
    const countryTitle = countryName;

    // Summary filter cards (clickable)
    const sumCard = (key, icon, label, val, cls) => `<button type="button" class="glass fac-rad-kpi ${cls}${fac.radState === key ? ' active' : ''}" data-fac-rad-state="${key}" aria-pressed="${fac.radState === key}">
      <span class="label">${icon} ${label}</span>
      <strong class="value mono">${n0(val)}</strong>
    </button>`;

    const summaryBar = `<div class="fac-rad-kpis">
      ${sumCard('outbound', '↗', tr('Yurt dışına giden', 'Outbound'), sum.outbound, 'blue')}
      ${sumCard('abroad', '🌍', tr('Yurt dışında', 'Abroad'), sum.abroad, 'tq')}
      ${sumCard('inbound', '↙', tr('Torn\'a dönen', 'Inbound'), sum.inbound, 'green')}
      ${sum.unknown ? sumCard('unknown', '?', tr('Bilinmiyor', 'Unknown'), sum.unknown, 'warn') : ''}
    </div>`;

    const countriesSet = new Map();
    for (const r of travel) {
      const code = r.travelState === 'inbound' ? r.origin : r.destination;
      if (code && code !== 'torn') countriesSet.set(code, countryTitle(code) || code);
    }
    const countryOpts = [...countriesSet.entries()].sort((a, b) => a[1].localeCompare(b[1]));

    const q = fac.radQ.trim().toLowerCase();
    const filtered = travel.filter((r) => {
      if (fac.radState !== 'all' && r.travelState !== fac.radState) return false;
      const cc = r.travelState === 'inbound' ? r.origin : r.destination;
      if (fac.radCountry !== 'all' && cc !== fac.radCountry) return false;
      if (fac.radAct !== 'all' && r.activityStatus !== fac.radAct) return false;
      if (q) {
        const hay = `${r.displayName} ${countryTitle(r.destination)} ${countryTitle(r.origin)} ${r.rawDescription || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const hasFilters = fac.radState !== 'all' || fac.radCountry !== 'all' || fac.radAct !== 'all' || Boolean(q);
    const stateBadge = (r) => {
      const [cls, ic] = TRAVEL_STATE[r.travelState] || TRAVEL_STATE.unknown;
      const lbl = travelStateText(r.travelState);
      const health = r.healthStatus && r.healthStatus !== 'okay' && r.healthStatus !== 'unknown'
        ? ` <span class="chip danger">${esc(stateText(r.healthStatus[0].toUpperCase() + r.healthStatus.slice(1)))}</span>`
        : '';
      return `<span class="chip ${cls}">${ic} ${lbl}</span>${health}`;
    };

    const routeCell = (r) => {
      const cc = r.travelState === 'inbound' ? r.origin : r.destination;
      const cName = countryTitle(cc);
      if (r.travelState === 'unknown') {
        return `<span class="muted">${esc(r.rawDescription || tr('Rota tanınmadı', 'Unrecognized route'))}</span>`;
      }
      const routeTxt = travelRoute(r.travelState, r.origin, r.destination) || cName || '—';
      const travelBtn = cc && cc !== 'torn' && feat('page.travel') && !viewHidden('travel')
        ? `<button type="button" class="fac-rad-country" data-travel-country="${esc(cc)}" title="${esc(tr('Seyahat Kârı\'nda bu ülkeyi aç', 'Open this country in Travel Profit'))}"><span lang="en">${esc(routeTxt)}</span> ↗</button>`
        : `<span lang="en"><b>${esc(routeTxt)}</b></span>`;
      return travelBtn;
    };

    const etaCell = (r) => {
      if (r.travelState === 'abroad') return `<span class="muted">—</span>`;
      if (r.etaKind === 'exact' && r.etaAt) {
        const left = Math.round((Date.parse(r.etaAt) - Date.now()) / 1000);
        return `<b class="mono">${isoHm(r.etaAt)} TCT</b> <span class="chip green">${tr('Kesin', 'Exact')}</span>${left > 0 ? `<div class="sub-text">${human(left)}</div>` : ''}`;
      }
      if (r.etaKind === 'estimate' && r.etaFrom && r.etaTo) {
        return `<span class="mono">${isoHm(r.etaFrom)}–${isoHm(r.etaTo)} TCT</span><div class="sub-text">${tr('Tahmini aralık', 'Est. window')}</div>`;
      }
      return `<span class="muted">${tr('Bilinmiyor', 'Unknown')}</span>`;
    };

    // Radar rows carry Torn's English "last action" text; the roster in the same reply has the timestamp
    const lastById = new Map((d.members || []).map((m) => [Number(m.id), Number(m.last) || 0]));
    const rowsHtml = filtered.map((r) => `<tr>
      <td>${nameBtn(r.playerId, r.displayName)}<div class="sub-text">Lv ${r.level}${r.position ? ` · ${esc(r.position)}` : ''}${r.inOc ? ' · OC' : ''}</div></td>
      <td>${stateBadge(r)}</td>
      <td>${routeCell(r)}</td>
      <td><i class="fac-dot ${r.activityStatus === 'Online' ? 'on' : r.activityStatus === 'Idle' ? 'idle' : ''}"></i><span>${r.activityStatus === 'Online' ? tr('Çevrimiçi', 'Online') : r.activityStatus === 'Idle' ? tr('Beklemede', 'Idle') : r.activityStatus === 'Offline' ? tr('Çevrimdışı', 'Offline') : esc(r.activityStatus || '—')}</span>${r.lastRel || lastById.get(Number(r.playerId)) ? `<div class="sub-text">${lastSeen(lastById.get(Number(r.playerId)), r.lastRel)}</div>` : ''}</td>
      <td>${etaCell(r)}</td>
    </tr>`).join('');

    const opt = (v, label, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(label)}</option>`;
    const body = !travel.length
      ? emptyBox(
        tr('Şu an uçuşta veya yurt dışında üye yok', 'No faction members flying or abroad right now'),
        tr('Faction üyeleri seyahate çıktığında yön, ülke ve geçiş tabanlı tahmini varış penceresi burada görünür.', 'When faction members travel abroad, direction, country and transition-based ETA windows appear here.'),
      )
      : filtered.length
        ? `<div class="tbl-wrap"><table class="tbl compact fac-rad-tbl">
            <thead><tr>
              <th>${tr('Üye', 'Member')}</th>
              <th>${tr('Yön / Durum', 'Direction / State')}</th>
              <th>${tr('Ülke / Rota', 'Country / Route')}</th>
              <th>${tr('Aktivite', 'Activity')}</th>
              <th>${tr('Tahmini Varış (TCT)', 'ETA (TCT)')}</th>
            </tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table></div>`
        : emptyBox(tr('Filtreye uyan üye yok', 'No matching travelers'), tr('Arama veya filtreleri temizlemeyi dene.', 'Try clearing your search or filters.'));

    return `<article class="glass card">
      ${renderFreshnessBar(d, 'fac-rad-refresh', true)}
      ${summaryBar}
      <div class="card-head wrap">
        <h3>🛰️ ${tr('Faction Travel Radar', 'Faction Travel Radar')} <span class="chip">${filtered.length} / ${travel.length}</span></h3>
        <div class="fac-act-tools">
          <input class="input" id="fac-rad-q" type="search" placeholder="${tr('Üye veya ülke ara…', 'Search member or country…')}" value="${esc(fac.radQ)}">
          <select id="fac-rad-country" aria-label="${esc(tr('Ülke', 'Country'))}">
            ${opt('all', tr('Tüm ülkeler', 'All countries'), fac.radCountry)}
            ${countryOpts.map(([code, name]) => opt(code, name, fac.radCountry)).join('')}
          </select>
          <select id="fac-rad-act" aria-label="${esc(tr('Aktivite', 'Activity'))}">
            ${opt('all', tr('Tüm aktivite', 'All activity'), fac.radAct)}
            ${opt('Online', tr('Çevrimiçi', 'Online'), fac.radAct)}
            ${opt('Idle', tr('Beklemede', 'Idle'), fac.radAct)}
            ${opt('Offline', tr('Çevrimdışı', 'Offline'), fac.radAct)}
          </select>
          ${hasFilters ? `<button class="btn sm ghost" type="button" id="fac-rad-reset">${tr('Sıfırla', 'Reset')}</button>` : ''}
        </div>
      </div>
      ${body}
      <p class="muted sl-note">${tr(
        'Aktivite ve sağlık ayrı izlenir. ETA yalnızca iki anlık görüntü arasında geçiş gözlendiğinde aralık olarak hesaplanır; hastane/hapis süresi asla uçuş inişi olarak gösterilmez.',
        'Activity and health are tracked separately. ETA windows appear only when a transition is observed between snapshots; hospital/jail timers are never treated as flight arrival.',
      )}</p>
    </article>`;
  }

  /* ---------- Sekme 3: Armory Geçmişi ---------- */
  function renderArmoryTab() {
    if (!fac.arm) return fac.armErr ? errorBox(fac.armErr) : loadingBox();
    const a = fac.arm;
    if (!a.allowed) {
      return `<article class="glass card fac-lock">
        <div class="card-head wrap"><h3>🔒 ${tr('Armory Geçmişi', 'Armory History')}</h3>
          <button class="btn sm ghost" type="button" data-open-url="${ARMORY_UTILITIES_URL}" data-tab-label="Armory · Utilities">🧰 ${tr('Armory Utilities', 'Armory Utilities')} ↗</button></div>
        <p>${esc(a.error || tr('Faction API Access izni gerekiyor.', 'Faction API Access permission required.'))}</p>
      </article>`;
    }
    const q = fac.armQ.trim().toLowerCase();
    const list = (a.entries || []).filter((e) => {
      if (fac.armCat !== 'all' && e.category !== fac.armCat) return false;
      if (q && !e.text.toLowerCase().includes(q)) return false;
      return true;
    });
    const catChip = (cat) => {
      const cls = { used: 'blue', loaned: 'warn', returned: 'green', filled: 'tq', deposited: 'green', retrieved: 'orange', other: 'dim' }[cat] || 'dim';
      return `<span class="chip ${cls}">${tr(...(ARM_LABELS[cat] || [cat, cat]))}</span>`;
    };
    const topUsers = (a.topActors || []).length
      ? `<div class="chip-row fac-arm-top">${a.topActors.map((u) => `<span class="chip">${u.id ? nameBtn(u.id, u.name) : esc(u.name)} · <b class="mono">${u.total}</b></span>`).join('')}</div>`
      : '';

    return `<article class="glass card">
      <div class="card-head wrap">
        <div><h3>🧰 ${tr('Faction Armory Geçmişi', 'Faction Armory History')} <span class="chip">${list.length}</span></h3>
          <span class="muted">${tr('Son 100 armory hareketi · kim ne kullandı, ödünç aldı veya doldurdu', 'Last 100 armory events · who used, loaned, returned or filled items')}</span></div>
        <div class="fac-head-r">
          <button class="btn sm ghost" type="button" id="fac-arm-refresh">↻ ${tr('Yenile', 'Refresh')}</button>
          <button class="btn sm ghost" type="button" data-open-url="${ARMORY_UTILITIES_URL}" data-tab-label="Armory · Utilities">${tr('Armory Utilities', 'Armory Utilities')} ↗</button>
        </div>
      </div>
      ${topUsers}
      <div class="fac-act-tools">
        <input class="input" id="fac-arm-q" type="search" placeholder="${tr('Oyuncu veya eşya ara…', 'Search player or item…')}" value="${esc(fac.armQ)}">
        <div class="toggle" role="group">
          ${['all', 'used', 'loaned', 'returned', 'filled', 'deposited', 'retrieved'].map((k) => `<button type="button" data-fac-arm-cat="${k}" class="${fac.armCat === k ? 'active' : ''}">${tr(...ARM_LABELS[k])}${k !== 'all' && a.counts?.[k] ? ` (${a.counts[k]})` : ''}</button>`).join('')}
        </div>
      </div>
      ${list.length ? `<div class="tbl-wrap"><table class="tbl compact">
        <thead><tr><th>${tr('Zaman (TCT)', 'Time (TCT)')}</th><th>${tr('İşlem', 'Action')}</th><th>${tr('Detay', 'Event')}</th></tr></thead>
        <tbody>${list.map((e) => `<tr>
          <td class="mono sub-text">${tsFmt(e.timestamp)}</td>
          <td>${catChip(e.category)}</td>
          <td class="fac-arm-txt">${esc(e.text)}</td>
        </tr>`).join('')}</tbody>
      </table></div>` : emptyBox(tr('Kayıt yok', 'No armory entries'), tr('Filtreye uyan armory hareketi bulunamadı.', 'No matching armory events found.'))}
    </article>`;
  }

  /* ---------- Sekme 4: Chain Raporları ---------- */
  function renderChainsTab() {
    if (!fac.ch) return fac.chErr ? errorBox(fac.chErr) : loadingBox();
    const cur = fac.ch.current;
    const list = fac.ch.chains || [];
    const activeBanner = cur && Number(cur.current) > 0 ? `<article class="glass card">
      <div class="card-head wrap"><h3>🔥 ${tr('Aktif Chain', 'Active Chain')}</h3>
        <button class="btn sm ghost" type="button" data-open-url="${CHAIN_URL}" data-tab-label="Faction Chain">${tr('Torn\'da aç', 'Open in Torn')} ↗</button></div>
      <div class="grid kpis small">
        ${kpi(tr('Vuruş', 'Hits'), `${n0(cur.current)} / ${n0(cur.max)}`, '', 'tq')}
        ${kpi(tr('Zaman aşımı', 'Timeout'), cur.timeout > 0 ? human(cur.timeout) : '—', cur.timeout > 0 && cur.timeout < 90 ? tr('Dikkat! Chain düşebilir', 'Warning! Chain expiring soon') : '', cur.timeout > 0 && cur.timeout < 90 ? 'neg' : '')}
        ${kpi(tr('Çarpan', 'Modifier'), cur.modifier != null ? `×${Number(cur.modifier).toFixed(2)}` : '—')}
        ${kpi(tr('Cooldown', 'Cooldown'), cur.cooldown > 0 ? human(cur.cooldown) : tr('Yok', 'None'))}
      </div>
    </article>` : '';

    const rows = list.map((c) => `<tr>
      <td class="mono"><b>${n0(c.chain)}</b>${c.milestone ? ` <span class="chip tq">${compact(c.milestone, 0)}</span>` : ''}</td>
      <td class="num mono pos">${n0(Math.round(c.respect))}</td>
      <td class="num mono">${c.respectPerHit.toFixed(2)}</td>
      <td class="mono sub-text">${c.duration ? hms(c.duration) : '—'}</td>
      <td class="mono sub-text">${tsFmt(c.start)}</td>
      <td class="mono sub-text">${tsFmt(c.end)}</td>
    </tr>`).join('');

    return `${activeBanner}<article class="glass card">
      <div class="card-head wrap">
        <div><h3>⛓ ${tr('Geçmiş Chain Raporları', 'Past Chain Reports')} <span class="chip">${list.length}</span></h3>
          <span class="muted">${tr('Son 25 chain · bonus eşikleri, respect ve hit başına respect', 'Last 25 chains · bonus milestones, total respect and respect per hit')}</span></div>
        <div class="fac-head-r">
          <button class="btn sm ghost" type="button" id="fac-ch-refresh">↻ ${tr('Yenile', 'Refresh')}</button>
          ${feat('page.war') && feat('war.payout') ? `<button class="btn sm ghost" type="button" data-open-war-payout="">💰 ${tr('Savaş Ödemesi', 'War Payout')}</button>` : ''}
          <button class="btn sm ghost" type="button" data-open-url="${CHAIN_URL}" data-tab-label="Faction Chain">${tr('Chain sayfası', 'Chain page')} ↗</button>
        </div>
      </div>
      ${list.length ? `<div class="tbl-wrap"><table class="tbl compact">
        <thead><tr>
          <th>${tr('Chain', 'Chain')}</th><th class="num">Respect</th><th class="num">${tr('Hit başı', 'Resp/hit')}</th>
          <th>${tr('Süre', 'Duration')}</th><th>${tr('Başlangıç (TCT)', 'Start (TCT)')}</th><th>${tr('Bitiş (TCT)', 'End (TCT)')}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>` : emptyBox(tr('Chain kaydı yok', 'No chains recorded'), tr('Bu faction için geçmiş chain verisi bulunamadı.', 'No past chain history found for this faction.'))}
    </article>`;
  }

  /* ---------- Sekme 5: Yükseltme Simülatörü ---------- */
  function renderUpgradesTab() {
    if (!fac.upg) return fac.upgErr ? errorBox(fac.upgErr) : loadingBox();
    const u = fac.upg;
    const avail = fac.upgRespectOverride != null ? fac.upgRespectOverride : (u.faction?.respect || 0);
    const sim = LRXFactionTools.simulateUpgrades(u.tree || [], fac.upgSel || {}, avail);
    const baseSim = LRXFactionTools.simulateUpgrades(u.tree || [], u.currentLevels || {}, avail);
    const deltaCost = sim.totalRespectCost - baseSim.totalRespectCost;

    const kpis = `<div class="grid kpis small" id="fac-upg-kpis">
      ${kpi(tr('Faction Respect', 'Faction Respect'), n0(avail), u.hasUpgradesAccess ? tr('Mevcut yükseltmeler yüklendi', 'Current upgrades loaded') : tr('Simülasyon modu (respect düzenlenebilir)', 'Sandbox mode (editable respect)'))}
      ${kpi(tr('Simülasyon Maliyeti', 'Simulated Cost'), n0(sim.totalRespectCost), deltaCost !== 0 ? `${deltaCost > 0 ? '+' : ''}${n0(deltaCost)} ${tr('mevcuda göre', 'vs current')}` : tr('mevcutla aynı', 'matches current'), 'tq')}
      ${kpi(tr('Kalan / Açık', 'Remaining / Deficit'), `${sim.remainingRespect >= 0 ? '+' : ''}${n0(sim.remainingRespect)}`, sim.affordable ? tr('Bütçe yeterli ✓', 'Within respect budget ✓') : tr('Respect yetersiz', 'Over respect budget'), sim.affordable ? 'pos' : 'neg')}
      ${kpi(tr('Aktif Dal', 'Active Branches'), String(sim.activeNonCoreCount), tr('Core 1× · diğerleri 1×→32×', 'Core 1× · others 1×→32×'))}
    </div>`;

    const branchTabs = `<div class="fac-upg-bar">
      <div class="toggle" role="group">
        <button type="button" data-fac-ub="all" class="${fac.upgBranch === 'all' ? 'active' : ''}">${tr('Tüm Dallar', 'All Branches')}</button>
        ${sim.breakdown.map((b) => `<button type="button" data-fac-ub="${esc(b.branch)}" class="${fac.upgBranch === b.branch ? 'active' : ''}">${esc(b.branch)}${b.respectCost ? ` (${b.multiplier}×)` : ''}</button>`).join('')}
      </div>
      <div class="fac-head-r">
        <label class="fac-upg-resp"><span>Respect</span><input class="input mono" id="fac-upg-respect" type="number" min="0" step="1000" value="${avail}"></label>
        <button class="btn sm ghost" type="button" id="fac-upg-reset">${tr('Mevcuda dön', 'Reset')}</button>
        <button class="btn sm ghost" type="button" id="fac-upg-clear">${tr('Sıfırla', 'Clear')}</button>
        <button class="btn sm ghost" type="button" data-open-url="${UPGRADES_URL}" data-tab-label="Faction Upgrades">${tr('Torn\'da aç', 'Open in Torn')} ↗</button>
      </div>
    </div>`;

    const shown = sim.breakdown.filter((b) => fac.upgBranch === 'all' || b.branch === fac.upgBranch);
    const branchCards = shown.map((b) => `<article class="glass card fac-upg-branch" data-fac-branch="${esc(b.branch)}">
      <div class="card-head wrap">
        <div><h3>${esc(b.branch)} <span data-fac-bchip>${b.isCore ? '<span class="chip dim">Core · 1×</span>' : b.baseCost > 0 ? `<span class="chip tq">#${b.order} · ${b.multiplier}×</span>` : '<span class="chip dim">—</span>'}</span></h3>
          <span class="muted" data-fac-bcost>${tr('Taban', 'Base')}: ${n0(b.baseCost)} · ${tr('Toplam', 'Total')}: <b class="mono">${n0(b.respectCost)}</b> respect</span></div>
      </div>
      <div class="fac-upg-grid">${b.items.map((it) => {
        const curLv = u.currentLevels?.[it.key] || 0;
        const diff = it.level - curLv;
        return `<div class="fac-upg-item${it.level > 0 ? ' on' : ''}" data-fac-item="${esc(it.key)}">
          <div class="fac-upg-top">
            <b>${esc(it.name)}</b>
            <span class="mono" data-fac-lvl>${it.level} / ${it.maxLevel}${diff !== 0 ? ` <small class="${diff > 0 ? 'pos' : 'neg'}">(${diff > 0 ? '+' : ''}${diff})</small>` : ''}</span>
          </div>
          <div class="fac-upg-ctrl">
            <input type="range" min="0" max="${it.maxLevel}" value="${it.level}" data-fac-upg="${esc(it.key)}" aria-label="${esc(it.name)}">
            <span class="mono sub-text" data-fac-icost>${n0(it.baseCost * b.multiplier)}</span>
          </div>
          ${it.ability ? `<small class="sub-text">${esc(it.ability)}</small>` : ''}
        </div>`;
      }).join('')}</div>
    </article>`).join('');

    return `${kpis}<article class="glass card">${branchTabs}</article>${branchCards}`;
  }

  const cssEsc = (s) => (typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(String(s)) : String(s).replace(/["\\]/g, '\\$&'));

  // Update Upgrade Simulator numbers in-place while dragging a range slider so pointer capture never drops
  function patchUpgradeMetrics() {
    const u = fac.upg;
    const kpiBox = $('#fac-upg-kpis');
    if (!u || !kpiBox) return false;
    const avail = fac.upgRespectOverride != null ? fac.upgRespectOverride : (u.faction?.respect || 0);
    const sim = LRXFactionTools.simulateUpgrades(u.tree || [], fac.upgSel || {}, avail);
    const baseSim = LRXFactionTools.simulateUpgrades(u.tree || [], u.currentLevels || {}, avail);
    const deltaCost = sim.totalRespectCost - baseSim.totalRespectCost;

    kpiBox.innerHTML = [
      kpi(tr('Faction Respect', 'Faction Respect'), n0(avail), u.hasUpgradesAccess ? tr('Mevcut yükseltmeler yüklendi', 'Current upgrades loaded') : tr('Simülasyon modu (respect düzenlenebilir)', 'Sandbox mode (editable respect)')),
      kpi(tr('Simülasyon Maliyeti', 'Simulated Cost'), n0(sim.totalRespectCost), deltaCost !== 0 ? `${deltaCost > 0 ? '+' : ''}${n0(deltaCost)} ${tr('mevcuda göre', 'vs current')}` : tr('mevcutla aynı', 'matches current'), 'tq'),
      kpi(tr('Kalan / Açık', 'Remaining / Deficit'), `${sim.remainingRespect >= 0 ? '+' : ''}${n0(sim.remainingRespect)}`, sim.affordable ? tr('Bütçe yeterli ✓', 'Within respect budget ✓') : tr('Respect yetersiz', 'Over respect budget'), sim.affordable ? 'pos' : 'neg'),
      kpi(tr('Aktif Dal', 'Active Branches'), String(sim.activeNonCoreCount), tr('Core 1× · diğerleri 1×→32×', 'Core 1× · others 1×→32×')),
    ].join('');

    const host = $('#faction-body');
    for (const b of sim.breakdown) {
      const tabBtn = host?.querySelector(`[data-fac-ub="${cssEsc(b.branch)}"]`);
      if (tabBtn) tabBtn.textContent = `${b.branch}${b.respectCost ? ` (${b.multiplier}×)` : ''}`;
      const card = host?.querySelector(`[data-fac-branch="${cssEsc(b.branch)}"]`);
      if (!card) continue;
      const chip = card.querySelector('[data-fac-bchip]');
      if (chip) chip.innerHTML = b.isCore ? '<span class="chip dim">Core · 1×</span>' : b.baseCost > 0 ? `<span class="chip tq">#${b.order} · ${b.multiplier}×</span>` : '<span class="chip dim">—</span>';
      const bcost = card.querySelector('[data-fac-bcost]');
      if (bcost) bcost.innerHTML = `${tr('Taban', 'Base')}: ${n0(b.baseCost)} · ${tr('Toplam', 'Total')}: <b class="mono">${n0(b.respectCost)}</b> respect`;
      for (const it of b.items) {
        const box = card.querySelector(`[data-fac-item="${cssEsc(it.key)}"]`);
        if (!box) continue;
        box.classList.toggle('on', it.level > 0);
        const curLv = u.currentLevels?.[it.key] || 0;
        const diff = it.level - curLv;
        const lvlEl = box.querySelector('[data-fac-lvl]');
        if (lvlEl) lvlEl.innerHTML = `${it.level} / ${it.maxLevel}${diff !== 0 ? ` <small class="${diff > 0 ? 'pos' : 'neg'}">(${diff > 0 ? '+' : ''}${diff})</small>` : ''}`;
        const icost = box.querySelector('[data-fac-icost]');
        if (icost) icost.textContent = n0(it.baseCost * b.multiplier);
      }
    }
    return true;
  }

  function preserveFocus(root, fn) {
    const ae = document.activeElement;
    const saved = ae && typeof root.contains === 'function' && root.contains(ae) ? {
      id: ae.id || null,
      upg: ae.dataset?.facUpg || null,
      start: typeof ae.selectionStart === 'number' ? ae.selectionStart : null,
      end: typeof ae.selectionEnd === 'number' ? ae.selectionEnd : null,
    } : null;
    fn();
    if (!saved || typeof root.querySelector !== 'function') return;
    const next = saved.id ? root.querySelector('#' + cssEsc(saved.id))
      : saved.upg ? root.querySelector(`[data-fac-upg="${cssEsc(saved.upg)}"]`)
      : null;
    if (!next) return;
    next.focus?.({ preventScroll: true });
    if (saved.start != null && typeof next.setSelectionRange === 'function') {
      try { next.setSelectionRange(saved.start, saved.end ?? saved.start); } catch {}
    }
  }

  /* ---------- N3: Faction Üyeler Tablosu + Satır İçi Çekmece + Kişisel Grafikler ---------- */
  // Battle stat provenance chip: [class, short mark] for verified / FFScouter estimate / rough rank estimate
  const BS_BADGE = { verified: ['green', '✓'], estimate: ['blue', '~'], rough: ['warn', '≈'] };
  function renderMemberSeriesSvg(ser) {
    if (!ser) return '';
    if (ser.metric === 'travel') {
      const trs = Array.isArray(ser.transitions) ? ser.transitions : [];
      if (!trs.length) {
        return `<div class="sub-text">${tr('Bu üye için henüz kaydedilmiş seyahat geçişi yok. Travel Radar açıkken geçişler otomatik birikir.', 'No travel transitions recorded for this member yet. Transitions accumulate automatically while Travel Radar runs.')}</div>`;
      }
      return `<div class="tbl-wrap"><table class="tbl compact">
        <thead><tr>
          <th>${tr('Gözlem Aralığı (TCT)', 'Observation Window (TCT)')}</th>
          <th>${tr('Geçiş', 'Transition')}</th>
          <th>${tr('Rota / Ülke', 'Route / Country')}</th>
        </tr></thead>
        <tbody>
          ${trs.slice(0, 12).map((t) => {
            const [cls] = TRAVEL_STATE[t.toState] || TRAVEL_STATE.unknown;
            // Country = where the leg goes (or comes from, when inbound); older entries may carry countryCode
            const route = travelRoute(t.toState, t.origin ?? (t.toState === 'inbound' ? t.countryCode : null), t.destination ?? (t.toState !== 'inbound' ? t.countryCode : null));
            return `<tr>
            <td class="mono">${isoWhen(t.seenFrom)} → ${isoWhen(t.seenTo)} TCT</td>
            <td><span class="chip ${cls}">${travelStateText(t.fromState)} → ${travelStateText(t.toState)}</span></td>
            <td>${route ? `<span lang="en">${esc(route)}</span>` : '<span class="muted">—</span>'}</td>
          </tr>`;
          }).join('')}
        </tbody>
      </table></div>`;
    }

    if (ser.totalOnlyRestricted) {
      return `<div class="alert warn">${tr(ser.notice[0], ser.notice[1])}</div>`;
    }
    const pts = Array.isArray(ser.points) ? ser.points : [];
    if (!pts.length) {
      return `<div class="sub-text">${tr('Bu metrik ve tarih aralığı için henüz veri noktası birikmedi.', 'No data points collected for this metric and date range yet.')}</div>`;
    }
    if (ser.singlePoint) {
      const p0 = pts[0];
      return `<div class="fac-single-pt">
        <div class="fac-single-val mono">${n0(p0.rawValue ?? p0.value)}</div>
        <div class="sub-text">${esc(tr(ser.notice[0], ser.notice[1]))} · ${tr('Kaynak', 'Source')}: <b>${esc(sourceText(p0.source))}</b> · ${isoWhen(p0.observedAt)} TCT</div>
      </div>`;
    }

    const W = 640, H = 155, padL = 52, padR = 14, padT = 14, padB = 24;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const minT = pts[0].at, maxT = Math.max(minT + 1, pts[pts.length - 1].at);
    const vals = pts.map((p) => Number(p.value) || 0);
    const minV = Math.min(...vals, ser.mode === 'gain' ? 0 : Infinity);
    const maxV = Math.max(...vals, minV + 1);
    const spanV = Math.max(1, maxV - minV);
    const xOf = (ms) => padL + ((ms - minT) / (maxT - minT)) * plotW;
    const yOf = (v) => padT + plotH - ((v - minV) / spanV) * plotH;

    const segPaths = (ser.segments || []).map((seg) => {
      if (seg.length < 2) return '';
      const d = seg.map((p, idx) => `${idx === 0 ? 'M' : 'L'}${xOf(p.at).toFixed(1)},${yOf(p.value).toFixed(1)}`).join(' ');
      return `<path d="${d}" class="fac-ser-line" fill="none"/>`;
    }).join('');

    const dots = pts.slice(-36).map((p) => {
      const x = xOf(p.at).toFixed(1), y = yOf(p.value).toFixed(1);
      const tip = `${sourceText(p.source)} · ${new Date(p.at).toISOString().slice(0, 10)} · ${n0(p.value)}`;
      return `<circle cx="${x}" cy="${y}" r="3" tabindex="0" class="fac-ser-dot" aria-label="${esc(tip)}"><title>${esc(tip)}</title></circle>`;
    }).join('');

    return `<svg class="fac-ser-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${tr('Üye kişisel gelişim grafiği', 'Member personal progression chart')}">
      <line x1="${padL}" y1="${padT}" x2="${padL + plotW}" y2="${padT}" class="fac-step-grid"/>
      <line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" class="fac-step-grid"/>
      <text x="${padL - 6}" y="${padT + 4}" text-anchor="end" class="fac-step-lbl"><title>${n0(maxV)}</title>${compact(maxV)}</text>
      <text x="${padL - 6}" y="${padT + plotH}" text-anchor="end" class="fac-step-lbl"><title>${n0(minV)}</title>${compact(minV)}</text>
      <text x="${padL}" y="${H - 5}" class="fac-step-lbl">${new Date(minT).toISOString().slice(0, 10)}</text>
      <text x="${padL + plotW}" y="${H - 5}" text-anchor="end" class="fac-step-lbl">${new Date(maxT).toISOString().slice(0, 10)}</text>
      ${segPaths}
      ${dots}
    </svg>`;
  }

  function renderMemberDrawer(row) {
    const ms = fac.memberSeries && fac.memberSeries.playerId === row.playerId ? fac.memberSeries : null;
    const ser = ms?.data || null;
    const bs = row.battleStats || {};
    const bsBadgeClass = BS_BADGE[bs.badge]?.[0] || 'dim';
    const subStats = fac.memMetric === 'battlestats'
      ? [['total', 'Total'], ['str', 'STR'], ['spd', 'SPD'], ['dex', 'DEX'], ['def', 'DEF']]
      : fac.memMetric === 'activity'
        ? [['timeplayed', tr('Oynama (dk)', 'Time (min)')], ['xanax', 'Xanax'], ['crimes', tr('Suç', 'Crimes')], ['oc', 'OC']]
        : [];

    return `<div class="fac-drawer" data-drawer-player="${row.playerId}">
      <div class="fac-drawer-head">
        <div>
          <h4>${esc(row.name)} <small class="muted">#${row.playerId} · Lv ${row.level} · ${esc(row.position)} · ${row.days} ${tr('gün', 'days')}</small></h4>
          <span class="sub-text">
            <span class="chip ${bsBadgeClass}">${esc(tr(bs.label?.[0] || 'Geçmiş birikiyor', bs.label?.[1] || 'Accumulating history'))}</span>
            ${bs.total != null ? ` · ${tr('Toplam BS', 'Total BS')}: <b class="mono">${n0(bs.total)}</b>` : ''}
            ${bs.totalOnly ? ` · <span class="muted">${tr('Alt statlar (STR/SPD/DEX/DEF) tahminden bölünmez', 'Sub-stats are never split from an estimate')}</span>` : ''}
          </span>
        </div>
        <div class="fac-drawer-actions">
          <a class="btn sm ghost" href="${profile(row.playerId)}">↗ ${tr('Torn Profili', 'Torn Profile')}</a>
          <button type="button" class="btn sm ghost" data-fac-close-drawer="${row.playerId}">✕ ${tr('Kapat', 'Close')}</button>
        </div>
      </div>
      <div class="fac-drawer-controls">
        <div class="btn-group" role="tablist">
          ${[['battlestats', '⚔ Battle Stats', '⚔ Battle Stats'], ['activity', '📊 Aktivite', '📊 Activity'], ['contribution', '🏋️ Gym Katkısı', '🏋️ Gym Contribution'], ['travel', '✈ Seyahat Geçişleri', '✈ Travel Transitions']].map(([k, trL, enL]) => `<button type="button" class="pill sm ${fac.memMetric === k ? 'active' : ''}" data-mem-metric="${k}">${tr(trL, enL)}</button>`).join('')}
        </div>
        ${subStats.length ? `<div class="btn-group">
          ${subStats.map(([k, lbl]) => `<button type="button" class="pill sm ${fac.memStat === k ? 'active' : ''}" data-mem-stat="${k}">${lbl}</button>`).join('')}
        </div>` : ''}
        ${fac.memMetric !== 'travel' ? `
          <div class="btn-group">
            <button type="button" class="pill sm ${fac.memMode === 'value' ? 'active' : ''}" data-mem-mode="value">${tr('Değer', 'Value')}</button>
            <button type="button" class="pill sm ${fac.memMode === 'gain' ? 'active' : ''}" data-mem-mode="gain">${tr('Artış', 'Gain')}</button>
          </div>
          <div class="btn-group">
            ${[['7d', '7g', '7d'], ['30d', '30g', '30d'], ['90d', '90g', '90d'], ['6m', '6a', '6m'], ['1y', '1y', '1y'], ['2y', '2y', '2y'], ['all', 'Tümü', 'All']].map(([k, trL, enL]) => `<button type="button" class="pill sm ${fac.memRange === k ? 'active' : ''}" data-mem-range="${k}">${tr(trL, enL)}</button>`).join('')}
          </div>` : ''}
      </div>
      ${ms?.loading ? loadingBox() : ms?.error ? errorBox(ms.error) : ser ? `
        ${ser.metric !== 'travel' ? `<div class="fac-drawer-kpis">
          <span class="chip">${tr('Son değer', 'Latest')}: <b class="mono">${ser.latestValue != null ? n0(ser.latestValue) : '—'}</b></span>
          <span class="chip">${tr('Dönem değişimi', 'Period change')}: <b class="mono ${(ser.totalGain || 0) >= 0 ? 'pos' : 'neg'}">${ser.totalGain != null ? `${ser.totalGain >= 0 ? '+' : ''}${n0(ser.totalGain)}` : '—'}</b></span>
          <span class="chip" title="${tr('Yalnızca aynı kaynaktan karşılaştırılabilir iki nokta ve gerçek süre farkı varsa hesaplanır', 'Calculated only between two comparable points from the same source and real elapsed time')}">${tr('Günlük ort.', 'Daily avg')}: <b class="mono">${ser.dailyAverage != null ? `${ser.dailyAverage >= 0 ? '+' : ''}${n0(Math.round(ser.dailyAverage))}${tr('/gün', '/day')}` : '—'}</b></span>
          <span class="chip dim">${tr('Nokta / Segment', 'Points / Segments')}: <b class="mono">${ser.points?.length || 0} / ${ser.segments?.length || 0}</b></span>
        </div>` : ''}
        ${renderMemberSeriesSvg(ser)}
      ` : ''}
    </div>`;
  }

  function renderMembersTab() {
    const gate = wsGate(); if (gate) return gate;
    const mt = fac.ws.membersTable || { rows: [], columns: [] };
    const cols = fac.memCols;
    const q = fac.memQ.trim().toLowerCase();
    let list = (mt.rows || []).filter((m) => {
      if (q && !m.name.toLowerCase().includes(q) && !m.position.toLowerCase().includes(q) && !String(m.playerId).includes(q)) return false;
      if (fac.memFilter === 'online' && m.activityStatus !== 'online') return false;
      if (fac.memFilter === 'idle' && m.activityStatus !== 'idle') return false;
      if (fac.memFilter === 'offline' && m.activityStatus !== 'offline') return false;
      if (fac.memFilter === 'away' && m.gameState === 'Okay') return false;
      return true;
    });
    const sorters = {
      last: (a, b) => b.lastActionTs - a.lastActionTs,
      level: (a, b) => b.level - a.level || b.days - a.days,
      days: (a, b) => b.days - a.days || b.level - a.level,
      bs: (a, b) => (b.battleStats?.total || 0) - (a.battleStats?.total || 0),
      activity: (a, b) => (b.activity7d || 0) - (a.activity7d || 0),
    };
    list.sort(sorters[fac.memSort] || sorters.last);

    // 7d / 30d columns name the days the stored history really covers (coverage from the members section)
    const cov = fac.ws.coverage || {};
    const w7 = windowText(7, cov.d7), w30 = windowText(30, cov.d30);
    const g7 = windowText(7, gymCoverage(cov.d7)), g30 = windowText(30, gymCoverage(cov.d30));
    const wsAt = Number(fac.ws.at) || 0;
    const etaElapsed = wsAt ? Math.max(0, Math.round((Date.now() - wsAt) / 1000)) : 0;
    const optCols = [
      ['battlestats', tr('Battle Stats', 'Battle Stats')],
      ['oc', 'OC'],
      ['activity7d', tr('7g Aktivite', '7d Activity')],
      ['xanax7d', tr('7g Xanax', '7d Xanax')],
      ['gym7d', tr('7g Gym', '7d Gym')],
      ['activity30d', tr('30g Aktivite', '30d Activity')],
      ['xanax30d', tr('30g Xanax', '30d Xanax')],
      ['gym30d', tr('30g Gym', '30d Gym')],
    ];
    const colCount = 7 + optCols.filter(([k]) => cols.has(k)).length;

    const renderRestrictedOrVal = (field, fmt = n0) => {
      if (!field) return '<span class="muted">—</span>';
      if (field.status !== 'ok') {
        const cls = field.status === 'permission_required' ? 'warn' : 'dim';
        return `<span class="chip ${cls}">${esc(tr(field.label[0], field.label[1]))}</span>`;
      }
      return `<span class="mono">${fmt(field.value)}</span>`;
    };

    return `<article class="glass card">
      ${renderFreshnessBar(fac.ws, 'fac-ws-refresh', false)}
      <div class="card-head wrap">
        <div>
          <h3>👥 ${tr('Faction Üyeleri & Kişisel Grafikler', 'Faction Members & Personal Charts')} <span class="chip">${list.length}/${mt.rows?.length || 0}</span></h3>
          <span class="muted">${tr('Paylaşılan roster önbelleğinden sıfır ek üye sorgusuyla yüklenir · Satıra tıklayarak veya Enter/Space ile kişisel grafik çekmecesini aç', 'Loaded from shared roster cache with zero extra per-member queries · Click any row or press Enter/Space to open personal charts')}</span>
        </div>
        <div class="fac-col-picker">
          <span class="muted">${tr('Sütunlar:', 'Columns:')}</span>
          ${optCols.map(([k, lbl]) => `<button type="button" class="pill sm ${cols.has(k) ? 'active' : ''}" data-fac-mcol="${k}">${lbl}</button>`).join('')}
        </div>
      </div>
      <div class="fac-toolbar">
        <input class="input sm" id="fac-mem-q" type="search" placeholder="${tr('Üye, pozisyon veya ID ara…', 'Search member, position or ID…')}" value="${esc(fac.memQ)}">
        <div class="btn-group" role="group" aria-label="${esc(tr('Durum filtresi', 'Status filter'))}">
          ${[['all', tr('Tümü', 'All')], ['online', tr('Çevrimiçi', 'Online')], ['idle', tr('Beklemede', 'Idle')], ['offline', tr('Çevrimdışı', 'Offline')], ['away', tr('Uzaktakiler', 'Away')]].map(([k, lbl]) => `<button type="button" class="pill sm${fac.memFilter === k ? ' active' : ''}" aria-pressed="${fac.memFilter === k}" data-fac-mf="${k}">${lbl}</button>`).join('')}
        </div>
        <select id="fac-mem-sort" aria-label="${esc(tr('Sıralama', 'Sort'))}">
          <option value="last"${fac.memSort === 'last' ? ' selected' : ''}>${tr('Son görülme', 'Last seen')}</option>
          <option value="level"${fac.memSort === 'level' ? ' selected' : ''}>${tr('Seviye', 'Level')}</option>
          <option value="days"${fac.memSort === 'days' ? ' selected' : ''}>${tr('Faction günü', 'Days in faction')}</option>
          <option value="bs"${fac.memSort === 'bs' ? ' selected' : ''}>Battle Stats</option>
          <option value="activity"${fac.memSort === 'activity' ? ' selected' : ''}>${tr('7g Aktivite', '7d Activity')}</option>
        </select>
      </div>
      <div class="tbl-wrap fac-mem-wrap"><table class="tbl compact fac-mem-tbl">
        <thead><tr>
          <th></th>
          <th>${tr('Üye', 'Member')}</th>
          <th class="num">Lv</th>
          <th>${tr('Pozisyon', 'Position')}</th>
          <th class="num">${tr('Gün', 'Days')}</th>
          <th>${tr('Durum & Seyahat', 'Status & Travel')}</th>
          <th class="num">${tr('Son Görülme', 'Last Seen')}</th>
          ${cols.has('battlestats') ? `<th class="num">Battle Stats</th>` : ''}
          ${cols.has('oc') ? `<th>OC</th>` : ''}
          ${cols.has('activity7d') ? `<th class="num">${w7} ${tr('Süre', 'Time')}</th>` : ''}
          ${cols.has('xanax7d') ? `<th class="num">${w7} Xanax</th>` : ''}
          ${cols.has('gym7d') ? `<th class="num">${g7} Gym E</th>` : ''}
          ${cols.has('activity30d') ? `<th class="num">${w30} ${tr('Süre', 'Time')}</th>` : ''}
          ${cols.has('xanax30d') ? `<th class="num">${w30} Xanax</th>` : ''}
          ${cols.has('gym30d') ? `<th class="num">${g30} Gym E</th>` : ''}
        </tr></thead>
        <tbody>
          ${list.map((m) => {
            const isOpen = fac.openMemberId === m.playerId;
            const dotCls = m.activityStatus === 'online' ? 'pos' : m.activityStatus === 'idle' ? 'warn' : 'muted';
            const bs = m.battleStats || {};
            const bsLabel = tr(bs.label?.[0] || 'Birikiyor', bs.label?.[1] || 'Accumulating');
            const [bsCls, bsMark] = BS_BADGE[bs.badge] || BS_BADGE.estimate;
            const bsCell = bs.total != null
              ? `<span class="mono">${n0(bs.total)}</span> <span class="chip ${bsCls}" title="${esc(bsLabel)}" aria-label="${esc(bsLabel)}">${bsMark}</span>`
              : `<span class="chip dim">${esc(bsLabel)}</span>`;
            const tv = m.travel;
            const tvCountry = tv ? (tv.countryCode ? countryName(tv.countryCode) : tv.country || '') : '';
            // etaSec counts down from the moment the server built the reply (ws.at); an estimate ends its window
            const tvLeft = !tv ? null
              : tv.etaSec != null ? Number(tv.etaSec) - etaElapsed
                : tv.etaAt ? Math.round((Date.parse(tv.etaAt) - Date.now()) / 1000) : null;
            const tvEta = tvLeft != null && tvLeft > 0 ? ` (${tv.etaSource === 'estimate' ? '~' : ''}${human(tvLeft)})` : '';
            const travelTag = tvCountry
              ? ` · <span class="chip blue" title="${esc(travelStateText(tv.state))}">✈ <span lang="en">${esc(tvCountry)}</span>${tvEta}</span>`
              : '';
            const mainTr = `<tr class="fac-mem-row ${isOpen ? 'is-open' : ''}" data-fac-member-row="${m.playerId}" tabindex="0" role="button" aria-expanded="${isOpen}">
              <td class="fac-exp-cell"><button type="button" class="btn sm ghost fac-exp-btn" data-fac-member-btn="${m.playerId}" aria-expanded="${isOpen}" aria-label="${esc(m.name)}">${isOpen ? '▾' : '▸'}</button></td>
              <td><span class="${dotCls}">●</span> <b>${esc(m.name)}</b> <a class="fac-prof-ext" href="${profile(m.playerId)}" title="${tr('Torn profilini aç', 'Open Torn profile')}">↗</a></td>
              <td class="num mono">${m.level}</td>
              <td>${esc(m.position)}</td>
              <td class="num mono">${m.days}</td>
              <td><span class="chip ${m.gameState === 'Okay' ? 'green' : m.gameState === 'Hospital' ? 'danger' : 'warn'}">${stateText(m.gameState)}</span>${travelTag}</td>
              <td class="num muted">${lastSeen(m.lastActionTs, m.lastActionRel)}</td>
              ${cols.has('battlestats') ? `<td class="num">${bsCell}</td>` : ''}
              ${cols.has('oc') ? `<td>${m.inOc ? `<span class="chip green">OC</span>` : `<span class="muted">—</span>`}</td>` : ''}
              ${cols.has('activity7d') ? `<td class="num">${renderRestrictedOrVal(m.restricted?.activity, hms)}</td>` : ''}
              ${cols.has('xanax7d') ? `<td class="num">${renderRestrictedOrVal(m.restricted?.xanax, n0)}</td>` : ''}
              ${cols.has('gym7d') ? `<td class="num">${renderRestrictedOrVal(m.restricted?.gym, n0)}</td>` : ''}
              ${cols.has('activity30d') ? `<td class="num">${renderRestrictedOrVal(m.restricted?.activity30d, hms)}</td>` : ''}
              ${cols.has('xanax30d') ? `<td class="num">${renderRestrictedOrVal(m.restricted?.xanax30d, n0)}</td>` : ''}
              ${cols.has('gym30d') ? `<td class="num">${renderRestrictedOrVal(m.restricted?.gym30d, n0)}</td>` : ''}
            </tr>`;
            const drawerTr = isOpen ? `<tr class="fac-drawer-tr"><td colspan="${colCount}">${renderMemberDrawer(m)}</td></tr>` : '';
            return mainTr + drawerTr;
          }).join('')}
        </tbody>
      </table></div>
    </article>`;
  }

  /* ---------- N4: Stats, Faction Gym, Banka, Recruitment, Transfers, Alliance & Graffiti ---------- */
  function renderWorkspaceStatusBar(sourceLabelTr, sourceLabelEn) {
    const a = fac.d?.access || {};
    const role = a.role ? tr(...ROLE_TR[a.role]) : a.allowed ? tr('Yetkili', 'Officer') : tr('Üye', 'Member');
    // Counted from the observation time, so the 60 s re-render advances it between fetches
    const f = fac.ws?.freshness;
    const ageSec = ageSince(f?.observedAt, f?.ageSec ?? null);
    const age = ageSec != null ? ageText(ageSec) : '—';
    return `<div class="fac-ws-status">
      <span><b>${tr('Kaynak', 'Source')}:</b> ${tr(sourceLabelTr, sourceLabelEn)}</span>
      <span><b>${tr('Veri yaşı', 'Data age')}:</b> ${age}</span>
      <span><b>${tr('Rol', 'Role')}:</b> ${role}</span>
      <button type="button" class="btn sm ghost" id="fac-ws-refresh">⟳ ${tr('Yenile', 'Refresh')}</button>
    </div>`;
  }

  function renderStatsTab() {
    const gate = wsGate(); if (gate) return gate;
    const sv = fac.ws.statsView || {};
    const ar = sv.activeRate || {};
    const metric = fac.wsMetric || 'activity';
    const span = sv.windowDays || fac.wsDays;
    // A 30d/90d window built from fewer days of snapshots is labelled with the days it really covers
    const cov = sv.coverage || window.LRXFactionWorkspace?.statsCoverage?.(span, sv.range) || null;
    const spanTxt = windowText(span, cov);
    const rows = [...(sv.rows || [])].filter((r) => !fac.wsTenure || r.tenureEligible);
    rows.sort((a, b) => (Number(b[metric]) || -1) - (Number(a[metric]) || -1));

    return `<article class="glass card">
      ${renderWorkspaceStatusBar('Torn API personalstats + roster önbelleği', 'Torn API personalstats + roster cache')}
      <div class="card-head wrap">
        <div>
          <h3>📈 ${tr('Faction Stats & Dönem Değişimi', 'Faction Stats & Period Deltas')}</h3>
          <span class="muted">${tr('Yeni katılan üyelerin önceki faction toplamları, üyelik süresi filtresi açıkken bu faction dönem artışına yazılmaz', 'Prior-faction totals of newly joined members are excluded from period gains when the tenure filter is active')}</span>
        </div>
        <div class="fac-drawer-controls">
          <div class="btn-group">
            ${[7, 30, 90].map((d) => `<button type="button" class="pill sm ${fac.wsDays === d ? 'active' : ''}" data-fac-ws-days="${d}">${d}${tr('g', 'd')}</button>`).join('')}
          </div>
          <button type="button" class="pill sm ${fac.wsTenure ? 'active' : ''}" id="fac-ws-tenure">
            🛡 ${fac.wsTenure
              ? (ar.filterLabel ? `${tr('Filtre açık', 'Filter ON')}: ${esc(tr(ar.filterLabel[0], ar.filterLabel[1]))}` : tr(`Üyelik ≥ ${fac.wsDays}g filtresi açık`, `Tenure ≥ ${fac.wsDays}d filter ON`))
              : tr('Tüm üyeler (filtre kapalı)', 'All members (filter OFF)')}
          </button>
          <button type="button" class="btn sm ghost" id="fac-rep-refresh">⟳ ${tr('Snapshot Topla', 'Collect Snapshots')}</button>
        </div>
      </div>
      <div class="grid kpis">
        <div class="glass kpi">
          <div class="label">${tr('Aktiflik Oranı', 'Active Rate')} (${spanTxt})</div>
          <div class="value tq">${ar.pct != null ? tr(`%${ar.pct}`, `${ar.pct}%`) : '—'}</div>
          <div class="hint">${tr('Payda', 'Denominator')}: <b>${ar.numerator || 0} / ${ar.denominator || 0}</b> ${tr('ölçülen', 'measured')} (${tr('Toplam', 'Total')}: ${ar.totalMembers || 0}${ar.excludedNewMembers ? `, ${ar.excludedNewMembers} ${tr('yeni üye hariç', 'new excluded')}` : ''})</div>
        </div>
        <div class="glass kpi">
          <div class="label">${tr('Toplam Oynama Süresi', 'Total Time Played')} (${spanTxt})</div>
          <div class="value mono">${hms(sv.totals?.activity || 0)}</div>
          <div class="hint">${sv.range?.from ? `${dayLabel(sv.range.from)} → ${dayLabel(sv.range.to)}${cov && !cov.complete ? ` · ${tr(`${cov.actualDays} günlük kayıt var, ${span} gün birikiyor`, `${cov.actualDays} of ${span} days recorded so far`)}` : ''}` : tr('Snapshot bekleniyor', 'Waiting for snapshots')}</div>
        </div>
        <div class="glass kpi">
          <div class="label">${tr('Toplam Xanax / Gym E', 'Total Xanax / Gym E')} (${spanTxt})</div>
          <div class="value mono">${n0(sv.totals?.xanax || 0)} <small class="muted">/ ${n0(sv.totals?.gym || 0)}</small></div>
          <div class="hint">${tr('Suç', 'Crimes')}: ${n0(sv.totals?.crimes || 0)} · OC: ${n0(sv.totals?.oc || 0)}</div>
        </div>
      </div>
      <div class="fac-toolbar">
        <span class="muted">${tr('Sıralama metriği:', 'Sort metric:')}</span>
        <div class="btn-group">
          ${[['activity', tr('Aktivite', 'Activity')], ['xanax', 'Xanax'], ['gym', 'Gym E'], ['crimes', tr('Suç', 'Crimes')], ['oc', 'OC']].map(([k, lbl]) => `<button type="button" class="pill sm ${metric === k ? 'active' : ''}" data-fac-ws-metric="${k}">${lbl}</button>`).join('')}
        </div>
      </div>
      <div class="tbl-wrap"><table class="tbl compact">
        <thead><tr>
          <th>#</th>
          <th>${tr('Üye (Tıkla → Kişisel Grafik)', 'Member (Click → Personal Chart)')}</th>
          <th class="num">Lv</th>
          <th class="num">${tr('Üyelik Günü', 'Tenure Days')}</th>
          <th class="num">${tr('Oynama Süresi', 'Time Played')}</th>
          <th class="num">Xanax</th>
          <th class="num">Gym E</th>
          <th class="num">${tr('Suç', 'Crimes')}</th>
          <th class="num">OC</th>
        </tr></thead>
        <tbody>
          ${rows.map((r, i) => `<tr class="fac-stats-row" data-open-member="${r.id}" tabindex="0" role="button">
            <td class="mono muted">${i + 1}</td>
            <td><b>${esc(r.name)}</b> <a class="fac-prof-ext" href="${profile(r.id)}">↗</a></td>
            <td class="num mono">${r.level}</td>
            <td class="num mono">${r.days}</td>
            <td class="num mono">${r.activity != null ? hms(r.activity) : '—'}</td>
            <td class="num mono">${r.xanax != null ? n0(r.xanax) : '—'}</td>
            <td class="num mono">${r.gym != null ? n0(r.gym) : '—'}</td>
            <td class="num mono">${r.crimes != null ? n0(r.crimes) : '—'}</td>
            <td class="num mono">${r.oc != null ? n0(r.oc) : '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>
    </article>`;
  }

  function renderGymTab() {
    const gate = wsGate(); if (gate) return gate;
    const gv = fac.ws.gymView || {};
    const rows = gv.rows || [];
    return `<article class="glass card">
      ${renderWorkspaceStatusBar('Torn API v2/faction/contributors (stat=gymenergy)', 'Torn API v2/faction/contributors (stat=gymenergy)')}
      <div class="card-head wrap">
        <div>
          <h3>🏋️ ${tr('Faction Gym Enerjisi Katkısı', 'Faction Gym Energy Contribution')}</h3>
          <span class="muted">${gv.from && gv.to ? `${dayLabel(gv.from)} → ${dayLabel(gv.to)} (${gv.actualDays} ${tr('gün', 'days')})` : tr('Doğrulanmış contributors anlık görüntüsü', 'Verified contributors snapshot')}</span>
        </div>
        <div class="btn-group">
          ${[7, 30, 90].map((d) => `<button type="button" class="pill sm ${fac.wsDays === d ? 'active' : ''}" data-fac-ws-days="${d}">${d}${tr('g', 'd')}</button>`).join('')}
        </div>
      </div>
      <div class="grid kpis">
        ${kpi(tr('Toplam Dönem Gym E', 'Total Period Gym E'), n0(gv.totalGain || 0), `${gv.contributorCount || 0} ${tr('katkı yapan üye', 'contributing members')}`, 'tq-text')}
        ${kpi(tr('Mevcut Toplam Havuz', 'Current Total Pool'), n0(gv.totalCurrent || 0), tr('Doğrulanmış contributors toplamı', 'Verified contributors sum'))}
      </div>
      ${rows.length ? `<div class="tbl-wrap"><table class="tbl compact">
        <thead><tr>
          <th>#</th>
          <th>${tr('Üye', 'Member')}</th>
          <th>${tr('Pozisyon', 'Position')}</th>
          <th class="num">${tr('Dönem Artışı', 'Period Gain')}</th>
          <th class="num">${tr('Toplam Katkı', 'Total Contribution')}</th>
          <th class="num">${tr('Pay %', 'Share %')}</th>
        </tr></thead>
        <tbody>
          ${rows.slice(0, 100).map((r, idx) => `<tr class="fac-stats-row" data-open-member="${r.playerId}" data-open-metric="contribution" tabindex="0" role="button">
            <td class="mono muted">${idx + 1}</td>
            <td><b>${esc(r.name)}</b> <a class="fac-prof-ext" href="${profile(r.playerId)}">↗</a></td>
            <td>${esc(r.position)}</td>
            <td class="num mono pos">${r.periodGain != null ? `+${n0(r.periodGain)}` : '—'}</td>
            <td class="num mono">${r.currentTotal != null ? n0(r.currentTotal) : '—'}</td>
            <td class="num mono">${r.sharePct != null ? tr(`%${r.sharePct}`, `${r.sharePct}%`) : '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>` : emptyBox(tr('Henüz Gym katkısı kaydı yok', 'No Gym contribution records yet'), tr('OC & Özet veya Stats sekmesinden Snapshot Topla düğmesine basarak ilk kaydı oluşturabilirsin.', 'Click Collect Snapshots on OC & Overview or Stats tab to record the initial snapshot.'))}
    </article>`;
  }

  function renderBankTab() {
    const gate = wsGate(); if (gate) return gate;
    const b = fac.ws.bank || {};
    return `<article class="glass card">
      ${renderWorkspaceStatusBar('Torn API faction/donations (Salt Okunur)', 'Torn API faction/donations (Read-Only)')}
      <div class="card-head wrap">
        <div>
          <h3>🏦 ${tr('Faction Banka & Üye Bakiyeleri', 'Faction Bank & Member Balances')}</h3>
          <span class="muted">${tr('Salt okunur bakiye görünümü · Ödeme ve gönderim işlemleri yalnızca Torn Faction Bank sayfasında yapılır', 'Read-only balance view · Payouts and transfers are performed exclusively on Torn Faction Bank')}</span>
        </div>
        <button type="button" class="btn sm ghost" data-open-url="${esc(b.tornBankUrl || 'https://www.torn.com/factions.php?step=your#/tab=controls')}" data-tab-label="Faction Bank">↗ ${tr('Torn Faction Bank\'ta Aç', 'Open Torn Faction Bank')}</button>
      </div>
      ${b.status === 'not_in_faction' ? notInFactionBox(b)
        : b.status === 'error'
          ? `<div class="alert danger">${esc(b.error || tr('Banka bakiyeleri okunamadı.', 'Could not read the bank balances.'))}</div>`
        : !b.allowed || b.status === 'permission_required'
          ? `<div class="alert warn">🔒 ${tr('İzin gerekli: Faction Banka bakiyelerini görmek için pozisyonunda "Faction API Access" yetkisi bulunmalıdır.', 'Permission required: Your faction position needs "Faction API Access" to view Faction Bank balances.')}</div>`
        : b.status === 'idle' ? (fac.wsErr ? errorBox(fac.wsErr) : loadingBox())
          : `
            <div class="grid kpis">
              ${kpi(tr('Toplam Nakit Bakiyesi', 'Total Money Balance'), money(b.totals?.money || 0), `${b.rows?.length || 0} ${tr('kayıtlı hesap', 'recorded accounts')}`, 'pos')}
              ${kpi(tr('Toplam Puan Bakiyesi', 'Total Points Balance'), n0(b.totals?.points || 0))}
              ${kpi(tr('Eksi Bakiyeli Üye', 'Negative Balance'), String(b.totals?.debtors || 0), '', (b.totals?.debtors || 0) > 0 ? 'neg' : '')}
            </div>
            <div class="tbl-wrap"><table class="tbl compact">
              <thead><tr>
                <th>${tr('Üye', 'Member')}</th>
                <th>${tr('Pozisyon', 'Position')}</th>
                <th class="num">${tr('Nakit Bakiyesi', 'Money Balance')}</th>
                <th class="num">${tr('Puan Bakiyesi', 'Points Balance')}</th>
              </tr></thead>
              <tbody>
                ${(b.rows || []).slice(0, 100).map((r) => `<tr>
                  <td>${nameBtn(r.id, r.name)} ${!r.inFaction ? `<span class="chip dim">${tr('Ayrıldı', 'Former')}</span>` : ''}</td>
                  <td>${esc(r.position || '—')}</td>
                  <td class="num mono ${r.money > 0 ? 'pos' : r.money < 0 ? 'neg' : ''}">${money(r.money)}</td>
                  <td class="num mono">${n0(r.points)}</td>
                </tr>`).join('')}
              </tbody>
            </table></div>`}
    </article>`;
  }

  function renderRecruitmentTab() {
    const gate = wsGate(); if (gate) return gate;
    const rec = fac.ws.recruitment || {};
    const apps = rec.applications || [];
    const wl = rec.watchlist || [];
    const dr = fac.drafts.wl;
    return `<article class="glass card">
      ${renderWorkspaceStatusBar('Torn API v2/faction/applications + LRX Yerel Aday Listesi', 'Torn API v2/faction/applications + LRX Local Watchlist')}
      <div class="card-head wrap">
        <div>
          <h3>📋 ${tr('Faction Başvuruları (Torn API)', 'Faction Applications (Torn API)')} <span class="chip">${apps.length}</span></h3>
          <span class="muted">${tr('Aktif başvurular salt okunur listelenir; kabul/ret işlemi Torn üzerinden yapılır', 'Active applications are listed read-only; accept/decline on Torn')}</span>
        </div>
      </div>
      ${rec.status === 'not_in_faction' ? notInFactionBox(rec)
        : rec.status === 'error'
          ? `<div class="alert danger">${esc(rec.error || tr('Başvurular okunamadı.', 'Could not read the applications.'))}</div>`
        : !rec.allowed || rec.status === 'permission_required'
          ? `<div class="alert warn">🔒 ${tr('İzin gerekli: Aktif başvuruları okumak için pozisyonunda "Faction API Access" yetkisi gerekir. Alt kısımdaki Aday İzleme Listesini yerel olarak kullanabilirsin.', 'Permission required: "Faction API Access" is required to read active applications. You can still use the local Recruitment Watchlist below.')}</div>`
        : rec.status === 'idle' ? (fac.wsErr ? errorBox(fac.wsErr) : loadingBox())
        : apps.length ? `<div class="tbl-wrap"><table class="tbl compact">
          <thead><tr>
            <th>${tr('Aday', 'Applicant')}</th>
            <th class="num">Lv</th>
            <th>${tr('Mesaj', 'Message')}</th>
            <th>${tr('Durum', 'Status')}</th>
          </tr></thead>
          <tbody>
            ${apps.map((a) => `<tr>
              <td>${nameBtn(a.playerId, a.name)}</td>
              <td class="num mono">${a.level}</td>
              <td>${esc(a.message || '—')}</td>
              <td><span class="chip blue">${!a.status || a.status === 'active' ? tr('Aktif', 'Active') : esc(a.status)}</span></td>
            </tr>`).join('')}
          </tbody>
        </table></div>` : `<div class="sub-text">${tr('Şu anda bekleyen faction başvurusu yok.', 'No pending faction applications right now.')}</div>`}
    </article>
    <article class="glass card">
      <div class="card-head wrap">
        <div>
          <h3>🔭 ${tr('Aday İzleme Listesi', 'Recruitment Candidate Watchlist')} <span class="chip">${wl.length}</span></h3>
          <span class="muted">${tr('Takip ettiğin adaylar ve notların yalnızca bu bilgisayarda saklanır; faction\'ın diğer üyeleriyle paylaşılmaz.', 'Candidates and notes you track are stored only on this computer; they are not shared with the rest of the faction.')}</span>
        </div>
      </div>
      <div class="fac-form-row">
        <input class="input sm mono" id="fac-wl-id" type="number" min="1" placeholder="${tr('Oyuncu ID', 'Player ID')}" value="${esc(dr.id)}">
        <input class="input sm" id="fac-wl-name" maxlength="60" placeholder="${tr('Oyuncu adı', 'Player name')}" value="${esc(dr.name)}">
        <input class="input sm" id="fac-wl-tag" maxlength="32" placeholder="${tr('Etiket (ör. Davet edildi)', 'Tag (e.g. Invited)')}" value="${esc(dr.tag)}">
        <input class="input sm" id="fac-wl-note" maxlength="280" placeholder="${tr('Not…', 'Note…')}" value="${esc(dr.note)}">
        <button type="button" class="btn sm primary" id="fac-wl-add">+ ${tr('Aday Ekle', 'Add Candidate')}</button>
      </div>
      ${wl.length ? `<div class="tbl-wrap"><table class="tbl compact">
        <thead><tr>
          <th>${tr('Oyuncu', 'Player')}</th>
          <th>${tr('Etiket', 'Tag')}</th>
          <th>${tr('Not', 'Note')}</th>
          <th>${tr('Ekleyen / Zaman', 'Added By / Time')}</th>
          <th></th>
        </tr></thead>
        <tbody>
          ${wl.map((w) => `<tr>
            <td>${w.playerId ? nameBtn(w.playerId, w.name) : `<b>${esc(w.name)}</b>`}</td>
            <td><span class="chip blue">${esc(wlTagText(w.tag))}</span></td>
            <td>${esc(w.note || '—')}</td>
            <td class="sub-text">${esc(authorText(w.authorName))} · ${isoWhen(w.updatedAt)} TCT</td>
            <td class="num"><button type="button" class="btn sm ghost" data-fac-wl-del="${esc(w.id)}" aria-label="${esc(tr('Listeden çıkar', 'Remove from list'))}">✕</button></td>
          </tr>`).join('')}
        </tbody>
      </table></div>` : `<div class="sub-text">${tr('İzleme listesinde henüz aday yok.', 'No candidates in the watchlist yet.')}</div>`}
    </article>`;
  }

  function renderTransfersTab() {
    const gate = wsGate(); if (gate) return gate;
    const entries = fac.ws.transfers?.entries || [];
    return `<article class="glass card">
      ${renderWorkspaceStatusBar('Torn API Roster Gözlem Farkı', 'Torn API Roster Observation Diff')}
      <div class="card-head wrap">
        <div>
          <h3>⇄ ${tr('Faction Transfers (Katılan & Ayrılan Üyeler)', 'Faction Transfers (Joined & Left Members)')} <span class="chip">${entries.length}</span></h3>
          <span class="muted">${tr('Her kayıt, değişikliğin fark edildiği iki roster gözlemi arasındaki aralığı gösterir; kesin bir saat uydurulmaz', 'Each entry shows the window between the two roster observations in which the change was detected; an exact time is never made up')}</span>
        </div>
      </div>
      ${entries.length ? `<div class="tbl-wrap"><table class="tbl compact">
        <thead><tr>
          <th>${tr('Tür', 'Type')}</th>
          <th>${tr('Üye', 'Member')}</th>
          <th class="num">Lv</th>
          <th>${tr('Pozisyon', 'Position')}</th>
          <th>${tr('Gözlem Aralığı (TCT)', 'Observation Window (TCT)')}</th>
        </tr></thead>
        <tbody>
          ${entries.map((t) => `<tr>
            <td><span class="chip ${t.type === 'joined' ? 'green' : 'warn'}">${t.type === 'joined' ? tr('+ Katıldı', '+ Joined') : tr('− Ayrıldı', '− Left')}</span></td>
            <td>${nameBtn(t.playerId, t.name)}</td>
            <td class="num mono">${t.level || '—'}</td>
            <td>${esc(t.position || '—')}</td>
            <td class="mono">${isoWhen(t.observation_interval?.seenFrom)} → ${isoWhen(t.observation_interval?.seenTo)} TCT <span class="chip dim">${tr('Gözlem aralığı', 'Obs. window')}</span></td>
          </tr>`).join('')}
        </tbody>
      </table></div>` : emptyBox(tr('Henüz katılan veya ayrılan üye gözlemlenmedi', 'No joined or left members observed yet'), tr('Roster yenilendikçe kadro değişimleri gözlem aralığıyla otomatik kaydedilir.', 'As the roster refreshes, membership changes are automatically recorded with their observation window.'))}
    </article>`;
  }

  function renderAllianceTab() {
    const gate = wsGate(); if (gate) return gate;
    const al = fac.ws.alliance?.alliances || [];
    const gf = fac.ws.alliance?.graffiti || [];
    const relLabel = {
      ally: ['green', tr('Müttefik', 'Ally')],
      family: ['tq', tr('Aile / Alt Faction', 'Family / Sub-Faction')],
      nap: ['blue', tr('Saldırmazlık (NAP)', 'Non-Aggression (NAP)')],
      rival: ['danger', tr('Rakip / Hedef', 'Rival / Hostile')],
    };
    const da = fac.drafts.al, dg = fac.drafts.gf;
    const relOpt = (v, label) => `<option value="${v}"${da.rel === v ? ' selected' : ''}>${label}</option>`;
    return `<article class="glass card">
      ${renderWorkspaceStatusBar('Yalnızca bu bilgisayardaki LRX kaydı (Torn API verisi değildir)', 'LRX record on this computer only (not Torn API data)')}
      <div class="alert info fac-local-note">💾 ${tr('İlişkiler ve graffiti notları yalnızca bu bilgisayarda saklanır. Faction\'ın diğer üyeleri bunları görmez; uygulama hiçbir yere göndermez.', 'Relations and graffiti notes are stored only on this computer. Other faction members do not see them; the app does not send them anywhere.')}</div>
      <div class="card-head wrap">
        <div>
          <h3>🤝 ${tr('Müttefik & Aile İlişkileri', 'Alliance & Family Relations')} <span class="chip">${al.length}</span></h3>
          <span class="muted">${tr('Müttefik, aile, NAP ve rakip faction notların (yalnızca bu bilgisayarda)', 'Your ally, family, NAP and rival faction notes (on this computer only)')}</span>
        </div>
      </div>
      <div class="fac-form-row">
        <input class="input sm" id="fac-al-name" maxlength="80" placeholder="${tr('Faction adı', 'Faction name')}" value="${esc(da.name)}">
        <input class="input sm mono" id="fac-al-tag" maxlength="16" placeholder="${tr('Etiket', 'Tag')}" value="${esc(da.tag)}">
        <input class="input sm mono" id="fac-al-id" type="number" min="1" placeholder="${tr('Faction ID', 'Faction ID')}" value="${esc(da.id)}">
        <select id="fac-al-rel" aria-label="${esc(tr('İlişki', 'Relation'))}">
          ${relOpt('ally', tr('Müttefik', 'Ally'))}
          ${relOpt('family', tr('Aile', 'Family'))}
          ${relOpt('nap', tr('Saldırmazlık (NAP)', 'NAP'))}
          ${relOpt('rival', tr('Rakip', 'Rival'))}
        </select>
        <input class="input sm" id="fac-al-note" maxlength="280" placeholder="${tr('Not…', 'Note…')}" value="${esc(da.note)}">
        <button type="button" class="btn sm primary" id="fac-al-add">+ ${tr('İlişki Ekle', 'Add Relation')}</button>
      </div>
      ${al.length ? `<div class="tbl-wrap"><table class="tbl compact">
        <thead><tr>
          <th>Faction</th>
          <th>${tr('İlişki', 'Relation')}</th>
          <th>${tr('Not', 'Note')}</th>
          <th>${tr('Kaydeden', 'Recorded By')}</th>
          <th></th>
        </tr></thead>
        <tbody>
          ${al.map((x) => {
            const [cls, lbl] = relLabel[x.relation] || relLabel.ally;
            return `<tr>
              <td><b>${esc(x.name)}</b> ${x.tag ? `<span class="mono muted">[${esc(x.tag)}]</span>` : ''}</td>
              <td><span class="chip ${cls}">${lbl}</span></td>
              <td>${esc(x.note || '—')}</td>
              <td class="sub-text">${esc(authorText(x.authorName))} · ${isoWhen(x.updatedAt)} TCT</td>
              <td class="num"><button type="button" class="btn sm ghost" data-fac-al-del="${esc(x.id)}" aria-label="${esc(tr('İlişkiyi sil', 'Delete relation'))}">✕</button></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table></div>` : `<div class="sub-text">${tr('Henüz kayıtlı alliance/family ilişkisi yok.', 'No alliance or family relations recorded yet.')}</div>`}
    </article>
    <article class="glass card">
      <div class="card-head wrap">
        <div>
          <h3>🎨 ${tr('Faction Graffiti & Not Defteri', 'Faction Graffiti & Notebook')} <span class="chip">${gf.length}</span></h3>
          <span class="muted">${tr('Yazar ve zaman damgalı chain / savaş / strateji notların (yalnızca bu bilgisayarda)', 'Your author- and time-stamped chain, war and strategy notes (on this computer only)')}</span>
        </div>
      </div>
      <div class="fac-form-row">
        <input class="input sm" id="fac-gf-cat" maxlength="32" placeholder="${tr('Kategori (ör. Chain, Savaş)', 'Category (e.g. Chain, War)')}" value="${esc(dg.cat)}">
        <input class="input sm" id="fac-gf-text" maxlength="500" placeholder="${tr('Graffiti veya faction notu yaz…', 'Write graffiti or faction note…')}" value="${esc(dg.text)}">
        <button type="button" class="btn sm primary" id="fac-gf-add">+ ${tr('Not Ekle', 'Add Note')}</button>
      </div>
      ${gf.length ? `<div class="fac-graffiti-grid">
        ${gf.map((g) => `<div class="glass fac-graffiti-card">
          <div class="fac-graffiti-top">
            <span class="chip tq">${esc(gfCatText(g.category))}</span>
            <button type="button" class="btn sm ghost" data-fac-gf-del="${esc(g.id)}" aria-label="${esc(tr('Notu sil', 'Delete note'))}">✕</button>
          </div>
          <p class="fac-graffiti-text">${esc(g.text)}</p>
          <div class="sub-text">✍ <b>${esc(authorText(g.authorName))}</b> · ${isoWhen(g.createdAt)} TCT</div>
        </div>`).join('')}
      </div>` : `<div class="sub-text">${tr('Henüz not yok.', 'No notes yet.')}</div>`}
    </article>`;
  }

  /* ---------- Ana Render ---------- */
  function render() {
    const el = $('#faction-body'); if (!el) return;
    if (state.view !== 'faction') return;
    const d = fac.d;
    if (!d) { el.innerHTML = fac.err ? errorBox(fac.err) : loadingBox(); return; }
    const a = d.access || {};
    if (a.error) { el.innerHTML = `${myOcCard(d.myOc)}<div class="alert danger">${esc(a.error)}</div>`; return; }
    const role = a.role ? tr(...ROLE_TR[a.role]) : a.allowed ? tr('Yetkili (Organised Crimes)', 'Authorized (Organised Crimes)') : tr('Üye', 'Member');
    const oc = d.oc && !d.oc.error ? d.oc : null;
    const delayed = oc ? oc.crimes.filter((c) => c.delayed).length : null;
    const kpis = a.inFaction ? `<div class="grid kpis">
      ${kpi('<span lang="en">Faction</span>', `${esc(a.faction?.name || '')} <small class="muted">[${esc(a.faction?.tag || '')}]</small>`, esc(a.position || ''))}
      ${kpi(tr('Erişim', 'Access'), role, '', a.allowed ? 'tq-text' : '')}
      ${oc ? kpi(tr('OC\'de', 'In an OC'), `${oc.totals.inOc} <small class="muted">/ ${oc.totals.members}</small>`, tr(`${oc.notInOc.length} üye OC dışında`, `${oc.notInOc.length} not in an OC`)) : kpi(tr('Üye sayısı', 'Members'), n0(a.members || 0))}
      ${oc ? kpi(tr('Geciken OC', 'Delayed OCs'), String(delayed), tr(`${oc.crimes.length} devam eden OC`, `${oc.crimes.length} ongoing`), delayed ? 'neg' : '') : ''}
    </div>` : '';

    const tab = activeTab();
    const tabs = visibleTabs();
    const tabBar = a.inFaction && tabs.length > 1
      ? `<nav class="set-tabs fac-tabs" role="tablist" aria-label="Faction">${tabs.map(([id, icon, label]) => `<button type="button" class="set-tab${id === tab ? ' active' : ''}" role="tab" aria-selected="${id === tab}" data-fac-tab="${id}">${icon} <span>${label}</span></button>`).join('')}</nav>`
      : '';

    let content = '';
    if (tab === 'oc') {
      content = myOcCard(d.myOc)
        + (!a.allowed ? lockedCard(a)
          : d.oc?.error ? `<div class="alert danger">${esc(d.oc.error)}</div>`
            : `${notInOcCard(oc)}${crimesCard(oc)}${reportCard()}`);
    } else if (tab === 'members') content = renderMembersTab();
    else if (tab === 'activity') content = renderActivityTab();
    else if (tab === 'radar') content = renderRadarTab();
    else if (tab === 'stats') content = renderStatsTab();
    else if (tab === 'gym') content = renderGymTab();
    else if (tab === 'bank') content = renderBankTab();
    else if (tab === 'recruitment') content = renderRecruitmentTab();
    else if (tab === 'transfers') content = renderTransfersTab();
    else if (tab === 'alliance') content = renderAllianceTab();
    else if (tab === 'armory') content = renderArmoryTab();
    else if (tab === 'chains') content = renderChainsTab();
    else if (tab === 'upgrades') content = renderUpgradesTab();

    preserveFocus(el, () => { el.innerHTML = kpis + tabBar + content; });
  }

  async function openFactionTab(tabId = 'oc', opts = {}) {
    if (!feat('page.faction')) return;
    fac.tab = tabId;
    lsSet('tt.fac.tab', tabId);
    if (opts.days && [7, 30, 90].includes(Number(opts.days))) {
      fac.wsDays = Number(opts.days);
      lsSet('tt.fac.wsDays', String(fac.wsDays));
    }
    if (state.view !== 'faction') showView('faction');
    else {
      render();
      await loadTabData(tabId);
    }
  }
  window.openFactionTab = openFactionTab;

  async function openFactionMember(playerId, opts = {}) {
    if (!feat('page.faction') || !feat('faction.members')) return;
    const pid = Number(playerId);
    if (!pid) return;
    fac.tab = 'members';
    lsSet('tt.fac.tab', 'members');
    fac.openMemberId = pid;
    if (opts.metric) { fac.memMetric = opts.metric; lsSet('tt.fac.memMetric', opts.metric); }
    if (opts.range) { fac.memRange = opts.range; lsSet('tt.fac.memRange', opts.range); }
    if (state.view !== 'faction') showView('faction');
    if (!fac.ws) await fetchWorkspace(false, 'members');
    render();
    await fetchMemberSeries(pid);
  }
  window.openFactionMember = openFactionMember;

  async function openFactionRadar({ state: radState = 'all', country = 'all', query = '' } = {}) {
    if (!feat('page.faction') || !feat('faction.travelRadar')) return;
    fac.tab = 'radar';
    fac.radState = radState || 'all';
    fac.radCountry = country || 'all';
    fac.radQ = String(query || '');
    lsSet('tt.fac.tab', 'radar');
    if (state.view !== 'faction') showView('faction');
    else {
      render();
      await loadTabData('radar');
    }
  }
  window.openFactionRadar = openFactionRadar;

  function toggleMemberDrawer(playerId) {
    const pid = Number(playerId);
    if (!pid) return;
    if (fac.openMemberId === pid) {
      fac.openMemberId = 0;
      fac.memberSeq++;
      fac.memberSeries = null;
      render();
    } else {
      fac.openMemberId = pid;
      fetchMemberSeries(pid);
    }
  }

  /* ---------- Olaylar ---------- */
  // POSTs a local note change; true when it was saved. Errors become a toast, never an unhandled rejection.
  async function mutateWorkspace(body, apply) {
    try {
      const res = await api('/api/faction/workspace', { method: 'POST', body: JSON.stringify(body) });
      apply(res || {});
      return true;
    } catch (err) {
      toast(err?.message || tr('Kaydedilemedi.', 'Could not save.'));
      return false;
    }
  }
  const host = $('#faction-body');
  host?.addEventListener('click', async (e) => {
    if (e.target.closest('a.fac-prof-ext')) {
      e.stopPropagation();
      return;
    }
    const closeDr = e.target.closest('[data-fac-close-drawer]');
    if (closeDr) {
      e.stopPropagation();
      fac.openMemberId = 0;
      fac.memberSeq++;
      fac.memberSeries = null;
      render();
      return;
    }
    const memBtn = e.target.closest('[data-fac-member-btn]');
    if (memBtn) {
      e.stopPropagation();
      toggleMemberDrawer(memBtn.dataset.facMemberBtn);
      return;
    }
    const memRow = e.target.closest('tr[data-fac-member-row]');
    if (memRow && !e.target.closest('a')) {
      toggleMemberDrawer(memRow.dataset.facMemberRow);
      return;
    }
    const openMem = e.target.closest('[data-open-member]');
    if (openMem && !e.target.closest('a')) {
      const pid = Number(openMem.dataset.openMember);
      const metric = openMem.dataset.openMetric || 'activity';
      await openFactionMember(pid, { metric, range: `${fac.wsDays}d` });
      return;
    }
    const mcol = e.target.closest('[data-fac-mcol]');
    if (mcol) {
      const k = mcol.dataset.facMcol;
      if (fac.memCols.has(k)) fac.memCols.delete(k); else fac.memCols.add(k);
      lsSet('tt.fac.memCols', JSON.stringify([...fac.memCols]));
      render();
      return;
    }
    const mf = e.target.closest('[data-fac-mf]');
    if (mf) { fac.memFilter = mf.dataset.facMf; render(); return; }
    const mm = e.target.closest('[data-mem-metric]');
    if (mm) {
      fac.memMetric = mm.dataset.memMetric;
      fac.memStat = fac.memMetric === 'battlestats' ? 'total' : fac.memMetric === 'activity' ? 'timeplayed' : 'total';
      lsSet('tt.fac.memMetric', fac.memMetric);
      lsSet('tt.fac.memStat', fac.memStat);
      if (fac.openMemberId) await fetchMemberSeries(fac.openMemberId);
      return;
    }
    const msBtn = e.target.closest('[data-mem-stat]');
    if (msBtn) {
      fac.memStat = msBtn.dataset.memStat;
      lsSet('tt.fac.memStat', fac.memStat);
      if (fac.openMemberId) await fetchMemberSeries(fac.openMemberId);
      return;
    }
    const mMode = e.target.closest('[data-mem-mode]');
    if (mMode) {
      fac.memMode = mMode.dataset.memMode === 'gain' ? 'gain' : 'value';
      lsSet('tt.fac.memMode', fac.memMode);
      if (fac.openMemberId) await fetchMemberSeries(fac.openMemberId);
      return;
    }
    const mRange = e.target.closest('[data-mem-range]');
    if (mRange) {
      fac.memRange = mRange.dataset.memRange;
      lsSet('tt.fac.memRange', fac.memRange);
      if (fac.openMemberId) await fetchMemberSeries(fac.openMemberId);
      return;
    }
    if (e.target.closest('#fac-ws-refresh')) {
      await fetchWorkspace(true, activeTab());
      render();
      return;
    }
    const wsDaysBtn = e.target.closest('[data-fac-ws-days]');
    if (wsDaysBtn) {
      fac.wsDays = Number(wsDaysBtn.dataset.facWsDays) || 7;
      lsSet('tt.fac.wsDays', String(fac.wsDays));
      await fetchWorkspace(false, activeTab());
      render();
      return;
    }
    if (e.target.closest('#fac-ws-tenure')) {
      fac.wsTenure = !fac.wsTenure;
      lsSet('tt.fac.wsTenure', fac.wsTenure ? '1' : '0');
      await fetchWorkspace(false, activeTab());
      render();
      return;
    }
    const wsMetricBtn = e.target.closest('[data-fac-ws-metric]');
    if (wsMetricBtn) {
      fac.wsMetric = wsMetricBtn.dataset.facWsMetric;
      lsSet('tt.fac.wsMetric', fac.wsMetric);
      render();
      return;
    }
    // Add / remove a local note. Defaults are sent empty ('') and translated when shown; a failure is a toast.
    if (e.target.closest('#fac-wl-add')) {
      const d = fac.drafts.wl;
      const body = { action: 'watchlist_add', playerId: Number(d.id) || 0, name: d.name.trim(), tag: d.tag.trim(), note: d.note.trim() };
      if (await mutateWorkspace(body, (res) => { if (fac.ws?.recruitment) fac.ws.recruitment.watchlist = res.watchlist || []; })) fac.drafts.wl = freshDrafts().wl;
      render();
      return;
    }
    const wlDel = e.target.closest('[data-fac-wl-del]');
    if (wlDel) {
      await mutateWorkspace({ action: 'watchlist_remove', id: wlDel.dataset.facWlDel }, (res) => { if (fac.ws?.recruitment) fac.ws.recruitment.watchlist = res.watchlist || []; });
      render();
      return;
    }
    if (e.target.closest('#fac-al-add')) {
      const d = fac.drafts.al;
      const body = { action: 'alliance_add', name: d.name.trim(), tag: d.tag.trim(), targetFactionId: Number(d.id) || null, relation: d.rel || 'ally', note: d.note.trim() };
      if (await mutateWorkspace(body, (res) => { if (fac.ws?.alliance) fac.ws.alliance.alliances = res.alliances || []; })) fac.drafts.al = freshDrafts().al;
      render();
      return;
    }
    const alDel = e.target.closest('[data-fac-al-del]');
    if (alDel) {
      await mutateWorkspace({ action: 'alliance_remove', id: alDel.dataset.facAlDel }, (res) => { if (fac.ws?.alliance) fac.ws.alliance.alliances = res.alliances || []; });
      render();
      return;
    }
    if (e.target.closest('#fac-gf-add')) {
      const d = fac.drafts.gf;
      const body = { action: 'graffiti_add', category: d.cat.trim(), text: d.text.trim() };
      if (await mutateWorkspace(body, (res) => { if (fac.ws?.alliance) fac.ws.alliance.graffiti = res.graffiti || []; })) fac.drafts.gf = freshDrafts().gf;
      render();
      return;
    }
    const gfDel = e.target.closest('[data-fac-gf-del]');
    if (gfDel) {
      await mutateWorkspace({ action: 'graffiti_remove', id: gfDel.dataset.facGfDel }, (res) => { if (fac.ws?.alliance) fac.ws.alliance.graffiti = res.graffiti || []; });
      render();
      return;
    }
    const radPlayer = e.target.closest('[data-open-radar-player]');
    if (radPlayer) {
      e.preventDefault();
      e.stopPropagation();
      await openFactionRadar({ query: radPlayer.dataset.openRadarPlayer || '' });
      return;
    }
    const radStateBtn = e.target.closest('[data-open-radar-state]');
    if (radStateBtn) {
      e.preventDefault();
      e.stopPropagation();
      await openFactionRadar({ state: radStateBtn.dataset.openRadarState || 'all' });
      return;
    }
    const tvCountry = e.target.closest('[data-travel-country]');
    if (tvCountry) {
      e.preventDefault();
      window.openTravelCountry?.(tvCountry.dataset.travelCountry);
      return;
    }
    const warPayoutBtn = e.target.closest('[data-open-war-payout]');
    if (warPayoutBtn) {
      e.preventDefault();
      window.openWarPayout?.(warPayoutBtn.dataset.openWarPayout || null);
      return;
    }
    const t = e.target.closest('[data-fac-tab]');
    if (t) {
      fac.tab = t.dataset.facTab;
      lsSet('tt.fac.tab', fac.tab);
      render();
      await loadTabData(fac.tab);
      return;
    }
    if (e.target.closest('#fac-rep-refresh')) { await fetchReport(true); if (WS_TABS.has(activeTab())) await fetchWorkspace(true, activeTab()); render(); return; }
    const rd = e.target.closest('[data-fac-rep-days]');
    if (rd) { fac.repDays = Number(rd.dataset.facRepDays) === 30 ? 30 : 7; lsSet('tt.fac.repDays', String(fac.repDays)); await fetchReport(false); render(); return; }
    if (e.target.closest('#fac-act-refresh')) { await fetchActivity(true); render(); return; }
    if (e.target.closest('#fac-rad-refresh')) { await fetchRadar(true); render(); return; }
    if (e.target.closest('#fac-arm-refresh')) { await fetchArmory(true); render(); return; }
    if (e.target.closest('#fac-ch-refresh')) { await fetchChains(true); render(); return; }
    const radSrc = e.target.closest('[data-fac-rad-src]');
    if (radSrc) {
      fac.radSource = radSrc.dataset.facRadSrc === 'shared' ? 'shared' : 'local';
      render();
      await fetchRadar(false);
      render();
      return;
    }
    const radKpi = e.target.closest('[data-fac-rad-state]');
    if (radKpi) {
      const next = radKpi.dataset.facRadState;
      fac.radState = fac.radState === next ? 'all' : next;
      render();
      return;
    }
    if (e.target.closest('#fac-rad-reset')) {
      fac.radState = 'all'; fac.radCountry = 'all'; fac.radAct = 'all'; fac.radQ = '';
      render();
      return;
    }
    const af = e.target.closest('[data-fac-af]');
    if (af) { fac.actFilter = af.dataset.facAf; render(); return; }
    const ac = e.target.closest('[data-fac-arm-cat]');
    if (ac) { fac.armCat = ac.dataset.facArmCat; render(); return; }
    const ub = e.target.closest('[data-fac-ub]');
    if (ub) { fac.upgBranch = ub.dataset.facUb; render(); return; }
    if (e.target.closest('#fac-upg-reset')) { fac.upgSel = { ...(fac.upg?.currentLevels || {}) }; fac.upgRespectOverride = null; render(); return; }
    if (e.target.closest('#fac-upg-clear')) { fac.upgSel = {}; render(); return; }
  });
  // Draft inputs only update state (no re-render while typing); render() writes them back as value="…".
  const keepDraft = (el) => {
    const f = DRAFT_FIELDS[el?.id];
    if (!f) return false;
    fac.drafts[f[0]][f[1]] = String(el.value ?? '');
    return true;
  };
  host?.addEventListener('input', (e) => {
    if (keepDraft(e.target)) return;
    if (e.target.id === 'fac-mem-q') { fac.memQ = e.target.value; render(); return; }
    if (e.target.id === 'fac-act-q') { fac.actQ = e.target.value; render(); return; }
    if (e.target.id === 'fac-rad-q') { fac.radQ = e.target.value; render(); return; }
    if (e.target.id === 'fac-arm-q') { fac.armQ = e.target.value; render(); return; }
    if (e.target.id === 'fac-upg-respect') {
      fac.upgRespectOverride = Math.max(0, Number(e.target.value) || 0);
      if (!patchUpgradeMetrics()) render();
      return;
    }
    const up = e.target.closest('[data-fac-upg]');
    if (up) {
      fac.upgSel ||= {};
      fac.upgSel[up.dataset.facUpg] = Number(up.value) || 0;
      if (!patchUpgradeMetrics()) render();
    }
  });
  host?.addEventListener('change', (e) => {
    if (keepDraft(e.target)) return;
    if (e.target.id === 'fac-mem-sort') { fac.memSort = e.target.value; render(); }
    else if (e.target.id === 'fac-act-sort') { fac.actSort = e.target.value; render(); }
    else if (e.target.id === 'fac-rad-country') { fac.radCountry = e.target.value || 'all'; render(); }
    else if (e.target.id === 'fac-rad-act') { fac.radAct = e.target.value || 'all'; render(); }
    else if (e.target.id === 'fac-cmp-a') { fac.cmpA = Number(e.target.value) || 0; render(); }
    else if (e.target.id === 'fac-cmp-b') { fac.cmpB = Number(e.target.value) || 0; render(); }
  });
  host?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const memRow = e.target.closest('tr[data-fac-member-row]');
    if (memRow && !e.target.closest('a')) {
      e.preventDefault();
      toggleMemberDrawer(memRow.dataset.facMemberRow);
      return;
    }
    const statRow = e.target.closest('tr[data-open-member]');
    if (statRow && !e.target.closest('a')) {
      e.preventDefault();
      openFactionMember(Number(statRow.dataset.openMember), { metric: statRow.dataset.openMetric || 'activity', range: `${fac.wsDays}d` });
      return;
    }
    const row = e.target.closest('tr.fac-armory-row[data-open-url]');
    if (!row) return;
    e.preventDefault();
    openInTab(row.dataset.openUrl, { activate: true, label: row.dataset.tabLabel || null, reuse: true });
  });

  // A text field or select in the Faction page has focus: a periodic redraw would close an open dropdown
  // or break an IME composition, so the 60 s redraw waits (drafts are kept in state either way).
  const typingInFaction = () => {
    const ae = document.activeElement;
    return Boolean(ae && host?.contains?.(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName || '') && ae.type !== 'range');
  };
  // Sayfa açıkken dakikada bir yeniden çiz (geri sayımlar & yaş), 2 dakikada bir veriyi tazele
  setInterval(() => {
    if (state.view === 'faction' && trackerVisible() && !typingInFaction()) {
      const t = activeTab();
      if (t === 'oc' || t === 'radar' || t === 'activity' || WS_TABS.has(t)) render();
    }
  }, 60_000);
  // The 2-minute reload also refetches the Activity / Radar roster, so radar notifications fire without a manual refresh
  setInterval(() => { if (state.view === 'faction' && trackerVisible()) loadFaction(false, { refresh: true }); }, 2 * 60_000);

  Object.assign(EXTRA_LOADERS, { faction: loadFaction });
  FEATURE_HOOKS.push(() => { if (state.view === 'faction') render(); });
  const prevLang = window.onLangChanged;
  window.onLangChanged = () => { prevLang?.(); if (state.view === 'faction') render(); };
  window.lrxFaction = fac;
  applyLang();
  applyFeatures();
})();
