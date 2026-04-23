import React from "react";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { LogOut, Sun, Moon, LayoutDashboard, ShieldCheck, Sparkles } from "lucide-react";
import { cn } from "../lib/utils";

interface NavbarProps {
  activeTab: "dashboard" | "image" | "admin";
  setActiveTab: (tab: "dashboard" | "image" | "admin") => void;
}

export const Navbar: React.FC<NavbarProps> = ({ activeTab, setActiveTab }) => {
  const { user, profile, isAdmin, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-zinc-200 dark:border-zinc-800 bg-white/85 dark:bg-zinc-950/85 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-18 min-h-[72px] items-center">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-zinc-900 dark:bg-zinc-100 rounded-xl flex items-center justify-center shadow-sm">
                <div className="w-4 h-4 bg-white dark:bg-zinc-900 rounded-sm rotate-45" />
              </div>
              <span className="text-[28px] font-bold tracking-tight leading-none">wzjself中转站</span>
            </div>

            {user && (
              <div className="hidden md:flex items-center gap-2">
                <button
                  onClick={() => setActiveTab("dashboard")}
                  className={cn(
                    "px-5 py-3 text-base font-semibold rounded-xl transition-all flex items-center gap-2 border-2 shadow-sm",
                    activeTab === "dashboard"
                      ? "bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100"
                      : "bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 border-zinc-900 dark:border-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                  )}
                >
                  <LayoutDashboard className="w-4.5 h-4.5" />
                  控制台
                </button>
                <button
                  onClick={() => setActiveTab("image")}
                  className={cn(
                    "px-6 py-3.5 text-base font-semibold rounded-xl transition-all flex items-center gap-2 border-2 shadow-sm",
                    activeTab === "image"
                      ? "bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100"
                      : "bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 border-zinc-900 dark:border-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                  )}
                >
                  <Sparkles className="w-4.5 h-4.5" />
                  在线生图
                </button>
                {isAdmin && (
                <button
                  onClick={() => setActiveTab("admin")}
                  className={cn(
                      "px-5 py-3 text-base font-semibold rounded-xl transition-all flex items-center gap-2 border-2 shadow-sm",
                      activeTab === "admin"
                        ? "bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100"
                        : "bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 border-zinc-900 dark:border-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                    )}
                  >
                    <ShieldCheck className="w-4.5 h-4.5" />
                    管理后台
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={toggleTheme}
              className="p-2.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-xl transition-all"
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
                  className="p-2.5 text-zinc-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10 rounded-xl transition-all"
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
