// S3 ObjectCreated on uploads/sales/<locationId>/<file>.csv → validate and upsert into sales_daily.
import { parseSalesCsv } from '../src/engine/csv.mjs';
import { createRepo, getDb } from './repo.mjs';

const MAX_BYTES = 5_000_000;

export async function processObject({ repo, bucket, key, size, readText }) {
  const imp = await repo.importByKey(bucket, key);
  if (!imp) return { key, skipped: 'no import record for this object' };
  if (size > MAX_BYTES) { await repo.finishImport(imp.id, 'rejected', 0, ['File exceeds 5 MB.']); return { key, rejected: true }; }
  const menu = await repo.menuItemsFor(imp.location_id);
  const parsed = parseSalesCsv(await readText(), menu);
  if (parsed.errors.length) { await repo.finishImport(imp.id, 'rejected', 0, parsed.errors.slice(0, 50)); return { key, rejected: true, errors: parsed.errors.length }; }
  await repo.upsertSales({ locationId: imp.location_id, importId: imp.id, rows: parsed.rows });
  await repo.finishImport(imp.id, 'imported', parsed.rows.length, parsed.warnings);
  return { key, imported: parsed.rows.length };
}

export const handler = async (event) => {
  const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({});
  const repo = createRepo(await getDb());
  const out = [];
  for (const rec of event.Records || []) {
    const bucket = rec.s3.bucket.name;
    const key = decodeURIComponent(rec.s3.object.key.replace(/\+/g, ' '));
    out.push(await processObject({ repo, bucket, key, size: rec.s3.object.size, readText: async () => (await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))).Body.transformToString() }));
  }
  return out;
};
