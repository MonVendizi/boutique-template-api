const INDEXNOW_KEY = process.env.INDEXNOW_KEY || "";
const SITE_URL = (
  process.env.SITE_URL ||
  process.env.FRONTEND_URL ||
  ""
).replace(/\/$/, "");

export async function notifyIndexNow(urls) {
  if (!INDEXNOW_KEY || !SITE_URL) return;
  const list = Array.isArray(urls) ? urls : [urls];
  const urlList = list
    .filter(Boolean)
    .map((u) => (String(u).startsWith("http") ? String(u) : `${SITE_URL}${u}`));
  if (!urlList.length) return;

  try {
    await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        host: new URL(SITE_URL).hostname,
        key: INDEXNOW_KEY,
        keyLocation: `${SITE_URL}/${INDEXNOW_KEY}.txt`,
        urlList,
      }),
    });
  } catch {
    /* IndexNow optionnel */
  }
}
