import { useEffect, useRef, useState } from 'react';
import { API_BASE } from '../../types/api';

export default function GitHubAccount() {
  const [user, setUser] = useState(null);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/auth/me`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!cancelled && data?.user) setUser(data.user); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const handleLogin = async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/github/login`, { credentials: 'include' });
      if (!res.ok) throw new Error('Login init failed');
      const { url } = await res.json();
      window.location.href = url;
    } catch (e) {
      console.error(e);
    }
  };

  const handleLogout = async () => {
    await fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' });
    setUser(null);
    setOpen(false);
  };

  if (!user) {
    return (
      <button
        onClick={handleLogin}
        title="Sign in with GitHub"
        className="h-7 sm:h-8 px-2.5 rounded-full border border-white/20 bg-white/10 ml-1 sm:ml-2 flex items-center gap-1.5 text-zinc-300 hover:text-white hover:bg-white/20 transition-colors"
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor" aria-hidden="true">
          <path d="M12 .5C5.73.5.75 5.48.75 11.75c0 4.97 3.22 9.18 7.69 10.66.56.1.77-.24.77-.54v-1.9c-3.13.68-3.79-1.34-3.79-1.34-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.69.08-.69 1.13.08 1.72 1.16 1.72 1.16 1 1.72 2.63 1.22 3.27.93.1-.73.39-1.22.71-1.5-2.5-.28-5.13-1.25-5.13-5.57 0-1.23.44-2.24 1.16-3.03-.12-.29-.5-1.43.11-2.98 0 0 .95-.3 3.1 1.16a10.7 10.7 0 0 1 5.65 0c2.15-1.46 3.1-1.16 3.1-1.16.61 1.55.23 2.69.11 2.98.72.79 1.16 1.8 1.16 3.03 0 4.34-2.64 5.29-5.15 5.56.4.35.76 1.04.76 2.1v3.11c0 .3.2.65.78.54 4.47-1.49 7.68-5.69 7.68-10.66C23.25 5.48 18.27.5 12 .5Z" />
        </svg>
        <span className="text-[11px] font-medium">Sign in</span>
      </button>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 h-7 sm:h-8 pl-1 pr-2 rounded-full border border-white/20 bg-white/10 hover:bg-white/20 transition-colors"
        title={`Signed in as ${user.login}`}
      >
        {user.avatar_url ? (
          <img src={user.avatar_url} alt="" className="w-6 h-6 rounded-full" />
        ) : (
          <span className="material-symbols-outlined text-[16px] text-zinc-300">person</span>
        )}
        <span className="hidden sm:inline text-[11px] font-medium text-zinc-200 max-w-[100px] truncate">
          {user.login}
        </span>
        <span className="material-symbols-outlined text-[14px] text-zinc-300 hidden sm:inline">expand_more</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-56 bg-black/95 backdrop-blur-md border border-white/10 rounded-lg shadow-xl py-1 text-sm text-zinc-200 z-50">
          <div className="px-3 py-2 border-b border-white/10">
            <div className="flex items-center gap-2">
              {user.avatar_url && (
                <img src={user.avatar_url} alt="" className="w-8 h-8 rounded-full" />
              )}
              <div className="min-w-0">
                <div className="font-medium truncate">{user.name || user.login}</div>
                <div className="text-xs text-zinc-400 truncate">@{user.login}</div>
              </div>
            </div>
          </div>
          <a
            href={`https://github.com/${user.login}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 px-3 py-2 hover:bg-white/10 transition-colors"
            onClick={() => setOpen(false)}
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor" aria-hidden="true">
              <path d="M12 .5C5.73.5.75 5.48.75 11.75c0 4.97 3.22 9.18 7.69 10.66.56.1.77-.24.77-.54v-1.9c-3.13.68-3.79-1.34-3.79-1.34-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.69.08-.69 1.13.08 1.72 1.16 1.72 1.16 1 1.72 2.63 1.22 3.27.93.1-.73.39-1.22.71-1.5-2.5-.28-5.13-1.25-5.13-5.57 0-1.23.44-2.24 1.16-3.03-.12-.29-.5-1.43.11-2.98 0 0 .95-.3 3.1 1.16a10.7 10.7 0 0 1 5.65 0c2.15-1.46 3.1-1.16 3.1-1.16.61 1.55.23 2.69.11 2.98.72.79 1.16 1.8 1.16 3.03 0 4.34-2.64 5.29-5.15 5.56.4.35.76 1.04.76 2.1v3.11c0 .3.2.65.78.54 4.47-1.49 7.68-5.69 7.68-10.66C23.25 5.48 18.27.5 12 .5Z" />
            </svg>
            <span>Open GitHub profile</span>
            <span className="material-symbols-outlined text-[14px] ml-auto text-zinc-500">open_in_new</span>
          </a>
          <a
            href="/home"
            className="flex items-center gap-2 px-3 py-2 hover:bg-white/10 transition-colors"
            onClick={() => setOpen(false)}
          >
            <span className="material-symbols-outlined text-[16px]">folder_open</span>
            <span>Import repository</span>
          </a>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/10 transition-colors text-rose-300"
          >
            <span className="material-symbols-outlined text-[16px]">logout</span>
            <span>Sign out</span>
          </button>
        </div>
      )}
    </div>
  );
}
