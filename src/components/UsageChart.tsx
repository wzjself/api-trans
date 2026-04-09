import React, { useState, useEffect, useMemo } from "react";
import { useAuth } from "../contexts/AuthContext";
import { dataService } from "../services/dataService";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Activity, Zap, PieChart } from "lucide-react";
import { cn } from "../lib/utils";

export const UsageChart: React.FC = () => {
  const { profile } = useAuth();
  const [chartData, setChartData] = useState<{ name: string; tokens: number }[]>([]);
  const [view, setView] = useState<"hourly" | "daily">("daily");

  useEffect(() => {
    if (!profile) return;
    const unsubscribe = dataService.subscribeUserUsageTrend(view, (data) => {
      setChartData(Array.isArray(data) ? data : []);
    });
    return () => unsubscribe();
  }, [profile, view]);

  const stats = useMemo(() => {
    const totalTokens = Number(profile?.usedQuota || 0);
    const totalCount = Number(profile?.requestCount || 0);
    const permanentBalance = Number(profile?.balance || 0);
    const todayUsed = Number(profile?.usedToday || 0);

    let remainingQuota = permanentBalance;
    let quotaLabel = "剩余额度";
    let showPermanentBalance = false;

    if (profile?.quotaType && profile.quotaType !== "none") {
      remainingQuota = Math.max(0, Number(profile.dailyQuota || 0) - todayUsed);
      quotaLabel = profile.quotaType === "daily" ? "今日剩余 (天卡)" : "今日剩余 (月卡)";
      showPermanentBalance = permanentBalance > 0;
    }

    return { totalTokens, totalCount, todayUsed, remainingQuota, quotaLabel, permanentBalance, showPermanentBalance };
  }, [profile]);

  return (
    <div className="space-y-6">
      <div className={`grid grid-cols-1 ${stats.showPermanentBalance ? 'md:grid-cols-5' : 'md:grid-cols-4'} gap-4`}>
        <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 space-y-2 min-w-0">
          <div className="flex items-center gap-2 text-zinc-500 text-sm font-medium">
            <Zap className="w-4 h-4 shrink-0" />
            <span>总已用额度</span>
          </div>
          <div className="min-w-0 break-words text-[clamp(1.25rem,2vw,1.75rem)] font-bold tracking-tight leading-tight">
            {stats.totalTokens.toLocaleString()}
          </div>
          <div className="text-xs font-normal text-zinc-500">Tokens</div>
        </div>
        <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 space-y-2 min-w-0">
          <div className="flex items-center gap-2 text-zinc-500 text-sm font-medium">
            <Activity className="w-4 h-4 shrink-0" />
            <span>使用次数</span>
          </div>
          <div className="min-w-0 break-words text-[clamp(1.25rem,2vw,1.75rem)] font-bold tracking-tight leading-tight">
            {stats.totalCount.toLocaleString()}
          </div>
          <div className="text-xs font-normal text-zinc-500">次</div>
        </div>
        <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 space-y-2 min-w-0">
          <div className="flex items-center gap-2 text-zinc-500 text-sm font-medium">
            <PieChart className="w-4 h-4 shrink-0" />
            <span>今日已用额度</span>
          </div>
          <div className="min-w-0 break-words text-[clamp(1.25rem,2vw,1.75rem)] font-bold tracking-tight leading-tight">
            {stats.todayUsed.toLocaleString()}
          </div>
          <div className="text-xs font-normal text-zinc-500">Tokens</div>
        </div>
        <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 space-y-2 min-w-0">
          <div className="flex items-center gap-2 text-zinc-500 text-sm font-medium">
            <PieChart className="w-4 h-4 shrink-0" />
            <span>{stats.quotaLabel}</span>
          </div>
          <div className="min-w-0 break-words text-[clamp(1.25rem,2vw,1.75rem)] font-bold tracking-tight leading-tight">
            {stats.remainingQuota.toLocaleString()}
          </div>
          <div className="text-xs font-normal text-zinc-500">Tokens</div>
        </div>
        {stats.showPermanentBalance && (
          <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 space-y-2 min-w-0 overflow-hidden">
            <div className="flex items-center gap-2 text-zinc-500 text-sm font-medium">
              <PieChart className="w-4 h-4 shrink-0" />
              <span>永久额度</span>
            </div>
            <div className="min-w-0 break-all text-[clamp(1.1rem,1.8vw,1.6rem)] font-bold tracking-tight leading-tight">
              {stats.permanentBalance.toLocaleString()}
            </div>
            <div className="text-xs font-normal text-zinc-500">Tokens</div>
          </div>
        )}
      </div>

      <div className="p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold tracking-tight">额度使用趋势</h3>
          <div className="flex bg-zinc-100 dark:bg-zinc-800 p-1 rounded-lg">
            <button
              onClick={() => setView("hourly")}
              className={cn(
                "px-3 py-1 text-xs font-medium rounded-md transition-all",
                view === "hourly" ? "bg-white dark:bg-zinc-700 shadow-sm" : "text-zinc-500"
              )}
            >
              24小时
            </button>
            <button
              onClick={() => setView("daily")}
              className={cn(
                "px-3 py-1 text-xs font-medium rounded-md transition-all",
                view === "daily" ? "bg-white dark:bg-zinc-700 shadow-sm" : "text-zinc-500"
              )}
            >
              14天
            </button>
          </div>
        </div>

        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e5e5" className="dark:stroke-zinc-800" />
              <XAxis
                dataKey="name"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: "#888" }}
                dy={10}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: "#888" }}
              />
              <Tooltip
                cursor={{ fill: "rgba(0,0,0,0.05)" }}
                contentStyle={{
                  borderRadius: "12px",
                  border: "none",
                  boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)",
                  fontSize: "12px",
                  backgroundColor: "rgba(255,255,255,0.9)",
                }}
              />
              <Bar dataKey="tokens" radius={[4, 4, 0, 0]}>
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={view === "hourly" ? "#3b82f6" : "#10b981"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};
