import { Component, type ErrorInfo, type ReactNode } from "react";
import { isStaleBuildError, reloadForNewVersion } from "@/lib/stale-build";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
  reloading?: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (isStaleBuildError(error) && reloadForNewVersion()) {
      this.setState({ reloading: true });
      return;
    }
    console.error("[callia] erro não tratado na interface", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (this.state.reloading) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-sm text-slate-600 dark:bg-slate-950 dark:text-slate-400">
          Atualizando para a nova versão do painel…
        </div>
      );
    }
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 dark:bg-slate-950">
        <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h1 className="text-lg font-semibold">Algo deu errado nesta tela</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            O erro foi registrado no console do navegador. Recarregue a página para continuar.
          </p>
          <pre className="mt-4 max-h-40 overflow-auto rounded bg-slate-100 p-3 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 h-10 rounded-lg bg-brand px-4 text-sm font-medium text-brand-fg"
          >
            Recarregar
          </button>
        </div>
      </div>
    );
  }
}
