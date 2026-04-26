import { useState } from 'react';
import { Link } from 'react-router-dom';
import GitHubAccount from './GitHubAccount';

export default function Header({ activePage }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navLinks = [
    { to: '/home', label: 'Dashboard', pages: ['home'] },
    { to: '/workspace', label: 'Workspace', pages: ['workspace', 'call-graph', 'control-flow'] },
  ];

  return (
    <header className="fixed top-0 w-full z-50 bg-black/90 backdrop-blur-md border-b border-white/10">
      <div className="flex justify-between items-center h-14 sm:h-16 max-w-7xl mx-auto px-4 sm:px-8">
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
            {navLinks.map(({ to, label, pages }) => (
              <Link
                key={pages[0]}
                to={to}
                className={`h-full flex items-center transition-colors duration-75 active:scale-95 text-label-md font-label-md ${
                  pages.includes(activePage)
                    ? 'text-white border-b-2 border-soft-sage'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          <GitHubAccount />
        </div>
      </div>
      {/* Mobile nav drawer */}
      {mobileMenuOpen && (
        <nav className="md:hidden border-t border-white/10 bg-black/95 backdrop-blur-md px-4 py-3 flex flex-col gap-2 font-grotesk">
          {navLinks.map(({ to, label, pages }) => (
            <Link
              key={pages[0]}
              to={to}
              onClick={() => setMobileMenuOpen(false)}
              className={`py-2 px-3 rounded transition-colors text-label-md font-label-md ${
                pages.includes(activePage)
                  ? 'text-white bg-white/10'
                  : 'text-zinc-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
