import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-zinc-50 dark:bg-zinc-950">
          <div className="max-w-md w-full p-8 rounded-3xl border border-red-100 dark:border-red-900/30 bg-white dark:bg-zinc-900 shadow-xl text-center space-y-6">
            <div className="w-16 h-16 bg-red-50 dark:bg-red-900/20 rounded-full flex items-center justify-center mx-auto">
              <AlertCircle className="w-8 h-8 text-red-500" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">出错了</h2>
              <p className="text-sm text-zinc-500">
                应用程序遇到了一个意外错误。
              </p>
            </div>
            <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-900 text-left overflow-auto max-h-40">
              <code className="text-xs text-red-500 font-mono">
                {this.state.error?.message || "未知错误"}
              </code>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="w-full py-3 text-sm font-semibold text-white bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 rounded-xl hover:opacity-90 transition-all flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              重新加载页面
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
