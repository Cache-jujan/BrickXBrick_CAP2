import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ProtectedRoute } from "./routes/ProtectedRoute";
import { RoleRoute } from "./routes/RoleRoute";
import { DashboardLayout } from "./components/layout/DashboardLayout";

import { LoginPage } from "./pages/Login/LoginPage";
import { DashboardPage } from "./pages/Dashboard/DashboardPage";
import { ProjectsListPage } from "./pages/Projects/ProjectsListPage";
import { CreateProjectPage } from "./pages/Projects/CreateProjectPage";
import { ProjectDetailPage } from "./pages/Projects/ProjectDetailPage";
import { CreateMilestonePage } from "./pages/Milestones/CreateMilestonePage";
import { CreateTaskPage } from "./pages/Milestones/CreateTaskPage";
import { UserManagementPage } from "./pages/Admin/UserManagementPage";
import { NotAuthorizedPage } from "./pages/NotAuthorizedPage";
import { VerifyExpensePage } from "./pages/Blockchain/VerifyExpensePage";
import { ForgotPasswordPage } from "./pages/Login/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/Login/ResetPasswordPage";
import { TamperAlertsPage } from "./pages/Blockchain/TamperAlertsPage";

// The backend's requireRole(...) on GET /api/projects still allows all four
// roles (GM/PM/SM/Purchaser) — that's correct, since the mobile app (Site
// Manager, Purchaser) hits the same endpoint. This WEB_BROADCAST_ROLES list
// only controls which roles can reach the *web* /projects routes; per the
// Process spec, the web dashboard itself is scoped to GM and PM.
const WEB_BROADCAST_ROLES = ["General Manager", "Project Manager"];

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/not-authorized" element={<NotAuthorizedPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          <Route
            element={
              <ProtectedRoute>
                <DashboardLayout />
              </ProtectedRoute>
            }
          >
            {/* One dashboard route per role, matching backend ROLE_DASHBOARDS */}
            <Route path="/dashboard/gm" element={<DashboardPage />} />
            <Route path="/dashboard/pm" element={<DashboardPage />} />
            <Route path="/dashboard/sm" element={<DashboardPage />} />
            <Route path="/dashboard/purchaser" element={<DashboardPage />} />
            <Route path="/dashboard/admin" element={<DashboardPage />} />

            {/* Projects — web scope is GM/PM only; SM/Purchaser use the mobile app */}
            <Route
              path="/projects"
              element={
                <RoleRoute allow={WEB_BROADCAST_ROLES}>
                  <ProjectsListPage />
                </RoleRoute>
              }
            />
            <Route
              path="/projects/new"
              element={
                <RoleRoute allow={["General Manager"]}>
                  <CreateProjectPage />
                </RoleRoute>
              }
            />
            <Route
              path="/projects/:id"
              element={
                <RoleRoute allow={WEB_BROADCAST_ROLES}>
                  <ProjectDetailPage />
                </RoleRoute>
              }
            />

            {/* F3 — milestone/task creation is Project Manager-only (GM is
                excluded here, unlike project creation which is GM-only).
                RoleRoute only checks role; ownership of the specific
                project is re-checked inside ProjectDetailPage's canManage
                and enforced for real by the backend's getOwnedProject. */}
            <Route
              path="/projects/:id/milestones/new"
              element={
                <RoleRoute allow={["Project Manager"]}>
                  <CreateMilestonePage />
                </RoleRoute>
              }
            />
            <Route
              path="/projects/:id/milestones/:milestoneId/tasks/new"
              element={
                <RoleRoute allow={["Project Manager"]}>
                  <CreateTaskPage />
                </RoleRoute>
              }
            />

            {/* Admin — System Administrator only, matches adminUsers.js router.use gate */}
            <Route
              path="/admin/users"
              element={
                <RoleRoute allow={["System Administrator"]}>
                  <UserManagementPage />
                </RoleRoute>
              }
            />

             {/* F12 — blockchain audit verification, General Manager only */}
            <Route
              path="/blockchain/verify"
              element={
                <RoleRoute allow={["General Manager"]}>
                  <VerifyExpensePage />
                </RoleRoute>
              }
            />

            {/* F12 — open tamper alerts, GM + System Administrator per backend requireRole on /alerts */}
            <Route
              path="/blockchain/alerts"
              element={
                <RoleRoute allow={["General Manager", "System Administrator"]}>
                  <TamperAlertsPage />
                </RoleRoute>
              }
            />
          </Route>

          <Route path="/" element={<RootRedirect />} />
          <Route path="*" element={<RootRedirect />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

// Sends "/" (and any unmatched path) to the right place: login if signed
// out, or the role-appropriate dashboard if signed in.
function RootRedirect() {
  const { status, user } = useAuth();
  if (status === "loading") return null;
  if (status === "guest") return <Navigate to="/login" replace />;

  const dashboards = {
    "General Manager": "/dashboard/gm",
    "Project Manager": "/dashboard/pm",
    "Site Manager": "/dashboard/sm",
    Purchaser: "/dashboard/purchaser",
    "System Administrator": "/dashboard/admin",
  };
  return <Navigate to={dashboards[user.role] || "/login"} replace />;
}
