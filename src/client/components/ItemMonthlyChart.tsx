import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { buildItemMonthlySeries } from "../lib/costs";
import { formatMoney } from "../lib/format";
import type { CostEntry } from "../types";

export default function ItemMonthlyChart({
  entries,
  year,
}: {
  entries: CostEntry[];
  year: number;
}) {
  const { series } = buildItemMonthlySeries(entries, year);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart
        data={series}
        margin={{ top: 12, right: 8, left: 0, bottom: 0 }}
      >
        <defs>
          <linearGradient id="itemSpendGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.46} />
            <stop offset="58%" stopColor="#4f7cff" stopOpacity={0.14} />
            <stop offset="100%" stopColor="#4f46e5" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid
          stroke="#dce5f2"
          strokeDasharray="4 5"
          vertical={false}
        />
        <XAxis
          dataKey="month"
          axisLine={false}
          tickLine={false}
          minTickGap={12}
          tick={{ fill: "#64748b", fontSize: 10 }}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          width={56}
          tick={{ fill: "#64748b", fontSize: 10 }}
          tickFormatter={(value) => formatMoney(Number(value), true)}
        />
        <Tooltip
          contentStyle={{ borderRadius: 12, border: "1px solid #dce5f2" }}
          formatter={(value) => [formatMoney(Number(value)), "Spend"]}
        />
        <Area
          type="monotone"
          dataKey="spend"
          stroke="#2563eb"
          strokeWidth={3}
          fill="url(#itemSpendGradient)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
