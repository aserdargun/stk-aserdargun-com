import type {
  CostEntry,
  CostItemSummary,
  DashboardData,
  ItemDetail,
  NewCostPayload,
  SlipImportPreview,
  SlipImportResult,
  StatementImportPreview,
  StatementImportResult,
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
  let payload: T & { error?: string; details?: Array<{ path?: Array<string | number>; message?: string }> };
  try {
    payload = await response.json();
  } catch {
    throw new Error(response.ok
      ? "The server returned an unreadable response. Please try again."
      : `The server is temporarily unavailable (HTTP ${response.status}). Please try again.`);
  }
  if (!response.ok) {
    const detail = payload.details?.[0];
    throw new Error(detail?.message
      ? `${detail.path?.join(" / ") || "Input"}: ${detail.message}`
      : payload.error || "The request could not be completed.");
  }
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
  mergeItem(id: number, targetId: number) {
    return request<{
      moved: number;
      sourceId: number;
      targetId: number;
      removed: boolean;
      fallbackClosed: boolean;
    }>(`/api/items/${id}/merge`, {
      method: "POST",
      body: JSON.stringify({ targetId }),
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
  previewStatementImport(fileName: string, data: string) {
    return request<StatementImportPreview>("/api/statements/import", {
      method: "POST",
      body: JSON.stringify({ fileName, data }),
    });
  },
  applyStatementImport(
    fileName: string,
    data: string,
    manualMappings: Array<{
      date: string;
      amount: number;
      description: string;
      name: string;
      category: string;
      billingType: string;
      plan: string | null;
      url: string | null;
      account: string | null;
      pattern: string | null;
    }> = [],
  ) {
    return request<StatementImportResult>("/api/statements/import", {
      method: "POST",
      body: JSON.stringify({ fileName, data, apply: true, manualMappings }),
    });
  },
  previewSlipImport(fileName: string, data: string) {
    return request<SlipImportPreview>("/api/slips/import", {
      method: "POST",
      body: JSON.stringify({ fileName, data }),
    });
  },
  applySlipImport(
    fileName: string,
    data: string,
    manualMapping: {
      name: string;
      category: string;
      billingType: string;
      plan: string | null;
      url: string | null;
      account: string | null;
      pattern: string | null;
    } | null = null,
  ) {
    return request<SlipImportResult>("/api/slips/import", {
      method: "POST",
      body: JSON.stringify({ fileName, data, apply: true, manualMapping }),
    });
  },
  /**
   * Cross-check the Table View against the live `/api/items` list so the
   * page can surface any drift (e.g. a new active cost that is missing
   * from the matrix) and offer a one-tap re-sync. Both fetches run in
   * parallel; the result of the table-view request is returned untouched
   * so the page can keep using it as-is.
   */
  async reconcileTableView() {
    const [tableData, itemsResponse] = await Promise.all([
      request<TableViewData>("/api/table-view"),
      request<{ items: CostItemSummary[] }>("/api/items?status=active"),
    ]);
    const activeItems = itemsResponse.items;
    const tableItemIds = new Set(tableData.rows.map((row) => row.id));
    const missingFromTable = activeItems.filter(
      (item) => !tableItemIds.has(item.id),
    );
    return {
      tableData,
      activeCount: activeItems.length,
      missingFromTable,
      consistent: missingFromTable.length === 0,
    };
  },
};
