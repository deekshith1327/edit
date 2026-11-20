import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import {
  copyFileToStorage,
  createStorageKey,
  ensureStorageDirs,
  resolveStoragePath,
} from './services/storageService';
import {
  computeLocalSaliencySubject,
  createSeedVideoClipFromStill,
  generatePhotoThumbnail,
  generateVideoThumbnailAndKeyframes,
  inspectPhotoMetadata,
  probeVideoOrAudio,
} from './services/mediaPrepService';
import { buildReframeFromDetection } from '../src/shared/reframing';
import { defaultColorGrade, rippleRecalculateTimeline } from '../src/shared/timeline';
import { createDefaultPhotoRecipe } from '../src/shared/photoMath';
import type {
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
  User,
  VideoSegment,
} from '../src/shared/types';

const DB_PATH = path.resolve(process.cwd(), '.frameflow_studio.db');
export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabaseSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'editor',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      brief_json TEXT NOT NULL,
      thumbnail_url TEXT,
      edit_plan_json TEXT,
      photo_edits_json TEXT NOT NULL DEFAULT '{}',
      batch_look_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'original',
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size_bytes INTEGER NOT NULL,
      storage_key TEXT NOT NULL,
      thumbnail_key TEXT,
      proxy_key TEXT,
      metadata_json TEXT NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      directive TEXT NOT NULL DEFAULT 'normal',
      bin TEXT NOT NULL DEFAULT 'Main Pool',
      analysis_json TEXT,
      warnings_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS revisions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      label TEXT NOT NULL,
      author_note TEXT NOT NULL,
      edit_plan_json TEXT NOT NULL,
      photo_edits_json TEXT NOT NULL,
      batch_look_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      current_stage INTEGER NOT NULL,
      stage_label TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      message TEXT NOT NULL,
      error_message TEXT,
      failed_stage TEXT,
      result_ref TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS exports (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      filename TEXT NOT NULL,
      format TEXT NOT NULL,
      resolution TEXT NOT NULL,
      aspect_ratio TEXT NOT NULL,
      fps INTEGER,
      codec TEXT,
      file_size_bytes INTEGER NOT NULL,
      storage_key TEXT NOT NULL,
      settings_summary TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT NOT NULL,
      mode TEXT NOT NULL,
      sources_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
  `);
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

export function defaultBrief(overrides?: Partial<CreativeBrief>): CreativeBrief {
  return {
    purpose: 'brand_story',
    aspectRatio: '16:9',
    targetDurationSec: null,
    pace: 'balanced',
    visualDirection: 'cinematic',
    contentPriority: 'balanced',
    captionsEnabled: true,
    titlesEnabled: true,
    logoEnabled: false,
    endCardEnabled: true,
    musicSource: 'later',
    brandPrimaryColor: '#D99B43',
    brandTitleText: 'Pacific Craft',
    endCardText: 'Crafted in the Pacific Northwest',
    writtenInstruction: '',
    mustKeepNotes: '',
    doNotUseNotes: '',
    referenceAssetId: null,
    ...overrides,
  };
}

export function defaultBatchLook(): BatchLookProfile {
  return {
    look: 'cinematic_contrast',
    intensity: 65,
    referenceAssetId: null,
    consistencyStrength: 75,
    preserveDistinctLighting: true,
    updatedAt: new Date().toISOString(),
  };
}

export function mapAssetRow(row: Record<string, unknown>): MediaAsset {
  const id = String(row.id);
  const projectId = String(row.project_id);
  return {
    id,
    projectId,
    kind: row.kind as MediaAsset['kind'],
    role: row.role as MediaAsset['role'],
    filename: String(row.filename),
    mimeType: String(row.mime_type),
    fileSizeBytes: Number(row.file_size_bytes),
    storageKey: String(row.storage_key),
    thumbnailUrl: row.thumbnail_key
      ? `/api/media/file/${encodeURIComponent(String(row.thumbnail_key))}`
      : `/api/media/file/${encodeURIComponent(String(row.storage_key))}`,
    mediaUrl: `/api/media/file/${encodeURIComponent(String(row.storage_key))}`,
    proxyUrl: row.proxy_key
      ? `/api/media/file/${encodeURIComponent(String(row.proxy_key))}`
      : null,
    metadata: JSON.parse(String(row.metadata_json)),
    orderIndex: Number(row.order_index),
    directive: (row.directive as MediaAsset['directive']) || 'normal',
    bin: String(row.bin || 'Main Pool'),
    analysis: row.analysis_json ? JSON.parse(String(row.analysis_json)) : undefined,
    warnings: JSON.parse(String(row.warnings_json || '[]')),
    createdAt: String(row.created_at),
  };
}

export function mapProjectRow(row: Record<string, unknown>): Project {
  const projectId = String(row.id);
  const counts = db
    .prepare(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN kind = 'video' THEN 1 ELSE 0 END) as videos,
        SUM(CASE WHEN kind = 'photo' THEN 1 ELSE 0 END) as photos
       FROM assets WHERE project_id = ?`
    )
    .get(projectId) as { total: number; videos: number | null; photos: number | null };

  const editPlan: EditPlan | null = row.edit_plan_json
    ? JSON.parse(String(row.edit_plan_json))
    : null;

  const estimatedDurationSec = editPlan
    ? editPlan.segments.reduce((acc, s) => Math.max(acc, s.timelineOutSec), 0)
    : 0;

  return {
    id: projectId,
    userId: String(row.user_id),
    name: String(row.name),
    type: row.type as Project['type'],
    status: row.status as Project['status'],
    brief: JSON.parse(String(row.brief_json)),
    thumbnailUrl: row.thumbnail_url ? String(row.thumbnail_url) : null,
    assetCount: counts?.total || 0,
    videoCount: counts?.videos || 0,
    photoCount: counts?.photos || 0,
    estimatedDurationSec: Number(estimatedDurationSec.toFixed(1)),
    editPlan,
    photoEdits: JSON.parse(String(row.photo_edits_json || '{}')),
    batchLook: JSON.parse(String(row.batch_look_json)),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapRevisionRow(row: Record<string, unknown>): ProjectRevision {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    versionNumber: Number(row.version_number),
    label: String(row.label),
    authorNote: String(row.author_note),
    editPlan: JSON.parse(String(row.edit_plan_json)),
    photoEdits: JSON.parse(String(row.photo_edits_json)),
    batchLook: JSON.parse(String(row.batch_look_json)),
    createdAt: String(row.created_at),
  };
}

export function mapJobRow(row: Record<string, unknown>): ProcessingJob {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    kind: row.kind as ProcessingJob['kind'],
    status: row.status as ProcessingJob['status'],
    currentStage: Number(row.current_stage) as ProcessingJob['currentStage'],
    stageLabel: String(row.stage_label),
    progress: Number(row.progress),
    message: String(row.message),
    errorMessage: row.error_message ? String(row.error_message) : null,
    failedStage: row.failed_stage ? String(row.failed_stage) : null,
    resultRef: row.result_ref ? String(row.result_ref) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapExportRow(row: Record<string, unknown>): ExportArtifact {
  const id = String(row.id);
  return {
    id,
    projectId: String(row.project_id),
    kind: row.kind as ExportArtifact['kind'],
    filename: String(row.filename),
    format: String(row.format),
    resolution: String(row.resolution),
    aspectRatio: String(row.aspect_ratio),
    fps: row.fps != null ? Number(row.fps) : null,
    codec: row.codec ? String(row.codec) : null,
    fileSizeBytes: Number(row.file_size_bytes),
    downloadUrl: `/api/exports/${id}/download`,
    settingsSummary: String(row.settings_summary),
    createdAt: String(row.created_at),
  };
}

export function mapChatRow(row: Record<string, unknown>): ChatMessage {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    role: row.role as ChatMessage['role'],
    content: String(row.content),
    model: String(row.model),
    mode: row.mode as ChatMessage['mode'],
    sources: row.sources_json ? JSON.parse(String(row.sources_json)) : undefined,
    createdAt: String(row.created_at),
  };
}

export function getUserById(userId: string): User | null {
  const row = db
    .prepare('SELECT id, email, name, role, created_at FROM users WHERE id = ?')
    .get(userId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    email: String(row.email),
    name: String(row.name),
    role: String(row.role),
    createdAt: String(row.created_at),
  };
}

export function getUserStorageUsage(userId: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(a.file_size_bytes), 0) as total
       FROM assets a
       INNER JOIN projects p ON p.id = a.project_id
       WHERE p.user_id = ?`
    )
    .get(userId) as { total: number };
  return row?.total || 0;
}

export function saveProjectRevision(
  projectId: string,
  label: string,
  authorNote: string,
  editPlan: EditPlan,
  photoEdits: Record<string, PhotoEditRecipe>,
  batchLook: BatchLookProfile
): ProjectRevision {
  const last = db
    .prepare('SELECT MAX(version_number) as maxVer FROM revisions WHERE project_id = ?')
    .get(projectId) as { maxVer: number | null };
  const versionNumber = (last?.maxVer || 0) + 1;
  const id = newId('rev');
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO revisions (id, project_id, version_number, label, author_note, edit_plan_json, photo_edits_json, batch_look_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    projectId,
    versionNumber,
    label,
    authorNote,
    JSON.stringify(editPlan),
    JSON.stringify(photoEdits),
    JSON.stringify(batchLook),
    now
  );
  return {
    id,
    projectId,
    versionNumber,
    label,
    authorNote,
    editPlan,
    photoEdits,
    batchLook,
    createdAt: now,
  };
}

export const DEMO_EMAIL = 'studio@frameflow.app';
export const DEMO_PASSWORD = 'studio-demo-password';

/**
 * Seeds a realistic demo studio account with two complete projects using our generated
 * studio imagery and real FFmpeg-generated MP4 video clips on disk so every editing,
 * reframing, photo grading, and export flow works immediately on first load.
 */
export async function seedDemoWorkspaceIfNeeded(): Promise<void> {
  initDatabaseSchema();
  ensureStorageDirs();

  const existingDemo = db
    .prepare('SELECT id FROM users WHERE email = ?')
    .get(DEMO_EMAIL) as { id: string } | undefined;
  if (existingDemo) {
    // Self-heal seeded demo media files if SQLite keys drifted from files on disk
    const seededAssets = db
      .prepare(
        `SELECT id, project_id, kind, filename, storage_key, thumbnail_key
         FROM assets
         WHERE project_id IN ('proj_pacific_craft', 'proj_monolith_stills')`
      )
      .all() as Array<{
      id: string;
      project_id: string;
      kind: string;
      filename: string;
      storage_key: string;
      thumbnail_key: string | null;
    }>;

    const findMatchingDiskFile = (
      bucket: 'originals' | 'thumbnails',
      baseStem: string,
      ext: string
    ): string | null => {
      const dir = resolveStoragePath(bucket);
      if (!fs.existsSync(dir)) return null;
      const entries = fs.readdirSync(dir);
      const match = entries.find(
        (name) => name.startsWith(`${baseStem}_`) && name.toLowerCase().endsWith(ext.toLowerCase())
      );
      return match ? `${bucket}/${match}` : null;
    };

    const imgDir = path.resolve(process.cwd(), 'src/assets/images');
    const sourceByAssetId: Record<string, string> = {
      ast_coastal_vid: path.join(imgDir, 'hero_studio_frame_1795169067824.jpg'),
      ast_roaster_vid: path.join(imgDir, 'media_craft_roaster_1795169056288.jpg'),
      ast_alpine_photo: path.join(imgDir, 'media_alpine_ridge_1795169049175.jpg'),
      ast_roaster_photo: path.join(imgDir, 'media_craft_roaster_1795169056288.jpg'),
      ast_watch_photo: path.join(imgDir, 'media_watch_detail_1795169048977.jpg'),
      ast_portrait_photo: path.join(imgDir, 'media_portrait_filmmaker_1795169045724.jpg'),
      ast_aurum_1: path.join(imgDir, 'media_watch_detail_1795169048977.jpg'),
    };

    let repairedAny = false;
    for (const row of seededAssets) {
      const ext = path.extname(row.filename) || (row.kind === 'video' ? '.mp4' : '.jpg');
      const stem = path.basename(row.filename, ext);
      let nextStorageKey = row.storage_key;
      let nextThumbKey = row.thumbnail_key;

      if (!fs.existsSync(resolveStoragePath(nextStorageKey))) {
        const diskMatch = findMatchingDiskFile('originals', stem, ext);
        if (diskMatch) {
          nextStorageKey = diskMatch;
        } else {
          const srcPath = sourceByAssetId[row.id];
          if (srcPath && fs.existsSync(srcPath)) {
            if (row.kind === 'video') {
              const vidKey = createStorageKey('originals', row.filename, '.mp4');
              const created = await createSeedVideoClipFromStill(
                srcPath,
                resolveStoragePath(vidKey),
                5,
                row.id === 'ast_roaster_vid' ? 'zoom-in' : 'left-to-right'
              );
              if (created) nextStorageKey = vidKey;
            } else {
              const stored = copyFileToStorage('originals', srcPath, row.filename);
              nextStorageKey = stored.storageKey;
            }
          }
        }
      }

      if (!nextThumbKey || !fs.existsSync(resolveStoragePath(nextThumbKey))) {
        const diskThumb = findMatchingDiskFile('thumbnails', stem, '.jpg');
        if (diskThumb) {
          nextThumbKey = diskThumb;
        } else if (fs.existsSync(resolveStoragePath(nextStorageKey))) {
          if (row.kind === 'video') {
            const meta = await probeVideoOrAudio(resolveStoragePath(nextStorageKey));
            const { thumbnailKey } = await generateVideoThumbnailAndKeyframes(
              resolveStoragePath(nextStorageKey),
              row.filename,
              meta.durationSec
            );
            nextThumbKey = thumbnailKey;
          } else {
            nextThumbKey = await generatePhotoThumbnail(
              resolveStoragePath(nextStorageKey),
              row.filename
            );
          }
        }
      }

      if (nextStorageKey !== row.storage_key || nextThumbKey !== row.thumbnail_key) {
        db.prepare('UPDATE assets SET storage_key = ?, thumbnail_key = ? WHERE id = ?').run(
          nextStorageKey,
          nextThumbKey,
          row.id
        );
        repairedAny = true;
      }
    }

    if (repairedAny) {
      const coastalRow = db
        .prepare('SELECT thumbnail_key FROM assets WHERE id = ?')
        .get('ast_coastal_vid') as { thumbnail_key: string | null } | undefined;
      if (coastalRow?.thumbnail_key) {
        db.prepare('UPDATE projects SET thumbnail_url = ? WHERE id = ?').run(
          `/api/media/file/${encodeURIComponent(coastalRow.thumbnail_key)}`,
          'proj_pacific_craft'
        );
      }
      const aurumRow = db
        .prepare('SELECT thumbnail_key FROM assets WHERE id = ?')
        .get('ast_aurum_1') as { thumbnail_key: string | null } | undefined;
      if (aurumRow?.thumbnail_key) {
        db.prepare('UPDATE projects SET thumbnail_url = ? WHERE id = ?').run(
          `/api/media/file/${encodeURIComponent(aurumRow.thumbnail_key)}`,
          'proj_monolith_stills'
        );
      }
    }

    // Non-destructively backfill narrative markers on existing seeded demo project if missing
    const demoProj = db
      .prepare('SELECT edit_plan_json FROM projects WHERE id = ?')
      .get('proj_pacific_craft') as { edit_plan_json: string | null } | undefined;
    if (demoProj?.edit_plan_json) {
      try {
        const parsed = JSON.parse(demoProj.edit_plan_json) as EditPlan;
        if (!Array.isArray(parsed.markers)) {
          const totalDur = (parsed.segments || []).reduce(
            (m, s) => Math.max(m, s.timelineOutSec || 0),
            18
          );
          parsed.markers = [
            {
              id: 'mk_hook',
              timeSec: 0.8,
              name: 'Opening Hook',
              color: 'amber',
              note: 'Establish Pacific coast horizon and forward motion.',
            },
            {
              id: 'mk_craft',
              timeSec: 4.9,
              name: 'Roaster Reveal',
              color: 'emerald',
              note: 'Cut on pour action; check 9:16 subject headroom.',
            },
            {
              id: 'mk_payoff',
              timeSec: Number(Math.min(Math.max(0, totalDur - 0.5), 13.0).toFixed(2)),
              name: 'Field Payoff',
              color: 'sky',
              note: 'Transition into still portrait and alpine finale.',
            },
          ];
          db.prepare('UPDATE projects SET edit_plan_json = ? WHERE id = ?').run(
            JSON.stringify(parsed),
            'proj_pacific_craft'
          );
        }
      } catch {
        // ignore malformed json
      }
    }
    return;
  }

  const userId = 'usr_studio_demo';
  const now = new Date().toISOString();
  const hash = bcrypt.hashSync(DEMO_PASSWORD, 8);
  db.prepare(
    'INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(userId, DEMO_EMAIL, 'Elena Vance', hash, 'Senior Editor', now);

  const imgDir = path.resolve(process.cwd(), 'src/assets/images');
  const heroPath = path.join(imgDir, 'hero_studio_frame_1795169067824.jpg');
  const alpinePath = path.join(imgDir, 'media_alpine_ridge_1795169049175.jpg');
  const roasterPath = path.join(imgDir, 'media_craft_roaster_1795169056288.jpg');
  const watchPath = path.join(imgDir, 'media_watch_detail_1795169048977.jpg');
  const portraitPath = path.join(imgDir, 'media_portrait_filmmaker_1795169045724.jpg');

  const mixedProjectId = 'proj_pacific_craft';
  const mixedBrief = defaultBrief({
    purpose: 'brand_story',
    aspectRatio: '16:9',
    targetDurationSec: 18,
    pace: 'balanced',
    visualDirection: 'cinematic',
    contentPriority: 'people',
    brandTitleText: 'Pacific Craft',
    endCardText: 'Pacific Craft · Roastery & Field Film',
    writtenInstruction:
      'Open with the coastal drive, build into the artisan roaster at work, and keep the watch and cinematographer portrait clean and unhurried.',
    mustKeepNotes: 'Keep the roaster pour moment and the alpine establishing frame.',
  });
  const batchLook = defaultBatchLook();

  db.prepare(
    `INSERT INTO projects (id, user_id, name, type, status, brief_json, thumbnail_url, edit_plan_json, photo_edits_json, batch_look_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    mixedProjectId,
    userId,
    'Pacific Craft — Field Film & Stills',
    'mixed',
    'editing',
    JSON.stringify(mixedBrief),
    null,
    null,
    '{}',
    JSON.stringify(batchLook),
    now,
    now
  );

  const createdAssets: MediaAsset[] = [];

  // 1. Real MP4 video clip #1 synthesized via FFmpeg from hero coastal frame
  if (fs.existsSync(heroPath)) {
    const vidKey = createStorageKey('originals', 'coastal_highway_A001.mp4', '.mp4');
    const vidAbs = resolveStoragePath(vidKey);
    const created = await createSeedVideoClipFromStill(heroPath, vidAbs, 5, 'left-to-right');
    if (created) {
      const stat = fs.statSync(vidAbs);
      const meta = await probeVideoOrAudio(vidAbs);
      const { thumbnailKey } = await generateVideoThumbnailAndKeyframes(
        vidAbs,
        'coastal_highway_A001.mp4',
        meta.durationSec
      );
      const analysis = {
        label: 'Vehicle rounding coastal highway bend',
        confidence: 0.91,
        centerX: 0.66,
        centerY: 0.62,
        boxWidth: 0.34,
        boxHeight: 0.38,
        shotScale: 'establishing' as const,
        cameraMovement: 'pan' as const,
        qualityNotes: 'Clean golden-hour lighting; smooth horizontal motion suitable for opening.',
      };
      const id = 'ast_coastal_vid';
      db.prepare(
        `INSERT INTO assets (id, project_id, kind, role, filename, mime_type, file_size_bytes, storage_key, thumbnail_key, proxy_key, metadata_json, order_index, directive, bin, analysis_json, warnings_json, created_at)
         VALUES (?, ?, 'video', 'original', ?, 'video/mp4', ?, ?, ?, NULL, ?, 0, 'must_keep', 'A-Roll Video', ?, '[]', ?)`
      ).run(
        id,
        mixedProjectId,
        'coastal_highway_A001.mp4',
        stat.size,
        vidKey,
        thumbnailKey,
        JSON.stringify(meta),
        JSON.stringify(analysis),
        now
      );
      createdAssets.push(
        mapAssetRow(db.prepare('SELECT * FROM assets WHERE id = ?').get(id) as Record<string, unknown>)
      );
    }
  }

  // 2. Real MP4 video clip #2 synthesized via FFmpeg from coffee roaster scene
  if (fs.existsSync(roasterPath)) {
    const vidKey = createStorageKey('originals', 'roaster_pour_B004.mp4', '.mp4');
    const vidAbs = resolveStoragePath(vidKey);
    const created = await createSeedVideoClipFromStill(roasterPath, vidAbs, 5, 'zoom-in');
    if (created) {
      const stat = fs.statSync(vidAbs);
      const meta = await probeVideoOrAudio(vidAbs);
      const { thumbnailKey } = await generateVideoThumbnailAndKeyframes(
        vidAbs,
        'roaster_pour_B004.mp4',
        meta.durationSec
      );
      const analysis = {
        label: 'Artisan coffee roaster pouring roasted beans',
        confidence: 0.94,
        centerX: 0.64,
        centerY: 0.42,
        boxWidth: 0.38,
        boxHeight: 0.62,
        shotScale: 'medium' as const,
        cameraMovement: 'tracking' as const,
        qualityNotes: 'Strong directional window light; subject offset right—auto-reframe shifts focal point to x=0.64 for vertical formats.',
      };
      const id = 'ast_roaster_vid';
      db.prepare(
        `INSERT INTO assets (id, project_id, kind, role, filename, mime_type, file_size_bytes, storage_key, thumbnail_key, proxy_key, metadata_json, order_index, directive, bin, analysis_json, warnings_json, created_at)
         VALUES (?, ?, 'video', 'original', ?, 'video/mp4', ?, ?, ?, NULL, ?, 1, 'must_keep', 'A-Roll Video', ?, '[]', ?)`
      ).run(
        id,
        mixedProjectId,
        'roaster_pour_B004.mp4',
        stat.size,
        vidKey,
        thumbnailKey,
        JSON.stringify(meta),
        JSON.stringify(analysis),
        now
      );
      createdAssets.push(
        mapAssetRow(db.prepare('SELECT * FROM assets WHERE id = ?').get(id) as Record<string, unknown>)
      );
    }
  }

  // 3. Real High-Res Studio Photos (immutable originals in storage/originals/)
  const seedPhotos = [
    {
      id: 'ast_alpine_photo',
      src: alpinePath,
      filename: 'alpine_ridge_dawn_01.jpg',
      bin: 'Editorial Stills',
      directive: 'must_keep' as const,
      hint: 'Hikers along sunlit granite ridge',
      centerX: 0.38,
      centerY: 0.56,
      shotScale: 'wide' as const,
      includeInTimeline: true,
    },
    {
      id: 'ast_roaster_photo',
      src: roasterPath,
      filename: 'roaster_studio_still_02.jpg',
      bin: 'Editorial Stills',
      directive: 'normal' as const,
      hint: 'Roaster hands and steel cooling tray',
      centerX: 0.62,
      centerY: 0.46,
      shotScale: 'medium' as const,
      includeInTimeline: false,
    },
    {
      id: 'ast_watch_photo',
      src: watchPath,
      filename: 'chronograph_macro_03.jpg',
      bin: 'Product Stills',
      directive: 'normal' as const,
      hint: 'Brushed titanium mechanical chronograph',
      centerX: 0.52,
      centerY: 0.48,
      shotScale: 'detail' as const,
      includeInTimeline: true,
    },
    {
      id: 'ast_portrait_photo',
      src: portraitPath,
      filename: 'cinematographer_portrait_04.jpg',
      bin: 'Portraits',
      directive: 'normal' as const,
      hint: 'Cinematographer portrait by studio window',
      centerX: 0.53,
      centerY: 0.36,
      shotScale: 'close_up' as const,
      includeInTimeline: true,
    },
  ];

  const photoEdits: Record<string, PhotoEditRecipe> = {};
  let idx = 2;
  for (const sp of seedPhotos) {
    if (!fs.existsSync(sp.src)) continue;
    const stored = copyFileToStorage('originals', sp.src, sp.filename);
    const meta = await inspectPhotoMetadata(stored.absolutePath);
    const thumbKey = await generatePhotoThumbnail(stored.absolutePath, sp.filename);
    const saliency = await computeLocalSaliencySubject(stored.absolutePath, sp.hint);
    const analysis = {
      ...saliency,
      label: sp.hint,
      centerX: sp.centerX,
      centerY: sp.centerY,
      shotScale: sp.shotScale,
      confidence: 0.89,
    };
    db.prepare(
      `INSERT INTO assets (id, project_id, kind, role, filename, mime_type, file_size_bytes, storage_key, thumbnail_key, proxy_key, metadata_json, order_index, directive, bin, analysis_json, warnings_json, created_at)
       VALUES (?, ?, 'photo', 'original', ?, 'image/jpeg', ?, ?, ?, NULL, ?, ?, ?, ?, ?, '[]', ?)`
    ).run(
      sp.id,
      mixedProjectId,
      sp.filename,
      stored.sizeBytes,
      stored.storageKey,
      thumbKey,
      JSON.stringify(meta),
      idx++,
      sp.directive,
      sp.bin,
      JSON.stringify(analysis),
      now
    );
    const mapped = mapAssetRow(
      db.prepare('SELECT * FROM assets WHERE id = ?').get(sp.id) as Record<string, unknown>
    );
    createdAssets.push(mapped);

    const recipe = createDefaultPhotoRecipe(sp.id, 'cinematic_contrast', sp.includeInTimeline);
    recipe.analysisNotes = `${sp.hint} (${meta.width}×${meta.height}). Balanced tonal roll-off preserving natural skin/material fidelity.`;
    recipe.detail.portraitCleanup = sp.id === 'ast_portrait_photo';
    if (sp.id === 'ast_watch_photo') {
      recipe.look = 'commercial_product';
      recipe.tone.contrast = 10;
    }
    photoEdits[sp.id] = recipe;
  }

  // Build structured editable timeline plan for the seeded mixed project
  const segments: VideoSegment[] = [];
  const coastal = createdAssets.find((a) => a.id === 'ast_coastal_vid');
  const roasterVid = createdAssets.find((a) => a.id === 'ast_roaster_vid');
  const alpinePhoto = createdAssets.find((a) => a.id === 'ast_alpine_photo');
  const watchPhoto = createdAssets.find((a) => a.id === 'ast_watch_photo');
  const portraitPhoto = createdAssets.find((a) => a.id === 'ast_portrait_photo');

  if (coastal) {
    segments.push({
      id: 'seg_01_opening',
      assetId: coastal.id,
      mediaKind: 'video',
      label: 'Coastal Highway Approach',
      sourceInSec: 0,
      sourceOutSec: Math.min(4.8, coastal.metadata.durationSec),
      timelineInSec: 0,
      timelineOutSec: 4.8,
      editorialRole: 'opening',
      selectionReason: 'Must-keep atmospheric wide opening establishing Pacific Northwest tone.',
      confidence: 0.91,
      warnings: [],
      reframe: buildReframeFromDetection(
        coastal.analysis,
        coastal.metadata.width,
        coastal.metadata.height,
        '16:9',
        'local-saliency',
        false
      ),
      speed: 1,
      transitionIn: 'fade_black',
      transitionDurationSec: 0.5,
      color: { ...defaultColorGrade('cinematic_contrast'), contrast: 8, temperature: 5 },
      audioMode: 'normal',
      audioGainDb: 0,
      locked: false,
    });
  }

  if (roasterVid) {
    segments.push({
      id: 'seg_02_roaster',
      assetId: roasterVid.id,
      mediaKind: 'video',
      label: 'Artisan Roaster Pour',
      sourceInSec: 0.2,
      sourceOutSec: Math.min(4.8, roasterVid.metadata.durationSec),
      timelineInSec: 4.8,
      timelineOutSec: 9.4,
      editorialRole: 'progression',
      selectionReason: 'Core human craft moment prioritized by brief; subject right-weighted for intelligent reframing.',
      confidence: 0.94,
      warnings: [],
      reframe: buildReframeFromDetection(
        roasterVid.analysis,
        roasterVid.metadata.width,
        roasterVid.metadata.height,
        '16:9',
        'local-saliency',
        false
      ),
      speed: 1,
      transitionIn: 'cut',
      transitionDurationSec: 0,
      color: { ...defaultColorGrade('cinematic_contrast'), exposure: 0.08, temperature: 6 },
      audioMode: 'normal',
      audioGainDb: 0,
      locked: false,
    });
  }

  if (watchPhoto) {
    segments.push({
      id: 'seg_03_detail',
      assetId: watchPhoto.id,
      mediaKind: 'photo',
      label: 'Chronograph Detail Still',
      sourceInSec: 0,
      sourceOutSec: 3.4,
      timelineInSec: 9.4,
      timelineOutSec: 12.8,
      editorialRole: 'detail',
      selectionReason: 'High-resolution still introduces tactile material contrast with subtle 5% push-in.',
      confidence: 0.89,
      warnings: [],
      reframe: buildReframeFromDetection(
        watchPhoto.analysis,
        watchPhoto.metadata.width,
        watchPhoto.metadata.height,
        '16:9',
        'local-saliency',
        true
      ),
      speed: 1,
      transitionIn: 'cut',
      transitionDurationSec: 0,
      color: { ...defaultColorGrade('commercial_product'), contrast: 10 },
      audioMode: 'muted',
      audioGainDb: 0,
      locked: false,
    });
  }

  if (portraitPhoto) {
    segments.push({
      id: 'seg_04_portrait',
      assetId: portraitPhoto.id,
      mediaKind: 'photo',
      label: 'Cinematographer Portrait',
      sourceInSec: 0,
      sourceOutSec: 3.2,
      timelineInSec: 12.8,
      timelineOutSec: 16.0,
      editorialRole: 'payoff',
      selectionReason: 'Portrait still anchors human presence with protected headroom and natural skin tone.',
      confidence: 0.88,
      warnings: ['Portrait 3:4 source framed into 16:9 timeline — review upper headroom in Reframe inspector.'],
      reframe: buildReframeFromDetection(
        portraitPhoto.analysis,
        portraitPhoto.metadata.width,
        portraitPhoto.metadata.height,
        '16:9',
        'local-saliency',
        true
      ),
      speed: 1,
      transitionIn: 'dissolve',
      transitionDurationSec: 0.4,
      color: { ...defaultColorGrade('editorial_neutral'), exposure: 0.05 },
      audioMode: 'muted',
      audioGainDb: 0,
      locked: false,
    });
  }

  if (alpinePhoto) {
    segments.push({
      id: 'seg_05_ending',
      assetId: alpinePhoto.id,
      mediaKind: 'photo',
      label: 'Alpine Ridge Dawn',
      sourceInSec: 0,
      sourceOutSec: 3.6,
      timelineInSec: 16.0,
      timelineOutSec: 19.6,
      editorialRole: 'ending',
      selectionReason: 'Must-keep wide horizon provides an unhurried visual resolution for end card.',
      confidence: 0.9,
      warnings: [],
      reframe: buildReframeFromDetection(
        alpinePhoto.analysis,
        alpinePhoto.metadata.width,
        alpinePhoto.metadata.height,
        '16:9',
        'local-saliency',
        true
      ),
      speed: 1,
      transitionIn: 'dissolve',
      transitionDurationSec: 0.5,
      color: { ...defaultColorGrade('cinematic_contrast'), contrast: 6, temperature: 4 },
      audioMode: 'muted',
      audioGainDb: 0,
      locked: false,
    });
  }

  const normalizedSegments = rippleRecalculateTimeline(segments);
  const totalDur = normalizedSegments.reduce((m, s) => Math.max(m, s.timelineOutSec), 0);

  const editPlan: EditPlan = {
    version: 1,
    aspectRatio: '16:9',
    fps: 24,
    summary: {
      intendedViewer: 'Brand storytelling audience across web and editorial channels',
      storyEmphasis: 'Human craft, tactile precision, and Pacific Northwest atmosphere',
      visualMoodAndPace: 'Cinematic contrast, balanced 3–5s holds, restrained straight cuts with two purposeful dissolves',
      mediaUsageStrategy:
        'Combines both A-roll video clips with 3 selected editorial stills (preserving all 4 individual photo recipes independently).',
      estimatedDurationSec: Number(totalDur.toFixed(1)),
      photoEditScope: '4 individual non-destructive photo recipes + shared Cinematic Contrast batch profile',
      assumptions: [
        'No licensed background music track attached yet — Audio Studio lets you upload audio or generate a score via Lyria.',
      ],
      sourceLimitations: [
        'Portrait still (3:4) requires vertical framing check when sequenced inside a 16:9 landscape master.',
      ],
      prioritizedChoices: [
        'Opened with must-keep coastal highway movement before cutting into roaster action.',
        'Applied subject-aware intelligent reframing so vertical 9:16/1:1 switches automatically track the roaster and portrait face.',
        'Kept roaster_studio_still_02.jpg in the Photo Collection only to avoid repeating the video angle.',
      ],
      engineUsed: 'Local Studio Seed Plan (run Gemini AI Plan or Local Analyzer anytime to regenerate)',
      generatedAt: now,
    },
    segments: normalizedSegments,
    captions: [
      {
        id: 'cap_1',
        startSec: 0.8,
        endSec: 4.2,
        text: 'Dawn along the Pacific coast — where every batch begins.',
        speaker: 'Narrator',
      },
      {
        id: 'cap_2',
        startSec: 5.1,
        endSec: 9.0,
        text: 'Small-lot roasting guided by sight, sound, and temperature.',
        speaker: 'Narrator',
      },
      {
        id: 'cap_3',
        startSec: 13.0,
        endSec: 18.4,
        text: 'Built for unhurried mornings in the field.',
        speaker: 'Narrator',
      },
    ],
    titles: [
      {
        id: 'ttl_open',
        kind: 'opening_title',
        text: 'PACIFIC CRAFT',
        subtext: 'Field Study & Roastery Dispatch',
        startSec: 0.4,
        endSec: 3.6,
        animation: 'fade',
        enabled: true,
      },
      {
        id: 'ttl_end',
        kind: 'end_card',
        text: 'PACIFIC CRAFT',
        subtext: 'Crafted in the Pacific Northwest',
        startSec: Math.max(0, totalDur - 2.6),
        endSec: totalDur,
        animation: 'fade',
        enabled: true,
      },
    ],
    markers: [
      {
        id: 'mk_hook',
        timeSec: 0.8,
        name: 'Opening Hook',
        color: 'amber',
        note: 'Establish Pacific coast horizon and forward motion.',
      },
      {
        id: 'mk_craft',
        timeSec: 4.9,
        name: 'Roaster Reveal',
        color: 'emerald',
        note: 'Cut on pour action; check 9:16 subject headroom.',
      },
      {
        id: 'mk_payoff',
        timeSec: Math.min(totalDur - 0.5, 13.0),
        name: 'Field Payoff',
        color: 'sky',
        note: 'Transition into still portrait and alpine finale.',
      },
    ],
    audioMix: {
      musicAssetId: null,
      musicGainDb: -14,
      dialogueGainDb: 0,
      autoDucking: true,
      duckAmountDb: -10,
      smoothLevels: true,
      noiseReduction: false,
      fadeInSec: 0.4,
      fadeOutSec: 1.0,
      masterMuted: false,
    },
    showLogoWatermark: false,
    logoPosition: 'top_right',
  };

  const thumbUrl = coastal?.thumbnailUrl || alpinePhoto?.thumbnailUrl || null;
  db.prepare(
    'UPDATE projects SET thumbnail_url = ?, edit_plan_json = ?, photo_edits_json = ?, updated_at = ? WHERE id = ?'
  ).run(thumbUrl, JSON.stringify(editPlan), JSON.stringify(photoEdits), now, mixedProjectId);

  saveProjectRevision(
    mixedProjectId,
    'Initial Studio Cut',
    'Seeded mixed-media project with intelligent reframing and individual photo recipes.',
    editPlan,
    photoEdits,
    batchLook
  );

  // Seed a second pure Photo Collection project so Dashboard filtering/sorting shines
  const photoProjId = 'proj_monolith_stills';
  const photoBrief = defaultBrief({
    purpose: 'product_promotion',
    aspectRatio: '4:5',
    visualDirection: 'clean_commercial',
    contentPriority: 'product',
    brandTitleText: 'Aurum Chronograph',
    writtenInstruction: 'Crisp commercial grading preserving matte titanium texture and dial legibility.',
  });
  const photoProjLook: BatchLookProfile = {
    look: 'commercial_product',
    intensity: 70,
    referenceAssetId: null,
    consistencyStrength: 80,
    preserveDistinctLighting: true,
    updatedAt: now,
  };
  db.prepare(
    `INSERT INTO projects (id, user_id, name, type, status, brief_json, thumbnail_url, edit_plan_json, photo_edits_json, batch_look_json, created_at, updated_at)
     VALUES (?, ?, ?, 'photo', 'completed', ?, NULL, NULL, '{}', ?, ?, ?)`
  ).run(
    photoProjId,
    userId,
    'Aurum Watch — Commercial Photo Set',
    JSON.stringify(photoBrief),
    JSON.stringify(photoProjLook),
    now,
    now
  );

  if (fs.existsSync(watchPath)) {
    const stored = copyFileToStorage('originals', watchPath, 'aurum_titanium_hero.jpg');
    const meta = await inspectPhotoMetadata(stored.absolutePath);
    const thumbKey = await generatePhotoThumbnail(stored.absolutePath, 'aurum_titanium_hero.jpg');
    const assetId = 'ast_aurum_1';
    db.prepare(
      `INSERT INTO assets (id, project_id, kind, role, filename, mime_type, file_size_bytes, storage_key, thumbnail_key, proxy_key, metadata_json, order_index, directive, bin, analysis_json, warnings_json, created_at)
       VALUES (?, ?, 'photo', 'original', 'aurum_titanium_hero.jpg', 'image/jpeg', ?, ?, ?, NULL, ?, 0, 'must_keep', 'Hero Stills', NULL, '[]', ?)`
    ).run(assetId, photoProjId, stored.sizeBytes, stored.storageKey, thumbKey, JSON.stringify(meta), now);
    const recipe = createDefaultPhotoRecipe(assetId, 'commercial_product', false);
    const thumb = `/api/media/file/${encodeURIComponent(thumbKey)}`;
    db.prepare('UPDATE projects SET thumbnail_url = ?, photo_edits_json = ? WHERE id = ?').run(
      thumb,
      JSON.stringify({ [assetId]: recipe }),
      photoProjId
    );
  }
}
