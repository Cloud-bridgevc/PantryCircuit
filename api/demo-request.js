// Vercel Serverless Function: POST /api/demo-request
import { validateDemoRequest, toHubSpotSubmission, submitToHubSpot } from '../src/crm/demoRequest.mjs';

async function getBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body || '{}'); } catch { return null; }
  }
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = await getBody(req);
  if (body === null) {
    return res.status(400).json({ ok: false, error: 'Invalid JSON' });
  }

  const v = validateDemoRequest(body);
  if (!v.ok) {
    return res.status(422).json({ ok: false, errors: v.errors });
  }
  if (v.spam) {
    return res.status(200).json({ ok: true });
  }

  const { HUBSPOT_PORTAL_ID: portalId, HUBSPOT_FORM_GUID: formGuid } = process.env;
  if (portalId && formGuid) {
    try {
      await submitToHubSpot({
        portalId,
        formGuid,
        submission: toHubSpotSubmission(v.value, {
          pageUri: req.headers.referer || req.headers.Referer
        })
      });
      return res.status(200).json({ ok: true, delivered: 'hubspot' });
    } catch (err) {
      console.error('HubSpot submission failed:', err?.message);
      return res.status(502).json({ ok: false, error: 'Could not record your request right now. Please try again shortly.' });
    }
  }

  // Without HubSpot configured (demo / preview deployment)
  return res.status(200).json({ ok: true, delivered: 'demo-mode' });
}
