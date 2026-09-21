import { API_URL, authHeaders } from "../constants/api";

export type Ticket = {
  ticketid: string;
  projectid: string;
  submittedby: string;
  tickettype: string;
  subject: string;
  description: string | null;
  status: string;
  createdat: string;
};

export type Project = {
  projectid: string;
  name: string;
};

export async function fetchAssignedTickets(): Promise<Ticket[]> {
  const res = await fetch(`${API_URL}/api/tickets/assigned`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to load tickets (${res.status})`);
  const all: Ticket[] = await res.json();
  // Server returns every ticket ever assigned to this Purchaser, including
  // already-Resolved/Rejected ones (assignedTo is never cleared). Only
  // open Material Request tickets are pickable for a new expense.
  return all.filter(
    (t) => t.status === "Acknowledged" && t.tickettype === "Material Request"
  );
}

export async function fetchActiveProjects(): Promise<Project[]> {
  const res = await fetch(`${API_URL}/api/projects?status=Active`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to load projects (${res.status})`);
  return res.json();
}

// Body shape matches expenses.js's POST / handler field-for-field.
// ticketID is required for the F6.6 linked-expense flow; projectID is
// intentionally omitted here — when ticketID is present the server derives
// projectID from the ticket itself and ignores any client-supplied value.
export type ExpenseSubmission = {
  ticketID: string;
  vendorName: string | null;
  amount: number;
  receiptDate: string | null;
  category: "Materials" | "Equipment" | "Other";
  receiptImageURL: string;
  birNumber?: string | null;
  tin?: string | null;
  birPermitNumber?: string | null;
  lineItems?: unknown[];
  quantity: number;
};

export async function submitExpense(body: ExpenseSubmission) {
  const res = await fetch(`${API_URL}/api/expenses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    // expenses.js's error handler always sends { error: message }.
    throw new Error(data.error || `Failed to submit expense (${res.status})`);
  }

  return data;
}