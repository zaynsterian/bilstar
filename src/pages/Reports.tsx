import { useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";
import { listFinishedJobsWithNetBetween, type JobRowWithCustomer } from "../lib/db";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronDown, ChevronUp, Download, Filter, Search, X } from "lucide-react";

const RO_ZONE = "Europe/Bucharest";

/**
 * IMPORTANT:
 * În anumite setup-uri TS/Vite/Tauri, `DateTime` ajunge interpretat ca namespace în poziție de tip.
 * Ca să evităm TS2709 ("Cannot use namespace 'DateTime' as a type"),
 * derivăm tipul concret dintr-un apel static.
 */
type LuxonDT = ReturnType<typeof DateTime.now>;
type DateRange = { start: LuxonDT; end: LuxonDT };

type SortKey = "customer" | "net" | "jobs" | "avg";
type SortDir = "asc" | "desc";

function startOfIsoWeekRO(dt: LuxonDT): LuxonDT {
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

// dacă query-ul tău folosește end exclusiv (cel mai safe pt timestamptz):
function toDbRangeExclusive(r: DateRange): { fromIso: string; toIsoExclusive: string } {
  const fromIso = r.start.startOf("day").toUTC().toISO()!;
  const toIsoExclusive = r.end.plus({ days: 1 }).startOf("day").toUTC().toISO()!;
  return { fromIso, toIsoExclusive };
}

function formatRON(amount: number): string {
  return new Intl.NumberFormat("ro-RO", { style: "currency", currency: "RON" }).format(amount);
}

function clampNonEmpty(s: string): string {
  return (s ?? "").trim();
}

/**
 * Convertește un Date (instant) la YYYY-MM-DD în timezone-ul dat, fără Luxon,
 * ca să nu depindem de parsing tricky.
 */
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

/**
 * Construiește o dată ISO (UTC) care reprezintă "ora locală" în timezone-ul dat.
 * Ex: value "2026-02-10T00:00" în Europe/Bucharest => ISO UTC corect.
 */
function toUtcIsoFromDatetimeLocalInTz(timeZone: string, value: string): string {
  // value trebuie să fie "YYYY-MM-DDTHH:mm"
  // 1) tratăm value ca dacă ar fi UTC (doar ca să obținem un Date)
  const assumedUtc = new Date(`${value}:00.000Z`);

  // 2) calculăm offset-ul zonei la acel moment
  const offsetMinutes = getTimeZoneOffsetMinutes(assumedUtc, timeZone);

  // 3) corectăm instantul astfel încât "ora locală" să fie cea dorită
  const correctedUtc = new Date(assumedUtc.getTime() - offsetMinutes * 60_000);
  return correctedUtc.toISOString();
}

/**
 * Offset în minute pentru un instant (Date) în timezone-ul dat.
 * return: cât trebuie adăugat la UTC ca să ajungi în timezone (semn inclus).
 */
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

  // construim un "UTC millis" din componentele interpretate ca dacă ar fi UTC
  const asUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );

  // diferența dintre "interpretarea în tz" și instantul real UTC
  return (asUTC - date.getTime()) / 60_000;
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map((x) => Number(x));
  const base = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)); // 12:00 UTC ca să evit DST edges
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

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function escapeCsvCell(v: unknown): string {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export default function Reports() {
  // UI date range (YYYY-MM-DD) în RO zone
  const [startYmd, setStartYmd] = useState(() => ymdInTimeZone(new Date(), RO_ZONE));
  const [endYmd, setEndYmd] = useState(() => ymdInTimeZone(new Date(), RO_ZONE));

  // Preset control
  const [preset, setPreset] = useState<"custom" | "week" | "month" | "year" | "prevWeek" | "prevMonth" | "prevYear">(
    "custom"
  );

  // Search & filters
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [filtersByKey, setFiltersByKey] = useState<Record<string, boolean>>({});

  // Sorting
  const [sortKey, setSortKey] = useState<SortKey>("net");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Data
  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState<JobRowWithCustomer[]>([]);
  const [error, setError] = useState<string | null>(null);

  const now = DateTime.now().setZone(RO_ZONE);

  const presetRangeLabel = useMemo(() => {
    const base = DateTime.now();
    let r: DateRange | null = null;

    if (preset === "week") r = weekRangeRO(base);
    if (preset === "month") r = monthRangeRO(base);
    if (preset === "year") r = yearRangeRO(base);
    if (preset === "prevWeek") r = shiftRange(weekRangeRO(base), { weeks: 1 });
    if (preset === "prevMonth") r = shiftRange(monthRangeRO(base), { months: 1 });
    if (preset === "prevYear") r = shiftRange(yearRangeRO(base), { years: 1 });

    return r ? fmtRange(r) : null;
  }, [preset]);

  function applyPreset(next: typeof preset) {
    setPreset(next);

    const base = DateTime.now();
    let r: DateRange | null = null;

    if (next === "week") r = weekRangeRO(base);
    if (next === "month") r = monthRangeRO(base);
    if (next === "year") r = yearRangeRO(base);
    if (next === "prevWeek") r = shiftRange(weekRangeRO(base), { weeks: 1 });
    if (next === "prevMonth") r = shiftRange(monthRangeRO(base), { months: 1 });
    if (next === "prevYear") r = shiftRange(yearRangeRO(base), { years: 1 });

    if (r) {
      // convertim range-ul (Luxon) în YYYY-MM-DD pentru UI
      setStartYmd(r.start.toISODate()!);
      setEndYmd(r.end.toISODate()!);
    }
  }

  function buildQueryRangeExclusive() {
    // UI end inclusiv, db end exclusiv
    const fromLocal = `${startYmd}T00:00`;
    const toLocalExclusive = `${addDaysYmd(endYmd, 1)}T00:00`;

    const fromIso = toUtcIsoFromDatetimeLocalInTz(RO_ZONE, fromLocal);
    const toIsoExclusive = toUtcIsoFromDatetimeLocalInTz(RO_ZONE, toLocalExclusive);

    return { fromIso, toIsoExclusive };
  }

  useEffect(() => {
    const { fromIso, toIsoExclusive } = buildQueryRangeExclusive();

    setLoading(true);
    setError(null);

    listFinishedJobsWithNetBetween(fromIso, toIsoExclusive)
      .then((rows) => setJobs(rows))
      .catch((e) => setError(e?.message ?? "Eroare la încărcarea raportului"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startYmd, endYmd]);

  const searchTerm = useMemo(() => clampNonEmpty(search).toLowerCase(), [search]);

  const grouped = useMemo(() => {
    // group by customer.name
    const map = new Map<string, JobRowWithCustomer[]>();
    for (const j of jobs) {
      const name = clampNonEmpty(j.customer?.name) || "Client necunoscut";
      const arr = map.get(name) ?? [];
      arr.push(j);
      map.set(name, arr);
    }
    return map;
  }, [jobs]);

  const reportRows = useMemo(() => {
    const rows = Array.from(grouped.entries()).map(([customer, items]) => {
      const net = items.reduce((s, it) => s + (it.net_total ?? 0), 0);
      const jobsCount = items.length;
      const avg = jobsCount ? net / jobsCount : 0;
      return { customer, net, jobs: jobsCount, avg };
    });

    // search filter
    const filtered = searchTerm
      ? rows.filter((r) => r.customer.toLowerCase().includes(searchTerm))
      : rows;

    // checkbox filters (if any enabled)
    const anyFilterEnabled = Object.values(filtersByKey).some(Boolean);
    const filtered2 = anyFilterEnabled
      ? filtered.filter((r) => filtersByKey[r.customer])
      : filtered;

    // sorting
    const dirMul = sortDir === "asc" ? 1 : -1;
    filtered2.sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      if (typeof va === "string" && typeof vb === "string") return va.localeCompare(vb) * dirMul;
      return (Number(va) - Number(vb)) * dirMul;
    });

    return filtered2;
  }, [grouped, searchTerm, filtersByKey, sortKey, sortDir]);

  const totals = useMemo(() => {
    const net = reportRows.reduce((s, r) => s + r.net, 0);
    const jobsCount = reportRows.reduce((s, r) => s + r.jobs, 0);
    const avg = jobsCount ? net / jobsCount : 0;
    const days = daysBetweenInclusive(startYmd, endYmd);
    return { net, jobsCount, avg, days };
  }, [reportRows, startYmd, endYmd]);

  const customersForFilter = useMemo(() => {
    const all = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b));
    return all;
  }, [grouped]);

  // keep filtersByKey in sync with customers list
  useEffect(() => {
    setFiltersByKey((prev) => {
      const next: Record<string, boolean> = {};
      for (const name of customersForFilter) next[name] = prev[name] ?? false;
      return next;
    });
  }, [customersForFilter]);

  function toggleSort(k: SortKey) {
    if (sortKey !== k) {
      setSortKey(k);
      setSortDir("desc");
      return;
    }
    setSortDir((d) => (d === "desc" ? "asc" : "desc"));
  }

  function exportCsv() {
    const header = ["Client", "Net (RON)", "Număr lucrări", "Medie / lucrare (RON)"];
    const lines = [header.join(",")];

    for (const r of reportRows) {
      lines.push(
        [
          escapeCsvCell(r.customer),
          escapeCsvCell(r.net.toFixed(2)),
          escapeCsvCell(r.jobs),
          escapeCsvCell(r.avg.toFixed(2)),
        ].join(",")
      );
    }

    const file = `raport_${startYmd}_${endYmd}.csv`;
    downloadCsv(file, lines.join("\n"));
  }

  const sortIcon = (k: SortKey) => {
    if (sortKey !== k) return null;
    return sortDir === "asc" ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />;
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Rapoarte</h1>
          <div className="text-sm text-muted-foreground">
            Interval: <span className="font-medium">{startYmd}</span> →{" "}
            <span className="font-medium">{endYmd}</span>{" "}
            {presetRangeLabel ? (
              <Badge variant="secondary" className="ml-2">
                preset: {presetRangeLabel}
              </Badge>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setShowFilters((v) => !v)}>
            <Filter className="h-4 w-4 mr-2" /> Filtre
          </Button>

          <Button variant="outline" onClick={exportCsv} disabled={!reportRows.length}>
            <Download className="h-4 w-4 mr-2" /> Export CSV
          </Button>
        </div>
      </div>

      <Card className="p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-3 space-y-1">
            <label className="text-sm font-medium">De la</label>
            <Input
              type="date"
              value={startYmd}
              onChange={(e) => {
                setPreset("custom");
                setStartYmd(e.target.value);
              }}
            />
          </div>

          <div className="md:col-span-3 space-y-1">
            <label className="text-sm font-medium">Până la</label>
            <Input
              type="date"
              value={endYmd}
              onChange={(e) => {
                setPreset("custom");
                setEndYmd(e.target.value);
              }}
            />
          </div>

          <div className="md:col-span-6 space-y-1">
            <label className="text-sm font-medium">Preseturi</label>
            <div className="flex flex-wrap gap-2">
              <Button variant={preset === "week" ? "default" : "outline"} onClick={() => applyPreset("week")}>
                Săptămâna curentă
              </Button>
              <Button variant={preset === "month" ? "default" : "outline"} onClick={() => applyPreset("month")}>
                Luna curentă
              </Button>
              <Button variant={preset === "year" ? "default" : "outline"} onClick={() => applyPreset("year")}>
                Anul curent
              </Button>

              <Button variant={preset === "prevWeek" ? "default" : "outline"} onClick={() => applyPreset("prevWeek")}>
                Săptămâna trecută
              </Button>
              <Button variant={preset === "prevMonth" ? "default" : "outline"} onClick={() => applyPreset("prevMonth")}>
                Luna trecută
              </Button>
              <Button variant={preset === "prevYear" ? "default" : "outline"} onClick={() => applyPreset("prevYear")}>
                Anul trecut
              </Button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-6 space-y-1">
            <label className="text-sm font-medium">Caută client</label>
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="ex: Popescu"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search ? (
                <button
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </div>

          <div className="md:col-span-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card className="p-3">
              <div className="text-xs text-muted-foreground">Net total</div>
              <div className="text-lg font-semibold">{formatRON(totals.net)}</div>
            </Card>
            <Card className="p-3">
              <div className="text-xs text-muted-foreground">Lucrări</div>
              <div className="text-lg font-semibold">{totals.jobsCount}</div>
            </Card>
            <Card className="p-3">
              <div className="text-xs text-muted-foreground">Medie / lucrare</div>
              <div className="text-lg font-semibold">{formatRON(totals.avg)}</div>
            </Card>
          </div>
        </div>

        {showFilters ? (
          <div className="border rounded-md p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">Filtre pe clienți</div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFiltersByKey((prev) => Object.fromEntries(Object.keys(prev).map((k) => [k, false])))}
              >
                Reset
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {customersForFilter.map((name) => (
                <label key={name} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={filtersByKey[name] ?? false}
                    onCheckedChange={(v) => setFiltersByKey((p) => ({ ...p, [name]: !!v }))}
                  />
                  <span className="truncate">{name}</span>
                </label>
              ))}
            </div>
          </div>
        ) : null}
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm text-muted-foreground">
            {loading ? "Se încarcă..." : `Rezultate: ${reportRows.length} clienți`}
            {error ? <span className="text-red-500 ml-2">{error}</span> : null}
          </div>

          <div className="flex items-center gap-2 text-sm">
            <Button variant="ghost" size="sm" onClick={() => toggleSort("customer")}>
              Client {sortIcon("customer")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => toggleSort("net")}>
              Net {sortIcon("net")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => toggleSort("jobs")}>
              Lucrări {sortIcon("jobs")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => toggleSort("avg")}>
              Medie {sortIcon("avg")}
            </Button>
          </div>
        </div>

        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left border-b">
              <tr>
                <th className="py-2 pr-3">Client</th>
                <th className="py-2 pr-3">Net</th>
                <th className="py-2 pr-3">Lucrări</th>
                <th className="py-2 pr-3">Medie / lucrare</th>
              </tr>
            </thead>
            <tbody>
              {reportRows.map((r) => (
                <tr key={r.customer} className="border-b last:border-b-0">
                  <td className="py-2 pr-3">
                    <div className="font-medium">{r.customer}</div>
                  </td>
                  <td className="py-2 pr-3">{formatRON(r.net)}</td>
                  <td className="py-2 pr-3">{r.jobs}</td>
                  <td className="py-2 pr-3">{formatRON(r.avg)}</td>
                </tr>
              ))}
              {!loading && !reportRows.length ? (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-muted-foreground">
                    Nu există date pentru intervalul selectat.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="mt-3 text-xs text-muted-foreground">
          Timezone: <span className="font-medium">{RO_ZONE}</span> • Acum:{" "}
          <span className="font-medium">{now.toFormat("yyyy-LL-dd HH:mm")}</span>
        </div>
      </Card>
    </div>
  );
}
