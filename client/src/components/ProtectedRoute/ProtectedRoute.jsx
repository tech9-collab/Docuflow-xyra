import { Navigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, isTokenValid } = useAuth();

  // Check both React state AND that the stored token is still valid
  const token = localStorage.getItem("token");
  if (!isAuthenticated || !isTokenValid(token)) {
    // Only show the "session_expired" message if there was a token but it's now invalid
    // If there is no token at all, it's just a regular first-time login
    const errorParam = token ? "?error=session_expired" : "";
    return <Navigate to={`/login${errorParam}`} replace />;
  }

  return children;
};

export default ProtectedRoute;
