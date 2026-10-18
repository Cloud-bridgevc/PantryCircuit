// Runs after the forecast: emails one digest per location of new critical/warning alerts via Amazon SES.
import { createRepo, getDb } from './repo.mjs';

export function buildDigest(locationName, alerts) {
  const crit = alerts.filter((a) => a.severity === 'critical');
  const lines = [`PantryCircuit alerts for ${locationName}`, 'Forecast-based estimates; verify against your stock before acting.', ''];
  for (const [label, list] of [['CRITICAL', crit], ['ATTENTION', alerts.filter((a) => a.severity === 'warning')]]) {
    if (!list.length) continue;
    lines.push(label);
    for (const a of list) lines.push(`- ${a.title}`, `  ${a.detail}`, `  Action: ${a.action}`);
    lines.push('');
  }
  return { subject: `${crit.length ? `[${crit.length} critical] ` : ''}PantryCircuit alerts – ${locationName}`, text: lines.join('\n') };
}

export async function run({ repo, send }) {
  const out = [];
  for (const loc of await repo.activeLocations()) {
    if (!loc.notification_emails?.length) continue;
    const alerts = await repo.unnotifiedAlerts(loc.id);
    if (!alerts.length) continue;
    const { subject, text } = buildDigest(loc.name, alerts);
    await send({ to: loc.notification_emails, subject, text });
    await repo.markNotified(alerts.map((a) => a.id)); // only after a successful send
    out.push({ location: loc.id, alerts: alerts.length });
  }
  return out;
}

export const handler = async () => {
  const { SESv2Client, SendEmailCommand } = await import('@aws-sdk/client-sesv2');
  const ses = new SESv2Client({});
  const send = ({ to, subject, text }) => ses.send(new SendEmailCommand({ FromEmailAddress: process.env.SES_FROM_ADDRESS, Destination: { ToAddresses: to }, Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: text } } } } }));
  return run({ repo: createRepo(await getDb()), send });
};
