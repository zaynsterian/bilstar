import { useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";
import { listFinishedJobsWithNetBetween, type JobRowWithCustomer } from "../lib/db";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const RO_ZONE = "Europe/Bucharest";

type Totals = { net: number; jobs: number; avg: number };

function formatRON(amount: number): string {
  return new Intl.NumberFormat("ro-RO", { style: "currency", currency: "RON" }).format(amount);
}
function formatSignedRON(amount: number): string {
  const sign = amount > 0 ? "+" : "";
  return `${sign}${formatRON(amount)}`;
}
function formatPct(pct: number | null): string {
  if (pct === null || Number.isNaN(pct) || !Number.isFinite(pct)) return "—";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}
function clampNonEmpty(s: string): string {
  return (s ?? "").trim();
}

function ymdInTimeZone(date: Date, tzId: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tzId,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value])) as Record<string, string>;
  return `${map.year}-${map.month}-${map.day}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
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
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value])) as Record<string, string>;

  const asUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );

  return (asUTC - date.getTime()) / 60_000;
}

function toUtcIsoFromDatetimeLocalInTz(timeZone: string, value: string): string {
  const assumedUtc = new Date(`${value}:00.000Z`);
  const offsetMinutes = getTimeZoneOffsetMinutes(assumedUtc, timeZone);
  const correctedUtc = new Date(assumedUtc.getTime() - offsetMinutes * 60_000);
  return correctedUtc.toISOString();
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map((x) => Number(x));
  const base = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  base.setUTCDate(base.getUTCDate() + days);
  const yy = base.getUTCFullYear();
  const mm = pad2(base.getUTCMonth() + 1);
  const dd = pad2(base.getUTCDate());
  return `${yy}-${mm}-${dd}`;
}

function daysBetweenInclusive(startYmd: string, endYmd: string): number {
  const [sy, sm, sd] = startYmd.split("-").map(Number);
  const [ey, em, ed] = endYmd.split("-").map(Number);
  const a = Date.UTC(sy, sm - 1, sd, 12, 0, 0);
  const b = Date.UTC(ey, em - 1, ed, 12, 0, 0);
  const diff = Math.round((b - a) / 86_400_000);
  return diff + 1;
}

function normalizeRange(a: string, b: string): { start: string; end: string } {
  if (!a || !b) return { start: a, end: b };
  return a <= b ? { start: a, end: b } : { start: b, end: a };
}

function calcTotals(rows: JobRowWithCustomer[]): Totals {
  const net = rows.reduce((s, it) => s + (it.net_total ?? 0), 0);
  const jobs = rows.length;
  const avg = jobs ? net / jobs : 0;
  return { net, jobs, avg };
}

function buildQueryIsoExclusive(startYmd: string, endYmd: string): { fromIso: string; toIsoExclusive: string } {
  const fromLocal = `${startYmd}T00:00`;
  const toLocalExclusive = `${addDaysYmd(endYmd, 1)}T00:00`;

  const fromIso = toUtcIsoFromDatetimeLocalInTz(RO_ZONE, fromLocal);
  const toIsoExclusive = toUtcIsoFromDatetimeLocalInTz(RO_ZONE, toLocalExclusive);

  return { fromIso, toIsoExclusive };
}

async function fetchRowsBetween(startYmd: string, endYmd: string): Promise<JobRowWithCustomer[]> {
  const { fromIso, toIsoExclusive } = buildQueryIsoExclusive(startYmd, endYmd);
  return listFinishedJobsWithNetBetween(fromIso, toIsoExclusive);
}

function getJobDateYmdRO(job: JobRowWithCustomer): string | null {
  const anyJob = job as any;
  const raw =
    anyJob?.created_at ??
    anyJob?.createdAt ??
    anyJob?.finished_at ??
    anyJob?.finishedAt ??
    anyJob?.date ??
    null;

  if (!raw) return null;

  const d = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(d.getTime())) return null;

  return ymdInTimeZone(d, RO_ZONE);
}

export default function Reports() {
  // input-uri (draft) + interval aplicat (query)
  const [draftStart, setDraftStart] = useState(() => ymdInTimeZone(new Date(), RO_ZONE));
  const [draftEnd, setDraftEnd] = useState(() => ymdInTimeZone(new Date(), RO_ZONE));

  const [qStart, setQStart] = useState(draftStart);
  const [qEnd, setQEnd] = useState(draftEnd);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // data
  const [selectedRows, setSelectedRows] = useState<JobRowWithCustomer[]>([]);
  const [selectedTotals, setSelectedTotals] = useState<Totals>({ net: 0, jobs: 0, avg: 0 });

  const [prevTotals, setPrevTotals] = useState<Totals>({ net: 0, jobs: 0, avg: 0 });
  const [weekTotals, setWeekTotals] = useState<Totals>({ net: 0, jobs: 0, avg: 0 });
  const [prevWeekTotals, setPrevWeekTotals] = useState<Totals>({ net: 0, jobs: 0, avg: 0 });
  const [monthTotals, setMonthTotals] = useState<Totals>({ net: 0, jobs: 0, avg: 0 });
  const [prevMonthTotals, setPrevMonthTotals] = useState<Totals>({ net: 0, jobs: 0, avg: 0 });
  const [yearTotals, setYearTotals] = useState<Totals>({ net: 0, jobs: 0, avg: 0 });
  const [prevYearTotals, setPrevYearTotals] = useState<Totals>({ net: 0, jobs: 0, avg: 0 });

  const now = DateTime.now().setZone(RO_ZONE);

  function onRefresh() {
    const n = normalizeRange(draftStart, draftEnd);
    setQStart(n.start);
    setQEnd(n.end);
  }

  // range-uri “în stil vechi”, raportate la qEnd (nu la “azi”)
  const ranges = useMemo(() => {
    const { start, end } = normalizeRange(qStart, qEnd);

    const ref = DateTime.fromISO(end, { zone: RO_ZONE }).endOf("day");
    const startDt = DateTime.fromISO(start, { zone: RO_ZONE }).startOf("day");
    const days = daysBetweenInclusive(start, end);

    // perioada precedentă (imediat înainte)
    const prevEnd = startDt.minus({ days: 1 }).toISODate()!;
    const prevStart = startDt.minus({ days }).toISODate()!;

    // săptămână curentă (de la luni până la qEnd)
    const weekStart = ref.startOf("day").minus({ days: ref.weekday - 1 }).toISODate()!;
    const weekEnd = ref.toISODate()!;
    const prevWeekStart = DateTime.fromISO(weekStart, { zone: RO_ZONE }).minus({ weeks: 1 }).toISODate()!;
    const prevWeekEnd = DateTime.fromISO(weekEnd, { zone: RO_ZONE }).minus({ weeks: 1 }).toISODate()!;

    // MTD (de la 1 până la qEnd)
    const monthStart = ref.startOf("month").toISODate()!;
    const monthEnd = ref.toISODate()!;
    const prevMonthStartDt = ref.startOf("month").minus({ months: 1 });
    const dayInMonth = ref.day;
    const prevMonthEndDay = Math.min(dayInMonth, prevMonthStartDt.daysInMonth ?? dayInMonth);
    const prevMonthStart = prevMonthStartDt.toISODate()!;
    const prevMonthEnd = prevMonthStartDt.set({ day: prevMonthEndDay }).toISODate()!;

    // YTD (de la 1 ian până la qEnd)
    const yearStart = ref.startOf("year").toISODate()!;
    const yearEnd = ref.toISODate()!;
    const prevYearStartDt = ref.startOf("year").minus({ years: 1 });
    const prevYearStart = prevYearStartDt.toISODate()!;
    const prevYearEnd = prevYearStartDt.plus({ days: ref.ordinal - 1 }).toISODate()!;

    return {
      start,
      end,
      days,
      prev: { start: prevStart, end: prevEnd },
      week: { start: weekStart, end: weekEnd, prevStart: prevWeekStart, prevEnd: prevWeekEnd },
      month: { start: monthStart, end: monthEnd, prevStart: prevMonthStart, prevEnd: prevMonthEnd },
      year: { start: yearStart, end: yearEnd, prevStart: prevYearStart, prevEnd: prevYearEnd },
    };
  }, [qStart, qEnd]);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError(null);

    (async () => {
      try {
        const [
          selRows,
          prevRows,
          weekRows,
          prevWeekRows,
          monthRows,
          prevMonthRows,
          yearRows,
          prevYearRows,
        ] = await Promise.all([
          fetchRowsBetween(ranges.start, ranges.end),
          fetchRowsBetween(ranges.prev.start, ranges.prev.end),
          fetchRowsBetween(ranges.week.start, ranges.week.end),
          fetchRowsBetween(ranges.week.prevStart, ranges.week.prevEnd),
          fetchRowsBetween(ranges.month.start, ranges.month.end),
          fetchRowsBetween(ranges.month.prevStart, ranges.month.prevEnd),
          fetchRowsBetween(ranges.year.start, ranges.year.end),
          fetchRowsBetween(ranges.year.prevStart, ranges.year.prevEnd),
        ]);

        if (cancelled) return;

        setSelectedRows(selRows);
        setSelectedTotals(calcTotals(selRows));

        setPrevTotals(calcTotals(prevRows));
        setWeekTotals(calcTotals(weekRows));
        setPrevWeekTotals(calcTotals(prevWeekRows));
        setMonthTotals(calcTotals(monthRows));
        setPrevMonthTotals(calcTotals(prevMonthRows));
        setYearTotals(calcTotals(yearRows));
        setPrevYearTotals(calcTotals(prevYearRows));
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Eroare la încărcarea raportului");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ranges.start, ranges.end, ranges.prev.start, ranges.prev.end, ranges.week.start, ranges.week.end, ranges.week.prevStart, ranges.week.prevEnd, ranges.month.start, ranges.month.end, ranges.month.prevStart, ranges.month.prevEnd, ranges.year.start, ranges.year.end, ranges.year.prevStart, ranges.year.prevEnd]);

  const intervalDelta = selectedTotals.net - prevTotals.net;
  const intervalPct = prevTotals.net !== 0 ? (intervalDelta / prevTotals.net) * 100 : null;

  const weekDelta = weekTotals.net - prevWeekTotals.net;
  const weekPct = prevWeekTotals.net !== 0 ? (weekDelta / prevWeekTotals.net) * 100 : null;

  const monthDelta = monthTotals.net - prevMonthTotals.net;
  const monthPct = prevMonthTotals.net !== 0 ? (monthDelta / prevMonthTotals.net) * 100 : null;

  const yearDelta = yearTotals.net - prevYearTotals.net;
  const yearPct = prevYearTotals.net !== 0 ? (yearDelta / prevYearTotals.net) * 100 : null;

  const dailyRows = useMemo(() => {
    const map = new Map<string, { ymd: string; net: number; jobs: number }>();

    for (const j of selectedRows) {
      const ymd = getJobDateYmdRO(j);
      if (!ymd) continue;
      if (ymd < ranges.start || ymd > ranges.end) continue;

      const curr = map.get(ymd) ?? { ymd, net: 0, jobs: 0 };
      curr.jobs += 1;
      curr.net += (j.net_total ?? 0);
      map.set(ymd, curr);
    }

    return Array.from(map.values()).sort((a, b) => a.ymd.localeCompare(b.ymd));
  }, [selectedRows, ranges.start, ranges.end]);

  const unknownCustomerCount = useMemo(() => {
    let c = 0;
    for (const j of selectedRows) {
      const name = clampNonEmpty((j as any)?.customer?.name);
      if (!name) c++;
    }
    return c;
  }, [selectedRows]);

  return (
    <div className="p-6 space-y-4">
      {/* Header (ca în UI vechi) */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Rapoarte (NET)</h1>
          <div className="text-sm text-muted-foreground">
            Venit net pe interval (lucrări cu status “Finalizat”)
          </div>
          <div className="text-sm text-muted-foreground">
            Interval: <span className="font-medium">{ranges.start}</span> →{" "}
            <span className="font-medium">{ranges.end}</span>
            {loading ? <span className="ml-2">• Se încarcă...</span> : null}
            {error ? <span className="ml-2 text-red-500">• {error}</span> : null}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <Input type="date" value={draftStart} onChange={(e) => setDraftStart(e.target.value)} />
          <Input type="date" value={draftEnd} onChange={(e) => setDraftEnd(e.target.value)} />
          <Button onClick={onRefresh} disabled={loading}>
            Refresh
          </Button>
        </div>
      </div>

      {/* Carduri sus */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Interval selectat */}
        <Card className="p-5">
          <div className="font-semibold mb-3">Interval selectat</div>

          <div className="text-sm text-muted-foreground mb-4">
            {ranges.start} → {ranges.end}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total net</span>
              <span className="font-semibold">{formatRON(selectedTotals.net)}</span>
            </div>

            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Lucrări finalizate</span>
              <span className="font-semibold">{selectedTotals.jobs}</span>
            </div>

            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Medie net / lucrare</span>
              <span className="font-semibold">{formatRON(selectedTotals.avg)}</span>
            </div>

            <div className="pt-3 mt-3 border-t space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Vs perioada precedentă</span>
                <span className="font-semibold">
                  {formatSignedRON(intervalDelta)} ({formatPct(intervalPct)})
                </span>
              </div>

              <div className="text-xs text-muted-foreground">
                Perioada precedentă: {ranges.prev.start} → {ranges.prev.end} ({prevTotals.jobs} lucrări)
              </div>
            </div>

            {unknownCustomerCount ? (
              <div className="pt-3 mt-3 border-t text-xs text-muted-foreground">
                Notă: {unknownCustomerCount} lucrări au “Client necunoscut”.
              </div>
            ) : null}
          </div>
        </Card>

        {/* Săptămână / Lună / An */}
        <Card className="p-5">
          <div className="font-semibold mb-1">Săptămână / Lună / An (RO)</div>
          <div className="text-xs text-muted-foreground mb-4">
            Calcul bazat pe NET (job_net_items). Lucrările fără NET contribuie cu 0.
          </div>

          <div className="space-y-4">
            {/* Week */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Săptămâna curentă</span>
                <span className="font-semibold">{formatRON(weekTotals.net)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Vs săptămâna precedentă</span>
                <span className="font-semibold">
                  {formatSignedRON(weekDelta)} ({formatPct(weekPct)})
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                {ranges.week.start} → {ranges.week.end}
              </div>
            </div>

            {/* Month */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Luna curentă</span>
                <span className="font-semibold">{formatRON(monthTotals.net)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Vs luna precedentă (MTD)</span>
                <span className="font-semibold">
                  {formatSignedRON(monthDelta)} ({formatPct(monthPct)})
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                {ranges.month.start} → {ranges.month.end}
              </div>
            </div>

            {/* Year */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Anul curent</span>
                <span className="font-semibold">{formatRON(yearTotals.net)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Vs anul precedent (YTD)</span>
                <span className="font-semibold">
                  {formatSignedRON(yearDelta)} ({formatPct(yearPct)})
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                {ranges.year.start} → {ranges.year.end}
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Venit net / zi */}
      <Card className="p-5">
        <div className="font-semibold mb-3">Venit net / zi</div>

        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left border-b">
              <tr>
                <th className="py-2 pr-3">Zi</th>
                <th className="py-2 pr-3">Lucrări</th>
                <th className="py-2 pr-3 text-right">Total net</th>
              </tr>
            </thead>
            <tbody>
              {dailyRows.map((r) => (
                <tr key={r.ymd} className="border-b last:border-b-0">
                  <td className="py-2 pr-3">{r.ymd}</td>
                  <td className="py-2 pr-3">{r.jobs}</td>
                  <td className="py-2 pr-3 text-right font-medium">{formatRON(r.net)}</td>
                </tr>
              ))}

              {!loading && dailyRows.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-6 text-center text-muted-foreground">
                    Nu există lucrări finalizate în interval.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="mt-3 text-xs text-muted-foreground">
          Notă: raportarea se bazează pe <span className="font-medium">created_at</span> al lucrării. Dacă vrei “data finalizării”
          exactă, raportăm după momentul din <span className="font-medium">job_status_history</span> când statusul devine “finished”.
        </div>

        <div className="mt-2 text-xs text-muted-foreground">
          Timezone: <span className="font-medium">{RO_ZONE}</span> • Acum:{" "}
          <span className="font-medium">{now.toFormat("yyyy-LL-dd HH:mm")}</span>
        </div>
      </Card>
    </div>
  );
}
