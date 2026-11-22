/* =========================================================
   LRX Company Position Advisor UI (loaded after app.js & company-advisor.js)
   Renders inside #emp-advisor-card on the Employees view.
   Fetches company position requirements on demand (or when expanded) so
   offline/synthetic employee tests never fail or leak errors.
   ========================================================= */
(() => {
  const st = {
    open: lsGet('tt.compAdv.open', '0') === '1',
    posData: null,
    posErr: null,
    loading: false,
    bus2110: null, // null = follow detected director education
    customSlots: null, // null = match current role counts
  };

  async function fetchPositions(force = false) {
    if (!force && st.posData) return st.posData;
    st.loading = true;
    st.posErr = null;
    renderAdvisor();
    try {
      st.posData = await api('/api/company/positions');
      if (st.bus2110 === null) st.bus2110 = !!st.posData.directorBus2110;
    } catch (e) {
      st.posErr = e;
    } finally {
      st.loading = false;
      renderAdvisor();
    }
    return st.posData;
  }

  function buildHealthHints(c) {
    const hints = [];
    if (c.company.environment != null && c.company.environment < 95) {
      hints.push(tr(`Environment ${c.company.environment}% — Cleaner rolü veya daha büyük staff room verimi artırır.`, `Environment is ${c.company.environment}% — a Cleaner role or staff room upgrade will lift income.`));
    }
    if (c.company.efficiency != null && c.company.efficiency < 100) {
      hints.push(tr(`Efficiency ${c.company.efficiency}% — aşağıdaki rol yerleşimiyle çalışma stat verimini yükseltebilirsin.`, `Efficiency is ${c.company.efficiency}% — optimizing staff positions below can boost working-stat effectiveness.`));
    }
    const lowAdd = (c.employees || []).filter((e) => e.addiction <= -8).length;
    if (lowAdd) {
      hints.push(tr(`${lowAdd} çalışanda yüksek addiction var; Pazar yıldız değerlendirmesi öncesi rehab önerilir.`, `${lowAdd} ${lowAdd === 1 ? 'employee has' : 'employees have'} high addiction; rehab before Sunday's star check is recommended.`));
    }
    if (c.company.trains > 0) {
      hints.push(tr(`${c.company.trains} kullanılabilir train birikmiş durumda.`, `${c.company.trains} available ${c.company.trains === 1 ? 'train' : 'trains'} ready to spend.`));
    }
    return hints;
  }

  function renderAdvisor() {
    const box = $('#emp-advisor-card');
    if (!box) return;
    const c = state.company;
    if (!c || !feat('company.advisor') || !feat('page.company') || state.companyMode === false) {
      box.hidden = true;
      return;
    }
    box.hidden = false;

    const head = `<div class="card-head wrap">
      <div>
        <h3>🧭 ${tr('Şirket Pozisyon Optimizasyonu', 'Company Position Optimizer')}</h3>
        <span class="muted">${tr('Torn çalışma statı formülüyle çalışanların en verimli rol yerleşimi', 'Optimal staff-to-position matching using Torn’s working-stat efficiency formula')}</span>
      </div>
      <button class="btn sm ${st.open ? 'ghost' : 'primary'}" type="button" id="adv-toggle">${st.open ? tr('Gizle', 'Hide') : tr('Optimizasyonu aç', 'Open optimizer')}</button>
    </div>`;

    if (!st.open) { box.innerHTML = head; return; }
    if (st.loading) { box.innerHTML = head + loadingBox(); return; }
    if (st.posErr) { box.innerHTML = head + errorBox(st.posErr); return; }
    if (!st.posData) { box.innerHTML = head + loadingBox(); return; }

    const positions = st.posData.positions || {};
    const posNames = Object.keys(positions);
    const emps = c.employees || [];
    if (!emps.length || !posNames.length) {
      box.innerHTML = head + emptyBox(tr('Veri bulunamadı', 'No data available'), tr('Çalışan veya şirket pozisyon bilgisi eksik.', 'Employee or company position definitions are missing.'));
      return;
    }

    const useBus = st.bus2110 != null ? st.bus2110 : !!st.posData.directorBus2110;
    const result = LRXCompanyAdvisor.optimizeStaff(emps, positions, st.customSlots, { directorEduBonus: useBus });
    const hints = buildHealthHints(c);

    const slotControls = `<div class="adv-slots">
      <div class="adv-slots-head">
        <span class="eyebrow">${tr('Hedef Rol Dağılımı', 'Target Role Mix')} (${emps.length} ${tr('çalışan', 'staff')})</span>
        <label class="check"><input type="checkbox" id="adv-bus" ${useBus ? 'checked' : ''}> BUS2110 (+20%)</label>
        ${st.customSlots ? `<button class="btn sm ghost" type="button" id="adv-reset-slots">${tr('Mevcut rollere dön', 'Match current roles')}</button>` : ''}
      </div>
      <div class="adv-slot-grid">${posNames.map((pn) => {
        const cnt = result.slotCounts[pn] || 0;
        const p = positions[pn];
        const reqTxt = [p.man_required && `M:${compact(p.man_required, 0)}`, p.int_required && `I:${compact(p.int_required, 0)}`, p.end_required && `E:${compact(p.end_required, 0)}`].filter(Boolean).join(' ');
        return `<label class="adv-slot-item" title="${esc(p.special_ability || p.description || '')}">
          <span><b>${esc(pn)}</b><small class="sub-text">${reqTxt}${p.special_ability && p.special_ability !== 'None' ? ` · ${esc(p.special_ability)}` : ''}</small></span>
          <input class="input mono adv-slot-in" type="number" min="0" max="${emps.length}" data-adv-pos="${esc(pn)}" value="${cnt}">
        </label>`;
      }).join('')}</div>
    </div>`;

    const summary = `<div class="grid kpis small adv-kpis">
      ${kpi(tr('Mevcut stat verimi', 'Current work-stat eff.'), n0(result.currentTotal), `${tr('Ort.', 'Avg')} ${(result.currentTotal / emps.length).toFixed(1)}`)}
      ${kpi(tr('Önerilen stat verimi', 'Optimal work-stat eff.'), n0(result.optimalTotal), `${tr('Ort.', 'Avg')} ${(result.optimalTotal / emps.length).toFixed(1)}`, 'tq')}
      ${kpi(tr('Potansiyel kazanç', 'Potential gain'), result.gain > 0 ? `+${n0(result.gain)}` : '0', result.moves.length ? tr(`${result.moves.length} rol değişikliği önerisi`, `${result.moves.length} role ${result.moves.length === 1 ? 'move' : 'moves'} suggested`) : tr('Yerleşim zaten optimal ✓', 'Already optimal ✓'), result.gain > 0 ? 'pos' : '')}
    </div>`;

    const rowsHtml = result.assignments.map((a) => `<tr class="${a.changed ? 'adv-move' : ''}">
      <td><a class="fac-name" href="https://www.torn.com/profiles.php?XID=${a.id}">${esc(a.name)}</a></td>
      <td>${esc(a.currentPosition)}</td>
      <td>${a.changed ? `<span class="chip tq">→ ${esc(a.recommendedPosition)}</span>` : `<span class="muted">${esc(a.recommendedPosition)}</span>`}</td>
      <td class="num mono">${a.currentEff}</td>
      <td class="num mono"><b>${a.recommendedEff}</b></td>
      <td class="num mono ${a.delta > 0 ? 'pos' : a.delta < 0 ? 'neg' : 'muted'}">${a.delta > 0 ? `+${a.delta}` : a.delta}</td>
      <td class="sub-text">${esc(a.bestUnconstrainedPosition)} (${a.bestUnconstrainedEff})</td>
    </tr>`).join('');

    const hintsHtml = hints.length
      ? `<ul class="adv-hints">${hints.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>`
      : '';

    box.innerHTML = `${head}${summary}${slotControls}<div class="tbl-wrap"><table class="tbl compact">
      <thead><tr>
        <th>${tr('Çalışan', 'Employee')}</th><th>${tr('Mevcut Rol', 'Current Role')}</th><th>${tr('Önerilen Rol', 'Suggested Role')}</th>
        <th class="num">${tr('Şimdi', 'Now')}</th><th class="num">${tr('Öneri', 'Optimal')}</th><th class="num">${tr('Fark', 'Delta')}</th><th>${tr('Bireysel En İyi', 'Best Solo Fit')}</th>
      </tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table></div>${hintsHtml}`;
  }

  const host = $('#emp-advisor-card');
  host?.addEventListener('click', (e) => {
    if (e.target.closest('#adv-toggle')) {
      st.open = !st.open;
      lsSet('tt.compAdv.open', st.open ? '1' : '0');
      renderAdvisor();
      if (st.open && !st.posData) fetchPositions();
      return;
    }
    if (e.target.closest('#adv-reset-slots')) {
      st.customSlots = null;
      renderAdvisor();
    }
  });
  host?.addEventListener('change', (e) => {
    if (e.target.id === 'adv-bus') { st.bus2110 = e.target.checked; renderAdvisor(); return; }
    const inp = e.target.closest('.adv-slot-in');
    if (inp) {
      const counts = {};
      for (const el of host.querySelectorAll('.adv-slot-in')) {
        counts[el.dataset.advPos] = Math.max(0, Math.floor(Number(el.value) || 0));
      }
      st.customSlots = counts;
      renderAdvisor();
    }
  });

  window.renderCompanyAdvisor = () => { renderAdvisor(); if (st.open && !st.posData && state.view === 'employees') fetchPositions(); };
  FEATURE_HOOKS.push(renderAdvisor);
  const prevLang = window.onLangChanged;
  window.onLangChanged = () => { prevLang?.(); renderAdvisor(); };
})();
