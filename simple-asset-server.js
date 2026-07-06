#!/usr/bin/env node

/**
 * Simple Asset Server
 * Serves only the /assets directory for testing games locally
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Enable CORS for local development
app.use(cors());

// Serve assets directory
app.use('/assets', express.static(path.join(__dirname, 'public/assets')));

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'Simple Asset Server',
    assetsPath: '/assets'
  });
});

app.listen(PORT, () => {
  console.log(`✅ Simple Asset Server running on http://localhost:${PORT}`);
  console.log(`📁 Assets available at http://localhost:${PORT}/assets/`);
});
