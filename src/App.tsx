import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { CrmProvider } from "./contexts/CrmContext";
import { CrmSettingsProvider } from "./contexts/CrmSettingsContext";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Index from "./pages/Index";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Placeholder from "./pages/Placeholder";
import Settings from "./pages/Settings";
import AccountSettings from "./pages/AccountSettings";
import WorkTypesSettings from "./pages/WorkTypesSettings";
import WorkCategoriesSettings from "./pages/WorkCategoriesSettings";
import CrmLossReasonsSettings from "./pages/CrmLossReasonsSettings";
import RateioSettings from "./pages/RateioSettings";
import ContasAPagar from "./pages/ContasAPagar";
import ContasAReceber from "./pages/ContasAReceber";
import CrmLeads from "./pages/CrmLeads";
import NotFound from "./pages/NotFound";
import Clientes from "./pages/Clientes";
import Contratos from "./pages/Contratos";
import Corretores from "./pages/Corretores";
import ProjectGuide from "./pages/ProjectGuide";
import LandingPage from "./pages/LandingPage";
import { AssistantChat } from "./components/AssistantChat";
import SupportTickets from "./pages/SupportTickets";

const queryClient = new QueryClient();

const HomeRoute = () => {
  const { loading, session } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!session) {
    return <LandingPage />;
  }

  return (
    <ProtectedRoute>
      <Index />
    </ProtectedRoute>
  );
};

const SuperAdminRoute = ({ children }: { children: React.ReactNode }) => {
  const { loading, isSuperAdmin } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!isSuperAdmin) {
    return <NotFound />;
  }

  return <>{children}</>;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <SettingsProvider>
            <CrmSettingsProvider>
              <CrmProvider>
                <>
                  <Routes>
                    <Route path="/landing" element={<LandingPage />} />
                    <Route path="/login" element={<Login />} />
                    <Route path="/signup" element={<Signup />} />
                    <Route path="/forgot-password" element={<ForgotPassword />} />
                    <Route path="/reset-password" element={<ResetPassword />} />
                    <Route path="/" element={<HomeRoute />} />
                    <Route
                      path="/crm"
                      element={
                        <ProtectedRoute>
                          <CrmLeads />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/clientes"
                      element={
                        <ProtectedRoute>
                          <Clientes />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/contratos"
                      element={
                        <ProtectedRoute>
                          <Contratos />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/corretores"
                      element={
                        <ProtectedRoute>
                          <Corretores />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/imobiliarias"
                      element={
                        <ProtectedRoute>
                          <Corretores defaultTab="imobiliarias" />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/fornecedores"
                      element={
                        <ProtectedRoute>
                          <Placeholder title="Fornecedores" />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/obras"
                      element={
                        <ProtectedRoute>
                          <Placeholder title="Obras" />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/obras/:id"
                      element={
                        <ProtectedRoute>
                          <Placeholder title="Obra" />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/compras"
                      element={
                        <ProtectedRoute>
                          <Placeholder title="Compras" />
                        </ProtectedRoute>
                      }
                    />
                    <Route path="/financeiro" element={<Navigate to="/financeiro/contas-a-pagar" replace />} />
                    <Route
                      path="/financeiro/contas-a-pagar"
                      element={
                        <ProtectedRoute>
                          <ContasAPagar />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/financeiro/contas-a-receber"
                      element={
                        <ProtectedRoute>
                          <ContasAReceber />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/patrimonio"
                      element={
                        <ProtectedRoute>
                          <Placeholder title="Patrimônio" />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/project-guide"
                      element={
                        <ProtectedRoute>
                          <SuperAdminRoute>
                            <ProjectGuide />
                          </SuperAdminRoute>
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/configuracoes"
                      element={
                        <ProtectedRoute>
                          <Settings />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/configuracoes/conta"
                      element={
                        <ProtectedRoute>
                          <AccountSettings />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/configuracoes/tipos-obra"
                      element={
                        <ProtectedRoute>
                          <WorkTypesSettings />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/configuracoes/categorias-obra"
                      element={
                        <ProtectedRoute>
                          <WorkCategoriesSettings />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/configuracoes/crm"
                      element={
                        <ProtectedRoute>
                          <CrmLossReasonsSettings />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/configuracoes/rateio"
                      element={
                        <ProtectedRoute>
                          <RateioSettings />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/configuracoes/suporte"
                      element={
                        <ProtectedRoute>
                          <SupportTickets />
                        </ProtectedRoute>
                      }
                    />
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                  <AssistantChat />
                </>
              </CrmProvider>
            </CrmSettingsProvider>
          </SettingsProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
