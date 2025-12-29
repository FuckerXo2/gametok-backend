// Simple JSON file database using lowdb
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Default data structure
const defaultData = {
  games: [],
  users: [],
  scores: [],
  likes: []
};

// Setup database
const file = join(__dirname, '../db.json');
const adapter = new JSONFile(file);
const db = new Low(adapter, defaultData);

// Initialize
await db.read();
db.data ||= defaultData;
await db.write();

export default db;
