import type {
  CostEntry,
  CostItemSummary,
  DashboardData,
  ItemDetail,
  NewCostPayload,
  TableViewData,
} from "../types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (response.redirected && new URL(response.url).pathname === "/login") {
    window.location.replace("/login");
    throw new Error("Authentication required.");
  }
  if (response.status === 401) {
    window.location.replace("/login");
    throw new Error("Authentication required.");
  }
  if (response.status === 403) {
    window.location.replace("/access-denied.html");
    throw new Error("Owner access required.");
  }
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "The request could not be completed.");
  return payload;
}

export const api = {
  getDashboard(year?: number) {
    return request<DashboardData>(`/api/dashboard${year ? `?year=${year}` : ""}`);
  },
  getTableView() {
    return request<TableViewData>("/api/table-view");
  },
  getItems(filters: { search?: string; category?: string; status?: string } = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value);
    }
    const suffix = params.size ? `?${params.toString()}` : "";
    return request<{ items: CostItemSummary[] }>(`/api/items${suffix}`);
  },
  getItem(id: number) {
    return request<ItemDetail>(`/api/items/${id}`);
  },
  createItem(payload: NewCostPayload) {
    return request<ItemDetail>("/api/items", { method: "POST", body: JSON.stringify(payload) });
  },
  updateItem(id: number, payload: Record<string, unknown>) {
    return request<ItemDetail>(`/api/items/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
  addEntry(
    id: number,
    payload: {
      amount: number;
      currency: string;
      periodStart: string;
      periodKind: string;
      membership?: string;
      note?: string;
    },
  ) {
    return request<ItemDetail & { id: number }>(`/api/items/${id}/entries`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  updateEntry(
    itemId: number,
    entryId: number,
    payload: Partial<
      Pick<CostEntry, "amount" | "currency" | "periodStart" | "periodKind" | "membership" | "note">
    >,
  ) {
    return request<ItemDetail>(`/api/items/${itemId}/entries/${entryId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
};
