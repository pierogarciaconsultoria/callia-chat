import { Component, ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  children: ReactNode;
};

type State = {
  hasError: boolean;
};

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
  };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error("App render error", error);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background px-6">
          <div className="w-full max-w-lg rounded-2xl border bg-card p-6 shadow-sm">
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-rose-100 text-rose-700">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">O painel encontrou um erro</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              A aplicacao capturou uma falha de renderizacao. Recarregue o painel para retomar a operacao.
            </p>
            <div className="mt-5">
              <Button onClick={this.handleReload}>
                <RotateCcw className="h-4 w-4" />
                Recarregar painel
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
