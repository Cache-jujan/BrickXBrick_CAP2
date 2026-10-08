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
