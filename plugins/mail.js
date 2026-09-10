// plugins/mail.js
// Email temporaire via mail.tm (API publique, gratuite, documentée)

import axios from 'axios';

const API_BASE = 'https://api.mail.tm';
const mailSessions = new Map();

// ==================== CLASSE ====================

class TempMail {
    constructor(email, password, id) {
        this.email     = email;
        this.password  = password;
        this.id        = id;
        this.createdAt = Date.now();
        this.messages  = [];
        this.token     = null;
    }

    getAge() {
        return Math.floor((Date.now() - this.createdAt) / 60000);
    }

    isExpired() {
        return this.getAge() > 60;
    }
}

// ==================== EXTRACTION DE CODES ====================

function extractMainCode(text) {
    const codes = [];

    const otpMatches = text.match(/\b\d{4,8}\b/g) || [];
    if (otpMatches.length > 0) {
        const firstOtp = otpMatches[0];
        if (!firstOtp.startsWith('20') && !firstOtp.startsWith('19')) {
            codes.push({ type: 'OTP', value: firstOtp, emoji: '🔐' });
            return codes;
        }
    }

    const alphaMatches = text.match(/\b[A-Z]{4,10}\b/g) || [];
    if (alphaMatches.length > 0) {
        codes.push({ type: 'CODE', value: alphaMatches[0], emoji: '📝' });
        return codes;
    }

    if (otpMatches.length > 0) {
        codes.push({ type: 'OTP', value: otpMatches[0], emoji: '🔐' });
    }

    return codes;
}

// ==================== API mail.tm ====================

async function createTempEmail() {
    try {
        const domainRes = await axios.get(`${API_BASE}/domains`, { timeout: 8000 });
        const domain = domainRes.data['hydra:member'][0].domain;

        const randomName = Math.random().toString(36).substring(2, 12);
        const email    = `${randomName}@${domain}`;
        const password = Math.random().toString(36).substring(2, 15);

        const res = await axios.post(`${API_BASE}/accounts`, { address: email, password }, { timeout: 8000 });
        if (res.data?.id) return { email, password, id: res.data.id };
        return null;
    } catch (e) {
        console.error('Erreur création mail:', e.response?.data || e.message);
        return null;
    }
}

async function getToken(email, password) {
    try {
        const res = await axios.post(`${API_BASE}/token`, { address: email, password }, { timeout: 8000 });
        return res.data.token;
    } catch {
        return null;
    }
}

async function getMessages(token) {
    try {
        const res = await axios.get(`${API_BASE}/messages`, {
            headers: { Authorization: `Bearer ${token}` },
            timeout: 8000
        });
        const messages = res.data['hydra:member'] || [];
        messages.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        return messages;
    } catch {
        return [];
    }
}

async function getMessageContent(token, id) {
    try {
        const res = await axios.get(`${API_BASE}/messages/${id}`, {
            headers: { Authorization: `Bearer ${token}` },
            timeout: 8000
        });
        return res.data;
    } catch {
        return null;
    }
}

export default {
    name: 'mail',
    version: '1.0.0',
    description: 'Génère une adresse email temporaire et reçoit ses messages, via mail.tm',
    commands: ['mail'],
    category: 'tools',
    usage: '.mail <gen|inbox|read [numéro]|delete>',
    tips: [
        '.mail gen crée une adresse valable 1 heure',
        '.mail inbox affiche les messages reçus',
        '.mail read 1 affiche le message n°1 et en extrait le code si présent',
        '.mail delete supprime la session en cours'
    ],
    async handler(client, message, args, { box, S }) {
        const sender = message.key.participant || message.key.remoteJid;
        const sub = args[0]?.toLowerCase();

        // ===== HELP =====
        if (!sub || sub === 'help') {
            return client.sendMessage(sender, {
                text: box(
                    `│ *📧 EMAIL TEMPORAIRE*`, `│`,
                    `│ *.mail gen* — créer une adresse`,
                    `│ *.mail inbox* — voir les messages`,
                    `│ *.mail read [n°]* — lire un message`,
                    `│ *.mail delete* — supprimer l'adresse`
                ),
                nativeFlow: S.chan
            });
        }

        // ===== GEN =====
        if (['gen', 'generate', 'new'].includes(sub)) {
            const old = mailSessions.get(sender);
            if (old && !old.isExpired()) {
                return client.sendMessage(sender, {
                    text: box(
                        `│ *⚠️ Email déjà actif*`, `│`,
                        `│ *📧 ${old.email}*`, `│`,
                        `│ *⏱️ Expire dans ${60 - old.getAge()}m*`
                    ),
                    nativeFlow: S.chan
                });
            }

            await client.sendMessage(sender, { text: box(`│ *🔄 Création en cours...*`) });

            const data = await createTempEmail();
            if (!data) {
                return client.sendMessage(sender, { text: box(`│ *❌ Erreur lors de la création*`), nativeFlow: S.chan });
            }

            const session = new TempMail(data.email, data.password, data.id);
            mailSessions.set(sender, session);

            return client.sendMessage(sender, {
                text: box(
                    `│ *✅ Email créé !*`, `│`,
                    `│ *📧 ${data.email}*`,
                    `│ *🔑 ${data.password}*`, `│`,
                    `│ *⏳ Durée : 1 heure*`, `│`,
                    `│ *.mail inbox* — *.mail read 1*`
                ),
                nativeFlow: [
                    { text: '📧 Copier email', copy: data.email },
                    { text: '🔑 Copier password', copy: data.password },
                    ...S.chan
                ]
            });
        }

        // ===== INBOX =====
        if (['inbox', 'messages', 'list'].includes(sub)) {
            const s = mailSessions.get(sender);
            if (!s) {
                return client.sendMessage(sender, { text: box(`│ *❌ Aucun email actif. Fais .mail gen d'abord*`), nativeFlow: S.chan });
            }
            if (s.isExpired()) {
                mailSessions.delete(sender);
                return client.sendMessage(sender, { text: box(`│ *❌ Email expiré. Fais .mail gen*`), nativeFlow: S.chan });
            }

            await client.sendMessage(sender, { text: box(`│ *📥 Récupération...*`) });

            if (!s.token) s.token = await getToken(s.email, s.password);
            const msgs = await getMessages(s.token);
            s.messages = msgs;

            if (!msgs.length) {
                return client.sendMessage(sender, {
                    text: box(
                        `│ *📭 Aucun message*`, `│`,
                        `│ *📧 ${s.email}*`, `│`,
                        `│ *⏱️ Expire dans ${60 - s.getAge()}m*`
                    ),
                    nativeFlow: S.chan
                });
            }

            const lines = [`│ *📥 Inbox (${msgs.length})*`, `│`];
            msgs.slice(0, 10).forEach((m, i) => {
                lines.push(
                    `│ ${i + 1}. ${m.subject || 'Sans objet'}`,
                    `│    De : ${m.from?.address || 'Inconnu'}`,
                    `│    → .mail read ${i + 1}`, `│`
                );
            });

            return client.sendMessage(sender, { text: box(...lines), nativeFlow: S.chan });
        }

        // ===== READ =====
        if (sub === 'read') {
            const num = parseInt(args[1]);
            const s = mailSessions.get(sender);
            if (!s) {
                return client.sendMessage(sender, { text: box(`│ *❌ Aucun email actif*`), nativeFlow: S.chan });
            }
            if (!s.token) s.token = await getToken(s.email, s.password);

            let msgs = s.messages;
            if (!msgs.length) {
                msgs = await getMessages(s.token);
                s.messages = msgs;
            }
            if (!msgs[num - 1]) {
                return client.sendMessage(sender, { text: box(`│ *❌ Message introuvable*`), nativeFlow: S.chan });
            }

            const full = await getMessageContent(s.token, msgs[num - 1].id);
            if (!full) {
                return client.sendMessage(sender, { text: box(`│ *❌ Impossible de lire ce message*`), nativeFlow: S.chan });
            }

            let content = full.text || full.html || '';
            if (Array.isArray(content)) content = content[0] || '';
            content = String(content).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

            const codes = extractMainCode(content);
            const clean = content.length > 800 ? content.slice(0, 800) + '...' : content;

            const lines = [
                `│ *📧 Message #${num}*`, `│`,
                `│ *De : ${full.from?.address || 'Inconnu'}*`,
                `│ *Objet : ${full.subject || 'Sans objet'}*`, `│`,
                `│ ${clean}`
            ];

            const buttons = [...S.chan];
            if (codes.length > 0) {
                const mainCode = codes[0];
                lines.push(`│`, `│ *🔑 ${mainCode.type} : ${mainCode.value}*`);
                buttons.unshift({ text: `${mainCode.emoji} Copier ${mainCode.type}`, copy: mainCode.value });
            }

            return client.sendMessage(sender, { text: box(...lines), nativeFlow: buttons });
        }

        // ===== DELETE =====
        if (['delete', 'del'].includes(sub)) {
            const s = mailSessions.get(sender);
            if (!s) {
                return client.sendMessage(sender, { text: box(`│ *❌ Aucun email actif*`), nativeFlow: S.chan });
            }
            mailSessions.delete(sender);
            return client.sendMessage(sender, {
                text: box(
                    `│ *✅ Email supprimé*`, `│`,
                    `│ *📧 ${s.email}*`, `│`,
                    `│ *Fais .mail gen pour en créer un nouveau*`
                ),
                nativeFlow: S.chan
            });
        }

        return client.sendMessage(sender, { text: box(`│ *❌ Commande invalide. Fais .mail help*`), nativeFlow: S.chan });
    }
};
