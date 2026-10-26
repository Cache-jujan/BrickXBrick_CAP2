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
import { ProjectCheckinsPage } from "./pages/Projects/ProjectCheckinsPage";
import { EditProjectPage } from "./pages/Projects/EditProjectPage";
import { BomPage } from "./pages/Projects/BomPage";
import { ExpensesPage } from "./pages/Expenses/ExpensesPage";
import { UserManagementPage } from "./pages/Admin/UserManagementPage";
import { NotAuthorizedPage } from "./pages/NotAuthorizedPage";
import { TamperAlertsPage } from "./pages/Blockchain/TamperAlertsPage";
import { ReportsPage } from "./pages/Reports/ReportsPage";
import { CreateTicketPage } from "./pages/Tickets/CreateTicketPage";
import { TicketQueuePage } from "./pages/Tickets/TicketQueuePage";
import { ProgressReviewPage } from "./pages/Tasks/ProgressReviewPage";
import { SubmitExpensePage } from "./pages/Expenses/SubmitExpensePage";
import { SplitReceiptPage } from "./pages/Expenses/SplitReceiptPage";
import { TripCostPage } from "./pages/Expenses/TripCostPage";
import { OpenRequestsPage } from "./pages/Requests/OpenRequestsPage";
import { MyExpensesPage } from "./pages/Expenses/MyExpensesPage";
import { NotificationsPage } from "./pages/Notifications/NotificationsPage";
import { ForgotPasswordPage } from "./pages/Auth/ForgotPasswordPage";
import { SetPasswordPage } from "./pages/Auth/SetPasswordPage";
import { LegalPage } from "./pages/Legal/LegalPage";
import { AccountPage } from "./pages/Account/AccountPage";
import { MobileOnlyPage } from "./pages/MobileOnlyPage";
import { MilestoneTimelinePreviewPage } from "./pages/Projects/MilestoneTimelinePreviewPage";
import { LocaleProvider } from "./i18n/LocaleProvider";

// Web /projects routes are scoped to GM and PM. Site Manager and Purchaser
// use the mobile app, which hits the same backend endpoint.
const WEB_BROADCAST_ROLES = ["General Manager", "Project Manager"];

// These roles have no web app at all — they work entirely from mobile. Rather
// than a dashboard, they hit a full-screen "use the app" wall at the app entry
// (see AppShell), so no sidebar or web page is ever reachable for them.
const MOBILE_ONLY_ROLES = ["Site Manager", "Purchaser"];

// The authenticated app shell: the normal dashboard layout for web roles, or
// the mobile-only wall for roles that don't use the web. Sits inside
// ProtectedRoute, so `user` is always present here.
function AppShell() {
  const { user } = useAuth();
  if (MOBILE_ONLY_ROLES.includes(user?.role)) return <MobileOnlyPage />;
  return <DashboardLayout />;
}

// Password recovery: users can self-serve via /forgot-password (Gmail link),
// and a System Administrator can still set a password from User Accounts.
/** Render the application routes with authentication, role guards and shared providers. */
export default function App() {
  return (
    <LocaleProvider>
      <BrowserRouter>
        <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/set-password" element={<SetPasswordPage />} />
          <Route path="/legal" element={<LegalPage />} />
          <Route path="/not-authorized" element={<NotAuthorizedPage />} />
          {import.meta.env.DEV && (
            <Route path="/projects/timeline-preview" element={<MilestoneTimelinePreviewPage />} />
          )}

          <Route
            element={
              <ProtectedRoute>
                <AppShell />
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard/gm" element={<DashboardPage />} />
            <Route path="/dashboard/pm" element={<DashboardPage />} />
            <Route path="/dashboard/sm" element={<DashboardPage />} />
            <Route path="/dashboard/purchaser" element={<DashboardPage />} />
            <Route path="/dashboard/admin" element={<DashboardPage />} />

            {/* Every web role lands here (mobile-only roles never reach
                AppShell's DashboardLayout at all — see MOBILE_ONLY_ROLES). */}
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/account" element={<AccountPage />} />

            <Route
              path="/tickets/new"
              element={
                <RoleRoute allow={["Site Manager" , "Project Manager"]}>
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
            {/* Daily progress check-ins: the owning PM reviews, the GM reads. */}
            <Route
              path="/projects/:id/checkins"
              element={
                <RoleRoute allow={WEB_BROADCAST_ROLES}>
                  <ProjectCheckinsPage />
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

            {/* F3: milestone/task creation is Project Manager only, and now
                happens in-place via modals on the project detail page — the old
                standalone /milestones/new and /tasks/new routes were removed. */}

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
              path="/expenses/split"
              element={
                <RoleRoute allow={WEB_BROADCAST_ROLES}>
                  <SplitReceiptPage />
                </RoleRoute>
              }
            />

            <Route
              path="/expenses/trip-cost"
              element={
                <RoleRoute allow={["General Manager", "Project Manager"]}>
                  <TripCostPage />
                </RoleRoute>
              }
            />

            <Route
              path="/requests"
              element={
                <RoleRoute allow={["General Manager", "Project Manager"]}>
                  <OpenRequestsPage />
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

            {/* F11: financial reports. General Manager only (the API enforces it too). */}
            <Route
              path="/reports"
              element={
                <RoleRoute allow={["General Manager"]}>
                  <ReportsPage />
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
    </LocaleProvider>
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