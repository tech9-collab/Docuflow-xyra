import { Navigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, isTokenValid } = useAuth();

  // Check both React state AND that the stored token is still valid
  const token = localStorage.getItem("token");
  if (!isAuthenticated || !isTokenValid(token)) {
    return <Navigate to="/login?error=session_expired" replace />;
  }

  return children;
};

export default ProtectedRoute;
