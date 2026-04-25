import { useState } from 'react';
import { Link } from 'react-router-dom';

export default function Header({ activePage }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navLinks = [
    { to: '/home', label: 'Dashboard', page: 'home' },
    { to: '/workspace', label: 'Workspace', page: 'workspace' },
  ];

  return (
    <header className="fixed top-0 w-full z-50 bg-black/90 backdrop-blur-md border-b border-white/10">
      <div className="flex justify-between items-center px-4 sm:px-6 h-14 sm:h-16">
        <div className="flex items-center gap-4 sm:gap-8 h-full">
          {/* Mobile menu toggle */}
          <button
            className="md:hidden text-zinc-400 hover:text-white transition-colors p-1"
            onClick={() => setMobileMenuOpen((v) => !v)}
          >
            <span className="material-symbols-outlined">{mobileMenuOpen ? 'close' : 'menu'}</span>
          </button>
          <Link to="/" className="text-lg sm:text-xl font-black tracking-tighter text-white flex items-center gap-2 font-grotesk">
            <img src="https://i.imgur.com/N5oONRU.png" alt="Synapse" className="h-6 w-6 sm:h-7 sm:w-7 object-contain" />
            Synapse
          </Link>
          <nav className="hidden md:flex h-full items-center gap-6 font-grotesk tracking-tight">
            {navLinks.map(({ to, label, page }) => (
              <Link
                key={page}
                to={to}
                className={`h-full flex items-center transition-colors duration-75 active:scale-95 text-label-md font-label-md ${
                  activePage === page
                    ? 'text-white border-b-2 border-soft-sage'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                {label}
              </Link>
            ))}
            <a className="h-full flex items-center text-zinc-400 hover:text-white transition-colors duration-75 active:scale-95 text-label-md font-label-md" href="#">
              Documentation
            </a>
          </nav>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          {activePage === 'workspace' && (
            <div className="hidden lg:flex items-center gap-2 mr-4 text-zinc-400 bg-white/10 px-3 py-1.5 rounded border border-white/10">
              <span className="material-symbols-outlined text-[16px]">search</span>
              <span className="font-label-sm text-xs">Search symbols...</span>
              <span className="font-label-sm text-[10px] ml-4 bg-white/10 px-1 rounded text-zinc-500">&#8984;K</span>
            </div>
          )}
          <Link
            to="/home"
            className="hidden sm:flex bg-white text-black px-3 sm:px-4 py-1.5 sm:py-2 rounded font-label-md text-label-md hover:bg-zinc-200 transition-colors active:scale-95 items-center gap-2 text-xs sm:text-sm"
          >
            {activePage === 'workspace' && (
              <span className="material-symbols-outlined text-[18px]">add</span>
            )}
            Import
            <span className="hidden md:inline">Project</span>
          </Link>
          {/* Mobile: icon-only import */}
          <Link
            to="/home"
            className="sm:hidden bg-white text-black p-2 rounded hover:bg-zinc-200 transition-colors active:scale-95 flex items-center justify-center"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
          </Link>
          <div className="flex items-center gap-1 sm:gap-2 text-zinc-400 ml-1 sm:ml-2">
            <button className="hover:text-white transition-colors duration-75 active:scale-95 p-1.5 sm:p-2">
              <span className="material-symbols-outlined text-[20px] sm:text-[24px]">settings</span>
            </button>
            <button className="hidden sm:block hover:text-white transition-colors duration-75 active:scale-95 p-1.5 sm:p-2">
              <span className="material-symbols-outlined">account_tree</span>
            </button>
          </div>
          <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full border border-white/20 bg-white/10 ml-1 sm:ml-2 flex items-center justify-center text-zinc-300">
            <span className="material-symbols-outlined text-[16px] sm:text-[18px]">person</span>
          </div>
        </div>
      </div>
      {/* Mobile nav drawer */}
      {mobileMenuOpen && (
        <nav className="md:hidden border-t border-white/10 bg-black/95 backdrop-blur-md px-4 py-3 flex flex-col gap-2 font-grotesk">
          {navLinks.map(({ to, label, page }) => (
            <Link
              key={page}
              to={to}
              onClick={() => setMobileMenuOpen(false)}
              className={`py-2 px-3 rounded transition-colors text-label-md font-label-md ${
                activePage === page
                  ? 'text-white bg-white/10'
                  : 'text-zinc-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {label}
            </Link>
          ))}
          <a className="py-2 px-3 rounded text-zinc-400 hover:text-white hover:bg-white/5 transition-colors text-label-md font-label-md" href="#">
            Documentation
          </a>
        </nav>
      )}
    </header>
  );
}
