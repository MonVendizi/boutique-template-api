const BOT_DOMAINS = [
  "joonix.net",
  "storebotmail",
  "mailinator.com",
  "guerrillamail.com",
  "tempmail.com",
  "throwaway.email",
  "yopmail.com",
  "trashmail.com",
  "fakeinbox.com",
];

export function isBotEmail(email) {
  if (!email) return true;
  return BOT_DOMAINS.some((domain) =>
    String(email).toLowerCase().includes(domain)
  );
}
