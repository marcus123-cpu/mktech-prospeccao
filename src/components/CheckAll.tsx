"use client";

/** Marca ou desmarca todas as caixas com o mesmo nome dentro do formulário. */
export function CheckAll({ name }: { name: string }) {
  return (
    <input
      type="checkbox"
      aria-label="Marcar todos desta página"
      onChange={(e) => {
        const form = e.currentTarget.form;
        form?.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name="${name}"]`).forEach((c) => { c.checked = e.currentTarget.checked; });
      }}
    />
  );
}
