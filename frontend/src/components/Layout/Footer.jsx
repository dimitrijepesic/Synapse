export default function Footer() {
  return (
    <footer className="w-full py-4 sm:py-6 px-4 sm:px-6 flex flex-col sm:flex-row justify-between items-center gap-2 tracking-tight bg-white border-t border-gray-100 font-grotesk text-xs font-medium text-gray-500 z-50">
      <span>&copy; 2024 Synapse Engineering</span>
      <div className="flex gap-4 sm:gap-6">
        <a className="hover:text-gray-900 transition-colors" href="#">API Status</a>
        <a className="hover:text-gray-900 transition-colors" href="#">Privacy</a>
        <a className="hover:text-gray-900 transition-colors" href="#">Terms</a>
        <a className="hover:text-gray-900 transition-colors" href="#">Github</a>
      </div>
    </footer>
  );
}
