import { describe, expect, it } from 'vitest';
import { beforeEach } from 'vitest';
import { asAdmin, asService, resetData, rpc } from './helpers';

const svc = (sql: string, args: unknown[] = []) => asService(c => rpc<any>(c, sql, args));
const adm = (sql: string, args: unknown[] = []) => asAdmin(c => rpc<any>(c, sql, args));
const get = () => adm('select row_to_json(x) from admin_whatsapp_connection() x');

describe('conexão do WhatsApp', () => {
  beforeEach(async () => { await resetData(); });
  it('guarda o QR enquanto desconectado e apaga quando conecta', async () => {
    await svc('select api_whatsapp_connection_set($1,$2,$3,$4)', [false, null, 'aguardando leitura do QR', '2@abc,def']);
    expect(await get()).toMatchObject({ ready: false, qr: '2@abc,def', connected_since: null });
    await svc('select api_whatsapp_connection_set($1,$2,$3,$4)', [true, '5517992096353', 'conectado', '2@nao-deve-ficar']);
    const on = await get();
    expect(on).toMatchObject({ ready: true, qr: null, qr_at: null, phone_number: '5517992096353' });
    expect(on.connected_since).toBeTruthy();
    await svc('select api_whatsapp_connection_set($1,$2,$3,$4)', [false, null, 'desconectado', null]);
    expect(await get()).toMatchObject({ ready: false, qr: null, connected_since: null, phone_number: '5517992096353' });
  });
});
