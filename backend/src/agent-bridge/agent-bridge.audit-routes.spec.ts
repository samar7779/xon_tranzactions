import { describeRoute } from '../audit/audit.routes';

// audit.routes o'zgarishi: agent-bridge run yo'li o'qiladigan nom bilan yozilsin, boshqa yo'llar o'zgarmasin.
describe('describeRoute (agent-bridge)', () => {
  it.each(['sheet-1723456789012-0', 'sheet-1', 'custom_id'])('POST agent-bridge/exports/%s/run → aniq nom', (id) => {
    expect(describeRoute('POST', `/api/agent-bridge/exports/${id}/run`)).toEqual({
      module: 'agent-bridge',
      action: 'Agent: Google eksport ishga tushirildi',
    });
  });

  it('regressiya: mavjud yo\'llar o\'zgarmagan', () => {
    expect(describeRoute('PATCH', '/api/users/ckxxxxxxxxxxxxxxxxxxxxxx')).toEqual({ module: 'users', action: 'Foydalanuvchi yangilandi' });
    expect(describeRoute('POST', '/api/oplata-kv/ckxxxxxxxxxxxxxxxxxxxxxx/split')).toEqual({ module: 'oplatykv', action: "To'lov bo'lindi (split)" });
    expect(describeRoute('POST', '/api/google-export/run').module).toBe('export');
  });
});
