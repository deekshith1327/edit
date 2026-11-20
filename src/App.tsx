/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { api } from './api/client';
import { LandingPage } from './components/LandingPage';
import { AuthView } from './components/AuthView';
import { ProjectDashboard } from './components/ProjectDashboard';
import { NewProjectModal } from './components/NewProjectModal';
import { WorkspaceShell } from './components/workspace/WorkspaceShell';
import { SettingsModal } from './components/workspace/SettingsModal';
import type { CreativeBrief, Project, ProjectType, ProviderStatus, User } from './shared/types';

type AppRoute = 'landing' | 'auth' | 'dashboard' | 'workspace';

export default function App() {
  const [route, setRoute] = useState<AppRoute>('landing');
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [user, setUser] = useState<User | null>(null);
  const [storageUsedBytes, setStorageUsedBytes] = useState(0);
  const [storageQuotaBytes, setStorageQuotaBytes] = useState(2 * 1024 * 1024 * 1024);
  const [storageBreakdown, setStorageBreakdown] = useState<Record<string, number>>({});
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [settingsProject, setSettingsProject] = useState<Project | null>(null);

  const [showNewProject, setShowNewProject] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);

  const refreshMeAndStorage = useCallback(async () => {
    const me = await api.getMe();
    setUser(me.user);
    if (me.storageUsedBytes !== undefined) setStorageUsedBytes(me.storageUsedBytes);
    if (me.storageQuotaBytes !== undefined) setStorageQuotaBytes(me.storageQuotaBytes);
    if (me.storageBreakdown) setStorageBreakdown(me.storageBreakdown);
    return me.user;
  }, []);

  const refreshProjects = useCallback(async () => {
    setProjectsLoading(true);
    try {
      const res = await api.listProjects();
      setProjects(res.projects);
      return res.projects;
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [statusRes, meUser] = await Promise.all([
          api.getProviderStatus().catch(() => null),
          refreshMeAndStorage().catch(() => null),
        ]);
        if (!active) return;
        if (statusRes) setProviderStatus(statusRes);

        const params = new URLSearchParams(window.location.search);
        const autostart = params.get('autostart');

        if (meUser) {
          const list = await refreshProjects();
          if (!active) return;
          if (autostart === 'project' && list.length > 0) {
            setActiveProjectId(list[0].id);
            setRoute('workspace');
          } else {
            setRoute('dashboard');
          }
        } else if (autostart) {
          const demoRes = await api.signInDemo();
          if (!active) return;
          setUser(demoRes.user);
          await refreshMeAndStorage();
          const list = await refreshProjects();
          if (!active) return;
          if (autostart === 'project' && list.length > 0) {
            setActiveProjectId(list[0].id);
            setRoute('workspace');
          } else {
            setRoute('dashboard');
          }
        }
      } finally {
        if (active) setBootstrapping(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshMeAndStorage, refreshProjects]);

  const handleLaunchDemo = async () => {
    setDemoLoading(true);
    setLaunchError(null);
    try {
      const res = await api.signInDemo();
      setUser(res.user);
      await refreshMeAndStorage();
      await refreshProjects();
      setRoute('dashboard');
    } catch (err) {
      setLaunchError(
        err instanceof Error
          ? err.message
          : 'Unable to open the studio session. Please try again.'
      );
    } finally {
      setDemoLoading(false);
    }
  };

  const handleAuthenticated = async (authedUser: User) => {
    setLaunchError(null);
    setUser(authedUser);
    await refreshMeAndStorage();
    await refreshProjects();
    setRoute('dashboard');
  };

  const handleSignOut = async () => {
    await api.signOut();
    setUser(null);
    setProjects([]);
    setActiveProjectId(null);
    setRoute('landing');
  };

  const handleCreateProject = async (payload: {
    name: string;
    type: ProjectType;
    brief: Partial<CreativeBrief>;
  }) => {
    const res = await api.createProject(payload);
    setShowNewProject(false);
    await refreshProjects();
    setActiveProjectId(res.project.id);
    setRoute('workspace');
  };

  const handleRenameProject = async (projectId: string, newName: string) => {
    await api.updateProject(projectId, { name: newName });
    await refreshProjects();
  };

  const handleDuplicateProject = async (projectId: string) => {
    await api.duplicateProject(projectId);
    await refreshProjects();
  };

  const handleArchiveProject = async (projectId: string, archive: boolean) => {
    await api.updateProject(projectId, { status: archive ? 'archived' : 'editing' });
    await refreshProjects();
  };

  const handleDeleteProject = async (projectId: string) => {
    await api.deleteProject(projectId);
    await refreshProjects();
    await refreshMeAndStorage();
  };

  if (bootstrapping) {
    return (
      <div className="min-h-screen bg-[#0D0E11] text-[#9AA0AE] flex items-center justify-center text-xs">
        Initializing Frameflow Studio…
      </div>
    );
  }

  return (
    <>
      {route === 'landing' && (
        <LandingPage
          onLaunchDemo={handleLaunchDemo}
          onOpenAuth={(mode) => {
            setLaunchError(null);
            setAuthMode(mode);
            setRoute('auth');
          }}
          demoLoading={demoLoading}
          launchError={launchError}
        />
      )}

      {route === 'auth' && (
        <AuthView
          initialMode={authMode}
          onAuthenticated={handleAuthenticated}
          onBack={() => setRoute('landing')}
        />
      )}

      {route === 'dashboard' && user && (
        <ProjectDashboard
          user={user}
          projects={projects}
          loading={projectsLoading}
          onOpenProject={(id) => {
            setActiveProjectId(id);
            setRoute('workspace');
          }}
          onNewProject={() => setShowNewProject(true)}
          onRenameProject={handleRenameProject}
          onDuplicateProject={handleDuplicateProject}
          onArchiveProject={handleArchiveProject}
          onDeleteProject={handleDeleteProject}
          onOpenSettings={() => {
            setSettingsProject(null);
            setShowSettings(true);
            refreshMeAndStorage();
          }}
          onSignOut={handleSignOut}
        />
      )}

      {route === 'workspace' && user && activeProjectId && (
        <WorkspaceShell
          projectId={activeProjectId}
          providerStatus={providerStatus}
          onBackToDashboard={() => {
            setRoute('dashboard');
            refreshProjects();
          }}
          onOpenSettings={(proj) => {
            setSettingsProject(proj);
            setShowSettings(true);
            refreshMeAndStorage();
          }}
          onProjectMutated={() => {
            refreshProjects();
            refreshMeAndStorage();
          }}
        />
      )}

      {showNewProject && (
        <NewProjectModal
          onClose={() => setShowNewProject(false)}
          onCreate={handleCreateProject}
        />
      )}

      {showSettings && user && (
        <SettingsModal
          user={user}
          storageUsedBytes={storageUsedBytes}
          storageQuotaBytes={storageQuotaBytes}
          storageBreakdown={storageBreakdown}
          providerStatus={providerStatus}
          activeProject={settingsProject}
          onUserUpdated={(updated) => setUser(updated)}
          onUpdateBrief={
            settingsProject
              ? async (patch) => {
                  await api.updateProject(settingsProject.id, { brief: patch });
                  await refreshProjects();
                }
              : undefined
          }
          onClose={() => setShowSettings(false)}
        />
      )}
    </>
  );
}
