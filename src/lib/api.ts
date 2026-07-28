// ─── API helper ─────────────────────────────────────────────────────────────

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
};

type DateRangeParams = {
  dateFrom?: string;
  dateTo?: string;
};

function buildDateRangeQuery(params: DateRangeParams = {}) {
  const searchParams = new URLSearchParams();
  if (params.dateFrom) searchParams.set("dateFrom", params.dateFrom);
  if (params.dateTo) searchParams.set("dateTo", params.dateTo);
  const qs = searchParams.toString();
  return qs ? `?${qs}` : "";
}

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
  businessOwner?: {
    botConnected: boolean;
    botUpdatedAt: string | null;
    staffCount: number;
    authorizedStaffCount: number;
    customerCount: number;
    demandRecordCount: number;
    messageCount: number;
    projectCount: number;
    websiteCount: number;
    businessReportCount: number;
  };
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
  telegramUserId: string | null;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  displayName: string | null;
  messageCount: number;
  lastMessageAt: string | null;
  activeReportType: string;
  createdAt: string;
  userId?: string | null;
  email?: string | null;
  isVerified?: boolean;
  isAuthorized?: boolean;
  allowedDepartments?: string[];
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
  businessReports: number;
  futurePlans: number;
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

export const settingsSendersApi = {
  list: () => request<{ senders: TelegramSender[] }>("/api/settings/senders"),
  create: (data: { email: string; allowedDepartments: string[] }) =>
    request<{ sender: TelegramSender }>("/api/settings/senders", {
      method: "POST",
      body: data,
    }),
  update: (id: string, data: { isAuthorized?: boolean; allowedDepartments?: string[] }) =>
    request<{ sender: TelegramSender }>(`/api/settings/senders/${id}`, {
      method: "PUT",
      body: data,
    }),
  delete: (id: string) =>
    request<{ success: boolean }>(`/api/settings/senders/${id}`, {
      method: "DELETE",
    }),
};

export type StaffSummary = {
  totalStaff: number;
  authorizedStaff: number;
  pendingStaff: number;
  departmentCounts: {
    Sales: number;
    IT: number;
    Finance: number;
    QA: number;
  };
};

export type HRStaffResponse = {
  staff: TelegramSender[];
  summary: StaffSummary;
};

export const hrApi = {
  list: () => request<HRStaffResponse>("/api/hr/staff"),
  create: (data: { email: string; allowedDepartments: string[] }) =>
    request<{ sender: TelegramSender }>("/api/hr/staff", {
      method: "POST",
      body: data,
    }),
  update: (id: string, data: { isAuthorized?: boolean; allowedDepartments?: string[] }) =>
    request<{ sender: TelegramSender }>(`/api/hr/staff/${id}`, {
      method: "PATCH",
      body: data,
    }),
  delete: (id: string) =>
    request<{ success: boolean }>(`/api/hr/staff/${id}`, {
      method: "DELETE",
    }),
};


// ─── Demand Sheet API ───────────────────────────────────────────────────────

export type DemandRecord = {
  id: string;
  messageId: string;
  senderId: string;
  sender: TelegramSender;
  customerId: string | null;
  customerName: string | null;
  customer?: Customer | null;
  category: string;
  status: string;
  note: string;
  sourceType: string;
  sourceFileName: string | null;
  sourceChannel: string | null;
  rawData?: Record<string, unknown> | null;
  normalizedData?: Record<string, unknown> | null;
  importBatchId: string | null;
  serviceName: string | null;
  serviceAmount: number | null;
  serviceQty: number | null;
  followUpDate: string | null;
  followUpStatus: string;
  priority: "high" | "medium" | "low";
  potentialScore: number;
  priorityReason: string | null;
  recommendedAction: string | null;
  missingFields: string[];
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

export type ServiceStat = {
  serviceName: string;
  salesCount: number;
  totalQty: number;
  revenue: number;
};

export type DemandRecordStats = {
  totalRecords: number;
  todayRecords: number;
  uniqueCustomers: number;
  services: ServiceStat[];
  priority: {
    high: number;
    medium: number;
    low: number;
  };
  insights: {
    type: string;
    severity: "info" | "warning" | "urgent";
    title: string;
    message: string;
    recommendedAction: string;
    action?: string;
    actionType?: "view_high_priority" | "view_missing_phone" | "view_overdue" | "view_due_today";
  }[];
};

export type DemandRecordsParams = {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  category?: string;
  senderId?: string;
  priority?: string;
  dateFrom?: string;
  dateTo?: string;
  followUpStatus?: string;
  missingField?: string;
};

export type AIRecommendation = {
  customerName: string;
  insight: string;
};

export type AIRecommendationsResponse = {
  recommendations: AIRecommendation[];
};

export type UpdateDemandRecordPayload = {
  status?: string;
  note?: string;
  followUpDate?: string | null;
  recommendedAction?: string;
  priority?: "high" | "medium" | "low";
  customerName?: string;
  customerPhone?: string | null;
  customerCompany?: string | null;
  serviceName?: string | null;
  serviceAmount?: number | null;
  serviceQty?: number;
};

export type DemandImportResponse = {
  batchId: string;
  importedCount: number;
  highPriority: number;
  missingPhone: number;
  detectedColumns: string[];
  columnMapping: Record<string, string>;
  records: DemandRecord[];
};

export const demandRecordsApi = {
  list: (params: DemandRecordsParams = {}) => {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set("page", String(params.page));
    if (params.limit) searchParams.set("limit", String(params.limit));
    if (params.search) searchParams.set("search", params.search);
    if (params.status) searchParams.set("status", params.status);
    if (params.category) searchParams.set("category", params.category);
    if (params.senderId) searchParams.set("senderId", params.senderId);
    if (params.priority) searchParams.set("priority", params.priority);
    if (params.dateFrom) searchParams.set("dateFrom", params.dateFrom);
    if (params.dateTo) searchParams.set("dateTo", params.dateTo);
    if (params.followUpStatus) searchParams.set("followUpStatus", params.followUpStatus);
    if (params.missingField) searchParams.set("missingField", params.missingField);
    const qs = searchParams.toString();
    return request<DemandRecordsResponse>(`/api/demand-records${qs ? `?${qs}` : ""}`);
  },
  update: (id: string, data: UpdateDemandRecordPayload) =>
    request<DemandRecord>(`/api/demand-records/${id}`, { method: "PATCH", body: data }),
  create: (data: Partial<DemandRecord>) =>
    request<DemandRecord>("/api/demand-records", { method: "POST", body: data }),
  delete: (id: string) =>
    request<{ success: boolean }>(`/api/demand-records/${id}`, { method: "DELETE" }),
  stats: (params: { dateFrom?: string; dateTo?: string } = {}) => {
    const sp = new URLSearchParams();
    if (params.dateFrom) sp.set("dateFrom", params.dateFrom);
    if (params.dateTo) sp.set("dateTo", params.dateTo);
    const qs = sp.toString();
    return request<DemandRecordStats>(`/api/demand-records/stats${qs ? `?${qs}` : ""}`);
  },
  recommendations: () => request<AIRecommendationsResponse>("/api/demand-records/recommendations"),
  deleteAll: (params: DateRangeParams = {}) =>
    request<{ success: boolean; count: number }>(`/api/demand-records${buildDateRangeQuery(params)}`, { method: "DELETE" }),
  importFile: async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/demand-records/import", {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: "Import failed" }));
      throw new Error(error.message || "Import failed");
    }
    return res.json() as Promise<DemandImportResponse>;
  },
};

// ─── Project Expiration API ─────────────────────────────────────────────────

export type ProjectExpiration = {
  id: string;
  projectName: string;
  url: string | null;
  packageName: string | null;
  domainProvider: string | null;
  hostingProvider: string | null;
  hostingRemark: string | null;
  domainExpireDate: string | null;
  hostingExpireDate: string | null;
  offerExpireDate: string | null;
  projectStatus: "planning" | "active" | "maintenance" | "finished";
  remark: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectExpiriesResponse = {
  records: ProjectExpiration[];
  total: number;
  page: number;
  totalPages: number;
  stats: {
    total: number;
    expired: number;
    expiringSoon: number;
    active: number;
  };
};

export type ProjectExpiriesParams = {
  page?: number;
  limit?: number;
  search?: string;
  filter?: "all" | "expired" | "expiring_soon" | "active" | "maintenance" | "finished";
  dateFrom?: string;
  dateTo?: string;
};

export type UpdateProjectExpiryPayload = {
  projectName?: string;
  url?: string | null;
  packageName?: string | null;
  domainProvider?: string | null;
  hostingProvider?: string | null;
  hostingRemark?: string | null;
  domainExpireDate?: string | null;
  hostingExpireDate?: string | null;
  offerExpireDate?: string | null;
  projectStatus?: "planning" | "active" | "maintenance" | "finished";
  remark?: string | null;
};

export const projectExpiriesApi = {
  list: (params: ProjectExpiriesParams = {}) => {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set("page", String(params.page));
    if (params.limit) searchParams.set("limit", String(params.limit));
    if (params.search) searchParams.set("search", params.search);
    if (params.filter) searchParams.set("filter", params.filter);
    if (params.dateFrom) searchParams.set("dateFrom", params.dateFrom);
    if (params.dateTo) searchParams.set("dateTo", params.dateTo);
    const qs = searchParams.toString();
    return request<ProjectExpiriesResponse>(`/api/project-expiries${qs ? `?${qs}` : ""}`);
  },
  update: (id: string, data: UpdateProjectExpiryPayload) =>
    request<ProjectExpiration>(`/api/project-expiries/${id}`, { method: "PATCH", body: data }),
  recommendations: () =>
    request<{ recommendations: ProjectExpiryRecommendation[] }>("/api/project-expiries/recommendations"),
  deleteAll: (params: DateRangeParams = {}) =>
    request<{ success: boolean; deleted: number }>(`/api/project-expiries${buildDateRangeQuery(params)}`, { method: "DELETE" }),
};

export type ProjectExpiryRecommendation = {
  projectName: string;
  insight: string;
};

// ─── Website Updates API ───────────────────────────────────────────────────

export type WebsiteUpdate = {
  id: string;
  name: string;
  url: string | null;
  businessType: string | null;
  packageName: string | null;
  status: "up_to_date" | "pending_update" | "in_progress";
  remark: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WebsiteUpdatesResponse = {
  records: WebsiteUpdate[];
  total: number;
  page: number;
  totalPages: number;
  stats: {
    total: number;
    upToDate: number;
    pendingUpdate: number;
    inProgress: number;
  };
};

export type WebsiteUpdatesParams = {
  page?: number;
  limit?: number;
  search?: string;
  status?: "all" | "up_to_date" | "pending_update" | "in_progress";
  dateFrom?: string;
  dateTo?: string;
};

export const websiteUpdatesApi = {
  list: (params: WebsiteUpdatesParams = {}) => {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set("page", String(params.page));
    if (params.limit) searchParams.set("limit", String(params.limit));
    if (params.search) searchParams.set("search", params.search);
    if (params.status) searchParams.set("status", params.status);
    if (params.dateFrom) searchParams.set("dateFrom", params.dateFrom);
    if (params.dateTo) searchParams.set("dateTo", params.dateTo);
    const qs = searchParams.toString();
    return request<WebsiteUpdatesResponse>(`/api/website-updates${qs ? `?${qs}` : ""}`);
  },
  update: (id: string, data: { status?: string; remark?: string | null }) =>
    request<WebsiteUpdate>(`/api/website-updates/${id}`, { method: "PATCH", body: data }),
  delete: (id: string) =>
    request<{ success: boolean }>(`/api/website-updates/${id}`, { method: "DELETE" }),
  recommendations: () =>
    request<{ recommendations: WebsiteUpdateRecommendation[] }>("/api/website-updates/recommendations"),
  deleteAll: (params: DateRangeParams = {}) =>
    request<{ success: boolean; deleted: number }>(`/api/website-updates${buildDateRangeQuery(params)}`, { method: "DELETE" }),
};

export type WebsiteUpdateRecommendation = {
  websiteName: string;
  insight: string;
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
  demandRecords?: DemandRecord[];
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
  dateFrom?: string;
  dateTo?: string;
};

export const customersApi = {
  list: (params: CustomersParams = {}) => {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set("page", String(params.page));
    if (params.limit) searchParams.set("limit", String(params.limit));
    if (params.search) searchParams.set("search", params.search);
    if (params.status) searchParams.set("status", params.status);
    if (params.dateFrom) searchParams.set("dateFrom", params.dateFrom);
    if (params.dateTo) searchParams.set("dateTo", params.dateTo);
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
  deleteAll: (params: DateRangeParams = {}) =>
    request<{ success: boolean; count: number }>(`/api/customers${buildDateRangeQuery(params)}`, { method: "DELETE" }),
};

export type CustomerAnalyticsMetric = {
  id: string;
  name: string;
  company: string | null;
  totalSpend: number;
  lifetimeValue: number;
  purchaseFrequency: number;
  averageOrderValue: number;
  lastPurchaseAt: string | null;
  segment: "vip" | "frequent" | "at_risk" | "new" | "standard";
};

export type CustomerAnalytics = {
  top20: CustomerAnalyticsMetric[];
  bottom20: CustomerAnalyticsMetric[];
  summary: {
    totalCustomers: number;
    top20AverageSpend: number;
    bottom20AverageSpend: number;
    averageLifetimeValue: number;
    averagePurchaseFrequency: number;
    atRiskCustomers: number;
  };
  recommendations: { tone: "success" | "warning" | "info"; title: string; message: string; action: string }[];
};

export const customerAnalyticsApi = {
  get: (params: { dateFrom?: string; dateTo?: string } = {}) => {
    const sp = new URLSearchParams();
    if (params.dateFrom) sp.set("dateFrom", params.dateFrom);
    if (params.dateTo) sp.set("dateTo", params.dateTo);
    const qs = sp.toString();
    return request<CustomerAnalytics>(`/api/customers/analytics${qs ? `?${qs}` : ""}`);
  },
};

// ─── Trash API ───────────────────────────────────────────────────────────────

export type TrashRecordType = "customers" | "sales" | "finance" | "projects" | "websites";

export type TrashRecord = {
  type: TrashRecordType;
  id: string;
  title: string;
  subtitle: string;
  recordDate: string | null;
  deletedAt: string | null;
  deletedByUserId: string | null;
  deletedReason: string | null;
  restoreRequested: boolean;
  restoreRequestCount: number;
};

export type TrashParams = {
  page?: number;
  limit?: number;
  type?: TrashRecordType | "all";
  dateFrom?: string;
  dateTo?: string;
};

export type TrashResponse = {
  records: TrashRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  canRestore: boolean;
  canPermanentDelete: boolean;
};

export const trashApi = {
  list: (params: TrashParams = {}) => {
    const sp = new URLSearchParams();
    if (params.page) sp.set("page", String(params.page));
    if (params.limit) sp.set("limit", String(params.limit));
    if (params.type && params.type !== "all") sp.set("type", params.type);
    if (params.dateFrom) sp.set("dateFrom", params.dateFrom);
    if (params.dateTo) sp.set("dateTo", params.dateTo);
    const qs = sp.toString();
    return request<TrashResponse>(`/api/trash${qs ? `?${qs}` : ""}`);
  },
  restore: (type: TrashRecordType, id: string) =>
    request<{ success: boolean; restored: number }>("/api/trash", {
      method: "POST",
      body: { type, id, action: "restore" },
    }),
  requestRestore: (type: TrashRecordType, id: string) =>
    request<{ success: boolean; message: string }>("/api/trash", {
      method: "POST",
      body: { type, id, action: "request_restore" },
    }),
  requestRestoreAll: (type: string, dateFrom?: string, dateTo?: string) =>
    request<{ success: boolean; message: string }>("/api/trash", {
      method: "POST",
      body: { type, action: "request_restore_all", dateFrom, dateTo },
    }),
  permanentDelete: (type: TrashRecordType, id: string, confirmation: "PERMANENT DELETE") =>
    request<{ success: boolean; deleted: number }>("/api/trash", {
      method: "DELETE",
      body: { type, id, confirmation },
    }),
  restoreAll: (type: string, dateFrom?: string, dateTo?: string) =>
    request<{ success: boolean; message: string }>("/api/trash", {
      method: "POST",
      body: { type, action: "restore_all", dateFrom, dateTo },
    }),
  permanentDeleteAll: (type: string, confirmation: "PERMANENT DELETE ALL", dateFrom?: string, dateTo?: string) =>
    request<{ success: boolean; message: string }>("/api/trash", {
      method: "DELETE",
      body: { type, action: "delete_all", confirmation, dateFrom, dateTo },
    }),
};

// ─── Page-specific Stats API ─────────────────────────────────────────────────

export type DailyReportStats = {
  totalReports: number;
  todayReports: number;
  pendingReports: number;
  dueToday: number;
};

export type CustomerFollowupStats = {
  totalFollowUps: number;
  todayFollowUps: number;
  pendingFollowUps: number;
  dueToday: number;
  totalCustomers: number;
};

export const dailyReportApi = {
  stats: () => request<DailyReportStats>("/api/daily-report/stats"),
};

export const customerFollowupsApi = {
  stats: (params: { dateFrom?: string; dateTo?: string } = {}) => {
    const sp = new URLSearchParams();
    if (params.dateFrom) sp.set("dateFrom", params.dateFrom);
    if (params.dateTo) sp.set("dateTo", params.dateTo);
    const qs = sp.toString();
    return request<CustomerFollowupStats>(`/api/customer-followups/stats${qs ? `?${qs}` : ""}`);
  },
};

// ─── Business Reports API ─────────────────────────────────────────────────────

export type BusinessReport = {
  id: string;
  reportDate: string;
  reporterName: string | null;
  senderId: string | null;
  sender: { displayName: string; username: string | null } | null;
  uploadedByUserId: string | null;
  marketingBudget: number | null;
  marketingChannel: string | null;
  callsMade: number | null;
  appointmentsMade: number | null;
  appointmentsKept: number | null;
  newLeads: number | null;
  totalDemandCount: number | null;
  totalSalesAmount: number | null;
  closedDeals: number | null;
  pendingDeals: number | null;
  targetSalesAmount: number | null;
  targetDemandCount: number | null;
  targetAppointments: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BusinessReportStats = {
  totalReports: number;
  totalBudget: number;
  totalSales: number;
  totalLeads: number;
  totalClosed: number;
  totalCalls: number;
  totalApptsMade: number;
  totalApptsKept: number;
  totalDemand: number;
  totalPending: number;
  conversionRate: number;
  apptShowRate: number;
  costPerLead: number;
  roi: number;
  channelPerformance: {
    channel: string;
    count: number;
    budget: number;
    sales: number;
    leads: number;
    closed: number;
  }[];
  dailyTrend: { date: string; sales: number; budget: number; leads: number }[];
};

export type BusinessReportRecommendation = {
  title: string;
  insight: string;
  action?: string;
  actionType?:
    | 'view_sales_marketing'
    | 'view_customer_service'
    | 'view_finance_table'
    | 'general_dashboard';
};

export type BusinessReportsParams = {
  page?: number;
  limit?: number;
  channel?: string;
  dateFrom?: string;
  dateTo?: string;
};

export type BusinessReportsResponse = {
  records: BusinessReport[];
  total: number;
  page: number;
  limit: number;
};

export const businessReportsApi = {
  list: (params: BusinessReportsParams = {}) => {
    const sp = new URLSearchParams();
    if (params.page) sp.set("page", String(params.page));
    if (params.limit) sp.set("limit", String(params.limit));
    if (params.channel) sp.set("channel", params.channel);
    if (params.dateFrom) sp.set("dateFrom", params.dateFrom);
    if (params.dateTo) sp.set("dateTo", params.dateTo);
    const qs = sp.toString();
    return request<BusinessReportsResponse>(`/api/business-reports${qs ? `?${qs}` : ""}`);
  },
  update: (id: string, data: Partial<BusinessReport>) =>
    request<{ record: BusinessReport }>(`/api/business-reports/${id}`, { method: "PATCH", body: data }),
  delete: (id: string) =>
    request<{ success: boolean }>(`/api/business-reports/${id}`, { method: "DELETE" }),
  stats: (params: Pick<BusinessReportsParams, "dateFrom" | "dateTo"> = {}) => {
    const sp = new URLSearchParams();
    if (params.dateFrom) sp.set("dateFrom", params.dateFrom);
    if (params.dateTo) sp.set("dateTo", params.dateTo);
    const qs = sp.toString();
    return request<BusinessReportStats>(`/api/business-reports/stats${qs ? `?${qs}` : ""}`);
  },
  recommendations: () =>
    request<{ recommendations: BusinessReportRecommendation[] }>("/api/business-reports/recommendations"),
  deleteAll: (params: DateRangeParams = {}) =>
    request<{ success: boolean; deleted: number }>(`/api/business-reports${buildDateRangeQuery(params)}`, { method: "DELETE" }),
};

// ─── Finance Entries API ────────────────────────────────────────────────────

export type FinanceEntryType = "salary" | "cogs" | "operating_expense" | "payment" | "receivable" | "debt" | "voucher";
export type FinanceEntryStatus = "recorded" | "pending" | "paid" | "settled" | "overdue";

export type FinanceEntry = {
  id: string;
  entryDate: string;
  type: FinanceEntryType;
  title: string;
  amount: number;
  status: FinanceEntryStatus;
  counterparty: string | null;
  dueDate: string | null;
  voucherNumber: string | null;
  notes: string | null;
  uploadedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FinanceEntriesParams = {
  dateFrom?: string;
  dateTo?: string;
  type?: FinanceEntryType;
  status?: FinanceEntryStatus;
};

export type FinanceEntrySummary = {
  salary: number;
  cogs: number;
  operatingExpense: number;
  payments: number;
  receivables: number;
  debts: number;
  vouchers: number;
};

export const financeEntriesApi = {
  list: (params: FinanceEntriesParams = {}) => {
    const sp = new URLSearchParams();
    if (params.dateFrom) sp.set("dateFrom", params.dateFrom);
    if (params.dateTo) sp.set("dateTo", params.dateTo);
    if (params.type) sp.set("type", params.type);
    if (params.status) sp.set("status", params.status);
    const qs = sp.toString();
    return request<{ entries: FinanceEntry[]; summary: FinanceEntrySummary }>(`/api/finance-entries${qs ? `?${qs}` : ""}`);
  },
  create: (data: Omit<FinanceEntry, "id" | "uploadedByUserId" | "createdAt" | "updatedAt">) =>
    request<{ entry: FinanceEntry }>("/api/finance-entries", { method: "POST", body: data }),
  update: (id: string, data: Partial<FinanceEntry>) =>
    request<{ entry: FinanceEntry }>(`/api/finance-entries/${id}`, { method: "PATCH", body: data }),
  delete: (id: string) =>
    request<{ success: boolean }>(`/api/finance-entries/${id}`, { method: "DELETE" }),
  deleteAll: (params: DateRangeParams = {}) =>
    request<{ success: boolean; deleted: number }>(`/api/finance-entries${buildDateRangeQuery(params)}`, { method: "DELETE" }),
};
