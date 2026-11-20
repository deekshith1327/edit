import 'dotenv/config';
import express, { type Response } from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { createServer as createViteServer } from 'vite';

import {
  db,
  defaultBatchLook,
  defaultBrief,
  getUserStorageUsage,
  mapAssetRow,
  mapChatRow,
  mapExportRow,
  mapProjectRow,
  mapRevisionRow,
  newId,
  saveProjectRevision,
  seedDemoWorkspaceIfNeeded,
} from './server/db';
import {
  assertProjectOwnership,
  authenticateUser,
  clearSessionCookie,
  createSession,
  getDemoUser,
  registerUser,
  requireAuth,
  resolveSessionUser,
  setSessionCookie,
  type AuthedRequest,
} from './server/services/authService';
import {
  computeStorageBreakdown,
  deleteStorageFile,
  ensureStorageDirs,
  resolveStoragePath,
  USER_STORAGE_QUOTA_BYTES,
  validateUploadedFile,
  writeBufferToStorage,
} from './server/services/storageService';
import {
  computeLocalSaliencySubject,
  generatePhotoThumbnail,
  generateVideoThumbnailAndKeyframes,
  inspectPhotoMetadata,
  probeVideoOrAudio,
} from './server/services/mediaPrepService';
import {
  analyzeAssetForReframing,
  runAnalysisAndEditPlanJob,
} from './server/services/editPlanService';
import {
  generateMusicWithLyria,
  generateOrEditImageWithNanoBanana,
  generateVideoWithOmniFlash,
  getProviderStatus,
  getQuickSuggestionWithFlashLite,
  ProviderConfigError,
  runStudioAssistantChat,
  transcribeAudioWithGemini,
} from './server/services/geminiService';
import {
  cancelJob,
  completeJob,
  createJob,
  failJob,
  getJobById,
  getProjectJobs,
  isJobCancelled,
  registerJobCanceller,
  updateJobProgress,
} from './server/services/jobManager';
import {
  exportBatchPhotosZip,
  exportSinglePhoto,
  type PhotoExportOptions,
} from './server/services/photoProcessorService';
import {
  renderEditPlanToMp4,
  type VideoRenderOptions,
} from './server/services/videoRenderService';
import { buildReframeFromDetection } from './src/shared/reframing';
import { createDefaultPhotoRecipe } from './src/shared/photoMath';
import type {
  AspectRatio,
  EditPlan,
  MediaAsset,
  PhotoEditRecipe,
} from './src/shared/types';

const PORT = Number(process.env.PORT || 3000);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 250 * 1024 * 1024 },
});

function handleApiError(res: Response, err: unknown): void {
  if (err instanceof ProviderConfigError) {
    res.status(err.statusCode).json({
      error: err.message,
      model: err.model,
      requiresPaidKey: err.requiresPaidKey,
      providerError: true,
    });
    return;
  }
  const message = err instanceof Error ? err.message : 'Unexpected server error';
  res.status(500).json({ error: message });
}

async function startServer() {
  ensureStorageDirs();
  await seedDemoWorkspaceIfNeeded();

  const app = express();
  app.set('trust proxy', 1);
  app.use(cookieParser());
  app.use(express.json({ limit: '50mb' }));

  // ==========================================
  // 1. HEALTH & PROVIDER STATUS
  // ==========================================
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, status: 'ready' });
  });

  app.get('/api/status', async (_req, res) => {
    try {
      const status = await getProviderStatus();
      res.json(status);
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // ==========================================
  // 2. AUTHENTICATION & ACCOUNT
  // ==========================================
  app.get('/api/auth/me', (req, res) => {
    const user = resolveSessionUser(req);
    if (!user) {
      res.json({ user: null });
      return;
    }
    res.json({
      user,
      storageUsedBytes: getUserStorageUsage(user.id),
      storageQuotaBytes: USER_STORAGE_QUOTA_BYTES,
      storageBreakdown: computeStorageBreakdown(),
    });
  });

  app.post('/api/auth/signup', (req, res) => {
    const { email, name, password } = req.body || {};
    const result = registerUser(String(email || ''), String(name || ''), String(password || ''));
    if (result.error || !result.user) {
      res.status(400).json({ error: result.error || 'Registration failed.' });
      return;
    }
    const token = createSession(result.user.id);
    setSessionCookie(req, res, token);
    res.status(201).json({ user: result.user, token });
  });

  app.post('/api/auth/signin', (req, res) => {
    const { email, password } = req.body || {};
    const result = authenticateUser(String(email || ''), String(password || ''));
    if (result.error || !result.user) {
      res.status(401).json({ error: result.error || 'Invalid credentials.' });
      return;
    }
    const token = createSession(result.user.id);
    setSessionCookie(req, res, token);
    res.json({ user: result.user, token });
  });

  app.post('/api/auth/demo', (req, res) => {
    const demo = getDemoUser();
    if (!demo) {
      res.status(500).json({ error: 'Demo studio account not initialized.' });
      return;
    }
    const token = createSession(demo.id);
    setSessionCookie(req, res, token);
    res.json({ user: demo, token });
  });

  app.post('/api/auth/signout', (req, res) => {
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  app.patch('/api/account', requireAuth, (req: AuthedRequest, res) => {
    const { name, role } = req.body || {};
    const cleanName = String(name || '').trim();
    if (cleanName.length < 2) {
      res.status(400).json({ error: 'Name must be at least 2 characters.' });
      return;
    }
    db.prepare('UPDATE users SET name = ?, role = ? WHERE id = ?').run(
      cleanName,
      String(role || req.user!.role).trim() || 'Editor',
      req.user!.id
    );
    res.json({ user: { ...req.user!, name: cleanName, role: String(role || req.user!.role) } });
  });

  // ==========================================
  // 3. PROTECTED MEDIA FILE SERVING
  // ==========================================
  app.get('/api/media/file/:key', requireAuth, (req: AuthedRequest, res) => {
    try {
      const storageKey = decodeURIComponent(String(req.params.key));
      // Verify file belongs to a project owned by current user
      const asset = db
        .prepare(
          `SELECT a.id FROM assets a
           INNER JOIN projects p ON p.id = a.project_id
           WHERE (a.storage_key = ? OR a.thumbnail_key = ? OR a.proxy_key = ?) AND p.user_id = ?`
        )
        .get(storageKey, storageKey, storageKey, req.user!.id);

      const exportRow = !asset
        ? db
            .prepare(
              `SELECT e.id FROM exports e
               INNER JOIN projects p ON p.id = e.project_id
               WHERE e.storage_key = ? AND p.user_id = ?`
            )
            .get(storageKey, req.user!.id)
        : null;

      // Also allow generated photo-edit overlay files inside generated/
      const isGenerated = storageKey.startsWith('generated/');
      if (!asset && !exportRow && !isGenerated) {
        res.status(403).json({ error: 'You do not have permission to access this media file.' });
        return;
      }

      const absPath = resolveStoragePath(storageKey);
      if (!fs.existsSync(absPath)) {
        res.status(404).json({ error: 'Media file not found on disk.' });
        return;
      }
      res.sendFile(absPath);
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // ==========================================
  // 4. PROJECTS CRUD & REVISIONS
  // ==========================================
  app.get('/api/projects', requireAuth, (req: AuthedRequest, res) => {
    const rows = db
      .prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC')
      .all(req.user!.id) as Array<Record<string, unknown>>;
    res.json({ projects: rows.map(mapProjectRow) });
  });

  app.post('/api/projects', requireAuth, (req: AuthedRequest, res) => {
    const { name, type, brief } = req.body || {};
    const cleanName = String(name || '').trim();
    if (!cleanName) {
      res.status(400).json({ error: 'Project name is required.' });
      return;
    }
    const projType = ['video', 'photo', 'mixed'].includes(type) ? type : 'mixed';
    const id = newId('proj');
    const now = new Date().toISOString();
    const mergedBrief = defaultBrief({
      ...(brief || {}),
      brandTitleText: brief?.brandTitleText || cleanName,
    });
    const batchLook = defaultBatchLook();

    db.prepare(
      `INSERT INTO projects (id, user_id, name, type, status, brief_json, thumbnail_url, edit_plan_json, photo_edits_json, batch_look_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'draft', ?, NULL, NULL, '{}', ?, ?, ?)`
    ).run(id, req.user!.id, cleanName, projType, JSON.stringify(mergedBrief), JSON.stringify(batchLook), now, now);

    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Record<string, unknown>;
    res.status(201).json({ project: mapProjectRow(row) });
  });

  app.get('/api/projects/:id', requireAuth, (req: AuthedRequest, res) => {
    const row = assertProjectOwnership(String(req.params.id), req.user!.id);
    if (!row) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    const project = mapProjectRow(row);
    const assetRows = db
      .prepare('SELECT * FROM assets WHERE project_id = ? ORDER BY order_index ASC, created_at ASC')
      .all(project.id) as Array<Record<string, unknown>>;
    const revRows = db
      .prepare('SELECT * FROM revisions WHERE project_id = ? ORDER BY version_number DESC LIMIT 25')
      .all(project.id) as Array<Record<string, unknown>>;
    const exportRows = db
      .prepare('SELECT * FROM exports WHERE project_id = ? ORDER BY created_at DESC')
      .all(project.id) as Array<Record<string, unknown>>;
    const chatRows = db
      .prepare('SELECT * FROM chat_messages WHERE project_id = ? ORDER BY created_at ASC')
      .all(project.id) as Array<Record<string, unknown>>;

    res.json({
      project,
      assets: assetRows.map(mapAssetRow),
      revisions: revRows.map(mapRevisionRow),
      jobs: getProjectJobs(project.id),
      exports: exportRows.map(mapExportRow),
      chatMessages: chatRows.map(mapChatRow),
    });
  });

  app.patch('/api/projects/:id', requireAuth, (req: AuthedRequest, res) => {
    const row = assertProjectOwnership(String(req.params.id), req.user!.id);
    if (!row) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    const project = mapProjectRow(row);
    const {
      name,
      status,
      brief,
      editPlan,
      photoEdits,
      batchLook,
      createRevisionLabel,
      authorNote,
    } = req.body || {};

    const nextName = name !== undefined ? String(name).trim() || project.name : project.name;
    const nextStatus = status !== undefined ? String(status) : project.status;
    const nextBrief = brief !== undefined ? { ...project.brief, ...brief } : project.brief;
    const nextPlan: EditPlan | null = editPlan !== undefined ? editPlan : project.editPlan;
    const nextPhotoEdits: Record<string, PhotoEditRecipe> =
      photoEdits !== undefined ? photoEdits : project.photoEdits;
    const nextBatchLook = batchLook !== undefined ? { ...project.batchLook, ...batchLook } : project.batchLook;
    const now = new Date().toISOString();

    // Save immutable revision before updating when requested
    let savedRevision = null;
    if (createRevisionLabel && nextPlan) {
      savedRevision = saveProjectRevision(
        project.id,
        String(createRevisionLabel),
        String(authorNote || 'Manual studio checkpoint'),
        nextPlan,
        nextPhotoEdits,
        nextBatchLook
      );
    }

    db.prepare(
      `UPDATE projects SET name = ?, status = ?, brief_json = ?, edit_plan_json = ?, photo_edits_json = ?, batch_look_json = ?, updated_at = ? WHERE id = ?`
    ).run(
      nextName,
      nextStatus,
      JSON.stringify(nextBrief),
      nextPlan ? JSON.stringify(nextPlan) : null,
      JSON.stringify(nextPhotoEdits),
      JSON.stringify(nextBatchLook),
      now,
      project.id
    );

    const updated = mapProjectRow(
      db.prepare('SELECT * FROM projects WHERE id = ?').get(project.id) as Record<string, unknown>
    );
    res.json({ project: updated, revision: savedRevision });
  });

  app.post('/api/projects/:id/duplicate', requireAuth, (req: AuthedRequest, res) => {
    const row = assertProjectOwnership(String(req.params.id), req.user!.id);
    if (!row) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    const orig = mapProjectRow(row);
    const newProjId = newId('proj');
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO projects (id, user_id, name, type, status, brief_json, thumbnail_url, edit_plan_json, photo_edits_json, batch_look_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      newProjId,
      req.user!.id,
      `${orig.name} (Copy)`,
      orig.type,
      orig.status === 'archived' ? 'draft' : orig.status,
      JSON.stringify(orig.brief),
      orig.thumbnailUrl,
      orig.editPlan ? JSON.stringify(orig.editPlan) : null,
      JSON.stringify(orig.photoEdits),
      JSON.stringify(orig.batchLook),
      now,
      now
    );

    // Duplicate asset references (originals stay immutable!)
    const origAssets = db
      .prepare('SELECT * FROM assets WHERE project_id = ?')
      .all(orig.id) as Array<Record<string, unknown>>;
    for (const a of origAssets) {
      db.prepare(
        `INSERT INTO assets (id, project_id, kind, role, filename, mime_type, file_size_bytes, storage_key, thumbnail_key, proxy_key, metadata_json, order_index, directive, bin, analysis_json, warnings_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        newId('ast'),
        newProjId,
        a.kind,
        a.role,
        a.filename,
        a.mime_type,
        a.file_size_bytes,
        a.storage_key,
        a.thumbnail_key,
        a.proxy_key,
        a.metadata_json,
        a.order_index,
        a.directive,
        a.bin,
        a.analysis_json,
        a.warnings_json,
        now
      );
    }

    const duplicated = mapProjectRow(
      db.prepare('SELECT * FROM projects WHERE id = ?').get(newProjId) as Record<string, unknown>
    );
    res.status(201).json({ project: duplicated });
  });

  app.delete('/api/projects/:id', requireAuth, (req: AuthedRequest, res) => {
    const row = assertProjectOwnership(String(req.params.id), req.user!.id);
    if (!row) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    db.prepare('DELETE FROM projects WHERE id = ?').run(String(req.params.id));
    res.json({ ok: true });
  });

  app.post('/api/projects/:id/revisions/:revId/restore', requireAuth, (req: AuthedRequest, res) => {
    const row = assertProjectOwnership(String(req.params.id), req.user!.id);
    if (!row) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    const revRow = db
      .prepare('SELECT * FROM revisions WHERE id = ? AND project_id = ?')
      .get(String(req.params.revId), String(req.params.id)) as Record<string, unknown> | undefined;
    if (!revRow) {
      res.status(404).json({ error: 'Revision not found.' });
      return;
    }
    const rev = mapRevisionRow(revRow);
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE projects SET edit_plan_json = ?, photo_edits_json = ?, batch_look_json = ?, updated_at = ? WHERE id = ?`
    ).run(
      JSON.stringify(rev.editPlan),
      JSON.stringify(rev.photoEdits),
      JSON.stringify(rev.batchLook),
      now,
      rev.projectId
    );
    const restored = saveProjectRevision(
      rev.projectId,
      `Restored v${rev.versionNumber} (${rev.label})`,
      'Non-destructive revision restore',
      rev.editPlan,
      rev.photoEdits,
      rev.batchLook
    );
    const updated = mapProjectRow(
      db.prepare('SELECT * FROM projects WHERE id = ?').get(rev.projectId) as Record<string, unknown>
    );
    res.json({ project: updated, revision: restored });
  });

  // ==========================================
  // 5. MEDIA UPLOAD, VALIDATION & POOL MANAGEMENT
  // ==========================================
  app.post(
    '/api/projects/:id/assets',
    requireAuth,
    upload.array('files', 20),
    async (req: AuthedRequest, res) => {
      try {
        const row = assertProjectOwnership(String(req.params.id), req.user!.id);
        if (!row) {
          res.status(404).json({ error: 'Project not found.' });
          return;
        }
        const project = mapProjectRow(row);
        const files = (req.files as Express.Multer.File[]) || [];
        if (files.length === 0) {
          res.status(400).json({ error: 'No files received in upload.' });
          return;
        }

        let usedBytes = getUserStorageUsage(req.user!.id);
        const maxOrderRow = db
          .prepare('SELECT COALESCE(MAX(order_index), -1) as maxOrd FROM assets WHERE project_id = ?')
          .get(project.id) as { maxOrd: number };
        let nextOrder = (maxOrderRow?.maxOrd ?? -1) + 1;

        const uploaded: MediaAsset[] = [];
        const rejected: Array<{
          filename: string;
          error: string;
          recoveryAction: string;
          isRawFormat?: boolean;
        }> = [];

        const nextPhotoEdits = { ...project.photoEdits };
        let firstThumb = project.thumbnailUrl;

        for (const file of files) {
          const check = validateUploadedFile(file.originalname, file.mimetype, file.size, usedBytes);
          if (!check.valid || !check.kind) {
            rejected.push({
              filename: file.originalname,
              error: check.error || 'Unsupported file.',
              recoveryAction: check.recoveryAction || 'Upload a supported media file.',
              isRawFormat: check.isRawFormat,
            });
            continue;
          }

          const stored = writeBufferToStorage('originals', file.originalname, file.buffer);
          usedBytes += stored.sizeBytes;

          let metadata;
          let thumbnailKey: string | null = null;
          let analysis = null;
          const warnings: string[] = [];

          if (check.kind === 'photo') {
            metadata = await inspectPhotoMetadata(stored.absolutePath);
            thumbnailKey = await generatePhotoThumbnail(stored.absolutePath, file.originalname);
            analysis = await computeLocalSaliencySubject(
              stored.absolutePath,
              file.originalname.replace(/\.[^.]+$/, '')
            );
            if (metadata.width < 800 || metadata.height < 800) {
              warnings.push('Low source resolution; avoid heavy cropping or upscaling.');
            }
          } else if (check.kind === 'video') {
            metadata = await probeVideoOrAudio(stored.absolutePath);
            const gen = await generateVideoThumbnailAndKeyframes(
              stored.absolutePath,
              file.originalname,
              metadata.durationSec
            );
            thumbnailKey = gen.thumbnailKey;
            if (gen.keyframePaths[0]) {
              analysis = await computeLocalSaliencySubject(
                gen.keyframePaths[0],
                file.originalname.replace(/\.[^.]+$/, '')
              );
            }
            if (!metadata.hasAudio) {
              warnings.push('Video clip contains no audio stream.');
            }
          } else {
            metadata = await probeVideoOrAudio(stored.absolutePath);
          }

          const id = newId('ast');
          const now = new Date().toISOString();
          const bin =
            check.kind === 'video'
              ? 'A-Roll Video'
              : check.kind === 'photo'
                ? 'Photos'
                : 'Audio & Music';

          db.prepare(
            `INSERT INTO assets (id, project_id, kind, role, filename, mime_type, file_size_bytes, storage_key, thumbnail_key, proxy_key, metadata_json, order_index, directive, bin, analysis_json, warnings_json, created_at)
             VALUES (?, ?, ?, 'original', ?, ?, ?, ?, ?, NULL, ?, ?, 'normal', ?, ?, ?, ?)`
          ).run(
            id,
            project.id,
            check.kind,
            file.originalname,
            file.mimetype,
            stored.sizeBytes,
            stored.storageKey,
            thumbnailKey,
            JSON.stringify(metadata),
            nextOrder++,
            bin,
            analysis ? JSON.stringify(analysis) : null,
            JSON.stringify(warnings),
            now
          );

          const mapped = mapAssetRow(
            db.prepare('SELECT * FROM assets WHERE id = ?').get(id) as Record<string, unknown>
          );
          uploaded.push(mapped);

          if (!firstThumb && (check.kind === 'photo' || check.kind === 'video')) {
            firstThumb = mapped.thumbnailUrl;
          }
          if (check.kind === 'photo') {
            nextPhotoEdits[id] = createDefaultPhotoRecipe(id, project.batchLook.look, true);
          }
        }

        db.prepare(
          'UPDATE projects SET thumbnail_url = ?, photo_edits_json = ?, updated_at = ? WHERE id = ?'
        ).run(firstThumb, JSON.stringify(nextPhotoEdits), new Date().toISOString(), project.id);

        res.status(uploaded.length > 0 ? 201 : 400).json({
          uploaded,
          rejected,
          photoEdits: nextPhotoEdits,
        });
      } catch (err) {
        handleApiError(res, err);
      }
    }
  );

  app.patch('/api/projects/:id/assets/:assetId', requireAuth, (req: AuthedRequest, res) => {
    const row = assertProjectOwnership(String(req.params.id), req.user!.id);
    if (!row) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    const assetRow = db
      .prepare('SELECT * FROM assets WHERE id = ? AND project_id = ?')
      .get(String(req.params.assetId), String(req.params.id)) as Record<string, unknown> | undefined;
    if (!assetRow) {
      res.status(404).json({ error: 'Asset not found.' });
      return;
    }

    const { directive, bin, orderIndex } = req.body || {};
    const nextDirective = ['normal', 'must_keep', 'do_not_use'].includes(directive)
      ? directive
      : assetRow.directive;
    const nextBin = bin !== undefined ? String(bin) : assetRow.bin;
    const nextOrder = orderIndex !== undefined ? Number(orderIndex) : assetRow.order_index;

    db.prepare('UPDATE assets SET directive = ?, bin = ?, order_index = ? WHERE id = ?').run(
      nextDirective,
      nextBin,
      nextOrder,
      String(req.params.assetId)
    );

    const updated = mapAssetRow(
      db.prepare('SELECT * FROM assets WHERE id = ?').get(String(req.params.assetId)) as Record<
        string,
        unknown
      >
    );
    res.json({ asset: updated });
  });

  app.delete('/api/projects/:id/assets/:assetId', requireAuth, (req: AuthedRequest, res) => {
    const row = assertProjectOwnership(String(req.params.id), req.user!.id);
    if (!row) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    const assetRow = db
      .prepare('SELECT * FROM assets WHERE id = ? AND project_id = ?')
      .get(String(req.params.assetId), String(req.params.id)) as Record<string, unknown> | undefined;
    if (!assetRow) {
      res.status(404).json({ error: 'Asset not found.' });
      return;
    }
    // Check if another duplicated project shares the storage key before deleting file
    const refCount = db
      .prepare('SELECT COUNT(*) as c FROM assets WHERE storage_key = ?')
      .get(String(assetRow.storage_key)) as { c: number };
    db.prepare('DELETE FROM assets WHERE id = ?').run(String(req.params.assetId));
    if (refCount.c <= 1) {
      deleteStorageFile(String(assetRow.storage_key));
      if (assetRow.thumbnail_key) deleteStorageFile(String(assetRow.thumbnail_key));
    }
    res.json({ ok: true });
  });

  // ==========================================
  // 6. AI ANALYSIS, EDIT PLAN & INTELLIGENT REFRAMING
  // ==========================================
  app.post('/api/projects/:id/analyze', requireAuth, (req: AuthedRequest, res) => {
    const row = assertProjectOwnership(String(req.params.id), req.user!.id);
    if (!row) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    const engine: 'gemini' | 'local' = req.body?.engine === 'local' ? 'local' : 'gemini';
    const job = createJob(
      String(req.params.id),
      'analysis_plan',
      1,
      engine === 'gemini'
        ? 'Starting Gemini 4 Neon visual analysis & Gemini 4 Carbon edit planning...'
        : 'Starting Local Studio Analyzer (FFprobe + Sharp saliency)...'
    );

    // Run background job asynchronously
    void runAnalysisAndEditPlanJob({
      jobId: job.id,
      projectId: String(req.params.id),
      engine,
    });

    res.status(202).json({ job });
  });

  /**
   * Intelligent Reframing Endpoint:
   * Analyzes either a single timeline segment or ALL segments in a project for a target
   * aspect ratio (16:9, 9:16, 1:1, 4:5), storing non-destructive ReframeConfig in EditPlan
   * while leaving source originals completely unchanged.
   */
  app.post('/api/projects/:id/reframe', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const row = assertProjectOwnership(String(req.params.id), req.user!.id);
      if (!row) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }
      const project = mapProjectRow(row);
      if (!project.editPlan) {
        res.status(400).json({ error: 'Generate or create a timeline before running Intelligent Reframing.' });
        return;
      }

      const targetAspectRatio: AspectRatio = (req.body?.targetAspectRatio ||
        project.editPlan.aspectRatio) as AspectRatio;
      const segmentId: string | undefined = req.body?.segmentId;
      const engine: 'gemini' | 'local' = req.body?.engine === 'local' ? 'local' : 'gemini';

      const assetRows = db
        .prepare('SELECT * FROM assets WHERE project_id = ?')
        .all(project.id) as Array<Record<string, unknown>>;
      const assetsById = new Map(assetRows.map(mapAssetRow).map((a) => [a.id, a]));

      const updatedSegments = [];
      for (const seg of project.editPlan.segments) {
        if (segmentId && seg.id !== segmentId) {
          updatedSegments.push(seg);
          continue;
        }
        const asset = assetsById.get(seg.assetId);
        if (!asset) {
          updatedSegments.push(seg);
          continue;
        }

        const { detection, analyzedBy } = await analyzeAssetForReframing(asset, engine);
        const nextReframe = buildReframeFromDetection(
          detection,
          asset.metadata.width,
          asset.metadata.height,
          targetAspectRatio,
          analyzedBy,
          seg.mediaKind === 'photo'
        );
        const warnings = seg.warnings.filter((w) => !w.toLowerCase().includes('crop') && !w.toLowerCase().includes('frame'));
        if (nextReframe.warning) warnings.push(nextReframe.warning);

        updatedSegments.push({
          ...seg,
          reframe: nextReframe,
          warnings,
        });
      }

      const nextPlan: EditPlan = {
        ...project.editPlan,
        aspectRatio: segmentId ? project.editPlan.aspectRatio : targetAspectRatio,
        segments: updatedSegments,
      };
      const nextBrief = segmentId
        ? project.brief
        : { ...project.brief, aspectRatio: targetAspectRatio };

      const rev = saveProjectRevision(
        project.id,
        segmentId
          ? `Intelligent Reframe (${targetAspectRatio})`
          : `Auto-Reframe Timeline (${targetAspectRatio})`,
        engine === 'gemini' ? 'Gemini 4 Neon subject tracking' : 'Local pixel saliency tracking',
        nextPlan,
        project.photoEdits,
        project.batchLook
      );

      db.prepare(
        'UPDATE projects SET edit_plan_json = ?, brief_json = ?, updated_at = ? WHERE id = ?'
      ).run(JSON.stringify(nextPlan), JSON.stringify(nextBrief), new Date().toISOString(), project.id);

      const updatedProj = mapProjectRow(
        db.prepare('SELECT * FROM projects WHERE id = ?').get(project.id) as Record<string, unknown>
      );
      const freshAssets = (
        db.prepare('SELECT * FROM assets WHERE project_id = ? ORDER BY order_index ASC').all(project.id) as Array<
          Record<string, unknown>
        >
      ).map(mapAssetRow);

      res.json({ project: updatedProj, assets: freshAssets, revision: rev });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // ==========================================
  // 7. GEMINI STUDIO CO-DIRECTOR CHAT, TRANSCRIPTION & GENERATIVE MEDIA
  // ==========================================
  app.post('/api/projects/:id/chat', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const row = assertProjectOwnership(String(req.params.id), req.user!.id);
      if (!row) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }
      const project = mapProjectRow(row);
      const message = String(req.body?.message || '').trim();
      const mode = (
        ['general', 'complex_interactive', 'deep_thinking', 'fast', 'search_grounding'].includes(
          req.body?.mode
        )
          ? req.body.mode
          : 'general'
      ) as 'general' | 'complex_interactive' | 'deep_thinking' | 'fast' | 'search_grounding';

      if (!message) {
        res.status(400).json({ error: 'Message cannot be empty.' });
        return;
      }

      const historyRows = db
        .prepare('SELECT * FROM chat_messages WHERE project_id = ? ORDER BY created_at ASC')
        .all(project.id) as Array<Record<string, unknown>>;
      const history = historyRows.map(mapChatRow);

      const markersSummary =
        project.editPlan?.markers && project.editPlan.markers.length > 0
          ? `Narrative Markers: ${project.editPlan.markers
              .map((m) => `${m.name} @ ${m.timeSec.toFixed(1)}s (${m.color})`)
              .join(', ')}`
          : '';

      const projectContext = [
        `Project: ${project.name} (${project.type}, status: ${project.status})`,
        `Aspect Ratio: ${project.brief.aspectRatio}, Pace: ${project.brief.pace}, Visual Direction: ${project.brief.visualDirection}`,
        `Media: ${project.videoCount} video(s), ${project.photoCount} photo(s)`,
        `Timeline segments: ${project.editPlan?.segments.length || 0} (${project.estimatedDurationSec}s total)`,
        markersSummary,
        project.brief.writtenInstruction ? `User Brief: ${project.brief.writtenInstruction}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      const result = await runStudioAssistantChat({
        mode,
        projectContext,
        history: history.map((h) => ({ role: h.role, content: h.content })),
        userMessage: message,
      });

      const nowUser = new Date().toISOString();
      const userMsgId = newId('msg');
      db.prepare(
        `INSERT INTO chat_messages (id, project_id, role, content, model, mode, sources_json, created_at)
         VALUES (?, ?, 'user', ?, 'user', ?, NULL, ?)`
      ).run(userMsgId, project.id, message, mode, nowUser);

      const nowBot = new Date(Date.now() + 10).toISOString();
      const botMsgId = newId('msg');
      db.prepare(
        `INSERT INTO chat_messages (id, project_id, role, content, model, mode, sources_json, created_at)
         VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?)`
      ).run(
        botMsgId,
        project.id,
        result.text,
        result.model,
        mode,
        result.sources.length > 0 ? JSON.stringify(result.sources) : null,
        nowBot
      );

      const messages = (
        db.prepare('SELECT * FROM chat_messages WHERE project_id = ? ORDER BY created_at ASC').all(project.id) as Array<
          Record<string, unknown>
        >
      ).map(mapChatRow);

      res.json({ messages });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.post('/api/projects/:id/quick-tip', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const row = assertProjectOwnership(String(req.params.id), req.user!.id);
      if (!row) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }
      const prompt = String(req.body?.prompt || '').trim();
      if (!prompt) {
        res.status(400).json({ error: 'Prompt is required.' });
        return;
      }
      const suggestion = await getQuickSuggestionWithFlashLite(prompt);
      res.json({ suggestion, model: 'gemini-3.1-flash-lite' });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Audio Transcription via gemini-3.5-transcribe
  app.post(
    '/api/projects/:id/transcribe',
    requireAuth,
    upload.single('audio'),
    async (req: AuthedRequest, res) => {
      try {
        const row = assertProjectOwnership(String(req.params.id), req.user!.id);
        if (!row) {
          res.status(404).json({ error: 'Project not found.' });
          return;
        }
        let base64Audio = '';
        let mimeType = 'audio/webm';

        if (req.file) {
          base64Audio = req.file.buffer.toString('base64');
          mimeType = req.file.mimetype || 'audio/webm';
        } else if (req.body?.assetId) {
          const assetRow = db
            .prepare('SELECT * FROM assets WHERE id = ? AND project_id = ?')
            .get(String(req.body.assetId), String(req.params.id)) as Record<string, unknown> | undefined;
          if (!assetRow) {
            res.status(404).json({ error: 'Audio asset not found.' });
            return;
          }
          const abs = resolveStoragePath(String(assetRow.storage_key));
          base64Audio = fs.readFileSync(abs).toString('base64');
          mimeType = String(assetRow.mime_type || 'audio/mpeg');
        } else {
          res.status(400).json({ error: 'Provide an audio recording or select an audio asset.' });
          return;
        }

        const result = await transcribeAudioWithGemini(base64Audio, mimeType);
        res.json(result);
      } catch (err) {
        handleApiError(res, err);
      }
    }
  );

  // Create or Edit Image with Nano Banana 2.1 (aspect ratio control: 1:1, 2:3, 3:2, 3:4, 4:3, 9:16, 16:9, 21:9)
  app.post('/api/projects/:id/generate-image', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const row = assertProjectOwnership(String(req.params.id), req.user!.id);
      if (!row) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }
      const project = mapProjectRow(row);
      const prompt = String(req.body?.prompt || '').trim();
      const aspectRatio = String(req.body?.aspectRatio || '16:9');
      const sourceAssetId = req.body?.sourceAssetId ? String(req.body.sourceAssetId) : null;

      if (!prompt) {
        res.status(400).json({ error: 'Please describe the image or edit instruction.' });
        return;
      }

      let sourceBase64: string | undefined;
      let sourceMime: string | undefined;

      if (sourceAssetId) {
        const srcRow = db
          .prepare('SELECT * FROM assets WHERE id = ? AND project_id = ?')
          .get(sourceAssetId, project.id) as Record<string, unknown> | undefined;
        if (!srcRow) {
          res.status(404).json({ error: 'Source photo asset not found.' });
          return;
        }
        const abs = resolveStoragePath(String(srcRow.storage_key));
        sourceBase64 = fs.readFileSync(abs).toString('base64');
        sourceMime = String(srcRow.mime_type || 'image/jpeg');
      }

      const generated = await generateOrEditImageWithNanoBanana({
        prompt,
        aspectRatio,
        sourceImageBase64: sourceBase64,
        sourceMimeType: sourceMime,
      });

      const ext = generated.mimeType.includes('png') ? '.png' : '.jpg';

      // If editing an existing photo, store as a REVERSIBLE generative edit entry on its recipe (never overwrite original!)
      if (sourceAssetId) {
        const stored = writeBufferToStorage('generated', `gen_edit_${sourceAssetId}${ext}`, generated.buffer, ext);
        const resultUrl = `/api/media/file/${encodeURIComponent(stored.storageKey)}`;
        const existingRecipe =
          project.photoEdits[sourceAssetId] ||
          createDefaultPhotoRecipe(sourceAssetId, project.batchLook.look, true);

        const newGenEntry = {
          id: newId('gedit'),
          prompt,
          resultUrl,
          storageKey: stored.storageKey,
          model: generated.model,
          enabled: true,
          createdAt: new Date().toISOString(),
        };

        const updatedRecipe: PhotoEditRecipe = {
          ...existingRecipe,
          generativeEdits: [
            ...existingRecipe.generativeEdits.map((g) => ({ ...g, enabled: false })),
            newGenEntry,
          ],
          updatedAt: new Date().toISOString(),
        };

        const nextPhotoEdits = { ...project.photoEdits, [sourceAssetId]: updatedRecipe };
        db.prepare('UPDATE projects SET photo_edits_json = ?, updated_at = ? WHERE id = ?').run(
          JSON.stringify(nextPhotoEdits),
          new Date().toISOString(),
          project.id
        );

        res.status(201).json({
          mode: 'edit',
          recipe: updatedRecipe,
          photoEdits: nextPhotoEdits,
          notes: generated.notes,
        });
        return;
      }

      // Otherwise add newly generated image as a Media Pool asset
      const filename = `generated_${aspectRatio.replace(':', 'x')}_${Date.now().toString(36)}${ext}`;
      const stored = writeBufferToStorage('originals', filename, generated.buffer, ext);
      const metadata = await inspectPhotoMetadata(stored.absolutePath);
      const thumbKey = await generatePhotoThumbnail(stored.absolutePath, filename);
      const saliency = await computeLocalSaliencySubject(stored.absolutePath, prompt.slice(0, 48));
      const assetId = newId('ast');
      const now = new Date().toISOString();

      db.prepare(
        `INSERT INTO assets (id, project_id, kind, role, filename, mime_type, file_size_bytes, storage_key, thumbnail_key, proxy_key, metadata_json, order_index, directive, bin, analysis_json, warnings_json, created_at)
         VALUES (?, ?, 'photo', 'generated', ?, ?, ?, ?, ?, NULL, ?, 99, 'normal', 'AI Generated', ?, '[]', ?)`
      ).run(
        assetId,
        project.id,
        filename,
        generated.mimeType,
        stored.sizeBytes,
        stored.storageKey,
        thumbKey,
        JSON.stringify(metadata),
        JSON.stringify(saliency),
        now
      );

      const mapped = mapAssetRow(
        db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId) as Record<string, unknown>
      );
      const nextPhotoEdits = {
        ...project.photoEdits,
        [assetId]: createDefaultPhotoRecipe(assetId, project.batchLook.look, false),
      };
      db.prepare('UPDATE projects SET photo_edits_json = ?, updated_at = ? WHERE id = ?').run(
        JSON.stringify(nextPhotoEdits),
        now,
        project.id
      );

      res.status(201).json({ mode: 'create', asset: mapped, photoEdits: nextPhotoEdits, notes: generated.notes });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Generate Video from Text or Animate Photo into Video using gemini-omni-1.2-flash (Interactions API)
  app.post(
    '/api/projects/:id/generate-video',
    requireAuth,
    upload.single('photo'),
    async (req: AuthedRequest, res) => {
      try {
        const row = assertProjectOwnership(String(req.params.id), req.user!.id);
        if (!row) {
          res.status(404).json({ error: 'Project not found.' });
          return;
        }
        const prompt = String(req.body?.prompt || '').trim();
        const aspectRatio: '16:9' | '9:16' = req.body?.aspectRatio === '9:16' ? '9:16' : '16:9';
        const durationSec = Number(req.body?.durationSec || 5);
        const sourceAssetId = req.body?.sourceAssetId ? String(req.body.sourceAssetId) : null;

        if (!prompt) {
          res.status(400).json({ error: 'Please enter a motion or video scene prompt.' });
          return;
        }

        let sourceImageBase64: string | undefined;
        let sourceMimeType: string | undefined;

        if (req.file) {
          if (!req.file.mimetype.startsWith('image/')) {
            res.status(400).json({ error: 'Please upload a valid JPEG, PNG, or WebP photo to animate.' });
            return;
          }
          sourceImageBase64 = req.file.buffer.toString('base64');
          sourceMimeType = req.file.mimetype;
        } else if (sourceAssetId) {
          const srcRow = db
            .prepare('SELECT * FROM assets WHERE id = ? AND project_id = ?')
            .get(sourceAssetId, String(req.params.id)) as Record<string, unknown> | undefined;
          if (!srcRow || String(srcRow.kind) !== 'photo') {
            res.status(404).json({ error: 'Source photo asset not found.' });
            return;
          }
          const abs = resolveStoragePath(String(srcRow.storage_key));
          sourceImageBase64 = fs.readFileSync(abs).toString('base64');
          sourceMimeType = String(srcRow.mime_type || 'image/jpeg');
        }

        const generated = await generateVideoWithOmniFlash({
          prompt,
          aspectRatio,
          durationSec,
          sourceImageBase64,
          sourceMimeType,
        });
        const prefix = sourceImageBase64 ? 'omni_animated' : 'omni_broll';
        const filename = `${prefix}_${aspectRatio.replace(':', 'x')}_${Date.now().toString(36)}.mp4`;
      const stored = writeBufferToStorage('originals', filename, generated.buffer, '.mp4');
      const metadata = await probeVideoOrAudio(stored.absolutePath);
      const genThumb = await generateVideoThumbnailAndKeyframes(
        stored.absolutePath,
        filename,
        metadata.durationSec
      );
      const saliency = genThumb.keyframePaths[0]
        ? await computeLocalSaliencySubject(genThumb.keyframePaths[0], prompt.slice(0, 48))
        : null;

      const assetId = newId('ast');
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO assets (id, project_id, kind, role, filename, mime_type, file_size_bytes, storage_key, thumbnail_key, proxy_key, metadata_json, order_index, directive, bin, analysis_json, warnings_json, created_at)
         VALUES (?, ?, 'video', 'generated', ?, 'video/mp4', ?, ?, ?, NULL, ?, 99, 'normal', 'AI Generated', ?, '[]', ?)`
      ).run(
        assetId,
        String(req.params.id),
        filename,
        stored.sizeBytes,
        stored.storageKey,
        genThumb.thumbnailKey,
        JSON.stringify(metadata),
        saliency ? JSON.stringify(saliency) : null,
        now
      );

      const mapped = mapAssetRow(
        db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId) as Record<string, unknown>
      );
      res.status(201).json({ asset: mapped, model: generated.model });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Generate Music using Lyria (lyria-3-clip-preview / lyria-3-pro-preview)
  app.post('/api/projects/:id/generate-music', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const row = assertProjectOwnership(String(req.params.id), req.user!.id);
      if (!row) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }
      const prompt = String(req.body?.prompt || '').trim();
      const mode: 'clip' | 'pro' = req.body?.mode === 'pro' ? 'pro' : 'clip';
      if (!prompt) {
        res.status(400).json({ error: 'Please describe the musical mood, tempo, and instrumentation.' });
        return;
      }

      const generated = await generateMusicWithLyria({ prompt, mode });
      const ext = generated.mimeType.includes('wav') ? '.wav' : '.mp3';
      const filename = `lyria_${mode}_${Date.now().toString(36)}${ext}`;
      const stored = writeBufferToStorage('originals', filename, generated.buffer, ext);
      const metadata = await probeVideoOrAudio(stored.absolutePath);

      const assetId = newId('ast');
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO assets (id, project_id, kind, role, filename, mime_type, file_size_bytes, storage_key, thumbnail_key, proxy_key, metadata_json, order_index, directive, bin, analysis_json, warnings_json, created_at)
         VALUES (?, ?, 'audio', 'generated', ?, ?, ?, ?, NULL, NULL, ?, 99, 'normal', 'Audio & Music', NULL, '[]', ?)`
      ).run(
        assetId,
        String(req.params.id),
        filename,
        generated.mimeType,
        stored.sizeBytes,
        stored.storageKey,
        JSON.stringify(metadata),
        now
      );

      const mapped = mapAssetRow(
        db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId) as Record<string, unknown>
      );
      res.status(201).json({ asset: mapped, lyrics: generated.lyrics, model: generated.model });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // ==========================================
  // 8. REAL VIDEO RENDERING & PHOTO EXPORTS + BACKGROUND JOBS
  // ==========================================
  app.post('/api/projects/:id/render-video', requireAuth, (req: AuthedRequest, res) => {
    const row = assertProjectOwnership(String(req.params.id), req.user!.id);
    if (!row) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    const project = mapProjectRow(row);
    if (!project.editPlan || project.editPlan.segments.length === 0) {
      res.status(400).json({ error: 'No timeline segments to render.' });
      return;
    }

    const options: VideoRenderOptions = {
      preset: req.body?.preset || '1080p_landscape',
      aspectRatio: (req.body?.aspectRatio || project.editPlan.aspectRatio) as AspectRatio,
      fps: Number(req.body?.fps || 24),
      burnCaptions: Boolean(req.body?.burnCaptions),
      includeTitles: Boolean(req.body?.includeTitles),
    };

    const job = createJob(
      project.id,
      'video_render',
      7,
      `Queued FFmpeg render (${options.preset.replace(/_/g, ' ')}, ${options.aspectRatio})...`
    );

    db.prepare('UPDATE projects SET status = ?, updated_at = ? WHERE id = ?').run(
      'rendering',
      new Date().toISOString(),
      project.id
    );

    const assetRows = db
      .prepare('SELECT * FROM assets WHERE project_id = ?')
      .all(project.id) as Array<Record<string, unknown>>;
    const assetsById = new Map(assetRows.map(mapAssetRow).map((a) => [a.id, a]));

    // Background async render
    void (async () => {
      try {
        const rendered = await renderEditPlanToMp4({
          projectName: project.name,
          editPlan: project.editPlan!,
          assetsById,
          options,
          isCancelled: () => isJobCancelled(job.id),
          registerCancel: (fn) => registerJobCanceller(job.id, fn),
          onProgress: (pct, msg) => updateJobProgress(job.id, 7, pct, msg),
        });

        const exportId = newId('exp');
        const now = new Date().toISOString();
        db.prepare(
          `INSERT INTO exports (id, project_id, kind, filename, format, resolution, aspect_ratio, fps, codec, file_size_bytes, storage_key, settings_summary, created_at)
           VALUES (?, ?, 'video', ?, 'MP4', ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          exportId,
          project.id,
          rendered.filename,
          `${rendered.width}×${rendered.height}`,
          options.aspectRatio,
          rendered.fps,
          rendered.codec,
          rendered.fileSizeBytes,
          rendered.storageKey,
          `${options.preset.replace(/_/g, ' ')} · ${rendered.width}×${rendered.height} @ ${rendered.fps}fps · ${rendered.codec}`,
          now
        );

        db.prepare('UPDATE projects SET status = ?, updated_at = ? WHERE id = ?').run(
          'completed',
          now,
          project.id
        );
        completeJob(
          job.id,
          `Rendered ${rendered.filename} (${(rendered.fileSizeBytes / 1024 / 1024).toFixed(2)} MB).`,
          exportId
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Video render failed';
        if (msg === 'RENDER_CANCELLED') {
          db.prepare('UPDATE projects SET status = ?, updated_at = ? WHERE id = ?').run(
            'editing',
            new Date().toISOString(),
            project.id
          );
          return;
        }
        db.prepare('UPDATE projects SET status = ?, updated_at = ? WHERE id = ?').run(
          'editing',
          new Date().toISOString(),
          project.id
        );
        failJob(job.id, 'Rendering the video or exporting edited photos', msg);
      }
    })();

    res.status(202).json({ job });
  });

  app.post('/api/projects/:id/export-photos', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const row = assertProjectOwnership(String(req.params.id), req.user!.id);
      if (!row) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }
      const project = mapProjectRow(row);
      const assetIds: string[] = Array.isArray(req.body?.assetIds) ? req.body.assetIds : [];
      const options: PhotoExportOptions = {
        format: ['jpeg', 'png', 'tiff'].includes(req.body?.format) ? req.body.format : 'jpeg',
        quality: Number(req.body?.quality || 92),
        maxDimension: req.body?.maxDimension ? Number(req.body.maxDimension) : null,
        colorProfile: 'srgb',
      };

      const photoRows = db
        .prepare("SELECT * FROM assets WHERE project_id = ? AND kind = 'photo' ORDER BY order_index ASC")
        .all(project.id) as Array<Record<string, unknown>>;
      const allPhotos = photoRows.map(mapAssetRow);
      const selected =
        assetIds.length > 0 ? allPhotos.filter((p) => assetIds.includes(p.id)) : allPhotos;

      if (selected.length === 0) {
        res.status(400).json({ error: 'No photos selected for export.' });
        return;
      }

      const items = selected.map((asset) => ({
        asset,
        recipe:
          project.photoEdits[asset.id] ||
          createDefaultPhotoRecipe(asset.id, project.batchLook.look, false),
      }));

      const now = new Date().toISOString();
      const exportId = newId('exp');

      if (items.length === 1) {
        const out = await exportSinglePhoto(items[0].asset, items[0].recipe, options);
        db.prepare(
          `INSERT INTO exports (id, project_id, kind, filename, format, resolution, aspect_ratio, fps, codec, file_size_bytes, storage_key, settings_summary, created_at)
           VALUES (?, ?, 'photo', ?, ?, ?, ?, NULL, 'sRGB', ?, ?, ?, ?)`
        ).run(
          exportId,
          project.id,
          out.filename,
          options.format.toUpperCase(),
          `${out.width}×${out.height}`,
          items[0].recipe.crop.aspectRatio,
          out.fileSizeBytes,
          out.storageKey,
          `Single photo · ${options.format.toUpperCase()} Q${options.quality} · ${out.width}×${out.height} · sRGB`,
          now
        );
      } else {
        const out = await exportBatchPhotosZip(project.name, items, options);
        db.prepare(
          `INSERT INTO exports (id, project_id, kind, filename, format, resolution, aspect_ratio, fps, codec, file_size_bytes, storage_key, settings_summary, created_at)
           VALUES (?, ?, 'photo_batch', ?, 'ZIP', ?, 'mixed', NULL, 'sRGB', ?, ?, ?, ?)`
        ).run(
          exportId,
          project.id,
          out.filename,
          options.maxDimension ? `Max ${options.maxDimension}px` : 'Original',
          out.fileSizeBytes,
          out.storageKey,
          `Batch ${out.count} photos · ${options.format.toUpperCase()} Q${options.quality} · sRGB`,
          now
        );
      }

      const artifact = mapExportRow(
        db.prepare('SELECT * FROM exports WHERE id = ?').get(exportId) as Record<string, unknown>
      );
      res.status(201).json({ exportArtifact: artifact });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.get('/api/projects/:id/jobs', requireAuth, (req: AuthedRequest, res) => {
    const row = assertProjectOwnership(String(req.params.id), req.user!.id);
    if (!row) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    res.json({ jobs: getProjectJobs(String(req.params.id)) });
  });

  app.post('/api/jobs/:jobId/cancel', requireAuth, (req: AuthedRequest, res) => {
    const job = getJobById(String(req.params.jobId));
    if (!job || !assertProjectOwnership(job.projectId, req.user!.id)) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }
    const cancelled = cancelJob(job.id);
    res.json({ job: cancelled });
  });

  app.get('/api/exports/:exportId/download', requireAuth, (req: AuthedRequest, res) => {
    const row = db
      .prepare(
        `SELECT e.* FROM exports e
         INNER JOIN projects p ON p.id = e.project_id
         WHERE e.id = ? AND p.user_id = ?`
      )
      .get(String(req.params.exportId), req.user!.id) as Record<string, unknown> | undefined;
    if (!row) {
      res.status(404).json({ error: 'Export file not found.' });
      return;
    }
    const absPath = resolveStoragePath(String(row.storage_key));
    if (!fs.existsSync(absPath)) {
      res.status(404).json({ error: 'Export artifact missing on disk.' });
      return;
    }
    res.download(absPath, String(row.filename));
  });

  // ==========================================
  // 9. VITE MIDDLEWARE / PRODUCTION STATIC SERVING
  // ==========================================
  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Frameflow Studio running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Frameflow Studio server:', err);
  process.exit(1);
});
