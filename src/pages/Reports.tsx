import { DateTime } from "luxon";
import { useEffect, useMemo, useState } from "react";
import { listFinishedJobsWithNetBetween } from "../lib/db";

const RO_ZONE = "Europe/Bucharest";

// În anumite setup-uri TS poate “vedea” DateTime ca namespace (și dă TS2709).
// Ca să evităm complet asta, derivăm tipul instanței dintr-un call real.
type LuxonDT = ReturnType<typeof DateTime.now>;

type DateRange = { start: LuxonDT; end: LuxonDT };

function startOfIsoWeekRO(dt: LuxonDT): LuxonDT {
  // ISO week: Monday = 1 ... Sunday = 7 (Luxon: dt.weekday)
  const ro = dt.setZone(RO_ZONE).startOf("day");
  return ro.minus({ days: ro.weekday - 1 }).startOf("day");
}

function endOfIsoWeekRO(dt: LuxonDT): LuxonDT {
  return startOfIsoWeekRO(dt).plus({ days: 6 }).endOf("day");
}

function weekRangeRO(now: LuxonDT): DateRange {
  return { start: startOfIsoWeekRO(now), end: endOfIsoWeekRO(now) };
}

function monthRangeRO(now: LuxonDT): DateRange {
  const ro = now.setZone(RO_ZONE);
  return { start: ro.startOf("month").startOf("day"), end: ro.endOf("month").endOf("day") };
}

function yearRangeRO(now: LuxonDT): DateRange {
  const ro = now.setZone(RO_ZONE);
  return { start: ro.startOf("year").startOf("day"), end: ro.endOf("year").endOf("day") };
}

function shiftRange(r: DateRange, delta: { weeks?: number; months?: number; years?: number }): DateRange {
  return { start: r.start.minus(delta), end: r.end.minus(delta) };
}

function fmtRange(r: DateRange): string {
  return `${r.start.toISODate()} → ${r.end.toISODate()}`;
}

// Dacă query-ul tău folosește end exclusiv (cel mai safe pt timestamptz):
function toDbRangeExclusive(r: DateRange): { fromIso: string; toIsoExclusive: string } {
  const fromIso = r.start.startOf("day").toUTC().toISO()!;
  const toIsoExclusive = r.end.plus({ days: 1 }).startOf("day").toUTC().toISO()!;
  return { fromIso, toIsoExclusive };
}

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

  async function fetchTotalsRange(range: DateRange): Promise<{ total: number; jobs: number }> {
    const { fromIso, toIsoExclusive } = toDbRangeExclusive(range);
    const jobs = await listFinishedJobsWithNetBetween(fromIso, toIsoExclusive);
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

      // Perioade rapide (RO) — intervale COMPLETE
      const now = DateTime.now().setZone(RO_ZONE);
      const weekCurRange = weekRangeRO(now);
      const weekPrevRange = shiftRange(weekCurRange, { weeks: 1 });
      const monthCurRange = monthRangeRO(now);
      const monthPrevRange = shiftRange(monthCurRange, { months: 1 });
      const yearCurRange = yearRangeRO(now);
      const yearPrevRange = shiftRange(yearCurRange, { years: 1 });

      const [rangeJobs, prevRange, weekCur, weekPrev, monthCur, monthPrev, yearCur, yearPrev] = await Promise.all([
        listFinishedJobsWithNetBetween(startIso, endIso),
        listFinishedJobsWithNetBetween(prevIso.startIso, prevIso.endIso),
        fetchTotalsRange(weekCurRange),
        fetchTotalsRange(weekPrevRange),
        fetchTotalsRange(monthCurRange),
        fetchTotalsRange(monthPrevRange),
        fetchTotalsRange(yearCurRange),
        fetchTotalsRange(yearPrevRange),
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
      setWeekLabel(fmtRange(weekCurRange));

      setMonthTotal(monthCur.total);
      setMonthPrevTotal(monthPrev.total);
      setMonthLabel(fmtRange(monthCurRange));

      setYearTotal(yearCur.total);
      setYearPrevTotal(yearPrev.total);
      setYearLabel(fmtRange(yearCurRange));
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
          <button className="btn primary" onClick={() => void refresh()}>
            {loading ? "Calculez…" : "Refresh"}
          </button>
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
          <div className="muted" style={{ marginBottom: 8 }}>
            {startYmd} → {endYmd}
          </div>

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
          <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
            {weekLabel}
          </div>

          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="muted">Luna curentă</span>
            <b>{moneyRON(monthTotal)}</b>
          </div>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="muted">Vs luna precedentă</span>
            {renderDeltaLine(monthTotal, monthPrevTotal)}
          </div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
            {monthLabel}
          </div>

          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="muted">Anul curent</span>
            <b>{moneyRON(yearTotal)}</b>
          </div>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="muted">Vs anul precedent</span>
            {renderDeltaLine(yearTotal, yearPrevTotal)}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            {yearLabel}
          </div>
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
