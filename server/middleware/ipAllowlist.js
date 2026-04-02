// middleware/ipAllowlist.js
export default function ipAllowlist(allowedIps = [], { passthrough = ['/api/health'], log = true } = {}) {
    const normalize = ip => (ip?.startsWith('::ffff:') ? ip.slice(7) : ip) || '';

    return (req, res, next) => {
        // Allow CORS preflight and explicitly open paths
        if (req.method === 'OPTIONS') return next();
        if (passthrough.some(p => req.path === p || req.path.startsWith(p + '/'))) return next();

        const clientIp = normalize(req.ip);
        const allowed = allowedIps.includes(clientIp);

        if (allowed) return next();

        if (log) console.warn(`[IP BLOCKED] ${clientIp} -> ${req.method} ${req.originalUrl}`);
        return res.status(403).json({ message: 'Access restricted: your IP is not allowed.' });
    };
}
