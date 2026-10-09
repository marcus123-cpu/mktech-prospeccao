import { PRIORITIES, PRIORITY_LABEL, SITE_LABEL, SITE_STATUSES } from "@/lib/labels";

export type LeadFormValues = {
  business_name?: string;
  responsible_name?: string | null;
  niche?: string | null;
  services?: string[];
  city?: string;
  state?: string;
  neighborhood?: string | null;
  unit_label?: string | null;
  phone_raw?: string | null;
  instagram_raw?: string | null;
  whatsapp_url?: string | null;
  website_url?: string | null;
  selection_reason?: string | null;
  pending_items?: string | null;
  priority?: string;
  site_status?: string;
};

function Field({ label, name, initial, ...rest }: { label: string; name: string; initial?: string | null } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <input className="input" id={name} name={name} defaultValue={initial ?? ""} {...rest} />
    </div>
  );
}

/** Campos cadastrais do lead (sem dados comerciais). Usado em "Novo lead" e "Editar dados". */
export function LeadFields({ v = {} }: { v?: LeadFormValues }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Nome comercial *" name="business_name" initial={v.business_name} required maxLength={200} />
      <Field label="Profissional / responsável" name="responsible_name" initial={v.responsible_name} maxLength={200} />
      <Field label="Cidade *" name="city" initial={v.city} required maxLength={120} />
      <div className="grid grid-cols-3 gap-3">
        <Field label="UF" name="state" initial={v.state ?? "SP"} maxLength={2} pattern="[A-Za-z]{2}" />
        <div className="col-span-2">
          <Field label="Bairro" name="neighborhood" initial={v.neighborhood} maxLength={120} />
        </div>
      </div>
      <Field label="Unidade (se houver mais de uma)" name="unit_label" initial={v.unit_label} maxLength={120} placeholder="Ex.: Centro, Shopping" />
      <Field label="Telefone / WhatsApp" name="phone" initial={v.phone_raw} maxLength={40} placeholder="(17) 99999-9999" />
      <Field label="Instagram" name="instagram" initial={v.instagram_raw} maxLength={200} placeholder="@perfil ou link" />
      <Field label="Link do WhatsApp" name="whatsapp_url" initial={v.whatsapp_url} maxLength={2000} placeholder="https://wa.me/…" />
      <Field label="Site próprio" name="website_url" initial={v.website_url} maxLength={2000} />
      <Field label="Nicho" name="niche" initial={v.niche} maxLength={200} placeholder="Estética facial" />
      <Field label="Serviços (separados por vírgula)" name="services" initial={(v.services ?? []).join(", ")} maxLength={2000} />
      <div>
        <label className="label" htmlFor="site_status">Verificação de site</label>
        <select className="input" id="site_status" name="site_status" defaultValue={v.site_status ?? "verificacao_pendente"}>
          {SITE_STATUSES.map((s) => (
            <option key={s} value={s}>{SITE_LABEL[s]}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="priority">Prioridade</label>
        <select className="input" id="priority" name="priority" defaultValue={v.priority ?? "media"}>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="selection_reason">Motivo da seleção</label>
        <textarea className="input" id="selection_reason" name="selection_reason" rows={2} defaultValue={v.selection_reason ?? ""} maxLength={2000} />
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="pending_items">Pendências</label>
        <textarea className="input" id="pending_items" name="pending_items" rows={2} defaultValue={v.pending_items ?? ""} maxLength={2000} />
      </div>
    </div>
  );
}
