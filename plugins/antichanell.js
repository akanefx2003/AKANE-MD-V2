// plugins/antichannel.js
// Détecte et sanctionne les messages transférés depuis une CHAÎNE WhatsApp
// (newsletter/channel), pas les simples transferts entre utilisateurs.
//
// Usage :
//   {prefix}antichannel on    -> mode avertissement (3 warns avant kick)
//   {prefix}antichannel kick  -> mode kick direct
//   {prefix}antichannel off   -> désactive dans ce groupe
//   {prefix}antichannel       -> affiche le statut actuel

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE   = path.join(__dirname, '..', 'database', 'antichannel.json');

const MAX_WARNS        = 3;
const KICK_IMMUNITY_MS = 30000;

const _warnCount      = new Map();
const _recentlyKicked = new Map();
const _processed      = new Set();

// ─── Persistance locale (mode par groupe) ──────────────────────────────────────

function loadDB() {
    try {
        if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    } catch {}
    return { groups: {} };
}
function saveDB(db) {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// ─── Utilitaires ───────────────────────────────────────────────────────────────

const _num = (jid) => (jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');

function _matchParticipant(p, ...jids) {
    const candidates = [p.id, p.lid].filter(Boolean).map(_num);
    const targets = jids.filter(Boolean).map(_num);
    if (!candidates.length || !targets.length) return false;
    return candidates.some((c) => targets.includes(c));
}

function _isRecentlyKicked(trackKey) {
    if (!_recentlyKicked.has(trackKey)) return false;
    if (Date.now() - _recentlyKicked.get(trackKey) < KICK_IMMUNITY_MS) return true;
    _recentlyKicked.delete(trackKey);
    return false;
}
function _markKicked(trackKey) {
    _recentlyKicked.set(trackKey, Date.now());
    if (_recentlyKicked.size > 2000) { const f = _recentlyKicked.keys().next().value; _recentlyKicked.delete(f); }
}

async function _deleteTriggerMessage(client, chat, key) {
    if (!key) return;
    try { await client.sendMessage(chat, { delete: key }); } catch {}
}

// Détecte un transfert provenant spécifiquement d'une chaîne WhatsApp
// (newsletter/channel), pas un simple "transféré" entre utilisateurs.
// NB : le nom exact du champ peut varier selon la version de Baileys —
// on vérifie plusieurs noms connus pour rester robuste.
function _isChannelForward(ctx) {
    if (!ctx) return false;
    const hasNewsletterInfo = Boolean(
        ctx.forwardedNewsletterMessageInfo
        || ctx.newsletterForwardMessageInfo
        || ctx.forwardedNewsletter
    );
    return hasNewsletterInfo;
}

// ─── Sanction ──────────────────────────────────────────────────────────────────

async function punish(client, chat, sender, senderAlt, sNum, trackKey, msgKey, box, forceKick) {
    if (_isRecentlyKicked(trackKey)) return;

    let meta;
    try { meta = await client.groupMetadata(chat); } catch { return; }

    const botNum      = _num(client.user?.id || '');
    const botLid      = _num(client.user?.lid || '');
    const isAdmin      = meta.participants.some(p => _matchParticipant(p, sender, senderAlt) && (p.admin === 'admin' || p.admin === 'superadmin'));
    const isBotAdmin   = meta.participants.some(p => _matchParticipant(p, botNum, botLid) && (p.admin === 'admin' || p.admin === 'superadmin'));

    if (isAdmin) return; // jamais sanctionner un admin

    // Le message est toujours supprimé, avec ou sans droits admin du bot,
    // tant qu'il a au moins le droit basique d'effacer ses propres envois —
    // la suppression pour tous nécessite d'être admin, sinon elle échoue
    // silencieusement (catch dans _deleteTriggerMessage).
    await _deleteTriggerMessage(client, chat, msgKey);

    if (!isBotAdmin) {
        const noAdminKey = 'noadmin:' + chat;
        if (_isRecentlyKicked(noAdminKey)) return;
        _markKicked(noAdminKey);
        return client.sendMessage(chat, {
            text: box(`│ *📡 TRANSFERT DE CHAÎNE DÉTECTÉ*`, `│`, `│ *Rends-moi admin pour que je puisse agir.*`),
            mentions: [sender]
        }).catch(() => {});
    }

    if (forceKick) {
        _warnCount.delete(trackKey);
        _markKicked(trackKey);
        try { await client.groupParticipantsUpdate(chat, [sender], 'remove'); } catch {}
        return client.sendMessage(chat, {
            text: box(`│ *📡💨 @${sNum} EXPULSÉ*`, `│`, `│ *Transfert de chaîne interdit ici.*`),
            mentions: [sender]
        });
    }

    const count = (_warnCount.get(trackKey) || 0) + 1;
    _warnCount.set(trackKey, count);
    if (_warnCount.size > 5000) { const f = _warnCount.keys().next().value; _warnCount.delete(f); }

    if (count < MAX_WARNS) {
        return client.sendMessage(chat, {
            text: box(`│ *👀 @${sNum} A TRANSFÉRÉ UNE CHAÎNE*`, `│`, `│ *Avertissement ${count}/${MAX_WARNS}*`),
            mentions: [sender]
        });
    }

    _warnCount.delete(trackKey);
    _markKicked(trackKey);
    try { await client.groupParticipantsUpdate(chat, [sender], 'remove'); } catch {}
    return client.sendMessage(chat, {
        text: box(`│ *📡💨 @${sNum} EXPULSÉ*`, `│`, `│ *Trop d'avertissements ignorés.*`),
        mentions: [sender]
    });
}

// ─── Plugin ────────────────────────────────────────────────────────────────────

export default {
    name: 'antichannel',
    version: '1.0.0',
    description: 'Supprime et sanctionne les transferts de messages depuis une chaîne WhatsApp',
    commands: ['antichannel'],
    category: 'admin',

    async onMessage(client, message, { box }) {
        try {
            const chat = message.key?.remoteJid;
            if (!chat || !chat.endsWith('@g.us')) return;
            if (message.key?.fromMe) return;

            const msgId = message.key?.id || '';
            if (msgId) {
                if (_processed.has(msgId)) return;
                _processed.add(msgId);
                if (_processed.size > 500) { const f = _processed.values().next().value; _processed.delete(f); }
            }

            const db   = loadDB();
            const mode = db.groups?.[chat];
            if (!mode || mode === 'off') return;

            const ctx = message.message?.extendedTextMessage?.contextInfo
                || message.message?.imageMessage?.contextInfo
                || message.message?.videoMessage?.contextInfo
                || message.message?.documentMessage?.contextInfo
                || {};

            if (!_isChannelForward(ctx)) return;

            const sender    = message.key?.participant || chat;
            const senderAlt = message.key?.participantAlt || message.key?.participantPn || message.key?.participantLid;
            const senderNum = _num(sender);
            const trackKey  = chat + ':' + senderNum;
            if (_isRecentlyKicked(trackKey)) return;

            return punish(client, chat, sender, senderAlt, senderNum, trackKey, message.key, box, mode === 'kick');
        } catch (e) {
            console.error('❌ [ANTICHANNEL]:', e.message);
        }
    },

    async handler(client, message, args, { config, box }) {
        const chat = message.key.remoteJid;
        if (!chat.endsWith('@g.us')) {
            return client.sendMessage(chat, {
                text: box(`│ *❌ COMMANDE RÉSERVÉE AUX GROUPES*`)
            }, { quoted: message });
        }

        const sub = (args[0] || '').toLowerCase();
        const db  = loadDB();
        db.groups = db.groups || {};

        if (sub === 'on' || sub === 'warn') {
            db.groups[chat] = 'warn';
            saveDB(db);
            return client.sendMessage(chat, { text: box(`│ *✅ ANTICHANNEL ACTIVÉ (mode avertissement)*`) });
        }

        if (sub === 'kick') {
            db.groups[chat] = 'kick';
            saveDB(db);
            return client.sendMessage(chat, { text: box(`│ *✅ ANTICHANNEL ACTIVÉ (mode kick direct)*`) });
        }

        if (sub === 'off') {
            delete db.groups[chat];
            saveDB(db);
            return client.sendMessage(chat, { text: box(`│ *✅ ANTICHANNEL DÉSACTIVÉ*`) });
        }

        const mode = db.groups[chat] || 'off';
        return client.sendMessage(chat, {
            text: box(
                `│ *📡 ANTICHANNEL — STATUT*`, `│`,
                `│ *Mode actuel : ${mode}*`, `│`,
                `│ *Usage :*`,
                `│ *${config?.prefix || '.'}antichannel on* — avertit avant kick`,
                `│ *${config?.prefix || '.'}antichannel kick* — expulse direct`,
                `│ *${config?.prefix || '.'}antichannel off* — désactive`
            )
        }, { quoted: message });
    }
};
