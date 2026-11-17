/**
 * Outgoing mail over SMTP (same setup as TransferNews: nodemailer + EMAIL_* env).
 * Works with Gmail (smtp.gmail.com:587 + an app password), a mailbox on your own
 * domain, or any SMTP relay.
 *
 *   EMAIL_HOST, EMAIL_PORT (587 = STARTTLS, 465 = TLS), EMAIL_USER, EMAIL_PASS, EMAIL_FROM
 *
 * Without EMAIL_HOST, mails are only printed to the server log when EMAIL_DEV_LOG=1 (set by the
 * local docker-compose.yml). Otherwise sending fails, so in production a login code never ends
 * up only in a log. EMAIL_REQUIRE_TLS=0 allows a plain local relay (tests only).
 */
import nodemailer, { type Transporter } from "nodemailer";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export class MailNotConfiguredError extends Error {
  constructor() {
    super("Mail is not configured (EMAIL_HOST / EMAIL_USER / EMAIL_PASS)");
  }
}

let transporter: Transporter | undefined;

export function isMailConfigured(): boolean {
  return Boolean(process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS);
}

function getTransporter(): Transporter {
  if (!transporter) {
    const port = Number(process.env.EMAIL_PORT || 587);
    transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port,
      secure: port === 465,
      requireTLS: port !== 465 && process.env.EMAIL_REQUIRE_TLS !== "0",
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }
  return transporter;
}

export async function sendMail(mail: Mail): Promise<void> {
  if (!isMailConfigured()) {
    if (process.env.EMAIL_DEV_LOG !== "1") throw new MailNotConfiguredError();
    console.log(`[mail:dev] to=${mail.to} subject="${mail.subject}"\n${mail.text}`);
    return;
  }
  await getTransporter().sendMail({
    from: { name: "Feelgood Brothers", address: process.env.EMAIL_FROM || process.env.EMAIL_USER || "" },
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
