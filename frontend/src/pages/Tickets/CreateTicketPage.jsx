import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { Card } from "../../components/ui/Card";
import { BackLink } from "../../components/ui/BackLink";
import { TicketForm } from "../../components/tickets/TicketForm";
import "./CreateTicketPage.css";

// Standalone create page. The Site Manager reaches this from their sidebar;
// the Project Manager now creates from the "New ticket" button on the Ticket
// Queue (modal), but this route still works for a direct visit. All the form
// logic lives in <TicketForm> so both entry points behave identically.
export function CreateTicketPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const dashPath = user?.role === "Project Manager" ? "/dashboard/pm" : "/dashboard/sm";

  function handleSuccess(ticket, { isPM }) {
    navigate(dashPath, {
      replace: true,
      state: { successMessage: `Ticket “${ticket.subject}” was ${isPM ? "created and sent to the Purchaser" : "submitted"}.` },
    });
  }

  return (
    <div className="create-ticket">
      <BackLink to={dashPath}>Back to Dashboard</BackLink>
      <h1 className="create-ticket-title">Create Ticket</h1>

      <Card className="create-ticket-card">
        <TicketForm onSuccess={handleSuccess} onCancel={() => navigate(dashPath)} />
      </Card>
    </div>
  );
}