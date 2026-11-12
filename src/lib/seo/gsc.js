import { GoogleAuth } from "google-auth-library";

const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const SEARCH_ANALYTICS_BASE =
  "https://www.googleapis.com/webmasters/v3/sites";

export class GscAccessError extends Error {
  constructor(message, opts = {}) {
    super(message);
    this.name = "GscAccessError";
    this.code = opts.code || "GSC_ERROR";
    this.serviceAccountEmail = opts.serviceAccountEmail || null;
    this.siteUrl = opts.siteUrl || "";
  }
}

export function loadGoogleServiceAccountCredentials() {
  const sources = [
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
    process.env.GOOGLE_CREDENTIALS,
  ];
  for (const source of sources) {
    const raw = String(source || "").trim();
    if (!raw || raw === "{}" || raw === "file") continue;
    let credentials = JSON.parse(raw);
    if (typeof credentials === "string") credentials = JSON.parse(credentials);
    if (!credentials || typeof credentials !== "object") continue;
    if (credentials.type !== "service_account") continue;
    if (
      typeof credentials.client_email !== "string" ||
      typeof credentials.private_key !== "string"
    ) {
      continue;
    }
    credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
    return credentials;
  }
  throw new Error(
    "JSON de compte de service manquant (GOOGLE_CREDENTIALS)",
  );
}

export function getServiceAccountEmail(credentials) {
  try {
    const creds = credentials || loadGoogleServiceAccountCredentials();
    return creds?.client_email || null;
  } catch {
    return null;
  }
}

export function normalizeGscSiteUrl(raw) {
  const value = String(raw || "")
    .trim()
    .replace(/\/+$/, "");
  if (!value) throw new Error("URL Search Console manquante");
  if (value.startsWith("sc-domain:")) {
    const host = value.slice("sc-domain:".length).trim().toLowerCase();
    if (!host) throw new Error("sc-domain invalide");
    return `sc-domain:${host}`;
  }
  let url = value;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return `${new URL(url).origin}/`;
}

async function getAccessToken(credentials) {
  const auth = new GoogleAuth({ credentials, scopes: [GSC_SCOPE] });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const token =
    typeof tokenResponse === "string"
      ? tokenResponse
      : tokenResponse?.token || "";
  if (!token) throw new Error("Impossible d'obtenir un jeton Google");
  return token;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function gscFetch(url, token, init) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });
    if (res.ok) return res.json();
    const bodyText = await res.text().catch(() => "");
    let apiMessage = bodyText.slice(0, 400);
    try {
      const parsed = JSON.parse(bodyText);
      if (parsed?.error?.message) apiMessage = parsed.error.message;
    } catch {
      // keep
    }
    if (res.status === 429 || res.status >= 500) {
      lastError = new Error(
        `GSC HTTP ${res.status}${apiMessage ? ` — ${apiMessage}` : ""}`,
      );
      await sleep(500 * 2 ** attempt);
      continue;
    }
    const err = new Error(
      `GSC HTTP ${res.status}${apiMessage ? ` — ${apiMessage}` : ""}`,
    );
    err.status = res.status;
    throw err;
  }
  throw lastError || new Error("GSC : échec après 3 tentatives");
}

export async function querySearchAnalytics(input) {
  const credentials = loadGoogleServiceAccountCredentials();
  const email = getServiceAccountEmail(credentials);
  const siteUrl = normalizeGscSiteUrl(input.siteUrl);
  const token = await getAccessToken(credentials);
  const url = `${SEARCH_ANALYTICS_BASE}/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;

  try {
    return await gscFetch(url, token, {
      method: "POST",
      body: JSON.stringify({
        startDate: input.startDate,
        endDate: input.endDate,
        dimensions: input.dimensions || ["query"],
        rowLimit: input.rowLimit ?? 10,
        startRow: input.startRow ?? 0,
        type: input.type || "web",
        dataState: input.dataState || "final",
      }),
    });
  } catch (error) {
    const status = error?.status || 0;
    const msg = error instanceof Error ? error.message : String(error);
    const isForbidden =
      status === 403 ||
      /forbidden|permission|access|not.*user|does not have/i.test(msg);
    if (isForbidden) {
      throw new GscAccessError(
        `Le compte de service n'a pas accès à Search Console « ${siteUrl} ». Ajoutez : ${email || "(email inconnu)"}`,
        {
          code: "GSC_FORBIDDEN",
          serviceAccountEmail: email,
          siteUrl,
        },
      );
    }
    throw error;
  }
}
