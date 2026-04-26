import { Link } from 'react-router-dom';
import CallGraphBackground from '../components/CallGraphBackground/CallGraphBackground';
import GitHubAccount from '../components/Layout/GitHubAccount';

function ImportCard() {
  return (
    <div className="rounded-2xl border-2 border-dashed border-deep-olive/25 bg-white/55 backdrop-blur-md p-5 flex flex-col items-center text-center gap-2 w-full">
      <span className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-semibold">Input</span>
      <span className="material-symbols-outlined text-[28px] text-deep-olive">cloud_upload</span>
      <h3 className="text-base font-bold text-deep-olive leading-tight">Your repo</h3>
      <p className="text-[11px] text-gray-500 leading-relaxed">URL, archive,<br/>or single file.</p>
    </div>
  );
}

function HubCard() {
  return (
    <div className="rounded-3xl border border-soft-sage/40 bg-white/85 backdrop-blur-xl p-7 flex flex-col items-center text-center gap-4 shadow-[0_25px_60px_rgba(172,200,162,0.22)] w-full">
      <span className="text-[10px] uppercase tracking-[0.2em] text-soft-sage font-semibold">Engine</span>
      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-soft-sage/35 to-soft-sage/5 flex items-center justify-center border border-soft-sage/40">
        <span className="material-symbols-outlined text-deep-olive text-[28px]">account_tree</span>
      </div>
      <h3 className="text-xl font-bold text-deep-olive">Synapse Core</h3>
      <p className="text-sm text-gray-600 leading-relaxed max-w-[240px]">
        Tree-sitter parses every function, link, and branch into one interactive graph.
      </p>
      <div className="flex gap-1.5 flex-wrap justify-center">
        <span className="px-2 py-0.5 rounded-full bg-soft-sage/20 text-[10px] font-semibold text-deep-olive">tree-sitter</span>
        <span className="px-2 py-0.5 rounded-full bg-soft-sage/20 text-[10px] font-semibold text-deep-olive">AST</span>
        <span className="px-2 py-0.5 rounded-full bg-soft-sage/20 text-[10px] font-semibold text-deep-olive">DAG</span>
      </div>
    </div>
  );
}

function CapabilityCard({ icon, title, desc, accent }) {
  return (
    <div
      className="group rounded-xl bg-white/75 backdrop-blur-md p-3.5 flex items-start gap-3 hover:bg-white hover:translate-x-1 transition-all duration-300 shadow-[0_4px_16px_rgba(0,0,0,0.04)] border border-white/40"
      style={{ borderLeft: `4px solid ${accent}` }}
    >
      <div
        className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center"
        style={{ backgroundColor: `${accent}1a` }}
      >
        <span className="material-symbols-outlined text-[20px]" style={{ color: accent }}>{icon}</span>
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="text-sm font-bold text-deep-olive leading-tight mb-0.5">{title}</h4>
        <p className="text-[11px] text-gray-500 leading-snug">{desc}</p>
      </div>
    </div>
  );
}

const CAPABILITIES = [
  { icon: 'memory',       title: 'AI Summaries',         desc: 'Natural-language explanations for any function or path.', accent: '#1A2517' },
  { icon: 'code_blocks',  title: 'Multi-Language',       desc: 'Python, JS/TS, Java, Go, Swift — one unified graph.',     accent: '#5d7558' },
  { icon: 'hub',          title: 'Interactive Topology', desc: 'Zoom from architecture down to a single call site.',      accent: '#ACC8A2' },
  { icon: 'security',     title: 'Impact Tracing',       desc: 'Touch a function — see every downstream caller affected.', accent: '#b8722c' },
];

export default function Landing() {
  return (
    <div className="relative min-h-screen flex flex-col antialiased bg-white text-deep-olive font-capriola overflow-x-hidden">
      {/* Animated call-graph background — communicates "code visualization" at a glance */}
      <div className="fixed inset-0 z-0 pointer-events-none" aria-hidden="true">
        <CallGraphBackground />
      </div>
      {/* Soft Sage glow — top right */}
      <div className="sage-glow" aria-hidden="true"></div>
      {/* Nav */}
      <nav className="fixed top-0 w-full z-50 bg-white/0 backdrop-blur-xl border-b border-white/0 shadow-[0_2px_4px_rgba(0,0,0,0.03)]">
        <div className="flex justify-between items-center h-16 px-8 max-w-7xl mx-auto">
          <Link to="/" className="text-xl font-black text-deep-olive tracking-tighter flex items-center gap-2">
            <img src="https://i.imgur.com/HrjNptE.png" alt="Synapse" className="h-7 w-7 object-contain" />
            Synapse
          </Link>
          <GitHubAccount theme="light" />
        </div>
      </nav>

      {/* Main Content */}
      <main className="relative flex-grow">
        {/* Hero — fills viewport so 'Precision Mapping' is below the fold */}
        <section className="min-h-[calc(100vh-64px)] mt-16 flex flex-col items-center justify-center text-center px-8">
          <h1 className="brand-title-gradient text-6xl md:text-7xl font-normal tracking-tight max-w-5xl mb-6 leading-tight">
            Your codebase, <em className="italic">as a graph</em>.
          </h1>
          <p className="text-lg text-gray-500 max-w-2xl mb-8 leading-relaxed">
            Synapse parses your repository with tree-sitter and renders an interactive call graph. Trace execution paths, surface dead code, and onboard onto unfamiliar codebases in minutes.
          </p>
          <div className="flex gap-4">
            <Link to="/home" className="bg-deep-olive text-white px-6 py-3 rounded text-sm font-semibold hover:bg-deep-olive/90 transition-colors">
              Import your first project
            </Link>
            <Link to="/workspace/call-graph" className="bg-transparent border border-gray-300 text-deep-olive px-6 py-3 rounded text-sm font-semibold hover:border-soft-sage hover:text-soft-sage transition-colors flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]">play_circle</span>
              Try a sample repo
            </Link>
          </div>
        </section>

        {/* Features — left-to-right pipeline graph */}
        <section id="features" className="relative min-h-screen flex flex-col justify-center px-8 py-12">
          <div className="max-w-6xl mx-auto w-full">
            <div className="text-center mb-10">
              <h2 className="text-4xl font-bold tracking-tight text-deep-olive mb-3">
                How Synapse reads your code
              </h2>
              <p className="text-base text-gray-600 max-w-xl mx-auto">
                Import a repository. We parse it into a graph. You explore it from every angle.
              </p>
            </div>

            {/* Mobile: vertical stack */}
            <div className="md:hidden flex flex-col gap-4">
              <ImportCard />
              <HubCard />
              {CAPABILITIES.map((c) => <CapabilityCard key={c.title} {...c} />)}
            </div>

            {/* Desktop: pipeline flow graph */}
            <div className="hidden md:block relative" style={{ height: 'clamp(480px, 70vh, 760px)' }}>
              {/* Edges + arrowheads */}
              <svg
                className="absolute inset-0 w-full h-full pointer-events-none"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                {/* Import → Hub: starts at Import right edge (16%), ends at Hub left edge (34%) */}
                <path d="M 16 50 L 34 50" className="feat-edge" />
                {/* Hub → Capability 1..4: all fan out from Hub right edge (66, 50) to Cap left edge (78, y) */}
                <path d="M 66 50 C 72 50 75 12 78 12" className="feat-edge" />
                <path d="M 66 50 C 72 50 75 37 78 37" className="feat-edge" />
                <path d="M 66 50 C 72 50 75 62 78 62" className="feat-edge" />
                <path d="M 66 50 C 72 50 75 87 78 87" className="feat-edge" />
              </svg>

              {/* Import card (left, centered vertically) — right edge at 16% */}
              <div className="absolute" style={{ left: '1%', top: '50%', transform: 'translateY(-50%)', width: '15%' }}>
                <ImportCard />
              </div>

              {/* Hub card (middle, centered vertically) — left at 34%, right at 66% */}
              <div className="absolute" style={{ left: '34%', top: '50%', transform: 'translateY(-50%)', width: '32%' }}>
                <HubCard />
              </div>

              {/* Capability cards — left edge at 78%, each centered at its arrow's target Y */}
              {CAPABILITIES.map((c, i) => {
                const targetY = [12, 37, 62, 87][i];
                return (
                  <div
                    key={c.title}
                    className="absolute"
                    style={{ right: '0%', top: `${targetY}%`, transform: 'translateY(-50%)', width: '22%' }}
                  >
                    <CapabilityCard {...c} />
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="max-w-7xl mx-auto px-8 py-24 text-center">
          <div className="relative group overflow-hidden rounded-3xl border border-white/20 bg-white/10 backdrop-blur-xl p-16 shadow-[0_20px_50px_rgba(0,0,0,0.1)] transition-all duration-500 hover:border-soft-sage/40">
            <div className="absolute -inset-px bg-gradient-to-br from-soft-sage/20 via-transparent to-deep-olive/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500" aria-hidden="true"></div>

            <div className="relative z-10 flex flex-col items-center">
              <div className="mb-6 relative">
                <span className="material-symbols-outlined text-[56px] text-soft-sage drop-shadow-[0_0_15px_rgba(172,200,162,0.5)]">
                  upload_file
                </span>
                <div className="absolute inset-0 bg-soft-sage/20 blur-2xl rounded-full animate-pulse"></div>
              </div>

              <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-deep-olive mb-6">
                Ready to map your code?
              </h2>

              <p className="text-lg text-gray-600 mb-10 max-w-xl mx-auto leading-relaxed">
                Connect a repository and generate your first interactive call graph in seconds.
              </p>

              <Link
                to="/home"
                className="group/btn relative overflow-hidden bg-deep-olive text-white px-10 py-5 rounded-2xl text-base font-bold transition-all duration-300 hover:scale-105 hover:shadow-[0_10px_20px_rgba(26,37,23,0.2)] flex items-center gap-3"
              >
                <span>Import your first project</span>
                <span className="material-symbols-outlined text-[20px] group-hover/btn:translate-x-1 transition-transform">
                  arrow_forward
                </span>
              </Link>

              <p className="text-xs text-gray-500 mt-6 font-semibold tracking-wider uppercase opacity-70">
                Free for open-source repositories.
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="w-full py-12 mt-auto bg-white border-t border-gray-100 text-sm">
        <div className="max-w-7xl mx-auto px-8 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2 text-lg font-bold text-deep-olive">
            <img src="https://i.imgur.com/HrjNptE.png" alt="Synapse" className="h-6 w-6 object-contain" />
            Synapse
          </div>
          <div className="flex items-center gap-6">
            <a className="text-gray-400 hover:text-soft-sage transition-colors" href="#">Documentation</a>
            <a className="text-gray-400 hover:text-soft-sage transition-colors" href="https://github.com/dimitrijepesic/hackupc">GitHub</a>
            <a className="text-gray-400 hover:text-soft-sage transition-colors" href="#">Privacy</a>
            <a className="text-gray-400 hover:text-soft-sage transition-colors" href="#">Terms</a>
          </div>
          <div className="text-gray-400">
            &copy; 2026 Synapse. Precision codebase intelligence.
          </div>
        </div>
      </footer>
    </div>
  );
}
