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
import { EditProjectPage } from "./pages/Projects/EditProjectPage";
import { BomPage } from "./pages/Projects/BomPage";
import { CreateMilestonePage } from "./pages/Milestones/CreateMilestonePage";
import { CreateTaskPage } from "./pages/Milestones/CreateTaskPage";
import { ExpensesPage } from "./pages/Expenses/ExpensesPage";
import { UserManagementPage } from "./pages/Admin/UserManagementPage";
import { NotAuthorizedPage } from "./pages/NotAuthorizedPage";
import { TamperAlertsPage } from "./pages/Blockchain/TamperAlertsPage";
import { CreateTicketPage } from "./pages/Tickets/CreateTicketPage";
import { TicketQueuePage } from "./pages/Tickets/TicketQueuePage";
import { ProgressReviewPage } from "./pages/Tasks/ProgressReviewPage";
import { SubmitExpensePage } from "./pages/Expenses/SubmitExpensePage";
import { MyExpensesPage } from "./pages/Expenses/MyExpensesPage";
import { ForgotPasswordPage } from "./pages/Auth/ForgotPasswordPage";
import { SetPasswordPage } from "./pages/Auth/SetPasswordPage";

// Web /projects routes are scoped to GM and PM. Site Manager and Purchaser
// use the mobile app, which hits the same backend endpoint.
const WEB_BROADCAST_ROLES = ["General Manager", "Project Manager"];

// Password recovery: users can self-serve via /forgot-password (Gmail link),
// and a System Administrator can still set a password from User Accounts.
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/set-password" element={<SetPasswordPage />} />
          <Route path="/not-authorized" element={<NotAuthorizedPage />} />

          <Route
            element={
              <ProtectedRoute>
                <DashboardLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard/gm" element={<DashboardPage />} />
            <Route path="/dashboard/pm" element={<DashboardPage />} />
            <Route path="/dashboard/sm" element={<DashboardPage />} />
            <Route path="/dashboard/purchaser" element={<DashboardPage />} />
            <Route path="/dashboard/admin" element={<DashboardPage />} />

            <Route
              path="/tickets/new"
              element={
                <RoleRoute allow={["Site Manager"]}>
                  <CreateTicketPage />
                </RoleRoute>
              }
            />

            <Route
              path="/tickets/queue"
              element={
                <RoleRoute allow={["Project Manager"]}>
                  <TicketQueuePage />
                </RoleRoute>
              }
            />

            <Route
              path="/tasks/progress-review"
              element={
                <RoleRoute allow={["Project Manager"]}>
                  <ProgressReviewPage />
                </RoleRoute>
              }
            />

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
              path="/projects/:id/edit"
              element={
                <RoleRoute allow={["General Manager"]}>
                  <EditProjectPage />
                </RoleRoute>
              }
            />
            {/* F2: Bill of Materials. GM imports, edits and approves; the owning PM reads it. */}
            <Route
              path="/projects/:id/bom"
              element={
                <RoleRoute allow={["General Manager", "Project Manager"]}>
                  <BomPage />
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

            {/* F3: milestone/task creation is Project Manager only. Ownership of
                the specific project is enforced by the backend's getOwnedProject. */}
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

            <Route
              path="/expenses"
              element={
                <RoleRoute
                  allow={[
                    "General Manager",
                    "Project Manager",
                    "Purchaser",
                  ]}
                >
                  <ExpensesHome />
                </RoleRoute>
              }
            />

            <Route
              path="/expenses/new"
              element={
                <RoleRoute allow={WEB_BROADCAST_ROLES}>
                  <SubmitExpensePage />
                </RoleRoute>
              }
            />

            <Route
              path="/admin/users"
              element={
                <RoleRoute allow={["System Administrator"]}>
                  <UserManagementPage />
                </RoleRoute>
              }
            />

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

function ExpensesHome() {
  const { user } = useAuth();

  return user?.role === "Purchaser"
    ? <MyExpensesPage />
    : <ExpensesPage />;
}
