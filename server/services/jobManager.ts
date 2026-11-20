import { db, mapJobRow, newId } from '../db';
import type { JobStageNumber, ProcessingJob } from '../../src/shared/types';

export const STAGE_LABELS: Record<JobStageNumber, string> = {
  1: 'Uploading and validating media',
  2: 'Creating thumbnails and analysis proxies',
  3: 'Analyzing video scenes and photo composition',
  4: 'Analyzing speech, sound, and image quality',
  5: 'Building the creative plan',
  6: 'Generating photo adjustments and timeline preview',
  7: 'Rendering the video or exporting edited photos',
};

const activeCancellers = new Map<string, () => void>();
const cancelledJobIds = new Set<string>();

export function createJob(
  projectId: string,
  kind: ProcessingJob['kind'],
  initialStage: JobStageNumber,
  message: string
): ProcessingJob {
  const id = newId('job');
  const now = new Date().toISOString();
  const stageLabel = STAGE_LABELS[initialStage];

  db.prepare(
    `INSERT INTO jobs (id, project_id, kind, status, current_stage, stage_label, progress, message, error_message, failed_stage, result_ref, created_at, updated_at)
     VALUES (?, ?, ?, 'running', ?, ?, 0, ?, NULL, NULL, NULL, ?, ?)`
  ).run(id, projectId, kind, initialStage, stageLabel, message, now, now);

  return mapJobRow(db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Record<string, unknown>);
}

export function updateJobProgress(
  jobId: string,
  stage: JobStageNumber,
  progress: number,
  message: string
): void {
  if (cancelledJobIds.has(jobId)) return;
  const now = new Date().toISOString();
  const clamped = Math.max(0, Math.min(100, Math.round(progress)));
  db.prepare(
    `UPDATE jobs SET current_stage = ?, stage_label = ?, progress = ?, message = ?, updated_at = ? WHERE id = ? AND status = 'running'`
  ).run(stage, STAGE_LABELS[stage], clamped, message, now, jobId);
}

export function completeJob(jobId: string, message: string, resultRef?: string): void {
  activeCancellers.delete(jobId);
  if (cancelledJobIds.has(jobId)) return;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE jobs SET status = 'completed', progress = 100, message = ?, result_ref = ?, updated_at = ? WHERE id = ?`
  ).run(message, resultRef || null, now, jobId);
}

export function failJob(jobId: string, failedStage: string, errorMessage: string): void {
  activeCancellers.delete(jobId);
  if (cancelledJobIds.has(jobId)) return;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE jobs SET status = 'failed', failed_stage = ?, error_message = ?, message = ?, updated_at = ? WHERE id = ?`
  ).run(failedStage, errorMessage, `Failed during ${failedStage}`, now, jobId);
}

export function registerJobCanceller(jobId: string, cancelFn: () => void): void {
  activeCancellers.set(jobId, cancelFn);
}

export function isJobCancelled(jobId: string): boolean {
  return cancelledJobIds.has(jobId);
}

export function cancelJob(jobId: string): ProcessingJob | null {
  cancelledJobIds.add(jobId);
  const canceller = activeCancellers.get(jobId);
  if (canceller) {
    try {
      canceller();
    } catch {
      // ignore
    }
    activeCancellers.delete(jobId);
  }
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE jobs SET status = 'cancelled', message = 'Cancelled safely by user. Project state preserved.', updated_at = ? WHERE id = ? AND status IN ('queued', 'running')`
  ).run(now, jobId);

  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as Record<string, unknown> | undefined;
  return row ? mapJobRow(row) : null;
}

export function getProjectJobs(projectId: string): ProcessingJob[] {
  const rows = db
    .prepare('SELECT * FROM jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 20')
    .all(projectId) as Array<Record<string, unknown>>;
  return rows.map(mapJobRow);
}

export function getJobById(jobId: string): ProcessingJob | null {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as Record<string, unknown> | undefined;
  return row ? mapJobRow(row) : null;
}
