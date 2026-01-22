import { DateTime } from "luxon";
import { useEffect, useMemo, useState } from "react";
import { listFinishedJobsWithNetBetween } from "../lib/db";

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

function addDaysYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split("-").map((x) => Number(x));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function nextYmd(ymd: string): string {
  return addDaysYmd(ymd, 1);
}

function daysBetweenInclusive(startYmd: string, endYmd: string): number {
  const [y1, m1, d1] = startYmd.split("-").map((x) => Number(x));
  const [y2, m2, d2] = endYmd.split("-").map((x) => Number(x));
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  return Math.floor((b - a) / 86_400_000) + 1;
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

function deltaInfo(current: number, previous: number): { delta: number; pct: number | null } {
  const delta = current - previous;
  if (previous > 0) {
    return { delta, pct: (delta / previous) * 100 };
  }
  return { delta, pct: null };
}

export default function ReportsPage() {
  const [startYmd, setStartYmd] = useState(() => {
    const d = DateTime.now().setZone(TIME_ZONE);
    const ymd = d.toISODate() ?? ymdInTimeZone(new Date());
    return `${ymd.slice(0, 8)}01`; // prima zi din luna curenta
  });
  const [endYmd, setEndYmd] = useState(() => {
    const d = DateTime.now().setZone(TIME_ZONE);
    return d.toISODate() ?? ymdInTimeZone(new Date());
  });

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [rows, setRows] = useState<Array<{ day: string; total: number; jobs: number }>>([]);

  const [sumTotal, setSumTotal] = useState(0);
  const [sumJobs, setSumJobs] = useState(0);

  const [prevTotal, setPrevTotal] = useState(0);
  const [prevJobs, setPrevJobs] = useState(0);

  const [weekTotal, setWeekTotal] = useState(0);
  const [weekPrevTotal, setWeekPrevTotal] = useState(0);
  const [weekLabel, setWeekLabel] = useState<string>("");

  const [monthTotal, setMonthTotal] = useState(0);
  const [monthPrevTotal, setMonthPrevTotal] = useState(0);
  const [monthLabel, setMonthLabel] = useState<string>("");

  const [yearTotal, setYearTotal] = useState(0);
  const [yearPrevTotal, setYearPrevTotal] = useState(0);
  const [yearLabel, setYearLabel] = useState<string>("");

  function ymdRangeToIso(start: string, end: string): { startIso: string; endIso: string } {
    const startIso = toUtcIsoFromDatetimeLocalInTz(TIME_ZONE, `${start}T00:00`);
    const endIso = toUtcIsoFromDatetimeLocalInTz(TIME_ZONE, `${nextYmd(end)}T00:00`);
    return { startIso, endIso };
  }

  async function fetchTotals(start: string, end: string): Promise<{ total: number; jobs: number }> {
    const { startIso, endIso } = ymdRangeToIso(start, end);
    const jobs = await listFinishedJobsWithNetBetween(startIso, endIso);
    const total = jobs.reduce((acc, j) => acc + toNumber(j.net_total), 0);
    return { total, jobs: jobs.length };
  }

  async function refresh() {
    setErr(null);
    setLoading(true);

    try {
      // Selectat
      const { startIso, endIso } = ymdRangeToIso(startYmd, endYmd);

      // Perioada precedentă (aceeași lungime)
      const lenDays = daysBetweenInclusive(startYmd, endYmd);
      const prevStartYmd = addDaysYmd(startYmd, -lenDays);
      const prevEndYmd = addDaysYmd(startYmd, -1);
      const prevIso = ymdRangeToIso(prevStartYmd, prevEndYmd);

      // Perioade rapide (RO)
      const today = DateTime.now().setZone(TIME_ZONE).startOf("day");
      const todayYmd = today.toISODate() ?? ymdInTimeZone(new Date());

      const weekStart = today.minus({ days: today.weekday - 1 });
      const weekStartYmd = weekStart.toISODate() ?? todayYmd;
      const weekPrevStartYmd = addDaysYmd(weekStartYmd, -7);
      const weekPrevEndYmd = addDaysYmd(todayYmd, -7);

      const monthStart = today.startOf("month");
      const monthStartYmd = monthStart.toISODate() ?? `${todayYmd.slice(0, 8)}01`;

      const prevMonthStart = today.minus({ months: 1 }).startOf("month");
      let prevMonthEnd = prevMonthStart.plus({ days: today.day - 1 });
      if (prevMonthEnd.month != prevMonthStart.month) prevMonthEnd = prevMonthStart.endOf("month");
      const prevMonthStartYmd = prevMonthStart.toISODate() ?? addDaysYmd(monthStartYmd, -30);
      const prevMonthEndYmd = prevMonthEnd.toISODate() ?? addDaysYmd(prevMonthStartYmd, today.day - 1);

      const yearStart = today.startOf("year");
      const yearStartYmd = yearStart.toISODate() ?? `${todayYmd.slice(0, 4)}-01-01`;

      const prevYearStart = today.minus({ years: 1 }).startOf("year");
      let prevYearEnd = prevYearStart.plus({ days: today.ordinal - 1 });
      if (prevYearEnd.year != prevYearStart.year) prevYearEnd = prevYearStart.endOf("year");
      const prevYearStartYmd = prevYearStart.toISODate() ?? `${Number(todayYmd.slice(0, 4)) - 1}-01-01`;
      const prevYearEndYmd = prevYearEnd.toISODate() ?? addDaysYmd(prevYearStartYmd, today.ordinal - 1);

      const [rangeJobs, prevRange, weekCur, weekPrev, monthCur, monthPrev, yearCur, yearPrev] = await Promise.all([
        listFinishedJobsWithNetBetween(startIso, endIso),
        listFinishedJobsWithNetBetween(prevIso.startIso, prevIso.endIso),
        fetchTotals(weekStartYmd, todayYmd),
        fetchTotals(weekPrevStartYmd, weekPrevEndYmd),
        fetchTotals(monthStartYmd, todayYmd),
        fetchTotals(prevMonthStartYmd, prevMonthEndYmd),
        fetchTotals(yearStartYmd, todayYmd),
        fetchTotals(prevYearStartYmd, prevYearEndYmd),
      ]);

      const byDay = new Map<string, { total: number; jobs: number }>();
      let grand = 0;
      for (const j of rangeJobs) {
        const total = toNumber(j.net_total);
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
      setSumJobs(rangeJobs.length);

      const prevSum = prevRange.reduce((acc, j) => acc + toNumber(j.net_total), 0);
      setPrevTotal(prevSum);
      setPrevJobs(prevRange.length);

      setWeekTotal(weekCur.total);
      setWeekPrevTotal(weekPrev.total);
      setWeekLabel(`${weekStartYmd} → ${todayYmd}`);

      setMonthTotal(monthCur.total);
      setMonthPrevTotal(monthPrev.total);
      setMonthLabel(`${monthStartYmd} → ${todayYmd}`);

      setYearTotal(yearCur.total);
      setYearPrevTotal(yearPrev.total);
      setYearLabel(`${yearStartYmd} → ${todayYmd}`);
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


  function renderDeltaLine(current: number, previous: number) {
    const { delta, pct } = deltaInfo(current, previous);
    const sign = delta >= 0 ? "+" : "-";
    const abs = Math.abs(delta);
    const pctStr = pct == null ? "" : ` (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)`;

    return (
      <span style={{ fontWeight: 950 }}>
        {sign}
        {moneyRON(abs)}
        {pctStr}
      </span>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="h1">Rapoarte (NET)</div>
          <div className="muted">Venit net pe interval (lucrări cu status “Finalizat”)</div>
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
          <div style={{ fontWeight: 950, marginBottom: 6 }}>Interval selectat</div>
          <div className="muted" style={{ marginBottom: 8 }}>{startYmd} → {endYmd}</div>

          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="muted">Total net</span>
            <b>{moneyRON(sumTotal)}</b>
          </div>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="muted">Lucrări finalizate</span>
            <b>{sumJobs}</b>
          </div>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="muted">Medie net / lucrare</span>
            <b>{moneyRON(avg)}</b>
          </div>
          <div className="row" style={{ justifyContent: "space-between", marginTop: 8 }}>
            <span className="muted">Vs perioada precedentă</span>
            {renderDeltaLine(sumTotal, prevTotal)}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            Perioada precedentă: {addDaysYmd(startYmd, -daysBetweenInclusive(startYmd, endYmd))} → {addDaysYmd(startYmd, -1)} ({prevJobs} lucrări)
          </div>
        </div>

        <div className="card card-pad">
          <div style={{ fontWeight: 950, marginBottom: 6 }}>Săptămână / Lună / An (RO)</div>
          <div className="muted" style={{ marginBottom: 10 }}>
            Calcul bazat pe NET (tabelul <b>job_net_items</b>). Lucrările fără NET contribuie cu 0.
          </div>

          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="muted">Săptămâna curentă</span>
            <b>{moneyRON(weekTotal)}</b>
          </div>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="muted">Vs săptămâna precedentă</span>
            {renderDeltaLine(weekTotal, weekPrevTotal)}
          </div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>{weekLabel}</div>

          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="muted">Luna curentă</span>
            <b>{moneyRON(monthTotal)}</b>
          </div>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="muted">Vs luna precedentă (MTD)</span>
            {renderDeltaLine(monthTotal, monthPrevTotal)}
          </div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>{monthLabel}</div>

          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="muted">Anul curent</span>
            <b>{moneyRON(yearTotal)}</b>
          </div>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="muted">Vs anul precedent (YTD)</span>
            {renderDeltaLine(yearTotal, yearPrevTotal)}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>{yearLabel}</div>
        </div>
      </div>

      <div className="card card-pad" style={{ marginTop: 10 }}>
        <div style={{ fontWeight: 950, marginBottom: 8 }}>Venit net / zi</div>

        <table className="table">
          <thead>
            <tr>
              <th>Zi</th>
              <th>Lucrări</th>
              <th>Total net</th>
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

        <div className="muted" style={{ marginTop: 10 }}>
          Notă: raportarea se bazează pe <b>created_at</b> al lucrării. Dacă vrei “data finalizării” exactă, raportăm după momentul din <b>job_status_history</b> când statusul devine “finished”.
        </div>
      </div>
    </div>
  );
}
