import axios, { type AxiosInstance, type AxiosError } from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  role: string;
  createdAt?: string;
}

export interface ScheduledEmailItem {
  id: string;
  recipientEmail: string;
  subject: string;
  body?: string;
  scheduledAt: string;
  status: 'SCHEDULED' | 'RATE_LIMITED_RESCHEDULED' | 'PROCESSING' | 'SENT' | 'FAILED' | 'CANCELLED';
  senderEmail: string;
}

export interface SentEmailItem {
  id: string;
  recipientEmail: string;
  subject: string;
  body?: string;
  sentAt: string | null;
  status: 'SENT' | 'FAILED';
  senderEmail: string;
  etherealPreviewUrl?: string | null;
  errorMessage?: string | null;
}

export interface SenderIdentityItem {
  id: string;
  emailAddress: string;
  displayName: string;
  smtpHost: string;
  smtpPort: number;
  smtpUsername: string;
  smtpPasswordMasked: string;
  hourlyRateLimit: number;
  minDelaySeconds: number;
  isActive: boolean;
  createdAt: string;
}

export interface SlackStatus {
  isConnected: boolean;
  teamName?: string;
  defaultChannelId?: string;
  defaultChannelName?: string;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  totalRecords: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface ScheduleCampaignPayload {
  senderId: string;
  subject: string;
  body: string;
  recipients: string[];
  scheduledAt: string;
  delayBetweenEmails?: number;
  hourlyLimit?: number;
}

class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      withCredentials: true,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError<{ error?: { message?: string; code?: string } }>) => {
        const message =
          error.response?.data?.error?.message ||
          error.message ||
          'An unexpected communication error occurred with the ReachInbox server';
        return Promise.reject(new Error(message));
      }
    );
  }

  // --- Auth Endpoints ---
  async getCurrentUser(): Promise<UserProfile> {
    const res = await this.client.get<{ success: boolean; data: UserProfile }>('/api/v1/auth/me');
    return res.data.data;
  }

  async logout(): Promise<void> {
    await this.client.post('/api/v1/auth/logout');
  }

  async devLogin(email?: string, name?: string): Promise<UserProfile> {
    const res = await this.client.post<{ success: boolean; data: { user: UserProfile; token: string } }>(
      '/api/v1/auth/dev-login',
      { email, name }
    );
    return res.data.data.user;
  }

  getGoogleLoginUrl(): string {
    return `${API_BASE_URL}/api/v1/auth/google`;
  }

  // --- Senders Endpoints ---
  async getSenders(): Promise<SenderIdentityItem[]> {
    const res = await this.client.get<{ success: boolean; data: SenderIdentityItem[] }>('/api/v1/senders');
    return res.data.data;
  }

  async createSender(payload: {
    emailAddress: string;
    displayName: string;
    smtpHost: string;
    smtpPort: number;
    smtpUsername: string;
    smtpPasswordPlain: string;
    hourlyRateLimit: number;
    minDelaySeconds: number;
  }): Promise<SenderIdentityItem> {
    const res = await this.client.post<{ success: boolean; data: SenderIdentityItem }>(
      '/api/v1/senders',
      payload
    );
    return res.data.data;
  }

  // --- Scheduled & Sent Emails ---
  async getScheduledEmails(params?: {
    page?: number;
    limit?: number;
    senderId?: string;
  }): Promise<{ data: ScheduledEmailItem[]; pagination: PaginationMeta }> {
    const res = await this.client.get<{
      success: boolean;
      data: ScheduledEmailItem[];
      pagination: PaginationMeta;
    }>('/api/v1/emails/scheduled', { params });
    return { data: res.data.data, pagination: res.data.pagination };
  }

  async getSentEmails(params?: {
    page?: number;
    limit?: number;
    senderId?: string;
    status?: string;
  }): Promise<{ data: SentEmailItem[]; pagination: PaginationMeta }> {
    const res = await this.client.get<{
      success: boolean;
      data: SentEmailItem[];
      pagination: PaginationMeta;
    }>('/api/v1/emails/sent', { params });
    return { data: res.data.data, pagination: res.data.pagination };
  }

  async scheduleCampaign(payload: ScheduleCampaignPayload): Promise<{ batchId: string; totalScheduled: number }> {
    const res = await this.client.post<{
      success: boolean;
      data: { batchId: string; totalScheduled: number };
    }>('/api/v1/emails/schedule', payload);
    return res.data.data;
  }

  async cancelScheduledEmail(id: string): Promise<void> {
    await this.client.delete(`/api/v1/emails/scheduled/${id}`);
  }

  // --- Elasticsearch Search ---
  async searchEmails(params: {
    q?: string;
    status?: string;
    senderId?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: Array<{ id: string; recipientEmail: string; subject: string; status: string; sentAt?: string; scheduledAt?: string; etherealPreviewUrl?: string; highlights?: Record<string, string[]> }>; meta: { page: number; limit: number; totalRecords: number; totalPages: number } }> {
    const res = await this.client.get<{
      success: boolean;
      data: Array<{ id: string; recipientEmail: string; subject: string; status: string; sentAt?: string; scheduledAt?: string; etherealPreviewUrl?: string; highlights?: Record<string, string[]> }>;
      meta: { page: number; limit: number; totalRecords: number; totalPages: number };
    }>('/api/v1/emails/search', { params });
    return { data: res.data.data, meta: res.data.meta };
  }

  // --- Slack Integration ---
  async getSlackStatus(): Promise<SlackStatus> {
    const res = await this.client.get<{ success: boolean; data: SlackStatus }>(
      '/api/v1/integrations/slack/status'
    );
    return res.data.data;
  }

  getSlackAuthorizeUrl(): string {
    return `${API_BASE_URL}/api/v1/integrations/slack/authorize`;
  }

  async disconnectSlack(): Promise<void> {
    await this.client.delete('/api/v1/integrations/slack/disconnect');
  }

  async sendSlackTestNotification(): Promise<{ success: boolean; message: string }> {
    const res = await this.client.post<{ success: boolean; message: string }>(
      '/api/v1/integrations/slack/test'
    );
    return res.data;
  }

  // --- Infrastructure Health ---
  async getSystemHealth(): Promise<{
    status: string;
    dependencies: { database: string; redis: string; elasticsearch: string };
  }> {
    const res = await this.client.get<{
      status: string;
      dependencies: { database: string; redis: string; elasticsearch: string };
    }>('/api/health');
    return res.data;
  }
}

export const api = new ApiClient();
