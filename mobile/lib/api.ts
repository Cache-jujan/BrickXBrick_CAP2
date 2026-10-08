import * as FileSystem from "expo-file-system/legacy";

import { API_URL, authHeaders, getAuthToken } from "../constants/api";

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

export type AssignedTask = {
  taskid: string;
  milestoneid: string;
  assignedto: string;
  taskname: string;
  duedate: string;
  status: string;
  completionpercentage: number | string;
  photoevidenceurl?: string | null;
  pendingphotoevidenceurl?: string | null;
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

export async function createTicket(body: {
  projectID: string;
  ticketType: "Material Request" | "Work Item" | "Report";
  subject: string;
  description?: string;
  materialType?: string;
  quantity?: number;
  vendorName?: string;
  requestedBudget?: number;
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
