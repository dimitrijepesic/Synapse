import { useEffect, useState } from 'react';
import { API_BASE } from '../../types/api';

function fullNameFromUrl(url) {
  if (!url) return null;
  const m = url.match(/github\.com[/:]([^/]+)\/([^/?#.]+)/i);
  if (!m) return null;
  return `${m[1]}/${m[2].replace(/\.git$/, '')}`;
}

function timeAgo(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  const now = Date.now();
  const sec = Math.max(0, Math.floor((now - then) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 14) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function RepoFooter({ project, graphId, onReloaded }) {
  const [repoFullName, setRepoFullName] = useState(() => fullNameFromUrl(project?.repoUrl));
  const [repoUrl, setRepoUrl] = useState(project?.repoUrl || null);
  const [commit, setCommit] = useState(null);
  const [commitError, setCommitError] = useState(null);
  const [reloading, setReloading] = useState(false);
  const [reloadError, setReloadError] = useState(null);

  // If project doesn't carry repoUrl (e.g. after page reload), pull it from the backend.
  useEffect(() => {
    let cancelled = false;
    if (repoFullName) return;
    if (!graphId) return;
    fetch(`${API_BASE}/graph/${graphId}/repo-info`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        if (data.repo_url) setRepoUrl(data.repo_url);
        if (data.repo_full_name) setRepoFullName(data.repo_full_name);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [graphId, repoFullName]);

  // Sync if project prop changes (e.g. after a reload)
  useEffect(() => {
    if (project?.repoUrl && project.repoUrl !== repoUrl) {
      setRepoUrl(project.repoUrl);
      setRepoFullName(fullNameFromUrl(project.repoUrl));
    }
  }, [project?.repoUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch latest commit info when we know the repo
  useEffect(() => {
    if (!repoFullName) return;
    let cancelled = false;
    setCommitError(null);
    fetch(`${API_BASE}/auth/github/last-commit?repo=${encodeURIComponent(repoFullName)}`, {
      credentials: 'include',
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data) => { if (!cancelled) setCommit(data); })
      .catch(() => { if (!cancelled) setCommitError('Could not load commit info'); });
    return () => { cancelled = true; };
  }, [repoFullName]);

  const handleReload = async () => {
    if (!repoUrl) return;
    const ok = window.confirm(
      `Re-fetch and re-analyze ${repoFullName || repoUrl}? This will discard the cached graph and rebuild it from the latest commit.`
    );
    if (!ok) return;
    setReloading(true);
    setReloadError(null);
    try {
      const res = await fetch(`${API_BASE}/analyze`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo_url: repoUrl, force: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `Server error ${res.status}`);
      }
      const data = await res.json();
      // Refresh commit info after reload completes
      if (repoFullName) {
        fetch(`${API_BASE}/auth/github/last-commit?repo=${encodeURIComponent(repoFullName)}`, {
          credentials: 'include',
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((c) => { if (c) setCommit(c); })
          .catch(() => {});
      }
      if (onReloaded) onReloaded(data);
    } catch (e) {
      setReloadError(e.message);
    } finally {
      setReloading(false);
    }
  };

  return (
    <div className="flex flex-col items-center w-full px-1 mt-auto pt-2 md:pt-3 border-t border-gray-200 gap-1.5">
      {/* GitHub link */}
      <a
        href={repoUrl || project?.repoUrl || '#'}
        target={repoUrl || project?.repoUrl ? '_blank' : undefined}
        rel="noreferrer"
        className="w-7 sm:w-8 md:w-10 h-7 sm:h-8 md:h-10 rounded flex items-center justify-center text-gray-700 hover:text-black hover:bg-gray-100 transition-colors"
        title={repoFullName ? `${repoFullName} on GitHub` : 'GitHub'}
      >
        <svg viewBox="0 0 24 24" className="w-5 h-5 md:w-6 md:h-6" fill="currentColor" aria-hidden="true">
          <path d="M12 .5C5.73.5.75 5.48.75 11.75c0 4.97 3.22 9.18 7.69 10.66.56.1.77-.24.77-.54v-1.9c-3.13.68-3.79-1.34-3.79-1.34-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.69.08-.69 1.13.08 1.72 1.16 1.72 1.16 1 1.72 2.63 1.22 3.27.93.1-.73.39-1.22.71-1.5-2.5-.28-5.13-1.25-5.13-5.57 0-1.23.44-2.24 1.16-3.03-.12-.29-.5-1.43.11-2.98 0 0 .95-.3 3.1 1.16a10.7 10.7 0 0 1 5.65 0c2.15-1.46 3.1-1.16 3.1-1.16.61 1.55.23 2.69.11 2.98.72.79 1.16 1.8 1.16 3.03 0 4.34-2.64 5.29-5.15 5.56.4.35.76 1.04.76 2.1v3.11c0 .3.2.65.78.54 4.47-1.49 7.68-5.69 7.68-10.66C23.25 5.48 18.27.5 12 .5Z" />
        </svg>
      </a>

      {/* Reload button */}
      <button
        onClick={handleReload}
        disabled={!repoUrl || reloading}
        title={
          repoUrl
            ? `Re-fetch ${repoFullName || repoUrl} from GitHub`
            : 'No repo URL — open this graph from /analyze to enable reload'
        }
        className="w-7 sm:w-8 md:w-10 h-7 sm:h-8 md:h-10 rounded flex items-center justify-center text-gray-600 hover:text-deep-olive hover:bg-soft-sage/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-600"
      >
        <span className={`material-symbols-outlined text-[18px] md:text-[20px] ${reloading ? 'animate-spin' : ''}`}>
          {reloading ? 'progress_activity' : 'refresh'}
        </span>
      </button>

      {/* Last commit info */}
      <div className="w-full px-0.5 text-[9px] text-gray-500 text-center leading-tight" title={commit?.message || commitError || ''}>
        {reloadError ? (
          <span className="text-rose-600">{reloadError}</span>
        ) : commit?.committed_at ? (
          <>
            <div className="font-medium text-gray-700">Last push</div>
            <div>{timeAgo(commit.committed_at)}</div>
            {commit.short_sha && (
              <div className="font-mono text-gray-400">{commit.short_sha}</div>
            )}
          </>
        ) : commitError ? (
          <span className="text-gray-400">—</span>
        ) : repoFullName ? (
          <span className="text-gray-400">…</span>
        ) : null}
      </div>
    </div>
  );
}
