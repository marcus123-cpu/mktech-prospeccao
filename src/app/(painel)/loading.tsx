export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Carregando">
      <div className="skeleton h-8 w-48 rounded-xl" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="skeleton h-24 rounded-2xl" style={{ animationDelay: `${i * 90}ms` }} />
        ))}
      </div>
    </div>
  );
}
