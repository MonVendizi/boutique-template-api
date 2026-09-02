import { sendContactEmail } from "../lib/email.js";

export default async function contactRoutes(fastify) {
  fastify.post("/contact", async (request, reply) => {
    const { name, email, phone, topic, message, website } = request.body || {};

    if (website) {
      return reply.send({ ok: true });
    }

    if (!name?.trim() || !email?.trim() || !message?.trim()) {
      return reply.status(400).send({ error: "Champs obligatoires manquants" });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return reply.status(400).send({ error: "E-mail invalide" });
    }

    try {
      await sendContactEmail({
        name: name.trim(),
        email: email.trim(),
        phone: phone?.trim() || "",
        topic: topic?.trim() || "Question générale",
        message: message.trim(),
      });
      return reply.send({ ok: true });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: "Envoi impossible" });
    }
  });
}
