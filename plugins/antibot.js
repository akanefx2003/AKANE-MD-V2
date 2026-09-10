// plugins/antibot.js
// Détecte et sanctionne les comptes bots dans les groupes.
//
// Usage :
//   {prefix}antibot on          -> mode avertissement (3 warns avant kick)
//   {prefix}antibot kick        -> mode kick direct
//   {prefix}antibot off         -> désactive dans ce groupe
//   {prefix}antibot addbot [n]  -> ajoute un numéro à la liste noire (kick immédiat)
//   {prefix}antibot reset @mbr  -> efface le casier d'avertissements de la personne
//   {prefix}antibot             -> affiche le statut actuel

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE   = path.join(__dirname, '..', 'database', 'antibot.json');

const MAX_WARNS        = 3; // 3 avertissements avant expulsion
const KICK_IMMUNITY_MS = 30000;

const _warnCount      = new Map();
const _recentlyKicked = new Map();
const _processed      = new Set();

// ─── Persistance locale (mode par groupe + liste noire) ───────────────────────

function loadDB() {
    try {
        if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    } catch {}
    return { groups: {}, knownBots: [] };
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

// Cherche une cible (mention ou réponse) dans le message de COMMANDE lui-même,
// utilisé par .antibot reset @membre.
function _getCommandTarget(message) {
    const ctx = message.message?.extendedTextMessage?.contextInfo || {};
    if (ctx.mentionedJid?.[0]) return ctx.mentionedJid[0];
    if (ctx.participant) return ctx.participant;
    return null;
}

function _isBotCheck(id, resolvedSender, mtype) {
    const isBotId     = (id.startsWith('3EB0') || id.startsWith('BAE5')) && id.length <= 24;
    const resolvedNum = _num(resolvedSender || '');
    const isBotSender = resolvedNum.length > 16 || (resolvedSender || '').endsWith('@bot');
    let isBot = isBotId || isBotSender;
    if (mtype === 'conversation') isBot = false;
    return isBot;
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

    if (isAdmin) return;

    if (!isBotAdmin) {
        const noAdminKey = 'noadmin:' + chat;
        if (_isRecentlyKicked(noAdminKey)) return;
        _markKicked(noAdminKey);
        return client.sendMessage(chat, {
            text: box(`│ *🤖 BOT DÉTECTÉ : @${sNum}*`, `│`, `│ *Rends-moi admin pour que je puisse agir.*`),
            mentions: [sender]
        }).catch(() => {});
    }

    if (forceKick) {
        _warnCount.delete(trackKey);
        _markKicked(trackKey);
        await _deleteTriggerMessage(client, chat, msgKey);
        try { await client.groupParticipantsUpdate(chat, [sender], 'remove'); } catch {}
        return client.sendMessage(chat, {
            text: box(`│ *🤖💨 @${sNum} EXPULSÉ*`, `│`, `│ *Les bots ne sont pas autorisés ici.*`),
            mentions: [sender]
        });
    }

    const count = (_warnCount.get(trackKey) || 0) + 1;
    _warnCount.set(trackKey, count);
    if (_warnCount.size > 5000) { const f = _warnCount.keys().next().value; _warnCount.delete(f); }

    await _deleteTriggerMessage(client, chat, msgKey);

    if (count < MAX_WARNS) {
        return client.sendMessage(chat, {
            text: box(`│ *👀 @${sNum} RESSEMBLE À UN BOT*`, `│`, `│ *Avertissement ${count}/${MAX_WARNS}*`),
            mentions: [sender]
        });
    }

    _warnCount.delete(trackKey);
    _markKicked(trackKey);
    try { await client.groupParticipantsUpdate(chat, [sender], 'remove'); } catch {}
    return client.sendMessage(chat, {
        text: box(`│ *🤖💨 @${sNum} EXPULSÉ*`, `│`, `│ *Trop d'avertissements ignorés.*`),
        mentions: [sender]
    });
}

// ─── Plugin ────────────────────────────────────────────────────────────────────

export default {
    name: 'antibot',
    version: '2.0.0',
    description: 'Détecte et sanctionne les comptes bots dans les groupes',
    commands: ['antibot'],
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

            const sender    = message.key?.participant || chat;
            const senderAlt = message.key?.participantAlt || message.key?.participantPn || message.key?.participantLid;
            const senderNum = _num(sender);
            const trackKey  = chat + ':' + senderNum;
            if (_isRecentlyKicked(trackKey)) return;

            const mtype = message.message ? Object.keys(message.message)[0] : '';
            const id    = message.key?.id || '';

            if ((db.knownBots || []).includes(senderNum)) {
                return punish(client, chat, sender, senderAlt, senderNum, trackKey, message.key, box, true);
            }

            const isBot = _isBotCheck(id, sender, mtype);
            if (!isBot) return;

            return punish(client, chat, sender, senderAlt, senderNum, trackKey, message.key, box, mode === 'kick');
        } catch (e) {
            console.error('❌ [ANTIBOT]:', e.message);
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
        db.groups    = db.groups || {};
        db.knownBots = db.knownBots || [];

        if (sub === 'on' || sub === 'warn') {
            db.groups[chat] = 'warn';
            saveDB(db);
            return client.sendMessage(chat, { text: box(`│ *✅ ANTIBOT ACTIVÉ (mode avertissement)*`) });
        }

        if (sub === 'kick') {
            db.groups[chat] = 'kick';
            saveDB(db);
            return client.sendMessage(chat, { text: box(`│ *✅ ANTIBOT ACTIVÉ (mode kick direct)*`) });
        }

        if (sub === 'off') {
            delete db.groups[chat];
            saveDB(db);
            return client.sendMessage(chat, { text: box(`│ *✅ ANTIBOT DÉSACTIVÉ*`) });
        }

        if (sub === 'addbot') {
            const numArg = (args[1] || '').replace(/\D/g, '');
            if (!numArg) return client.sendMessage(chat, {
                text: box(`│ *Usage : ${config?.prefix || '.'}antibot addbot [numéro]*`)
            }, { quoted: message });
            if (!db.knownBots.includes(numArg)) db.knownBots.push(numArg);
            saveDB(db);
            return client.sendMessage(chat, { text: box(`│ *✅ AJOUTÉ À LA LISTE NOIRE : ${numArg}*`) });
        }

        // ── Effacer le casier d'avertissements de quelqu'un ────────────────
        if (sub === 'reset' || sub === 'clear') {
            const target = _getCommandTarget(message);
            if (!target) {
                return client.sendMessage(chat, {
                    text: box(
                        `│ *❌ CIBLE MANQUANTE*`, `│`,
                        `│ *Mentionne la personne ou réponds à son message*`, `│`,
                        `│ *${config?.prefix || '.'}antibot reset @membre*`
                    )
                }, { quoted: message });
            }

            const targetNum = _num(target);
            const trackKey  = chat + ':' + targetNum;
            _warnCount.delete(trackKey);
            _recentlyKicked.delete(trackKey);

            const idx = db.knownBots.indexOf(targetNum);
            if (idx !== -1) db.knownBots.splice(idx, 1);
            saveDB(db);

            return client.sendMessage(chat, {
                text: box(`│ *🧹 CASIER EFFACÉ POUR @${targetNum}*`),
                mentions: [target]
            }, { quoted: message });
        }

        const mode = db.groups[chat] || 'off';
        return client.sendMessage(chat, {
            text: box(
                `│ *🤖 ANTIBOT — STATUT*`, `│`,
                `│ *Mode actuel : ${mode}*`, `│`,
                `│ *Usage :*`,
                `│ *${config?.prefix || '.'}antibot on* — avertit avant kick`,
                `│ *${config?.prefix || '.'}antibot kick* — expulse direct`,
                `│ *${config?.prefix || '.'}antibot off* — désactive`,
                `│ *${config?.prefix || '.'}antibot addbot [num]* — liste noire`,
                `│ *${config?.prefix || '.'}antibot reset @mbr* — efface son casier`
            )
        }, { quoted: message });
    }
};
