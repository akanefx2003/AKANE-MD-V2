// plugins/kick.js
// Commandes de groupe (Baileys simple — aucun bouton / nativeFlow) :
// kick, kickall, tagall, hidetag, invite, left, promote, demote
//
// Usage :
//   {prefix}kick @membre                -> expulse la ou les personne(s) mentionnée(s)
//   {prefix}kick  (en réponse à un msg) -> expulse l'auteur du message cité
//   {prefix}kickall confirm             -> expulse TOUS les non-admins du groupe
//   {prefix}tagall [message]            -> mentionne tout le monde, tags visibles
//   {prefix}hidetag [message]           -> mentionne tout le monde, tags invisibles
//   {prefix}invite                      -> renvoie le lien d'invitation
//   {prefix}left                        -> le bot quitte le groupe immédiatement
//   {prefix}promote @membre             -> nomme admin
//   {prefix}demote @membre              -> retire les droits admin
//
// En mode public (config.public === true), les commandes qui modifient le
// groupe (kick, kickall, left, promote, demote) sont désactivées, pour éviter
// que n'importe qui puisse en abuser quand le bot répond à tout le monde.

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
// texte brut du message. Si la détection échoue, on retombe sur 'kick'.
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

const COMMANDS = ['kick', 'kickall', 'tagall', 'hidetag', 'invite', 'left', 'promote', 'demote'];

// Commandes désactivées quand le bot tourne en mode public.
const PUBLIC_DISABLED = ['kick', 'kickall', 'left', 'promote', 'demote'];

export default {
    name: 'kick',
    version: '4.0.0',
    description: "Gestion de groupe : kick, kickall, tagall, hidetag, invite, left, promote, demote",
    commands: COMMANDS,
    category: 'groupe',
    usage: '.kick @membre | .kickall confirm | .tagall [msg] | .hidetag [msg] | .invite | .left | .promote @membre | .demote @membre',
    tips: [
        'Mentionne un ou plusieurs membres pour les expulser',
        'Ou réponds simplement au message de la personne à expulser',
        '.kickall confirm expulse tous les non-admins du groupe',
        '.tagall mentionne tout le monde visiblement',
        '.hidetag mentionne tout le monde sans afficher les tags',
        '.invite renvoie le lien d\'invitation du groupe',
        '.left fait quitter le bot du groupe immédiatement',
        '.promote @membre le nomme admin',
        '.demote @membre lui retire les droits admin',
        'kick/kickall/left/promote/demote sont désactivés en mode public'
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

        // ── Mode public : commandes sensibles désactivées ────────────────────
        if (config?.public && PUBLIC_DISABLED.includes(cmd)) {
            return client.sendMessage(chat, {
                text: box(
                    `│ *🚫 COMMANDE DÉSACTIVÉE*`, `│`,
                    `│ *Indisponible en mode public*`
                )
            }, { quoted: message });
        }

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

        if (!requesterIsAdmin) {
            return client.sendMessage(chat, {
                text: box(`│ *❌ COMMANDE RÉSERVÉE AUX ADMINS*`)
            }, { quoted: message });
        }

        // ═══════════════════════════════ KICK ═══════════════════════════════
        if (cmd === 'kick') {
            const targets = _getTargets(message);

            if (targets.length === 0) {
                return client.sendMessage(chat, {
                    text: box(
                        `│ *👢 KICK*`, `│`,
                        `│ *Mentionne la personne ou réponds à son message*`, `│`,
                        `│ *.kick @membre*`,
                        `│ *.kick* (en réponse à un message)`
                    )
                }, { quoted: message });
            }

            if (!isBotAdmin) {
                return client.sendMessage(chat, {
                    text: box(
                        `│ *🤖 JE NE SUIS PAS ADMIN*`, `│`,
                        `│ *Rends-moi admin pour que je puisse expulser*`
                    )
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
                    )
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
                mentions: [...kicked, ...skippedAdmin]
            });
        }

        // ══════════════════════════════ KICKALL ══════════════════════════════
        if (cmd === 'kickall') {
            if (!isBotAdmin) {
                return client.sendMessage(chat, {
                    text: box(
                        `│ *🤖 JE NE SUIS PAS ADMIN*`, `│`,
                        `│ *Rends-moi admin pour que je puisse expulser*`
                    )
                }, { quoted: message });
            }

            if ((args[0] || '').toLowerCase() !== 'confirm') {
                return client.sendMessage(chat, {
                    text: box(
                        `│ *⚠️ ACTION IRRÉVERSIBLE*`, `│`,
                        `│ *Ceci va expulser TOUS les membres*`,
                        `│ *non-admins du groupe.*`, `│`,
                        `│ *Tape .kickall confirm pour valider*`
                    )
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
                    text: box(`│ *❌ AUCUN MEMBRE À EXPULSER*`)
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
                )
            });
        }

        // ══════════════════════════════ INVITE ══════════════════════════════
        if (cmd === 'invite') {
            if (!isBotAdmin) {
                return client.sendMessage(chat, {
                    text: box(
                        `│ *🤖 JE NE SUIS PAS ADMIN*`, `│`,
                        `│ *Rends-moi admin pour récupérer le lien*`
                    )
                }, { quoted: message });
            }

            let code;
            try { code = await client.groupInviteCode(chat); } catch {
                return client.sendMessage(chat, {
                    text: box(`│ *❌ IMPOSSIBLE DE RÉCUPÉRER LE LIEN*`)
                }, { quoted: message });
            }

            const link = `https://chat.whatsapp.com/${code}`;

            return client.sendMessage(chat, {
                text: box(
                    `│ *🔗 LIEN D'INVITATION*`, `│`,
                    `│ *${link}*`
                )
            });
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

        // ══════════════════════════════ DEMOTE ═══════════════════════════════
        if (cmd === 'demote') {
            const targets = _getTargets(message);

            if (targets.length === 0) {
                return client.sendMessage(chat, {
                    text: box(
                        `│ *🔻 DEMOTE*`, `│`,
                        `│ *Mentionne la personne ou réponds à son message*`
                    )
                }, { quoted: message });
            }

            if (!isBotAdmin) {
                return client.sendMessage(chat, {
                    text: box(
                        `│ *🤖 JE NE SUIS PAS ADMIN*`, `│`,
                        `│ *Rends-moi admin pour rétrograder*`
                    )
                }, { quoted: message });
            }

            const demoted = [];
            for (const jid of targets) {
                try {
                    await client.groupParticipantsUpdate(chat, [jid], 'demote');
                    demoted.push(jid);
                } catch {}
            }

            const lines = [`│ *🔻 RÉTROGRADATION*`, `│`];
            demoted.forEach((jid) => lines.push(`│ *• @${_num(jid)} n'est plus admin*`));

            return client.sendMessage(chat, {
                text: box(...lines),
                mentions: demoted
            });
        }

        // ═══════════════════════════ TAGALL / HIDETAG ═══════════════════════════
        if (cmd === 'tagall' || cmd === 'hidetag') {
            const members = meta.participants
                .map((p) => p.id)
                .filter((jid) => _num(jid) !== botNum && _num(jid) !== botLid);

            if (members.length === 0) {
                return client.sendMessage(chat, {
                    text: box(`│ *❌ AUCUN MEMBRE À MENTIONNER*`)
                }, { quoted: message });
            }

            const customText = args.join(' ').trim();

            if (cmd === 'tagall') {
                const lines = [`│ *📢 TAGALL*`, `│`];
                if (customText) lines.push(`│ *${customText}*`, `│`);
                members.forEach((jid) => lines.push(`│ *• @${_num(jid)}*`));

                return client.sendMessage(chat, {
                    text: box(...lines),
                    mentions: members
                });
            }

            // hidetag : le texte ne montre aucun @numéro, mais tout le monde
            // est notifié grâce au tableau "mentions" envoyé en arrière-plan.
            return client.sendMessage(chat, {
                text: box(
                    `│ *📢 HIDETAG*`, `│`,
                    `│ *${customText || 'Attention à tous !'}*`
                ),
                mentions: members
            });
        }
    }
};
