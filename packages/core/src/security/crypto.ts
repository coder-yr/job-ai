// packages/core/src/security/crypto.ts  - encrypt secrets (e.g. IMAP app password) at rest
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const key = (passphrase: string, salt: Buffer) => scryptSync(passphrase, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

export function encryptSecret(plain: string, passphrase: string): string {
  const salt = randomBytes(16), iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(passphrase, salt), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([salt, iv, c.getAuthTag(), body]).toString("base64");
}

export function decryptSecret(blob: string, passphrase: string): string {
  const raw = Buffer.from(blob, "base64");
  const salt = raw.subarray(0, 16), iv = raw.subarray(16, 28), tag = raw.subarray(28, 44), body = raw.subarray(44);
  const d = createDecipheriv("aes-256-gcm", key(passphrase, salt), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]).toString("utf8");   // throws if tampered/wrong key
}
