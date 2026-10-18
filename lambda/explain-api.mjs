// API Gateway (JWT-authorised): POST /recommendations/{id}/explain → plain-language explanation via Bedrock.
// The numbers come from the stored engine output; Bedrock only rephrases them.
import { narrate } from '../src/ai/bedrock.mjs';
import { createBedrockInvoker } from '../src/ai/bedrock.mjs';
import { createRepo, getDb } from './repo.mjs';

const UUID = /^[0-9a-f-]{36}$/i;
const resp = (status, body) => ({ statusCode: status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export async function explain({ repo, invoke, id }) {
  if (!UUID.test(id || '')) return resp(400, { error: 'Invalid recommendation id' });
  const rec = await repo.recommendation(id);
  if (!rec) return resp(404, { error: 'Not found' });
  if (rec.narrative) return resp(200, { text: rec.narrative, source: 'cache', warnings: [] });
  const result = await narrate({ invoke, explanation: rec.explanation });
  if (result.source === 'bedrock') await repo.saveNarrative(id, result.text); // never cache the fallback
  return resp(200, result);
}

export const handler = async (event) => {
  // Tenancy check (the caller's org must own the recommendation) is enforced by the authoriser claims in production; see docs/architecture.md.
  return explain({ repo: createRepo(await getDb()), invoke: await createBedrockInvoker(), id: event.pathParameters?.id });
};
