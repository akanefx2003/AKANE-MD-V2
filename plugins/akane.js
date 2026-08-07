// Plugin : akane-ia
// IA sarcastique avec mémoire de conversation

import axios from 'axios';

// ─── Style ────────────────────────────────────────────────────────────────────

const styleMap = {
    'a':'𝗮','b':'𝗯','c':'𝗰','d':'𝗱','e':'𝗲','f':'𝗳','g':'𝗴','h':'𝗵','i':'𝗶',
    'j':'𝗷','k':'𝗸','l':'𝗹','m':'𝗺','n':'𝗻','o':'𝗼','p':'𝗽','q':'𝗾','r':'𝗿',
    's':'𝘀','t':'𝘁','u':'𝘂','v':'𝘃','w':'𝘄','x':'𝘅','y':'𝘆','z':'𝘇',
    'A':'𝗔','B':'𝗕','C':'𝗖','D':'𝗗','E':'𝗘','F':'𝗙','G':'𝗚','H':'𝗛','I':'𝗜',
    'J':'𝗝','K':'𝗞','L':'𝗟','M':'𝗠','N':'𝗡','O':'𝗢','P':'𝗣','Q':'𝗤','R':'𝗥',
    'S':'𝗦','T':'𝗧','U':'𝗨','V':'𝗩','W':'𝗪','X':'𝗫','Y':'𝗬','Z':'𝗭',
    '0':'𝟬','1':'𝟭','2':'𝟮','3':'𝟯','4':'𝟰','5':'𝟱','6':'𝟲','7':'𝟳','8':'𝟴','9':'𝟵',
    'é':'𝗲́','è':'𝗲̀','ê':'𝗲̂','à':'𝗮̀','â':'𝗮̂','ç':'𝗰̧','ô':'𝗼̂',
    ' ':' ','.':'.','!':'!','?':'?',':':':','-':'-','_':'_','/':'/',',':','
};

function fmt(text) {
    if (text.includes('http://') || text.includes('https://')) {
        return text.split(/(https?:\/\/[^\s]+)/g)
            .map(p => p.match(/^https?:\/\//) ? p : p.split('').map(c => styleMap[c]||c).join(''))
            .join('');
    }
    return text.split('').map(c => styleMap[c]||c).join('');
}

const WAITING = [
    "😒 Patiente...","🙄 T'es pressé ?","😤 J'ai pas que ça à faire...",
    "🤨 T'es sérieux ?","😏 Ok, mais dépêche-toi...","😴 ZZZ... Ah t'es là ?",
    "🤔 Encore toi ?","😎 T'as de la chance..."
];

// ─── APIs ─────────────────────────────────────────────────────────────────────

const SD_APIS = [
    { name: 'sd-fr-1', url: 'https://stablediffusion.fr/gpt4/predict2', referer: 'https://stablediffusion.fr/chatgpt4' },
    { name: 'sd-fr-2', url: 'https://stablediffusion.fr/gpt4/predict',  referer: 'https://stablediffusion.fr/chatgpt4' },
    { name: 'sd-fr-3', url: 'https://stablediffusion.fr/gpt3/predict2', referer: 'https://stablediffusion.fr/chatgpt3' },
    { name: 'sd-fr-4', url: 'https://stablediffusion.fr/gpt3/predict',  referer: 'https://stablediffusion.fr/chatgpt3' },
];

const BACKUP_APIS = [
    {
        name: 'blackbox',
        url: 'https://www.blackbox.ai/api/chat',
        body: (p) => ({ messages: [{ role: 'user', content: p }], model: 'llama-3.1-8b' }),
        extract: (d) => typeof d === 'string' && d.length > 10 ? d : null
    }
];

let apiIndex = 0;
const histories = new Map();

// Nettoyage historique toutes les 10min
setInterval(() => {
    const now = Date.now();
    for (const [id, d] of histories.entries()) {
        if (now - d.lastActivity > 3600000) histories.delete(id);
    }
}, 600000);

async function callSD(prompt, api) {
    try {
        const ref = await axios.get(api.referer, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0' } });
        const cookie = ref.headers['set-cookie'];
        const { data } = await axios.post(api.url, { prompt }, {
            timeout: 25000,
            headers: {
                'accept': '*/*', 'content-type': 'application/json',
                'origin': 'https://stablediffusion.fr', 'referer': api.referer,
                'user-agent': 'Mozilla/5.0',
                ...(cookie ? { 'cookie': Array.isArray(cookie) ? cookie.join('; ') : cookie } : {})
            }
        });
        if (data?.message?.length > 5) return data.message;
        return null;
    } catch (e) { return null; }
}

async function callGPT(prompt) {
    for (let i = 0; i < SD_APIS.length; i++) {
        const api = SD_APIS[apiIndex++ % SD_APIS.length];
        const r = await callSD(prompt, api);
        if (r && !r.includes('<html>')) return r;
    }
    for (const api of BACKUP_APIS) {
        try {
            const res = await axios.post(api.url, api.body(prompt), { timeout: 20000, headers: { 'Content-Type': 'application/json' } });
            const r = api.extract(res.data);
            if (r && !r.includes('<html>')) return r;
        } catch (e) {}
    }
    throw new Error('Toutes les API sont indisponibles');
}

// ─── Export plugin ────────────────────────────────────────────────────────────

export default {
    name:        'akane-ia',
    version:     '1.0.0',
    description: 'IA sarcastique avec mémoire de conversation',
    author:      'AkaneMD',
    commands:    ['akane', 'ia', 'akane-reset', 'akane-history'],
    category:    'fun',

    async handler(client, message, args, { cmd }) {
        const jid      = message.key.remoteJid;
        const sender   = message.key.participant || message.key.remoteJid;

        // ── Reset historique ──
        if (cmd === 'akane-reset') {
            if (histories.has(sender)) {
                histories.delete(sender);
                return client.sendMessage(jid, { text: fmt('﹝╎🍒 AKANE IA ╎˼\n\n⸙﹝ Historique effacé ! ﹞✴︎\n\n> *© AKANE MD 🌹*') }, { quoted: message });
            }
            return client.sendMessage(jid, { text: fmt('﹝╎🍒 AKANE IA ╎˼\n\n⸙﹝ Aucun historique. ﹞✴︎\n\n> *© AKANE MD 🌹*') }, { quoted: message });
        }

        // ── Voir historique ──
        if (cmd === 'akane-history') {
            const h = histories.get(sender);
            if (!h || !h.messages.length) {
                return client.sendMessage(jid, { text: fmt('﹝╎🍒 AKANE IA ╎˼\n\n⸙﹝ Rien à voir, loser. ﹞✴︎\n\n> *© AKANE MD 🌹*') }, { quoted: message });
            }
            let txt = '﹝╎🍒 HISTORIQUE ╎˼\n\n';
            for (const m of h.messages) {
                const who = m.role === 'user' ? '👤 TOI' : '🍒 AKANE';
                txt += `⸙﹝ ${who} : ${m.content.substring(0,40)}${m.content.length>40?'...':''} ﹞✴︎\n`;
            }
            txt += '\n> *© AKANE MD 🌹*';
            return client.sendMessage(jid, { text: fmt(txt) }, { quoted: message });
        }

        // ── Commande principale akane / ia ──
        const query = args.join(' ').trim();
        if (!query) {
            return client.sendMessage(jid, {
                text: fmt(`﹝╎🍒 𝐀𝐊𝐀𝐍𝐄 𝐈𝐀 ╎˼\n\n⋆.˚⪩ Utilisation ⪨\n⸙﹝ akane [ta question] ﹞✴︎\n\n⋆.˚⪩ Exemples ⪨\n⸙﹝ akane Qui est le boss ? ﹞✴︎\n⸙﹝ akane Donne-moi une vanne ﹞✴︎\n\n⸙﹝ akane-reset = effacer historique ﹞✴︎\n⸙﹝ akane-history = voir historique ﹞✴︎\n\n> *© AKANE MD 🌹*`)
            }, { quoted: message });
        }

        // Message d'attente
        const w = WAITING[Math.floor(Math.random() * WAITING.length)];
        await client.sendMessage(jid, { text: fmt(`⏳ ${w}`) }, { quoted: message });

        // Historique
        let h = histories.get(sender) || { messages: [], lastActivity: Date.now() };
        h.lastActivity = Date.now();
        h.messages.push({ role: 'user', content: query });
        if (h.messages.length > 10) h.messages = h.messages.slice(-10);

        // Construire le prompt avec contexte
        let prompt = '';
        for (const m of h.messages.slice(0, -1)) {
            prompt += m.role === 'user' ? `Utilisateur: ${m.content}\n` : `Akane: ${m.content}\n`;
        }
        prompt += `Utilisateur: ${query}\nAkane: Tu es Akane, une IA insolente et sarcastique. Réponds de manière cinglante, avec humour noir, en 3-4 lignes max, en français.`;

        try {
            let reply = await callGPT(prompt);
            if (!reply || reply.length < 2 || reply.includes('<html>')) throw new Error('Réponse invalide');
            reply = reply.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/g, '').replace(/\n+/g, '\n').trim();
            if (reply.length > 400) reply = reply.substring(0, 397) + '...';

            h.messages.push({ role: 'assistant', content: reply });
            histories.set(sender, h);

            await client.sendMessage(jid, {
                text: fmt(`﹝╎🍒 𝐀𝐊𝐀𝐍𝐄 𝐈𝐀 ╎˼\n\n⎔ــﮩ٨ـﮩﮩـ٨ •﹝ 𐰁 🎀 𐰁 ﹞• ٨ـﮩ–ﮩ٨⎔\n\n⋆.˚⪩ Réponse ⪨\n\n⸙﹝ ${reply} ﹞✴︎\n\n𖤍⋅‏ ┈─━ ━━ ━ • ˹ ୨ৎ ˼ • ━ ━━ ━─┈ ⋅𖤍\n\n> *© AKANE MD 🌹*`)
            }, { quoted: message });

        } catch (e) {
            await client.sendMessage(jid, {
                text: fmt(`﹝╎🍒 𝐀𝐊𝐀𝐍𝐄 𝐈𝐀 ╎˼\n\n⸙﹝ API indisponible, réessaie plus tard. ﹞✴︎\n\n> *© AKANE MD 🌹*`)
            }, { quoted: message });
        }
    }
};