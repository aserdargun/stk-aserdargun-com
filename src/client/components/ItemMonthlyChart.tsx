import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatMoney } from "../lib/format";

export function ItemMonthlyChart({
  data,
}: {
  data: Array<{ period: string; month: string; spend: number }>;
}) {
  return (
    <div className="detail-chart-wrap" aria-label="Monthly cost distribution">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="detailSpendGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#55d6a4" stopOpacity={0.45} />
              <stop offset="100%" stopColor="#55d6a4" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#dbe6e1" strokeDasharray="4 5" vertical={false} />
          <XAxis
            dataKey="month"
            axisLine={false}
            tickLine={false}
            minTickGap={12}
            tick={{ fill: "#6b7c75", fontSize: 10 }}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            width={58}
            tick={{ fill: "#6b7c75", fontSize: 10 }}
            tickFormatter={(value) => formatMoney(Number(value), true)}
          />
          <Tooltip
            contentStyle={{ borderRadius: 12, border: "1px solid #dbe6e1" }}
            formatter={(value) => [formatMoney(Number(value)), "Spend"]}
          />
          <Area
            type="monotone"
            dataKey="spend"
            stroke="#159d73"
            strokeWidth={3}
            fill="url(#detailSpendGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
