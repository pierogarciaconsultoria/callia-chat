import { lazy, Suspense, type ReactElement } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { PlatformAdminRoute } from "@/components/PlatformAdminRoute";
import { PageLoader } from "@/components/ui";

const Landing = lazy(() => import("@/pages/Landing"));
const Login = lazy(() => import("@/pages/Login"));
const Signup = lazy(() => import("@/pages/Signup"));
const Welcome = lazy(() => import("@/pages/Welcome"));
const SetPassword = lazy(() => import("@/pages/SetPassword"));
const Inbox = lazy(() => import("@/pages/Inbox"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Agent = lazy(() => import("@/pages/Agent"));
const AgentSetup = lazy(() => import("@/pages/AgentSetup"));
const KnowledgeBase = lazy(() => import("@/pages/KnowledgeBase"));
const Learnings = lazy(() => import("@/pages/Learnings"));
const WhatsApp = lazy(() => import("@/pages/WhatsApp"));
const Integrations = lazy(() => import("@/pages/Integrations"));
const ApiKeys = lazy(() => import("@/pages/ApiKeys"));
const Webhooks = lazy(() => import("@/pages/Webhooks"));
const Logs = lazy(() => import("@/pages/Logs"));
const Settings = lazy(() => import("@/pages/Settings"));
const Team = lazy(() => import("@/pages/Team"));
const Roadmap = lazy(() => import("@/pages/Roadmap"));
const Legal = lazy(() => import("@/pages/Legal"));
const AdminOverview = lazy(() => import("@/pages/admin/Overview"));
const AdminTenants = lazy(() => import("@/pages/admin/Tenants"));
const AdminTenantDetail = lazy(() => import("@/pages/admin/TenantDetail"));
const AdminPlans = lazy(() => import("@/pages/admin/Plans"));
const AdminUsers = lazy(() => import("@/pages/admin/Users"));
const AdminAudit = lazy(() => import("@/pages/admin/Audit"));
const AdminSettings = lazy(() => import("@/pages/admin/PlatformSettings"));

const admin = (el: ReactElement) => <ProtectedRoute adminOnly>{el}</ProtectedRoute>;

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* Público: site, acesso e cadastro. */}
          <Route path="/" element={<Landing />} />
          <Route path="/entrar" element={<Login />} />
          <Route path="/cadastro" element={<Signup />} />
          <Route path="/bem-vindo" element={<Welcome />} />
          <Route path="/definir-senha" element={<SetPassword />} />
          <Route path="/acompanhamento" element={<Roadmap />} />
          <Route path="/termos" element={<Legal document="termos" />} />
          <Route path="/privacidade" element={<Legal document="privacidade" />} />
          <Route
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/inbox" element={<Inbox />} />
            <Route path="/inbox/:conversationId" element={<Inbox />} />
            <Route path="/team" element={<Team />} />
            <Route path="/agent" element={admin(<Agent />)} />
            <Route path="/agent/setup" element={admin(<AgentSetup />)} />
            <Route path="/knowledge-base" element={admin(<KnowledgeBase />)} />
            <Route path="/learnings" element={admin(<Learnings />)} />
            <Route path="/integrations" element={admin(<Integrations />)} />
            <Route path="/whatsapp" element={admin(<WhatsApp />)} />
            <Route path="/api-keys" element={admin(<ApiKeys />)} />
            <Route path="/webhooks" element={admin(<Webhooks />)} />
            <Route path="/logs" element={admin(<Logs />)} />
            <Route path="/settings" element={admin(<Settings />)} />
          </Route>
          <Route
            element={
              <PlatformAdminRoute>
                <AppLayout />
              </PlatformAdminRoute>
            }
          >
            <Route path="/admin" element={<AdminOverview />} />
            <Route path="/admin/tenants" element={<AdminTenants />} />
            <Route path="/admin/tenants/:id" element={<AdminTenantDetail />} />
            <Route path="/admin/plans" element={<AdminPlans />} />
            <Route path="/admin/users" element={<AdminUsers />} />
            <Route path="/admin/audit" element={<AdminAudit />} />
            <Route path="/admin/settings" element={<AdminSettings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
