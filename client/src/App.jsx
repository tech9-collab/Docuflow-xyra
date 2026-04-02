import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout/Layout";
import Signup from "./pages/Signup/Signup";
import Login from "./pages/Login/Login";
import routes from "./routes/index.jsx";
import ProtectedRoute from "./components/ProtectedRoute/ProtectedRoute";

export default function App() {
  return (
    <Routes>
      {/* Public auth pages */}
      <Route path="/signup" element={<Signup />} />
      <Route path="/login" element={<Login />} />

      {/* Private app under Layout */}
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        {routes.map((r) => (
          <Route key={r.path} path={r.path} element={<r.element />} />
        ))}
      </Route>

      {/* 404 fallback if not defined in routes */}
      {routes.find((r) => r.path === "*") ? null : (
        <Route path="*" element={<div>Not found</div>} />
      )}
    </Routes>
  );
}
