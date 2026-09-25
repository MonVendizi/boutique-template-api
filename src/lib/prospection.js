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

async function generateDm(profile, siteUrl) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return "";

  const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: `Tu es Sébastien, développeur chevronné et fondateur de Vendizi (vendizi.fr). Tu as créé cette plateforme e-commerce française pour ta femme Christina, fondatrice de la marque de soins naturels TinaLuxe (tinaluxe.fr), car elle était frustrée par la complexité technique de Shopify et dépendait constamment de toi pour la moindre modification.

Ta mission est de rédiger un premier message de prospection (DM Instagram) ULTRA-HUMAIN, bienveillant, court et percutant, adapté au profil de l'artisan fourni.

Voici les données d'entrée :
- Compte : ${profile.username} (${profile.fullName || profile.full_name || ""})
- Bio : ${profile.biography || profile.bio || "non disponible"}
- URL_Détectée : ${siteUrl || "VIDE"}

---

[RÈGLES DE RÉDACTION ABSOLUES]
1. Le ton doit être celui d'un artisan/créateur qui parle à un autre indépendant : chaleureux, direct, sans aucun jargon marketing ni blabla corporatif ("générer du trafic", "scaler", "optimiser votre ROI" sont INTERDITS). Tu es là pour rendre service.
2. Utilise le tutoiement ou le vouvoiement de manière naturelle et fluide selon le style de la bio.
3. Ne commence JAMAIS par "Je suis le fondateur de Vendizi" ou "Chez Vendizi, on propose...". Reste discret sur la marque au début.
4. Intègre obligatoirement l'histoire de ta femme Christina et le lien tinaluxe.fr comme preuve concrète.
5. Termine par une question ouverte, douce et sans pression pour ouvrir la discussion.

---

[LOGIQUE ET ADAPTATION SELON LES CAS DE FIGURE]

Analyse l'URL_Détectée et la Bio, puis choisis EXCLUSIVEMENT l'un des angles suivants :

CAS 1 : L'artisan utilise un LINKTREE / BEACONS
- Angle : Le Linktree éparpille les clients et fait perdre des ventes en route.
- Structure : Compliment sur un produit précis -> "J'ai remarqué que tu passais par un Linktree pour tes ventes..." -> Histoire Christina -> Boutique premium en 48h -> Offre pionnière (1er mois offert).

CAS 2 : L'artisan a déjà un site SHOPIFY ou indépendant
- Angle : Shopify coûte cher en frais cachés et demande trop de gestion technique.
- Structure : Compliment sur leur site -> Histoire Christina (en avait marre de la complexité et des coûts cachés) -> Solution Vendizi (Next.js ultra-rapide, tout inclus 79€, IA résidente SEO) -> Offre pionnière.

CAS 3 : L'artisan vend sur MARKETPLACE (Etsy, Vinted)
- Angle : Dépendre d'une marketplace dévalue la marque et coûte des commissions.
- Structure : Compliment sur les créations -> "C'est dommage de laisser tes créations sur [Etsy/Vinted]..." -> Histoire Christina -> "Vendizi te crée ton propre site en 48h, 0% de commission" -> Offre pionnière.

CAS 4 : L'artisan n'a AUCUN SITE (URL VIDE ou commandes en DM)
- Angle : Gérer les commandes en DM est épuisant. Ils ont peur de la technique.
- Structure : Compliment sur l'univers -> "J'ai vu que tu gérais tes commandes directement par message ici, ça doit te prendre un temps fou..." -> Histoire Christina -> "On te livre un site pro en 48h sans toucher à la technique" -> Offre pionnière.

---

[FORMAT DE SORTIE]
Renvoie UNIQUEMENT le texte du message prêt à être envoyé. Sans introduction ("Voici le message :"), sans balises. Émojis discrets (max 2) adaptés à l'artisanat.`,
        },
      ],
    }),
  });

  if (!claudeRes.ok) {
    const errText = await claudeRes.text().catch(() => "");
    console.error("Claude DM error:", claudeRes.status, errText);
    return "";
  }

  const claudeData = await claudeRes.json();
  return claudeData.content?.[0]?.text || "";
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
      index,
      username,
      comment,
      reason: String(item.reason || "frustration détectée").trim(),
      urgency: item.urgency === "haute" ? "haute" : "moyenne",
      target: detectTarget(source, targets),
    });
  }
  return hits;
}

async function generateSnipingDm(target, comment) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return "";

  const prompt = `Tu es Sébastien, fondateur de Vendizi (vendizi.fr).
Cet artisan vient de commenter sur la page de ${target} en disant : "${comment}"
Il exprime clairement une frustration avec sa solution actuelle.

Rédige un DM Instagram court, humain et bienveillant qui :
1. Mentionne que tu as vu son commentaire (sans être flippant)
2. Empathise avec sa galère
3. Amène l'histoire de Christina et tinaluxe.fr naturellement
4. Propose une place de pionnier (1er mois offert)
5. Termine par une question ouverte

Règles : pas de jargon marketing, tutoiement ou vouvoiement selon le ton du commentaire, max 5 phrases, émojis discrets (max 2).

Réponds uniquement avec le message DM.`;

  const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!claudeRes.ok) {
    const errText = await claudeRes.text().catch(() => "");
    console.error("Claude sniping DM error:", claudeRes.status, errText);
    return "";
  }

  const claudeData = await claudeRes.json();
  return String(claudeData.content?.[0]?.text || "").trim();
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

  const filtered = results.filter((p) => {
    const followers = Number(
      p.followerCount ?? p.followersCount ?? p.followers ?? 0
    );
    return followers >= min_followers && followers <= max_followers;
  });

  const analyzed = await Promise.all(
    filtered.map(async (profile) => {
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

      const dm = await generateDm(profile, siteUrl);

      return {
        username,
        full_name: String(profile.fullName ?? profile.full_name ?? username),
        followers,
        bio: biography,
        website: siteRaw ? String(siteRaw) : null,
        instagram_url: `https://instagram.com/${username}`,
        priority: isHighPriority ? "haute" : "normale",
        dm_generated: dm,
        status: "à contacter",
      };
    })
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

  const postUrls = [
    ...new Set(posts.map(extractPostUrl).filter(Boolean)),
  ];
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

  const usable = allComments.filter(
    (c) => commentText(c) && commentUsername(c)
  );

  if (usable.length === 0) {
    return {
      status: 200,
      body: {
        prospects: [],
        total: 0,
        scanned: 0,
        message: "Aucun commentaire trouvé ou run encore en cours",
      },
    };
  }

  const frustrated = [];
  for (let i = 0; i < usable.length; i += 20) {
    const hits = await filterFrustratedBatch(usable.slice(i, i + 20), targets);
    frustrated.push(...hits);
  }

  const seen = new Set();
  const uniqueFrustrated = frustrated.filter((f) => {
    const key = `${f.username.toLowerCase()}::${f.comment.slice(0, 80)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const frustratedWithDm = await Promise.all(
    uniqueFrustrated.map(async (f) => {
      const dm = await generateSnipingDm(f.target, f.comment);
      const username = f.username.replace(/^@/, "");
      return {
        username,
        comment: f.comment,
        reason: f.reason,
        urgency: f.urgency,
        target: f.target,
        dm_generated: dm,
        status: "à contacter",
        instagram_url: `https://instagram.com/${username}`,
      };
    })
  );

  frustratedWithDm.sort((a, b) => {
    if (a.urgency === "haute" && b.urgency !== "haute") return -1;
    if (b.urgency === "haute" && a.urgency !== "haute") return 1;
    return 0;
  });

  return {
    status: 200,
    body: {
      prospects: frustratedWithDm,
      total: frustratedWithDm.length,
      scanned: allComments.length,
      debug: {
        posts_found: postUrls.length,
        comments_scraped: allComments.length,
        frustrated_raw: frustrated.length,
      },
    },
  };
}

async function analyzeMapsPlace(place) {
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

Ta mission :
1. Détermine si c'est un établissement INDÉPENDANT (pas une chaîne nationale/internationale)
   → indépendant si : nom unique, pas de numéro dans le nom, site web artisanal
   → chaîne si : Yves Rocher, L'Occitane, The Body Shop, etc.
2. Si indépendant, génère un script d'approche COURT pour proposer un partenariat :
   → Version EMAIL (3 phrases max)
   → Version TÉLÉPHONE (2 phrases max, naturel et chaleureux)

Réponds en JSON :
{
  "is_independent": true/false,
  "reason": "explication courte",
  "email_script": "...",
  "phone_script": "..."
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
      max_tokens: 500,
      messages: [{ role: "user", content: claudePrompt }],
    }),
  });

  if (!claudeRes.ok) {
    const errText = await claudeRes.text().catch(() => "");
    console.error("Claude maps analysis error:", claudeRes.status, errText);
    return null;
  }

  const claudeData = await claudeRes.json();
  const text = String(claudeData.content?.[0]?.text || "");
  const parsed = parseJsonObject(text);
  if (!parsed) return null;

  return {
    is_independent: Boolean(parsed.is_independent),
    reason: String(parsed.reason || "").trim(),
    email_script: String(parsed.email_script || "").trim(),
    phone_script: String(parsed.phone_script || "").trim(),
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

    const analysis = await analyzeMapsPlace(place);
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
      reason: analysis.reason,
      email_script: analysis.email_script,
      phone_script: analysis.phone_script,
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
