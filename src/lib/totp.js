import crypto from "crypto";
import { generateSecret, generateURI, verifySync } from "otplib";
import QRCode from "qrcode";
import pool from "../db/pool.js";

const KEY_SECRET = "totp_secret";
const KEY_ENABLED = "totp_enabled";
const KEY_PENDING = "totp_pending_secret";
const KEY_BACKUP = "totp_backup_codes";

async function getSetting(key) {
  try {
    const { rows } = await pool.query(
      `SELECT value FROM brand_settings WHERE key = $1 LIMIT 1`,
      [key],
    );
    const value = rows[0]?.value;
    return value != null && String(value).trim() !== ""
      ? String(value)
      : null;
  } catch {
    return null;
  }
}

async function setSetting(key, value, label) {
  await pool.query(
    `
    INSERT INTO brand_settings (key, value, type, category, label)
    VALUES ($1, $2, 'string', 'security', $3)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `,
    [key, String(value ?? ""), label],
  );
}

async function deleteSetting(key) {
  await pool.query(`DELETE FROM brand_settings WHERE key = $1`, [key]);
}

function hashBackupCode(code) {
  return crypto.createHash("sha256").update(String(code).trim()).digest("hex");
}

function generateBackupCodes(count = 8) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    codes.push(crypto.randomBytes(4).toString("hex"));
  }
  return codes;
}

function checkTotp(code, secret) {
  try {
    const result = verifySync({
      secret,
      token: String(code || "").trim(),
    });
    return Boolean(result?.valid);
  } catch {
    return false;
  }
}

export async function getTotpStatus() {
  const enabled = (await getSetting(KEY_ENABLED)) === "true";
  const hasSecret = Boolean(await getSetting(KEY_SECRET));
  return { enabled: enabled && hasSecret };
}

export async function beginTotpSetup(issuerName) {
  const secret = generateSecret();
  await setSetting(KEY_PENDING, secret, "TOTP pending");
  const issuer = issuerName || "Vendizi Admin";
  const otpauth = generateURI({
    issuer,
    label: "admin",
    secret,
  });
  const qrDataUrl = await QRCode.toDataURL(otpauth, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 220,
  });
  return { secret, otpauth, qrDataUrl };
}

export async function enableTotp(code) {
  const pending = await getSetting(KEY_PENDING);
  if (!pending) {
    return { ok: false, error: "Aucune configuration 2FA en cours" };
  }
  if (!checkTotp(code, pending)) {
    return { ok: false, error: "Code incorrect" };
  }
  const backupCodes = generateBackupCodes(8);
  await setSetting(KEY_SECRET, pending, "TOTP secret");
  await setSetting(KEY_ENABLED, "true", "TOTP enabled");
  await setSetting(
    KEY_BACKUP,
    JSON.stringify(backupCodes.map(hashBackupCode)),
    "TOTP backup hashes",
  );
  await deleteSetting(KEY_PENDING);
  return { ok: true, backupCodes };
}

export async function disableTotp(code) {
  const status = await getTotpStatus();
  if (!status.enabled) {
    return { ok: false, error: "2FA déjà désactivé" };
  }
  const verified = await verifyTotpOrBackup(code);
  if (!verified.ok) {
    return { ok: false, error: verified.error || "Code incorrect" };
  }
  await deleteSetting(KEY_SECRET);
  await deleteSetting(KEY_ENABLED);
  await deleteSetting(KEY_BACKUP);
  await deleteSetting(KEY_PENDING);
  return { ok: true };
}

export async function verifyTotpOrBackup(code) {
  const raw = String(code || "").trim().replace(/\s+/g, "");
  if (!raw) {
    return { ok: false, error: "Code requis" };
  }

  const status = await getTotpStatus();
  if (!status.enabled) {
    return { ok: false, error: "2FA non activé — activez-le avant un virement" };
  }

  const secret = await getSetting(KEY_SECRET);
  if (secret && checkTotp(raw, secret)) {
    return { ok: true, method: "totp" };
  }

  const backupRaw = await getSetting(KEY_BACKUP);
  if (backupRaw) {
    try {
      const hashes = JSON.parse(backupRaw);
      if (Array.isArray(hashes)) {
        const hashed = hashBackupCode(raw);
        const idx = hashes.indexOf(hashed);
        if (idx >= 0) {
          const next = hashes.filter((_, i) => i !== idx);
          await setSetting(
            KEY_BACKUP,
            JSON.stringify(next),
            "TOTP backup hashes",
          );
          return { ok: true, method: "backup" };
        }
      }
    } catch {
      /* ignore */
    }
  }

  return { ok: false, error: "Code incorrect" };
}
