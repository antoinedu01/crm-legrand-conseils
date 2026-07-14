import React, { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync, Empty } from '../components/ui.jsx';
import { fmtCHF, fmtDate, BRANCHES } from '../labels.js';

const MONTHS_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

function lastTwelveMonths() {
  const out = [];
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 11);
  for (let i = 0; i < 12; i++) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}

function monthLabel(ym) {
  return MONTHS_FR[Number(ym.slice(5)) - 1];
}

// Colonnes empilées : commissions payées + attendues par mois d'échéance.
// Tooltip par colonne, écart de 2px couleur de surface entre segments.
function MonthlyCommissionsChart({ monthly }) {
  const months = useMemo(lastTwelveMonths, []);
  const byMonth = Object.fromEntries(monthly.map((m) => [m.month, m]));
  const data = months.map((m) => ({
    month: m,
    paid: byMonth[m]?.paid || 0,
    pending: byMonth[m]?.pending || 0,
  }));
  const max = Math.max(...data.map((d) => d.paid + d.pending), 1);
  const [tip, setTip] = useState(null);
  const rootRef = useRef(null);

  const W = 640, H = 190, PAD_B = 22, PAD_T = 8;
  const slot = W / 12;
  const barW = Math.min(24, slot - 14);
  const scale = (v) => (v / max) * (H - PAD_B - PAD_T);

  function showTip(e, d, i) {
    const rect = rootRef.current.getBoundingClientRect();
    setTip({
      x: Math.min(e.clientX - rect.left + 12, rect.width - 150),
      y: e.clientY - rect.top + 10,
      d, i,
    });
  }

  return (
    <div className="viz-root" ref={rootRef}>
      <div className="viz-legend">
        <span className="key"><span className="swatch" style={{ background: 'var(--series-1)' }} /> Payées</span>
        <span className="key"><span className="swatch" style={{ background: 'var(--series-2)' }} /> Attendues</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img"
           aria-label="Commissions par mois, payées et attendues">
        {[0.5, 1].map((f) => (
          <line key={f} x1={0} x2={W} y1={H - PAD_B - scale(max * f)} y2={H - PAD_B - scale(max * f)}
                stroke="var(--grid)" strokeWidth="1" />
        ))}
        <line x1={0} x2={W} y1={H - PAD_B} y2={H - PAD_B} stroke="var(--baseline)" strokeWidth="1" />
        {data.map((d, i) => {
          const x = i * slot + (slot - barW) / 2;
          const hPaid = scale(d.paid);
          const hPending = scale(d.pending);
          const yPaid = H - PAD_B - hPaid;
          const gap = d.paid > 0 && d.pending > 0 ? 2 : 0;
          const yPending = yPaid - gap - hPending;
          const r = 4;
          return (
            <g key={d.month}
               onMouseMove={(e) => showTip(e, d, i)}
               onMouseLeave={() => setTip(null)}>
              <rect x={i * slot} y={0} width={slot} height={H - PAD_B} fill="transparent" />
              {d.paid > 0 && (
                hPending > 0 ? (
                  <rect x={x} y={yPaid} width={barW} height={hPaid} fill="var(--series-1)"
                        opacity={tip && tip.i !== i ? 0.75 : 1} />
                ) : (
                  <path d={roundedTop(x, yPaid, barW, hPaid, r)} fill="var(--series-1)"
                        opacity={tip && tip.i !== i ? 0.75 : 1} />
                )
              )}
              {d.pending > 0 && (
                <path d={roundedTop(x, yPending, barW, hPending, r)} fill="var(--series-2)"
                      opacity={tip && tip.i !== i ? 0.75 : 1} />
              )}
              <text x={i * slot + slot / 2} y={H - 6} textAnchor="middle" fontSize="10.5"
                    fill="var(--muted)">{monthLabel(d.month)}</text>
            </g>
          );
        })}
      </svg>
      {tip && (
        <div className="viz-tooltip" style={{ left: tip.x, top: tip.y }}>
          <div className="t-title">{monthLabel(tip.d.month)} {tip.d.month.slice(0, 4)}</div>
          <div className="row">
            <span className="k"><i style={{ background: 'var(--series-1)' }} /> Payées</span>
            <b>{fmtCHF(tip.d.paid)}</b>
          </div>
          <div className="row">
            <span className="k"><i style={{ background: 'var(--series-2)' }} /> Attendues</span>
            <b>{fmtCHF(tip.d.pending)}</b>
          </div>
        </div>
      )}
    </div>
  );
}

// Rectangle à sommet arrondi (extrémité de donnée), base carrée
function roundedTop(x, y, w, h, r) {
  const rr = Math.min(r, h, w / 2);
  return `M ${x} ${y + h} L ${x} ${y + rr} Q ${x} ${y} ${x + rr} ${y}
          L ${x + w - rr} ${y} Q ${x + w} ${y} ${x + w} ${y + rr} L ${x + w} ${y + h} Z`;
}

function BranchBars({ byBranch }) {
  const max = Math.max(...byBranch.map((b) => b.n), 1);
  if (byBranch.length === 0) return <Empty>Aucun contrat actif pour le moment.</Empty>;
  return (
    <div>
      {byBranch.map((b) => (
        <div className="hbar-row" key={b.branch} title={`${b.n} contrat(s), primes ${fmtCHF(b.premiums)}`}>
          <span className="name">{BRANCHES[b.branch] || b.branch}</span>
          <span className="track">
            <span className="bar" style={{ width: `${(b.n / max) * 100}%` }} />
          </span>
          <span className="val">{b.n} · {fmtCHF(b.premiums)}</span>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const { data, loading, error } = useAsync(() => api.get('/api/dashboard'), []);
  if (loading) return <p className="muted">Chargement…</p>;
  if (error) return <div className="alert error">{error}</div>;
  const { kpis, monthly, byBranch, upcomingTasks, expiringContracts, complianceGaps } = data;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tableau de bord</h1>
          <div className="sub">Vue d’ensemble de votre activité de courtage</div>
        </div>
      </div>

      <div className="tiles mb">
        <div className="tile">
          <div className="label">Clients & prospects</div>
          <div className="value">{kpis.clients}</div>
          <div className="hint">dont {kpis.prospects} prospects</div>
        </div>
        <div className="tile">
          <div className="label">Contrats actifs</div>
          <div className="value">{kpis.activeContracts}</div>
          <div className="hint">primes {fmtCHF(kpis.totalPremiums)}/an</div>
        </div>
        <div className="tile">
          <div className="label">Commissions perçues ({new Date().getFullYear()})</div>
          <div className="value">{fmtCHF(kpis.commissionsPaidYear)}</div>
        </div>
        <div className="tile">
          <div className="label">Commissions attendues</div>
          <div className="value">{fmtCHF(kpis.commissionsPending)}</div>
          <div className="hint"><Link to="/commissions">voir le détail</Link></div>
        </div>
      </div>

      <div className="grid cols-2 mb">
        <div className="card">
          <h2>Commissions — 12 derniers mois</h2>
          <MonthlyCommissionsChart monthly={monthly} />
        </div>
        <div className="card">
          <h2>Contrats actifs par branche</h2>
          <BranchBars byBranch={byBranch} />
        </div>
      </div>

      <div className="grid cols-3">
        <div className="card">
          <h2>Tâches à venir</h2>
          {upcomingTasks.length === 0 && <Empty>Aucune tâche ouverte.</Empty>}
          <ul className="timeline">
            {upcomingTasks.map((t) => (
              <li key={t.id}>
                <span className="when">{fmtDate(t.due_date)}</span>
                <span>
                  {t.title}
                  {t.client_name && (
                    <> — <Link to={`/clients/${t.client_id}`}>{t.client_name}</Link></>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt"><Link to="/taches">Toutes les tâches →</Link></div>
        </div>
        <div className="card">
          <h2>Échéances sous 90 jours</h2>
          {expiringContracts.length === 0 && <Empty>Aucun contrat n’arrive à échéance.</Empty>}
          <ul className="timeline">
            {expiringContracts.map((c) => (
              <li key={c.id}>
                <span className="when">{fmtDate(c.end_date)}</span>
                <span>
                  <Link to={`/clients/${c.client_id}`}>{c.client_name}</Link> — {BRANCHES[c.branch] || c.branch} ({c.company_name})
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <h2>Alertes conformité</h2>
          {complianceGaps.length === 0 && (
            <Empty>✅ Tous les dossiers actifs sont en ordre (consentement, mandat, info LSA).</Empty>
          )}
          <ul className="timeline">
            {complianceGaps.map((c) => (
              <li key={c.id}>
                <span>
                  <Link to={`/clients/${c.id}`}>{c.name}</Link>
                  <br />
                  <span className="muted" style={{ fontSize: 12 }}>manque : {c.missing.join(', ')}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt"><Link to="/conformite">Module conformité →</Link></div>
        </div>
      </div>
    </>
  );
}
