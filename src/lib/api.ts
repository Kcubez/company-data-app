// ─── API helper ─────────────────────────────────────────────────────────────

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
};

async function request<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, headers = {} } = options;

  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: "Request failed" }));
    throw new Error(error.message ?? "Request failed");
  }

  return res.json() as Promise<T>;
}

// ─── Users API ───────────────────────────────────────────────────────────────

export const usersApi = {
  list: () => request<{ users: AdminUser[] }>("/api/admin/users"),
  get: (id: string) => request<AdminUser>(`/api/admin/users/${id}`),
  create: (data: CreateUserPayload) =>
    request<AdminUser>("/api/admin/users", { method: "POST", body: data }),
  update: (id: string, data: UpdateUserPayload) =>
    request<AdminUser>(`/api/admin/users/${id}`, { method: "PUT", body: data }),
  delete: (id: string) =>
    request<{ success: boolean }>(`/api/admin/users/${id}`, { method: "DELETE" }),
  ban: (id: string, reason?: string) =>
    request<AdminUser>(`/api/admin/users/${id}/ban`, { method: "POST", body: { reason } }),
  unban: (id: string) =>
    request<AdminUser>(`/api/admin/users/${id}/unban`, { method: "POST" }),
};

// ─── Types ───────────────────────────────────────────────────────────────────

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  banned: boolean | null;
  banReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateUserPayload = {
  name: string;
  email: string;
  password: string;
  role: "user" | "admin";
};

export type UpdateUserPayload = {
  name: string;
  email: string;
  role: "user" | "admin";
};

// ─── Telegram Messages API ──────────────────────────────────────────────────

export type TelegramSender = {
  id: string;
  telegramUserId: string;
  firstName: string;
  lastName: string | null;
  username: string | null;
  displayName: string;
  messageCount: number;
  lastMessageAt: string | null;
  activeReportType: string;
  createdAt: string;
};

export type TelegramMessageItem = {
  id: string;
  telegramMsgId: number;
  text: string;
  senderId: string;
  sender: TelegramSender;
  chatId: string;
  chatTitle: string | null;
  receivedAt: string;
  createdAt: string;
};

export type MessagesResponse = {
  messages: TelegramMessageItem[];
  total: number;
  page: number;
  totalPages: number;
};

export type MessageStats = {
  totalMessages: number;
  todayMessages: number;
  totalSenders: number;
  weekMessages: number;
  dailyReports: number;
  customerFollowUps: number;
};

export type MessagesParams = {
  page?: number;
  limit?: number;
  search?: string;
  senderId?: string;
};

export const messagesApi = {
  list: (params: MessagesParams = {}) => {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set("page", String(params.page));
    if (params.limit) searchParams.set("limit", String(params.limit));
    if (params.search) searchParams.set("search", params.search);
    if (params.senderId) searchParams.set("senderId", params.senderId);
    const qs = searchParams.toString();
    return request<MessagesResponse>(`/api/messages${qs ? `?${qs}` : ""}`);
  },
  delete: (id: string) =>
    request<{ success: boolean }>(`/api/messages/${id}`, { method: "DELETE" }),
  stats: () => request<MessageStats>("/api/messages/stats"),
};

export const sendersApi = {
  list: () => request<{ senders: TelegramSender[] }>("/api/senders"),
};

// ─── Demand Sheet API ───────────────────────────────────────────────────────

export type DemandRecord = {
  id: string;
  messageId: string;
  senderId: string;
  sender: TelegramSender;
  reportType: string;
  customerName: string | null;
  category: string;
  status: string;
  note: string;
  quantity: number | null;
  product: string | null;
  amount: number | null;
  unit: string | null;
  followUpDate: string | null;
  confidence: number;
  aiProvider: string;
  aiModel: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DemandRecordsResponse = {
  records: DemandRecord[];
  total: number;
  page: number;
  totalPages: number;
};

export type DemandRecordStats = {
  totalRecords: number;
  todayRecords: number;
  dueToday: number;
  pendingRecords: number;
  dailyReports: number;
  customerFollowUps: number;
  recentRecords: {
    id: string;
    reportType: string;
    customerName: string | null;
    category: string;
    status: string;
    note: string;
    senderName: string;
    createdAt: string;
    followUpDate: string | null;
  }[];
  pipeline: {
    new: number;
    contacted: number;
    quoted: number;
    pending: number;
    closed: number;
  };
  totalQuantitySold: number;
  totalAmountSold: number;
  topProducts: { product: string; count: number; totalQty: number }[];
  weeklyActivity: { date: string; count: number }[];
  dueTodayRecords: {
    id: string;
    customerName: string | null;
    product: string | null;
    quantity: number | null;
    status: string;
    note: string;
    senderName: string;
    followUpDate: string | null;
  }[];
};

export type DemandRecordsParams = {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  category?: string;
  reportType?: string;
  senderId?: string;
};

export const demandRecordsApi = {
  list: (params: DemandRecordsParams = {}) => {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set("page", String(params.page));
    if (params.limit) searchParams.set("limit", String(params.limit));
    if (params.search) searchParams.set("search", params.search);
    if (params.status) searchParams.set("status", params.status);
    if (params.category) searchParams.set("category", params.category);
    if (params.reportType) searchParams.set("reportType", params.reportType);
    if (params.senderId) searchParams.set("senderId", params.senderId);
    const qs = searchParams.toString();
    return request<DemandRecordsResponse>(`/api/demand-records${qs ? `?${qs}` : ""}`);
  },
  stats: () => request<DemandRecordStats>("/api/demand-records/stats"),
};

// ─── Customers API ───────────────────────────────────────────────────────────

export type Customer = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  company: string | null;
  notes: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  activities: CustomerActivity[];
  _count?: { demandRecords: number };
};

export type CustomerActivity = {
  id: string;
  customerId: string;
  action: string;
  description: string;
  senderId: string | null;
  sender: TelegramSender | null;
  createdAt: string;
};

export type CustomerTimelineItem = {
  id: string;
  type: "activity" | "demand";
  action?: string;
  reportType?: string;
  customerName?: string | null;
  category?: string;
  status?: string;
  note?: string;
  followUpDate?: string | null;
  sender?: string;
  senderId?: string | null;
  description?: string;
  createdAt: string;
};

export type CustomerWithTimeline = {
  customer: Customer;
  timeline: CustomerTimelineItem[];
};

export type CustomersResponse = {
  customers: Customer[];
  total: number;
  page: number;
  totalPages: number;
};

export type CustomersParams = {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
};

export const customersApi = {
  list: (params: CustomersParams = {}) => {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set("page", String(params.page));
    if (params.limit) searchParams.set("limit", String(params.limit));
    if (params.search) searchParams.set("search", params.search);
    if (params.status) searchParams.set("status", params.status);
    const qs = searchParams.toString();
    return request<CustomersResponse>(`/api/customers${qs ? `?${qs}` : ""}`);
  },
  get: (id: string) => request<CustomerWithTimeline>(`/api/customers/${id}`),
  create: (data: Partial<Customer>) =>
    request<Customer>("/api/customers", { method: "POST", body: data }),
  update: (id: string, data: Partial<Customer>) =>
    request<Customer>(`/api/customers/${id}`, { method: "PATCH", body: data }),
  delete: (id: string) =>
    request<{ success: boolean }>(`/api/customers/${id}`, { method: "DELETE" }),
};
