import type { ColorGrade, EditPlan, MarkerColor, TimelineMarker, VideoSegment } from './types';

export function defaultColorGrade(look: ColorGrade['look'] = 'natural_clean'): ColorGrade {
  return {
    look,
    lookIntensity: 65,
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    temperature: 0,
    tint: 0,
    saturation: 0,
    vibrance: 0,
  };
}

/**
 * Formats seconds to professional SMPTE timecode HH:MM:SS:FF.
 */
export function formatTimecode(seconds: number, fps = 24): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const totalFrames = Math.round(safe * fps);
  const frames = totalFrames % fps;
  const totalSecs = Math.floor(totalFrames / fps);
  const secs = totalSecs % 60;
  const totalMins = Math.floor(totalSecs / 60);
  const mins = totalMins % 60;
  const hours = Math.floor(totalMins / 60);

  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(mins)}:${pad(secs)}:${pad(frames)}`;
}

export function formatShortDuration(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/**
 * Recalculates contiguous timeline in/out markers cleanly after any trim, split, reorder, or delete.
 */
export function rippleRecalculateTimeline(segments: VideoSegment[]): VideoSegment[] {
  let cursor = 0;
  return segments.map((seg) => {
    const speed = Math.max(0.25, Math.min(4, seg.speed || 1));
    const rawDuration = Math.max(0.5, seg.sourceOutSec - seg.sourceInSec);
    const effectiveDuration = Number((rawDuration / speed).toFixed(3));
    const updated: VideoSegment = {
      ...seg,
      timelineInSec: Number(cursor.toFixed(3)),
      timelineOutSec: Number((cursor + effectiveDuration).toFixed(3)),
    };
    cursor += effectiveDuration;
    return updated;
  });
}

export function getTotalTimelineDuration(segments: VideoSegment[]): number {
  if (segments.length === 0) return 0;
  const last = segments[segments.length - 1];
  return Number(Math.max(0, last.timelineOutSec).toFixed(3));
}

export function findSegmentAtTime(
  segments: VideoSegment[],
  timeSec: number
): { segment: VideoSegment; index: number; localOffsetSec: number; progress: number } | null {
  if (segments.length === 0) return null;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (timeSec >= seg.timelineInSec && timeSec <= seg.timelineOutSec + 0.001) {
      const duration = Math.max(0.001, seg.timelineOutSec - seg.timelineInSec);
      const localOffsetSec = Math.max(0, Math.min(duration, timeSec - seg.timelineInSec));
      return {
        segment: seg,
        index: i,
        localOffsetSec,
        progress: localOffsetSec / duration,
      };
    }
  }
  const last = segments[segments.length - 1];
  const duration = Math.max(0.001, last.timelineOutSec - last.timelineInSec);
  return {
    segment: last,
    index: segments.length - 1,
    localOffsetSec: duration,
    progress: 1,
  };
}

/**
 * Splits a segment at a timeline playhead position (must leave >= 0.5s on both sides).
 */
export function splitSegmentAtTime(
  segments: VideoSegment[],
  segmentId: string,
  playheadSec: number
): VideoSegment[] {
  const idx = segments.findIndex((s) => s.id === segmentId);
  if (idx === -1) return segments;

  const target = segments[idx];
  const offset = playheadSec - target.timelineInSec;
  const totalDur = target.timelineOutSec - target.timelineInSec;

  if (offset < 0.5 || totalDur - offset < 0.5) {
    return segments;
  }

  const speed = target.speed || 1;
  const splitSourceSec = Number((target.sourceInSec + offset * speed).toFixed(3));

  const left: VideoSegment = {
    ...target,
    sourceOutSec: splitSourceSec,
  };

  const right: VideoSegment = {
    ...target,
    id: `${target.id}_b_${Date.now().toString(36)}`,
    label: `${target.label} (Part 2)`,
    sourceInSec: splitSourceSec,
    transitionIn: 'cut',
    locked: false,
  };

  const next = [...segments];
  next.splice(idx, 1, left, right);
  return rippleRecalculateTimeline(next);
}

/**
 * Reorders a segment from oldIndex to newIndex and recalculates contiguous timecodes.
 */
export function reorderSegments(
  segments: VideoSegment[],
  fromIndex: number,
  toIndex: number
): VideoSegment[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= segments.length ||
    toIndex >= segments.length ||
    fromIndex === toIndex
  ) {
    return segments;
  }
  const copy = [...segments];
  const [moved] = copy.splice(fromIndex, 1);
  copy.splice(toIndex, 0, moved);
  return rippleRecalculateTimeline(copy);
}

/**
 * Trims a segment's in/out points safely within source bounds.
 */
export function trimSegment(
  segments: VideoSegment[],
  segmentId: string,
  newSourceInSec: number,
  newSourceOutSec: number,
  maxSourceDurationSec: number
): VideoSegment[] {
  const next = segments.map((seg) => {
    if (seg.id !== segmentId) return seg;
    const maxDur = seg.mediaKind === 'photo' ? 20 : Math.max(1, maxSourceDurationSec);
    const clampedIn = Math.max(0, Math.min(newSourceInSec, maxDur - 0.5));
    const clampedOut = Math.max(clampedIn + 0.5, Math.min(newSourceOutSec, maxDur));
    return {
      ...seg,
      sourceInSec: Number(clampedIn.toFixed(2)),
      sourceOutSec: Number(clampedOut.toFixed(2)),
    };
  });
  return rippleRecalculateTimeline(next);
}

/**
 * Merges a regenerated AI plan while strictly preserving user-locked segments.
 */
export function mergeLockedSegments(
  existingPlan: EditPlan | null,
  candidatePlan: EditPlan
): EditPlan {
  if (!existingPlan) return candidatePlan;
  const lockedByAsset = new Map<string, VideoSegment>();
  for (const seg of existingPlan.segments) {
    if (seg.locked) {
      lockedByAsset.set(seg.assetId, seg);
    }
  }
  if (lockedByAsset.size === 0) return candidatePlan;

  const merged: VideoSegment[] = [];
  const usedLocked = new Set<string>();

  for (const seg of candidatePlan.segments) {
    const locked = lockedByAsset.get(seg.assetId);
    if (locked && !usedLocked.has(locked.id)) {
      merged.push(locked);
      usedLocked.add(locked.id);
    } else {
      merged.push(seg);
    }
  }

  // Ensure any locked segments omitted by regeneration stay preserved
  for (const seg of existingPlan.segments) {
    if (seg.locked && !usedLocked.has(seg.id)) {
      merged.push(seg);
    }
  }

  return {
    ...candidatePlan,
    segments: rippleRecalculateTimeline(merged),
    markers: existingPlan.markers ? [...existingPlan.markers] : candidatePlan.markers || [],
  };
}

export const MARKER_COLOR_PALETTE: Array<{
  id: MarkerColor;
  label: string;
  hex: string;
  bgClass: string;
  borderClass: string;
  textClass: string;
}> = [
  {
    id: 'amber',
    label: 'Amber',
    hex: '#D99B43',
    bgClass: 'bg-[#D99B43]',
    borderClass: 'border-[#E6B366]',
    textClass: 'text-[#0D0E11]',
  },
  {
    id: 'emerald',
    label: 'Emerald',
    hex: '#34D399',
    bgClass: 'bg-emerald-400',
    borderClass: 'border-emerald-300',
    textClass: 'text-[#0D0E11]',
  },
  {
    id: 'sky',
    label: 'Sky',
    hex: '#38BDF8',
    bgClass: 'bg-sky-400',
    borderClass: 'border-sky-300',
    textClass: 'text-[#0D0E11]',
  },
  {
    id: 'rose',
    label: 'Rose',
    hex: '#FB7185',
    bgClass: 'bg-rose-400',
    borderClass: 'border-rose-300',
    textClass: 'text-[#0D0E11]',
  },
  {
    id: 'violet',
    label: 'Violet',
    hex: '#A78BFA',
    bgClass: 'bg-violet-400',
    borderClass: 'border-violet-300',
    textClass: 'text-[#0D0E11]',
  },
];

export function getMarkerColorStyle(color: MarkerColor) {
  return MARKER_COLOR_PALETTE.find((c) => c.id === color) || MARKER_COLOR_PALETTE[0];
}

export function sortTimelineMarkers(markers: TimelineMarker[]): TimelineMarker[] {
  return [...markers].sort((a, b) => a.timeSec - b.timeSec || a.id.localeCompare(b.id));
}

export function addTimelineMarker(
  markers: TimelineMarker[],
  input: { timeSec: number; name?: string; color?: MarkerColor; note?: string; id?: string },
  maxDurationSec: number
): { markers: TimelineMarker[]; created: TimelineMarker } {
  const safeMax = Math.max(0, Number.isFinite(maxDurationSec) ? maxDurationSec : 0);
  const clampedTime = Number(
    Math.max(0, Math.min(safeMax > 0 ? safeMax : input.timeSec, input.timeSec)).toFixed(2)
  );
  const trimmedName = (input.name || '').trim() || `Beat ${markers.length + 1}`;
  const created: TimelineMarker = {
    id: input.id || `mk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    timeSec: clampedTime,
    name: trimmedName.slice(0, 64),
    color: input.color || 'amber',
    note: input.note?.trim() ? input.note.trim().slice(0, 200) : undefined,
  };
  return {
    markers: sortTimelineMarkers([...markers, created]),
    created,
  };
}

export function updateTimelineMarker(
  markers: TimelineMarker[],
  markerId: string,
  patch: Partial<Pick<TimelineMarker, 'name' | 'color' | 'note' | 'timeSec'>>,
  maxDurationSec: number
): TimelineMarker[] {
  const safeMax = Math.max(0, Number.isFinite(maxDurationSec) ? maxDurationSec : 0);
  const next = markers.map((m) => {
    if (m.id !== markerId) return m;
    const nextTime =
      patch.timeSec !== undefined
        ? Number(Math.max(0, Math.min(safeMax > 0 ? safeMax : patch.timeSec, patch.timeSec)).toFixed(2))
        : m.timeSec;
    const nextName =
      patch.name !== undefined ? patch.name.trim().slice(0, 64) || m.name : m.name;
    const nextNote =
      patch.note !== undefined ? patch.note.trim().slice(0, 200) || undefined : m.note;
    return {
      ...m,
      timeSec: nextTime,
      name: nextName,
      color: patch.color ?? m.color,
      note: nextNote,
    };
  });
  return sortTimelineMarkers(next);
}

export function deleteTimelineMarker(markers: TimelineMarker[], markerId: string): TimelineMarker[] {
  return markers.filter((m) => m.id !== markerId);
}

export function findAdjacentMarker(
  markers: TimelineMarker[],
  playheadSec: number,
  direction: 'prev' | 'next'
): TimelineMarker | null {
  if (markers.length === 0) return null;
  const sorted = sortTimelineMarkers(markers);
  const eps = 0.05;
  if (direction === 'next') {
    return sorted.find((m) => m.timeSec > playheadSec + eps) || sorted[0];
  }
  const earlier = sorted.filter((m) => m.timeSec < playheadSec - eps);
  return earlier.length > 0 ? earlier[earlier.length - 1] : sorted[sorted.length - 1];
}
