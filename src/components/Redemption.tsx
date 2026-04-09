import React, { useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { dataService } from "../services/dataService";
import { Ticket, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "../lib/utils";

export const Redemption: React.FC = () => {
  const { profile, refreshProfile } = useAuth();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const redeem = async () => {
    if (!profile || !code.trim()) return;
    setLoading(true);
    setStatus(null);
    try {
      await dataService.useCode(code.trim(), profile.uid);
      setStatus({ type: "success", message: "兑换成功！" });
      setCode("");
      refreshProfile();
    } catch (error: any) {
      console.error(error);
      setStatus({ type: "error", message: error.message || "兑换失败，请稍后再试" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 space-y-4">
      <div className="flex items-center gap-2 text-lg font-semibold tracking-tight">
        <Ticket className="w-5 h-5 text-zinc-500" />
        <h3>兑换码充值</h3>
      </div>
      <p className="text-sm text-zinc-500">输入您的兑换码以获取额度或激活天卡/月卡。</p>
      <div className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/10 dark:text-amber-300 text-xs leading-5">
        说明：天卡/月卡叠加时，只会顺延有效期，不会叠加或重置每日额度；每日额度仍按当前卡档位计算，并在每天 0 点刷新。
      </div>
      
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="输入兑换码"
          className="flex-1 px-4 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-500 transition-all font-mono"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <button
          onClick={redeem}
          disabled={loading || !code.trim()}
          className="px-6 py-2 text-sm font-medium text-white bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 rounded-xl hover:opacity-90 disabled:opacity-50 transition-all flex items-center gap-2"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "立即兑换"}
        </button>
      </div>

      {status && (
        <div
          className={cn(
            "p-3 rounded-xl text-sm flex items-center gap-2",
            status.type === "success" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400" : "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
          )}
        >
          {status.type === "success" ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {status.message}
        </div>
      )}
    </div>
  );
};
