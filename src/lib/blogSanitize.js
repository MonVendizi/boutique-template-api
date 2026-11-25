/**
 * Nettoyage des textes d'articles blog (sections, FAQ).
 * Autorisé : http(s), mailto, chemins relatifs (/…).
 * Interdit : javascript:, data:, vbscript:, //…, balises dangereuses.
 */

const HTML_A_RE =
  /<a\s+[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;

/**
 * Remplace chaque [label](url) en respectant les parenthèses dans l’URL.
 * @param {string} text
 * @param {(label: string, href: string) => string} replacer
 */
export function replaceMarkdownLinks(text, replacer) {
  const src = String(text || "");
  let out = "";
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf("[", i);
    if (open === -1) {
      out += src.slice(i);
      break;
    }
    const mid = src.indexOf("](", open + 1);
    if (mid === -1) {
      out += src.slice(i);
      break;
    }
    // Pas de ] ou [ dans le label
    const label = src.slice(open + 1, mid);
    if (label.includes("[") || label.includes("]")) {
      out += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    let depth = 1;
    let j = mid + 2;
    while (j < src.length && depth > 0) {
      const ch = src[j];
      if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
      j += 1;
    }
    if (depth !== 0) {
      out += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    const href = src.slice(mid + 2, j - 1);
    out += src.slice(i, open);
    out += replacer(label, href);
    i = j;
  }
  return out;
}

/**
 * @param {unknown} raw
 * @returns {string|null} href sûr ou null
 */
export function sanitizeHref(raw) {
  if (raw == null) return null;
  let href = String(raw).trim();
  if (!href) return null;

  // Décoder une fois les entités courantes
  href = href
    .replace(/&amp;/gi, "&")
    .replace(/&#0*58;/gi, ":")
    .replace(/&#x0*3a;/gi, ":");

  // Espaces / contrôle
  if (/[\u0000-\u001f\u007f]/.test(href)) return null;

  const lower = href.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("vbscript:") ||
    lower.startsWith("blob:")
  ) {
    return null;
  }

  // Protocol-relative //evil.com
  if (href.startsWith("//")) return null;

  if (lower.startsWith("mailto:")) {
    const rest = href.slice(7);
    if (!rest || /[\s<>"']/.test(rest)) return null;
    return `mailto:${rest}`;
  }

  if (lower.startsWith("http://") || lower.startsWith("https://")) {
    try {
      const u = new URL(href);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      // Garder la forme d’origine (pas de slash final forcé) pour le round-trip.
      return href;
    } catch {
      return null;
    }
  }

  // Relatif boutique : /produits/…, /boutique?…, #ancre
  if (href.startsWith("/") || href.startsWith("#") || href.startsWith("?")) {
    if (href.startsWith("/\\") || href.includes("://")) return null;
    return href;
  }

  return null;
}

/**
 * Label d’un <a> : retire uniquement d’éventuelles balises imbriquées dans le label.
 * Le texte hors-<a> n’est PAS strippé (round-trip : « prix < 50 », « <test> », etc.).
 * Le rendu React échappe le HTML restant.
 */
function plainLabel(html) {
  return String(html || "")
    .replace(/<\/?[a-zA-Z][^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Convertit <a href>…</a> en markdown [label](url) ; laisse le reste du texte intact. */
export function htmlAnchorsToMarkdown(text) {
  return String(text || "").replace(HTML_A_RE, (_m, _q, href, label) => {
    const safe = sanitizeHref(href);
    const plain = plainLabel(label).trim() || "lien";
    if (!safe) return plain;
    return `[${plain}](${safe})`;
  });
}

/** Réécrit les liens markdown avec href validés ; lien invalide → label seul. */
export function sanitizeMarkdownLinks(text) {
  return replaceMarkdownLinks(text, (label, href) => {
    const safe = sanitizeHref(href);
    const plain = String(label).replace(/\n/g, " ").trim() || "lien";
    if (!safe) return plain;
    return `[${plain}](${safe})`;
  });
}

/** Pipeline complet pour un champ texte article. */
export function sanitizeBlogText(text) {
  if (text == null) return "";
  let out = String(text);
  out = htmlAnchorsToMarkdown(out);
  out = sanitizeMarkdownLinks(out);
  return out;
}

export function sanitizeBlogSections(sections) {
  if (!Array.isArray(sections)) return [];
  return sections.map((s, i) => ({
    id: s?.id != null ? String(s.id) : `section-${i}`,
    h2: String(s?.h2 || ""),
    text: sanitizeBlogText(s?.text),
    image: s?.image != null ? String(s.image) : "",
    image_position: s?.image_position === "right" ? "right" : "left",
    image_alt: s?.image_alt != null ? String(s.image_alt) : "",
  }));
}

export function sanitizeBlogFaq(faq) {
  if (!Array.isArray(faq)) return [];
  return faq
    .map((item) => ({
      question: String(item?.question || "").trim(),
      answer: sanitizeBlogText(item?.answer || "").trim(),
    }))
    .filter((item) => item.question || item.answer)
    .slice(0, 6);
}

export function isExternalHref(href) {
  const h = String(href || "").toLowerCase();
  return h.startsWith("http://") || h.startsWith("https://");
}

/**
 * Découpe un texte en segments texte / liens markdown sûrs
 * (même logique que boutique-template/src/lib/blogRichText.tsx).
 * @param {string} text
 * @returns {Array<{type:'text',value:string}|{type:'link',label:string,href:string,external:boolean}>}
 */
export function parseBlogTextParts(text) {
  const src = String(text || "");
  if (!src) return [];
  const parts = [];
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf("[", i);
    if (open === -1) {
      parts.push({ type: "text", value: src.slice(i) });
      break;
    }
    const mid = src.indexOf("](", open + 1);
    if (mid === -1) {
      parts.push({ type: "text", value: src.slice(i) });
      break;
    }
    const label = src.slice(open + 1, mid);
    if (label.includes("[") || label.includes("]")) {
      parts.push({ type: "text", value: src.slice(i, open + 1) });
      i = open + 1;
      continue;
    }
    let depth = 1;
    let j = mid + 2;
    while (j < src.length && depth > 0) {
      const ch = src[j];
      if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
      j += 1;
    }
    if (depth !== 0) {
      parts.push({ type: "text", value: src.slice(i, open + 1) });
      i = open + 1;
      continue;
    }
    if (open > i) {
      parts.push({ type: "text", value: src.slice(i, open) });
    }
    const rawHref = src.slice(mid + 2, j - 1);
    const href = sanitizeHref(rawHref);
    if (href) {
      parts.push({
        type: "link",
        label,
        href,
        external: isExternalHref(href),
      });
    } else {
      parts.push({ type: "text", value: label });
    }
    i = j;
  }
  return parts;
}

/** Extrait les liens markdown sûrs d’un texte (via replaceMarkdownLinks). */
export function extractMarkdownLinks(text) {
  const links = [];
  replaceMarkdownLinks(String(text || ""), (label, href) => {
    const safe = sanitizeHref(href);
    if (safe) links.push({ label: String(label), href: safe });
    return `[${label}](${href})`;
  });
  return links;
}
