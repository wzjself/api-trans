import React, { useState, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { dataService } from "../services/dataService";
import { Plus, Trash2, Copy, Check } from "lucide-react";
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
      await dataService.addApiKey(profile.uid, newKeyName);
      setNewKeyName("");
    } catch (error) {
      console.error(error);
    } finally {
      setIsCreating(false);
    }
  };

  const deleteKey = async (id: string) => {
    try {
      await dataService.revokeApiKey(id);
    } catch (error) {
      console.error(error);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold tracking-tight">API 密钥管理</h2>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="密钥名称"
            className="px-3 py-1.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-500 transition-all"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
          />
          <button
            onClick={createKey}
            disabled={isCreating || !newKeyName.trim()}
            className="flex items-center gap-2 px-4 py-1.5 text-sm font-medium text-white bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 rounded-lg hover:opacity-90 disabled:opacity-50 transition-all"
          >
            <Plus className="w-4 h-4" />
            新建密钥
          </button>
        </div>
      </div>

      <div className="grid gap-4">
        <AnimatePresence mode="popLayout">
          {keys.map((key) => (
            <motion.div
              key={key.id}
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 flex items-center justify-between group"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{key.name}</span>
                  <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                    {key.status}
                  </span>
                </div>
                <div className="flex items-center gap-2 font-mono text-xs text-zinc-500">
                  <span>{key.key}</span>
                  <button
                    onClick={() => copyToClipboard(key.key, key.id)}
                    className="p-1 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
                  >
                    {copiedId === key.id ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
              </div>
              <button
                onClick={() => deleteKey(key.id)}
                className="p-2 text-zinc-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
        {keys.length === 0 && (
          <div className="py-12 text-center text-zinc-500 border-2 border-dashed border-zinc-100 dark:border-zinc-900 rounded-2xl">
            暂无 API 密钥，请创建一个。
          </div>
        )}
      </div>
    </div>
  );
};
