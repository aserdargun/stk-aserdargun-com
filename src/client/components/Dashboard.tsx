import { useEffect, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CalendarRange,
  Layers3,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../lib/api";
import { formatDate, formatMoney } from "../lib/format";
import type { Category, DashboardData } from "../types";

const categoryColors: Record<Category, string> = {
  Platform: "#38bdf8",
  Certificate: "#f59e0b",
  Device: "#4f7cff",
  Other: "#818cf8",
};

function StatCard({
  label,
  value,
  note,
  icon,
  tone = "green",
}: {
  label: string;
  value: string;
  note: React.ReactNode;
  icon: React.ReactNode;
  tone?: "green" | "yellow" | "blue" | "purple";
}) {
  return (
    <article className={`stat-card tone-${tone}`}>
      <div className="stat-head">
        <span>{label}</span>
        <span className="stat-icon">{icon}</span>
      </div>
      <strong>{value}</strong>
      <div className="stat-note">{note}</div>
    </article>
  );
}

export function Dashboard({ onOpenCosts }: { onOpenCosts: () => void }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [year, setYear] = useState<number>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api
      .getDashboard(year)
      .then((response) => {
        setData(response);
        setYear(response.year);
        setError(null);
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [year]);

  if (loading && !data) return <div className="page-state">Loading your portfolio…</div>;
  if (error || !data) return <div className="page-state error">{error || "Dashboard data is unavailable."}</div>;

  const yoy = data.metrics.yearOverYearPercent;
  const yoyPositive = yoy !== null && yoy >= 0;

  return (
    <div className="page-stack">
      <section className="page-heading">
        <div>
          <span className="eyebrow">Portfolio overview</span>
          <h1>Know what your stack costs.</h1>
          <p>Track recurring tools, career investments, and hardware from one private ledger.</p>
        </div>
        <label className="year-picker">
          <CalendarRange size={17} />
          <span>Analysis year</span>
          <select value={data.year} onChange={(event) => setYear(Number(event.target.value))}>
            {data.availableYears.map((option) => (
              <option value={option} key={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="stats-grid" aria-label="Portfolio metrics">
        <StatCard
          label="Lifetime spend"
          value={formatMoney(data.metrics.lifetimeSpend)}
          note={`Across ${data.metrics.trackedItems} tracked items`}
          icon={<Wallet size={19} />}
        />
        <StatCard
          label={`${data.year} spend`}
          value={formatMoney(data.metrics.yearSpend)}
          note={
            yoy === null ? (
              "No prior-year baseline"
            ) : (
              <span className={yoyPositive ? "delta up" : "delta down"}>
                {yoyPositive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                {Math.abs(yoy).toFixed(1)}% vs {data.year - 1}
              </span>
            )
          }
          icon={<TrendingUp size={19} />}
          tone="yellow"
        />
        <StatCard
          label="Latest monthly spend"
          value={formatMoney(data.metrics.latestMonthlySpend)}
          note={data.metrics.latestMonthlyPeriod ? formatDate(data.metrics.latestMonthlyPeriod, { month: "long", year: "numeric" }) : "No monthly entries"}
          icon={<Activity size={19} />}
          tone="blue"
        />
        <StatCard
          label="Active costs"
          value={String(data.metrics.activeItems)}
          note={`${data.metrics.closedItems} closed · ${data.metrics.trackedItems} total`}
          icon={<Layers3 size={19} />}
          tone="purple"
        />
      </section>

      <section className="analytics-grid">
        <article className="panel chart-panel wide">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">Monthly pulse</span>
              <h2>{data.year} monthly platform spend</h2>
            </div>
            <span className="legend-chip mint">Monthly entries</span>
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.monthlySeries} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="spendGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.46} />
                    <stop offset="58%" stopColor="#4f7cff" stopOpacity={0.14} />
                    <stop offset="100%" stopColor="#4f46e5" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#dce5f2" strokeDasharray="4 5" vertical={false} />
                <XAxis
                  dataKey="month"
                  axisLine={false}
                  tickLine={false}
                  minTickGap={16}
                  tick={{ fill: "#64748b", fontSize: 11 }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  width={62}
                  tick={{ fill: "#64748b", fontSize: 11 }}
                  tickFormatter={(value) => formatMoney(Number(value), true)}
                />
                <Tooltip
                  contentStyle={{ borderRadius: 12, border: "1px solid #dce5f2" }}
                  formatter={(value) => [formatMoney(Number(value)), "Spend"]}
                />
                <Area type="monotone" dataKey="spend" stroke="#2563eb" strokeWidth={3} fill="url(#spendGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          {data.metrics.annualOnlySpend !== 0 && (
            <p className="chart-note">
              {formatMoney(data.metrics.annualOnlySpend)} in annual-only or reconciliation entries is included in yearly totals but excluded here because the source workbook did not provide exact months.
            </p>
          )}
        </article>

        <article className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">Portfolio mix</span>
              <h2>Lifetime allocation</h2>
            </div>
          </div>
          <div className="donut-layout">
            <div className="donut-chart">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.lifetimeCategories}
                    dataKey="spend"
                    nameKey="category"
                    innerRadius={62}
                    outerRadius={90}
                    paddingAngle={3}
                    stroke="none"
                  >
                    {data.lifetimeCategories.map((entry) => (
                      <Cell key={entry.category} fill={categoryColors[entry.category]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => formatMoney(Number(value))} />
                </PieChart>
              </ResponsiveContainer>
              <div className="donut-center">
                <strong>{data.lifetimeCategories.length}</strong>
                <span>categories</span>
              </div>
            </div>
            <div className="category-legend">
              {data.lifetimeCategories.map((entry) => (
                <div key={entry.category}>
                  <span className="color-dot" style={{ background: categoryColors[entry.category] }} />
                  <span>{entry.category}</span>
                  <strong>{formatMoney(entry.spend, true)}</strong>
                </div>
              ))}
            </div>
          </div>
        </article>

        <article className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">Annual view</span>
              <h2>Spend by year</h2>
            </div>
          </div>
          <div className="chart-wrap compact">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.yearlySeries} margin={{ top: 10, right: 5, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#dce5f2" strokeDasharray="4 5" vertical={false} />
                <XAxis dataKey="year" axisLine={false} tickLine={false} tick={{ fill: "#64748b" }} />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  width={62}
                  tick={{ fill: "#64748b", fontSize: 11 }}
                  tickFormatter={(value) => formatMoney(Number(value), true)}
                />
                <Tooltip formatter={(value) => [formatMoney(Number(value)), "Spend"]} />
                <Bar dataKey="spend" fill="#4f7cff" radius={[8, 8, 2, 2]} maxBarSize={72} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="panel top-costs-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">Largest commitments</span>
              <h2>Top costs in {data.year}</h2>
            </div>
            <button className="text-button" onClick={onOpenCosts}>
              View all <ArrowRight size={15} />
            </button>
          </div>
          <div className="top-cost-list">
            {data.topItems.map((item, index) => (
              <button key={item.id} onClick={onOpenCosts}>
                <span className="rank">{String(index + 1).padStart(2, "0")}</span>
                <span className="top-cost-name">
                  <strong>{item.name}</strong>
                  <small>{item.category}</small>
                </span>
                <strong>{formatMoney(item.spend)}</strong>
              </button>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}
