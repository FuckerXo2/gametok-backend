#!/usr/bin/env node

import 'dotenv/config';
import { getAssetRuntimeDiagnostics } from '../src/ai-engine/asset-dictionary.js';

const diagnostics = getAssetRuntimeDiagnostics();

console.log(JSON.stringify(diagnostics, null, 2));
