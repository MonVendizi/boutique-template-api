import dotenv from "dotenv";
import pool from "../src/db/pool.js";

dotenv.config();

/** Tâches marketing stratégiques TinaLuxe (événements + codes promo admin) */
const STRATEGIC_TASKS = [
  // ─── Saint-Valentin ───
  {
    title: "Créer code promo AMOUR14",
    description: "Saint-Valentin — -14% sur la boutique",
    date: "2026-02-01",
    type: "promo",
  },
  {
    title: "Newsletter Saint-Valentin",
    description: "Email coffrets karité & idées cadeau",
    date: "2026-02-07",
    type: "content",
  },
  {
    title: "Stories Instagram Saint-Valentin",
    description: "Rituels peau — idées cadeau autogift",
    date: "2026-02-10",
    type: "content",
  },

  // ─── Journée de la Femme ───
  {
    title: "Créer code promo FEMME8MARS",
    description: "Journée internationale des femmes",
    date: "2026-03-01",
    type: "promo",
  },
  {
    title: "Article blog — Femmes & karité",
    description: "Mettre en avant les productrices et le karité brut",
    date: "2026-03-05",
    type: "content",
  },

  // ─── Fête des Mères ───
  {
    title: "Réappro stock karité & savons",
    description: "Avant le pic Fête des Mères",
    date: "2026-05-15",
    type: "restock",
  },
  {
    title: "Créer code promo MAMAN2026",
    description: "Fête des Mères — offre cadeau",
    date: "2026-05-11",
    type: "promo",
  },
  {
    title: "Newsletter Fête des Mères",
    description: "Box cadeau karité + savon au lait de chèvre",
    date: "2026-05-18",
    type: "content",
  },

  // ─── Fête des Pères ───
  {
    title: "Créer code promo PAPA2026",
    description: "Fête des Pères — petite attention bien-être",
    date: "2026-06-07",
    type: "promo",
  },

  // ─── Rentrée ───
  {
    title: "Créer code promo RENTREE10",
    description: "Rentrée — routine peau après l'été",
    date: "2026-08-25",
    type: "promo",
  },
  {
    title: "Newsletter Rentrée",
    description: "Hydratation post-vacances au karité brut",
    date: "2026-08-28",
    type: "content",
  },

  // ─── Automne / affiliation ───
  {
    title: "Activer 2 affiliées",
    description: "Contacter influenceuses & clientes fidèles",
    date: "2026-09-10",
    type: "task",
  },
  {
    title: "Publier 1 article blog",
    description: "SEO karité, routines, bienfaits naturels",
    date: "2026-09-15",
    type: "content",
  },
  {
    title: "Newsletter mensuelle",
    description: "Nouveautés + témoignage cliente",
    date: "2026-09-20",
    type: "content",
  },
  {
    title: "Relance clients inactifs",
    description: "Vue Clients inactifs — email RETOUR10",
    date: "2026-10-01",
    type: "task",
  },
  {
    title: "Contenu Halloween",
    description: "Routine peau automne au karité — réseaux sociaux",
    date: "2026-10-28",
    type: "content",
  },

  // ─── Black Friday ───
  {
    title: "Préparer code BLACK20",
    description: "Black Friday — valider stock et marge",
    date: "2026-11-14",
    type: "promo",
  },
  {
    title: "Réappro stock Black Friday",
    description: "Karité brut, savons, thés",
    date: "2026-11-20",
    type: "restock",
  },
  {
    title: "Newsletter Black Friday",
    description: "Teasing 48h avant + lien early access",
    date: "2026-11-24",
    type: "content",
  },
  {
    title: "Black Friday — jour J",
    description: "Surveiller commandes & stories live",
    date: "2026-11-27",
    type: "event",
  },

  // ─── Noël ───
  {
    title: "Créer code promo NOEL2026",
    description: "Coffrets cadeaux fin d'année",
    date: "2026-12-01",
    type: "promo",
  },
  {
    title: "Communiquer date limite livraison Noël",
    description: "Bandeau site + email — délais Colissimo",
    date: "2026-12-10",
    type: "task",
  },
  {
    title: "Newsletter Noël",
    description: "Idées cadeaux dernière minute",
    date: "2026-12-15",
    type: "content",
  },
  {
    title: "Vérifier stocks fin d'année",
    description: "Karité, savons, infusions — éviter ruptures",
    date: "2026-12-20",
    type: "restock",
  },

  // ─── 2027 ───
  {
    title: "Créer code promo BONNE2027",
    description: "Jour de l'An — bonnes résolutions peau",
    date: "2026-12-26",
    type: "promo",
  },
  {
    title: "Saint-Valentin 2027 — AMOUR14",
    description: "Renouveler code promo et visuels",
    date: "2027-02-01",
    type: "promo",
  },
  {
    title: "Black Friday 2027 — BLACK20",
    description: "Préparer offre et stock",
    date: "2027-11-19",
    type: "promo",
  },

  // ─── SEPTEMBRE 2026 — Éditorial réseaux & blog ───
  {
    title: "Newsletter Septembre — Rentrée naturelle",
    description:
      'Admin → Newsletter → Rédiger. Sujet : "La rentrée, c\'est aussi le moment de prendre soin de vous." Corps : présenter le karité comme soin de rentrée, code RENTREE10, lien boutique. Envoyer aux 6 abonnés actuels.',
    date: "2026-09-01",
    type: "content",
  },
  {
    title: "Post Instagram — Lancement karité brut",
    description:
      'Photo karité brut texture avec légende : "L\'or brut du Cameroun — 100% pur, sourcé directement au Cameroun par Christina." Hashtags : #karite #beautenaturelle #tinaluxe #soinnaturel #cameroun',
    date: "2026-09-07",
    type: "content",
  },
  {
    title: "Reel TikTok/Instagram — Présentation Christina",
    description:
      '30 secondes. Christina se présente, montre ses produits, raconte pourquoi elle a créé TinaLuxe. Authentique, pas de filtre. Tourner en bonne lumière naturelle. Finir par "Découvrez notre boutique — lien en bio."',
    date: "2026-09-09",
    type: "content",
  },
  {
    title: "Article blog — Karité brut vs raffiné",
    description:
      'Utiliser ChatGPT : "Écris un article de 1000 mots sur karité brut vs karité raffiné pour TinaLuxe. Inclure : définition, différences, bienfaits karité brut, pourquoi éviter le raffiné. Mot-clé principal : karité brut vs raffiné. Style expert et accessible."',
    date: "2026-09-14",
    type: "content",
  },
  {
    title: "Post Instagram — Avis client karité",
    description:
      "Partager l'avis de Nathalie M. ou Fatoumata D. avec une belle mise en page. Fond sombre, texte doré TinaLuxe. Outil gratuit : Canva. Template : citation sur fond #0B0B0B avec accent doré.",
    date: "2026-09-16",
    type: "content",
  },
  {
    title: "Reel TikTok — 3 façons d'utiliser le karité",
    description:
      "Vidéo 45 secondes. 3 séquences : 1) karité sur la peau du visage 2) karité sur les pointes des cheveux 3) karité sur les lèvres. Musique tendance. Texte à l'écran pour chaque étape.",
    date: "2026-09-21",
    type: "content",
  },

  // ─── OCTOBRE 2026 ───
  {
    title: "Post Instagram Octobre Rose",
    description:
      'Post sobre et authentique. Texte : "Prendre soin de soi, c\'est aussi ça. Ce mois d\'octobre, on pense à toutes les femmes." Pas de promo — juste du contenu humain et sincère. Photo : produit TinaLuxe avec ruban rose discret.',
    date: "2026-10-01",
    type: "content",
  },
  {
    title: "Carousel Instagram — FAQ karité 5 slides",
    description:
      'Créer un carousel Canva 5 slides : Slide 1 "5 questions sur le karité brut", Slides 2-5 : une question/réponse par slide. Questions : bouche-t-il les pores ? combien durer un pot ? été comme hiver ? bébé ? cheveux colorés ?',
    date: "2026-10-05",
    type: "content",
  },
  {
    title: "Article blog — Thé minceur avis clientes",
    description:
      'Utiliser ChatGPT : "Écris un article 1000 mots \'Thé minceur naturel africain — avis et résultats après 30 jours\'. Inclure : bienfaits, comment préparer, résultats attendus, témoignages. Mot-clé : thé minceur naturel avis." Publier dans Admin → Blog.',
    date: "2026-10-12",
    type: "content",
  },
  {
    title: "Reel TikTok — 30 jours de karité résultat",
    description:
      'Vidéo avant/après ou témoignage. Si pas de vidéo cliente, Christina témoigne elle-même. "J\'utilise mon karité depuis X ans — voilà ce que ça fait sur ma peau." Authentique et sans filtre.',
    date: "2026-10-19",
    type: "content",
  },

  // ─── NOVEMBRE 2026 ───
  {
    title: "Article blog — Cadeaux Noël beauté naturelle",
    description:
      'ChatGPT : "Article 800 mots \'Les meilleurs cadeaux beauté naturelle pour Noël 2026\'. Mettre en avant karité, chantilly, savon et thé TinaLuxe comme idées cadeaux. Mot-clé : cadeau beauté naturelle femme noël." Publier avant le 15 novembre.',
    date: "2026-11-10",
    type: "content",
  },
  {
    title: "Teaser Black Friday Instagram",
    description:
      'Post mystère : "Quelque chose arrive le 27 novembre... Activez les notifications pour ne pas rater ça." Fond noir, texte doré, pas de détail. Objectif : créer l\'anticipation.',
    date: "2026-11-20",
    type: "content",
  },
  {
    title: "Posts Black Friday — Série 3 jours",
    description:
      'J-2 (25 nov) : "Dans 48h notre plus grande offre de l\'année" J-1 (26 nov) : "Demain ! Code BLACKFRIDAY20 — -20% sur tout" Jour J (27 nov) : "C\'est parti ! BLACKFRIDAY20 valable aujourd\'hui seulement. Lien en bio." Stories tout le weekend.',
    date: "2026-11-25",
    type: "promo",
  },

  // ─── DÉCEMBRE 2026 ───
  {
    title: "Série posts Noël — Idées cadeaux",
    description:
      'Semaine 1 décembre : 3 posts "idées cadeaux" avec chaque produit TinaLuxe. Format : photo produit + prix + "Livraison France en 2-4 jours." Créer l\'urgence sur les délais dès le 15 décembre.',
    date: "2026-12-01",
    type: "content",
  },
  {
    title: "Post urgence livraison Noël",
    description:
      'Post important : "DERNIER JOUR pour commander et recevoir avant Noël. Livraison France 2-4 jours ouvrés." À publier le 20 décembre. Stories avec compte à rebours.',
    date: "2026-12-20",
    type: "content",
  },
  {
    title: "Post Bonne Année 2027",
    description:
      'Post de fin d\'année : remercier la communauté, partager les coulisses de l\'année, annoncer les nouveautés 2027. Authentique et chaleureux. "Merci de faire partie de la communauté TinaLuxe 💛"',
    date: "2026-12-31",
    type: "content",
  },

  // ─── JANVIER 2027 ───
  {
    title: "Reel — Routine beauté naturelle 2027",
    description:
      '"Ma routine beauté naturelle pour 2027 — 5 minutes le matin." Christina montre sa routine avec les produits TinaLuxe. Tendance "get ready with me". Musique motivante. Hashtags : #routine2027 #beautenaturelle #tinaluxe',
    date: "2027-01-05",
    type: "content",
  },
  {
    title: "Article blog — Routine beauté naturelle hiver",
    description:
      'ChatGPT : "Article 900 mots \'Routine beauté naturelle simple pour l\'hiver\'. Incluant le karité comme soin essentiel. Mot-clé : routine beauté naturelle hiver." Publier début janvier.',
    date: "2027-01-08",
    type: "content",
  },
  {
    title: "Contacter 3 influenceuses beauté naturelle",
    description:
      'Identifier 3 influenceuses Instagram (5k-50k abonnés) spécialisées beauté naturelle/afro. Message type : "Bonjour [prénom], j\'ai découvert votre profil et j\'adore votre contenu. Je suis Christina, fondatrice de TinaLuxe. Je vous propose un partenariat affiliation 10% sur chaque vente générée via votre lien. Intéressée ?" Créer leurs liens dans Admin → Affiliation.',
    date: "2027-01-15",
    type: "task",
  },

  // ─── FÉVRIER 2027 ───
  {
    title: "Campagne Saint-Valentin — Posts et newsletter",
    description:
      'Posts Instagram 10-14 février : "Offrez du vrai luxe naturel à la femme que vous aimez." Newsletter le 10 février avec code AMOUR14 (-14% le 14 fév uniquement). TikTok : "Idées cadeaux Saint-Valentin pour elle — beauté naturelle"',
    date: "2027-02-10",
    type: "promo",
  },
  {
    title: "Reel TikTok — Karité peau sèche hiver",
    description:
      '"Ma peau était très sèche cet hiver — voilà ce qui a tout changé." Christina montre l\'application du karité sur peau sèche. Avant/après si possible. Authentique et sans filtre.',
    date: "2027-02-15",
    type: "content",
  },

  // ─── MARS 2027 — JOURNÉE DE LA FEMME ───
  {
    title: "JOURNÉE DE LA FEMME — Campagne complète",
    description:
      'LE moment fort de TinaLuxe. Plan complet : J-7 (1 mars) : Teaser "Quelque chose de spécial arrive le 8 mars" J-3 (5 mars) : "L\'histoire de Christina — pourquoi j\'ai créé TinaLuxe pour les femmes" Jour J (8 mars) : Post émouvant + code FEMME8MARS -10% + newsletter + Stories toute la journée. Objectif : meilleure journée de ventes de l\'année.',
    date: "2027-03-01",
    type: "promo",
  },
  {
    title: "Article blog — Journée de la Femme et beauté naturelle",
    description:
      'ChatGPT : "Article 800 mots \'Beauté naturelle africaine — l\'histoire de TinaLuxe\'. Raconter l\'histoire de Christina, ses valeurs, pourquoi le naturel. Optimisé pour \'beauté naturelle africaine\' et \'karité cameroun\'." Publier le 6 mars.',
    date: "2027-03-06",
    type: "content",
  },

  // ─── AVRIL-MAI 2027 — FÊTE DES MÈRES ───
  {
    title: "Campagne Fête des Mères — Préparation",
    description:
      "Préparer tous les visuels et textes à l'avance. Créer sur Canva : 3 posts Instagram \"idées cadeaux maman\", 1 Story compte à rebours, 1 visuel newsletter. Code MAMAN2027 à créer dans Admin → Codes Promo.",
    date: "2027-04-20",
    type: "task",
  },
  {
    title: "Fête des Mères — Posts Instagram J-21 à Jour J",
    description:
      'J-21 (4 mai) : "Idées cadeaux naturels pour votre maman" J-14 (11 mai) : Carousel quel produit TinaLuxe pour votre maman J-7 (18 mai) : "Plus qu\'une semaine — livraison garantie avant dimanche" J-2 (23 mai) : URGENCE dernière chance Jour J (25 mai) : "Bonne fête à toutes les mamans 💛"',
    date: "2027-05-04",
    type: "promo",
  },
  {
    title: "Newsletter Fête des Mères",
    description:
      "Envoyer le 18 mai. Sujet : \"Il reste 7 jours pour offrir le meilleur à votre maman.\" Corps : présenter les produits comme cadeaux idéaux, code MAMAN2027 -15%, garantie livraison avant la fête. C'est l'email le plus important de l'année.",
    date: "2027-05-18",
    type: "content",
  },
];

async function seedCalendar() {
  const force = process.argv.includes("--force");

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM calendar_tasks`
  );
  const existingCount = countRows[0]?.count || 0;

  if (existingCount > 0 && !force) {
    console.log(
      `Calendrier déjà peuplé (${existingCount} tâche(s)). Utilisez --force pour ajouter les tâches manquantes.`
    );
    await pool.end();
    return;
  }

  let inserted = 0;
  let skipped = 0;

  for (const task of STRATEGIC_TASKS) {
    const { rowCount } = await pool.query(
      `INSERT INTO calendar_tasks (title, description, date, type)
       SELECT $1, $2, $3::date, $4
       WHERE NOT EXISTS (
         SELECT 1 FROM calendar_tasks
         WHERE title = $5 AND date = $3::date
       )`,
      [task.title, task.description, task.date, task.type, task.title]
    );
    if (rowCount) inserted++;
    else skipped++;
  }

  const { rows: finalRows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM calendar_tasks`
  );

  console.log(
    `Seed calendrier OK — ${inserted} ajoutée(s), ${skipped} déjà présente(s), total: ${finalRows[0].count}`
  );
  await pool.end();
}

seedCalendar().catch((err) => {
  console.error("Erreur seed-calendar:", err);
  process.exit(1);
});
