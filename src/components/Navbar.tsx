import React from "react";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { LogOut, Sun, Moon, LayoutDashboard, ShieldCheck, User as UserIcon } from "lucide-react";
import { cn } from "../lib/utils";

interface NavbarProps {
  activeTab: "dashboard" | "admin";
  setActiveTab: (tab: "dashboard" | "admin") => void;
}

export const Navbar: React.FC<NavbarProps> = ({ activeTab, setActiveTab }) => {
  const { user, profile, isAdmin, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-zinc-900 dark:bg-zinc-100 rounded-lg flex items-center justify-center">
                <div className="w-4 h-4 bg-white dark:bg-zinc-900 rounded-sm rotate-45" />
              </div>
              <span className="text-lg font-bold tracking-tight">wzjself API</span>
            </div>

            {user && (
              <div className="hidden md:flex items-center gap-1">
                <button
                  onClick={() => setActiveTab("dashboard")}
                  className={cn(
                    "px-4 py-2 text-sm font-medium rounded-lg transition-all flex items-center gap-2",
                    activeTab === "dashboard" ? "bg-zinc-100 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100" : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                  )}
                >
                  <LayoutDashboard className="w-4 h-4" />
                  控制台
                </button>
                {isAdmin && (
                  <button
                    onClick={() => setActiveTab("admin")}
                    className={cn(
                      "px-4 py-2 text-sm font-medium rounded-lg transition-all flex items-center gap-2",
                      activeTab === "admin" ? "bg-zinc-100 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100" : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                    )}
                  >
                    <ShieldCheck className="w-4 h-4" />
                    管理后台
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-4">
            {profile?.quotaType !== "none" && (
              <div className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/30">
                <span className="text-[10px] font-bold uppercase tracking-widest">
                  {profile?.quotaType === "daily" ? "天卡" : "月卡"}
                </span>
                <span className="w-1 h-1 rounded-full bg-indigo-400" />
                <span className="text-xs font-medium">每日 {profile?.dailyQuota.toLocaleString()} Tokens</span>
              </div>
            )}

            <button
              onClick={toggleTheme}
              className="p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-lg transition-all"
            >
              {theme === "light" ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
            </button>

            {user ? (
              <div className="flex items-center gap-3 pl-4 border-l border-zinc-200 dark:border-zinc-800">
                <div className="hidden lg:block text-right">
                  <div className="text-sm font-medium truncate max-w-[150px]">{user.email}</div>
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wider">{profile?.role}</div>
                </div>
                <button
                  onClick={logout}
                  className="p-2 text-zinc-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10 rounded-lg transition-all"
                >
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </nav>
  );
};
