import { Resend } from "resend";
import pool from "../db/pool.js";
import { sendSMS } from "./sms.js";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

async function getBrandSettings() {
  try {
    const result = await pool.query(
      `SELECT key, value FROM brand_settings WHERE key IN ('brand_name', 'brand_tagline', 'brand_logo_url', 'email_sender_name', 'email_reply_to', 'email_signature', 'color_primary', 'color_dark', 'seo_site_url', 'welcome_promo_code', 'inactive_promo_code')`
    );
    const s = {};
    result.rows.forEach((r) => {
      s[r.key] = r.value;
    });
    return {
      brandName: s.brand_name || "Ma Boutique",
      tagline: s.brand_tagline || "",
      logoUrl: s.brand_logo_url || "",
      senderName: s.email_sender_name || "Ma Boutique",
      replyTo: s.email_reply_to || "contact@maboutique.fr",
      signature: s.email_signature || "L'équipe",
      colorPrimary: s.color_primary || "#D4AF37",
      colorDark: s.color_dark || "#0B0B0B",
      siteUrl: s.seo_site_url || "https://maboutique.fr",
      welcomePromoCode: s.welcome_promo_code || "",
      inactivePromoCode: s.inactive_promo_code || "",
    };
  } catch {
    return {
      brandName: "Ma Boutique",
      tagline: "",
      logoUrl: "",
      senderName: "Ma Boutique",
      replyTo: "contact@maboutique.fr",
      signature: "L'équipe",
      colorPrimary: "#D4AF37",
      colorDark: "#0B0B0B",
      siteUrl: "https://maboutique.fr",
      welcomePromoCode: "",
      inactivePromoCode: "",
    };
  }
}

function emailDomain(replyTo) {
  return replyTo?.split("@")[1] || "maboutique.fr";
}

function emailFrom(brand, prefix = "commandes") {
  return `${brand.senderName} <${prefix}@${emailDomain(brand.replyTo)}>`;
}

function siteUrl(brand, path = "") {
  const base = brand.siteUrl.replace(/\/$/, "");
  if (!path) return base;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

async function getLogoHtml(brand) {
  if (brand.logoUrl) {
    try {
      const res = await fetch(brand.logoUrl, { method: "HEAD" });
      if (res.ok) {
        return `<img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.brandName)}" width="140" style="height:auto;display:block;margin:0 auto;" />`;
      }
    } catch {
      /* logo texte par défaut */
    }
  }
  return `<span style="font-size:28px;font-weight:700;color:${brand.colorPrimary};">${escapeHtml(brand.brandName)}</span>`;
}

function formatPrice(cents, currency = "eur") {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: (currency || "eur").toUpperCase(),
  }).format(Number(cents) / 100);
}

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function emailCtaButton(
  href,
  text,
  {
    margin = "32px 0 40px",
    padding = "14px 32px",
    fontSize = "15px",
    block = false,
    wrap = true,
    colorPrimary = "#D4AF37",
    colorDark = "#0B0B0B",
  } = {}
) {
  const safeHref = escapeHtml(href);
  const safeText = escapeHtml(text);
  const display = block ? "block" : "inline-block";
  const textAlign = block ? "text-align:center;" : "";

  const table = `<table cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;">
    <tr>
      <td bgcolor="${colorPrimary}" style="border-radius:999px;">
        <a href="${safeHref}"
           bgcolor="${colorPrimary}"
           style="background:${colorPrimary};color:${colorDark};padding:${padding};border-radius:999px;font-weight:700;font-size:${fontSize};text-decoration:none;display:${display};mso-padding-alt:0;font-family:Georgia,serif;${textAlign}">
          ${safeText}
        </a>
      </td>
    </tr>
  </table>`;

  if (!wrap) return table;

  return `<div style="text-align:center;margin:${margin};">${table}</div>`;
}

function firstName(customerName) {
  if (!customerName?.trim()) return null;
  return customerName.trim().split(/\s+/)[0];
}

function getWelcomeCodeExpiryFormatted(daysFromNow = 15) {
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + daysFromNow);
  return expiryDate.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
  });
}

function googleReviewButtonHtml(url, display = "block", colorPrimary = "#D4AF37", colorDark = "#0B0B0B") {
  if (!url) return "";
  return `<a href="${escapeHtml(url)}" style="background:#ffffff;color:${colorDark};border:2px solid ${colorPrimary};padding:14px 24px;border-radius:999px;font-weight:700;font-size:15px;text-decoration:none;display:${display};text-align:center;">
            Laisser un avis sur Google →
          </a>`;
}

function shortOrderId(orderId) {
  if (!orderId) return "";
  const s = String(orderId);
  return s.length > 8 ? s.slice(0, 8).toUpperCase() : s.toUpperCase();
}

const CARRIER_LABELS = {
  colissimo: "Colissimo",
  chronopost: "Chronopost",
  mondial_relay: "Mondial Relay",
  laposte: "La Poste",
  ups: "UPS",
  dhl: "DHL",
  autre: "Autre",
};

function trackingUrl(trackingNumber, carrier) {
  if (!trackingNumber?.trim()) return null;
  const code = encodeURIComponent(trackingNumber.trim());
  const TRACKING_URLS = {
    colissimo: `https://www.laposte.fr/outils/suivre-vos-envois?code=${code}`,
    chronopost: `https://www.chronopost.fr/tracking-no-cms/suivi-page?listeNumerosLT=${code}`,
    mondial_relay: `https://www.mondialrelay.fr/suivi-de-colis/?Numero=${code}`,
    laposte: `https://www.laposte.fr/outils/suivre-vos-envois?code=${code}`,
    ups: `https://www.ups.com/track?tracknum=${code}`,
    dhl: `https://www.dhl.com/fr-fr/home/tracking.html?tracking-id=${code}`,
    autre: null,
  };
  return TRACKING_URLS[carrier] ?? null;
}

function buildItemsTableHtml(items = [], currency = "eur", colorPrimary = "#D4AF37") {
  const rows = items
    .map((item) => {
      const qty = Number(item.quantity) || 1;
      const unit =
        item.unit_price_cents !== undefined
          ? Number(item.unit_price_cents)
          : Math.round(Number(item.price || 0) * 100);
      const line = unit * qty;
      return `<tr>
        <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,.08);color:#EAEAEA;">${escapeHtml(item.name || "Article")}</td>
        <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,.08);text-align:center;color:rgba(234,234,234,.7);">${qty}</td>
        <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,.08);text-align:right;color:rgba(234,234,234,.7);">${formatPrice(unit, currency)}</td>
        <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,.08);text-align:right;color:#EAEAEA;">${formatPrice(line, currency)}</td>
      </tr>`;
    })
    .join("");

  return `
    <table style="width:100%;border-collapse:collapse;margin:8px 0 24px;">
      <thead>
        <tr>
          <th style="text-align:left;padding:8px 0;border-bottom:1px solid rgba(212,175,55,.35);color:${colorPrimary};font-size:12px;letter-spacing:.08em;">ARTICLE</th>
          <th style="text-align:center;padding:8px 0;border-bottom:1px solid rgba(212,175,55,.35);color:${colorPrimary};font-size:12px;">QTÉ</th>
          <th style="text-align:right;padding:8px 0;border-bottom:1px solid rgba(212,175,55,.35);color:${colorPrimary};font-size:12px;">PRIX</th>
          <th style="text-align:right;padding:8px 0;border-bottom:1px solid rgba(212,175,55,.35);color:${colorPrimary};font-size:12px;">TOTAL</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function newsletterSequenceUnsubFooter(email, brand) {
  const safeEmail = encodeURIComponent(email || "");
  return `
    <p style="color:rgba(234,234,234,.2);font-size:11px;text-align:center;margin-top:24px;">
      Vous recevez cet email car vous vous êtes inscrit(e) sur ${escapeHtml(brand.brandName)}.<br>
      <a href="${siteUrl(brand, `/newsletter/unsubscribe?email=${safeEmail}`)}"
         style="color:rgba(212,175,55,.4);text-decoration:underline;">
        Se désinscrire
      </a>
    </p>`;
}

async function brandedShell({
  badge,
  badgeColor,
  badgeBg,
  badgeBorder,
  title,
  bodyHtml,
  ctaText,
  ctaUrl,
  footerNote,
  brand: brandOverride,
}) {
  const brand = brandOverride || (await getBrandSettings());
  const logoHtml = await getLogoHtml(brand);
  const cta =
    ctaText && ctaUrl
      ? emailCtaButton(ctaUrl, ctaText, {
          colorPrimary: brand.colorPrimary,
          colorDark: brand.colorDark,
        })
      : "";

  const taglineHtml = brand.tagline
    ? `<div style="font-size:10px;letter-spacing:.2em;color:rgba(212,175,55,.5);margin-top:4px;">
        ${escapeHtml(brand.tagline.toUpperCase())}
      </div>`
    : "";

  return `
<div style="background:${brand.colorDark};font-family:Georgia,serif;color:#EAEAEA;padding:40px 20px;">
  <div style="max-width:600px;margin:0 auto;">
    <div style="text-align:center;border-bottom:1px solid rgba(212,175,55,.3);padding-bottom:24px;margin-bottom:32px;">
      ${logoHtml}
      ${taglineHtml}
    </div>

    <div style="text-align:center;margin-bottom:20px;">
      <span style="background:${badgeBg};color:${badgeColor};border:1px solid ${badgeBorder};padding:6px 16px;border-radius:99px;font-size:12px;letter-spacing:.1em;">
        ${escapeHtml(badge)}
      </span>
    </div>

    <h1 style="text-align:center;font-size:28px;color:#EAEAEA;margin:0 0 20px;font-style:italic;">
      ${escapeHtml(title)}
    </h1>

    <div style="width:48px;height:2px;background:${brand.colorPrimary};margin:0 auto 24px;"></div>

    <div style="font-size:16px;line-height:1.7;color:rgba(234,234,234,.8);">
      ${bodyHtml}
    </div>

    ${cta}

    <div style="border-top:1px solid rgba(255,255,255,.08);padding-top:20px;text-align:center;">
      ${
        footerNote
          ? `<p style="font-size:12px;color:rgba(255,255,255,.3);margin:0 0 8px;">${footerNote}</p>`
          : ""
      }
      <p style="font-size:12px;color:rgba(255,255,255,.3);margin:0 0 8px;">
        © ${escapeHtml(brand.brandName)}
      </p>
      <a href="${siteUrl(brand)}" style="font-size:12px;color:rgba(212,175,55,.5);text-decoration:none;">
        ${escapeHtml(siteUrl(brand).replace(/^https?:\/\//, ""))}
      </a>
    </div>
  </div>
</div>`;
}

async function sendBrandedEmail({ to, subject, html, brand: brandOverride }) {
  if (!resend) {
    console.warn("RESEND_API_KEY non configurée — email non envoyé.");
    console.log({ to, subject });
    return { id: "dev-log" };
  }

  if (!to) {
    console.warn("Pas d'email destinataire — email non envoyé.");
    return null;
  }

  const brand = brandOverride || (await getBrandSettings());

  const { data, error } = await resend.emails.send({
    from: emailFrom(brand),
    replyTo: brand.replyTo,
    to,
    subject,
    html,
  });

  if (error) {
    console.error("Erreur envoi email Resend:", error);
    throw error;
  }

  return data;
}

/** Confirmation après paiement Stripe */
export async function sendOrderConfirmationEmail({
  email,
  orderId,
  items,
  total,
  customerName,
  currency = "eur",
  loyalty = null,
}) {
  const brand = await getBrandSettings();
  const prenom = firstName(customerName);
  const thanks = prenom
    ? `Merci ${escapeHtml(prenom)} pour votre commande !`
    : "Merci pour votre commande !";
  const totalLabel =
    typeof total === "number"
      ? formatPrice(total, currency)
      : escapeHtml(String(total));
  const idShort = shortOrderId(orderId);

  const loyaltyHtml =
    loyalty && loyalty.pointsEarned > 0
      ? `
    <div style="margin-top:28px;padding:16px;background:rgba(212,175,55,.08);border:1px solid rgba(212,175,55,.25);border-radius:10px;text-align:center;">
      <p style="margin:0 0 6px;color:${brand.colorPrimary};font-size:15px;font-weight:700;">
        +${loyalty.pointsEarned} point${loyalty.pointsEarned > 1 ? "s" : ""} fidélité
      </p>
      <p style="margin:0;color:rgba(234,234,234,.65);font-size:13px;line-height:1.5;">
        Solde : ${loyalty.totalPoints} pts
        ${
          loyalty.pointsForReward
            ? ` — ${loyalty.pointsForReward} pts = un bon cadeau`
            : ""
        }
        <br/>
        <a href="${siteUrl(brand, "/fidelite")}" style="color:${brand.colorPrimary};">Voir mon solde →</a>
      </p>
    </div>`
      : "";

  const bodyHtml = `
    <p style="text-align:center;margin:0 0 24px;font-size:17px;color:#EAEAEA;">${thanks}</p>
    ${buildItemsTableHtml(items, currency, brand.colorPrimary)}
    <p style="text-align:right;font-size:20px;font-weight:700;color:${brand.colorPrimary};margin:0 0 28px;">
      Total : ${totalLabel}
    </p>
    <p style="margin:0;text-align:center;">
      Votre commande est en cours de préparation. Vous recevrez un email dès qu'elle sera expédiée.
    </p>
    ${loyaltyHtml}
  `;

  const html = await brandedShell({
    badge: "COMMANDE CONFIRMÉE",
    badgeColor: "#81C784",
    badgeBg: "rgba(76,175,80,.15)",
    badgeBorder: "rgba(76,175,80,.4)",
    title: "Commande confirmée",
    bodyHtml,
    ctaText: "Suivre ma commande",
    ctaUrl: siteUrl(brand, `/commande-confirmee?order=${encodeURIComponent(orderId)}`),
    footerNote: `Réf. #${escapeHtml(idShort)}`,
    brand,
  });

  return sendBrandedEmail({
    to: email,
    subject: `✨ Votre commande ${brand.brandName} est confirmée — #${idShort}`,
    html,
    brand,
  });
}

export async function sendAdminOrderNotification({
  orderId,
  customerEmail,
  customerName,
  totalCents,
  items,
}) {
  if (!resend) {
    console.warn("RESEND_API_KEY non configurée — notification admin non envoyée.");
    return null;
  }

  const brand = await getBrandSettings();
  const logoHtml = await getLogoHtml(brand);
  const total = (totalCents / 100).toFixed(2);
  const itemsList = Array.isArray(items)
    ? items
        .map((i) => `${escapeHtml(i.name || i.slug || "Article")} × ${Number(i.quantity) || 1}`)
        .join(", ")
    : "Produits non disponibles";
  const clientLabel = escapeHtml(customerName || customerEmail || "Client");
  const emailLabel = escapeHtml(customerEmail || "—");
  const adminEmail = process.env.ADMIN_EMAIL || brand.replyTo;

  const { data, error } = await resend.emails.send({
    from: emailFrom(brand),
    to: adminEmail,
    subject: `🛍️ Nouvelle commande — ${total}€`,
    html: `
      <div style="background:${brand.colorDark};font-family:Georgia,serif;color:#EAEAEA;padding:32px 20px;max-width:500px;margin:0 auto;border-radius:12px;">
        <div style="text-align:center;margin-bottom:24px;">
          ${logoHtml}
        </div>

        <div style="background:#161616;border:1px solid rgba(212,175,55,.3);border-radius:10px;padding:20px;margin-bottom:20px;">
          <div style="font-size:32px;font-weight:800;color:${brand.colorPrimary};text-align:center;margin-bottom:4px;">${total} €</div>
          <div style="text-align:center;color:rgba(234,234,234,.5);font-size:13px;">Nouvelle commande reçue</div>
        </div>

        <table style="width:100%;font-size:13px;margin-bottom:20px;">
          <tr>
            <td style="color:rgba(234,234,234,.5);padding:6px 0;">Client</td>
            <td style="color:#EAEAEA;text-align:right;">${clientLabel}</td>
          </tr>
          <tr>
            <td style="color:rgba(234,234,234,.5);padding:6px 0;">Email</td>
            <td style="color:#EAEAEA;text-align:right;">${emailLabel}</td>
          </tr>
          <tr>
            <td style="color:rgba(234,234,234,.5);padding:6px 0;">Produits</td>
            <td style="color:#EAEAEA;text-align:right;">${itemsList}</td>
          </tr>
        </table>

        <a href="${siteUrl(brand, "/admin")}" style="display:block;background:${brand.colorPrimary};color:${brand.colorDark};padding:14px;border-radius:999px;font-weight:700;font-size:15px;text-decoration:none;text-align:center;">
          Voir la commande →
        </a>
      </div>
    `,
  });

  if (error) {
    console.error("Erreur notification admin commande Resend:", error);
    throw error;
  }

  return data;
}

/** Passage en préparation (admin) */
export async function sendOrderPreparationEmail({
  email,
  orderId,
  customerName,
}) {
  const brand = await getBrandSettings();
  const prenom = firstName(customerName);
  const idShort = shortOrderId(orderId);
  const hello = prenom ? `Bonjour ${escapeHtml(prenom)},` : "Bonjour,";

  const bodyHtml = `
    <p style="margin:0 0 16px;">${hello}</p>
    <p style="margin:0 0 16px;text-align:center;font-size:17px;color:#EAEAEA;">
      Bonne nouvelle ! Votre commande est en cours de préparation avec soin.
    </p>
    <p style="margin:0 0 16px;">
      Chez ${escapeHtml(brand.brandName)}, chaque commande est préparée avec attention :
      vérification des produits, emballage soigné et attention particulière pour que vos
      produits voyagent dans les meilleures conditions.
    </p>
    <p style="margin:0;text-align:center;">
      Vous recevrez un email avec votre numéro de suivi dès l'expédition.
    </p>
  `;

  const html = await brandedShell({
    badge: "EN PRÉPARATION",
    badgeColor: brand.colorPrimary,
    badgeBg: "rgba(212,175,55,.15)",
    badgeBorder: "rgba(212,175,55,.35)",
    title: "Préparation en cours",
    bodyHtml,
    ctaText: "Découvrir nos autres produits",
    ctaUrl: siteUrl(brand, "/boutique"),
    footerNote: `Réf. #${escapeHtml(idShort)}`,
    brand,
  });

  return sendBrandedEmail({
    to: email,
    subject: `🎁 Votre commande ${brand.brandName} est en cours de préparation — #${idShort}`,
    html,
    brand,
  });
}

/** Expédition avec suivi */
export async function sendOrderShippedEmail({
  email,
  orderId,
  customerName,
  trackingNumber,
  carrier,
}) {
  const brand = await getBrandSettings();
  const prenom = firstName(customerName);
  const idShort = shortOrderId(orderId);
  const hello = prenom ? `Bonjour ${escapeHtml(prenom)},` : "Bonjour,";
  const tracking = trackingNumber?.trim() || "";
  const carrierKey = String(carrier || "").toLowerCase();
  const carrierLabel =
    CARRIER_LABELS[carrierKey] || carrier?.trim() || null;
  const trackLink = tracking ? trackingUrl(tracking, carrierKey) : null;

  const carrierLine = carrierLabel
    ? `<p style="margin:0 0 16px;text-align:center;font-size:16px;color:#EAEAEA;">
        Votre colis est pris en charge par <strong>${escapeHtml(carrierLabel)}</strong>.
      </p>`
    : "";

  const trackingBlock = tracking
    ? `<div style="margin:24px 0;padding:20px;border:1px solid rgba(212,175,55,.4);border-radius:12px;background:rgba(212,175,55,.08);text-align:center;">
        <p style="margin:0 0 8px;font-size:12px;letter-spacing:.1em;color:rgba(212,175,55,.7);text-transform:uppercase;">N° de suivi</p>
        <p style="margin:0;font-size:22px;letter-spacing:1px;color:${brand.colorPrimary};font-weight:700;">${escapeHtml(tracking)}</p>
      </div>`
    : `<p style="margin:0 0 16px;text-align:center;">Les informations de suivi vous seront communiquées très bientôt.</p>`;

  const bodyHtml = `
    <p style="margin:0 0 16px;">${hello}</p>
    <p style="margin:0 0 16px;text-align:center;font-size:17px;color:#EAEAEA;">
      Votre commande est en route !
    </p>
    ${carrierLine}
    ${trackingBlock}
    <p style="margin:0;text-align:center;">
      Délai estimé : <strong style="color:#EAEAEA;">2 à 4 jours ouvrés</strong>
    </p>
  `;

  const html = await brandedShell({
    badge: "EXPÉDIÉE",
    badgeColor: "#FFB74D",
    badgeBg: "rgba(255,152,0,.15)",
    badgeBorder: "rgba(255,152,0,.4)",
    title: "Commande expédiée",
    bodyHtml,
    ctaText: trackLink ? "Suivre mon colis →" : "Voir la boutique",
    ctaUrl: trackLink || siteUrl(brand, "/boutique"),
    footerNote: `Réf. #${escapeHtml(idShort)}`,
    brand,
  });

  return sendBrandedEmail({
    to: email,
    subject: `🚚 Votre commande ${brand.brandName} est en route ! — #${idShort}`,
    html,
    brand,
  });
}

/** Demande d'avis après livraison (J+2) */
export async function sendOrderDeliveredEmail({
  email,
  customerName,
  orderId,
  productName,
  googleReviewUrl,
}) {
  const brand = await getBrandSettings();
  const logoHtml = await getLogoHtml(brand);
  const prenom = firstName(customerName) || "vous";
  const product = escapeHtml(productName || `commande ${brand.brandName}`);
  const idShort = shortOrderId(orderId);
  const avisBase = siteUrl(brand, `/avis?order=${encodeURIComponent(orderId)}`);
  const starsHtml = [1, 2, 3, 4, 5]
    .map(
      (star) =>
        `<a href="${avisBase}&rating=${star}" style="font-size:36px;text-decoration:none;">⭐</a>`
    )
    .join("");

  const googleBtn = googleReviewButtonHtml(
    googleReviewUrl,
    "block",
    brand.colorPrimary,
    brand.colorDark
  );

  const html = `
      <div style="background:${brand.colorDark};font-family:Georgia,serif;color:#EAEAEA;padding:40px 20px;max-width:600px;margin:0 auto;">
        <div style="text-align:center;border-bottom:1px solid rgba(212,175,55,.3);padding-bottom:24px;margin-bottom:32px;">
          ${logoHtml}
        </div>

        <h1 style="font-size:22px;font-style:italic;margin-bottom:16px;">
          Votre commande est arrivée, ${escapeHtml(prenom)} !
        </h1>

        <p style="color:rgba(234,234,234,.7);font-size:15px;line-height:1.8;margin-bottom:32px;">
          Nous espérons que vous êtes ravie de votre ${product}.
          Votre avis est précieux — il aide d'autres clientes à découvrir nos produits.
        </p>

        <div style="text-align:center;margin-bottom:32px;">
          <p style="color:rgba(234,234,234,.6);font-size:14px;margin-bottom:16px;">Comment évaluez-vous votre expérience ?</p>
          <div style="display:flex;justify-content:center;gap:8px;">
            ${starsHtml}
          </div>
        </div>

        <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:32px;">
          ${emailCtaButton(
            avisBase,
            `Laisser un avis sur ${brand.brandName}`,
            {
              margin: "0",
              block: true,
              padding: "14px 24px",
              colorPrimary: brand.colorPrimary,
              colorDark: brand.colorDark,
            }
          )}
          ${googleBtn}
        </div>

        <p style="color:rgba(234,234,234,.3);font-size:12px;text-align:center;">
          Merci de faire partie de la communauté ${escapeHtml(brand.brandName)} 💛 — Réf. #${escapeHtml(idShort)}
        </p>
      </div>
    `;

  return sendBrandedEmail({
    to: email,
    subject: `${prenom === "vous" ? "Vous" : prenom}, votre commande est arrivée — partagez votre expérience ✨`,
    html,
    brand,
  });
}

/** Compat — ancien nom */
export async function sendReviewRequestEmail({
  email,
  customerName,
  productName,
  orderId,
  googleReviewUrl,
}) {
  return sendOrderDeliveredEmail({
    email,
    customerName,
    orderId,
    productName,
    googleReviewUrl,
  });
}

/** Relance avis J+7 */
export async function sendReviewReminderEmail({
  email,
  customerName,
  orderId,
  googleReviewUrl,
}) {
  const brand = await getBrandSettings();
  const logoHtml = await getLogoHtml(brand);
  const prenom = firstName(customerName) || "vous";
  const idShort = shortOrderId(orderId);
  const avisBase = siteUrl(brand, `/avis?order=${encodeURIComponent(orderId)}`);
  const starsHtml = [1, 2, 3, 4, 5]
    .map(
      (star) =>
        `<a href="${avisBase}&rating=${star}" style="font-size:32px;text-decoration:none;">⭐</a>`
    )
    .join("");

  const googleBtn = googleReviewButtonHtml(
    googleReviewUrl,
    "block",
    brand.colorPrimary,
    brand.colorDark
  );

  const html = `
      <div style="background:${brand.colorDark};font-family:Georgia,serif;color:#EAEAEA;padding:40px 20px;max-width:600px;margin:0 auto;">
        <div style="text-align:center;border-bottom:1px solid rgba(212,175,55,.3);padding-bottom:24px;margin-bottom:32px;">
          ${logoHtml}
        </div>

        <h1 style="font-size:22px;font-style:italic;margin-bottom:16px;">
          ${escapeHtml(prenom)}, votre avis nous manque encore... 💛
        </h1>

        <p style="color:rgba(234,234,234,.7);font-size:15px;line-height:1.8;margin-bottom:20px;">
          Il y a quelques jours, vous avez reçu votre commande ${escapeHtml(brand.brandName)}.
          Nous espérons qu'elle vous a plu ! Votre expérience compte beaucoup
          pour nous et pour les clientes qui hésitent encore à commander.
        </p>

        <div style="text-align:center;margin-bottom:28px;">
          <div style="display:flex;justify-content:center;gap:8px;">
            ${starsHtml}
          </div>
        </div>

        <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:32px;">
          ${emailCtaButton(
            avisBase,
            `Laisser un avis sur ${brand.brandName}`,
            {
              margin: "0",
              block: true,
              padding: "14px 24px",
              colorPrimary: brand.colorPrimary,
              colorDark: brand.colorDark,
            }
          )}
          ${googleBtn}
        </div>

        <p style="color:rgba(234,234,234,.3);font-size:12px;text-align:center;">
          Réf. #${escapeHtml(idShort)}
        </p>
      </div>
    `;

  return sendBrandedEmail({
    to: email,
    subject: `${prenom === "vous" ? "Vous" : prenom}, votre avis nous manque encore... 💛`,
    html,
    brand,
  });
}

/** Demande avis Google après avis 5 étoiles publié */
export async function sendGoogleReviewRequestEmail({
  email,
  customerName,
  googleReviewUrl,
}) {
  if (!googleReviewUrl) return null;

  const brand = await getBrandSettings();
  const logoHtml = await getLogoHtml(brand);
  const prenom = firstName(customerName) || "vous";

  const html = `
      <div style="background:${brand.colorDark};font-family:Georgia,serif;color:#EAEAEA;padding:40px 20px;max-width:600px;margin:0 auto;">
        <div style="text-align:center;border-bottom:1px solid rgba(212,175,55,.3);padding-bottom:24px;margin-bottom:32px;">
          ${logoHtml}
        </div>

        <h1 style="font-size:22px;font-style:italic;margin-bottom:16px;">
          Merci ${escapeHtml(prenom)} !
        </h1>

        <p style="color:rgba(234,234,234,.7);font-size:15px;line-height:1.8;margin-bottom:32px;">
          Votre avis 5 étoiles nous touche beaucoup.
          Pourriez-vous le partager également sur Google ?
          Cela aide d'autres clientes à découvrir ${escapeHtml(brand.brandName)}.
        </p>

        <div style="text-align:center;margin-bottom:32px;">
          ${googleReviewButtonHtml(googleReviewUrl, "inline-block", brand.colorPrimary, brand.colorDark)}
        </div>

        <p style="color:rgba(234,234,234,.3);font-size:12px;text-align:center;">
          Merci de faire partie de la communauté ${escapeHtml(brand.brandName)} 💛
        </p>
      </div>
    `;

  return sendBrandedEmail({
    to: email,
    subject: `Merci ${prenom === "vous" ? "" : prenom + " ! "}Partagez votre expérience sur Google ?`.trim(),
    html,
    brand,
  });
}


/** Compat : anciens appels webhooks / admin */
export async function sendOrderConfirmation(order) {
  return sendOrderConfirmationEmail({
    email: order.customer_email,
    orderId: order.id,
    items: order.items || [],
    total: order.total_cents,
    customerName: order.customer_name,
    currency: order.currency,
  });
}

export async function sendShippingNotification(order) {
  return sendOrderShippedEmail({
    email: order.customer_email,
    orderId: order.id,
    customerName: order.customer_name,
    trackingNumber: order.tracking_number,
    carrier: order.carrier,
  });
}

export async function sendContactEmail({ name, email, phone, topic, message }) {
  if (!resend) {
    console.warn("RESEND_API_KEY non configurée — message contact loggé.");
    console.log({ name, email, phone, topic, message });
    return { id: "dev-log" };
  }

  const brand = await getBrandSettings();
  const html = await brandedShell({
    badge: "CONTACT",
    badgeColor: brand.colorPrimary,
    badgeBg: "rgba(212,175,55,.15)",
    badgeBorder: "rgba(212,175,55,.35)",
    title: "Nouveau message",
    bodyHtml: `
      <p><strong style="color:${brand.colorPrimary};">Nom :</strong> ${escapeHtml(name)}</p>
      <p><strong style="color:${brand.colorPrimary};">E-mail :</strong> ${escapeHtml(email)}</p>
      ${phone ? `<p><strong style="color:${brand.colorPrimary};">Téléphone :</strong> ${escapeHtml(phone)}</p>` : ""}
      <p><strong style="color:${brand.colorPrimary};">Sujet :</strong> ${escapeHtml(topic)}</p>
      <p style="white-space:pre-wrap;margin-top:16px;">${escapeHtml(message)}</p>
    `,
    brand,
  });

  const to = process.env.CONTACT_EMAIL || brand.replyTo;

  const { data, error } = await resend.emails.send({
    from: emailFrom(brand, "contact"),
    to,
    replyTo: email,
    subject: `[Contact] ${topic} — ${name}`,
    html,
  });

  if (error) {
    console.error("Erreur envoi contact Resend:", error);
    throw error;
  }

  return data;
}

function formatNewsletterMessage(message = "") {
  return escapeHtml(message)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br/>");
}

const NEWSLETTER_TYPE_LABELS = {
  product: "NOUVEAU PRODUIT",
  offer: "OFFRE SPÉCIALE",
  event: "ÉVÉNEMENT",
  news: "ACTUALITÉ",
};

export async function buildNewsletterHtml({
  token,
  type,
  title,
  message,
  cta_text,
  cta_url,
  brand: brandOverride,
}) {
  const brand = brandOverride || (await getBrandSettings());
  const typeLabel =
    NEWSLETTER_TYPE_LABELS[type] || NEWSLETTER_TYPE_LABELS.news;
  const safeMessage = formatNewsletterMessage(message);
  const hasCta = Boolean(cta_text && cta_url);
  const unsubToken = encodeURIComponent(token || "");

  return brandedShell({
    badge: typeLabel,
    badgeColor: brand.colorPrimary,
    badgeBg: "rgba(212,175,55,.15)",
    badgeBorder: "rgba(212,175,55,.3)",
    title: title || "",
    bodyHtml: `<div>${safeMessage}</div>`,
    ctaText: hasCta ? cta_text : undefined,
    ctaUrl: hasCta ? cta_url : undefined,
    footerNote: `Vous recevez cet email car vous êtes abonné(e) aux actualités ${escapeHtml(brand.brandName)}.
      <br/><a href="${siteUrl(brand, `/newsletter/unsubscribe?token=${unsubToken}`)}" style="color:rgba(212,175,55,.5);">Se désinscrire</a>`,
    brand,
  });
}

export async function sendNewsletterEmail({
  to,
  token,
  subject,
  type,
  title,
  message,
  cta_text,
  cta_url,
}) {
  if (!resend) {
    console.warn("RESEND_API_KEY non configurée — newsletter non envoyée.");
    console.log({ to, subject, type, title });
    return { id: "dev-log" };
  }

  const brand = await getBrandSettings();
  const html = await buildNewsletterHtml({
    token,
    type,
    title,
    message,
    cta_text,
    cta_url,
    brand,
  });

  const { data, error } = await resend.emails.send({
    from: `${brand.signature} — ${brand.brandName} <newsletter@${emailDomain(brand.replyTo)}>`,
    replyTo: brand.replyTo,
    to,
    subject,
    html,
  });

  if (error) {
    console.error("Erreur envoi newsletter Resend:", error);
    throw error;
  }

  return data;
}

/** Email 1 — bienvenue immédiat après inscription newsletter */
export async function sendWelcomeEmail({
  email,
  customerName,
  loyaltyActive = false,
}) {
  const brand = await getBrandSettings();
  const prenom = firstName(customerName);
  const hello = prenom
    ? `Merci ${escapeHtml(prenom)} de rejoindre la communauté ${escapeHtml(brand.brandName)}`
    : `Merci de rejoindre la communauté ${escapeHtml(brand.brandName)}`;

  const loyaltyHtml = loyaltyActive
    ? `<p style="margin:24px 0 0;text-align:center;">
        <a href="${siteUrl(brand, "/fidelite")}" style="color:${brand.colorPrimary};font-size:14px;text-decoration:none;">
          Découvrir notre programme fidélité →
        </a>
      </p>`
    : "";
  const promoCode = brand.welcomePromoCode || "";
  const expiryFormatted = promoCode ? getWelcomeCodeExpiryFormatted(15) : "";

  const promoBlock = promoCode
    ? `
    <div style="margin:28px 0;padding:20px;border:1px solid rgba(212,175,55,.35);border-radius:12px;background:rgba(212,175,55,.08);text-align:center;">
      <p style="margin:0 0 8px;font-size:12px;letter-spacing:.1em;color:rgba(212,175,55,.7);text-transform:uppercase;">Votre cadeau de bienvenue</p>
      <p style="margin:0 0 4px;font-size:28px;font-weight:700;color:${brand.colorPrimary};letter-spacing:2px;">${escapeHtml(promoCode)}</p>
      <p style="margin:0;color:rgba(234,234,234,.65);font-size:14px;">sur votre première commande</p>
      <div style="font-size:12px;color:rgba(234,234,234,.4);margin-top:6px;">
        Valable 15 jours — à utiliser avant le ${escapeHtml(expiryFormatted)}
      </div>
    </div>`
    : "";

  const bodyHtml = `
    <p style="margin:0 0 20px;text-align:center;font-size:17px;color:#EAEAEA;">${hello} ✨</p>
    <p style="margin:0 0 16px;line-height:1.8;">
      Bienvenue chez ${escapeHtml(brand.brandName)} ! Découvrez nos produits soigneusement
      sélectionnés pour vous offrir une expérience unique.
    </p>
    ${promoBlock}
    ${loyaltyHtml}
    ${newsletterSequenceUnsubFooter(email, brand)}
  `;

  const html = await brandedShell({
    badge: "BIENVENUE",
    badgeColor: brand.colorPrimary,
    badgeBg: "rgba(212,175,55,.15)",
    badgeBorder: "rgba(212,175,55,.35)",
    title: `Bienvenue dans l'univers ${brand.brandName}`,
    bodyHtml,
    ctaText: "Découvrir nos produits →",
    ctaUrl: siteUrl(brand, "/boutique"),
    footerNote:
      `Vous recevez cet email car vous venez de vous inscrire à la newsletter ${brand.brandName}.`,
    brand,
  });

  return sendBrandedEmail({
    to: email,
    subject: `Bienvenue dans l'univers ${brand.brandName} ✨`,
    html,
    brand,
  });
}

/** Email 2 — J+3 si pas encore de commande */
export async function sendWelcomeJ3Email({ email, customerName }) {
  const brand = await getBrandSettings();
  const prenom = firstName(customerName) || "vous";
  const promoCode = brand.welcomePromoCode || "";
  const expiryFormatted = promoCode ? getWelcomeCodeExpiryFormatted(12) : "";

  const promoReminder = promoCode
    ? `
    <p style="margin:0;text-align:center;color:rgba(234,234,234,.6);font-size:14px;">
      N'oubliez pas votre code <strong style="color:${brand.colorPrimary};">${escapeHtml(promoCode)}</strong>
    </p>
    <p style="margin:8px 0 0;text-align:center;font-size:12px;color:rgba(234,234,234,.4);">
      Valable 15 jours — à utiliser avant le ${escapeHtml(expiryFormatted)}
    </p>`
    : "";

  const bodyHtml = `
    <p style="margin:0 0 16px;line-height:1.8;">
      Il y a 3 jours, vous avez rejoint ${escapeHtml(brand.brandName)}. Avez-vous déjà trouvé
      votre produit idéal ?
    </p>
    <div style="margin:24px 0;padding:20px;background:#161616;border-radius:10px;">
      <p style="margin:0 0 12px;color:${brand.colorPrimary};font-size:13px;letter-spacing:.08em;text-transform:uppercase;">Pourquoi choisir ${escapeHtml(brand.brandName)} ?</p>
      <ul style="margin:0;padding-left:20px;color:rgba(234,234,234,.75);font-size:14px;line-height:1.9;">
        <li>Produits soigneusement sélectionnés</li>
        <li>Qualité artisanale</li>
        <li>Livraison rapide</li>
      </ul>
    </div>
    ${promoReminder}
    ${newsletterSequenceUnsubFooter(email, brand)}
  `;

  const html = await brandedShell({
    badge: "CONSEILS",
    badgeColor: brand.colorPrimary,
    badgeBg: "rgba(212,175,55,.15)",
    badgeBorder: "rgba(212,175,55,.35)",
    title: `${escapeHtml(prenom)}, avez-vous trouvé votre produit idéal ?`,
    bodyHtml,
    ctaText: "Voir nos produits →",
    ctaUrl: siteUrl(brand, "/boutique"),
    footerNote:
      `Vous recevez cet email car vous êtes abonné(e) à la newsletter ${brand.brandName}.`,
    brand,
  });

  return sendBrandedEmail({
    to: email,
    subject: `${prenom === "vous" ? "Avez-vous" : prenom + ", avez-vous"} trouvé votre produit idéal ?`,
    html,
    brand,
  });
}

/** Email 3 — J+7 si pas encore de commande */
export async function sendWelcomeJ7Email({ email, customerName }) {
  const brand = await getBrandSettings();
  const prenom = firstName(customerName) || "vous";
  const promoCode = brand.welcomePromoCode || "";
  const expiryFormatted = promoCode ? getWelcomeCodeExpiryFormatted(8) : "";

  const promoUrgency = promoCode
    ? `
    <div style="background:rgba(239,83,80,.1);border:1px solid rgba(239,83,80,.2);border-radius:8px;padding:12px;text-align:center;margin-bottom:20px;">
      <div style="color:#EF5350;font-weight:700;font-size:14px;">
        ⏰ Votre code expire dans 8 jours
      </div>
      <div style="color:rgba(234,234,234,.5);font-size:12px;margin-top:4px;">
        Ne laissez pas passer cette offre
      </div>
    </div>
    <p style="margin:0 0 20px;line-height:1.8;">
      C'est votre <strong style="color:${brand.colorPrimary};">dernière chance</strong> d'utiliser
      votre code <strong style="color:${brand.colorPrimary};">${escapeHtml(promoCode)}</strong> sur votre première commande.
    </p>
    <p style="margin:0;text-align:center;color:#EF9A9A;font-size:13px;font-weight:600;">
      ⏳ Code ${escapeHtml(promoCode)} — expire le ${escapeHtml(expiryFormatted)}
    </p>`
    : `
    <p style="margin:0 0 20px;line-height:1.8;">
      C'est le moment idéal pour découvrir nos produits et passer votre première commande.
    </p>`;

  const bodyHtml = `
    <p style="margin:0 0 20px;line-height:1.8;text-align:center;font-size:17px;color:#EAEAEA;">
      ${escapeHtml(prenom)}, ne manquez pas cette offre 💛
    </p>
    ${promoUrgency}
    <p style="margin:20px 0 0;line-height:1.8;text-align:center;">
      Rejoignez nos clientes qui ont déjà adopté ${escapeHtml(brand.brandName)}.
    </p>
    ${newsletterSequenceUnsubFooter(email, brand)}
  `;

  const html = await brandedShell({
    badge: "DERNIÈRE CHANCE",
    badgeColor: "#EF9A9A",
    badgeBg: "rgba(239,154,154,.12)",
    badgeBorder: "rgba(239,154,154,.35)",
    title: "Votre code expire bientôt",
    bodyHtml,
    ctaText: "Commander maintenant →",
    ctaUrl: siteUrl(brand, "/boutique"),
    footerNote:
      `Vous recevez cet email car vous êtes abonné(e) à la newsletter ${brand.brandName}.`,
    brand,
  });

  return sendBrandedEmail({
    to: email,
    subject: `${prenom === "vous" ? "Ne manquez pas" : prenom + ", ne manquez pas"} cette offre 💛`,
    html,
    brand,
  });
}

/** Cross-sell J+14 après livraison */
export async function sendCrossSellEmail({
  email,
  customerName,
  purchasedItems,
  suggestions,
}) {
  if (!resend) {
    console.warn("RESEND_API_KEY non configurée — email cross-sell non envoyé.");
    return null;
  }

  const brand = await getBrandSettings();
  const logoHtml = await getLogoHtml(brand);
  const prenom = firstName(customerName) || "vous";
  const purchasedName = escapeHtml(
    purchasedItems?.[0]?.name || `votre produit ${brand.brandName}`
  );

  const suggestionsHtml = (suggestions || [])
    .map((s) => {
      const price = Number(s.price).toFixed(2);
      const productUrl = siteUrl(brand, `/${encodeURIComponent(s.slug)}`);
      return `
    <div style="background:#161616;border:1px solid rgba(212,175,55,.15);border-radius:12px;padding:16px;margin-bottom:12px;">
      <div style="color:${brand.colorPrimary};font-size:16px;font-weight:700;font-family:Georgia,serif;margin-bottom:4px;">${escapeHtml(s.name)}</div>
      <div style="color:rgba(234,234,234,.6);font-size:13px;margin-bottom:12px;">${escapeHtml(s.reason)}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span style="color:${brand.colorPrimary};font-size:18px;font-weight:700;">${price} €</span>
        ${emailCtaButton(productUrl, "Découvrir →", {
          wrap: false,
          padding: "8px 18px",
          fontSize: "13px",
          colorPrimary: brand.colorPrimary,
          colorDark: brand.colorDark,
        })}
      </div>
    </div>`;
    })
    .join("");

  const subjectPrenom = prenom === "vous" ? "Vous" : prenom;

  const { data, error } = await resend.emails.send({
    from: emailFrom(brand),
    replyTo: brand.replyTo,
    to: email,
    subject: `${subjectPrenom}, les clientes qui ont acheté ${purchasedItems?.[0]?.name || `votre produit ${brand.brandName}`} adorent aussi... 💛`,
    html: `
      <div style="background:${brand.colorDark};font-family:Georgia,serif;color:#EAEAEA;padding:40px 20px;max-width:600px;margin:0 auto;">
        <div style="text-align:center;border-bottom:1px solid rgba(212,175,55,.3);padding-bottom:24px;margin-bottom:32px;">
          ${logoHtml}
        </div>

        <h1 style="font-size:22px;font-style:italic;margin-bottom:8px;">
          ${escapeHtml(prenom)}, vous allez adorer ça aussi 💛
        </h1>
        <p style="color:rgba(234,234,234,.65);font-size:15px;line-height:1.8;margin-bottom:28px;">
          Vous avez commandé <strong style="color:${brand.colorPrimary};">${purchasedName}</strong> il y a 2 semaines.
          Nos clientes qui ont fait le même choix ont ensuite découvert ces produits — et ne les ont plus quittés.
        </p>

        ${suggestionsHtml}

        <div style="text-align:center;margin-top:28px;margin-bottom:32px;">
          <a href="${siteUrl(brand, "/boutique")}" style="background:transparent;border:1px solid rgba(212,175,55,.4);color:${brand.colorPrimary};padding:12px 24px;border-radius:999px;font-size:14px;text-decoration:none;display:inline-block;">
            Voir toute la boutique →
          </a>
        </div>

        <p style="color:rgba(234,234,234,.3);font-size:12px;text-align:center;">
          Vous recevez cet email car vous avez commandé sur ${escapeHtml(brand.brandName)}.<br>
          <a href="${siteUrl(brand, "/newsletter/unsubscribe")}" style="color:rgba(212,175,55,.4);">Se désinscrire</a>
        </p>
      </div>
    `,
  });

  if (error) {
    console.error("Erreur email cross-sell Resend:", error);
    throw error;
  }

  return data;
}

export async function sendCalendarReminder({
  title,
  description,
  date,
  urgency = "veille",
}) {
  if (!resend) {
    console.warn("RESEND_API_KEY manquant — rappel calendrier non envoyé");
    return null;
  }

  const brand = await getBrandSettings();
  const adminEmail = process.env.ADMIN_EMAIL || brand.replyTo;
  const safeTitle = escapeHtml(title || "Tâche");
  const safeDesc = description ? escapeHtml(description) : "";
  const dateLabel = new Date(String(date) + "T12:00:00").toLocaleDateString(
    "fr-FR",
    { weekday: "long", day: "numeric", month: "long" }
  );
  const adminUrl = siteUrl(brand, "/admin").replace(/^https?:\/\//, "");

  const smsPromise =
    urgency === "veille"
      ? sendSMS(
          `${brand.brandName} : Rappel demain - ${title}. Voir : ${adminUrl}`
        )
      : urgency === "jour-j"
        ? sendSMS(`${brand.brandName} : AUJOURD'HUI - ${title} ! ${adminUrl}`)
        : Promise.resolve();

  const { data, error } = await resend.emails.send({
    from: emailFrom(brand, "commande"),
    to: adminEmail,
    subject: `📅 Rappel ${brand.brandName} — ${title} demain`,
    html: `
      <div style="background:${brand.colorDark};padding:32px;font-family:Georgia,serif;color:#EAEAEA;max-width:600px;margin:0 auto;border-radius:12px;">
        <div style="color:${brand.colorPrimary};font-size:24px;font-weight:700;margin-bottom:16px;">${escapeHtml(brand.brandName)}</div>
        <h2 style="color:#EAEAEA;margin-bottom:12px;">📅 Rappel pour demain</h2>
        <div style="background:#161616;border:1px solid rgba(212,175,55,.2);border-radius:8px;padding:16px;margin-bottom:16px;">
          <div style="color:${brand.colorPrimary};font-size:18px;font-weight:600;margin-bottom:8px;">${safeTitle}</div>
          ${safeDesc ? `<div style="color:rgba(234,234,234,.7);font-size:14px;">${safeDesc}</div>` : ""}
          <div style="color:rgba(234,234,234,.4);font-size:12px;margin-top:8px;">Prévu le ${escapeHtml(dateLabel)}</div>
        </div>
        <a href="${siteUrl(brand, "/admin")}" style="background:${brand.colorPrimary};color:${brand.colorDark};padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:700;display:inline-block;">Ouvrir l'admin →</a>
      </div>
    `,
  });

  if (error) {
    console.error("Erreur rappel calendrier Resend:", error);
    throw error;
  }

  await smsPromise;

  return data;
}

export async function sendAbandonedCartEmail({
  email,
  customerName,
  items,
  totalCents,
  promoCode,
  discountCents,
}) {
  if (!resend) {
    console.warn("RESEND_API_KEY manquant — email panier abandonné non envoyé");
    return null;
  }

  const brand = await getBrandSettings();
  const logoHtml = await getLogoHtml(brand);
  const first = firstName(customerName) || "vous";
  const total = (Number(totalCents || 0) / 100).toFixed(2);
  const discount =
    Number(discountCents) > 0
      ? (Number(discountCents) / 100).toFixed(2)
      : null;

  const itemsHtml = (Array.isArray(items) ? items : [])
    .map((item) => {
      const qty = Number(item.quantity) || 1;
      const unit =
        item.unit_price_cents !== undefined
          ? Number(item.unit_price_cents) / 100
          : Number(item.price || 0);
      const line = (unit * qty).toFixed(2);
      return `
    <tr>
      <td style="padding:12px;border-bottom:1px solid rgba(255,255,255,.06);color:#EAEAEA;font-size:14px;">
        ${escapeHtml(item.name || "Article")}
      </td>
      <td style="padding:12px;border-bottom:1px solid rgba(255,255,255,.06);color:rgba(234,234,234,.6);font-size:13px;text-align:center;">
        × ${qty}
      </td>
      <td style="padding:12px;border-bottom:1px solid rgba(255,255,255,.06);color:${brand.colorPrimary};font-size:14px;font-weight:700;text-align:right;">
        ${line} €
      </td>
    </tr>`;
    })
    .join("");

  const { data, error } = await resend.emails.send({
    from: emailFrom(brand),
    replyTo: brand.replyTo,
    to: email,
    subject: `${first}, vous avez oublié quelque chose ✨`,
    html: `
      <div style="background:${brand.colorDark};font-family:Georgia,serif;color:#EAEAEA;padding:40px 20px;max-width:600px;margin:0 auto;">
        <div style="text-align:center;border-bottom:1px solid rgba(212,175,55,.3);padding-bottom:24px;margin-bottom:32px;">
          ${logoHtml}
        </div>

        <h1 style="font-size:24px;color:#EAEAEA;margin-bottom:8px;font-style:italic;">
          Vous avez oublié quelque chose, ${escapeHtml(first)} 🛍️
        </h1>
        <p style="color:rgba(234,234,234,.65);font-size:15px;line-height:1.7;margin-bottom:28px;">
          Votre panier ${escapeHtml(brand.brandName)} vous attend. Vos produits sélectionnés sont toujours disponibles.
        </p>

        <table style="width:100%;border-collapse:collapse;background:#161616;border-radius:12px;overflow:hidden;margin-bottom:24px;">
          ${itemsHtml}
          ${
            discount
              ? `
          <tr>
            <td colspan="2" style="padding:12px;color:#4CAF50;font-size:13px;">Code promo "${escapeHtml(promoCode || "")}"</td>
            <td style="padding:12px;color:#4CAF50;font-size:13px;text-align:right;">-${discount} €</td>
          </tr>`
              : ""
          }
          <tr>
            <td colspan="2" style="padding:12px;color:${brand.colorPrimary};font-size:16px;font-weight:700;font-family:Georgia,serif;">Total</td>
            <td style="padding:12px;color:${brand.colorPrimary};font-size:16px;font-weight:700;text-align:right;">${total} €</td>
          </tr>
        </table>

        ${emailCtaButton(siteUrl(brand, "/commander"), "Finaliser ma commande →", {
          margin: "0 0 32px",
          padding: "16px 36px",
          fontSize: "16px",
          colorPrimary: brand.colorPrimary,
          colorDark: brand.colorDark,
        })}

        <p style="color:rgba(234,234,234,.4);font-size:12px;text-align:center;">
          Vous recevez cet email car vous avez commencé une commande sur ${escapeHtml(brand.brandName)}.<br>
          <a href="${siteUrl(brand)}" style="color:rgba(212,175,55,.5);">${escapeHtml(siteUrl(brand).replace(/^https?:\/\//, ""))}</a>
        </p>
      </div>
    `,
  });

  if (error) {
    console.error("Erreur email panier abandonné Resend:", error);
    throw error;
  }

  return data;
}

export async function sendLoyaltyPointsEmail({
  email,
  customerName,
  pointsEarned,
  totalPoints,
  pointsForReward,
}) {
  if (!resend) {
    console.warn("RESEND_API_KEY manquant — email points fidélité non envoyé");
    return null;
  }

  const brand = await getBrandSettings();
  const logoHtml = await getLogoHtml(brand);
  const prenom = firstName(customerName) || "vous";
  const needed = Number(pointsForReward) || 100;
  const balance = Number(totalPoints) || 0;
  const remaining = Math.max(0, needed - balance);
  const progress = Math.min(100, Math.round((balance / needed) * 100));

  const { data, error } = await resend.emails.send({
    from: emailFrom(brand),
    replyTo: brand.replyTo,
    to: email,
    subject: `+${pointsEarned} points fidélité ${brand.brandName} ✨`,
    html: `
      <div style="background:${brand.colorDark};font-family:Georgia,serif;color:#EAEAEA;padding:40px 20px;max-width:600px;margin:0 auto;">
        <div style="text-align:center;border-bottom:1px solid rgba(212,175,55,.3);padding-bottom:24px;margin-bottom:32px;">
          ${logoHtml}
        </div>
        <h1 style="font-size:22px;color:#EAEAEA;margin-bottom:8px;font-style:italic;">
          Bravo ${escapeHtml(prenom)} !
        </h1>
        <p style="color:rgba(234,234,234,.65);font-size:15px;line-height:1.7;margin-bottom:24px;">
          Votre commande vous rapporte <strong style="color:${brand.colorPrimary};">+${pointsEarned} point${pointsEarned > 1 ? "s" : ""}</strong>.
        </p>
        <div style="background:#161616;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;">
          <div style="color:rgba(234,234,234,.5);font-size:12px;text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px;">Solde actuel</div>
          <div style="color:${brand.colorPrimary};font-size:42px;font-weight:700;">${balance}</div>
          <div style="color:rgba(234,234,234,.45);font-size:13px;margin-top:8px;">
            ${remaining > 0 ? `Plus que ${remaining} pts pour un bon` : "Vous pouvez échanger vos points !"}
          </div>
          <div style="margin-top:16px;height:8px;background:rgba(255,255,255,.08);border-radius:4px;overflow:hidden;">
            <div style="height:100%;width:${progress}%;background:linear-gradient(90deg,#E6C766,${brand.colorPrimary});"></div>
          </div>
        </div>
        ${emailCtaButton(siteUrl(brand, "/fidelite"), "Voir mon solde →", {
          margin: "0",
          padding: "14px 28px",
          colorPrimary: brand.colorPrimary,
          colorDark: brand.colorDark,
        })}
      </div>
    `,
  });

  if (error) {
    console.error("Erreur email points fidélité Resend:", error);
    throw error;
  }
  return data;
}

export async function sendLoyaltyRewardEmail({
  email,
  customerName,
  code,
  rewardEuros,
  expiryDays,
}) {
  if (!resend) {
    console.warn("RESEND_API_KEY manquant — email bon fidélité non envoyé");
    return null;
  }

  const brand = await getBrandSettings();
  const logoHtml = await getLogoHtml(brand);
  const prenom = firstName(customerName) || "vous";
  const euros = Number(rewardEuros).toFixed(2);

  const { data, error } = await resend.emails.send({
    from: emailFrom(brand),
    replyTo: brand.replyTo,
    to: email,
    subject: `Votre bon ${brand.brandName} de ${euros} € est prêt 🎁`,
    html: `
      <div style="background:${brand.colorDark};font-family:Georgia,serif;color:#EAEAEA;padding:40px 20px;max-width:600px;margin:0 auto;">
        <div style="text-align:center;border-bottom:1px solid rgba(212,175,55,.3);padding-bottom:24px;margin-bottom:32px;">
          ${logoHtml}
        </div>
        <h1 style="font-size:22px;color:#EAEAEA;margin-bottom:8px;font-style:italic;">
          Merci pour votre fidélité, ${escapeHtml(prenom)}
        </h1>
        <p style="color:rgba(234,234,234,.65);font-size:15px;line-height:1.7;margin-bottom:24px;">
          Voici votre bon de <strong style="color:${brand.colorPrimary};">${euros} €</strong>, valable ${expiryDays} jours.
        </p>
        <div style="background:#161616;border:1px dashed rgba(212,175,55,.45);border-radius:12px;padding:24px;text-align:center;margin-bottom:28px;">
          <div style="color:rgba(234,234,234,.5);font-size:12px;margin-bottom:8px;">CODE PROMO</div>
          <div style="color:${brand.colorPrimary};font-size:28px;font-weight:700;letter-spacing:.08em;">${escapeHtml(code)}</div>
        </div>
        ${emailCtaButton(siteUrl(brand, "/boutique"), "Utiliser mon bon →", {
          margin: "0",
          padding: "14px 28px",
          colorPrimary: brand.colorPrimary,
          colorDark: brand.colorDark,
        })}
      </div>
    `,
  });

  if (error) {
    console.error("Erreur email bon fidélité Resend:", error);
    throw error;
  }
  return data;
}

export async function sendAffiliateRecapEmail({
  email,
  name,
  month,
  clicks,
  orders,
  revenueCents,
  commissionDueCents,
  commissionPaidCents,
  code,
}) {
  if (!resend) {
    console.warn("RESEND_API_KEY manquant — email récap affilié non envoyé");
    return null;
  }

  const brand = await getBrandSettings();
  const logoHtml = await getLogoHtml(brand);
  const adminEmail = process.env.ADMIN_EMAIL || brand.replyTo;
  const prenom = firstName(name) || name || "partenaires";
  const revenue = formatPrice(revenueCents || 0);
  const due = formatPrice(commissionDueCents || 0);
  const paid = formatPrice(commissionPaidCents || 0);

  const { data, error } = await resend.emails.send({
    from: emailFrom(brand),
    replyTo: brand.replyTo,
    to: email,
    subject: `Votre récapitulatif ${brand.brandName} — ${month}`,
    html: `
      <div style="background:${brand.colorDark};font-family:Georgia,serif;color:#EAEAEA;padding:40px 20px;max-width:600px;margin:0 auto;">
        <div style="text-align:center;border-bottom:1px solid rgba(212,175,55,.3);padding-bottom:24px;margin-bottom:32px;">
          ${logoHtml}
        </div>
        <h1 style="font-size:22px;color:#EAEAEA;margin-bottom:8px;font-style:italic;">
          Bonjour ${escapeHtml(prenom)}
        </h1>
        <p style="color:rgba(234,234,234,.65);font-size:15px;line-height:1.7;margin-bottom:24px;">
          Voici votre récapitulatif d'affiliation pour <strong style="color:${brand.colorPrimary};">${escapeHtml(month)}</strong>
          ${code ? ` (code <strong>${escapeHtml(code)}</strong>)` : ""}.
        </p>
        <div style="background:#161616;border-radius:12px;padding:20px;margin-bottom:24px;">
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <tr>
              <td style="padding:10px 0;color:rgba(234,234,234,.55);">Clics</td>
              <td style="padding:10px 0;text-align:right;color:#EAEAEA;font-weight:700;">${Number(clicks) || 0}</td>
            </tr>
            <tr>
              <td style="padding:10px 0;border-top:1px solid rgba(255,255,255,.06);color:rgba(234,234,234,.55);">Commandes</td>
              <td style="padding:10px 0;border-top:1px solid rgba(255,255,255,.06);text-align:right;color:#EAEAEA;font-weight:700;">${Number(orders) || 0}</td>
            </tr>
            <tr>
              <td style="padding:10px 0;border-top:1px solid rgba(255,255,255,.06);color:rgba(234,234,234,.55);">CA généré</td>
              <td style="padding:10px 0;border-top:1px solid rgba(255,255,255,.06);text-align:right;color:${brand.colorPrimary};font-weight:700;">${revenue}</td>
            </tr>
            <tr>
              <td style="padding:10px 0;border-top:1px solid rgba(255,255,255,.06);color:rgba(234,234,234,.55);">Commission due</td>
              <td style="padding:10px 0;border-top:1px solid rgba(255,255,255,.06);text-align:right;color:#81C784;font-weight:700;">${due}</td>
            </tr>
            <tr>
              <td style="padding:10px 0;border-top:1px solid rgba(255,255,255,.06);color:rgba(234,234,234,.55);">Déjà payé</td>
              <td style="padding:10px 0;border-top:1px solid rgba(255,255,255,.06);text-align:right;color:#EAEAEA;">${paid}</td>
            </tr>
          </table>
        </div>
        <p style="color:rgba(234,234,234,.5);font-size:13px;line-height:1.6;margin-bottom:24px;">
          Pour le virement de vos commissions, contactez-nous à
          <a href="mailto:${escapeHtml(adminEmail)}" style="color:${brand.colorPrimary};">${escapeHtml(adminEmail)}</a>
          en indiquant votre code affilié et vos coordonnées bancaires.
        </p>
        ${emailCtaButton(
          siteUrl(brand, `/?ref=${encodeURIComponent(code || "")}`),
          "Votre lien affilié →",
          {
            margin: "0",
            padding: "14px 28px",
            colorPrimary: brand.colorPrimary,
            colorDark: brand.colorDark,
          }
        )}
      </div>
    `,
  });

  if (error) {
    console.error("Erreur email récap affilié Resend:", error);
    throw error;
  }
  return data;
}

export async function sendReferralInviteEmail({
  email,
  customerName,
  referralCode,
  referrerDiscountPercent,
  refereeDiscountPercent,
}) {
  const brand = await getBrandSettings();
  const prenom = firstName(customerName) || "vous";
  const code = escapeHtml(referralCode);
  const link = siteUrl(brand, `/?parrain=${encodeURIComponent(referralCode)}`);
  const refPct = Math.round(Number(referrerDiscountPercent) || 10);
  const filleulePct = Math.round(Number(refereeDiscountPercent) || 10);

  return sendBrandedEmail({
    to: email,
    subject: `Partagez ${brand.brandName} et gagnez -${refPct}% 💛`,
    html: await brandedShell({
      badge: "PARRAINAGE",
      badgeColor: brand.colorPrimary,
      badgeBg: "rgba(212,175,55,.15)",
      badgeBorder: "rgba(212,175,55,.35)",
      title: `Partagez ${brand.brandName} avec vos amies`,
      bodyHtml: `
        <p style="text-align:center;margin:0 0 20px;">
          Vous avez adoré vos produits ${escapeHtml(brand.brandName)} ?<br>
          Partagez votre lien avec vos amies et gagnez une réduction sur votre prochaine commande.
        </p>
        <p style="text-align:center;font-size:14px;color:rgba(234,234,234,.65);margin:0 0 24px;">
          Votre amie reçoit <strong style="color:${brand.colorPrimary};">-${filleulePct}%</strong> sur sa première commande.<br>
          Vous recevez <strong style="color:${brand.colorPrimary};">-${refPct}%</strong> dès qu'elle commande.
        </p>
        <p style="text-align:center;font-size:13px;color:rgba(234,234,234,.5);margin:0 0 8px;word-break:break-all;">
          ${escapeHtml(link)}
        </p>
      `,
      ctaText: "Copier mon lien →",
      ctaUrl: link,
      footerNote: `Votre code parrainage : ${code}`,
      brand,
    }),
    brand,
  });
}

export async function sendReferralRewardEmail({
  email,
  customerName,
  referrerPromoCode,
  discountPercent,
}) {
  const brand = await getBrandSettings();
  const prenom = firstName(customerName) || "vous";
  const code = escapeHtml(referrerPromoCode);
  const pct = Math.round(Number(discountPercent) || 10);
  const siteHost = siteUrl(brand).replace(/^https?:\/\//, "");

  return sendBrandedEmail({
    to: email,
    subject: "Votre amie vient de commander — voici votre récompense 🎉",
    html: await brandedShell({
      badge: "RÉCOMPENSE",
      badgeColor: "#81C784",
      badgeBg: "rgba(129,199,132,.15)",
      badgeBorder: "rgba(129,199,132,.35)",
      title: `Félicitations ${escapeHtml(prenom === "vous" ? "" : prenom)} !`,
      bodyHtml: `
        <p style="text-align:center;margin:0 0 24px;">
          Félicitations ! Une de vos amies vient de passer sa première commande ${escapeHtml(brand.brandName)} grâce à vous.
        </p>
        <div style="background:#161616;border:1px dashed rgba(212,175,55,.45);border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;">
          <div style="color:rgba(234,234,234,.5);font-size:12px;margin-bottom:8px;">VOTRE CODE PROMO</div>
          <div style="font-size:28px;font-weight:700;color:${brand.colorPrimary};letter-spacing:.1em;">${code}</div>
          <div style="font-size:12px;color:rgba(234,234,234,.4);margin-top:8px;">-${pct}% · Valable 30 jours sur ${escapeHtml(siteHost)}</div>
        </div>
      `,
      ctaText: "Utiliser mon code →",
      ctaUrl: siteUrl(brand, "/boutique"),
      brand,
    }),
    brand,
  });
}

export async function sendInactiveCustomerEmail({
  email,
  customerName,
  daysSince,
}) {
  const brand = await getBrandSettings();
  const logoHtml = await getLogoHtml(brand);
  const prenom = firstName(customerName) || "vous";
  const days = Math.max(1, Math.round(Number(daysSince) || 60));
  const subject = `${prenom === "vous" ? "Vous" : prenom}, ça fait ${days} jours... on pensait à vous 💛`;

  return sendBrandedEmail({
    to: email,
    subject,
    html: `
      <div style="background:${brand.colorDark};font-family:Georgia,serif;color:#EAEAEA;padding:40px 20px;max-width:600px;margin:0 auto;">
        <div style="text-align:center;border-bottom:1px solid rgba(212,175,55,.3);padding-bottom:24px;margin-bottom:32px;">
          ${logoHtml}
        </div>

        <h1 style="font-size:22px;font-style:italic;margin-bottom:16px;">
          Bonjour ${escapeHtml(prenom)}, on pensait à vous 💛
        </h1>

        <p style="color:rgba(234,234,234,.7);font-size:15px;line-height:1.8;margin-bottom:20px;">
          Cela fait ${days} jours que vous n'avez pas commandé sur ${escapeHtml(brand.brandName)}.
        </p>

        <p style="color:rgba(234,234,234,.7);font-size:15px;line-height:1.8;margin-bottom:32px;">
          Nous avons peut-être de nouveaux produits qui vous plairont.
          Et pour vous remercier de votre fidélité, profitez de <strong style="color:${brand.colorPrimary};">-10% sur votre prochaine commande</strong> avec le code :
        </p>

        <div style="background:#161616;border:1px solid rgba(212,175,55,.3);border-radius:12px;padding:20px;text-align:center;margin-bottom:32px;">
          <div style="font-size:28px;font-weight:700;color:${brand.colorPrimary};letter-spacing:.1em;">${escapeHtml(brand.inactivePromoCode)}</div>
          <div style="font-size:12px;color:rgba(234,234,234,.4);margin-top:6px;">Valable 15 jours</div>
        </div>

        ${emailCtaButton(siteUrl(brand, "/boutique"), `Redécouvrir ${brand.brandName} →`, {
          margin: "0 0 32px",
          padding: "16px 36px",
          fontSize: "16px",
          colorPrimary: brand.colorPrimary,
          colorDark: brand.colorDark,
        })}

        <p style="color:rgba(234,234,234,.3);font-size:12px;text-align:center;">
          Vous recevez cet email car vous avez déjà commandé sur ${escapeHtml(brand.brandName)}.
        </p>
      </div>
    `,
    brand,
  });
}
