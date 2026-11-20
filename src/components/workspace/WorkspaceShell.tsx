import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Download,
  Film,
  Flag,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  Palette,
  Redo2,
  Save,
  Settings,
  Sliders,
  Undo2,
  Upload,
  Volume2,
} from 'lucide-react';
import { api } from '../../api/client';
import { BrandMark } from '../BrandMark';
import { buildReframeFromDetection } from '../../shared/reframing';
import {
  defaultColorGrade,
  formatTimecode,
  getMarkerColorStyle,
  rippleRecalculateTimeline,
  sortTimelineMarkers,
} from '../../shared/timeline';
import { MediaPoolView } from './MediaPoolView';
import { VideoEditView } from './VideoEditView';
import { ColorGradeView } from './ColorGradeView';
import { PhotoStudioView } from './PhotoStudioView';
import { AudioStudioView } from './AudioStudioView';
import { ExportRenderView } from './ExportRenderView';
import { StudioAssistantDrawer } from './StudioAssistantDrawer';
import type {
  BatchLookProfile,
  ChatMessage,
  EditPlan,
  ExportArtifact,
  MediaAsset,
  PhotoEditRecipe,
  ProcessingJob,
  Project,
  ProjectRevision,
  ProviderStatus,
  WorkspaceTab,
} from '../../shared/types';

interface WorkspaceShellProps {
  projectId: string;
  providerStatus: ProviderStatus | null;
  onBackToDashboard: () => void;
  onOpenSettings: (project: Project) => void;
  onProjectMutated: () => void;
}

interface UndoSnapshot {
  editPlan: EditPlan | null;
  photoEdits: Record<string, PhotoEditRecipe>;
  batchLook: BatchLookProfile;
}

const TABS: Array<{ id: WorkspaceTab; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { id: 'media', label: 'Media', icon: FolderOpen },
  { id: 'edit', label: 'Edit', icon: Film },
  { id: 'color', label: 'Color', icon: Palette },
  { id: 'photo', label: 'Photo', icon: ImageIcon },
  { id: 'audio', label: 'Audio', icon: Volume2 },
  { id: 'export', label: 'Export', icon: Download },
];

export const WorkspaceShell: React.FC<WorkspaceShellProps> = ({
  projectId,
  providerStatus,
  onBackToDashboard,
  onOpenSettings,
  onProjectMutated,
}) => {
  const [project, setProject] = useState<Project | null>(null);
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [revisions, setRevisions] = useState<ProjectRevision[]>([]);
  const [jobs, setJobs] = useState<ProcessingJob[]>([]);
  const [exportsList, setExportsList] = useState<ExportArtifact[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<WorkspaceTab>('edit');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'unsaved'>('saved');

  // Inline project rename state
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');

  // Undo / Redo stacks
  const [undoStack, setUndoStack] = useState<UndoSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<UndoSnapshot[]>([]);

  const saveTimerRef = useRef<number | null>(null);
  const initializedTabRef = useRef(false);

  const fetchDetail = useCallback(async () => {
    try {
      const detail = await api.getProjectDetail(projectId);
      setProject(detail.project);
      setAssets(detail.assets);
      setRevisions(detail.revisions);
      setJobs(detail.jobs);
      setExportsList(detail.exports);
      setChatMessages(detail.chatMessages);
      setTitleDraft(detail.project.name);
      setLoadError(null);

      if (!initializedTabRef.current) {
        initializedTabRef.current = true;
        if (detail.project.type === 'photo') {
          setActiveTab(detail.assets.length > 0 ? 'photo' : 'media');
        } else if (detail.project.editPlan && detail.project.editPlan.segments.length > 0) {
          setActiveTab('edit');
        } else {
          setActiveTab('media');
        }
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Unable to load project.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    initializedTabRef.current = false;
    setLoading(true);
    fetchDetail();
  }, [fetchDetail]);

  // Poll active jobs until completion, then refresh full detail
  const hasActiveJob = jobs.some((j) => j.status === 'queued' || j.status === 'running');
  useEffect(() => {
    if (!hasActiveJob) return;
    const timer = window.setInterval(async () => {
      try {
        const res = await api.getJobs(projectId);
        setJobs(res.jobs);
        const stillRunning = res.jobs.some((j) => j.status === 'queued' || j.status === 'running');
        if (!stillRunning) {
          await fetchDetail();
          onProjectMutated();
        }
      } catch {
        // Ignore transient poll hiccups
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [hasActiveJob, projectId, fetchDetail, onProjectMutated]);

  const scheduleAutosave = useCallback(
    (
      nextProject: Project,
      revisionLabel?: string
    ) => {
      setSaveState('unsaved');
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = window.setTimeout(async () => {
        setSaveState('saving');
        try {
          const res = await api.updateProject(nextProject.id, {
            editPlan: nextProject.editPlan || undefined,
            photoEdits: nextProject.photoEdits,
            batchLook: nextProject.batchLook,
            createRevisionLabel: revisionLabel,
          });
          setProject(res.project);
          if (res.revision) {
            setRevisions((prev) => [res.revision!, ...prev]);
          }
          setSaveState('saved');
          onProjectMutated();
        } catch {
          setSaveState('unsaved');
        }
      }, revisionLabel ? 100 : 650);
    },
    [onProjectMutated]
  );

  const pushUndoSnapshot = useCallback((current: Project) => {
    setUndoStack((prev) => [
      ...prev.slice(-24),
      {
        editPlan: current.editPlan,
        photoEdits: current.photoEdits,
        batchLook: current.batchLook,
      },
    ]);
    setRedoStack([]);
  }, []);

  const handleChangeEditPlan = useCallback(
    (nextPlan: EditPlan, revisionLabel?: string) => {
      setProject((prev) => {
        if (!prev) return prev;
        pushUndoSnapshot(prev);
        const updated: Project = { ...prev, editPlan: nextPlan };
        scheduleAutosave(updated, revisionLabel);
        return updated;
      });
    },
    [pushUndoSnapshot, scheduleAutosave]
  );

  const handleChangePhotoEdits = useCallback(
    (nextRecipes: Record<string, PhotoEditRecipe>, nextBatchLook?: BatchLookProfile) => {
      setProject((prev) => {
        if (!prev) return prev;
        pushUndoSnapshot(prev);
        const updated: Project = {
          ...prev,
          photoEdits: nextRecipes,
          batchLook: nextBatchLook || prev.batchLook,
        };
        scheduleAutosave(updated);
        return updated;
      });
    },
    [pushUndoSnapshot, scheduleAutosave]
  );

  const handleTogglePhotoInTimeline = useCallback(
    (asset: MediaAsset, include: boolean) => {
      setProject((prev) => {
        if (!prev || !prev.editPlan) return prev;
        pushUndoSnapshot(prev);

        let nextSegments = [...prev.editPlan.segments];
        if (include) {
          if (!nextSegments.some((s) => s.assetId === asset.id)) {
            const reframe = buildReframeFromDetection(
              asset.analysis,
              asset.metadata.width,
              asset.metadata.height,
              prev.editPlan.aspectRatio,
              'local-saliency'
            );
            reframe.motionEnabled = true;
            nextSegments.push({
              id: `seg-photo-${Date.now()}`,
              assetId: asset.id,
              mediaKind: 'photo',
              label: asset.filename.replace(/\.[^.]+$/, ''),
              sourceInSec: 0,
              sourceOutSec: 3.5,
              timelineInSec: 0,
              timelineOutSec: 3.5,
              editorialRole: 'detail',
              selectionReason: 'Added by editor from Photo Studio',
              confidence: 0.9,
              warnings: [],
              reframe,
              speed: 1,
              transitionIn: 'dissolve',
              transitionDurationSec: 0.4,
              color: defaultColorGrade(prev.photoEdits[asset.id]?.look || 'natural_clean'),
              audioMode: 'muted',
              audioGainDb: -24,
              locked: false,
            });
          }
        } else {
          nextSegments = nextSegments.filter((s) => s.assetId !== asset.id);
        }

        const nextPlan: EditPlan = {
          ...prev.editPlan,
          segments: rippleRecalculateTimeline(nextSegments),
        };
        const existingRecipe = prev.photoEdits[asset.id];
        const nextPhotoEdits = existingRecipe
          ? {
              ...prev.photoEdits,
              [asset.id]: { ...existingRecipe, includedInTimeline: include },
            }
          : prev.photoEdits;

        const updated: Project = {
          ...prev,
          editPlan: nextPlan,
          photoEdits: nextPhotoEdits,
        };
        scheduleAutosave(updated);
        return updated;
      });
    },
    [pushUndoSnapshot, scheduleAutosave]
  );

  const handleUndo = useCallback(() => {
    if (!project || undoStack.length === 0) return;
    const prevSnap = undoStack[undoStack.length - 1];
    setRedoStack((r) => [
      ...r,
      {
        editPlan: project.editPlan,
        photoEdits: project.photoEdits,
        batchLook: project.batchLook,
      },
    ]);
    setUndoStack((u) => u.slice(0, -1));
    const restored: Project = {
      ...project,
      editPlan: prevSnap.editPlan,
      photoEdits: prevSnap.photoEdits,
      batchLook: prevSnap.batchLook,
    };
    setProject(restored);
    scheduleAutosave(restored);
  }, [project, undoStack, scheduleAutosave]);

  const handleRedo = useCallback(() => {
    if (!project || redoStack.length === 0) return;
    const nextSnap = redoStack[redoStack.length - 1];
    setUndoStack((u) => [
      ...u,
      {
        editPlan: project.editPlan,
        photoEdits: project.photoEdits,
        batchLook: project.batchLook,
      },
    ]);
    setRedoStack((r) => r.slice(0, -1));
    const restored: Project = {
      ...project,
      editPlan: nextSnap.editPlan,
      photoEdits: nextSnap.photoEdits,
      batchLook: nextSnap.batchLook,
    };
    setProject(restored);
    scheduleAutosave(restored);
  }, [project, redoStack, scheduleAutosave]);

  // Keyboard shortcuts for Undo / Redo
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleRedo]);

  const handleSaveCheckpoint = async () => {
    if (!project) return;
    setSaveState('saving');
    try {
      const res = await api.updateProject(project.id, {
        editPlan: project.editPlan || undefined,
        photoEdits: project.photoEdits,
        batchLook: project.batchLook,
        createRevisionLabel: `Manual Checkpoint (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`,
        authorNote: 'Saved by editor from top bar',
      });
      setProject(res.project);
      if (res.revision) {
        setRevisions((prev) => [res.revision!, ...prev]);
      }
      setSaveState('saved');
    } catch {
      setSaveState('unsaved');
    }
  };

  const handleCommitTitle = async () => {
    setEditingTitle(false);
    if (!project || !titleDraft.trim() || titleDraft.trim() === project.name) {
      setTitleDraft(project?.name || '');
      return;
    }
    const res = await api.updateProject(project.id, { name: titleDraft.trim() });
    setProject(res.project);
    onProjectMutated();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0D0E11] text-[#F2EFE9] flex items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-[#9AA0AE]">
          <Loader2 size={18} className="animate-spin text-[#D99B43]" />
          <span>Opening editing suite…</span>
        </div>
      </div>
    );
  }

  if (loadError || !project) {
    return (
      <div className="min-h-screen bg-[#0D0E11] text-[#F2EFE9] flex flex-col items-center justify-center gap-4 p-6">
        <p className="text-sm text-red-300">{loadError || 'Project not found.'}</p>
        <button
          type="button"
          onClick={onBackToDashboard}
          className="rounded-md border border-[#2A2E39] bg-[#14161B] px-4 py-2 text-xs text-[#F2EFE9]"
        >
          Return to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-[#0D0E11] text-[#F2EFE9] overflow-hidden">
      {/* Studio Top Bar */}
      <header className="h-12 shrink-0 border-b border-[#232730] bg-[#14161B] px-3 sm:px-4 flex items-center justify-between gap-3">
        {/* Left: Back + Brand + Editable Project Title */}
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={onBackToDashboard}
            aria-label="Back to project dashboard"
            className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-[#9AA0AE] hover:text-[#F2EFE9] hover:bg-[#1B1E25]"
          >
            <ArrowLeft size={14} />
            <span className="hidden sm:inline">Projects</span>
          </button>
          <span className="text-[#2A2E39]">|</span>
          <BrandMark size={18} />
          {editingTitle ? (
            <input
              type="text"
              value={titleDraft}
              autoFocus
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={handleCommitTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCommitTitle();
                if (e.key === 'Escape') {
                  setEditingTitle(false);
                  setTitleDraft(project.name);
                }
              }}
              className="rounded border border-[#D99B43] bg-[#0D0E11] px-2 py-0.5 text-xs font-medium text-[#F2EFE9] w-52 focus:outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditingTitle(true)}
              title="Click to rename project"
              className="text-xs font-semibold text-[#F2EFE9] hover:text-[#D99B43] truncate max-w-[180px] sm:max-w-[260px]"
            >
              {project.name}
            </button>
          )}
          <span className="hidden lg:inline text-[11px] text-[#6C7280] font-mono">
            {saveState === 'saving'
              ? 'Saving…'
              : saveState === 'unsaved'
                ? 'Unsaved'
                : 'Saved'}
          </span>
        </div>

        {/* Center: Desktop Mode Tabs */}
        <nav
          aria-label="Workspace modes"
          className="hidden md:flex items-center h-full gap-1"
        >
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`h-full px-3 inline-flex items-center gap-1.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                  active
                    ? 'border-[#D99B43] text-[#F2EFE9] bg-[#1B1E25]/60'
                    : 'border-transparent text-[#9AA0AE] hover:text-[#F2EFE9]'
                }`}
              >
                <Icon size={13} />
                <span>{t.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Right: History + Review Drawer + Settings + Export */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="hidden lg:flex items-center border-r border-[#232730] pr-2 mr-1 gap-1">
            <button
              type="button"
              disabled={undoStack.length === 0}
              onClick={handleUndo}
              title="Undo (Ctrl+Z)"
              aria-label="Undo"
              className="p-1.5 rounded text-[#9AA0AE] hover:text-[#F2EFE9] hover:bg-[#1B1E25] disabled:opacity-30"
            >
              <Undo2 size={14} />
            </button>
            <button
              type="button"
              disabled={redoStack.length === 0}
              onClick={handleRedo}
              title="Redo (Ctrl+Shift+Z)"
              aria-label="Redo"
              className="p-1.5 rounded text-[#9AA0AE] hover:text-[#F2EFE9] hover:bg-[#1B1E25] disabled:opacity-30"
            >
              <Redo2 size={14} />
            </button>
            <button
              type="button"
              onClick={handleSaveCheckpoint}
              title="Save revision checkpoint"
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-[#9AA0AE] hover:text-[#F2EFE9] hover:bg-[#1B1E25]"
            >
              {saveState === 'saved' ? <Check size={12} className="text-emerald-400" /> : <Save size={12} />}
              <span>Checkpoint</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#2A2E39] bg-[#1B1E25] hover:border-[#D99B43] px-2.5 py-1.5 text-xs text-[#F2EFE9]"
          >
            <MessageSquare size={13} className="text-[#D99B43]" />
            <span className="hidden sm:inline">Review & Chat</span>
          </button>

          <button
            type="button"
            onClick={() => onOpenSettings(project)}
            aria-label="Project and studio settings"
            className="p-1.5 rounded-md border border-[#2A2E39] bg-[#1B1E25] text-[#9AA0AE] hover:text-[#F2EFE9]"
          >
            <Settings size={14} />
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('export')}
            className="hidden sm:inline-flex items-center gap-1.5 rounded-md bg-[#D99B43] hover:bg-[#E2AA57] px-3 py-1.5 text-xs font-semibold text-[#0D0E11]"
          >
            <Download size={13} /> Export
          </button>
        </div>
      </header>

      {/* Mobile Companion Bar (Clean review, upload, basic controls, export — no cramped desktop timeline) */}
      <div className="md:hidden border-b border-[#232730] bg-[#14161B] px-3 py-2 flex items-center gap-2 overflow-x-auto">
        {[
          { id: 'media' as WorkspaceTab, label: 'Upload & Media', icon: Upload },
          { id: 'photo' as WorkspaceTab, label: 'Photos', icon: ImageIcon },
          { id: 'color' as WorkspaceTab, label: 'Tone / DR', icon: Sliders },
          { id: 'export' as WorkspaceTab, label: 'Export', icon: Download },
        ].map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs whitespace-nowrap ${
                active
                  ? 'border-[#D99B43] bg-[#D99B43]/15 text-[#F2EFE9]'
                  : 'border-[#232730] bg-[#1B1E25] text-[#9AA0AE]'
              }`}
            >
              <Icon size={12} /> {item.label}
            </button>
          );
        })}
      </div>

      {/* Main Workspace Surface */}
      <main className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'media' && (
          <MediaPoolView
            project={project}
            assets={assets}
            jobs={jobs}
            providerStatus={providerStatus}
            onRefreshProject={fetchDetail}
            onNavigateTab={(t) => setActiveTab(t)}
          />
        )}

        {activeTab === 'edit' && (
          <>
            {/* Desktop NLE Edit Suite */}
            <div className="hidden md:block h-full">
              <VideoEditView
                project={project}
                assets={assets}
                onChangeEditPlan={handleChangeEditPlan}
                onRefreshProject={fetchDetail}
              />
            </div>
            {/* Mobile Clean Review Fallback */}
            <div className="md:hidden h-full overflow-y-auto p-4 space-y-4">
              <div className="rounded-md border border-[#232730] bg-[#14161B] p-4 space-y-2">
                <h2 className="text-sm font-semibold text-[#F2EFE9]">
                  Mobile Review Companion
                </h2>
                <p className="text-xs text-[#9AA0AE] leading-relaxed">
                  The multitrack timeline is optimized for desktop monitors. Use mobile mode to upload media, review photo grades, inspect Dynamic Range corrections, or download exports.
                </p>
                <div className="flex flex-wrap gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setActiveTab('media')}
                    className="rounded-md bg-[#D99B43] px-3 py-1.5 text-xs font-semibold text-[#0D0E11]"
                  >
                    Upload Media
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('photo')}
                    className="rounded-md border border-[#2A2E39] bg-[#1B1E25] px-3 py-1.5 text-xs text-[#F2EFE9]"
                  >
                    Review Photos
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('export')}
                    className="rounded-md border border-[#2A2E39] bg-[#1B1E25] px-3 py-1.5 text-xs text-[#F2EFE9]"
                  >
                    Export Master
                  </button>
                </div>
              </div>

              {project.editPlan && (
                <>
                  <div className="rounded-md border border-[#232730] bg-[#14161B] p-4 space-y-2.5">
                    <div className="flex items-center justify-between text-xs font-semibold text-[#F2EFE9]">
                      <span className="inline-flex items-center gap-1.5">
                        <Flag size={13} className="text-[#D99B43]" />
                        Narrative Markers ({(project.editPlan.markers || []).length})
                      </span>
                    </div>
                    {sortTimelineMarkers(project.editPlan.markers || []).length === 0 ? (
                      <p className="text-[11px] text-[#9AA0AE]">
                        No custom markers yet. Open on desktop to place flags directly on the timeline.
                      </p>
                    ) : (
                      sortTimelineMarkers(project.editPlan.markers || []).map((mk) => {
                        const style = getMarkerColorStyle(mk.color);
                        return (
                          <div
                            key={mk.id}
                            className="rounded border border-[#232730] bg-[#0D0E11] px-3 py-2 text-xs flex items-center justify-between gap-2"
                          >
                            <span className="inline-flex items-center gap-2 text-[#F2EFE9] truncate">
                              <span
                                style={{ backgroundColor: style.hex }}
                                className="w-2.5 h-2.5 rounded-sm shrink-0"
                              />
                              <span className="truncate">{mk.name}</span>
                            </span>
                            <span className="font-mono text-[11px] text-[#9AA0AE] tabular-nums shrink-0">
                              {formatTimecode(mk.timeSec, project.editPlan?.fps || 24)}
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>

                  <div className="rounded-md border border-[#232730] bg-[#14161B] p-4 space-y-2.5">
                    <div className="text-xs font-semibold text-[#F2EFE9]">
                      Timeline Sequence ({project.editPlan.segments.length} clips · {project.editPlan.aspectRatio})
                    </div>
                    {project.editPlan.segments.map((seg, i) => (
                      <div
                        key={seg.id}
                        className="rounded border border-[#232730] bg-[#0D0E11] px-3 py-2 text-xs flex items-center justify-between"
                      >
                        <span className="text-[#F2EFE9] truncate">
                          {i + 1}. {seg.label}
                        </span>
                        <span className="font-mono text-[#9AA0AE] shrink-0">
                          {(seg.timelineOutSec - seg.timelineInSec).toFixed(1)}s
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {activeTab === 'color' && (
          <ColorGradeView
            project={project}
            assets={assets}
            onChangeEditPlan={(nextPlan) => handleChangeEditPlan(nextPlan)}
          />
        )}

        {activeTab === 'photo' && (
          <PhotoStudioView
            project={project}
            assets={assets}
            onChangePhotoEdits={handleChangePhotoEdits}
            onTogglePhotoInTimeline={handleTogglePhotoInTimeline}
            onRefreshProject={fetchDetail}
          />
        )}

        {activeTab === 'audio' && (
          <AudioStudioView
            project={project}
            assets={assets}
            onChangeEditPlan={(nextPlan) => handleChangeEditPlan(nextPlan)}
            onRefreshProject={fetchDetail}
          />
        )}

        {activeTab === 'export' && (
          <ExportRenderView
            project={project}
            assets={assets}
            jobs={jobs}
            exportsList={exportsList}
            providerStatus={providerStatus}
            onRefreshProject={fetchDetail}
          />
        )}
      </main>

      {drawerOpen && (
        <StudioAssistantDrawer
          project={project}
          revisions={revisions}
          chatMessages={chatMessages}
          providerStatus={providerStatus}
          onClose={() => setDrawerOpen(false)}
          onRefreshProject={fetchDetail}
          onChatUpdated={(msgs) => setChatMessages(msgs)}
        />
      )}
    </div>
  );
};
