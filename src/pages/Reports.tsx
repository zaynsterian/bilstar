import { useEffect, useMemo, useState } from "react";
import { getOrgSettings, listFinishedJobsWithItemsBetween } from "../lib/db";

const TIME_ZONE = "Europe/Bucharest";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function ymdInTimeZone(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const map = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function getTimeZoneOffsetMinutes(timeZone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts = dtf.formatToParts(date);
  const map = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));

  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );

  return (asUtc - date.getTime()) / 60000;
}

function toUtcIsoFromDatetimeLocalInTz(timeZone: string, value: string): string {
  const [d, t] = value.split("T");
  const [y, m, day] = d.split("-").map((x) => Number(x));
  const [hh, mm] = t.split(":").map((x) => Number(x));

  const assumedUtcMs = Date.UTC(y, m - 1, day, hh, mm, 0);
  const offsetMin = getTimeZoneOffsetMinutes(timeZone, new Date(assumedUtcMs));
  const realUtcMs = assumedUtcMs - offsetMin * 60_000;

  return new Date(realUtcMs).toISOString();
}

function nextYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-").map((x) => Number(x));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function moneyRON(amount: number) {
  return new Intl.NumberFormat("ro-RO", { style: "currency", currency: "RON" }).format(amount);
}

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export default function ReportsPage() {
  const [laborRate, setLaborRate] = useState(0);

  const [startYmd, setStartYmd] = useState(() => {
    const d = new Date();
    const ymd = ymdInTimeZone(d);
    return `${ymd.slice(0, 8)}01`; // prima zi din luna curenta
  });
  const [endYmd, setEndYmd] = useState(() => ymdInTimeZone(new Date()));

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [rows, setRows] = useState<
    Array<{ day: string; total: number; jobs: number }>
  >([]);

  const [sumTotal, setSumTotal] = useState(0);
  const [sumJobs, setSumJobs] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const s = await getOrgSettings();
        setLaborRate(s.labor_rate_per_hour);
      } catch {
        // ignore
      }
    })();
  }, []);

  async function refresh() {
    setErr(null);
    setLoading(true);

    try {
      const startIso = toUtcIsoFromDatetimeLocalInTz(TIME_ZONE, `${startYmd}T00:00`);
      const endIso = toUtcIsoFromDatetimeLocalInTz(TIME_ZONE, `${nextYmd(endYmd)}T00:00`);

      const jobs = await listFinishedJobsWithItemsBetween(startIso, endIso);

      const byDay = new Map<string, { total: number; jobs: number }>();

      let grand = 0;
      for (const j of jobs) {
        let labor = 0;
        let parts = 0;
        let other = 0;

        for (const it of j.items) {
          const qty = toNumber(it.qty) || 0;
          const unit = toNumber(it.unit_price) || 0;

          if (it.item_type === "labor") {
            const mins = (it.norm_minutes ?? 0) * (qty || 1);
            labor += (laborRate * mins) / 60;
          } else if (it.item_type === "part") {
            parts += qty * unit;
          } else {
            other += qty * unit;
          }
        }

        const subtotal = labor + parts + other;
        const total = Math.max(0, subtotal - (j.discount_value ?? 0));
        grand += total;

        const day = ymdInTimeZone(new Date(j.created_at));
        const cur = byDay.get(day) ?? { total: 0, jobs: 0 };
        cur.total += total;
        cur.jobs += 1;
        byDay.set(day, cur);
      }

      const sorted = Array.from(byDay.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([day, v]) => ({ day, total: v.total, jobs: v.jobs }));

      setRows(sorted);
      setSumTotal(grand);
      setSumJobs(jobs.length);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Eroare la rapoarte");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const avg = useMemo(() => (sumJobs ? sumTotal / sumJobs : 0), [sumJobs, sumTotal]);

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="h1">Rapoarte</div>
          <div className="muted">Venit pe interval (lucrări cu status “Finalizat”)</div>
        </div>

        <div className="row">
          <input className="input" style={{ width: 170 }} type="date" value={startYmd} onChange={(e) => setStartYmd(e.target.value)} />
          <input className="input" style={{ width: 170 }} type="date" value={endYmd} onChange={(e) => setEndYmd(e.target.value)} />
          <button className="btn primary" onClick={() => void refresh()}>{loading ? "Calculez…" : "Refresh"}</button>
        </div>
      </div>

      {err && (
        <div className="card card-pad" style={{ borderColor: "rgba(220,38,38,0.35)", marginBottom: 12 }}>
          <div style={{ color: "crimson", fontWeight: 900 }}>{err}</div>
        </div>
      )}

      <div className="grid2">
        <div className="card card-pad">
          <div style={{ fontWeight: 950, marginBottom: 6 }}>Sumar</div>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="muted">Total venit</span>
            <b>{moneyRON(sumTotal)}</b>
          </div>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="muted">Lucrări finalizate</span>
            <b>{sumJobs}</b>
          </div>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="muted">Medie / lucrare</span>
            <b>{moneyRON(avg)}</b>
          </div>
        </div>

        <div className="card card-pad">
          <div style={{ fontWeight: 950, marginBottom: 6 }}>Notă</div>
          <div className="muted">
            Pentru v1.0 raportarea se bazează pe <b>created_at</b> al lucrării.
            Dacă vrei “data finalizării” exactă, folosim <b>job_status_history</b> și raportăm după momentul când statusul devine “finished”.
          </div>
        </div>
      </div>

      <div className="card card-pad" style={{ marginTop: 10 }}>
        <div style={{ fontWeight: 950, marginBottom: 8 }}>Venit / zi</div>

        <table className="table">
          <thead>
            <tr>
              <th>Zi</th>
              <th>Lucrări</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.day}>
                <td style={{ fontWeight: 900 }}>{r.day}</td>
                <td>{r.jobs}</td>
                <td style={{ fontWeight: 950 }}>{moneyRON(r.total)}</td>
              </tr>
            ))}

            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={3} className="muted">
                  Nu există lucrări finalizate în interval.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
