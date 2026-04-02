import { initializeDatabase } from './server/initDatabase.js';
import { pool } from './server/db.js';

async function run() {
    try {
        await initializeDatabase();
        console.log('Database initialized successfully');
        process.exit(0);
    } catch (err) {
        console.error('Database initialization failed:', err);
        process.exit(1);
    }
}

run();
