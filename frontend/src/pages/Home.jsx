import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import JSZip from 'jszip';
import { Header, Footer } from '../components/Layout';
import { API_BASE } from '../types/api';

const SOURCE_EXTS = ['.swift', '.py', '.js', '.ts', '.jsx', '.tsx', '.java', '.go'];
const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', 'dist', 'build', '.next', '.venv', 'venv', '__pycache__', '.idea', '.vscode', 'target']);
const isSourceFile = (name) => SOURCE_EXTS.some((e) => name.toLowerCase().endsWith(e));

export default function Home() {
  const [repoUrl, setRepoUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [user, setUser] = useState(null);
  const [repos, setRepos] = useState(null);
  const [reposLoading, setReposLoading] = useState(false);
  const [repoFilter, setRepoFilter] = useState('');
  const navigate = useNavigate();

  // Check existing session on mount
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/auth/me`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.user) setUser(data.user);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Fetch repos once authenticated
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setReposLoading(true);
    fetch(`${API_BASE}/auth/github/repos`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data) => { if (!cancelled) setRepos(data.repos || []); })
      .catch(() => { if (!cancelled) setError('Failed to load repositories.'); })
      .finally(() => { if (!cancelled) setReposLoading(false); });
    return () => { cancelled = true; };
  }, [user]);

  const handleGithubLogin = async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/github/login`, { credentials: 'include' });
      if (!res.ok) throw new Error('Login init failed');
      const { url } = await res.json();
      window.location.href = url;
    } catch (e) {
      setError(e.message);
    }
  };

  const handleLogout = async () => {
    await fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' });
    setUser(null);
    setRepos(null);
  };

  const analyzeRepoUrl = async (url) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ repo_url: url }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `Server error ${res.status}`);
      }
      const data = await res.json();
      navigate(`/workspace?graph_id=${data.graph_id}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyze = () => {
    const url = repoUrl.trim();
    if (url) analyzeRepoUrl(url);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleAnalyze();
  };

  const postUpload = async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API_BASE}/upload`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || `Server error ${res.status}`);
    }
    const data = await res.json();
    navigate(`/workspace?graph_id=${data.graph_id}`);
  };

  // Bundle a list of {path, file} entries into a single .zip and upload.
  const uploadFolderEntries = async (entries) => {
    const filtered = entries.filter(({ path, file }) => {
      if (!isSourceFile(file.name)) return false;
      const segments = path.split('/').slice(0, -1);
      return !segments.some((seg) => SKIP_DIRS.has(seg));
    });
    if (filtered.length === 0) {
      setError('No supported source files found in the folder.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const zip = new JSZip();
      // Derive a top-level folder name from the first entry's leading segment.
      const rootName = filtered[0].path.split('/')[0] || 'upload';
      for (const { path, file } of filtered) {
        const buf = await file.arrayBuffer();
        zip.file(path, buf);
      }
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      const zipFile = new File([blob], `${rootName}.zip`, { type: 'application/zip' });
      await postUpload(zipFile);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (file) => {
    if (!file) return;
    const name = file.name.toLowerCase();
    const isArchive = name.endsWith('.zip') || name.endsWith('.tar') || name.endsWith('.tar.gz') || name.endsWith('.tgz');
    if (!(isArchive || isSourceFile(name))) {
      setError('Unsupported file type. Please upload an archive (.zip, .tar, .tar.gz), a source file, or a folder.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await postUpload(file);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // Folder picker: <input webkitdirectory> populates files with a webkitRelativePath.
  const handleFolderPick = (fileList) => {
    if (!fileList || fileList.length === 0) return;
    const entries = Array.from(fileList).map((f) => ({
      path: f.webkitRelativePath || f.name,
      file: f,
    }));
    uploadFolderEntries(entries);
  };

  // Walk a DataTransferItem entry tree (folder drop) and collect every file.
  const walkEntry = async (entry, prefix = '') => {
    if (entry.isFile) {
      return new Promise((resolve) => {
        entry.file((file) => resolve([{ path: prefix + file.name, file }]));
      });
    }
    if (entry.isDirectory) {
      if (SKIP_DIRS.has(entry.name)) return [];
      const reader = entry.createReader();
      const readAll = () =>
        new Promise((resolve, reject) => {
          const collected = [];
          const readBatch = () => {
            reader.readEntries((batch) => {
              if (batch.length === 0) resolve(collected);
              else { collected.push(...batch); readBatch(); }
            }, reject);
          };
          readBatch();
        });
      const children = await readAll();
      const nested = await Promise.all(children.map((c) => walkEntry(c, `${prefix}${entry.name}/`)));
      return nested.flat();
    }
    return [];
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setDragOver(false);
    const items = e.dataTransfer.items ? Array.from(e.dataTransfer.items) : [];
    const entries = items
      .map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null))
      .filter(Boolean);
    const hasFolder = entries.some((en) => en.isDirectory);
    if (hasFolder) {
      try {
        const collected = (await Promise.all(entries.map((en) => walkEntry(en)))).flat();
        await uploadFolderEntries(collected);
      } catch (err) {
        setError(err.message || 'Failed to read folder.');
      }
      return;
    }
    const file = e.dataTransfer.files[0];
    handleUpload(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const filteredRepos = (repos || []).filter((r) =>
    !repoFilter.trim() || r.full_name.toLowerCase().includes(repoFilter.trim().toLowerCase())
  );

  return (
    <div className="bg-gray-50 text-on-surface min-h-screen flex flex-col font-body-md text-body-md antialiased selection:bg-primary-container selection:text-on-primary-container">
      <Header activePage="home" />

      <main className="flex-grow flex items-center justify-center pt-20 sm:pt-24 pb-8 sm:pb-16 px-3 sm:px-4 md:px-6 relative z-10">
        <div className="w-full max-w-2xl bg-white rounded-2xl p-5 sm:p-8 md:p-12 flex flex-col gap-6 sm:gap-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100 relative overflow-hidden">
          <div className="flex flex-col gap-2 text-center">
            <h1 className="font-headline-lg text-headline-md sm:text-headline-lg text-gray-900">Import Workspace</h1>
            <p className="font-body-md text-sm sm:text-body-md text-gray-500 max-w-md mx-auto">
              Connect your repository to generate an interactive structural topology.
            </p>
          </div>

          <div className="flex flex-col gap-6 w-full max-w-md mx-auto">
            {/* URL Input */}
            <div className="flex flex-col gap-2">
              <label className="font-label-sm text-label-sm text-gray-500 uppercase tracking-widest">Repository URL</label>
              <div className="relative flex items-center bg-white rounded-lg border border-gray-300 focus-within:border-deep-olive focus-within:ring-1 focus-within:ring-soft-sage shadow-sm transition-all duration-200">
                <span className="material-symbols-outlined absolute left-4 text-gray-400">link</span>
                <input
                  className="w-full bg-transparent border-none text-gray-900 font-body-md pl-12 pr-12 py-3.5 focus:ring-0 placeholder:text-gray-400 font-mono text-sm"
                  placeholder="https://github.com/BendingSpoons/katana-swift"
                  type="text"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={loading}
                />
                <button
                  onClick={handleAnalyze}
                  disabled={loading || !repoUrl.trim()}
                  className="absolute right-1.5 bg-deep-olive text-white p-1.5 rounded-md hover:bg-deep-olive/90 transition-colors flex items-center justify-center active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                  ) : (
                    <span className="material-symbols-outlined text-sm">arrow_forward</span>
                  )}
                </button>
              </div>
              {error && (
                <p className="text-sm text-red-600 mt-1">{error}</p>
              )}
              {loading && (
                <p className="text-sm text-deep-olive mt-1">Cloning and analyzing repository... this may take a minute.</p>
              )}
            </div>

            {/* Divider */}
            <div className="flex items-center gap-4 text-gray-400 font-label-sm text-label-sm uppercase my-2">
              <div className="h-px bg-gray-200 flex-grow"></div>
              <span>or connect provider</span>
              <div className="h-px bg-gray-200 flex-grow"></div>
            </div>

            {/* GitHub Auth / Repo Picker */}
            {!user ? (
              <button
                onClick={handleGithubLogin}
                className="w-full flex items-center justify-center gap-3 bg-gray-900 py-3.5 px-6 rounded-lg hover:bg-gray-800 transition-colors active:scale-95 shadow-sm"
              >
                <svg aria-hidden="true" className="w-5 h-5 fill-white" viewBox="0 0 24 24">
                  <path
                    clipRule="evenodd"
                    d="M12 2C6.477 2 2 6.463 2 11.97c0 4.404 2.865 8.14 6.839 9.458.5.092.682-.216.682-.48 0-.236-.008-.864-.013-1.695-2.782.602-3.369-1.337-3.369-1.337-.454-1.151-1.11-1.458-1.11-1.458-.908-.618.069-.606.069-.606 1.003.07 1.531 1.027 1.531 1.027.892 1.524 2.341 1.084 2.91.828.092-.643.35-1.083.636-1.332-2.22-.251-4.555-1.107-4.555-4.927 0-1.088.39-1.976 1.029-2.669-.103-.252-.446-1.266.098-2.631 0 0 .84-.268 2.75 1.022A9.606 9.606 0 0112 6.82c.85.004 1.705.114 2.504.336 1.909-1.29 2.747-1.022 2.747-1.022.546 1.365.202 2.379.1 2.631.64.693 1.028 1.581 1.028 2.669 0 3.83-2.339 4.673-4.565 4.919.359.307.678.915.678 1.846 0 1.332-.012 2.407-.012 2.734 0 .267.18.577.688.48C19.137 20.107 22 16.37 22 11.97 22 6.463 17.522 2 12 2z"
                    fillRule="evenodd"
                  />
                </svg>
                <span className="text-sm font-medium text-white">Auth with GitHub</span>
              </button>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-gray-50 border border-gray-100">
                  <div className="flex items-center gap-2 min-w-0">
                    {user.avatar_url && (
                      <img src={user.avatar_url} alt="" className="w-6 h-6 rounded-full" />
                    )}
                    <span className="text-sm text-gray-800 truncate">
                      {user.name || user.login}
                    </span>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="text-xs text-gray-500 hover:text-gray-800"
                  >
                    Sign out
                  </button>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="font-label-sm text-label-sm text-gray-500 uppercase tracking-widest">Your repositories</label>
                  <input
                    className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-deep-olive focus:ring-1 focus:ring-soft-sage"
                    placeholder="Filter by name..."
                    value={repoFilter}
                    onChange={(e) => setRepoFilter(e.target.value)}
                    disabled={reposLoading}
                  />
                  <div className="border border-gray-200 rounded-lg max-h-64 overflow-y-auto bg-white">
                    {reposLoading && (
                      <div className="p-4 text-sm text-gray-500">Loading repositories...</div>
                    )}
                    {!reposLoading && filteredRepos.length === 0 && (
                      <div className="p-4 text-sm text-gray-500">No repositories found.</div>
                    )}
                    {!reposLoading && filteredRepos.map((r) => (
                      <button
                        key={r.full_name}
                        disabled={loading}
                        onClick={() => analyzeRepoUrl(r.html_url || `https://github.com/${r.full_name}`)}
                        className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-gray-50 border-b border-gray-100 last:border-b-0 disabled:opacity-50"
                      >
                        <div className="min-w-0">
                          <div className="text-sm text-gray-900 truncate font-mono">{r.full_name}</div>
                          {r.description && (
                            <div className="text-xs text-gray-500 truncate">{r.description}</div>
                          )}
                        </div>
                        {r.private && (
                          <span className="text-[10px] uppercase tracking-wide bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full flex-shrink-0">
                            Private
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Local Upload */}
            <div
              className={`mt-2 border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center gap-3 transition-colors group ${
                dragOver
                  ? 'border-deep-olive bg-soft-sage/20'
                  : 'border-gray-200 bg-gray-50 hover:bg-gray-100 hover:border-gray-300'
              }`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              <input
                id="file-upload"
                type="file"
                accept=".zip,.tar,.tar.gz,.tgz,.swift,.py,.js,.ts,.jsx,.tsx,.java,.go"
                className="hidden"
                onChange={(e) => handleUpload(e.target.files[0])}
                disabled={loading}
              />
              <input
                id="folder-upload"
                type="file"
                webkitdirectory=""
                directory=""
                multiple
                className="hidden"
                onChange={(e) => handleFolderPick(e.target.files)}
                disabled={loading}
              />
              <div className={`w-12 h-12 rounded-full bg-white shadow-sm flex items-center justify-center transition-colors ${
                dragOver ? 'text-deep-olive' : 'text-gray-500 group-hover:text-deep-olive'
              }`}>
                <span className="material-symbols-outlined">cloud_upload</span>
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-gray-900 mb-1">Upload Files or Folder</p>
                <p className="text-xs text-gray-500">Drag &amp; drop a file or folder, or pick one below</p>
                <div className="mt-3 flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); document.getElementById('file-upload').click(); }}
                    disabled={loading}
                    className="text-xs px-3 py-1.5 rounded border border-gray-300 bg-white text-gray-700 hover:border-deep-olive hover:text-deep-olive transition-colors disabled:opacity-50"
                  >
                    Choose file
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); document.getElementById('folder-upload').click(); }}
                    disabled={loading}
                    className="text-xs px-3 py-1.5 rounded border border-gray-300 bg-white text-gray-700 hover:border-deep-olive hover:text-deep-olive transition-colors disabled:opacity-50"
                  >
                    Choose folder
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
