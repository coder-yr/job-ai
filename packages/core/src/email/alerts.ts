// packages/core/src/email/alerts.ts
// Reads job-alert e-mails that YOU subscribed to on LinkedIn / Indeed / Naukri, from YOUR mailbox.
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

export interface AlertLink { url: string; text: string }

// Edit to match the links in YOUR alert e-mails (copy a real one and look at the hrefs).
const JOB_LINK = /^https:\/\/([a-z]+\.)?(linkedin\.com\/comm\/jobs\/view|linkedin\.com\/jobs\/view|indeed\.com\/(viewjob|rc\/clk)|naukri\.com\/job-listings)/i;

export function extractAlertLinks(html: string): AlertLink[] {
  const out = new Map<string, AlertLink>();
  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = m[1]!.replace(/&amp;/g, "&");
    const text = m[2]!.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (JOB_LINK.test(url) && text.length > 3) out.set(url.split("?")[0]!, { url, text });
  }
  return [...out.values()];
}

export async function pollAlerts(opts: {
  host: string; user: string; appPassword: string; senders: string[]; since: Date;
}): Promise<{ from: string; subject: string; messageId: string; links: AlertLink[] }[]> {
  const client = new ImapFlow({ host: opts.host, port: 993, secure: true,
    auth: { user: opts.user, pass: opts.appPassword }, logger: false });
  const results: { from: string; subject: string; messageId: string; links: AlertLink[] }[] = [];
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    for (const sender of opts.senders) {
      const uids = (await client.search({ from: sender, since: opts.since })) || [];
      for await (const msg of client.fetch(uids, { source: true })) {
        if (!msg.source) continue;
        const mail = await simpleParser(msg.source);
        results.push({ from: sender, subject: mail.subject ?? "", messageId: mail.messageId ?? String(msg.uid),
                       links: extractAlertLinks(typeof mail.html === "string" ? mail.html : "") });
      }
    }
  } finally { lock.release(); await client.logout(); }
  return results;
}
