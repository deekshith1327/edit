import React, { useMemo, useState } from 'react';
import {
  Archive,
  Copy,
  Edit3,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Layers,
  LogOut,
  Plus,
  Search,
  Settings,
  Trash2,
} from 'lucide-react';
import { BrandMark } from './BrandMark';
import { formatShortDuration } from '../shared/timeline';
import type { Project, ProjectStatus, ProjectType, User } from '../shared/types';

interface ProjectDashboardProps {
  user: User;
  projects: Project[];
  loading: boolean;
  onOpenProject: (projectId: string) => void;
  onNewProject: () => void;
  onRenameProject: (projectId: string, newName: string) => Promise<void>;
  onDuplicateProject: (projectId: string) => Promise<void>;
  onArchiveProject: (projectId: string, archive: boolean) => Promise<void>;
  onDeleteProject: (projectId: string) => Promise<void>;
  onOpenSettings: () => void;
  onSignOut: () => void;
}

const STATUS_LABELS: Record<ProjectStatus, { label: string; colorClass: string }> = {
  draft: { label: 'Draft', colorClass: 'text-[#9AA0AE]' },
  uploading: { label: 'Uploading', colorClass: 'text-sky-400' },
  analyzing: { label: 'Analyzing', colorClass: 'text-[#D99B43]' },
  editing: { label: 'In Edit', colorClass: 'text-[#F2EFE9]' },
  rendering: { label: 'Rendering', colorClass: 'text-[#D99B43]' },
  completed: { label: 'Completed', colorClass: 'text-emerald-400' },
  failed: { label: 'Needs Attention', colorClass: 'text-red-400' },
  archived: { label: 'Archived', colorClass: 'text-[#6C7280]' },
};

export const ProjectDashboard: React.FC<ProjectDashboardProps> = ({
  user,
  projects,
  loading,
  onOpenProject,
  onNewProject,
  onRenameProject,
  onDuplicateProject,
  onArchiveProject,
  onDeleteProject,
  onOpenSettings,
  onSignOut,
}) => {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | ProjectType>('all');
  const [statusFilter, setStatusFilter] = useState<'active' | 'all' | 'completed' | 'archived'>('active');
  const [sortBy, setSortBy] = useState<'updated' | 'name' | 'assets'>('updated');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects
      .filter((p) => {
        if (typeFilter !== 'all' && p.type !== typeFilter) return false;
        if (statusFilter === 'active' && p.status === 'archived') return false;
        if (statusFilter === 'completed' && p.status !== 'completed') return false;
        if (statusFilter === 'archived' && p.status !== 'archived') return false;
        if (q && !p.name.toLowerCase().includes(q) && !p.brief.purpose.toLowerCase().includes(q)) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'name') return a.name.localeCompare(b.name);
        if (sortBy === 'assets') return b.assetCount - a.assetCount;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
  }, [projects, search, typeFilter, statusFilter, sortBy]);

  const submitRename = async (id: string) => {
    if (!renameValue.trim()) {
      setRenamingId(null);
      return;
    }
    setActionBusy(true);
    try {
      await onRenameProject(id, renameValue.trim());
      setRenamingId(null);
    } finally {
      setActionBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setActionBusy(true);
    try {
      await onDeleteProject(deleteTarget.id);
      setDeleteTarget(null);
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0D0E11] text-[#F2EFE9] flex flex-col">
      {/* Studio Dashboard Header */}
      <header className="sticky top-0 z-20 border-b border-[#232730] bg-[#111318]">
        <div className="max-w-[1400px] mx-auto px-6 h-15 flex items-center justify-between gap-6">
          <div className="flex items-center gap-3 min-w-0">
            <BrandMark size={22} />
            <span className="font-semibold text-base tracking-tight whitespace-nowrap">
              Frameflow Studio
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span className="hidden sm:inline text-xs text-[#9AA0AE]">
              {user.name} · {user.role}
            </span>
            <button
              type="button"
              onClick={onOpenSettings}
              aria-label="Account and storage settings"
              className="p-2 text-[#9AA0AE] hover:text-[#F2EFE9] hover:bg-[#1C2029] rounded-md transition-colors"
            >
              <Settings className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onSignOut}
              aria-label="Sign out"
              className="p-2 text-[#9AA0AE] hover:text-[#F2EFE9] hover:bg-[#1C2029] rounded-md transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onNewProject}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-[#D99B43] text-[#0D0E11] rounded-md hover:bg-[#E5AA54] transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>New project</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[1400px] w-full mx-auto px-6 py-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-[#F2EFE9]">Projects</h1>
            <p className="text-sm text-[#9AA0AE] mt-1">
              Open a workspace to review AI edits, adjust reframing and color, or export finished deliverables.
            </p>
          </div>
          <p className="text-xs text-[#9AA0AE] tabular-nums">
            {filtered.length} of {projects.length} project{projects.length === 1 ? '' : 's'}
          </p>
        </div>

        {/* Search, Filter & Sort Toolbar */}
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 pb-6 border-b border-[#232730]">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-[#6C7280] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search projects by title or purpose…"
              aria-label="Search projects"
              className="w-full pl-9 pr-3 py-2 text-sm bg-[#14161B] border border-[#272B35] rounded-md text-[#F2EFE9] placeholder:text-[#6C7280] focus:border-[#D99B43] focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 p-1 bg-[#14161B] border border-[#272B35] rounded-md">
              {(['all', 'mixed', 'video', 'photo'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTypeFilter(t)}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                    typeFilter === t
                      ? 'bg-[#252A36] text-[#F2EFE9]'
                      : 'text-[#9AA0AE] hover:text-[#F2EFE9]'
                  }`}
                >
                  {t === 'all' ? 'All types' : t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 p-1 bg-[#14161B] border border-[#272B35] rounded-md">
              {(['active', 'completed', 'archived', 'all'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(s)}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                    statusFilter === s
                      ? 'bg-[#252A36] text-[#F2EFE9]'
                      : 'text-[#9AA0AE] hover:text-[#F2EFE9]'
                  }`}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'updated' | 'name' | 'assets')}
              aria-label="Sort projects"
              className="px-3 py-1.5 text-xs bg-[#14161B] border border-[#272B35] rounded-md text-[#D1D5DF] focus:border-[#D99B43] focus:outline-none"
            >
              <option value="updated">Sort: Last edited</option>
              <option value="name">Sort: Title (A–Z)</option>
              <option value="assets">Sort: Media count</option>
            </select>
          </div>
        </div>

        {/* Loading Skeletons */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mt-6">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="bg-[#14161B] border border-[#272B35] rounded-lg overflow-hidden animate-pulse"
              >
                <div className="aspect-video bg-[#1B1E25]" />
                <div className="p-4 space-y-2.5">
                  <div className="h-4 bg-[#222630] rounded w-2/3" />
                  <div className="h-3 bg-[#1B1E25] rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          /* Empty State */
          <div className="mt-12 py-16 px-6 text-center bg-[#14161B] border border-[#272B35] rounded-lg max-w-xl mx-auto">
            <FolderOpen className="w-9 h-9 text-[#6C7280] mx-auto mb-3" />
            <h2 className="text-base font-semibold text-[#F2EFE9] mb-1">
              {projects.length === 0 ? 'Start your first studio project' : 'No projects match these filters'}
            </h2>
            <p className="text-sm text-[#9AA0AE] mb-6">
              {projects.length === 0
                ? 'Create a video, photo collection, or mixed project, upload source media, and let Frameflow build an editable first cut.'
                : 'Adjust your search query or status filter to view other projects.'}
            </p>
            <button
              type="button"
              onClick={onNewProject}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-[#D99B43] text-[#0D0E11] rounded-md hover:bg-[#E5AA54] transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Create new project</span>
            </button>
          </div>
        ) : (
          /* Project Grid */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mt-6">
            {filtered.map((project) => {
              const statusInfo = STATUS_LABELS[project.status] || STATUS_LABELS.draft;
              const isRenaming = renamingId === project.id;
              return (
                <article
                  key={project.id}
                  className="bg-[#14161B] border border-[#272B35] rounded-lg overflow-hidden flex flex-col hover:border-[#3A404F] transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => onOpenProject(project.id)}
                    className="relative aspect-video bg-[#0B0C0F] overflow-hidden text-left group"
                    aria-label={`Open project ${project.name}`}
                  >
                    {project.thumbnailUrl ? (
                      <img
                        src={project.thumbnailUrl}
                        alt={`Thumbnail for ${project.name}`}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-[#6C7280] gap-2">
                        {project.type === 'photo' ? (
                          <ImageIcon className="w-7 h-7" />
                        ) : project.type === 'video' ? (
                          <Film className="w-7 h-7" />
                        ) : (
                          <Layers className="w-7 h-7" />
                        )}
                        <span className="text-xs">No media uploaded yet</span>
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/80 to-transparent" />
                    <div className="absolute bottom-2.5 left-3 right-3 flex items-center justify-between text-[11px] font-mono tabular-nums text-[#E4E6EC]">
                      <span>{project.brief.aspectRatio}</span>
                      <span>
                        {project.estimatedDurationSec > 0
                          ? formatShortDuration(project.estimatedDurationSec)
                          : `${project.photoCount} photo${project.photoCount === 1 ? '' : 's'}`}
                      </span>
                    </div>
                  </button>

                  <div className="p-4 flex-1 flex flex-col">
                    {isRenaming ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void submitRename(project.id);
                        }}
                        className="flex items-center gap-2 mb-2"
                      >
                        <input
                          type="text"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          autoFocus
                          aria-label="New project title"
                          className="flex-1 px-2.5 py-1 text-sm bg-[#0D0E11] border border-[#D99B43] rounded text-[#F2EFE9] focus:outline-none"
                        />
                        <button
                          type="submit"
                          disabled={actionBusy}
                          className="px-2.5 py-1 text-xs font-medium bg-[#D99B43] text-[#0D0E11] rounded"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setRenamingId(null)}
                          className="px-2 py-1 text-xs text-[#9AA0AE] hover:text-[#F2EFE9]"
                        >
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <h2 className="text-base font-semibold text-[#F2EFE9] truncate mb-1">
                        {project.name}
                      </h2>
                    )}

                    {/* Clean unboxed metadata (Zero-Pill discipline) */}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#9AA0AE] mb-4">
                      <span className={statusInfo.colorClass}>{statusInfo.label}</span>
                      <span aria-hidden="true">·</span>
                      <span className="capitalize">{project.type}</span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">
                        {project.videoCount}v / {project.photoCount}p
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">
                        {new Date(project.updatedAt).toLocaleDateString()}
                      </span>
                    </div>

                    <div className="mt-auto pt-3 border-t border-[#222630] flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => onOpenProject(project.id)}
                        className="px-3 py-1.5 text-xs font-medium bg-[#1F232D] hover:bg-[#2A2F3D] text-[#F2EFE9] rounded transition-colors"
                      >
                        Open workspace
                      </button>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingId(project.id);
                            setRenameValue(project.name);
                          }}
                          aria-label={`Rename ${project.name}`}
                          title="Rename"
                          className="p-1.5 text-[#9AA0AE] hover:text-[#F2EFE9] hover:bg-[#1F232D] rounded transition-colors"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void onDuplicateProject(project.id)}
                          aria-label={`Duplicate ${project.name}`}
                          title="Duplicate"
                          className="p-1.5 text-[#9AA0AE] hover:text-[#F2EFE9] hover:bg-[#1F232D] rounded transition-colors"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void onArchiveProject(project.id, project.status !== 'archived')
                          }
                          aria-label={
                            project.status === 'archived'
                              ? `Unarchive ${project.name}`
                              : `Archive ${project.name}`
                          }
                          title={project.status === 'archived' ? 'Restore from archive' : 'Archive'}
                          className="p-1.5 text-[#9AA0AE] hover:text-[#F2EFE9] hover:bg-[#1F232D] rounded transition-colors"
                        >
                          <Archive className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(project)}
                          aria-label={`Delete ${project.name}`}
                          title="Delete project"
                          className="p-1.5 text-[#9AA0AE] hover:text-red-400 hover:bg-red-950/40 rounded transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>

      {/* Accessible Delete Confirmation Dialog */}
      {deleteTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-project-title"
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md bg-[#14161B] border border-[#323744] rounded-lg p-6">
            <h2 id="delete-project-title" className="text-base font-semibold text-[#F2EFE9] mb-2">
              Delete "{deleteTarget.name}"?
            </h2>
            <p className="text-sm text-[#9AA0AE] mb-6">
              This removes the project timeline, edit recipes, and revision history. Any downloaded
              exports remain on your device.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-xs font-medium text-[#D1D5DF] hover:text-[#F2EFE9] bg-[#1B1E25] rounded-md"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => void confirmDelete()}
                className="px-4 py-2 text-xs font-semibold bg-red-600 text-white rounded-md hover:bg-red-500 disabled:opacity-60"
              >
                {actionBusy ? 'Deleting…' : 'Delete project'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
