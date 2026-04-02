import { Link } from "react-router-dom";
import "./NotFound.css";

export default function NotFound() {
    return (
        <div className="nf">
            <h1>404</h1>
            <p className="muted">The page you are looking for doesn’t exist.</p>
            <Link to="/converts/bank-statement" className="btn">Go to Bank Statement</Link>
        </div>
    );
}
