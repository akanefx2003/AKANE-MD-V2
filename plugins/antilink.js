// plugins/antilink.js
// Détecte et sanctionne les liens postés dans le groupe (URLs classiques
// et liens d'invitation WhatsApp).
//
// Usage :
//   {prefix}antilink on    -> mode avertissement (3 warns avant kick)
//   {prefix}antilink kick  -> mode kick direct
//   {prefix}antilink off   -> désactive dans ce groupe
//   {prefix}antilink       -> affiche le statut actuel

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE   = path.join(__dirname, '..', 'database', 'antilink.json');

const MAX_WARNS        = 3;
const KICK_IMMUNITY_MS = 30000;

const LINK_REGEX = /(https?:\/\/|www\.)\S+|chat\.whatsapp\.com\/\S+/i;

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

function _getRawText(message) {
    return message.message?.conversation
        || message.message?.extendedTextMessage?.text
        || message.message?.imageMessage?.caption
        || message.message?.videoMessage?.caption
        || '';
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

    await _deleteTriggerMessage(client, chat, msgKey);

    if (!isBotAdmin) {
        const noAdminKey = 'noadmin:' + chat;
        if (_isRecentlyKicked(noAdminKey)) return;
        _markKicked(noAdminKey);
        return client.sendMessage(chat, {
            text: box(`│ *🔗 LIEN DÉTECTÉ*`, `│`, `│ *Rends-moi admin pour que je puisse agir.*`),
            mentions: [sender]
        }).catch(() => {});
    }

    if (forceKick) {
        _warnCount.delete(trackKey);
        _markKicked(trackKey);
        try { await client.groupParticipantsUpdate(chat, [sender], 'remove'); } catch {}
        return client.sendMessage(chat, {
            text: box(`│ *🔗💨 @${sNum} EXPULSÉ*`, `│`, `│ *Les liens ne sont pas autorisés ici.*`),
            mentions: [sender]
        });
    }

    const count = (_warnCount.get(trackKey) || 0) + 1;
    _warnCount.set(trackKey, count);
    if (_warnCount.size > 5000) { const f = _warnCount.keys().next().value; _warnCount.delete(f); }

    if (count < MAX_WARNS) {
        return client.sendMessage(chat, {
            text: box(`│ *👀 @${sNum} A POSTÉ UN LIEN*`, `│`, `│ *Avertissement ${count}/${MAX_WARNS}*`),
            mentions: [sender]
        });
    }

    _warnCount.delete(trackKey);
    _markKicked(trackKey);
    try { await client.groupParticipantsUpdate(chat, [sender], 'remove'); } catch {}
    return client.sendMessage(chat, {
        text: box(`│ *🔗💨 @${sNum} EXPULSÉ*`, `│`, `│ *Trop d'avertissements ignorés.*`),
        mentions: [sender]
    });
}

// ─── Plugin ────────────────────────────────────────────────────────────────────

export default {
    name: 'antilink',
    version: '1.0.0',
    description: 'Supprime et sanctionne les liens postés dans le groupe',
    commands: ['antilink'],
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

            const text = _getRawText(message);
            if (!LINK_REGEX.test(text)) return;

            const sender    = message.key?.participant || chat;
            const senderAlt = message.key?.participantAlt || message.key?.participantPn || message.key?.participantLid;
            const senderNum = _num(sender);
            const trackKey  = chat + ':' + senderNum;
            if (_isRecentlyKicked(trackKey)) return;

            return punish(client, chat, sender, senderAlt, senderNum, trackKey, message.key, box, mode === 'kick');
        } catch (e) {
            console.error('❌ [ANTILINK]:', e.message);
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
            return client.sendMessage(chat, { text: box(`│ *✅ ANTILINK ACTIVÉ (mode avertissement)*`) });
        }

        if (sub === 'kick') {
            db.groups[chat] = 'kick';
            saveDB(db);
            return client.sendMessage(chat, { text: box(`│ *✅ ANTILINK ACTIVÉ (mode kick direct)*`) });
        }

        if (sub === 'off') {
            delete db.groups[chat];
            saveDB(db);
            return client.sendMessage(chat, { text: box(`│ *✅ ANTILINK DÉSACTIVÉ*`) });
        }

        const mode = db.groups[chat] || 'off';
        return client.sendMessage(chat, {
            text: box(
                `│ *🔗 ANTILINK — STATUT*`, `│`,
                `│ *Mode actuel : ${mode}*`, `│`,
                `│ *Usage :*`,
                `│ *${config?.prefix || '.'}antilink on* — avertit avant kick`,
                `│ *${config?.prefix || '.'}antilink kick* — expulse direct`,
                `│ *${config?.prefix || '.'}antilink off* — désactive`
            )
        }, { quoted: message });
    }
};
