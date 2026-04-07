import { apiClient } from "./apiClient";

export const dataService = {
  subscribeApiKeys: (uid: string, callback: (keys: any[]) => void) => {
    let cancelled = false;
    apiClient.get('/api/users/me/api-keys').then((data) => {
      if (!cancelled) callback(data as any[]);
    }).catch(console.error);
    return () => { cancelled = true; };
  },

  addApiKey: async (_uid: string, name: string) => {
    return apiClient.post('/api/users/me/api-keys', { name });
  },

  revokeApiKey: async (id: string) => {
    return apiClient.delete(`/api/api-keys/${id}`);
  },

  subscribeLogs: (uid: string, callback: (logs: any[]) => void, limitCount?: number) => {
    let cancelled = false;
    const qs = limitCount ? `?limit=${limitCount}` : '';
    apiClient.get(`/api/users/me/logs${qs}`).then((data: any[]) => {
      if (cancelled) return;
      const formatted = data.map((l: any) => ({
        ...l,
        timestamp: { toDate: () => new Date(l.timestamp) },
      }));
      callback(formatted);
    }).catch(console.error);
    return () => { cancelled = true; };
  },

  addLog: async (_uid: string, tokens: number, model: string) => {
    return apiClient.post('/api/users/me/logs/simulate', { tokens, model });
  },

  useCode: async (code: string, _uid: string) => {
    return apiClient.post('/api/redeem', { code });
  },

  subscribeAllUsers: (callback: (users: any[]) => void) => {
    let cancelled = false;
    apiClient.get('/api/admin/users').then((data) => {
      if (!cancelled) callback(data as any[]);
    }).catch(console.error);
    return () => { cancelled = true; };
  },

  subscribeAllCodes: (callback: (codes: any[]) => void) => {
    let cancelled = false;
    apiClient.get('/api/admin/codes').then((data) => {
      if (!cancelled) callback(data as any[]);
    }).catch(console.error);
    return () => { cancelled = true; };
  },

  addCode: async (codeData: any) => {
    return apiClient.post('/api/admin/codes', codeData);
  },

  deleteCode: async (code: string) => {
    return apiClient.delete(`/api/admin/codes/${encodeURIComponent(code)}`);
  },

  updateUserBalance: async (uid: string, balance: number) => {
    return apiClient.patch(`/api/admin/users/${uid}/balance`, { balance });
  },

  subscribeSettings: (callback: (settings: any) => void) => {
    let cancelled = false;
    apiClient.get('/api/settings').then((data) => {
      if (!cancelled) callback(data);
    }).catch(console.error);
    return () => { cancelled = true; };
  },

  updateSettings: async (settings: any) => {
    return apiClient.put('/api/settings', settings);
  }
};
