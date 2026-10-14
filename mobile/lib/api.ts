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

// F2 Bill of Materials — approved BOM items for the Material Request picker.
// Unit costs are intentionally omitted for the Site Manager (backend strips
// them), so unitCost is never present in the mobile shape.
export type BomItem = {
  bomItemId: string;
  section: string;
  description: string;
  quantity: number;
  unit: string;
};

// status: the project BOM's status ("Approved" | "Draft" | "Locked" | null).
// items is non-empty only when status === "Approved"; otherwise the Material
// Request must take the Not-in-BOM path.
export type BomItemsResponse = {
  status: string | null;
  items: BomItem[];
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

// Approved BOM items for the given project, for the Material Request picker.
// The SM is only authorised on the project they're assigned to (403 otherwise);
// a project with no Approved BOM comes back as { status, items: [] }, which the
// caller treats as "Not in BOM only".
export async function fetchBomItems(projectID: string): Promise<BomItemsResponse> {
  const res = await fetch(`${API_URL}/api/projects/${projectID}/bom/items`, {
    headers: authHeaders(),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Failed to load BOM items (${res.status})`);
  }

  return { status: data.status ?? null, items: Array.isArray(data.items) ? data.items : [] };
}

export async function createTicket(body: {
  projectID: string;
  ticketType: "Material Request" | "Work Item" | "Report";
  subject: string;
  description?: string;
  materialType?: string;
  quantity?: number;
  vendorName?: string;
  requestedBudget?: number;
  // Material Request BOM link: send exactly one of bomItemID (an approved item
  // of this project — the backend derives materialType from it) OR
  // notInBom:true + notInBomReason + materialType (free text).
  bomItemID?: string;
  notInBom?: boolean;
  notInBomReason?: string;
}) {
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
  vendorName: string | null;
  requestedQuantity: number;
  remainingQuantity: number;
  approvedBudget: number | null;
  remainingBudget: number | null;
  createdAt: string;
};

export type SplitLine = { description: string; quantity: number; amount: number };

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