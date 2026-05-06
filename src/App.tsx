import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "./pages/NotFound.tsx";
import Login from "./pages/Login.tsx";
import Signup from "./pages/Signup.tsx";
import Onboarding from "./pages/Onboarding.tsx";
import Placeholder from "./pages/Placeholder.tsx";
import { AuthProvider } from "./lib/auth";
import { WorkspaceProvider } from "./lib/workspace";
import ProtectedRoute from "./components/ProtectedRoute";
import AppLayout from "./components/AppLayout";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <WorkspaceProvider>
            <Routes>
              <Route path="/" element={<Navigate to="/inbox" replace />} />
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
              <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                <Route path="/inbox" element={<Placeholder title="Inbox" description="Conversas em tempo real" />} />
                <Route path="/agent" element={<Placeholder title="Agente IA" description="Persona, FAQ, catálogo, voz e handoff" />} />
                <Route path="/whatsapp" element={<Placeholder title="WhatsApp" description="Conexão via Evolution API + QR Code" />} />
                <Route path="/api-keys" element={<Placeholder title="API Keys" description="Gerar, rotacionar e revogar chaves" />} />
                <Route path="/webhooks" element={<Placeholder title="Webhooks" description="Callbacks para CRM/sistemas externos" />} />
                <Route path="/team" element={<Placeholder title="Time" description="Convidar membros e gerenciar roles" />} />
                <Route path="/logs" element={<Placeholder title="Logs" description="Auditoria de chamadas e mensagens" />} />
                <Route path="/settings" element={<Placeholder title="Configurações" description="Dados do workspace" />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </WorkspaceProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
