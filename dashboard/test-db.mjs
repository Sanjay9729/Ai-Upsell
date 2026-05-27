import dotenv from 'dotenv';
import path from 'path';

// Load .env from the root directory
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

console.log('MONGO_URI:', process.env.MONGODB_URI ? process.env.MONGODB_URI.substring(0, 30) + '...' : 'undefined');
console.log('CWD:', process.cwd());
