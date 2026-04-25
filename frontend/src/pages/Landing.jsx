import { Link } from 'react-router-dom';
import FloatingLines from '../components/FloatingLines/FloatingLines';

export default function Landing() {
  return (
    <div className="relative min-h-screen flex flex-col antialiased bg-white text-deep-olive font-capriola overflow-x-hidden">
      {/* Animated WebGL line background */}
      <div className="fixed inset-0 z-0 pointer-events-none" aria-hidden="true">
        <FloatingLines
          linesGradient={["#ACC8A2", "#7a6e6e", "#1A2517"]}
          enabledWaves={["bottom", "top"]}
          lineCount={8}
          lineDistance={8}
          bendRadius={8}
          bendStrength={-2}
          interactive={true}
          parallax={true}
          animationSpeed={1}
          mixBlendMode="normal"
        />
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
        </div>
      </nav>

      {/* Main Content */}
      <main className="relative flex-grow pt-[104px]">
        {/* Hero Section */}
        <section className="max-w-7xl mx-auto px-8 py-16 flex flex-col items-center text-center">
          <h1 className="brand-title-gradient text-6xl md:text-7xl font-normal tracking-tight max-w-5xl mb-4 leading-tight">
            Visualize your codebase <em className="italic">like never before</em>.
          </h1>
          <p className="text-lg text-gray-500 max-w-2xl mb-8 leading-relaxed">
            Precision engineering tools to map dependencies, trace execution paths, and understand complex software architectures at a glance.
          </p>
          <div className="flex gap-4 mb-16">
            <Link to="/home" className="bg-deep-olive text-white px-6 py-3 rounded text-sm font-semibold hover:bg-deep-olive/90 transition-colors">
              Import your first project
            </Link>
            <button className="bg-transparent border border-gray-300 text-deep-olive px-6 py-3 rounded text-sm font-semibold hover:border-soft-sage hover:text-soft-sage transition-colors">
              View Live Demo
            </button>
          </div>
        </section>

        {/* Features Bento Grid */}
        <section id="features" className="relative py-24">
          <div className="max-w-7xl mx-auto px-8">
            <div className="mb-12">
              <h2 className="text-4xl font-bold tracking-tight text-deep-olive mb-4">
                Precision Mapping
              </h2>
              <p className="text-base text-gray-600 max-w-2xl">
                Uncover hidden relationships and optimize architecture with our core visualization engines.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              
              {/* Kartica 1: Wide (Glassmorphism) */}
              <div className="md:col-span-2 group relative overflow-hidden rounded-3xl border border-white/20 bg-white/10 backdrop-blur-md p-8 transition-all duration-300 hover:bg-white/20 hover:border-soft-sage/50 hover:shadow-[0_20px_50px_rgba(172,200,162,0.1)]">
                <div className="relative z-10">
                  <span className="material-symbols-outlined text-[32px] text-soft-sage mb-4 block drop-shadow-[0_0_8px_rgba(172,200,162,0.8)]">memory</span>
                  <h3 className="text-2xl font-semibold text-deep-olive mb-2">AI-Powered Summaries</h3>
                  <p className="text-base text-gray-600 mb-6 max-w-lg">
                    Automatically generate natural language descriptions for complex modules and trace entire execution paths.
                  </p>
                </div>
                {/* Unutrašnji preview box - takođe proziran */}
                <div className="h-48 bg-white/5 rounded-2xl border border-white/10 overflow-hidden relative flex items-center justify-center transition-all group-hover:bg-white/10">
                  <div className="text-center text-soft-sage/60">
                    <span className="material-symbols-outlined text-[48px] animate-pulse">auto_awesome</span>
                    <p className="text-sm mt-2 font-medium">AI Analysis Preview</p>
                  </div>
                </div>
              </div>

              {/* Kartica 2: Tall (Glassmorphism) */}
              <div className="md:col-span-1 group flex flex-col rounded-3xl border border-white/20 bg-white/10 backdrop-blur-md p-8 transition-all duration-300 hover:bg-white/20 hover:border-soft-sage/50">
                <span className="material-symbols-outlined text-[32px] text-soft-sage mb-4 block">hub</span>
                <h3 className="text-2xl font-semibold text-deep-olive mb-2">Interactive Topology</h3>
                <p className="text-base text-gray-600 mb-6 flex-grow">
                  Navigate your system architecture fluidly. Zoom from high-level service maps down to individual class dependencies.
                </p>
                <div className="bg-deep-olive/5 group-hover:bg-soft-sage/20 p-4 rounded-xl flex items-center justify-between text-deep-olive border border-white/10 transition-colors">
                  <span className="text-[11px] uppercase tracking-widest font-bold">View Map</span>
                  <span className="material-symbols-outlined text-soft-sage text-[18px] group-hover:translate-x-1 transition-transform">arrow_forward</span>
                </div>
              </div>

              {/* Kartica 3: Small (Glassmorphism) */}
              <div className="md:col-span-1 group rounded-3xl border border-white/20 bg-white/10 backdrop-blur-md p-8 transition-all duration-300 hover:bg-white/20 hover:border-soft-sage/50">
                <span className="material-symbols-outlined text-[32px] text-soft-sage mb-4 block">code_blocks</span>
                <h3 className="text-xl font-semibold text-deep-olive mb-2">Multi-Language</h3>
                <p className="text-sm text-gray-600">
                  Seamlessly process Python, Java, Go, TypeScript, and Rust within a single unified graph environment.
                </p>
              </div>

              {/* Kartica 4: Wide with Icon (Glassmorphism) */}
              <div className="md:col-span-2 group flex items-center gap-8 rounded-3xl border border-white/20 bg-white/10 backdrop-blur-md p-8 transition-all duration-300 hover:bg-white/20 hover:border-soft-sage/50">
                <div className="flex-grow">
                  <span className="material-symbols-outlined text-[32px] text-soft-sage mb-4 block">security</span>
                  <h3 className="text-xl font-semibold text-deep-olive mb-2">Vulnerability Tracing</h3>
                  <p className="text-sm text-gray-600">
                    Instantly see blast radiuses for security patches. Our graphing engine highlights every downstream module affected.
                  </p>
                </div>
                <div className="w-32 h-32 flex-shrink-0 bg-white/10 rounded-full flex items-center justify-center border border-white/20 shadow-xl relative overflow-hidden group-hover:scale-105 transition-transform">
                  <div className="absolute inset-0 bg-gradient-to-br from-soft-sage/20 to-transparent"></div>
                  <span className="material-symbols-outlined text-deep-olive text-[48px] relative z-10 group-hover:rotate-12 transition-transform">radar</span>
                </div>
              </div>

            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="max-w-7xl mx-auto px-8 py-24 text-center">
          <div className="relative group overflow-hidden rounded-3xl border border-white/20 bg-white/10 backdrop-blur-xl p-16 shadow-[0_20px_50px_rgba(0,0,0,0.1)] transition-all duration-500 hover:border-soft-sage/40">
            
            {/* Suptilni gradient sjaj u pozadini kartice */}
            <div className="absolute -inset-px bg-gradient-to-br from-soft-sage/20 via-transparent to-deep-olive/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500" aria-hidden="true"></div>

            <div className="relative z-10 flex flex-col items-center">
              <div className="mb-6 relative">
                <span className="material-symbols-outlined text-[56px] text-soft-sage drop-shadow-[0_0_15px_rgba(172,200,162,0.5)]">
                  upload_file
                </span>
                {/* Pulsirajući krug iza ikone */}
                <div className="absolute inset-0 bg-soft-sage/20 blur-2xl rounded-full animate-pulse"></div>
              </div>

              <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-deep-olive mb-6">
                Ready for clarity?
              </h2>
              
              <p className="text-lg text-gray-600 mb-10 max-w-xl mx-auto leading-relaxed">
                Connect your repository and generate your first interactive codebase map in seconds.
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
