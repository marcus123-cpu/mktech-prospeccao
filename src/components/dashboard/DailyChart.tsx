"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Point = { day: string; new_leads: number; contacts: number };

export function DailyChart({ data }: { data: Point[] }) {
  const rows = data.map((d) => ({ ...d, label: `${d.day.slice(8, 10)}/${d.day.slice(5, 7)}` }));
  return (
    <div className="h-64 w-full" role="img" aria-label="Novos leads e contatos por dia">
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid stroke="#262b3d" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: "#8b93ad", fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={{ fill: "#8b93ad", fontSize: 12 }} axisLine={false} tickLine={false} />
          <Tooltip
            cursor={{ fill: "rgba(124,108,255,0.08)" }}
            contentStyle={{ background: "#181c2b", border: "1px solid #262b3d", borderRadius: 8, color: "#e6e8f0" }}
          />
          <Legend wrapperStyle={{ color: "#8b93ad", fontSize: 12 }} />
          <Bar dataKey="new_leads" name="Novos leads" fill="#7c6cff" radius={[4, 4, 0, 0]} />
          <Bar dataKey="contacts" name="Contatos realizados" fill="#5b8cff" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
