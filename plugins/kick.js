// plugins/kick.js
// Commandes de groupe : kick, kickall, tagall, hidetag
//
// Usage :
//   {prefix}kick @membre                -> expulse la ou les personne(s) mentionnée(s)
//   {prefix}kick  (en réponse à un msg) -> expulse l'auteur du message cité
//   {prefix}kickall confirm             -> expulse TOUS les non-admins du groupe
//   {prefix}tagall [message]            -> mentionne tout le monde, tags visibles
//   {prefix}hidetag [message]           -> mentionne tout le monde, tags invisibles

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

// Détecte quelle commande a réellement déclenché le handler (kick, kickall,
// tagall ou hidetag), en relisant le texte brut du message. Si jamais la
// détection échoue pour une raison quelconque, on retombe sur 'kick'.
function _detectCommand(message, prefix, commands) {
    const text = _getRawText(message).trim();
    if (!text.startsWith(prefix)) return commands[0];
    const first = text.slice(prefix.length).trim().split(/\s+/)[0]?.toLowerCase() || '';
    return commands.includes(first) ? first : commands[0];
}

export default {
    name: 'kick',
    version: '2.0.0',
    description: "Expulsion (kick/kickall) et mentions de groupe (tagall/hidetag)",
    commands: ['kick', 'kickall', 'tagall', 'hidetag'],
    category: 'groupe',
    usage: '.kick @membre | .kickall confirm | .tagall [message] | .hidetag [message]',
    tips: [
        'Mentionne un ou plusieurs membres pour les expulser',
        'Ou réponds simplement au message de la personne à expulser',
        '.kickall confirm expulse tous les non-admins du groupe',
        '.tagall mentionne tout le monde visiblement',
        '.hidetag mentionne tout le monde sans afficher les tags'
    ],

    async handler(client, message, args, { box, S, config }) {
        const chat = message.key.remoteJid;

        if (!chat.endsWith('@g.us')) {
            return client.sendMessage(chat, {
                text: box(
                    `│ *❌ COMMANDE RÉSERVÉE AUX GROUPES*`
                ),
                nativeFlow: S.chan
            }, { quoted: message });
        }

        const prefix = config?.prefix || '.';
        const cmd    = _detectCommand(message, prefix, this.commands);

        let meta;
        try { meta = await client.groupMetadata(chat); } catch {
            return client.sendMessage(chat, {
                text: box(
                    `│ *❌ IMPOSSIBLE DE LIRE LE GROUPE*`
                ),
                nativeFlow: S.chan
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

        if (!requesterIsAdmin) {
            return client.sendMessage(chat, {
                text: box(
                    `│ *❌ COMMANDE RÉSERVÉE AUX ADMINS*`
                ),
                nativeFlow: S.chan
            }, { quoted: message });
        }

        // ═══════════════════════════════ KICK ═══════════════════════════════
        if (cmd === 'kick') {
            const ctx = message.message?.extendedTextMessage?.contextInfo
                || message.message?.imageMessage?.contextInfo
                || message.message?.videoMessage?.contextInfo
                || {};

            // Construction STRICTE de la cible : jamais tout le groupe.
            // On ne prend QUE les JID mentionnés et/ou le participant cité.
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

            if (!isBotAdmin) {
                return client.sendMessage(chat, {
                    text: box(
                        `│ *🤖 JE NE SUIS PAS ADMIN*`, `│`,
                        `│ *Rends-moi admin pour que je puisse expulser*`
                    ),
                    nativeFlow: S.chan
                }, { quoted: message });
            }

            const toKick       = [];
            const skippedAdmin = [];
            for (const jid of targets) {
                if (_num(jid) === botNum || _num(jid) === botLid) continue; // jamais le bot lui-même
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

        // ══════════════════════════════ KICKALL ══════════════════════════════
        if (cmd === 'kickall') {
            if (!isBotAdmin) {
                return client.sendMessage(chat, {
                    text: box(
                        `│ *🤖 JE NE SUIS PAS ADMIN*`, `│`,
                        `│ *Rends-moi admin pour que je puisse expulser*`
                    ),
                    nativeFlow: S.chan
                }, { quoted: message });
            }

            if ((args[0] || '').toLowerCase() !== 'confirm') {
                return client.sendMessage(chat, {
                    text: box(
                        `│ *⚠️ ACTION IRRÉVERSIBLE*`, `│`,
                        `│ *Ceci va expulser TOUS les membres*`,
                        `│ *non-admins du groupe.*`, `│`,
                        `│ *Tape .kickall confirm pour valider*`
                    ),
                    nativeFlow: S.chan
                }, { quoted: message });
            }

            const targets = meta.participants
                .filter((p) => {
                    if (_matchParticipant(p, botNum, botLid)) return false; // jamais le bot
                    if (p.admin === 'admin' || p.admin === 'superadmin') return false; // jamais un admin
                    return true;
                })
                .map((p) => p.id);

            if (targets.length === 0) {
                return client.sendMessage(chat, {
                    text: box(`│ *❌ AUCUN MEMBRE À EXPULSER*`),
                    nativeFlow: S.chan
                }, { quoted: message });
            }

            let count = 0;
            for (const jid of targets) {
                try {
                    await client.groupParticipantsUpdate(chat, [jid], 'remove');
                    count++;
                } catch {}
                await new Promise((r) => setTimeout(r, 300)); // évite le rate-limit WhatsApp
            }

            return client.sendMessage(chat, {
                text: box(
                    `│ *👢 KICKALL TERMINÉ*`, `│`,
                    `│ *${count} membre(s) expulsé(s)*`
                ),
                nativeFlow: S.chan
            });
        }

        // ═══════════════════════════ TAGALL / HIDETAG ═══════════════════════════
        if (cmd === 'tagall' || cmd === 'hidetag') {
            const members = meta.participants
                .map((p) => p.id)
                .filter((jid) => _num(jid) !== botNum && _num(jid) !== botLid);

            if (members.length === 0) {
                return client.sendMessage(chat, {
                    text: box(`│ *❌ AUCUN MEMBRE À MENTIONNER*`),
                    nativeFlow: S.chan
                }, { quoted: message });
            }

            const customText = args.join(' ').trim();

            if (cmd === 'tagall') {
                const lines = [`│ *📢 TAGALL*`, `│`];
                if (customText) lines.push(`│ *${customText}*`, `│`);
                members.forEach((jid) => lines.push(`│ *• @${_num(jid)}*`));

                return client.sendMessage(chat, {
                    text: box(...lines),
                    mentions: members,
                    nativeFlow: S.chan
                });
            }

            // hidetag : le texte ne montre aucun @numéro, mais tout le monde
            // est notifié grâce au tableau "mentions" envoyé en arrière-plan.
            return client.sendMessage(chat, {
                text: box(
                    `│ *📢 HIDETAG*`, `│`,
                    `│ *${customText || 'Attention à tous !'}*`
                ),
                mentions: members,
                nativeFlow: S.chan
            });
        }
    }
};
