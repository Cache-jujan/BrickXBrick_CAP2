import * as FileSystem from "expo-file-system/legacy";

import { API_URL, authHeaders, getAuthToken } from "../constants/api";
import type { BackendLineItem } from "./expense-types";

export type Ticket = {
  ticketid: string;
  projectid: string;
  submittedby: string;
  tickettype: string;
  requestedbudget?: string | number | null;
  approvedbudget?: string | number | null;
  subject: string;
  description: string | null;
  status: string;
  createdat: string;
  // Procurement fields — present on Material Request / Work Item tickets,
  // used by My Requests and the Fix & Resubmit prefill.
  materialtype?: string | null;
  quantity?: string | number | null;
  unit?: string | null;
  vendorname?: string | null;
  bomitemid?: string | null;
  notinbom?: boolean | null;
  notinbomreason?: string | null;
  // Present on a Rejected ticket (GET /tickets/submitted returns t.* +
  // the rejecting user's role), so the Site Manager can see why.
  rejectionreason?: string | null;
  rejectedbyrole?: string | null;
  // Resubmission wiring. resubmittedfromid: this ticket replaces that one.
  // resubmittedbyid: the newer ticket that replaced THIS one (if any) — lets
  // My Requests show "Resubmitted ✓" instead of a "Fix & resubmit" button.
  resubmittedfromid?: string | null;
  resubmittedbyid?: string | null;
  // Non-blocking double-capture signal (a ticket CAN have more than one
  // expense): how many non-rejected expenses already exist against it.
  expensecount?: string | number;
  expensetotal?: string | number;
};

export type Project = {
  projectid: string;
  name: string;
  budget?: string;
};

export type ApprovedVendor = {
  vendorID: string;
  vendorName: string;
};

export type AssignedTask = {
  taskid: string;
  milestoneid: string;
  milestonename?: string;
  projectname?: string;
  assignedto: string;
  taskname: string;
  duedate: string;
  status: string;
  completionpercentage: number | string;
  photoevidenceurl?: string | null;
  pendingphotoevidenceurl?: string | null;
  latestreviewstatus?: string | null;
  latestreviewreason?: string | null;
  // When the task was completed. Older acknowledged tasks have no completedat,
  // so the app falls back to lastupdatedat to decide when to archive them.
  completedat?: string | null;
  lastupdatedat?: string | null;
};

export async function fetchAssignedTasks(): Promise<AssignedTask[]> {
  const res = await fetch(`${API_URL}/api/tasks/assigned`, {
    headers: authHeaders(),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(
      data.error || `Failed to load assigned tasks (${res.status})`
    );
  }

  return data;
}

export async function submitTaskProgress(
  taskId: string,
  photo: { uri: string; fileName?: string | null; mimeType?: string | null },
  note: string,
  clientSubmissionId: string
) {
  const uploadResult = await FileSystem.uploadAsync(
    `${API_URL}/api/tasks/${taskId}/progress`,
    photo.uri,
    {
      httpMethod: "POST",
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: "photo",
      mimeType: photo.mimeType || "image/jpeg",
      parameters: {
        clientSubmissionId,
        ...(note.trim() ? { note: note.trim() } : {}),
      },
      headers: {
        Authorization: `Bearer ${getAuthToken()}`,
      },
    }
  );

  const data = JSON.parse(uploadResult.body || "{}");
  if (uploadResult.status < 200 || uploadResult.status >= 300) {
    throw new Error(data.error || `Failed to submit task progress (${uploadResult.status})`);
  }

  return data;
}

export async function fetchAllAssignedTickets(role: "Purchaser" | "Site Manager"): Promise<Ticket[]> {
  const endpoint = role === "Site Manager" ? "/api/tickets/submitted" : "/api/tickets/assigned";
  const res = await fetch(`${API_URL}${endpoint}`, {
    headers: authHeaders(),
  });

  if (!res.ok) {
    throw new Error(`Failed to load tickets (${res.status})`);
  }

  return res.json();
}

export async function fetchActiveProjects(): Promise<Project[]> {
  const res = await fetch(`${API_URL}/api/projects?status=Active`, {
    headers: authHeaders(),
  });

  if (!res.ok) {
    throw new Error(`Failed to load projects (${res.status})`);
  }

  return res.json();
}

export async function fetchApprovedVendors(): Promise<ApprovedVendor[]> {
  const res = await fetch(`${API_URL}/api/tickets/vendors`, {
    headers: authHeaders(),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Failed to load approved vendors (${res.status})`);
  }

  return data;
}

export type BomItem = {
  bomItemId: string;
  section: string;
  description: string;
  quantity: number;
  unit: string;
};

// Items of a project's APPROVED BOM, for Material Requests. The Site Manager
// is allowed to read these (unit costs are hidden server-side). Returns an
// empty list when the project has no approved BOM yet.
export async function fetchBomItems(projectId: string): Promise<BomItem[]> {
  const res = await fetch(`${API_URL}/api/projects/${projectId}/bom/items`, {
    headers: authHeaders(),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Failed to load BOM items (${res.status})`);
  }

  return Array.isArray(data.items) ? data.items : [];
}

export type TicketInput = {
  projectID: string;
  ticketType: "Material Request" | "Work Item" | "Report";
  subject: string;
  description?: string;
  materialType?: string;
  quantity?: number;
  unit?: string;
  vendorName?: string;
  requestedBudget?: number;
  // Material Request: either reference an approved BOM item, or mark not-in-BOM
  // with a reason (the backend derives materialType + unit from the BOM item).
  bomItemID?: string;
  notInBom?: boolean;
  notInBomReason?: string;
  // Fix & resubmit: when the SM is re-sending a request the PM rejected,
  // this is the rejected ticket's id. The backend validates ownership /
  // status and links the two so the PM sees the resubmission flagged.
  resubmittedFromId?: string;
};

// Load one ticket the caller submitted (any status). Used by the "Fix &
// resubmit" flow to prefill the form from the rejected original.
export async function fetchSubmittedTicket(ticketId: string): Promise<Ticket> {
  // Backend has no single-ticket SM endpoint; /submitted is already scoped to
  // the caller, so one call is enough.
  const list = await fetchAllAssignedTickets("Site Manager");
  const found = list.find((t) => t.ticketid === ticketId);
  if (!found) throw new Error("The request you're resubmitting is no longer available.");
  return found;
}

export async function createTicket(body: TicketInput) {
  const res = await fetch(`${API_URL}/api/tickets`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Failed to create ticket (${res.status})`);
  }

  return data;
}

// Create several tickets in one atomic request (all succeed or none).
// Used by the Site Manager's multi-card ticket form.
export async function createTicketsBatch(tickets: TicketInput[]) {
  const res = await fetch(`${API_URL}/api/tickets/batch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({ tickets }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Failed to create tickets (${res.status})`);
  }

  return Array.isArray(data.tickets) ? data.tickets : [];
}

export async function resolveTicket(ticketId: string) {
  const res = await fetch(`${API_URL}/api/tickets/${ticketId}/resolve`, {
    method: "PATCH",
    headers: authHeaders(),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(
      data.error || `Failed to resolve ticket (${res.status})`
    );
  }

  return data;
}

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
  lineItems: unknown[];
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
    throw new Error(
      data.error || `Failed to submit expense (${res.status})`
    );
  }

  return data;
}

// ---- Rejected expenses: correct and resubmit --------------------------------

// One row of GET /api/expenses/mine. amount is a string (Postgres numeric) and
// receiptDate a full timestamp (Postgres DATE read as midnight server time).
export type MyExpense = {
  expenseID: string;
  ticketID: string | null;
  projectID: string;
  vendorName: string | null;
  amount: string | number;
  receiptDate: string | null;
  category: "Materials" | "Equipment" | "Other";
  status: "Pending" | "Approved" | "Rejected";
  rejectionReason: string | null;
  submittedAt: string;
  receiptImageURL: string;
  birNumber: string | null;
  tin: string | null;
  birPermitNumber: string | null;
  lineItems: BackendLineItem[] | null;
};

export async function fetchMyExpenses(): Promise<MyExpense[]> {
  const res = await fetch(`${API_URL}/api/expenses/mine`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Failed to load your expenses (${res.status})`);
  return res.json();
}

// The receipt image, ticket and project stay as they were; only the
// correctable fields are sent.
export type ExpenseResubmission = Omit<ExpenseSubmission, "ticketID" | "receiptImageURL">;

export async function resubmitExpense(expenseID: string, body: ExpenseResubmission) {
  const res = await fetch(`${API_URL}/api/expenses/${expenseID}/resubmit`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Failed to resubmit expense (${res.status})`);
  return data;
}

// ---- F8 split receipt ------------------------------------------------------

// Error that keeps the server's `details` (e.g. which lines aren't covered).
export class ApiError extends Error {
  status: number;
  details: any;
  constructor(message: string, status: number, details?: any) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function readJson(res: Response, fallback: string) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `${fallback} (${res.status})`, res.status, data.details);
  return data;
}

export type OpenRequest = {
  ticketID: string;
  projectID: string;
  projectName: string;
  subject: string;
  materialType: string;
  bomItemID: string | null;
  vendorName: string | null;
  requestedQuantity: number;
  remainingQuantity: number;
  approvedBudget: number | null;
  remainingBudget: number | null;
  createdAt: string;
};

export type SplitLine = { description: string; quantity: number; amount: number; bomItemID?: string | null };

export type PlanLine = { lineIndex: number; description: string; quantity: number; amount: string };

export type PlanPortion = {
  ticketID: string;
  projectID: string;
  projectName: string;
  materialType: string;
  quantity: number;
  amount: string;
  remainingAfter: number;
  resolvesTicket: boolean;
  remainingBudget: string | null;
  overBudget: boolean;
  lines: PlanLine[];
};

export type AllocationPlan = {
  ok: boolean;
  problems: string[];
  portions: PlanPortion[];
  uncovered: PlanLine[];
  unmatched: PlanLine[];
  allocated: string;
  linesTotal: string;
  warnings: { type: string; ticketID: string; amount: string; remainingBudget: string }[];
};

export type PlanOptions = { excludeTicketIDs: string[]; feeTargets: Record<string, string> };

export type AllocationSubmission = PlanOptions & {
  receiptImageURL: string;
  vendorName: string | null;
  receiptDate: string | null;
  category: "Materials" | "Equipment" | "Other";
  tin?: string | null;
  birPermitNumber?: string | null;
  birNumber?: string | null;
  receiptTotal: number;
  lineItems: SplitLine[];
};

export type AllocationResult = {
  commonReceiptID: string;
  expenses: { expenseID: string; projectID: string; ticketID: string; amount: string; quantity: string }[];
  resolvedTicketIDs: string[];
  stillOpenTicketIDs: string[];
  warnings: AllocationPlan["warnings"];
  screening: Record<string, { flagTypes: string[] | null; error?: string }>;
};

export async function fetchOpenRequests(): Promise<OpenRequest[]> {
  const res = await fetch(`${API_URL}/api/allocations/open-requests`, { headers: authHeaders() });
  return readJson(res, "Failed to load open requests");
}

export async function previewAllocation(lineItems: SplitLine[], options: PlanOptions): Promise<AllocationPlan> {
  const res = await fetch(`${API_URL}/api/allocations/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ lineItems, ...options }),
  });
  return readJson(res, "Failed to preview the split");
}

export async function submitAllocation(body: AllocationSubmission): Promise<AllocationResult> {
  const res = await fetch(`${API_URL}/api/allocations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  return readJson(res, "Failed to submit the split");
}

// ---- Notifications (#6c) ---------------------------------------------------

export type AppNotification = {
  notificationid: string;
  type: string;
  relatedentitytype: string;
  relatedentityid: string;
  message: string;
  isread: boolean;
  createdat: string;
  // Present when relatedentitytype === "Ticket" (same join the web app uses).
  ticket_projectid?: string | null;
  ticket_status?: string | null;
  ticket_type?: string | null;
  ticket_submittedby?: string | null;
  // Present when relatedentitytype === "Milestone" / "Task".
  milestone_projectid?: string | null;
  task_projectid?: string | null;
};

export async function fetchNotifications(opts?: { before?: string; unreadOnly?: boolean; limit?: number }): Promise<AppNotification[]> {
  const params = new URLSearchParams();
  if (opts?.before) params.set("before", opts.before);
  if (opts?.unreadOnly) params.set("unreadOnly", "true");
  if (opts?.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  const res = await fetch(`${API_URL}/api/notifications/mine${qs ? `?${qs}` : ""}`, { headers: authHeaders() });
  return readJson(res, "Failed to load notifications");
}

export async function fetchUnreadCount(): Promise<number> {
  const data = await readJson(
    await fetch(`${API_URL}/api/notifications/unread-count`, { headers: authHeaders() }),
    "Failed to load unread count"
  );
  return data.count;
}

export async function markNotificationRead(id: string) {
  const res = await fetch(`${API_URL}/api/notifications/${id}/read`, { method: "PATCH", headers: authHeaders() });
  return readJson(res, "Failed to mark notification read");
}

export async function markAllNotificationsRead() {
  const res = await fetch(`${API_URL}/api/notifications/read-all`, { method: "PATCH", headers: authHeaders() });
  return readJson(res, "Failed to mark all notifications read");
}