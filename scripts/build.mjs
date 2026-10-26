// Build script for production deployment (e.g. Vercel, static hosting).
// Assembles web/, src/engine/, and data/demo/ into the public/ directory.
import { rmSync, mkdirSync, cpSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = resolve(ROOT, 'public');

console.log('Building PantryCircuit static distribution to', OUT);

// Clean previous build output
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// Copy web/ to public/
cpSync(resolve(ROOT, 'web'), OUT, { recursive: true });

// Copy src/engine/ to public/engine/
cpSync(resolve(ROOT, 'src/engine'), resolve(OUT, 'engine'), { recursive: true });

// Copy data/demo/ to public/data/
cpSync(resolve(ROOT, 'data/demo'), resolve(OUT, 'data'), { recursive: true });

console.log('Build complete. Output written to public/');
