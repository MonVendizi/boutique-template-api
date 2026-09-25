function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function pollApifyDataset(runId, apifyKey, label, maxPolls = 30, itemLimit = 200) {
  for (let i = 0; i < maxPolls; i++) {
    await sleep(3000);
    const statusRes = await fetch(
      `https://api.apify.com/v2/actor-runs/${runId}?token=${apifyKey}`
    );
    const statusData = await statusRes.json();
    const status = statusData?.data?.status;
    console.log(`${label} polling ${i + 1}/${maxPolls} — status: ${status}`);

    if (status === "SUCCEEDED") {
      const datasetId = statusData.data.defaultDatasetId;
      const dataRes = await fetch(
        `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apifyKey}&limit=${itemLimit}`
      );
      const items = await dataRes.json();
      return Array.isArray(items) ? items : [];
    }
    if (status === "FAILED" || status === "ABORTED") {
      throw new Error(`Apify run ${label} ${status}`);
    }
  }
  return [];
}

function commentUsername(c) {
  return String(c.ownerUsername || c.username || "")
    .replace(/^@/, "")
    .trim();
}

function commentText(c) {
  return String(c.text || "").trim();
}

function detectTarget(c, targets) {
  const hay = `${c.postUrl || ""} ${c.url || ""}`.toLowerCase();
  for (const t of targets) {
    const clean = t.replace(/^@/, "").toLowerCase();
    if (clean && hay.includes(`/${clean}`)) return clean;
  }
  return targets[0]?.replace(/^@/, "") || "concurrent";
}

function parseJsonObject(raw) {
  const cleaned = String(raw || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function filterFrustratedBatch(batch, targets) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];

  const frustrationPrompt = `Tu analyses des commentaires Instagram laissés sur les pages de concurrents e-commerce (Shopify, Wix, etc.).

Voici ${batch.length} commentaires :
${batch.map((c, i) => `${i + 1}. @${commentUsername(c) || "inconnu"} : "${commentText(c)}"`).join("\n")}

Identifie UNIQUEMENT les commentaires qui expriment :
- Une frustration avec leur site actuel
- Un problème technique (bug, panne, lenteur)
- Un mécontentement avec les prix ou les commissions
- Une demande d'aide désespérée
- Un abandon de leur boutique en ligne

Réponds en JSON uniquement :
{
  "frustrated": [
    {
      "index": <numéro du commentaire>,
      "username": "@username",
      "comment": "texte du commentaire",
      "reason": "raison de la frustration en 5 mots",
      "urgency": "haute|moyenne"
    }
  ]
}`;

  const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      messages: [{ role: "user", content: frustrationPrompt }],
    }),
  });

  if (!claudeRes.ok) {
    const errText = await claudeRes.text().catch(() => "");
    console.error("Claude frustration filter error:", claudeRes.status, errText);
    return [];
  }

  const claudeData = await claudeRes.json();
  const text = String(claudeData.content?.[0]?.text || "");
  const parsed = parseJsonObject(text);
  const list = Array.isArray(parsed?.frustrated) ? parsed.frustrated : [];

  const hits = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const index = Number(item.index);
    if (!Number.isFinite(index) || index < 1 || index > batch.length) continue;
    const source = batch[index - 1];
    const username = String(item.username || commentUsername(source) || "")
      .replace(/^@/, "")
      .trim();
    if (!username) continue;
    const comment = String(item.comment || commentText(source) || "").trim();
    if (!comment) continue;
    hits.push({
      username,
      comment,
      reason: String(item.reason || "frustration détectée").trim(),
      urgency: item.urgency === "haute" ? "haute" : "moyenne",
      target: detectTarget(source, targets),
    });
  }
  return hits;
}

async function analyzeMapsIndependence(place) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const title = String(place.title || place.name || "").trim();
  const category = String(place.categoryName || place.category || "").trim();
  const address = String(place.address || "").trim();
  const website = place.website ? String(place.website) : "aucun";
  const score = place.totalScore ?? "?";
  const reviews = place.reviewsCount ?? 0;

  const claudePrompt = `Tu es un assistant commercial pour un artisan français.

Voici la fiche Google Maps d'un établissement :
Nom : ${title}
Catégorie : ${category}
Adresse : ${address}
Site web : ${website}
Note Google : ${score}/5 (${reviews} avis)

Détermine si c'est un établissement INDÉPENDANT (pas une chaîne nationale/internationale)
   → indépendant si : nom unique, pas de numéro dans le nom, site web artisanal
   → chaîne si : Yves Rocher, L'Occitane, The Body Shop, etc.

Réponds en JSON uniquement :
{
  "is_independent": true/false,
  "reason": "explication courte"
}`;

  const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [{ role: "user", content: claudePrompt }],
    }),
  });

  if (!claudeRes.ok) {
    const errText = await claudeRes.text().catch(() => "");
    console.error("Claude maps analysis error:", claudeRes.status, errText);
    return null;
  }

  const claudeData = await claudeRes.json();
  const parsed = parseJsonObject(String(claudeData.content?.[0]?.text || ""));
  if (!parsed) return null;

  return {
    is_independent: Boolean(parsed.is_independent),
    reason: String(parsed.reason || "").trim(),
  };
}

function extractPostUrl(post) {
  const direct = String(post.url || post.postUrl || "").trim();
  if (direct.includes("instagram.com")) return direct;
  const shortCode = String(post.shortCode || post.shortcode || "").trim();
  if (shortCode) return `https://www.instagram.com/p/${shortCode}/`;
  return null;
}

export function missingKeysReply() {
  if (!process.env.APIFY_API_KEY) {
    return {
      status: 503,
      body: {
        error: "APIFY_API_KEY non configurée",
        code: "missing_apify_key",
      },
    };
  }
  return null;
}

export function missingClaudeReply() {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      status: 500,
      body: { error: "ANTHROPIC_API_KEY non configuré" },
    };
  }
  return null;
}

export async function runInstagramBioProspection(body) {
  const apifyKey = process.env.APIFY_API_KEY;
  const keywords = Array.isArray(body.keywords)
    ? body.keywords.map((k) => String(k).trim()).filter(Boolean)
    : [];
  const min_followers = Number(body.min_followers) || 1000;
  const max_followers = Number(body.max_followers) || 15000;

  if (keywords.length === 0) {
    return {
      status: 400,
      body: { error: "Au moins un mot-clé est requis" },
    };
  }

  const apifyRes = await fetch(
    `https://api.apify.com/v2/actors/khadinakbar~instagram-keyword-search-scraper/runs?token=${apifyKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keywords }),
    }
  );

  const apifyData = await apifyRes.json();
  console.log("Apify response status:", apifyRes.status);
  console.log("Apify run id:", apifyData?.data?.id);

  if (!apifyRes.ok || !apifyData?.data?.id) {
    throw new Error(`Apify error: ${JSON.stringify(apifyData)}`);
  }

  const results = await pollApifyDataset(
    apifyData.data.id,
    apifyKey,
    "bio",
    20,
    50
  );

  if (!Array.isArray(results) || results.length === 0) {
    return {
      status: 200,
      body: {
        prospects: [],
        total: 0,
        message: "Aucun profil trouvé ou run encore en cours",
      },
    };
  }

  const analyzed = results
    .map((profile) => {
      const username = String(profile.username || "");
      const followers = Number(
        profile.followerCount ?? profile.followersCount ?? profile.followers ?? 0
      );
      const biography = String(profile.biography ?? profile.bio ?? "");

      const bioLinkFromArray = Array.isArray(profile.bioLinks)
        ? String(
            typeof profile.bioLinks[0] === "string"
              ? profile.bioLinks[0]
              : profile.bioLinks[0]?.url || ""
          )
        : "";

      const siteRaw =
        profile.externalUrl ||
        profile.website ||
        profile.bioLink ||
        bioLinkFromArray ||
        profile.externalUrls?.[0] ||
        "";
      const siteUrl = String(siteRaw).toLowerCase();

      const isHighPriority =
        !siteUrl ||
        siteUrl.includes("linktree") ||
        siteUrl.includes("linktr.ee") ||
        siteUrl.includes("etsy") ||
        siteUrl.includes("vinted") ||
        siteUrl.includes("beacons") ||
        siteUrl.includes("lnk.bio") ||
        siteUrl.includes("bio.link") ||
        siteUrl.includes("stan.store");

      return {
        username,
        full_name: String(profile.fullName ?? profile.full_name ?? username),
        followers,
        bio: biography,
        website: siteRaw ? String(siteRaw) : null,
        instagram_url: `https://instagram.com/${username}`,
        priority: isHighPriority ? "haute" : "normale",
        status: "à contacter",
      };
    })
    .filter(
      (p) => p.followers >= min_followers && p.followers <= max_followers
    );

  analyzed.sort((a, b) => {
    if (a.priority === "haute" && b.priority !== "haute") return -1;
    if (b.priority === "haute" && a.priority !== "haute") return 1;
    return b.followers - a.followers;
  });

  return {
    status: 200,
    body: { prospects: analyzed, total: analyzed.length },
  };
}

export async function runCommentSniping(body) {
  const apifyKey = process.env.APIFY_API_KEY;
  const targets = Array.isArray(body.targets)
    ? body.targets
        .map((t) => String(t).trim().replace(/^@/, ""))
        .filter(Boolean)
    : [];
  const maxComments = Number(body.maxComments) || 200;

  if (targets.length === 0) {
    return {
      status: 400,
      body: { error: "Au moins un compte cible est requis" },
    };
  }

  const postsRes = await fetch(
    `https://api.apify.com/v2/actors/apify~instagram-scraper/runs?token=${apifyKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        directUrls: targets.map(
          (t) => `https://www.instagram.com/${t.replace("@", "")}/`
        ),
        resultsType: "posts",
        resultsLimit: 20,
      }),
    }
  );

  const postsRunData = await postsRes.json();
  console.log("Sniping posts Apify status:", postsRes.status);
  console.log("Sniping posts run id:", postsRunData?.data?.id);

  if (!postsRes.ok || !postsRunData?.data?.id) {
    throw new Error(`Apify posts error: ${JSON.stringify(postsRunData)}`);
  }

  const posts = await pollApifyDataset(
    postsRunData.data.id,
    apifyKey,
    "posts",
    30,
    targets.length * 10
  );

  const postUrls = [...new Set(posts.map(extractPostUrl).filter(Boolean))];
  console.log(`Posts URLs récupérées: ${postUrls.length}`);

  if (postUrls.length === 0) {
    return {
      status: 200,
      body: {
        prospects: [],
        total: 0,
        scanned: 0,
        message: "Aucun post trouvé sur les comptes cibles",
      },
    };
  }

  const commentsRes = await fetch(
    `https://api.apify.com/v2/actors/khadinakbar~instagram-comments-scraper/runs?token=${apifyKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        postUrls,
        maxComments: maxComments || 200,
      }),
    }
  );

  const commentsRunData = await commentsRes.json();
  console.log("Sniping comments Apify status:", commentsRes.status);
  console.log("Sniping comments run id:", commentsRunData?.data?.id);

  if (!commentsRes.ok || !commentsRunData?.data?.id) {
    throw new Error(`Apify comments error: ${JSON.stringify(commentsRunData)}`);
  }

  const allComments = await pollApifyDataset(
    commentsRunData.data.id,
    apifyKey,
    "comments",
    30,
    maxComments * postUrls.length
  );
  console.log(`Commentaires récupérés: ${allComments.length}`);

  const frustrated = [];
  for (let i = 0; i < allComments.length; i += 20) {
    const batch = allComments
      .slice(i, i + 20)
      .filter((c) => commentText(c) && commentUsername(c));
    if (batch.length === 0) continue;
    const hits = await filterFrustratedBatch(batch, targets);
    frustrated.push(...hits);
  }

  const seen = new Set();
  const uniqueFrustrated = frustrated.filter((f) => {
    const key = `${f.username.toLowerCase()}::${f.comment.slice(0, 80)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const prospects = uniqueFrustrated.map((f) => {
    const username = f.username.replace(/^@/, "");
    return {
      username,
      comment: f.comment,
      reason: f.reason,
      urgency: f.urgency,
      target: f.target,
      status: "à contacter",
      instagram_url: `https://instagram.com/${username}`,
    };
  });

  prospects.sort((a, b) => {
    if (a.urgency === "haute" && b.urgency !== "haute") return -1;
    if (b.urgency === "haute" && a.urgency !== "haute") return 1;
    return 0;
  });

  return {
    status: 200,
    body: {
      prospects,
      total: prospects.length,
      scanned: allComments.length,
      debug: {
        posts_found: postUrls.length,
        comments_scraped: allComments.length,
        frustrated_raw: frustrated.length,
      },
    },
  };
}

export async function runGoogleMapsProspection(body) {
  const apifyKey = process.env.APIFY_API_KEY;
  const business_type = String(body.business_type || "").trim();
  const location = String(body.location || "").trim();
  const radius_km = Number(body.radius_km) || 50;
  const maxResults = Math.min(
    40,
    Math.max(10, Number(body.max_results) || 20)
  );

  if (!business_type || !location) {
    return {
      status: 400,
      body: { error: "Type d'établissement et région/ville requis" },
    };
  }

  const apifyRes = await fetch(
    `https://api.apify.com/v2/actors/apify~google-maps-scraper/runs?token=${apifyKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        searchStringsArray: [`${business_type} ${location}`],
        maxCrawledPlacesPerSearch: maxResults,
        language: "fr",
        countryCode: "fr",
        ...(radius_km
          ? { searchMatching: "all", deeperCityScrape: false }
          : {}),
      }),
    }
  );

  const apifyData = await apifyRes.json();
  console.log("Maps Apify status:", apifyRes.status);
  console.log("Maps Apify run id:", apifyData?.data?.id);

  if (!apifyRes.ok || !apifyData?.data?.id) {
    throw new Error(`Apify error: ${JSON.stringify(apifyData)}`);
  }

  const allPlaces = await pollApifyDataset(
    apifyData.data.id,
    apifyKey,
    "maps",
    40,
    maxResults
  );
  console.log(`Établissements récupérés: ${allPlaces.length}`);

  if (!Array.isArray(allPlaces) || allPlaces.length === 0) {
    return {
      status: 200,
      body: {
        prospects: [],
        total: 0,
        scanned: 0,
        message: "Aucun établissement trouvé ou run encore en cours",
      },
    };
  }

  const independents = [];
  for (const place of allPlaces) {
    const name = String(place.title || place.name || "").trim();
    if (!name) continue;

    const analysis = await analyzeMapsIndependence(place);
    if (!analysis?.is_independent) continue;

    const phone = place.phone
      ? String(place.phone)
      : place.phoneUnformatted
        ? String(place.phoneUnformatted)
        : null;

    independents.push({
      name,
      address: String(place.address || "").trim(),
      phone,
      website: place.website ? String(place.website) : null,
      rating: typeof place.totalScore === "number" ? place.totalScore : null,
      reviews_count: Number(place.reviewsCount) || 0,
      category: String(place.categoryName || place.category || "").trim(),
      reason: analysis.reason || "établissement indépendant",
      status: "à contacter",
      maps_url: place.url ? String(place.url) : null,
    });
  }

  return {
    status: 200,
    body: {
      prospects: independents,
      total: independents.length,
      scanned: allPlaces.length,
    },
  };
}
