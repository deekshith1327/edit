import type {
  AspectRatio,
  BatchLookProfile,
  ChatMessage,
  CreativeBrief,
  EditPlan,
  ExportArtifact,
  MediaAsset,
  PhotoEditRecipe,
  ProcessingJob,
  Project,
  ProjectRevision,
  ProjectType,
  ProviderStatus,
  User,
} from '../shared/types';

export class ApiError extends Error {
  public readonly status: number;
  public readonly requiresPaidKey?: boolean;
  public readonly model?: string;
  public readonly providerError?: boolean;

  constructor(
    message: string,
    status: number,
    meta?: { requiresPaidKey?: boolean; model?: string; providerError?: boolean }
  ) {
    super(message);
    this.status = status;
    this.requiresPaidKey = meta?.requiresPaidKey;
    this.model = meta?.model;
    this.providerError = meta?.providerError;
  }
}

const SESSION_TOKEN_STORAGE_KEY = 'frameflow_session_token';
let memorySessionToken: string | null = null;

function readStoredToken(): string | null {
  if (memorySessionToken) return memorySessionToken;
  try {
    const stored = window.sessionStorage.getItem(SESSION_TOKEN_STORAGE_KEY);
    if (stored) {
      memorySessionToken = stored;
      return stored;
    }
  } catch {
    // sessionStorage may be restricted in strict sandboxed iframes; fall back to in-memory token
  }
  return null;
}

function writeStoredToken(token: string | null): void {
  memorySessionToken = token;
  try {
    if (token) {
      window.sessionStorage.setItem(SESSION_TOKEN_STORAGE_KEY, token);
    } else {
      window.sessionStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore storage restrictions
  }
}

export function withAuthToken(url: string): string {
  const token = readStoredToken();
  if (!token) return url;
  if (!url.startsWith('/api/media/file/') && !url.startsWith('/api/exports/')) {
    return url;
  }
  const encoded = encodeURIComponent(token);
  if (/([?&])token=/.test(url)) {
    return url.replace(/([?&])token=[^&]*/g, `$1token=${encoded}`);
  }
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encoded}`;
}

function decorateMediaUrls<T>(input: T): T {
  const token = readStoredToken();
  if (!token || input == null) return input;
  if (typeof input === 'string') {
    return withAuthToken(input) as unknown as T;
  }
  if (Array.isArray(input)) {
    return input.map((item) => decorateMediaUrls(item)) as unknown as T;
  }
  if (typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = decorateMediaUrls(v);
    }
    return out as T;
  }
  return input;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const token = readStoredToken();
  const res = await fetch(url, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
  });

  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text || res.statusText };
  }

  if (!res.ok) {
    throw new ApiError(
      String(data.error || `Request failed (${res.status})`),
      res.status,
      {
        requiresPaidKey: Boolean(data.requiresPaidKey),
        model: data.model ? String(data.model) : undefined,
        providerError: Boolean(data.providerError),
      }
    );
  }
  if (typeof data.token === 'string' && data.token.trim()) {
    writeStoredToken(data.token.trim());
  }
  return decorateMediaUrls(data as T);
}

export const api = {
  getProviderStatus: () => request<ProviderStatus>('/api/status'),

  getMe: () =>
    request<{
      user: User | null;
      storageUsedBytes?: number;
      storageQuotaBytes?: number;
      storageBreakdown?: Record<string, number>;
    }>('/api/auth/me'),

  signIn: (email: string, password: string) =>
    request<{ user: User; token?: string }>('/api/auth/signin', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  signUp: (email: string, name: string, password: string) =>
    request<{ user: User; token?: string }>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, name, password }),
    }),

  signInDemo: () =>
    request<{ user: User; token?: string }>('/api/auth/demo', { method: 'POST' }),

  signOut: async () => {
    try {
      return await request<{ ok: boolean }>('/api/auth/signout', { method: 'POST' });
    } finally {
      writeStoredToken(null);
    }
  },

  updateAccount: (name: string, role: string) =>
    request<{ user: User }>('/api/account', {
      method: 'PATCH',
      body: JSON.stringify({ name, role }),
    }),

  listProjects: () => request<{ projects: Project[] }>('/api/projects'),

  createProject: (payload: { name: string; type: ProjectType; brief: Partial<CreativeBrief> }) =>
    request<{ project: Project }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getProjectDetail: (projectId: string) =>
    request<{
      project: Project;
      assets: MediaAsset[];
      revisions: ProjectRevision[];
      jobs: ProcessingJob[];
      exports: ExportArtifact[];
      chatMessages: ChatMessage[];
    }>(`/api/projects/${projectId}`),

  updateProject: (
    projectId: string,
    payload: {
      name?: string;
      status?: string;
      brief?: Partial<CreativeBrief>;
      editPlan?: EditPlan;
      photoEdits?: Record<string, PhotoEditRecipe>;
      batchLook?: Partial<BatchLookProfile>;
      createRevisionLabel?: string;
      authorNote?: string;
    }
  ) =>
    request<{ project: Project; revision: ProjectRevision | null }>(`/api/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  duplicateProject: (projectId: string) =>
    request<{ project: Project }>(`/api/projects/${projectId}/duplicate`, {
      method: 'POST',
    }),

  deleteProject: (projectId: string) =>
    request<{ ok: boolean }>(`/api/projects/${projectId}`, {
      method: 'DELETE',
    }),

  restoreRevision: (projectId: string, revId: string) =>
    request<{ project: Project; revision: ProjectRevision }>(
      `/api/projects/${projectId}/revisions/${revId}/restore`,
      { method: 'POST' }
    ),

  uploadAssetsWithProgress: (
    projectId: string,
    files: File[],
    onProgress: (pct: number) => void
  ): Promise<{
    uploaded: MediaAsset[];
    rejected: Array<{
      filename: string;
      error: string;
      recoveryAction: string;
      isRawFormat?: boolean;
    }>;
    photoEdits: Record<string, PhotoEditRecipe>;
  }> => {
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      for (const f of files) {
        formData.append('files', f);
      }

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/projects/${projectId}/assets`);
      xhr.withCredentials = true;
      const token = readStoredToken();
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }

      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) {
          onProgress(Math.round((ev.loaded / ev.total) * 100));
        }
      };

      xhr.onload = () => {
        try {
          const parsed = decorateMediaUrls(JSON.parse(xhr.responseText || '{}'));
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(parsed);
          } else if (parsed.rejected) {
            // Validation failures still return structured recovery details
            resolve({ uploaded: parsed.uploaded || [], rejected: parsed.rejected, photoEdits: parsed.photoEdits || {} });
          } else {
            reject(new ApiError(parsed.error || 'Upload failed', xhr.status));
          }
        } catch {
          reject(new ApiError('Invalid server response during upload', xhr.status));
        }
      };
      xhr.onerror = () => reject(new ApiError('Network interrupted during upload. Retry safely.', 0));
      xhr.send(formData);
    });
  },

  updateAsset: (
    projectId: string,
    assetId: string,
    payload: { directive?: MediaAsset['directive']; bin?: string; orderIndex?: number }
  ) =>
    request<{ asset: MediaAsset }>(`/api/projects/${projectId}/assets/${assetId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteAsset: (projectId: string, assetId: string) =>
    request<{ ok: boolean }>(`/api/projects/${projectId}/assets/${assetId}`, {
      method: 'DELETE',
    }),

  startAnalysis: (projectId: string, engine: 'gemini' | 'local') =>
    request<{ job: ProcessingJob }>(`/api/projects/${projectId}/analyze`, {
      method: 'POST',
      body: JSON.stringify({ engine }),
    }),

  autoReframe: (
    projectId: string,
    payload: { targetAspectRatio: AspectRatio; segmentId?: string; engine: 'gemini' | 'local' }
  ) =>
    request<{ project: Project; assets: MediaAsset[]; revision: ProjectRevision }>(
      `/api/projects/${projectId}/reframe`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  getJobs: (projectId: string) => request<{ jobs: ProcessingJob[] }>(`/api/projects/${projectId}/jobs`),

  cancelJob: (jobId: string) =>
    request<{ job: ProcessingJob }>(`/api/jobs/${jobId}/cancel`, { method: 'POST' }),

  renderVideo: (
    projectId: string,
    payload: {
      preset: string;
      aspectRatio: AspectRatio;
      fps: number;
      burnCaptions: boolean;
      includeTitles: boolean;
    }
  ) =>
    request<{ job: ProcessingJob }>(`/api/projects/${projectId}/render-video`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  exportPhotos: (
    projectId: string,
    payload: {
      assetIds: string[];
      format: 'jpeg' | 'png' | 'tiff';
      quality: number;
      maxDimension: number | null;
    }
  ) =>
    request<{ exportArtifact: ExportArtifact }>(`/api/projects/${projectId}/export-photos`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  sendChatMessage: (
    projectId: string,
    message: string,
    mode: 'general' | 'complex_interactive' | 'deep_thinking' | 'fast' | 'search_grounding'
  ) =>
    request<{ messages: ChatMessage[] }>(`/api/projects/${projectId}/chat`, {
      method: 'POST',
      body: JSON.stringify({ message, mode }),
    }),

  getQuickTip: (projectId: string, prompt: string) =>
    request<{ suggestion: string; model: string }>(`/api/projects/${projectId}/quick-tip`, {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    }),

  transcribeAudioBlob: (projectId: string, blob: Blob, filename = 'recording.webm') => {
    const fd = new FormData();
    fd.append('audio', blob, filename);
    return request<{ transcript: string; model: string }>(`/api/projects/${projectId}/transcribe`, {
      method: 'POST',
      body: fd,
    });
  },

  transcribeAudioAsset: (projectId: string, assetId: string) =>
    request<{ transcript: string; model: string }>(`/api/projects/${projectId}/transcribe`, {
      method: 'POST',
      body: JSON.stringify({ assetId }),
    }),

  generateOrEditImage: (
    projectId: string,
    payload: { prompt: string; aspectRatio: string; sourceAssetId?: string | null }
  ) =>
    request<{
      mode: 'create' | 'edit';
      asset?: MediaAsset;
      recipe?: PhotoEditRecipe;
      photoEdits: Record<string, PhotoEditRecipe>;
      notes: string;
    }>(`/api/projects/${projectId}/generate-image`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  generateVideoClip: (
    projectId: string,
    payload: {
      prompt: string;
      aspectRatio: '16:9' | '9:16';
      durationSec: number;
      sourceAssetId?: string | null;
    }
  ) =>
    request<{ asset: MediaAsset; model: string }>(`/api/projects/${projectId}/generate-video`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  animateUploadedPhoto: (
    projectId: string,
    payload: {
      photoFile: File;
      prompt: string;
      aspectRatio: '16:9' | '9:16';
      durationSec: number;
    }
  ) => {
    const fd = new FormData();
    fd.append('photo', payload.photoFile, payload.photoFile.name);
    fd.append('prompt', payload.prompt);
    fd.append('aspectRatio', payload.aspectRatio);
    fd.append('durationSec', String(payload.durationSec));
    return request<{ asset: MediaAsset; model: string }>(
      `/api/projects/${projectId}/generate-video`,
      {
        method: 'POST',
        body: fd,
      }
    );
  },

  generateMusicTrack: (projectId: string, payload: { prompt: string; mode: 'clip' | 'pro' }) =>
    request<{ asset: MediaAsset; lyrics: string; model: string }>(
      `/api/projects/${projectId}/generate-music`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
};

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let idx = 0;
  let val = bytes;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${val.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}
