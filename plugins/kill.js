// plugins/kick.js
// Commandes de groupe (Baileys simple — aucun bouton / nativeFlow) :
// left, promote
//
// Usage :
//   {prefix}left             -> le bot quitte le groupe immédiatement
//   {prefix}promote @membre  -> nomme admin
//
// - En mode public (config.public === true) : réservées aux admins du groupe.
// - En mode privé (config.public === false)  : aucune restriction, tout le
//   monde peut les utiliser (y compris quelqu'un d'autre que le propriétaire).

const _num = (jid) => (jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');

// Compare un participant (id classique ET/OU lid) à un ou plusieurs JID
// candidats représentant l'expéditeur/le bot, sous n'importe laquelle de
// leurs formes. Nécessaire car WhatsApp peut exposer la même personne via
// deux JID différents (numéro classique vs LID) selon le contexte.
function _matchParticipant(p, ...jids) {
    const candidates = [p.id, p.lid].filter(Boolean).map(_num);
    const targets = jids.filter(Boolean).map(_num);
    if (!candidates.length || !targets.length) return false;
    return candidates.some((c) => targets.includes(c));
}

function _getRawText(message) {
    return message.message?.conversation
        || message.message?.extendedTextMessage?.text
        || message.message?.imageMessage?.caption
        || message.message?.videoMessage?.caption
        || '';
}

// Détecte quelle commande a réellement déclenché le handler, en relisant le
// texte brut du message. Si la détection échoue, on retombe sur 'left'.
function _detectCommand(message, prefix, commands) {
    const list = Array.isArray(commands) ? commands : COMMANDS;
    const text = _getRawText(message).trim();
    if (!text.startsWith(prefix)) return list[0];
    const first = text.slice(prefix.length).trim().split(/\s+/)[0]?.toLowerCase() || '';
    return list.includes(first) ? first : list[0];
}

function _getTargets(message) {
    const ctx = message.message?.extendedTextMessage?.contextInfo
        || message.message?.imageMessage?.contextInfo
        || message.message?.videoMessage?.contextInfo
        || {};

    // Construction STRICTE : jamais tout le groupe. Uniquement les JID
    // mentionnés (@membre) et/ou le participant cité en réponse.
    const targets = new Set();
    (ctx.mentionedJid || []).forEach((jid) => jid && targets.add(jid));
    if (ctx.participant) targets.add(ctx.participant);
    return [...targets];
}

const COMMANDS = ['left', 'promote'];

export default {
    name: 'kick',
    version: '5.0.0',
    description: "Gestion de groupe : left, promote",
    commands: COMMANDS,
    category: 'groupe',
    usage: '.left | .promote @membre',
    tips: [
        '.left fait quitter le bot du groupe immédiatement',
        '.promote @membre le nomme admin',
        'Mode public : réservé aux admins du groupe',
        'Mode privé : ouvert à tout le monde'
    ],

    async handler(client, message, args, { box, config }) {
        const chat = message.key.remoteJid;

        if (!chat.endsWith('@g.us')) {
            return client.sendMessage(chat, {
                text: box(`│ *❌ COMMANDE RÉSERVÉE AUX GROUPES*`)
            }, { quoted: message });
        }

        const prefix = config?.prefix || '.';
        const cmd    = _detectCommand(message, prefix, COMMANDS);

        let meta;
        try { meta = await client.groupMetadata(chat); } catch {
            return client.sendMessage(chat, {
                text: box(`│ *❌ IMPOSSIBLE DE LIRE LE GROUPE*`)
            }, { quoted: message });
        }

        const requester    = message.key.participant || message.key.remoteJid;
        const requesterAlt = message.key.participantAlt || message.key.participantPn || message.key.participantLid;
        const botNum       = _num(client.user?.id || '');
        const botLid       = _num(client.user?.lid || '');

        const isParticipantAdmin = (jid, jidAlt) => meta.participants.some(
            (p) => _matchParticipant(p, jid, jidAlt) && (p.admin === 'admin' || p.admin === 'superadmin')
        );

        const isBotAdmin = meta.participants.some(
            (p) => _matchParticipant(p, botNum, botLid) && (p.admin === 'admin' || p.admin === 'superadmin')
        );

        const requesterIsAdmin = isParticipantAdmin(requester, requesterAlt);

        // ── Mode public : réservé aux admins du groupe ──────────────────────
        // ── Mode privé : aucune restriction, tout le monde peut l'utiliser ──
        if (config?.public && !requesterIsAdmin) {
            return client.sendMessage(chat, {
                text: box(`│ *❌ COMMANDE RÉSERVÉE AUX ADMINS*`)
            }, { quoted: message });
        }

        // ═══════════════════════════════ LEFT ═══════════════════════════════
        // Aucune confirmation : le bot quitte immédiatement.
        if (cmd === 'left') {
            await client.sendMessage(chat, { text: box(`│ *👋 À BIENTÔT !*`) });
            try { await client.groupLeave(chat); } catch {}
            return;
        }

        // ══════════════════════════════ PROMOTE ══════════════════════════════
        if (cmd === 'promote') {
            const targets = _getTargets(message);

            if (targets.length === 0) {
                return client.sendMessage(chat, {
                    text: box(
                        `│ *⭐ PROMOTE*`, `│`,
                        `│ *Mentionne la personne ou réponds à son message*`
                    )
                }, { quoted: message });
            }

            if (!isBotAdmin) {
                return client.sendMessage(chat, {
                    text: box(
                        `│ *🤖 JE NE SUIS PAS ADMIN*`, `│`,
                        `│ *Rends-moi admin pour promouvoir*`
                    )
                }, { quoted: message });
            }

            const promoted = [];
            for (const jid of targets) {
                try {
                    await client.groupParticipantsUpdate(chat, [jid], 'promote');
                    promoted.push(jid);
                } catch {}
            }

            const lines = [`│ *⭐ PROMOTION*`, `│`];
            promoted.forEach((jid) => lines.push(`│ *• @${_num(jid)} est maintenant admin*`));

            return client.sendMessage(chat, {
                text: box(...lines),
                mentions: promoted
            });
        }
    }
};
