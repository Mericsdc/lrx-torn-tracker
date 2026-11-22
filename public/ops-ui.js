/* =========================================================
   LRX Control & Operations Screen (P1.3 · loaded after features.js)
   Renders inside Settings -> General (#ops-control-panel):
   1. Sources: Torn / YATA / Prometheus health, latency, error class, masked key
   2. Collection & Coverage: local shared roster + optional Hub collector controls
   3. Notification Outbox: pending / sent / failed / needs_review + safe retry & dry-run preview
   4. Access & Audit: active role/scope, faction plan, audit trail, safe disconnect
   ========================================================= */
(() => {
  const ops = {
    data: null,
    err: null,
    loading: false,
    busyAction: false,
    previewText: '',
  };

  const isoTime = (v) => {
    if (!v) return '—';
    const d = typeof v === 'number' ? new Date(v) : new Date(String(v));
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString(state.lang === 'en' ? 'en-GB' : 'tr-TR', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC',
    }) + ' TCT';
  };

  async function loadOpsPanel({ check = false } = {}) {
    const box = $('#ops-control-panel');
    if (!box) return;
    ops.loading = true;
    renderOps();
    try {
      ops.data = await api(`/api/ops/status${check ? '?check=1' : ''}`);
      ops.err = null;
    } catch (e) {
      ops.err = e;
    } finally {
      ops.loading = false;
      renderOps();
    }
  }

  async function runOperatorJob(action, extra = {}) {
    if (ops.busyAction) return;
    const fid = ops.data?.factionId || Number(state.overview?.player?.faction?.faction_id) || 0;
    if (!fid) return toast(tr('Aktif faction kimliği bulunamadı.', 'No active faction ID found.'));
    ops.busyAction = true;
    renderOps();
    try {
      const requestId = `ops_${action}_${fid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const res = await api('/api/ops/faction-collector/jobs', {
        method: 'POST',
        body: JSON.stringify({ requestId, action, factionId: fid, reason: `Desktop ops UI: ${action}`, ...extra }),
      });
      if (action === 'preview_notification' && res?.result?.preview) {
        ops.previewText = JSON.stringify(res.result.preview, null, 2);
      } else {
        toast(tr('Operatör işlemi uygulandı ✓', 'Operator action applied ✓'));
      }
      await loadOpsPanel();
    } catch (e) {
      toast(tr('İşlem başarısız: ', 'Action failed: ') + e.message);
    } finally {
      ops.busyAction = false;
      renderOps();
    }
  }

  function renderSourceRow(name, label, info) {
    const ok = info?.ok;
    const chip = ok === true
      ? `<span class="chip green">● ${tr('Sağlıklı', 'Healthy')}</span>`
      : ok === false
        ? `<span class="chip danger">✗ ${esc(info.lastErrorClass || tr('Hata', 'Error'))}</span>`
        : `<span class="chip dim">${tr('Beklemede', 'Idle')}</span>`;
    const lat = info?.latencyMs ? `${n0(info.latencyMs)} ms` : '—';
    const lastOk = info?.lastSuccessAt ? isoTime(info.lastSuccessAt) : '—';
    const lastErr = info?.lastErrorAt ? isoTime(info.lastErrorAt) : '—';
    return `<tr>
      <td><b>${esc(label)}</b></td>
      <td>${chip}</td>
      <td class="num mono">${lat}</td>
      <td class="num mono">${n0(info?.calls || 0)}</td>
      <td class="mono sub-text">${lastOk}</td>
      <td class="mono sub-text">${lastErr}</td>
    </tr>`;
  }

  function renderOps() {
    const box = $('#ops-control-panel');
    if (!box) return;
    if (ops.loading && !ops.data) {
      box.innerHTML = `<article class="glass card"><div class="card-head"><h3>🎛️ ${tr('Kontrol ve Operasyon Ekranı', 'Control & Operations')}</h3></div>${loadingBox()}</article>`;
      return;
    }
    if (!ops.data) {
      box.innerHTML = `<article class="glass card"><div class="card-head wrap">
        <h3>🎛️ ${tr('Kontrol ve Operasyon Ekranı', 'Control & Operations')}</h3>
        <button class="btn sm ghost" type="button" id="ops-refresh">↻ ${tr('Yükle', 'Load')}</button>
      </div>${ops.err ? errorBox(ops.err) : `<p class="muted">${tr('Kaynak sağlığı, toplama kapsaması, bildirim kuyruğu ve erişim denetimi.', 'Source health, collection coverage, notification outbox and access audit.')}</p>`}</article>`;
      return;
    }

    const d = ops.data;
    const s = d.sources || {};
    const lr = d.localRoster;
    const hub = d.hub || {};
    const facSet = hub.factionSettings || null;
    const collectorSummary = hub.collector || null;
    const myCollector = collectorSummary?.collectors?.find((c) => Number(c.factionId) === Number(d.factionId)) || null;
    const outbox = collectorSummary?.outbox?.counts || { pending: 0, sent: 0, failed: 0, needs_review: 0 };
    const pausedSec = d.tornPausedUntil && d.tornPausedUntil > Date.now() ? Math.ceil((d.tornPausedUntil - Date.now()) / 1000) : 0;

    // 1. Sources Panel
    const sourcesCard = `<article class="glass card ops-card">
      <div class="card-head wrap">
        <div>
          <h3>🔌 ${tr('Kaynaklar', 'Sources')}</h3>
          <span class="muted">${tr('Torn, YATA ve Prometheus sağlık durumu · maskelenmiş anahtar', 'Torn, YATA and Prometheus health · masked key')}: <b class="mono">${esc(d.maskedKey || '—')}</b></span>
        </div>
        <div class="fac-head-r">
          ${pausedSec ? `<span class="chip warn">⏳ Torn 429 (${pausedSec}s)</span>` : ''}
          <button class="btn sm ghost" type="button" id="ops-check-sources" ${ops.loading ? 'disabled' : ''}>↻ ${tr('Kaynakları kontrol et', 'Check sources')}</button>
        </div>
      </div>
      <div class="tbl-wrap"><table class="tbl compact">
        <thead><tr>
          <th>${tr('Kaynak', 'Source')}</th><th>${tr('Durum', 'Status')}</th><th class="num">${tr('Gecikme', 'Latency')}</th>
          <th class="num">${tr('Çağrı', 'Calls')}</th><th>${tr('Son başarı', 'Last success')}</th><th>${tr('Son hata', 'Last error')}</th>
        </tr></thead>
        <tbody>
          ${renderSourceRow('torn', 'Torn API', s.torn)}
          ${renderSourceRow('yata', 'YATA (Travel)', s.yata)}
          ${renderSourceRow('prometheus', 'Prometheus (Restock)', s.prometheus)}
        </tbody>
      </table></div>
    </article>`;

    // 2. Collection & Coverage Panel
    const localBlock = lr
      ? `<div class="ops-kv">
          <span>${tr('Yerel roster önbelleği', 'Local roster cache')}: <b class="mono">${lr.membersCount} ${tr('üye', 'members')} · ${lr.travelCount} ${tr('uçuşta/yurt dışında', 'traveling/abroad')}</b></span>
          <span class="chip ${lr.state === 'stale' ? 'warn' : 'green'}">${lr.state === 'stale' ? tr('Eski veri', 'Stale') : tr('Güncel', 'Fresh')} · ${isoTime(lr.observedAt)}</span>
          ${feat('page.faction') && feat('faction.travelRadar') ? `<button class="btn sm ghost" type="button" id="ops-open-radar">🛰️ Travel Radar ↗</button>` : ''}
        </div>`
      : `<div class="muted">${tr('Henüz yerel faction roster anlık görüntüsü alınmadı.', 'No local faction roster snapshot captured yet.')}</div>`;

    const hubCollectorBlock = myCollector ? `<div class="ops-hub-box">
      <div class="ops-kv">
        <span><b>${tr('Ortak Faction Toplayıcısı', 'Shared Faction Collector')}</b> (#${myCollector.factionId})</span>
        <span class="chip ${myCollector.paused ? 'warn' : 'green'}">${myCollector.paused ? tr('Duraklatıldı', 'Paused') : tr('Aktif', 'Active')}</span>
        <span class="mono sub-text">${tr('Kapsama', 'Coverage')}: <b>${myCollector.coveragePct != null ? `${myCollector.coveragePct}%` : '—'}</b></span>
        <span class="mono sub-text">${tr('Anahtar', 'Key')}: ${esc(myCollector.keyRef || '—')}</span>
      </div>
      <div class="ops-actions">
        ${myCollector.paused
          ? `<button class="btn sm ghost" type="button" data-ops-job="resume" ${ops.busyAction ? 'disabled' : ''}>▶ ${tr('Devam ettir', 'Resume')}</button>`
          : `<button class="btn sm ghost" type="button" data-ops-job="pause" ${ops.busyAction ? 'disabled' : ''}>⏸ ${tr('Duraklat', 'Pause')}</button>`}
        <button class="btn sm ghost" type="button" data-ops-job="queue_refresh" ${ops.busyAction ? 'disabled' : ''}>↻ ${tr('Yenileme kuyruğa al', 'Queue refresh')}</button>
      </div>
    </div>` : `<div class="sub-text">${hub.connected
      ? tr('Ortak Faction Hub bağlı · toplayıcı durumu yalnızca yetkili/admin kapsamındadır.', 'Shared Faction Hub connected · collector controls appear for authorized operators.')
      : tr('Ortak Faction Hub bağlı değil · tüm yerel Free özellikler bu bilgisayarda bağımsız çalışır.', 'Shared Faction Hub not connected · all local Free features run independently on this computer.')}</div>`;

    const collectionCard = `<article class="glass card ops-card">
      <div class="card-head wrap">
        <h3>📡 ${tr('Toplama ve Kapsama', 'Collection & Coverage')}</h3>
        <span class="chip dim">${d.factionId ? `Faction #${d.factionId}` : tr('Faction yok', 'No faction')}</span>
      </div>
      ${localBlock}
      ${hubCollectorBlock}
    </article>`;

    // 3. Notification Outbox Panel
    const outboxCard = `<article class="glass card ops-card">
      <div class="card-head wrap">
        <h3>📨 ${tr('Bildirim Kuyruğu', 'Notification Outbox')}</h3>
        <div class="ops-actions">
          ${hub.admin ? `<button class="btn sm ghost" type="button" data-ops-job="retry_outbox" ${ops.busyAction ? 'disabled' : ''}>↻ ${tr('Başarısızları tekrar dene', 'Retry failed')}</button>` : ''}
          ${hub.admin ? `<button class="btn sm ghost" type="button" data-ops-job="preview_notification" ${ops.busyAction ? 'disabled' : ''}>👁 ${tr('Sentetik önizleme', 'Synthetic preview')}</button>` : ''}
        </div>
      </div>
      <div class="chip-row">
        <span class="chip dim">${tr('Bekleyen', 'Pending')}: <b class="mono">${n0(outbox.pending)}</b></span>
        <span class="chip green">${tr('Gönderildi', 'Sent')}: <b class="mono">${n0(outbox.sent)}</b></span>
        <span class="chip danger">${tr('Başarısız', 'Failed')}: <b class="mono">${n0(outbox.failed)}</b></span>
        <span class="chip warn">${tr('İnceleme gerek', 'Needs review')}: <b class="mono">${n0(outbox.needs_review)}</b></span>
      </div>
      ${outbox.needs_review ? `<p class="sub-text warn-text">${tr('Belirsiz zaman aşımı sonuçları körlemesine yeniden gönderilmez; operatör onayı bekler.', 'Uncertain timeout deliveries are never blindly retried; they await operator review.')}</p>` : ''}
      ${ops.previewText ? `<pre class="ops-preview mono">${esc(ops.previewText)}</pre>` : ''}
    </article>`;

    // 4. Access & Audit Panel
    const audits = (facSet?.audit || collectorSummary?.audit || []).slice(0, 12);
    const planChip = facSet?.plan?.active
      ? `<span class="chip tq">${tr('Takım Planı Aktif', 'Team Plan Active')} · ${isoTime(facSet.plan.endsAt)}</span>`
      : `<span class="chip dim">${tr('Yerel / Ücretsiz', 'Local / Free')}</span>`;
    const auditRows = audits.map((a) => `<tr>
      <td class="mono sub-text">${isoTime((a.createdAt || a.created_at) * 1000)}</td>
      <td><span class="chip dim">${esc(a.action)}</span></td>
      <td class="mono">${esc(String(a.actorTornId ?? a.actor_torn_id ?? '—'))}</td>
      <td class="sub-text">${esc(a.reason || a.result || '')}</td>
    </tr>`).join('');

    const accessCard = `<article class="glass card ops-card">
      <div class="card-head wrap">
        <div>
          <h3>🛡️ ${tr('Erişim ve Denetim', 'Access & Audit')}</h3>
          <span class="muted">${tr('Doğrulanmış rol ve takım planı kapsamı · anahtar iptalinde toplama derhal durur', 'Verified role and team plan scope · collection stops immediately on key revocation')}</span>
        </div>
        <div class="fac-head-r">
          ${planChip}
          ${facSet?.role ? `<span class="chip blue">${esc(facSet.role)}</span>` : ''}
        </div>
      </div>
      ${audits.length ? `<div class="tbl-wrap"><table class="tbl compact">
        <thead><tr><th>${tr('Zaman', 'Time')}</th><th>${tr('İşlem', 'Action')}</th><th>Torn ID</th><th>${tr('Detay', 'Detail')}</th></tr></thead>
        <tbody>${auditRows}</tbody>
      </table></div>` : `<div class="sub-text">${tr('Henüz denetim kaydı bulunmuyor.', 'No audit entries yet.')}</div>`}
    </article>`;

    box.innerHTML = `<div class="ops-stack">${sourcesCard}${collectionCard}${outboxCard}${accessCard}</div>`;
  }

  const host = $('#ops-control-panel');
  host?.addEventListener('click', (e) => {
    if (e.target.closest('#ops-refresh')) { loadOpsPanel({ check: false }); return; }
    if (e.target.closest('#ops-check-sources')) { loadOpsPanel({ check: true }); return; }
    if (e.target.closest('#ops-open-radar')) { window.openFactionRadar?.(); return; }
    const jobBtn = e.target.closest('[data-ops-job]');
    if (jobBtn) { runOperatorJob(jobBtn.dataset.opsJob); }
  });

  window.loadOpsPanel = loadOpsPanel;
  const prevLang = window.onLangChanged;
  window.onLangChanged = () => { prevLang?.(); if (ops.data) renderOps(); };
  window.addEventListener('lrx-premium-reset', () => { ops.data = null; renderOps(); });
})();
