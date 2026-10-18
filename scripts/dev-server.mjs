// Zero-dependency dev server: serves web/, the shared engine, demo data, and a
// demo-request endpoint. Without HUBSPOT_PORTAL_ID/HUBSPOT_FORM_GUID the request
// is validated and written to .local/demo-requests.jsonl instead of HubSpot.
import { createServer } from 'node:http';
import { appendFileSync, mkdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDemoRequest, toHubSpotSubmission, submitToHubSpot } from '../src/crm/demoRequest.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const MOUNTS = [['/engine/', 'src/engine'], ['/data/', 'data/demo'], ['/', 'web']];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.csv': 'text/csv; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const PORT = Number(process.env.PORT || 4173);

function resolveFile(pathname) {
  for (const [prefix, dir] of MOUNTS) {
    if (!pathname.startsWith(prefix)) continue;
    let rel = decodeURIComponent(pathname.slice(prefix.length));
    const base = resolve(ROOT, dir);
    let file = resolve(base, normalize(rel));
    if (file !== base && !file.startsWith(base + sep)) return null; // path traversal guard
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (existsSync(file) && statSync(file).isFile()) return file;
  }
  return null;
}

async function readBody(req, limit = 20000) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > limit) throw Object.assign(new Error('too large'), { status: 413 }); chunks.push(c); }
  return Buffer.concat(chunks).toString('utf8');
}

const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'POST' && url.pathname === '/api/demo-request') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const v = validateDemoRequest(body);
      if (!v.ok) return json(res, 422, { ok: false, errors: v.errors });
      if (v.spam) return json(res, 200, { ok: true });
      const { HUBSPOT_PORTAL_ID: portalId, HUBSPOT_FORM_GUID: formGuid } = process.env;
      if (portalId && formGuid) {
        await submitToHubSpot({ portalId, formGuid, submission: toHubSpotSubmission(v.value, { pageUri: req.headers.referer }) });
        return json(res, 200, { ok: true, delivered: 'hubspot' });
      }
      mkdirSync(join(ROOT, '.local'), { recursive: true });
      appendFileSync(join(ROOT, '.local', 'demo-requests.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...v.value }) + '\n');
      return json(res, 200, { ok: true, delivered: 'local-file' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' });
    const file = resolveFile(url.pathname);
    if (!file) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : readFileSync(file));
  } catch (err) {
    json(res, err.status || (err instanceof SyntaxError ? 400 : 500), { ok: false, error: err.status === 413 ? 'Request too large' : err instanceof SyntaxError ? 'Invalid JSON' : 'Server error' });
    if (!err.status && !(err instanceof SyntaxError)) console.error(err);
  }
}).listen(PORT, () => console.log(`PantryCircuit dev server: http://localhost:${PORT}  (app: /app/)`));
