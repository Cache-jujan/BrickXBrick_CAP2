import * as FileSystem from "expo-file-system/legacy";

import { API_URL, authHeaders, getAuthToken } from "../constants/api";

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
  budget?: string;
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

export async function fetchAllAssignedTickets(): Promise<Ticket[]> {
  const res = await fetch(`${API_URL}/api/tickets/assigned`, {
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
