// Public API: POST /demo-request → validate → HubSpot Forms API (no secret needed; the form GUID is public by design).
import { validateDemoRequest, toHubSpotSubmission, submitToHubSpot } from '../src/crm/demoRequest.mjs';

const resp = (status, body) => ({ statusCode: status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export async function handle({ body, headers = {}, env, fetchImpl }) {
  let parsed;
  try { parsed = JSON.parse(body || '{}'); } catch { return resp(400, { ok: false, error: 'Invalid JSON' }); }
  const v = validateDemoRequest(parsed);
  if (!v.ok) return resp(422, { ok: false, errors: v.errors });
  if (v.spam) return resp(200, { ok: true });
  try {
    await submitToHubSpot({ portalId: env.HUBSPOT_PORTAL_ID, formGuid: env.HUBSPOT_FORM_GUID, submission: toHubSpotSubmission(v.value, { pageUri: headers.referer || headers.Referer }), fetchImpl });
    return resp(200, { ok: true });
  } catch (err) {
    console.error('HubSpot submission failed', err.message);
    return resp(502, { ok: false, error: 'Could not record your request right now. Please try again shortly.' });
  }
}

export const handler = (event) => handle({ body: event.body, headers: event.headers, env: process.env, fetchImpl: fetch });
