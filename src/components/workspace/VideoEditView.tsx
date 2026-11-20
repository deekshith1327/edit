import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Copy,
  Crop,
  Eye,
  Film,
  Flag,
  Image as ImageIcon,
  Lock,
  Maximize2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Scissors,
  Sliders,
  Sparkles,
  Trash2,
  Type as TypeIcon,
  Unlock,
  Volume2,
  VolumeX,
  X,
  ZoomIn,
} from 'lucide-react';
import { api, ApiError } from '../../api/client';
import {
  buildReframeFromDetection,
  computeReframeCrop,
  getPreviewReframeStyle,
  parseAspectRatio,
} from '../../shared/reframing';
import {
  addTimelineMarker,
  defaultColorGrade,
  deleteTimelineMarker,
  findAdjacentMarker,
  findSegmentAtTime,
  formatShortDuration,
  formatTimecode,
  getMarkerColorStyle,
  getTotalTimelineDuration,
  MARKER_COLOR_PALETTE,
  reorderSegments,
  rippleRecalculateTimeline,
  sortTimelineMarkers,
  splitSegmentAtTime,
  trimSegment,
  updateTimelineMarker,
} from '../../shared/timeline';
import { buildCssFilterFromGrade } from '../../shared/photoMath';
import { DynamicRangePanel } from './DynamicRangePanel';
import type {
  AspectRatio,
  EditPlan,
  MarkerColor,
  MediaAsset,
  Project,
  ReframeConfig,
  TimelineMarker,
  VideoSegment,
} from '../../shared/types';

interface VideoEditViewProps {
  project: Project;
  assets: MediaAsset[];
  onChangeEditPlan: (nextPlan: EditPlan, revisionLabel?: string) => void;
  onRefreshProject: () => Promise<void>;
}

export const VideoEditView: React.FC<VideoEditViewProps> = ({
  project,
  assets,
  onChangeEditPlan,
  onRefreshProject,
}) => {
  const plan = project.editPlan;
  const assetsById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);

  const [playheadSec, setPlayheadSec] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(0.85);
  const [muted, setMuted] = useState(false);
  const [selectedSegId, setSelectedSegId] = useState<string | null>(
    plan?.segments[0]?.id || null
  );
  const [inspectorTab, setInspectorTab] = useState<'reframe' | 'tone' | 'clip' | 'titles'>('reframe');
  const [showSafeGuides, setShowSafeGuides] = useState(true);
  const [compareOriginal, setCompareOriginal] = useState(false);
  const [timelineZoom, setTimelineZoom] = useState(54); // px per second
  const [reframeBusy, setReframeBusy] = useState(false);
  const [reframeNotice, setReframeNotice] = useState<string | null>(null);
  const [reframeError, setReframeError] = useState<string | null>(null);

  // Custom Narrative Beat Markers state
  const [markerModalMode, setMarkerModalMode] = useState<'closed' | 'add' | 'edit'>('closed');
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const [markerDraftName, setMarkerDraftName] = useState('');
  const [markerDraftColor, setMarkerDraftColor] = useState<MarkerColor>('amber');
  const [markerDraftNote, setMarkerDraftNote] = useState('');
  const [markerDraftTime, setMarkerDraftTime] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const monitorBoxRef = useRef<HTMLDivElement>(null);
  const draggingFocalRef = useRef(false);

  const segments = plan?.segments || [];
  const markers = useMemo(() => sortTimelineMarkers(plan?.markers || []), [plan?.markers]);
  const totalDuration = useMemo(() => getTotalTimelineDuration(segments), [segments]);
  const activeAtPlayhead = useMemo(
    () => findSegmentAtTime(segments, playheadSec),
    [segments, playheadSec]
  );

  const selectedSegment: VideoSegment | null = useMemo(() => {
    if (selectedSegId) {
      const found = segments.find((s) => s.id === selectedSegId);
      if (found) return found;
    }
    return activeAtPlayhead?.segment || segments[0] || null;
  }, [segments, selectedSegId, activeAtPlayhead]);

  const activeSeg = activeAtPlayhead?.segment || selectedSegment;
  const activeAsset = activeSeg ? assetsById.get(activeSeg.assetId) : undefined;
  const selectedAsset = selectedSegment ? assetsById.get(selectedSegment.assetId) : undefined;

  // Keep selectedSegId valid
  useEffect(() => {
    if (segments.length > 0 && (!selectedSegId || !segments.some((s) => s.id === selectedSegId))) {
      setSelectedSegId(segments[0].id);
    }
  }, [segments, selectedSegId]);

  // Playback timer
  useEffect(() => {
    if (!playing || totalDuration <= 0) return;
    let last = performance.now();
    let rafId = 0;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setPlayheadSec((prev) => {
        const next = prev + dt;
        if (next >= totalDuration) {
          setPlaying(false);
          return 0;
        }
        return next;
      });
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [playing, totalDuration]);

  const jumpToMarker = (marker: TimelineMarker, openEditor = false) => {
    setPlaying(false);
    setPlayheadSec(marker.timeSec);
    const hit = findSegmentAtTime(segments, marker.timeSec);
    if (hit) setSelectedSegId(hit.segment.id);
    setSelectedMarkerId(marker.id);
    if (openEditor) {
      setMarkerDraftName(marker.name);
      setMarkerDraftColor(marker.color);
      setMarkerDraftNote(marker.note || '');
      setMarkerDraftTime(marker.timeSec);
      setMarkerModalMode('edit');
    }
  };

  const openAddMarkerAt = (timeSec: number) => {
    setPlaying(false);
    const clamped = Number(Math.max(0, Math.min(totalDuration || timeSec, timeSec)).toFixed(2));
    setPlayheadSec(clamped);
    setSelectedMarkerId(null);
    setMarkerDraftTime(clamped);
    setMarkerDraftName('');
    setMarkerDraftColor(MARKER_COLOR_PALETTE[markers.length % MARKER_COLOR_PALETTE.length].id);
    setMarkerDraftNote('');
    setMarkerModalMode('add');
  };

  const handleSaveMarker = (e: React.FormEvent) => {
    e.preventDefault();
    if (!plan) return;
    if (markerModalMode === 'add') {
      const { markers: nextMarkers, created } = addTimelineMarker(
        markers,
        {
          timeSec: markerDraftTime,
          name: markerDraftName,
          color: markerDraftColor,
          note: markerDraftNote,
        },
        totalDuration
      );
      onChangeEditPlan({ ...plan, markers: nextMarkers });
      setSelectedMarkerId(created.id);
      setMarkerModalMode('closed');
    } else if (markerModalMode === 'edit' && selectedMarkerId) {
      const nextMarkers = updateTimelineMarker(
        markers,
        selectedMarkerId,
        {
          name: markerDraftName,
          color: markerDraftColor,
          note: markerDraftNote,
          timeSec: markerDraftTime,
        },
        totalDuration
      );
      onChangeEditPlan({ ...plan, markers: nextMarkers });
      setMarkerModalMode('closed');
    }
  };

  const handleDeleteSelectedMarker = () => {
    if (!plan || !selectedMarkerId) return;
    const nextMarkers = deleteTimelineMarker(markers, selectedMarkerId);
    onChangeEditPlan({ ...plan, markers: nextMarkers });
    setSelectedMarkerId(null);
    setMarkerModalMode('closed');
  };

  const handleJumpAdjacentMarker = (direction: 'prev' | 'next') => {
    const target = findAdjacentMarker(markers, playheadSec, direction);
    if (target) jumpToMarker(target, false);
  };

  // Keyboard shortcuts: M to drop a marker at playhead, [ and ] to jump between narrative beats
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toLowerCase() === 'm') {
        e.preventDefault();
        openAddMarkerAt(playheadSec);
      } else if (e.key === '[') {
        const target = findAdjacentMarker(markers, playheadSec, 'prev');
        if (target) {
          e.preventDefault();
          jumpToMarker(target, false);
        }
      } else if (e.key === ']') {
        const target = findAdjacentMarker(markers, playheadSec, 'next');
        if (target) {
          e.preventDefault();
          jumpToMarker(target, false);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [playheadSec, markers, totalDuration, segments]);

  // Sync underlying HTML5 <video> element time with playhead
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !activeSeg || activeSeg.mediaKind !== 'video' || !activeAtPlayhead) return;
    const targetSrcTime = activeSeg.sourceInSec + activeAtPlayhead.localOffsetSec * (activeSeg.speed || 1);
    if (Math.abs(vid.currentTime - targetSrcTime) > 0.25) {
      try {
        vid.currentTime = targetSrcTime;
      } catch {
        // ignore before metadata loaded
      }
    }
    vid.muted = muted || activeSeg.audioMode === 'muted';
    vid.volume = Math.max(0, Math.min(1, volume));
    if (playing && vid.paused) {
      void vid.play().catch(() => {});
    } else if (!playing && !vid.paused) {
      vid.pause();
    }
  }, [activeSeg, activeAtPlayhead, playing, muted, volume]);

  const updateSegment = (segId: string, updater: (seg: VideoSegment) => VideoSegment) => {
    if (!plan) return;
    const nextSegs = rippleRecalculateTimeline(
      plan.segments.map((s) => (s.id === segId ? updater(s) : s))
    );
    onChangeEditPlan({ ...plan, segments: nextSegs });
  };

  const handleReframeUpdate = (patch: Partial<ReframeConfig>) => {
    if (!selectedSegment || !selectedAsset || !plan) return;
    updateSegment(selectedSegment.id, (seg) => {
      const merged: ReframeConfig = {
        ...seg.reframe,
        ...patch,
        targetAspectRatio: plan.aspectRatio,
      };
      const crop = computeReframeCrop(
        selectedAsset.metadata.width,
        selectedAsset.metadata.height,
        merged
      );
      merged.warning = crop.warning;
      return { ...seg, reframe: merged };
    });
  };

  const handleAutoReframeAction = async (
    scope: 'segment' | 'all',
    engine: 'gemini' | 'local',
    aspectOverride?: AspectRatio
  ) => {
    if (!plan) return;
    setReframeBusy(true);
    setReframeError(null);
    setReframeNotice(null);
    const targetAspectRatio = aspectOverride || plan.aspectRatio;
    try {
      await api.autoReframe(project.id, {
        targetAspectRatio,
        segmentId: scope === 'segment' ? selectedSegment?.id : undefined,
        engine,
      });
      await onRefreshProject();
      setReframeNotice(
        scope === 'segment'
          ? `Reframed "${selectedSegment?.label}" for ${targetAspectRatio} (${engine === 'gemini' ? 'Gemini 4 Neon' : 'Local Saliency'}).`
          : `Auto-reframed all ${plan.segments.length} timeline clips for ${targetAspectRatio}.`
      );
    } catch (err) {
      if (err instanceof ApiError && err.providerError) {
        setReframeError(
          `${err.model}: ${err.message} You can run "Local Saliency Reframe" right below without a paid API key.`
        );
      } else {
        setReframeError(err instanceof Error ? err.message : 'Auto-reframe failed.');
      }
    } finally {
      setReframeBusy(false);
    }
  };

  const handleChangeProjectAspect = (ar: AspectRatio) => {
    if (!plan) return;
    // Immediately recompute non-destructive reframe crop targets for all segments for live feedback
    const nextSegments = plan.segments.map((seg) => {
      const asset = assetsById.get(seg.assetId);
      if (!asset) return { ...seg, reframe: { ...seg.reframe, targetAspectRatio: ar } };
      const nextReframe =
        seg.reframe.mode === 'manual'
          ? { ...seg.reframe, targetAspectRatio: ar }
          : buildReframeFromDetection(
              asset.analysis,
              asset.metadata.width,
              asset.metadata.height,
              ar,
              seg.reframe.analyzedBy,
              seg.mediaKind === 'photo'
            );
      return { ...seg, reframe: nextReframe };
    });
    onChangeEditPlan({ ...plan, aspectRatio: ar, segments: nextSegments });
    setReframeNotice(`Switched master sequence to ${ar} and adapted non-destructive crop windows.`);
  };

  const handlePointerFocalUpdate = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!monitorBoxRef.current || !selectedSegment) return;
    const rect = monitorBoxRef.current.getBoundingClientRect();
    const nx = Math.max(0.05, Math.min(0.95, (e.clientX - rect.left) / rect.width));
    const ny = Math.max(0.05, Math.min(0.95, (e.clientY - rect.top) / rect.height));
    handleReframeUpdate({
      mode: 'manual',
      focalX: Number(nx.toFixed(3)),
      focalY: Number(ny.toFixed(3)),
      analyzedBy: 'manual',
    });
  };

  const handleAddAssetToTimeline = (asset: MediaAsset) => {
    const baseAspect: AspectRatio = plan?.aspectRatio || project.brief.aspectRatio || '16:9';
    const newSeg: VideoSegment = {
      id: `seg_${Date.now().toString(36)}`,
      assetId: asset.id,
      mediaKind: asset.kind === 'photo' ? 'photo' : 'video',
      label: asset.analysis?.label || asset.filename.replace(/\.[^.]+$/, ''),
      sourceInSec: 0,
      sourceOutSec: asset.kind === 'photo' ? 3.5 : Math.min(5, asset.metadata.durationSec),
      timelineInSec: totalDuration,
      timelineOutSec: totalDuration + (asset.kind === 'photo' ? 3.5 : Math.min(5, asset.metadata.durationSec)),
      editorialRole: 'b_roll',
      selectionReason: 'Manually added by editor from Media Pool.',
      confidence: asset.analysis?.confidence ?? 0.85,
      warnings: [],
      reframe: buildReframeFromDetection(
        asset.analysis,
        asset.metadata.width,
        asset.metadata.height,
        baseAspect,
        'local-saliency',
        asset.kind === 'photo'
      ),
      speed: 1,
      transitionIn: 'cut',
      transitionDurationSec: 0,
      color: defaultColorGrade(project.batchLook.look),
      audioMode: asset.kind === 'video' && asset.metadata.hasAudio ? 'normal' : 'muted',
      audioGainDb: 0,
      locked: false,
    };

    const nextPlan: EditPlan = plan
      ? { ...plan, segments: rippleRecalculateTimeline([...plan.segments, newSeg]) }
      : {
          version: 1,
          aspectRatio: baseAspect,
          fps: 24,
          summary: {
            intendedViewer: project.brief.purpose,
            storyEmphasis: project.brief.writtenInstruction || 'Manual timeline assembly',
            visualMoodAndPace: `${project.brief.visualDirection} · ${project.brief.pace}`,
            mediaUsageStrategy: 'Editor-assembled timeline',
            estimatedDurationSec: newSeg.sourceOutSec,
            photoEditScope: `${assets.filter((a) => a.kind === 'photo').length} photos`,
            assumptions: [],
            sourceLimitations: [],
            prioritizedChoices: [],
            engineUsed: 'Manual Timeline Assembly',
            generatedAt: new Date().toISOString(),
          },
          segments: [newSeg],
          captions: [],
          titles: [],
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

    onChangeEditPlan(nextPlan);
    setSelectedSegId(newSeg.id);
  };

  const handleSplit = () => {
    if (!plan || !activeSeg) return;
    const next = splitSegmentAtTime(plan.segments, activeSeg.id, playheadSec);
    if (next.length !== plan.segments.length) {
      onChangeEditPlan({ ...plan, segments: next });
    }
  };

  const handleMove = (delta: number) => {
    if (!plan || !selectedSegment) return;
    const idx = plan.segments.findIndex((s) => s.id === selectedSegment.id);
    const next = reorderSegments(plan.segments, idx, idx + delta);
    onChangeEditPlan({ ...plan, segments: next });
  };

  const handleDeleteSegment = () => {
    if (!plan || !selectedSegment) return;
    const filtered = plan.segments.filter((s) => s.id !== selectedSegment.id);
    onChangeEditPlan({ ...plan, segments: rippleRecalculateTimeline(filtered) });
    setSelectedSegId(filtered[0]?.id || null);
  };

  const handleDuplicateSegment = () => {
    if (!plan || !selectedSegment) return;
    const idx = plan.segments.findIndex((s) => s.id === selectedSegment.id);
    const copy: VideoSegment = {
      ...selectedSegment,
      id: `seg_dup_${Date.now().toString(36)}`,
      label: `${selectedSegment.label} (Copy)`,
      locked: false,
    };
    const next = [...plan.segments];
    next.splice(idx + 1, 0, copy);
    onChangeEditPlan({ ...plan, segments: rippleRecalculateTimeline(next) });
    setSelectedSegId(copy.id);
  };

  // Active captions & titles at current playhead
  const activeCaption = useMemo(
    () =>
      plan?.captions.find((c) => playheadSec >= c.startSec && playheadSec <= c.endSec) || null,
    [plan, playheadSec]
  );
  const activeTitle = useMemo(
    () =>
      plan?.titles.find(
        (t) => t.enabled && playheadSec >= t.startSec && playheadSec <= t.endSec
      ) || null,
    [plan, playheadSec]
  );

  const previewStyle = useMemo(() => {
    if (!activeSeg || !activeAsset) {
      return { objectFit: 'cover' as const, objectPosition: '50% 50%', transform: 'scale(1)' };
    }
    if (compareOriginal) {
      return { objectFit: 'contain' as const, objectPosition: '50% 50%', transform: 'scale(1)' };
    }
    return getPreviewReframeStyle(
      activeAsset.metadata.width,
      activeAsset.metadata.height,
      { ...activeSeg.reframe, targetAspectRatio: plan?.aspectRatio || '16:9' },
      activeAtPlayhead?.progress || 0
    );
  }, [activeSeg, activeAsset, plan?.aspectRatio, activeAtPlayhead?.progress, compareOriginal]);

  const activeFilterCss = useMemo(() => {
    if (!activeSeg || compareOriginal) return 'none';
    return buildCssFilterFromGrade(activeSeg.color, 'graded');
  }, [activeSeg, compareOriginal]);

  const selectedCropInfo = useMemo(() => {
    if (!selectedSegment || !selectedAsset || !plan) return null;
    return computeReframeCrop(selectedAsset.metadata.width, selectedAsset.metadata.height, {
      ...selectedSegment.reframe,
      targetAspectRatio: plan.aspectRatio,
    });
  }, [selectedSegment, selectedAsset, plan]);

  const visualAssets = assets.filter((a) => a.kind === 'video' || a.kind === 'photo');
  const musicAsset = plan?.audioMix.musicAssetId
    ? assetsById.get(plan.audioMix.musicAssetId)
    : undefined;

  const monitorAspectNum = parseAspectRatio(plan?.aspectRatio || project.brief.aspectRatio || '16:9');

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#0D0E11]">
      {/* Upper Triad: Compact Media Bin | Central Preview Monitor | Right Context Inspector */}
      <div className="flex-1 min-h-0 grid grid-cols-12 border-b border-[#232730]">
        {/* Left Media Bin */}
        <aside className="col-span-2 bg-[#14161B] border-r border-[#232730] flex flex-col min-h-0">
          <div className="px-3 py-2.5 border-b border-[#232730] flex items-center justify-between">
            <span className="text-xs font-semibold text-[#F2EFE9]">Media Bin</span>
            <span className="text-[11px] font-mono tabular-nums text-[#9AA0AE]">
              {visualAssets.length}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {visualAssets.length === 0 ? (
              <p className="text-[11px] text-[#6C7280] p-2">
                Upload clips or photos in the Media tab.
              </p>
            ) : (
              visualAssets.map((a) => (
                <div
                  key={a.id}
                  className="group bg-[#191C23] border border-[#252A35] rounded overflow-hidden hover:border-[#3A404F] transition-colors"
                >
                  <div className="aspect-video bg-[#0B0C0F] relative overflow-hidden">
                    <img
                      src={a.thumbnailUrl}
                      alt={a.filename}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => handleAddAssetToTimeline(a)}
                      title={`Append ${a.filename} to timeline`}
                      aria-label={`Add ${a.filename} to timeline`}
                      className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 text-[10px] font-medium bg-[#0D0E11]/90 hover:bg-[#D99B43] hover:text-[#0D0E11] text-[#F2EFE9] rounded border border-[#323744] inline-flex items-center gap-0.5 transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                      <span>Add</span>
                    </button>
                  </div>
                  <div className="px-2 py-1.5">
                    <p className="text-[11px] font-medium text-[#E4E6EC] truncate" title={a.filename}>
                      {a.filename}
                    </p>
                    <p className="text-[10px] text-[#9AA0AE] font-mono tabular-nums">
                      {a.kind === 'video'
                        ? formatShortDuration(a.metadata.durationSec)
                        : `${a.metadata.width}×${a.metadata.height}`}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>

        {/* Central Preview Monitor */}
        <section className="col-span-6 bg-[#0B0C0F] flex flex-col min-h-0">
          {/* Monitor Header */}
          <div className="px-4 py-2 bg-[#111318] border-b border-[#232730] flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-medium text-[#F2EFE9] truncate">
                {activeSeg ? activeSeg.label : 'Program Monitor'}
              </span>
              {activeSeg && (
                <>
                  <span aria-hidden="true" className="text-[#6C7280]">·</span>
                  <span className="text-[11px] font-mono text-[#D99B43] whitespace-nowrap">
                    {compareOriginal
                      ? 'Original Source'
                      : `Reframe: ${activeSeg.reframe.mode}`}
                  </span>
                </>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {/* Target Aspect Ratio Switcher */}
              <div className="flex items-center gap-0.5 p-0.5 bg-[#0D0E11] border border-[#272B35] rounded">
                {(['16:9', '9:16', '1:1', '4:5'] as const).map((ar) => (
                  <button
                    key={ar}
                    type="button"
                    onClick={() => handleChangeProjectAspect(ar)}
                    className={`px-1.5 py-0.5 text-[10px] font-mono tabular-nums rounded transition-colors ${
                      (plan?.aspectRatio || '16:9') === ar
                        ? 'bg-[#D99B43] text-[#0D0E11] font-semibold'
                        : 'text-[#9AA0AE] hover:text-[#F2EFE9]'
                    }`}
                  >
                    {ar}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setCompareOriginal((v) => !v)}
                aria-pressed={compareOriginal}
                title="Compare graded/reframed clip with untouched original"
                className={`px-2 py-1 text-[11px] rounded border transition-colors inline-flex items-center gap-1 whitespace-nowrap ${
                  compareOriginal
                    ? 'bg-[#D99B43] text-[#0D0E11] border-[#D99B43] font-medium'
                    : 'bg-[#1B1E25] text-[#D1D5DF] border-[#2C313D] hover:text-white'
                }`}
              >
                <Eye className="w-3 h-3" />
                <span>{compareOriginal ? 'Original' : 'Compare'}</span>
              </button>

              <button
                type="button"
                onClick={() => setShowSafeGuides((v) => !v)}
                aria-pressed={showSafeGuides}
                title="Toggle safe-area margins and focal reticle"
                className={`px-2 py-1 text-[11px] rounded border transition-colors whitespace-nowrap ${
                  showSafeGuides
                    ? 'bg-[#252A36] text-[#F2EFE9] border-[#3A404F]'
                    : 'bg-[#14161B] text-[#9AA0AE] border-[#272B35]'
                }`}
              >
                Guides
              </button>
            </div>
          </div>

          {/* Monitor Viewport */}
          <div className="flex-1 min-h-0 p-4 flex items-center justify-center relative overflow-hidden">
            {!activeSeg || !activeAsset ? (
              <div className="text-center text-xs text-[#9AA0AE]">
                <Film className="w-8 h-8 text-[#6C7280] mx-auto mb-2" />
                <p>Timeline is empty. Add clips from the Media Bin or run Analysis in Media.</p>
              </div>
            ) : (
              <div
                ref={monitorBoxRef}
                data-testid="program-monitor-frame"
                onPointerDown={(e) => {
                  if (inspectorTab === 'reframe' && !compareOriginal) {
                    draggingFocalRef.current = true;
                    handlePointerFocalUpdate(e);
                  }
                }}
                onPointerMove={(e) => {
                  if (draggingFocalRef.current) handlePointerFocalUpdate(e);
                }}
                onPointerUp={() => {
                  draggingFocalRef.current = false;
                }}
                onPointerLeave={() => {
                  draggingFocalRef.current = false;
                }}
                style={{
                  aspectRatio: String(monitorAspectNum),
                  maxHeight: '100%',
                  maxWidth: '100%',
                }}
                className={`relative h-full bg-black border border-[#2C313D] overflow-hidden select-none ${
                  inspectorTab === 'reframe' && !compareOriginal ? 'cursor-crosshair' : ''
                }`}
              >
                {activeSeg.mediaKind === 'video' ? (
                  <video
                    ref={videoRef}
                    src={activeAsset.mediaUrl}
                    playsInline
                    preload="auto"
                    style={{
                      objectFit: previewStyle.objectFit,
                      objectPosition: previewStyle.objectPosition,
                      transform: previewStyle.transform,
                      filter: activeFilterCss,
                    }}
                    className="w-full h-full transition-transform duration-150"
                  />
                ) : (
                  <img
                    src={activeAsset.mediaUrl}
                    alt={activeSeg.label}
                    referrerPolicy="no-referrer"
                    style={{
                      objectFit: previewStyle.objectFit,
                      objectPosition: previewStyle.objectPosition,
                      transform: previewStyle.transform,
                      filter: activeFilterCss,
                    }}
                    className="w-full h-full transition-transform duration-150"
                  />
                )}

                {/* Title Overlay */}
                {activeTitle && !compareOriginal && (
                  <div className="pointer-events-none absolute inset-x-0 top-[14%] px-6 text-center">
                    <div className="inline-block bg-[#0D0E11]/60 backdrop-blur-[2px] px-4 py-2 rounded">
                      <p className="text-base font-semibold tracking-wide text-[#F2EFE9]">
                        {activeTitle.text}
                      </p>
                      {activeTitle.subtext && (
                        <p className="text-[11px] text-[#D1D5DF] mt-0.5">{activeTitle.subtext}</p>
                      )}
                    </div>
                  </div>
                )}

                {/* Caption Overlay inside platform-safe bottom area */}
                {activeCaption && project.brief.captionsEnabled && !compareOriginal && (
                  <div className="pointer-events-none absolute inset-x-6 bottom-[12%] text-center">
                    <span className="inline-block bg-[#0D0E11]/85 text-[#F2EFE9] text-xs px-3 py-1.5 rounded leading-snug">
                      {activeCaption.text}
                    </span>
                  </div>
                )}

                {/* Safe-Area & Intelligent Reframing Focal Reticle */}
                {showSafeGuides && !compareOriginal && (
                  <div className="pointer-events-none absolute inset-0">
                    <div className="absolute inset-[7%] border border-dashed border-white/25" />
                    {/* Focal Target Reticle */}
                    <div
                      style={{
                        left: `${activeSeg.reframe.focalX * 100}%`,
                        top: `${activeSeg.reframe.focalY * 100}%`,
                      }}
                      className="absolute -translate-x-1/2 -translate-y-1/2"
                    >
                      <div className="w-7 h-7 rounded-full border border-[#D99B43] bg-[#D99B43]/15 flex items-center justify-center">
                        <div className="w-1.5 h-1.5 rounded-full bg-[#D99B43]" />
                      </div>
                    </div>
                    <div className="absolute top-2 left-2 bg-[#0D0E11]/80 px-2 py-0.5 text-[10px] font-mono text-[#D1D5DF]">
                      {plan?.aspectRatio || '16:9'} · Subject: {activeSeg.reframe.subjectLabel}
                    </div>
                  </div>
                )}

                {compareOriginal && (
                  <div className="pointer-events-none absolute top-2 left-2 bg-[#D99B43] text-[#0D0E11] px-2 py-0.5 text-[10px] font-semibold font-mono">
                    ORIGINAL SOURCE (UNMODIFIED)
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Transport Bar */}
          <div className="px-4 py-2.5 bg-[#111318] border-t border-[#232730] flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPlayheadSec((p) => Math.max(0, p - 1))}
                aria-label="Step backward 1 second"
                className="p-1.5 text-[#9AA0AE] hover:text-[#F2EFE9] rounded hover:bg-[#1E222B]"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setPlaying((p) => !p)}
                disabled={totalDuration <= 0}
                aria-label={playing ? 'Pause playback' : 'Play sequence'}
                className="w-8 h-8 rounded-md bg-[#F2EFE9] text-[#0D0E11] hover:bg-white flex items-center justify-center disabled:opacity-40"
              >
                {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
              </button>
              <button
                type="button"
                onClick={() => setPlayheadSec((p) => Math.min(totalDuration, p + 1))}
                aria-label="Step forward 1 second"
                className="p-1.5 text-[#9AA0AE] hover:text-[#F2EFE9] rounded hover:bg-[#1E222B]"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <span className="ml-2 text-xs font-mono tabular-nums text-[#F2EFE9]">
                {formatTimecode(playheadSec, plan?.fps || 24)}
              </span>
              <span className="text-xs font-mono tabular-nums text-[#6C7280]">
                / {formatTimecode(totalDuration, plan?.fps || 24)}
              </span>
            </div>

            <div className="flex-1 max-w-xs hidden sm:block">
              <input
                type="range"
                min={0}
                max={Math.max(0.1, totalDuration)}
                step={0.05}
                value={Math.min(playheadSec, totalDuration)}
                onChange={(e) => setPlayheadSec(Number(e.target.value))}
                aria-label="Scrub timeline playhead"
                className="w-full studio-slider"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMuted((m) => !m)}
                aria-label={muted ? 'Unmute preview' : 'Mute preview'}
                className="p-1.5 text-[#9AA0AE] hover:text-[#F2EFE9] rounded"
              >
                {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(e) => {
                  setMuted(false);
                  setVolume(Number(e.target.value));
                }}
                aria-label="Preview volume"
                className="w-16 studio-slider"
              />
              <button
                type="button"
                onClick={() => monitorBoxRef.current?.requestFullscreen?.().catch(() => {})}
                aria-label="Fullscreen monitor"
                className="p-1.5 text-[#9AA0AE] hover:text-[#F2EFE9] rounded"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </section>

        {/* Right Context Inspector */}
        <aside className="col-span-4 bg-[#14161B] border-l border-[#232730] flex flex-col min-h-0">
          {/* Inspector Mode Tabs */}
          <div className="px-3 pt-2.5 pb-2 border-b border-[#232730] grid grid-cols-4 gap-1">
            {(
              [
                { id: 'reframe', label: 'Reframe', icon: Crop },
                { id: 'tone', label: 'Tone / DR', icon: Sliders },
                { id: 'clip', label: 'Clip', icon: Film },
                { id: 'titles', label: 'Titles', icon: TypeIcon },
              ] as const
            ).map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setInspectorTab(t.id)}
                  className={`py-1.5 px-2 text-xs font-medium rounded inline-flex items-center justify-center gap-1 transition-colors whitespace-nowrap ${
                    inspectorTab === t.id
                      ? 'bg-[#252A36] text-[#F2EFE9]'
                      : 'text-[#9AA0AE] hover:text-[#F2EFE9]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {!selectedSegment ? (
              <p className="text-xs text-[#9AA0AE]">Select a timeline segment to inspect.</p>
            ) : inspectorTab === 'reframe' ? (
              /* INTELLIGENT REFRAMING INSPECTOR */
              <div className="space-y-4" data-testid="reframe-inspector">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-semibold text-[#F2EFE9]">
                      Intelligent Reframing
                    </h3>
                    <p className="text-[11px] text-[#9AA0AE]">
                      Non-destructive crop for {plan?.aspectRatio || '16:9'} · Original untouched
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      handleReframeUpdate({
                        mode: 'auto',
                        focalX: selectedAsset?.analysis?.centerX ?? 0.5,
                        focalY: selectedAsset?.analysis?.centerY ?? 0.48,
                        zoom: 1,
                        analyzedBy: 'local-saliency',
                      })
                    }
                    title="Reset to analyzed focal center"
                    className="p-1.5 text-[#9AA0AE] hover:text-[#F2EFE9] rounded hover:bg-[#222630]"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* AI & Local Auto-Reframe Action Buttons */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={reframeBusy}
                    onClick={() => void handleAutoReframeAction('segment', 'gemini')}
                    className="inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-[11px] font-semibold bg-[#D99B43] text-[#0D0E11] rounded hover:bg-[#E5AA54] disabled:opacity-50"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{reframeBusy ? 'Analyzing…' : 'AI Reframe Clip'}</span>
                  </button>
                  <button
                    type="button"
                    disabled={reframeBusy}
                    onClick={() => void handleAutoReframeAction('all', 'local')}
                    className="inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-[11px] font-medium bg-[#1B1E25] border border-[#2E3340] text-[#F2EFE9] rounded hover:bg-[#242834] disabled:opacity-50"
                  >
                    <Crop className="w-3.5 h-3.5" />
                    <span>Auto-Reframe All</span>
                  </button>
                </div>

                {reframeNotice && (
                  <p className="text-[11px] text-emerald-300 bg-emerald-950/35 border border-emerald-800/50 rounded p-2">
                    {reframeNotice}
                  </p>
                )}
                {reframeError && (
                  <div className="text-[11px] text-red-200 bg-red-950/45 border border-red-800/60 rounded p-2 space-y-1.5">
                    <p>{reframeError}</p>
                    <button
                      type="button"
                      onClick={() => void handleAutoReframeAction('segment', 'local')}
                      className="text-[#D99B43] underline font-medium"
                    >
                      Run Local Saliency Reframe on this clip
                    </button>
                  </div>
                )}

                {/* Framing Mode Selector */}
                <div>
                  <label className="block text-[11px] text-[#9AA0AE] mb-1.5">Framing Mode</label>
                  <div className="grid grid-cols-3 gap-1 p-1 bg-[#0D0E11] border border-[#232730] rounded">
                    {(['auto', 'manual', 'fit'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => handleReframeUpdate({ mode: m })}
                        className={`py-1 text-[11px] font-medium rounded capitalize ${
                          selectedSegment.reframe.mode === m
                            ? 'bg-[#252A36] text-[#F2EFE9]'
                            : 'text-[#9AA0AE] hover:text-[#F2EFE9]'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Detected Subject & Computed Pixel Crop Readout */}
                <div className="p-3 bg-[#101216] border border-[#232730] rounded space-y-1.5 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-[#9AA0AE]">Detected subject</span>
                    <span className="text-[#F2EFE9] font-medium truncate max-w-[170px]">
                      {selectedSegment.reframe.subjectLabel}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#9AA0AE]">Tracker source</span>
                    <span className="font-mono text-[#D1D5DF]">
                      {selectedSegment.reframe.analyzedBy} ({Math.round(selectedSegment.reframe.confidence * 100)}%)
                    </span>
                  </div>
                  {selectedCropInfo && (
                    <div className="flex items-center justify-between">
                      <span className="text-[#9AA0AE]">Non-destructive crop</span>
                      <span className="font-mono tabular-nums text-[#D99B43]">
                        {selectedCropInfo.pixelWidth}×{selectedCropInfo.pixelHeight} @ ({selectedCropInfo.pixelX},{' '}
                        {selectedCropInfo.pixelY})
                      </span>
                    </div>
                  )}
                </div>

                {selectedSegment.reframe.warning && (
                  <div className="p-2.5 bg-amber-950/35 border border-amber-800/50 rounded text-[11px] text-amber-200 flex items-start gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                    <span>{selectedSegment.reframe.warning}</span>
                  </div>
                )}

                {/* Manual Focal & Zoom Controls */}
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <label htmlFor="rf-x" className="text-[#C8CDD8]">
                        Horizontal Position (Focal X)
                      </label>
                      <span className="font-mono text-[11px] tabular-nums">
                        {Math.round(selectedSegment.reframe.focalX * 100)}%
                      </span>
                    </div>
                    <input
                      id="rf-x"
                      type="range"
                      min={0.05}
                      max={0.95}
                      step={0.01}
                      value={selectedSegment.reframe.focalX}
                      onChange={(e) =>
                        handleReframeUpdate({
                          mode: 'manual',
                          focalX: Number(e.target.value),
                          analyzedBy: 'manual',
                        })
                      }
                      className="w-full studio-slider"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <label htmlFor="rf-y" className="text-[#C8CDD8]">
                        Vertical Position (Focal Y)
                      </label>
                      <span className="font-mono text-[11px] tabular-nums">
                        {Math.round(selectedSegment.reframe.focalY * 100)}%
                      </span>
                    </div>
                    <input
                      id="rf-y"
                      type="range"
                      min={0.05}
                      max={0.95}
                      step={0.01}
                      value={selectedSegment.reframe.focalY}
                      onChange={(e) =>
                        handleReframeUpdate({
                          mode: 'manual',
                          focalY: Number(e.target.value),
                          analyzedBy: 'manual',
                        })
                      }
                      className="w-full studio-slider"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <label htmlFor="rf-zoom" className="text-[#C8CDD8]">
                        Crop Zoom
                      </label>
                      <span className="font-mono text-[11px] tabular-nums">
                        {selectedSegment.reframe.zoom.toFixed(2)}×
                      </span>
                    </div>
                    <input
                      id="rf-zoom"
                      type="range"
                      min={1}
                      max={2.2}
                      step={0.02}
                      value={selectedSegment.reframe.zoom}
                      onChange={(e) =>
                        handleReframeUpdate({
                          mode: 'manual',
                          zoom: Number(e.target.value),
                          analyzedBy: 'manual',
                        })
                      }
                      className="w-full studio-slider"
                    />
                  </div>

                  <label className="flex items-center justify-between text-xs text-[#D1D5DF] pt-1 cursor-pointer">
                    <span>Protect subject headroom</span>
                    <input
                      type="checkbox"
                      checked={selectedSegment.reframe.safeHeadroom}
                      onChange={(e) => handleReframeUpdate({ safeHeadroom: e.target.checked })}
                      className="accent-[#D99B43]"
                    />
                  </label>

                  {selectedSegment.mediaKind === 'photo' && (
                    <label className="flex items-center justify-between text-xs text-[#D1D5DF] cursor-pointer">
                      <span>Subtle still push-in motion</span>
                      <input
                        type="checkbox"
                        checked={selectedSegment.reframe.motionEnabled}
                        onChange={(e) => handleReframeUpdate({ motionEnabled: e.target.checked })}
                        className="accent-[#D99B43]"
                      />
                    </label>
                  )}

                  <p className="text-[11px] text-[#6C7280]">
                    Tip: Click or drag directly inside the Program Monitor to reposition the focal point.
                  </p>
                </div>
              </div>
            ) : inspectorTab === 'tone' ? (
              /* PER-CLIP DYNAMIC RANGE CORRECTION IN EDIT INSPECTOR */
              <div className="space-y-4">
                <DynamicRangePanel
                  targetLabel={selectedSegment.label}
                  values={{
                    exposure: selectedSegment.color.exposure,
                    highlights: selectedSegment.color.highlights,
                    shadows: selectedSegment.color.shadows,
                    whites: selectedSegment.color.whites ?? 0,
                    blacks: selectedSegment.color.blacks ?? 0,
                  }}
                  onChange={(patch) =>
                    updateSegment(selectedSegment.id, (seg) => ({
                      ...seg,
                      color: { ...seg.color, ...patch },
                    }))
                  }
                  onReset={() =>
                    updateSegment(selectedSegment.id, (seg) => ({
                      ...seg,
                      color: {
                        ...seg.color,
                        exposure: 0,
                        highlights: 0,
                        shadows: 0,
                        whites: 0,
                        blacks: 0,
                      },
                    }))
                  }
                  compareOriginal={compareOriginal}
                  onToggleCompareOriginal={() => setCompareOriginal((v) => !v)}
                />
                <p className="text-[11px] text-[#6C7280] pt-2 border-t border-[#232730]">
                  Saved per-clip in the editable timeline and rendered via FFmpeg dynamic range curves on export.
                </p>
              </div>
            ) : inspectorTab === 'clip' ? (
              /* CLIP TIMING, TRANSITION, AUDIO & EDITORIAL RATIONALE */
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-semibold text-[#F2EFE9]">{selectedSegment.label}</h3>
                    <p className="text-[11px] text-[#9AA0AE] capitalize">
                      Role: {selectedSegment.editorialRole.replace('_', ' ')} · {selectedSegment.mediaKind}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      updateSegment(selectedSegment.id, (seg) => ({ ...seg, locked: !seg.locked }))
                    }
                    className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded border ${
                      selectedSegment.locked
                        ? 'border-[#D99B43] text-[#D99B43] bg-[#D99B43]/10'
                        : 'border-[#2C313D] text-[#9AA0AE] hover:text-[#F2EFE9]'
                    }`}
                  >
                    {selectedSegment.locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                    <span>{selectedSegment.locked ? 'Locked' : 'Lock'}</span>
                  </button>
                </div>

                <div className="p-2.5 bg-[#101216] border border-[#232730] rounded text-[11px] text-[#C8CDD8]">
                  <span className="text-[#9AA0AE]">Selection note: </span>
                  {selectedSegment.selectionReason}
                </div>

                {/* Trim In / Out */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="clip-in" className="block text-[11px] text-[#9AA0AE] mb-1">
                      Source In (sec)
                    </label>
                    <input
                      id="clip-in"
                      type="number"
                      step={0.1}
                      min={0}
                      max={Math.max(0.5, selectedSegment.sourceOutSec - 0.5)}
                      value={selectedSegment.sourceInSec}
                      onChange={(e) => {
                        if (!plan || !selectedAsset) return;
                        onChangeEditPlan({
                          ...plan,
                          segments: trimSegment(
                            plan.segments,
                            selectedSegment.id,
                            Number(e.target.value),
                            selectedSegment.sourceOutSec,
                            selectedAsset.metadata.durationSec
                          ),
                        });
                      }}
                      className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums bg-[#0D0E11] border border-[#2C313D] rounded text-[#F2EFE9]"
                    />
                  </div>
                  <div>
                    <label htmlFor="clip-out" className="block text-[11px] text-[#9AA0AE] mb-1">
                      {selectedSegment.mediaKind === 'photo' ? 'Hold Duration (sec)' : 'Source Out (sec)'}
                    </label>
                    <input
                      id="clip-out"
                      type="number"
                      step={0.1}
                      min={selectedSegment.sourceInSec + 0.5}
                      max={selectedSegment.mediaKind === 'photo' ? 15 : selectedAsset?.metadata.durationSec || 60}
                      value={selectedSegment.sourceOutSec}
                      onChange={(e) => {
                        if (!plan || !selectedAsset) return;
                        onChangeEditPlan({
                          ...plan,
                          segments: trimSegment(
                            plan.segments,
                            selectedSegment.id,
                            selectedSegment.sourceInSec,
                            Number(e.target.value),
                            selectedAsset.metadata.durationSec
                          ),
                        });
                      }}
                      className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums bg-[#0D0E11] border border-[#2C313D] rounded text-[#F2EFE9]"
                    />
                  </div>
                </div>

                {/* Transition */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="clip-trans" className="block text-[11px] text-[#9AA0AE] mb-1">
                      Transition In
                    </label>
                    <select
                      id="clip-trans"
                      value={selectedSegment.transitionIn}
                      onChange={(e) =>
                        updateSegment(selectedSegment.id, (seg) => ({
                          ...seg,
                          transitionIn: e.target.value as VideoSegment['transitionIn'],
                          transitionDurationSec: e.target.value === 'cut' ? 0 : 0.45,
                        }))
                      }
                      className="w-full px-2.5 py-1.5 text-xs bg-[#0D0E11] border border-[#2C313D] rounded text-[#F2EFE9]"
                    >
                      <option value="cut">Straight Cut (Default)</option>
                      <option value="dissolve">Dissolve</option>
                      <option value="fade_black">Fade from Black</option>
                      <option value="slide">Clean Slide</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="clip-speed" className="block text-[11px] text-[#9AA0AE] mb-1">
                      Playback Speed
                    </label>
                    <select
                      id="clip-speed"
                      value={selectedSegment.speed}
                      onChange={(e) =>
                        updateSegment(selectedSegment.id, (seg) => ({
                          ...seg,
                          speed: Number(e.target.value),
                        }))
                      }
                      className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#0D0E11] border border-[#2C313D] rounded text-[#F2EFE9]"
                    >
                      <option value={0.75}>0.75× Slow</option>
                      <option value={1}>1.0× Normal</option>
                      <option value={1.25}>1.25× Brisk</option>
                      <option value={1.5}>1.5× Fast</option>
                    </select>
                  </div>
                </div>

                {/* Clip Audio */}
                <div className="pt-2 border-t border-[#232730] space-y-2">
                  <div className="flex items-center justify-between">
                    <label htmlFor="clip-audio-mode" className="text-xs text-[#C8CDD8]">
                      Clip Audio
                    </label>
                    <select
                      id="clip-audio-mode"
                      value={selectedSegment.audioMode}
                      onChange={(e) =>
                        updateSegment(selectedSegment.id, (seg) => ({
                          ...seg,
                          audioMode: e.target.value as VideoSegment['audioMode'],
                        }))
                      }
                      className="px-2 py-1 text-xs bg-[#0D0E11] border border-[#2C313D] rounded text-[#F2EFE9]"
                    >
                      <option value="normal">Normal</option>
                      <option value="muted">Muted</option>
                      <option value="ducked">Ducked (-8 dB)</option>
                      <option value="boosted">Dialogue Boost (+3 dB)</option>
                    </select>
                  </div>
                </div>
              </div>
            ) : (
              /* TITLES, CAPTIONS & LOGO GRAPHICS */
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-[#F2EFE9]">Titles & Captions</h3>
                  <button
                    type="button"
                    onClick={() => {
                      if (!plan) return;
                      const nextCap = {
                        id: `cap_${Date.now().toString(36)}`,
                        startSec: Number(playheadSec.toFixed(1)),
                        endSec: Number(Math.min(totalDuration || 5, playheadSec + 3).toFixed(1)),
                        text: 'New caption cue',
                      };
                      onChangeEditPlan({ ...plan, captions: [...plan.captions, nextCap] });
                    }}
                    className="px-2 py-1 text-[11px] bg-[#1B1E25] border border-[#2C313D] text-[#F2EFE9] rounded hover:bg-[#252A36]"
                  >
                    + Add Caption
                  </button>
                </div>

                {/* Titles */}
                {plan?.titles.map((ttl) => (
                  <div key={ttl.id} className="p-3 bg-[#101216] border border-[#232730] rounded space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium capitalize text-[#D99B43]">
                        {ttl.kind.replace('_', ' ')}
                      </span>
                      <label className="inline-flex items-center gap-1.5 text-[11px] text-[#9AA0AE]">
                        <input
                          type="checkbox"
                          checked={ttl.enabled}
                          onChange={(e) =>
                            onChangeEditPlan({
                              ...plan,
                              titles: plan.titles.map((t) =>
                                t.id === ttl.id ? { ...t, enabled: e.target.checked } : t
                              ),
                            })
                          }
                          className="accent-[#D99B43]"
                        />
                        <span>Enabled</span>
                      </label>
                    </div>
                    <input
                      type="text"
                      value={ttl.text}
                      aria-label={`Title text for ${ttl.kind}`}
                      onChange={(e) =>
                        onChangeEditPlan({
                          ...plan,
                          titles: plan.titles.map((t) =>
                            t.id === ttl.id ? { ...t, text: e.target.value } : t
                          ),
                        })
                      }
                      className="w-full px-2.5 py-1.5 text-xs bg-[#0D0E11] border border-[#2C313D] rounded text-[#F2EFE9]"
                    />
                    <input
                      type="text"
                      value={ttl.subtext}
                      aria-label={`Subtitle text for ${ttl.kind}`}
                      onChange={(e) =>
                        onChangeEditPlan({
                          ...plan,
                          titles: plan.titles.map((t) =>
                            t.id === ttl.id ? { ...t, subtext: e.target.value } : t
                          ),
                        })
                      }
                      placeholder="Subtext"
                      className="w-full px-2.5 py-1.5 text-xs bg-[#0D0E11] border border-[#2C313D] rounded text-[#9AA0AE]"
                    />
                  </div>
                ))}

                {/* Timed Captions List */}
                <div className="space-y-2">
                  <p className="text-[11px] font-medium text-[#9AA0AE]">
                    Editable Timed Captions ({plan?.captions.length || 0})
                  </p>
                  {plan?.captions.map((cap) => (
                    <div key={cap.id} className="p-2.5 bg-[#101216] border border-[#232730] rounded space-y-1.5">
                      <div className="flex items-center justify-between text-[10px] font-mono tabular-nums text-[#9AA0AE]">
                        <span>
                          {formatShortDuration(cap.startSec)} → {formatShortDuration(cap.endSec)}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            onChangeEditPlan({
                              ...plan,
                              captions: plan.captions.filter((c) => c.id !== cap.id),
                            })
                          }
                          aria-label="Delete caption"
                          className="text-[#9AA0AE] hover:text-red-400"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                      <input
                        type="text"
                        value={cap.text}
                        onChange={(e) =>
                          onChangeEditPlan({
                            ...plan,
                            captions: plan.captions.map((c) =>
                              c.id === cap.id ? { ...c, text: e.target.value } : c
                            ),
                          })
                        }
                        className="w-full px-2 py-1 text-xs bg-[#0D0E11] border border-[#2C313D] rounded text-[#F2EFE9]"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Bottom Multitrack Timeline */}
      <section className="h-[278px] shrink-0 bg-[#111318] flex flex-col relative">
        {/* Timeline Toolbar */}
        <div className="px-4 py-1.5 border-b border-[#232730] flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={handleSplit}
              disabled={!activeSeg}
              title="Split segment at playhead"
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] bg-[#1B1E25] hover:bg-[#252A36] text-[#F2EFE9] rounded border border-[#2C313D] disabled:opacity-40"
            >
              <Scissors className="w-3 h-3" />
              <span>Split</span>
            </button>
            <button
              type="button"
              onClick={() => handleMove(-1)}
              disabled={!selectedSegment}
              title="Move selected clip left"
              className="px-2 py-1 text-[11px] bg-[#1B1E25] hover:bg-[#252A36] text-[#D1D5DF] rounded border border-[#2C313D] disabled:opacity-40"
            >
              Move Left
            </button>
            <button
              type="button"
              onClick={() => handleMove(1)}
              disabled={!selectedSegment}
              title="Move selected clip right"
              className="px-2 py-1 text-[11px] bg-[#1B1E25] hover:bg-[#252A36] text-[#D1D5DF] rounded border border-[#2C313D] disabled:opacity-40"
            >
              Move Right
            </button>
            <button
              type="button"
              onClick={handleDuplicateSegment}
              disabled={!selectedSegment}
              title="Duplicate selected clip"
              className="p-1.5 bg-[#1B1E25] hover:bg-[#252A36] text-[#D1D5DF] rounded border border-[#2C313D] disabled:opacity-40"
              aria-label="Duplicate selected clip"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() =>
                selectedSegment &&
                updateSegment(selectedSegment.id, (s) => ({
                  ...s,
                  audioMode: s.audioMode === 'muted' ? 'normal' : 'muted',
                }))
              }
              disabled={!selectedSegment}
              title="Mute or unmute selected clip"
              className="p-1.5 bg-[#1B1E25] hover:bg-[#252A36] text-[#D1D5DF] rounded border border-[#2C313D] disabled:opacity-40"
              aria-label="Toggle clip mute"
            >
              {selectedSegment?.audioMode === 'muted' ? (
                <VolumeX className="w-3.5 h-3.5 text-amber-400" />
              ) : (
                <Volume2 className="w-3.5 h-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={handleDeleteSegment}
              disabled={!selectedSegment}
              title="Remove selected clip from timeline (preserves original asset)"
              className="p-1.5 bg-[#1B1E25] hover:bg-red-950/50 text-[#D1D5DF] hover:text-red-300 rounded border border-[#2C313D] disabled:opacity-40"
              aria-label="Remove selected clip from timeline"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>

            {/* Narrative Beat Marker Controls */}
            <span aria-hidden="true" className="mx-1 h-4 w-px bg-[#272B35]" />
            <button
              type="button"
              onClick={() => openAddMarkerAt(playheadSec)}
              disabled={!plan}
              title="Add named narrative beat marker at playhead (Shortcut: M)"
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-[#1F1C16] hover:bg-[#2A241A] text-[#F2EFE9] rounded border border-[#D99B43]/55 disabled:opacity-40 transition-colors"
            >
              <Flag className="w-3 h-3 text-[#D99B43]" />
              <span>Add Marker</span>
            </button>
            <div className="inline-flex items-center rounded border border-[#2C313D] bg-[#1B1E25] overflow-hidden">
              <button
                type="button"
                disabled={markers.length === 0}
                onClick={() => handleJumpAdjacentMarker('prev')}
                title="Jump to previous marker ([)"
                aria-label="Jump to previous marker"
                className="px-1.5 py-1 text-[#D1D5DF] hover:bg-[#252A36] disabled:opacity-35"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="px-2 text-[10px] font-mono tabular-nums text-[#9AA0AE] border-x border-[#2C313D]">
                {markers.length} {markers.length === 1 ? 'beat' : 'beats'}
              </span>
              <button
                type="button"
                disabled={markers.length === 0}
                onClick={() => handleJumpAdjacentMarker('next')}
                title="Jump to next marker (])"
                aria-label="Jump to next marker"
                className="px-1.5 py-1 text-[#D1D5DF] hover:bg-[#252A36] disabled:opacity-35"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-[#9AA0AE]">
            <ZoomIn className="w-3.5 h-3.5" />
            <input
              type="range"
              min={28}
              max={110}
              value={timelineZoom}
              onChange={(e) => setTimelineZoom(Number(e.target.value))}
              aria-label="Timeline zoom"
              className="w-24 studio-slider"
            />
          </div>
        </div>

        {/* Inline Add / Edit Custom Marker Popover Bar */}
        {markerModalMode !== 'closed' && (
          <form
            onSubmit={handleSaveMarker}
            aria-label={markerModalMode === 'add' ? 'Add custom marker' : 'Edit custom marker'}
            className="absolute right-4 bottom-[244px] z-40 w-[440px] max-w-[calc(100vw-2rem)] rounded-md border border-[#343A47] bg-[#14161B] shadow-2xl p-3.5 space-y-2.5"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#F2EFE9]">
                <Flag className="w-3.5 h-3.5 text-[#D99B43]" />
                <span>{markerModalMode === 'add' ? 'Add Narrative Marker' : 'Edit Marker'}</span>
                <span className="font-mono text-[11px] text-[#D99B43] tabular-nums">
                  {formatTimecode(markerDraftTime, plan?.fps || 24)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMarkerModalMode('closed')}
                aria-label="Close marker editor"
                className="p-0.5 text-[#9AA0AE] hover:text-[#F2EFE9]"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-12 gap-2 items-center">
              <input
                type="text"
                autoFocus
                value={markerDraftName}
                onChange={(e) => setMarkerDraftName(e.target.value)}
                placeholder="Marker name (e.g. Opening Hook, Music Drop, Climax)"
                aria-label="Marker name"
                className="col-span-8 rounded border border-[#2C313D] bg-[#0D0E11] px-2.5 py-1.5 text-xs text-[#F2EFE9] placeholder:text-[#6C7280] focus:border-[#D99B43] focus:outline-none"
              />
              <div className="col-span-4 flex items-center justify-end gap-1.5" role="radiogroup" aria-label="Marker flag color">
                {MARKER_COLOR_PALETTE.map((c) => {
                  const selected = markerDraftColor === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setMarkerDraftColor(c.id)}
                      title={c.label}
                      aria-label={`Color ${c.label}`}
                      aria-checked={selected}
                      role="radio"
                      style={{ backgroundColor: c.hex }}
                      className={`w-4 h-4 rounded-sm transition-transform ${
                        selected ? 'ring-2 ring-[#F2EFE9] ring-offset-1 ring-offset-[#14161B] scale-110' : 'opacity-75 hover:opacity-100'
                      }`}
                    />
                  );
                })}
              </div>
            </div>

            <input
              type="text"
              value={markerDraftNote}
              onChange={(e) => setMarkerDraftNote(e.target.value)}
              placeholder="Optional beat note (e.g. cut on drum hit, check framing)"
              aria-label="Marker note"
              className="w-full rounded border border-[#232730] bg-[#0D0E11] px-2.5 py-1 text-[11px] text-[#D1D5DF] placeholder:text-[#6C7280] focus:border-[#D99B43] focus:outline-none"
            />

            <div className="flex items-center justify-between pt-0.5">
              {markerModalMode === 'edit' ? (
                <button
                  type="button"
                  onClick={handleDeleteSelectedMarker}
                  className="inline-flex items-center gap-1 text-[11px] text-red-400 hover:text-red-300"
                >
                  <Trash2 className="w-3 h-3" /> Delete Marker
                </button>
              ) : (
                <span className="text-[10px] text-[#6C7280]">
                  Tip: Double-click the Markers lane or press M
                </span>
              )}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setMarkerModalMode('closed')}
                  className="px-2.5 py-1 text-[11px] rounded border border-[#2C313D] bg-[#1B1E25] text-[#9AA0AE] hover:text-[#F2EFE9]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-1 text-[11px] font-semibold rounded bg-[#D99B43] hover:bg-[#E5AA54] text-[#0D0E11]"
                >
                  {markerModalMode === 'add' ? 'Save Marker' : 'Update Marker'}
                </button>
              </div>
            </div>
          </form>
        )}

        {/* Tracks Area */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Track Headers */}
          <div className="w-28 shrink-0 bg-[#14161B] border-r border-[#232730] text-[11px] font-mono text-[#9AA0AE] flex flex-col">
            <div className="h-7 border-b border-[#232730] px-2.5 flex items-center justify-between text-[10px] text-[#D99B43]">
              <span className="inline-flex items-center gap-1">
                <Flag className="w-2.5 h-2.5" /> Markers
              </span>
              <span className="text-[#6C7280] tabular-nums">{markers.length}</span>
            </div>
            <div className="h-6 border-b border-[#232730] px-2.5 flex items-center text-[10px] text-[#6C7280]">
              TC
            </div>
            <div className="h-14 border-b border-[#232730] px-2.5 flex items-center justify-between">
              <span className="text-[#F2EFE9]">V1 Video</span>
            </div>
            <div className="h-7 border-b border-[#232730] px-2.5 flex items-center">
              <span>T1 Titles</span>
            </div>
            <div className="h-7 border-b border-[#232730] px-2.5 flex items-center">
              <span>C1 Captions</span>
            </div>
            <div className="h-8 border-b border-[#232730] px-2.5 flex items-center">
              <span>A1 Audio</span>
            </div>
            <div className="h-8 px-2.5 flex items-center">
              <span>A2 Music</span>
            </div>
          </div>

          {/* Scrollable Track Lanes */}
          <div className="flex-1 overflow-x-auto overflow-y-hidden relative bg-[#0D0E11]">
            <div
              style={{ width: `${Math.max(920, (totalDuration + 4) * timelineZoom)}px` }}
              className="h-full relative"
            >
              {/* Custom Narrative Beat Markers Rail (Colored Flags Above Playhead Track) */}
              <div
                onDoubleClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = Math.max(0, e.clientX - rect.left);
                  openAddMarkerAt(Math.min(totalDuration, x / timelineZoom));
                }}
                title="Double-click anywhere on the Markers track to drop a named beat flag"
                className="h-7 border-b border-[#232730] bg-[#12141A] relative select-none"
              >
                {markers.length === 0 && (
                  <div className="h-full px-3 flex items-center text-[10px] text-[#6C7280] pointer-events-none">
                    Double-click here or press M to place colored narrative beat flags above the playhead
                  </div>
                )}
                {markers.map((mk) => {
                  const style = getMarkerColorStyle(mk.color);
                  const isSel = selectedMarkerId === mk.id;
                  const leftPx = mk.timeSec * timelineZoom;
                  return (
                    <button
                      key={mk.id}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        jumpToMarker(mk, true);
                      }}
                      title={`${mk.name} · ${formatTimecode(mk.timeSec, plan?.fps || 24)}${mk.note ? ` — ${mk.note}` : ''} (Click to jump & edit)`}
                      style={{ left: `${leftPx}px` }}
                      className={`group absolute top-0.5 bottom-0 -translate-x-[1px] ${isSel ? 'z-40' : 'z-30 hover:z-40'} flex items-start text-left focus:outline-none`}
                    >
                      {/* Vertical flag pole extending down onto playhead ruler */}
                      <span
                        style={{ backgroundColor: style.hex }}
                        className="w-[2px] h-full shrink-0 block"
                      />
                      {/* Colored pennant flag + label */}
                      <span
                        style={{
                          backgroundColor: style.hex,
                        }}
                        className={`inline-flex items-center gap-1 px-1.5 py-[2px] rounded-r-sm text-[10px] font-semibold leading-tight text-[#0D0E11] max-w-[132px] shadow-sm transition-transform ${
                          isSel ? 'ring-1 ring-[#F2EFE9]' : 'opacity-95 group-hover:opacity-100'
                        }`}
                      >
                        <Flag className="w-2.5 h-2.5 shrink-0 fill-current" />
                        <span className="truncate">{mk.name}</span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Ruler / Playhead Track */}
              <div
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = Math.max(0, e.clientX - rect.left);
                  setPlayheadSec(Number(Math.min(totalDuration, x / timelineZoom).toFixed(2)));
                }}
                className="h-6 border-b border-[#232730] bg-[#14161B] relative cursor-pointer"
              >
                {Array.from({ length: Math.ceil(totalDuration + 4) }).map((_, sec) => (
                  <div
                    key={sec}
                    style={{ left: `${sec * timelineZoom}px` }}
                    className="absolute top-0 bottom-0 border-l border-[#272B35] pl-1 text-[10px] font-mono tabular-nums text-[#6C7280] flex items-center"
                  >
                    {sec % 2 === 0 ? `${sec}s` : ''}
                  </div>
                ))}
                {/* Subtle colored marker tick indicators on the playhead ruler */}
                {markers.map((mk) => {
                  const style = getMarkerColorStyle(mk.color);
                  return (
                    <span
                      key={`tick_${mk.id}`}
                      aria-hidden="true"
                      style={{ left: `${mk.timeSec * timelineZoom}px`, backgroundColor: style.hex }}
                      className="pointer-events-none absolute top-0 bottom-0 w-[2px] opacity-55"
                    />
                  );
                })}
              </div>

              {/* V1 Video & Photo Stills Track */}
              <div className="h-14 border-b border-[#1E222B] relative">
                {segments.map((seg) => {
                  const asset = assetsById.get(seg.assetId);
                  const left = seg.timelineInSec * timelineZoom;
                  const width = Math.max(46, (seg.timelineOutSec - seg.timelineInSec) * timelineZoom - 2);
                  const isSel = selectedSegment?.id === seg.id;
                  const hasDr =
                    Math.abs(seg.color.exposure) > 0.01 ||
                    seg.color.highlights !== 0 ||
                    seg.color.shadows !== 0 ||
                    (seg.color.whites ?? 0) !== 0 ||
                    (seg.color.blacks ?? 0) !== 0;

                  return (
                    <button
                      key={seg.id}
                      type="button"
                      onClick={() => {
                        setSelectedSegId(seg.id);
                        setPlayheadSec(seg.timelineInSec + 0.05);
                      }}
                      style={{ left: `${left}px`, width: `${width}px` }}
                      className={`absolute top-1.5 bottom-1.5 rounded text-left overflow-hidden flex items-center gap-2 px-2 border transition-colors ${
                        isSel
                          ? 'bg-[#2B251B] border-[#D99B43] text-[#F2EFE9] z-10'
                          : seg.mediaKind === 'photo'
                            ? 'bg-[#1A2228] border-[#2C3A45] text-[#D1D5DF] hover:border-[#435666]'
                            : 'bg-[#1D212B] border-[#2E3444] text-[#D1D5DF] hover:border-[#454E66]'
                      }`}
                    >
                      {asset && (
                        <img
                          src={asset.thumbnailUrl}
                          alt=""
                          referrerPolicy="no-referrer"
                          className="w-8 h-8 rounded-sm object-cover shrink-0"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1">
                          {seg.mediaKind === 'photo' && (
                            <ImageIcon className="w-2.5 h-2.5 text-sky-400 shrink-0" />
                          )}
                          <span className="text-[11px] font-medium truncate">{seg.label}</span>
                        </div>
                        <div className="text-[10px] font-mono tabular-nums text-[#9AA0AE] truncate">
                          {(seg.timelineOutSec - seg.timelineInSec).toFixed(1)}s · {seg.reframe.mode}
                          {hasDr ? ' · DR' : ''}
                          {seg.locked ? ' · Locked' : ''}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* T1 Titles Track */}
              <div className="h-7 border-b border-[#1E222B] relative">
                {plan?.titles
                  .filter((t) => t.enabled)
                  .map((ttl) => (
                    <button
                      key={ttl.id}
                      type="button"
                      onClick={() => {
                        setPlayheadSec(ttl.startSec);
                        setInspectorTab('titles');
                      }}
                      style={{
                        left: `${ttl.startSec * timelineZoom}px`,
                        width: `${Math.max(40, (ttl.endSec - ttl.startSec) * timelineZoom - 2)}px`,
                      }}
                      className="absolute top-1 bottom-1 px-2 rounded-sm bg-[#272230] border border-[#443B56] text-[10px] text-[#E4DFF0] truncate text-left"
                    >
                      T · {ttl.text}
                    </button>
                  ))}
              </div>

              {/* C1 Captions Track */}
              <div className="h-7 border-b border-[#1E222B] relative">
                {plan?.captions.map((cap) => (
                  <button
                    key={cap.id}
                    type="button"
                    onClick={() => {
                      setPlayheadSec(cap.startSec);
                      setInspectorTab('titles');
                    }}
                    style={{
                      left: `${cap.startSec * timelineZoom}px`,
                      width: `${Math.max(36, (cap.endSec - cap.startSec) * timelineZoom - 2)}px`,
                    }}
                    className="absolute top-1 bottom-1 px-1.5 rounded-sm bg-[#1B2524] border border-[#2F4744] text-[10px] text-[#BFE3DE] truncate text-left"
                  >
                    CC · {cap.text}
                  </button>
                ))}
              </div>

              {/* A1 Dialogue / Native Clip Audio */}
              <div className="h-8 border-b border-[#1E222B] relative">
                {segments.map((seg) => (
                  <div
                    key={`a1_${seg.id}`}
                    style={{
                      left: `${seg.timelineInSec * timelineZoom}px`,
                      width: `${Math.max(30, (seg.timelineOutSec - seg.timelineInSec) * timelineZoom - 2)}px`,
                    }}
                    className={`absolute top-1 bottom-1 px-2 rounded-sm text-[10px] font-mono flex items-center truncate border ${
                      seg.audioMode === 'muted'
                        ? 'bg-[#15171D] border-[#232730] text-[#6C7280]'
                        : 'bg-[#17241D] border-[#264234] text-emerald-300'
                    }`}
                  >
                    {seg.audioMode === 'muted' ? 'Muted' : `${seg.label} (${seg.audioGainDb}dB)`}
                  </div>
                ))}
              </div>

              {/* A2 Music Track */}
              <div className="h-8 relative">
                {musicAsset ? (
                  <div
                    style={{ width: `${Math.max(120, totalDuration * timelineZoom)}px` }}
                    className="absolute top-1.5 bottom-1.5 left-0 px-2.5 rounded-sm bg-[#252017] border border-[#4A3D26] text-[10px] font-mono text-[#E8C589] flex items-center justify-between"
                  >
                    <span className="truncate">Music · {musicAsset.filename}</span>
                    <span>
                      {plan?.audioMix.musicGainDb}dB{plan?.audioMix.autoDucking ? ' · Auto-duck' : ''}
                    </span>
                  </div>
                ) : (
                  <div className="h-full px-3 flex items-center text-[10px] text-[#6C7280]">
                    No music track assigned — attach uploaded audio or generate with Lyria in Audio tab
                  </div>
                )}
              </div>

              {/* Vertical Playhead Line (starts at TC playhead track below Markers rail) */}
              <div
                style={{ left: `${playheadSec * timelineZoom}px` }}
                className="pointer-events-none absolute top-7 bottom-0 w-px bg-[#D99B43] z-20"
              >
                <div className="w-2.5 h-2.5 -ml-[4.5px] bg-[#D99B43] rotate-45 -mt-1" />
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
