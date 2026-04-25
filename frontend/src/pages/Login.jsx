import { Link } from 'react-router-dom';

export default function Login() {
  return (
    <div className="bg-[#fcf8f8] min-h-screen flex items-center justify-center antialiased p-8 font-capriola">
      <main className="w-full max-w-[400px]">
        {/* Brand Logo */}
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-2">
<<<<<<< HEAD
            <img src="https://i.imgur.com/HrjNptE.png" alt="Synapse" className="h-10 w-10 object-contain" />
            <h1 className="text-4xl font-black tracking-tighter text-deep-olive">Synapse</h1>
=======
            <span className="material-symbols-outlined text-[36px] text-indigo-600" style={{ fontVariationSettings: "'FILL' 1" }}>account_tree</span>
            <h1 className="text-4xl font-black tracking-tighter text-gray-900">Synapsis</h1>
>>>>>>> b09ae6ee342ec528536865d4b4f20610e40c5984
          </Link>
          <p className="text-sm text-gray-500 mt-2">Precision codebase intelligence.</p>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-xl p-8 shadow-[0_12px_24px_rgba(0,0,0,0.08)]">
          <h2 className="text-xl font-semibold mb-4 text-deep-olive">Sign in to your account</h2>

          <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
            {/* Email */}
            <div>
              <label className="block text-xs font-semibold text-deep-olive mb-1 tracking-wide" htmlFor="email">Email address</label>
              <input
                autoComplete="email"
                className="brand-input w-full bg-white border border-[#F5F5F7] rounded px-4 py-2.5 text-sm text-deep-olive placeholder:text-gray-400"
                id="email"
                name="email"
                placeholder="developer@example.com"
                required
                type="email"
              />
            </div>

            {/* Password */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-deep-olive" htmlFor="password">Password</label>
                <a className="text-[11px] font-medium text-gray-500 hover:text-soft-sage transition-colors" href="#">Forgot password?</a>
              </div>
              <input
                autoComplete="current-password"
                className="brand-input w-full bg-white border border-[#F5F5F7] rounded px-4 py-2.5 text-sm text-deep-olive placeholder:text-gray-400"
                id="password"
                name="password"
                placeholder="••••••••"
                required
                type="password"
              />
            </div>

            {/* Sign In Button */}
            <button
              className="w-full bg-deep-olive text-white hover:bg-deep-olive/90 text-xs font-semibold rounded py-3 px-4 transition-colors flex items-center justify-center gap-2 tracking-wide"
              type="submit"
            >
              Sign In
              <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </button>
          </form>

          <div className="my-6 flex items-center">
            <div className="flex-grow border-t border-[#F5F5F7]"></div>
            <span className="mx-4 text-[11px] font-medium text-gray-400 tracking-wide">OR</span>
            <div className="flex-grow border-t border-[#F5F5F7]"></div>
          </div>

          {/* GitHub Button */}
          <button
            className="w-full bg-white border border-[#F5F5F7] text-deep-olive hover:bg-gray-50 text-xs font-semibold rounded py-3 px-4 transition-colors flex items-center justify-center gap-2 shadow-[0_2px_4px_rgba(0,0,0,0.05)] tracking-wide"
            type="button"
          >
            <svg aria-hidden="true" className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" fillRule="evenodd" />
            </svg>
            Continue with GitHub
          </button>

          <p className="text-sm text-gray-500 text-center mt-6">
            Don&apos;t have an account?{' '}
            <Link to="/" className="text-deep-olive hover:text-soft-sage transition-colors font-medium">Request access</Link>
          </p>
        </div>

        {/* Footer / Legal */}
        <div className="mt-8 text-center flex justify-center gap-4">
          <a className="text-[11px] font-medium text-gray-400 hover:text-deep-olive transition-colors" href="#">Privacy Policy</a>
          <a className="text-[11px] font-medium text-gray-400 hover:text-deep-olive transition-colors" href="#">Terms of Service</a>
        </div>
      </main>
    </div>
  );
}
