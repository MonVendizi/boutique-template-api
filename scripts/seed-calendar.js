import dotenv from "dotenv";
import pool from "../src/db/pool.js";

dotenv.config();

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function nextDate(month, day) {
  const now = new Date();
  let year = now.getFullYear();
  let candidate = new Date(year, month - 1, day);
  if (candidate < now) {
    candidate = new Date(year + 1, month - 1, day);
  }
  return candidate;
}

function lastSundayOfMay(year) {
  const d = new Date(year, 4, 31);
  while (d.getDay() !== 0) {
    d.setDate(d.getDate() - 1);
  }
  return d;
}

function blackFriday(year) {
  const nov = new Date(year, 10, 1);
  let fridays = 0;
  for (let day = 1; day <= 30; day++) {
    const d = new Date(year, 10, day);
    if (d.getDay() === 5) {
      fridays += 1;
      if (fridays === 4) return d;
    }
  }
  return nov;
}

const now = new Date();
const TODAY = formatDate(now);
const MONTH1 = formatDate(addMonths(now, 1));
const MONTH2 = formatDate(addMonths(now, 2));
const MONTH3 = formatDate(addMonths(now, 3));

const feb14 = nextDate(2, 14);
const FEB14 = formatDate(feb14);
const FEB14_MINUS_14 = formatDate(addDays(feb14, -14));

const mar8 = nextDate(3, 8);
const MAR8 = formatDate(mar8);
const MAR8_MINUS_7 = formatDate(addDays(mar8, -7));

const mothersDay = lastSundayOfMay(
  lastSundayOfMay(now.getFullYear()) < now
    ? now.getFullYear() + 1
    : now.getFullYear()
);
const MOTHERS_DAY = formatDate(mothersDay);
const MOTHERS_DAY_MINUS_21 = formatDate(addDays(mothersDay, -21));

const bfYear =
  blackFriday(now.getFullYear()) < now
    ? now.getFullYear() + 1
    : now.getFullYear();
const blackFridayDate = blackFriday(bfYear);
const BLACK_FRIDAY = formatDate(blackFridayDate);
const BLACK_FRIDAY_MINUS_7 = formatDate(addDays(blackFridayDate, -7));

const decYear = now.getMonth() >= 11 ? now.getFullYear() + 1 : now.getFullYear();
const DEC15 = formatDate(new Date(decYear, 11, 15));
const DEC20 = formatDate(new Date(decYear, 11, 20));

const GENERIC_TASKS = [
  // Lancement
  {
    title: "Configurer les paramètres de la boutique",
    description:
      "Admin → Personnalisation → remplir identité, couleurs, logo, textes home, footer et légal.",
    date: TODAY,
    type: "task",
  },
  {
    title: "Ajouter vos premiers produits",
    description:
      "Admin → Catalogue → Produits → Nouveau produit. Ajoutez photos, description, prix et activez la landing page si souhaité.",
    date: TODAY,
    type: "task",
  },
  {
    title: "Configurer les emails",
    description:
      "Admin → Personnalisation → Emails → renseigner nom expéditeur, reply-to et signature.",
    date: TODAY,
    type: "task",
  },
  {
    title: "Configurer les pages légales",
    description:
      "Admin → Personnalisation → Légal → remplir mentions légales, CGV, politique confidentialité.",
    date: TODAY,
    type: "task",
  },
  {
    title: "Activer la popup newsletter",
    description:
      "Admin → Paramètres → Popup newsletter → définir le % de réduction et activer.",
    date: TODAY,
    type: "task",
  },

  // Mois 1
  {
    title: "Envoyer la première newsletter",
    description:
      "Admin → Newsletter → Nouvelle campagne → présenter votre boutique à vos premiers abonnés.",
    date: MONTH1,
    type: "content",
  },
  {
    title: "Publier votre premier article de blog",
    description:
      "Admin → Blog → Nouvel article → rédigez un article sur votre produit phare. Optimisé SEO.",
    date: MONTH1,
    type: "content",
  },
  {
    title: "Créer vos premiers codes promo",
    description:
      "Admin → Codes Promo → créer BIENVENUE10 pour les nouveaux abonnés et RETOUR10 pour les clients inactifs.",
    date: MONTH1,
    type: "task",
  },

  // Mois 2
  {
    title: "Activer le programme fidélité",
    description:
      "Admin → Fidélité → configurer les points par euro et la valeur des bons. Activer le programme.",
    date: MONTH2,
    type: "task",
  },
  {
    title: "Activer le programme parrainage",
    description:
      "Admin → Parrainage → définir les % de réduction marraine et filleule. Activer.",
    date: MONTH2,
    type: "task",
  },
  {
    title: "Recruter vos premières affiliées",
    description:
      "Identifier 3-5 micro-influenceuses dans votre niche (Instagram, TikTok). Envoyer un DM avec proposition de partenariat. Créer leurs liens dans Admin → Affiliation.",
    date: MONTH2,
    type: "task",
  },

  // Événements commerciaux (dates relatives)
  {
    title: "Préparer la campagne Saint-Valentin",
    description:
      "Créer code promo AMOUR14. Préparer newsletter et posts réseaux sociaux sur le thème des cadeaux.",
    date: FEB14_MINUS_14,
    type: "promo",
  },
  {
    title: "Lancer la campagne Saint-Valentin",
    description:
      "Envoyer la newsletter Saint-Valentin. Publier sur Instagram et TikTok. Activer le code AMOUR14.",
    date: FEB14,
    type: "promo",
  },
  {
    title: "Préparer la Journée de la Femme",
    description:
      "Créer code promo FEMME8MARS. Préparer des visuels et une newsletter dédiée.",
    date: MAR8_MINUS_7,
    type: "promo",
  },
  {
    title: "Lancer la campagne Journée de la Femme",
    description:
      "Envoyer la newsletter. Publier posts et stories. Activer le code FEMME8MARS.",
    date: MAR8,
    type: "promo",
  },
  {
    title: "Préparer la Fête des Mères",
    description:
      "Créer code promo MAMAN. Préparer visuels \"idées cadeaux\". Planifier 3 posts Instagram J-21, J-7, Jour J.",
    date: MOTHERS_DAY_MINUS_21,
    type: "promo",
  },
  {
    title: "Lancer la campagne Fête des Mères",
    description:
      "Envoyer la newsletter Fête des Mères. Publier posts et stories. Urgence livraison J-2.",
    date: MOTHERS_DAY,
    type: "promo",
  },
  {
    title: "Préparer le Black Friday",
    description:
      'Créer code promo BLACK20. Préparer les visuels. Teaser "quelque chose arrive le 27..." J-7.',
    date: BLACK_FRIDAY_MINUS_7,
    type: "promo",
  },
  {
    title: "Lancer le Black Friday",
    description:
      "Activer le code BLACK20. Envoyer newsletter urgence. Publier stories et posts toutes les 4h.",
    date: BLACK_FRIDAY,
    type: "promo",
  },
  {
    title: "Campagne Noël — idées cadeaux",
    description:
      "Publier 3 posts \"idées cadeaux\". Envoyer newsletter. Créer urgence livraison avant Noël.",
    date: DEC15,
    type: "promo",
  },
  {
    title: "Dernier délai livraison avant Noël",
    description:
      'Post et stories urgence : "Dernier jour pour commander avant Noël". Email relance clients.',
    date: DEC20,
    type: "promo",
  },

  // Contenu récurrent
  {
    title: "Analyser le comportement visiteurs",
    description:
      "Admin → Comportement → analyser les clics et scroll de la semaine. Identifier les points de friction.",
    date: MONTH1,
    type: "task",
  },
  {
    title: "Consulter les analytics GA4",
    description:
      "Admin → Analytics → vérifier les sources de trafic, pages vues et taux de conversion du mois.",
    date: MONTH1,
    type: "task",
  },
  {
    title: "Relancer les clients inactifs",
    description:
      "Admin → Clients inactifs → sélectionner les clients sans commande depuis 60 jours → Relancer avec RETOUR10.",
    date: MONTH2,
    type: "task",
  },
  {
    title: "Vérifier les paniers abandonnés",
    description:
      "Admin → Paniers abandonnés → vérifier le taux de récupération. L'email H+1 est automatique.",
    date: MONTH1,
    type: "task",
  },
  {
    title: "Publier un article de blog SEO",
    description:
      "Rédiger un article optimisé sur un mot-clé de votre niche. Publier dans Admin → Blog.",
    date: MONTH2,
    type: "content",
  },
  {
    title: "Envoyer le récapitulatif affiliées",
    description:
      'Admin → Affiliation → cliquer "Envoyer récapitulatif" pour chaque affiliée active. Payer les commissions du mois.',
    date: MONTH2,
    type: "task",
  },
  {
    title: "Bilan trimestriel",
    description:
      "Exporter le CSV comptabilité (Admin → Export). Analyser le CA, panier moyen et taux de conversion du trimestre.",
    date: MONTH3,
    type: "task",
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

  for (const task of GENERIC_TASKS) {
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
