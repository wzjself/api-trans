import React, { useState, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { dataService } from "../services/dataService";
import { Plus, Trash2, Copy, Check, FlaskConical, AlertTriangle } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface ApiKey {
  id: string;
  name: string;
  key: string;
  createdAt: any;
  status: "active" | "revoked";
}

export const ApiKeyManager: React.FC = () => {
  const { profile } = useAuth();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [pendingDelete, setPendingDelete] = useState<ApiKey | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const safeCopy = async (text: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {}
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  };

  useEffect(() => {
    if (!profile) return;
    const unsubscribe = dataService.subscribeApiKeys(profile.uid, (data) => {
      setKeys(data as ApiKey[]);
    });
    return () => unsubscribe();
  }, [profile]);

  const createKey = async () => {
    if (!profile || !newKeyName.trim()) return;
    setIsCreating(true);
    try {
      const created = await dataService.addApiKey(profile.uid, newKeyName.trim());
      const normalized: ApiKey = {
        id: created.id,
        name: created.name,
        key: created.key,
        createdAt: created.createdAt || new Date().toISOString(),
        status: created.status || "active",
      };
      setKeys((prev) => [normalized, ...prev.filter((item) => item.id !== normalized.id)]);
      setNewKeyName("");
      const copied = await safeCopy(normalized.key);
      if (copied) {
        setCopiedId(normalized.id);
        setTimeout(() => setCopiedId(null), 2000);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsCreating(false);
    }
  };

  const confirmDeleteKey = async () => {
    if (!pendingDelete) return;
    setIsDeleting(true);
    try {
      await dataService.revokeApiKey(pendingDelete.id);
      setKeys((prev) => prev.filter((item) => item.id !== pendingDelete.id));
      setTestResult((prev) => {
        const next = { ...prev };
        delete next[pendingDelete.id];
        return next;
      });
      setPendingDelete(null);
    } catch (error) {
      console.error(error);
    } finally {
      setIsDeleting(false);
    }
  };

  const copyToClipboard = async (text: string, id: string) => {
    const copied = await safeCopy(text);
    if (!copied) return;
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const testKey = async (id: string) => {
    setTestingId(id);
    try {
      const result = await dataService.testApiKeyModels(id);
      if (result.ok) {
        setTestResult((prev) => ({ ...prev, [id]: `成功：${(result.models || []).slice(0, 8).join(', ') || '已连通'}` }));
      } else {
        setTestResult((prev) => ({ ...prev, [id]: `失败：HTTP ${result.status}` }));
      }
    } catch (error: any) {
      setTestResult((prev) => ({ ...prev, [id]: `失败：${error.message || '请求异常'}` }));
    } finally {
      setTestingId(null);
    }
  };

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold tracking-tight">API 密钥管理</h2>
          <div className="flex gap-2">
            <input type="text" placeholder="密钥名称" className="px-3 py-1.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-500 transition-all" value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} />
            <button onClick={createKey} disabled={isCreating || !newKeyName.trim()} className="flex items-center gap-2 px-4 py-1.5 text-sm font-medium text-white bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 rounded-lg hover:opacity-90 disabled:opacity-50 transition-all"><Plus className="w-4 h-4" />{isCreating ? "生成中..." : "新建密钥"}</button>
          </div>
        </div>

        <div className="grid gap-4">
          <AnimatePresence mode="popLayout">
            {keys.map((key) => (
              <motion.div key={key.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 flex items-center justify-between group">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{key.name}</span>
                    <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">{key.status}</span>
                  </div>
                  <div className="flex items-center gap-2 font-mono text-xs text-zinc-500">
                    <span>{key.key}</span>
                    <button type="button" onClick={() => copyToClipboard(key.key, key.id)} className="p-1 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors">{copiedId === key.id ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}</button>
                  </div>
                  {testResult[key.id] && <div className="text-xs text-zinc-500">{testResult[key.id]}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => testKey(key.id)} className="p-2 text-zinc-400 hover:text-blue-500 transition-all" disabled={testingId === key.id} title="测试 /v1/models">
                    <FlaskConical className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => setPendingDelete(key)} className="p-2 text-zinc-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"><Trash2 className="w-4 h-4" /></button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {keys.length === 0 && <div className="py-12 text-center text-zinc-500 border-2 border-dashed border-zinc-100 dark:border-zinc-900 rounded-2xl">暂无 API 密钥，请创建一个。</div>}
        </div>
      </div>

      <AnimatePresence>
        {pendingDelete && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="w-full max-w-md p-8 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xl space-y-6">
              <div className="space-y-3 text-center">
                <div className="w-14 h-14 mx-auto rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
                  <AlertTriangle className="w-7 h-7 text-red-500" />
                </div>
                <div>
                  <h3 className="text-xl font-bold tracking-tight">确认删除 API 密钥</h3>
                  <p className="text-sm text-zinc-500 mt-2">将要删除：<span className="font-medium text-zinc-900 dark:text-zinc-100">{pendingDelete.name}</span></p>
                  <p className="text-xs text-zinc-400 mt-1 break-all">{pendingDelete.key}</p>
                </div>
                <p className="text-sm text-red-500">删除后不可恢复。</p>
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setPendingDelete(null)} className="flex-1 py-3 text-sm font-medium rounded-xl border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all">取消</button>
                <button type="button" onClick={confirmDeleteKey} disabled={isDeleting} className="flex-1 py-3 text-sm font-medium text-white bg-red-600 rounded-xl hover:opacity-90 disabled:opacity-50 transition-all">{isDeleting ? '删除中...' : '确认删除'}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
};
