"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Point = { label: string; saudacoes: number; respostas: number };

export function EnvioChart({ data }: { data: Point[] }) {
  return (
    <div className="h-56 w-full" role="img" aria-label="Saudações enviadas e respostas de pessoas por dia">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid stroke="#262b3d" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: "#8b93ad", fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={{ fill: "#8b93ad", fontSize: 12 }} axisLine={false} tickLine={false} />
          <Tooltip
            cursor={{ fill: "rgba(124,108,255,0.08)" }}
            contentStyle={{ background: "#181c2b", border: "1px solid #262b3d", borderRadius: 8, color: "#e6e8f0" }}
          />
          <Legend wrapperStyle={{ color: "#8b93ad", fontSize: 12 }} />
          <Bar dataKey="saudacoes" name="Abordados" fill="#7c6cff" radius={[4, 4, 0, 0]} />
          <Bar dataKey="respostas" name="Respostas de pessoas" fill="#2dd4bf" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
