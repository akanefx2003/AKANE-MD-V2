// plugins/kick.js
// Expulse un membre du groupe en le mentionnant (@membre) et/ou en répondant
// à un de ses messages. Supporte plusieurs mentions à la fois.
//
// Usage :
//   {prefix}kick @membre                -> expulse la ou les personne(s) mentionnée(s)
//   {prefix}kick  (en réponse à un msg) -> expulse l'auteur du message cité
//   {prefix}kick @membre (en réponse)   -> expulse mention(s) + auteur du message cité

const _num = (jid) => (jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');

export default {
    name: 'kick',
    version: '1.0.0',
    description: "Expulse un membre en le mentionnant ou en répondant à son message",
    commands: ['kick'],
    category: 'groupe',
    usage: '.kick @membre  |  .kick (en réponse à un message)',
    tips: [
        'Mentionne un ou plusieurs membres pour les expulser',
        'Ou réponds simplement au message de la personne à expulser',
        'Les deux méthodes peuvent être combinées'
    ],

    async handler(client, message, args, { box, S }) {
        const chat = message.key.remoteJid;

        if (!chat.endsWith('@g.us')) {
            return client.sendMessage(chat, {
                text: box(
                    `│ *❌ COMMANDE RÉSERVÉE AUX GROUPES*`
                ),
                nativeFlow: S.chan
            }, { quoted: message });
        }

        const ctx = message.message?.extendedTextMessage?.contextInfo
            || message.message?.imageMessage?.contextInfo
            || message.message?.videoMessage?.contextInfo
            || {};

        // ── Construction STRICTE de la cible : jamais tout le groupe ─────────
        // On ne prend QUE les JID explicitement mentionnés (@membre) et/ou le
        // participant cité en réponse. On ne touche jamais à meta.participants
        // pour construire la liste des personnes à expulser.
        const targets = new Set();
        (ctx.mentionedJid || []).forEach((jid) => jid && targets.add(jid));
        if (ctx.participant) targets.add(ctx.participant);

        if (targets.size === 0) {
            return client.sendMessage(chat, {
                text: box(
                    `│ *👢 KICK*`, `│`,
                    `│ *Mentionne la personne ou réponds à son message*`, `│`,
                    `│ *.kick @membre*`,
                    `│ *.kick* (en réponse à un message)`
                ),
                nativeFlow: S.chan
            }, { quoted: message });
        }

        let meta;
        try { meta = await client.groupMetadata(chat); } catch {
            return client.sendMessage(chat, {
                text: box(
                    `│ *❌ IMPOSSIBLE DE LIRE LE GROUPE*`
                ),
                nativeFlow: S.chan
            }, { quoted: message });
        }

        const requester = message.key.participant || message.key.remoteJid;
        const botNum    = _num(client.user?.id || '');

        const isParticipantAdmin = (jid) => meta.participants.some(
            (p) => _num(p.id) === _num(jid) && (p.admin === 'admin' || p.admin === 'superadmin')
        );

        const isBotAdmin = meta.participants.some(
            (p) => _num(p.id) === botNum && (p.admin === 'admin' || p.admin === 'superadmin')
        );

        if (!isBotAdmin) {
            return client.sendMessage(chat, {
                text: box(
                    `│ *🤖 JE NE SUIS PAS ADMIN*`, `│`,
                    `│ *Rends-moi admin pour que je puisse expulser*`
                ),
                nativeFlow: S.chan
            }, { quoted: message });
        }

        if (!isParticipantAdmin(requester)) {
            return client.sendMessage(chat, {
                text: box(
                    `│ *❌ COMMANDE RÉSERVÉE AUX ADMINS*`
                ),
                nativeFlow: S.chan
            }, { quoted: message });
        }

        // ── Filtrage de sécurité : jamais le bot lui-même, jamais un admin ──
        const toKick       = [];
        const skippedAdmin = [];
        for (const jid of targets) {
            if (_num(jid) === botNum) continue; // le bot ne s'auto-expulse jamais
            if (isParticipantAdmin(jid)) { skippedAdmin.push(jid); continue; }
            toKick.push(jid);
        }

        if (toKick.length === 0) {
            return client.sendMessage(chat, {
                text: box(
                    `│ *❌ AUCUNE CIBLE VALIDE*`, `│`,
                    `│ *(admin ou moi-même)*`
                ),
                nativeFlow: S.chan
            }, { quoted: message });
        }

        const kicked = [];
        for (const jid of toKick) {
            try {
                await client.groupParticipantsUpdate(chat, [jid], 'remove');
                kicked.push(jid);
            } catch {}
        }

        const lines = [`│ *👢 EXPULSION*`, `│`];
        kicked.forEach((jid) => lines.push(`│ *• @${_num(jid)}*`));
        if (skippedAdmin.length) {
            lines.push(`│`, `│ *⚠️ Non expulsé (admin) :*`);
            skippedAdmin.forEach((jid) => lines.push(`│ *• @${_num(jid)}*`));
        }

        return client.sendMessage(chat, {
            text: box(...lines),
            mentions: [...kicked, ...skippedAdmin],
            nativeFlow: S.chan
        });
    }
};
