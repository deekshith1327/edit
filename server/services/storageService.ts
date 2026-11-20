import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export type StorageBucket = 'originals' | 'proxies' | 'thumbnails' | 'previews' | 'exports' | 'generated';

const ROOT_STORAGE = path.resolve(process.cwd(), '.frameflow_storage');

const BUCKETS: StorageBucket[] = [
  'originals',
  'proxies',
  'thumbnails',
  'previews',
  'exports',
  'generated',
];

export const MAX_FILE_SIZE_BYTES = 250 * 1024 * 1024; // 250 MB per asset
export const USER_STORAGE_QUOTA_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB per user

export const SUPPORTED_VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm', '.m4v', '.mkv']);
export const SUPPORTED_PHOTO_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif']);
export const SUPPORTED_AUDIO_EXTS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.webm']);
export const UNSUPPORTED_RAW_EXTS = new Set(['.cr2', '.cr3', '.nef', '.arw', '.dng', '.raf', '.orf', '.rw2']);

export function ensureStorageDirs(): void {
  fs.mkdirSync(ROOT_STORAGE, { recursive: true });
  for (const bucket of BUCKETS) {
    fs.mkdirSync(path.join(ROOT_STORAGE, bucket), { recursive: true });
  }
}

export function resolveStoragePath(storageKey: string): string {
  const normalized = path.normalize(storageKey).replace(/^(\.\.(\/|\\|$))+/, '');
  const full = path.resolve(ROOT_STORAGE, normalized);
  if (!full.startsWith(ROOT_STORAGE)) {
    throw new Error('Invalid storage path traversal attempt');
  }
  return full;
}

export function createStorageKey(bucket: StorageBucket, originalFilename: string, extOverride?: string): string {
  const ext = (extOverride || path.extname(originalFilename) || '.bin').toLowerCase();
  const base = path
    .basename(originalFilename, path.extname(originalFilename))
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .slice(0, 42) || 'asset';
  const id = crypto.randomBytes(6).toString('hex');
  return path.posix.join(bucket, `${base}_${id}${ext}`);
}

export function writeBufferToStorage(bucket: StorageBucket, filename: string, buffer: Buffer, extOverride?: string): {
  storageKey: string;
  absolutePath: string;
  sizeBytes: number;
} {
  ensureStorageDirs();
  const storageKey = createStorageKey(bucket, filename, extOverride);
  const absolutePath = resolveStoragePath(storageKey);
  fs.writeFileSync(absolutePath, buffer);
  return {
    storageKey,
    absolutePath,
    sizeBytes: buffer.length,
  };
}

export function copyFileToStorage(bucket: StorageBucket, srcPath: string, filename: string): {
  storageKey: string;
  absolutePath: string;
  sizeBytes: number;
} {
  ensureStorageDirs();
  const storageKey = createStorageKey(bucket, filename);
  const absolutePath = resolveStoragePath(storageKey);
  fs.copyFileSync(srcPath, absolutePath);
  const stat = fs.statSync(absolutePath);
  return {
    storageKey,
    absolutePath,
    sizeBytes: stat.size,
  };
}

export function deleteStorageFile(storageKey: string | null | undefined): void {
  if (!storageKey) return;
  try {
    const abs = resolveStoragePath(storageKey);
    if (fs.existsSync(abs)) {
      fs.unlinkSync(abs);
    }
  } catch {
    // ignore cleanup failures
  }
}

export interface FileValidationResult {
  valid: boolean;
  kind?: 'video' | 'photo' | 'audio' | 'brand';
  error?: string;
  recoveryAction?: string;
  isRawFormat?: boolean;
}

export function validateUploadedFile(
  filename: string,
  mimeType: string,
  sizeBytes: number,
  currentUserUsedBytes: number
): FileValidationResult {
  const ext = path.extname(filename).toLowerCase();

  if (sizeBytes <= 0) {
    return {
      valid: false,
      error: `"${filename}" appears to be empty (0 bytes).`,
      recoveryAction: 'Check the source file on your device and upload a valid media file.',
    };
  }

  if (sizeBytes > MAX_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: `"${filename}" exceeds the 250 MB per-asset limit (${(sizeBytes / 1024 / 1024).toFixed(1)} MB).`,
      recoveryAction: 'Transcode or trim the clip before uploading, or split into shorter reels.',
    };
  }

  if (currentUserUsedBytes + sizeBytes > USER_STORAGE_QUOTA_BYTES) {
    return {
      valid: false,
      error: 'Workspace storage quota (2 GB) would be exceeded by this upload.',
      recoveryAction: 'Archive or delete unused exports/projects in Settings to free storage.',
    };
  }

  if (UNSUPPORTED_RAW_EXTS.has(ext)) {
    return {
      valid: false,
      isRawFormat: true,
      error: `Camera RAW (${ext.toUpperCase()}) decoding is not configured in this studio pipeline.`,
      recoveryAction:
        'Convert the RAW file to 16-bit TIFF or high-quality JPEG/PNG (sRGB) in your camera utility or Lightroom, then re-upload.',
    };
  }

  if (SUPPORTED_VIDEO_EXTS.has(ext) || mimeType.startsWith('video/')) {
    return { valid: true, kind: 'video' };
  }
  if (SUPPORTED_PHOTO_EXTS.has(ext) || mimeType.startsWith('image/')) {
    return { valid: true, kind: 'photo' };
  }
  if (SUPPORTED_AUDIO_EXTS.has(ext) || mimeType.startsWith('audio/')) {
    return { valid: true, kind: 'audio' };
  }

  return {
    valid: false,
    error: `Unsupported file format "${ext || mimeType}" for "${filename}".`,
    recoveryAction: 'Upload MP4/MOV/WebM video, JPEG/PNG/WebP/TIFF photos, or MP3/WAV/M4A audio.',
  };
}

export function computeStorageBreakdown(): Record<StorageBucket, number> {
  ensureStorageDirs();
  const result: Record<StorageBucket, number> = {
    originals: 0,
    proxies: 0,
    thumbnails: 0,
    previews: 0,
    exports: 0,
    generated: 0,
  };
  for (const bucket of BUCKETS) {
    const dir = path.join(ROOT_STORAGE, bucket);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      try {
        const stat = fs.statSync(path.join(dir, file));
        if (stat.isFile()) result[bucket] += stat.size;
      } catch {
        // ignore
      }
    }
  }
  return result;
}
