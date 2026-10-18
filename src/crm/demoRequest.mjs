// Demo-request validation and HubSpot Forms API mapping. Shared by the local
// dev server and the demo-request Lambda.

export const BUSINESS_TYPES = ['restaurant_group', 'single_restaurant', 'caterer', 'commercial_kitchen', 'supplier_distributor', 'other'];
export const CONSENT_TEXT = 'I agree that PantryCircuit may contact me about this demo request and store the details I have provided.';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function validateDemoRequest(body) {
  const errors = {};
  const b = body && typeof body === 'object' ? body : {};
  // Honeypot: bots fill hidden fields. Report success without forwarding.
  if (str(b.website, 200)) return { ok: true, spam: true, value: null, errors };
  const value = {
    firstname: str(b.firstname, 80),
    lastname: str(b.lastname, 80),
    email: str(b.email, 200).toLowerCase(),
    company: str(b.company, 120),
    jobtitle: str(b.jobtitle, 120),
    business_type: str(b.business_type, 40),
    location_count: Number.parseInt(b.location_count, 10),
    message: str(b.message, 1000),
    consent: b.consent === true || b.consent === 'true' || b.consent === 'on',
  };
  if (!value.firstname) errors.firstname = 'Enter your first name.';
  if (!value.lastname) errors.lastname = 'Enter your last name.';
  if (!EMAIL.test(value.email)) errors.email = 'Enter a valid work email.';
  if (!value.company) errors.company = 'Enter your business name.';
  if (!BUSINESS_TYPES.includes(value.business_type)) errors.business_type = 'Choose the option that fits best.';
  if (!Number.isInteger(value.location_count) || value.location_count < 1 || value.location_count > 5000) errors.location_count = 'Enter a number of locations between 1 and 5,000.';
  if (!value.consent) errors.consent = 'Please confirm consent so we can contact you.';
  return { ok: Object.keys(errors).length === 0, spam: false, value, errors };
}

/** HubSpot Forms API v3 submission body. Custom properties are defined in docs/hubspot-crm-plan.md. */
export function toHubSpotSubmission(v, { pageUri, pageName = 'PantryCircuit – Request a demo', hutk } = {}) {
  const f = (name, value) => ({ objectTypeId: '0-1', name, value: String(value) });
  const fields = [
    f('firstname', v.firstname), f('lastname', v.lastname), f('email', v.email), f('company', v.company),
    f('pc_business_type', v.business_type), f('pc_location_count', v.location_count),
  ];
  if (v.jobtitle) fields.push(f('jobtitle', v.jobtitle));
  if (v.message) fields.push(f('pc_demo_notes', v.message));
  return {
    submittedAt: Date.now(),
    fields,
    context: { ...(hutk ? { hutk } : {}), ...(pageUri ? { pageUri } : {}), pageName },
    legalConsentOptions: { consent: { consentToProcess: true, text: CONSENT_TEXT } },
  };
}

export async function submitToHubSpot({ portalId, formGuid, submission, fetchImpl = fetch }) {
  const url = `https://api.hsforms.com/submissions/v3/integration/submit/${encodeURIComponent(portalId)}/${encodeURIComponent(formGuid)}`;
  const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(submission) });
  if (!res.ok) throw new Error(`HubSpot responded ${res.status}`);
  return true;
}
