import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Home from './pages/Home';
import CallGraph from './pages/CallGraph';
import ControlFlow from './pages/ControlFlow';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/home" element={<Home />} />
        <Route path="/workspace/call-graph" element={<CallGraph />} />
        <Route path="/workspace/control-flow" element={<ControlFlow />} />
        <Route path="/workspace" element={<RedirectWithSearch to="/workspace/call-graph" />} />
      </Routes>
    </BrowserRouter>
  );
}

function RedirectWithSearch({ to }) {
  const search = typeof window !== 'undefined' ? window.location.search : '';
  return <Navigate to={`${to}${search}`} replace />;
}

export default App;
