const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface FetchOptions extends RequestInit {
  token?: string;
}

async function fetchAPI(endpoint: string, options: FetchOptions = {}) {
  const { token, ...fetchOptions } = options;

  const headers: Record<string, string> = {
    ...(fetchOptions.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  // Don't set Content-Type for FormData (browser sets it with boundary)
  if (!(fetchOptions.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${API_URL}${endpoint}`, {
    ...fetchOptions,
    headers,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: "Error de conexión" }));
    throw new Error(error.detail || `Error ${res.status}`);
  }

  return res.json();
}

// ── Auth ──────────────────────────────────────────────────────────────
export async function login(username: string, password: string) {
  const formData = new URLSearchParams();
  formData.append("username", username);
  formData.append("password", password);

  return fetchAPI("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formData.toString(),
  });
}

export async function register(username: string, password: string) {
  return fetchAPI("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export async function getMe(token: string) {
  return fetchAPI("/api/auth/me", { token });
}

export async function changePassword(
  token: string,
  current_password: string,
  new_password: string,
  confirm_password: string
) {
  return fetchAPI("/api/auth/change-password", {
    method: "POST",
    token,
    body: JSON.stringify({ current_password, new_password, confirm_password }),
  });
}

// ── Dashboard ─────────────────────────────────────────────────────────
export async function getDashboard(token: string, cycleId?: number) {
  const query = cycleId ? `?cycle_id=${cycleId}` : "";
  return fetchAPI(`/api/dashboard/${query}`, { token });
}

export async function getDailyConsumption(token: string, days: number = 30, cycleId?: number) {
  const params = new URLSearchParams({ days: String(days) });
  if (cycleId) params.set("cycle_id", String(cycleId));
  return fetchAPI(`/api/dashboard/daily-consumption?${params.toString()}`, { token });
}

export async function getCostEstimate(token: string, kwh: number) {
  return fetchAPI(`/api/dashboard/cost-estimate?kwh=${kwh}`, { token });
}

// ── Readings ──────────────────────────────────────────────────────────
export async function getReadings(token: string, limit: number = 50) {
  return fetchAPI(`/api/readings/?limit=${limit}`, { token });
}

export async function createReading(token: string, reading_kwh: number, notes?: string, readingDate?: string) {
  return fetchAPI("/api/readings/", {
    method: "POST",
    token,
    body: JSON.stringify({ reading_kwh, notes, reading_date: readingDate }),
  });
}

export async function updateReading(
  token: string,
  id: number,
  data: { reading_kwh?: number; notes?: string; reading_date?: string; billing_cycle_id?: number }
) {
  return fetchAPI(`/api/readings/${id}`, {
    method: "PUT",
    token,
    body: JSON.stringify(data),
  });
}

export async function createReadingWithPhoto(
  token: string,
  photo: File,
  reading_kwh?: number,
  notes?: string,
  use_ocr: boolean = true,
  readingDate?: string
) {
  const formData = new FormData();
  formData.append("photo", photo);
  if (reading_kwh !== undefined) formData.append("reading_kwh", String(reading_kwh));
  if (notes) formData.append("notes", notes);
  if (readingDate) formData.append("reading_date", readingDate);
  formData.append("use_ocr", String(use_ocr));

  return fetchAPI("/api/readings/with-photo", {
    method: "POST",
    token,
    body: formData,
  });
}

export async function deleteReading(token: string, id: number) {
  return fetchAPI(`/api/readings/${id}`, { method: "DELETE", token });
}

export async function ocrPreview(token: string, photo: File) {
  const formData = new FormData();
  formData.append("photo", photo);

  return fetchAPI("/api/readings/ocr-preview", {
    method: "POST",
    token,
    body: formData,
  });
}

// ── Billing Cycles ────────────────────────────────────────────────────
export async function getCycles(token: string) {
  return fetchAPI("/api/cycles", { token });
}

export async function getSuggestedStart(token: string) {
  return fetchAPI("/api/cycles/suggested-start", { token });
}

export async function getCycle(token: string, id: number) {
  return fetchAPI(`/api/cycles/${id}`, { token });
}

export async function createCycle(
  token: string,
  start_date: string,
  start_reading: number,
  notes?: string
) {
  return fetchAPI("/api/cycles", {
    method: "POST",
    token,
    body: JSON.stringify({ start_date, start_reading, notes }),
  });
}

export async function updateCycle(
  token: string,
  id: number,
  data: Record<string, unknown>
) {
  return fetchAPI(`/api/cycles/${id}`, {
    method: "PUT",
    token,
    body: JSON.stringify(data),
  });
}

export async function closeCycle(
  token: string,
  id: number,
  data: {
    end_date: string;
    end_reading: number;
    notes?: string;
    billed_kwh?: number;
    billed_amount?: number;
    utility_invoice_number?: string;
  }
) {
  return fetchAPI(`/api/cycles/${id}/close`, {
    method: "PUT",
    token,
    body: JSON.stringify(data),
  });
}

export async function deleteCycle(token: string, id: number) {
  return fetchAPI(`/api/cycles/${id}`, {
    method: "DELETE",
    token,
  });
}

export async function getCycleComparison(token: string, id: number) {
  return fetchAPI(`/api/cycles/${id}/comparison`, { token });
}

// ── Tariffs ───────────────────────────────────────────────────────────
export async function getTariffs(token: string) {
  return fetchAPI("/api/tariffs", { token });
}

export async function updateTariff(token: string, id: number, data: Record<string, unknown>) {
  return fetchAPI(`/api/tariffs/${id}`, {
    method: "PUT",
    token,
    body: JSON.stringify(data),
  });
}

// ── Reports ───────────────────────────────────────────────────────────
export async function getReportableCycles(token: string) {
  return fetchAPI("/api/reports/cycles", { token });
}

export async function getReports(token: string) {
  return fetchAPI("/api/reports/", { token });
}

export async function createReport(
  token: string,
  data: { billing_cycle_id?: number; title?: string; notes?: string; start_date?: string; end_date?: string }
) {
  return fetchAPI("/api/reports/", {
    method: "POST",
    token,
    body: JSON.stringify(data),
  });
}

export async function deleteReport(token: string, id: number) {
  return fetchAPI(`/api/reports/${id}`, {
    method: "DELETE",
    token,
  });
}

export function getSavedReportPdfUrl(token: string, reportId: number): string {
  const base = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  return `${base}/api/reports/${reportId}/pdf?_token=${token}`;
}

export function getPdfReportUrl(token: string, cycleId?: number): string {
  const base = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  const params = new URLSearchParams();
  if (cycleId) params.set("cycle_id", String(cycleId));
  params.set("_token", token);
  return `${base}/api/reports/pdf?${params.toString()}`;
}
