import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import AppErrorBoundary from "./components/AppErrorBoundary";
import RouteLoader from "./components/RouteLoader";
import { AuthProvider } from "./lib/auth";
import { WorkspaceProvider } from "./lib/workspace";
import ProtectedRoute from "./components/ProtectedRoute";
import AppLayout from "./components/AppLayout";

const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const Index = lazy(() => import("./pages/Index.tsx"));
const Login = lazy(() => import("./pages/Login.tsx"));
const Signup = lazy(() => import("./pages/Signup.tsx"));
const Onboarding = lazy(() => import("./pages/Onboarding.tsx"));
const AgentPage = lazy(() => import("./pages/Agent.tsx"));
const KnowledgeBasePage = lazy(() => import("./pages/KnowledgeBase.tsx"));
const ApiKeysPage = lazy(() => import("./pages/ApiKeys.tsx"));
const InboxPage = lazy(() => import("./pages/Inbox.tsx"));
const LogsPage = lazy(() => import("./pages/Logs.tsx"));
const SettingsPage = lazy(() => import("./pages/Settings.tsx"));
const WebhooksPage = lazy(() => import("./pages/Webhooks.tsx"));
const WhatsAppPage = lazy(() => import("./pages/WhatsApp.tsx"));
const Placeholder = lazy(() => import("./pages/Placeholder.tsx"));
const OAuthConsent = lazy(() => import("./pages/OAuthConsent.tsx"));

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AppErrorBoundary>
          <Suspense fallback={<RouteLoader />}>
            <AuthProvider>
              <WorkspaceProvider>
                <Routes>
                  <Route path="/" element={<Index />} />
                  <Route path="/acompanhamento" element={<Index />} />
                  <Route path="/app" element={<Navigate to="/inbox" replace />} />
                  <Route path="/login" element={<Login />} />
                  <Route path="/signup" element={<Signup />} />
                  <Route path="/.lovable/oauth/consent" element={<OAuthConsent />} />
                  <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
                  <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                    <Route path="/inbox" element={<InboxPage />} />
                    <Route path="/agent" element={<AgentPage />} />
                    <Route path="/knowledge-base" element={<KnowledgeBasePage />} />
                    <Route path="/whatsapp" element={<WhatsAppPage />} />
                    <Route path="/api-keys" element={<ApiKeysPage />} />
                    <Route path="/webhooks" element={<WebhooksPage />} />
                    <Route path="/team" element={<Placeholder title="Time" description="Convidar membros e gerenciar roles" />} />
                    <Route path="/logs" element={<LogsPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                  </Route>
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </WorkspaceProvider>
            </AuthProvider>
          </Suspense>
        </AppErrorBoundary>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
