// Transactional email through Resend (https://resend.com, free tier). Needs RESEND_API_KEY + MAIL_FROM.
import type { Env } from './types';

export function mailConfigured(env: Env): boolean {
  return !!(env.RESEND_API_KEY && env.MAIL_FROM);
}

export async function sendMail(env: Env, to: string, subject: string, text: string, html?: string): Promise<void> {
  if (!mailConfigured(env)) throw new Error('Email sending is not configured on this server');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.RESEND_API_KEY}` },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text, html: html || `<pre style="font-family:system-ui;white-space:pre-wrap">${text.replace(/</g, '&lt;')}</pre>` }),
  });
  if (!res.ok) throw new Error(`Sending the email failed (HTTP ${res.status})`);
}
