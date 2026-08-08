// commands/wordgame.js
// @cat: game

import axios from 'axios';
import fs from 'fs';
import path from 'path';

const TURN_SECONDS = 12;
const START_LIVES  = 3;
const MIN_LEN      = 3;
const MAX_LEN      = 6;
const WIN_BONUS    = 5; // points bonus pour une victoire en multijoueur
// Lettres exclues car trop peu de mots courants en français (K, W, X, Y, Z)
const LETTERS = ['A','B','C','D','E','F','G','H','I','J','L','M','N','O','P','Q','R','S','T','U','V'];

const RANKING_FILE = path.join(process.cwd(), 'data', 'wordgame_ranking.json');

// Liste de référence : 336 531 mots français (projet openlexicon, licence libre)
// https://github.com/chrplr/openlexicon
const WORDLIST_URL   = 'https://raw.githubusercontent.com/chrplr/openlexicon/master/datasets-info/Liste-de-mots-francais-Gutenberg/liste.de.mots.francais.frgut.txt';
const WORDLIST_CACHE = path.join(process.cwd(), 'data', 'wordlist_fr.txt');

let wordSet        = null; // Set<string> de mots normalisés (minuscules, sans accents)
let loadingPromise  = null;

async function downloadWordList() {
    const res = await axios.get(WORDLIST_URL, { responseType: 'text', timeout: 30000 });
    return res.data;
}

// Charge la liste en mémoire : depuis le cache disque si dispo, sinon la télécharge une fois
async function ensureWordList() {
    if (wordSet) return wordSet;
    if (loadingPromise) return loadingPromise;

    loadingPromise = (async () => {
        let raw = '';
        try {
            if (fs.existsSync(WORDLIST_CACHE)) {
                raw = fs.readFileSync(WORDLIST_CACHE, 'utf8');
            } else {
                console.log('📥 Téléchargement de la liste de mots français (une seule fois)...');
                raw = await downloadWordList();
                fs.mkdirSync(path.dirname(WORDLIST_CACHE), { recursive: true });
                fs.writeFileSync(WORDLIST_CACHE, raw);
            }
        } catch (e) {
            console.error('❌ Erreur chargement liste de mots wordgame:', e.message);
        }

        const set = new Set();
        for (const line of raw.split('\n')) {
            const w = normalize(line);
            if (w) set.add(w);
        }
        wordSet = set;
        console.log(`📚 wordgame : ${wordSet.size} mots chargés`);
        return wordSet;
    })();

    return loadingPromise;
}

// Force un nouveau téléchargement (commande .wordgame reload)
async function reloadWordList() {
    try { fs.unlinkSync(WORDLIST_CACHE); } catch (_) {}
    wordSet = null;
    loadingPromise = null;
    return ensureWordList();
}

function wordExists(word) {
    return !!wordSet && wordSet.has(word);
}

function loadRanking() {
    try {
        if (!fs.existsSync(RANKING_FILE)) return {};
        return JSON.parse(fs.readFileSync(RANKING_FILE, 'utf8'));
    } catch (e) {
        console.error('Erreur lecture ranking wordgame:', e.message);
        return {};
    }
}

function saveRanking(ranking) {
    try {
        fs.mkdirSync(path.dirname(RANKING_FILE), { recursive: true });
        fs.writeFileSync(RANKING_FILE, JSON.stringify(ranking, null, 2));
    } catch (e) {
        console.error('Erreur sauvegarde ranking wordgame:', e.message);
    }
}

function ensurePlayerEntry(ranking, id, name) {
    if (!ranking[id]) ranking[id] = { id, name, points: 0, wins: 0, gamesPlayed: 0 };
    ranking[id].name = name; // toujours garder le pseudo à jour
    ranking[id].id = id; // migration : garantit la présence de l'id même sur d'anciennes entrées
    return ranking[id];
}

function recordGameStart(players) {
    const ranking = loadRanking();
    for (const p of players) ensurePlayerEntry(ranking, p.id, p.name).gamesPlayed++;
    saveRanking(ranking);
}

function recordWordFound(id, name) {
    const ranking = loadRanking();
    ensurePlayerEntry(ranking, id, name).points++;
    saveRanking(ranking);
}

function recordWin(id, name) {
    const ranking = loadRanking();
    const entry = ensurePlayerEntry(ranking, id, name);
    entry.wins++;
    entry.points += WIN_BONUS;
    saveRanking(ranking);
}

function getTopPlayers(limit = 10) {
    return Object.entries(loadRanking())
        .map(([id, entry]) => ({ ...entry, id: entry.id || id }))
        .sort((a, b) => b.points - a.points)
        .slice(0, limit);
}

// sessions par jid (groupe ou DM) : { status, players:[{id,name,lives}], turnIndex, letter, length, usedWords:Set, timeout }
const sessions = new Map();

// IDs des messages envoyés PAR LE BOT lui-même. En DM, le message envoyé par le bot
// et un message reçu du contact partagent le même remoteJid : sans ce garde-fou, le bot
// finit par "répondre à ses propres messages" en boucle (score qui tombe à 0 instantanément).
const ownMessageIds = new Set();

async function reply(client, jid, content) {
    try {
        const sent = await client.sendMessage(jid, content);
        const id = sent?.key?.id;
        if (id) {
            ownMessageIds.add(id);
            setTimeout(() => ownMessageIds.delete(id), 30000); // nettoyage, évite une fuite mémoire
        }
        return sent;
    } catch (e) {
        console.error('Erreur envoi message wordgame:', e.message);
    }
}

function normalize(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

// Formate une mention WhatsApp cliquable à partir d'un jid (ex: 242061981234@s.whatsapp.net → @242061981234)
function mentionTag(jid) {
    return `@${jid.split('@')[0]}`;
}

function randomLetter() {
    return LETTERS[Math.floor(Math.random() * LETTERS.length)];
}

function randomLength() {
    return Math.floor(Math.random() * (MAX_LEN - MIN_LEN + 1)) + MIN_LEN;
}

function currentPlayer(session) {
    return session.players[session.turnIndex];
}

function advanceTurn(session) {
    if (session.players.length === 0) return;
    session.turnIndex = (session.turnIndex + 1) % session.players.length;
}

function newRound(session) {
    session.letter = randomLetter();
    session.length = randomLength();
}

async function eliminateIfDead(client, jid, session, box) {
    if (session.mode === 'solo') return; // en solo, la partie s'arrête via endGameIfOver
    const player = currentPlayer(session);
    if (player.lives <= 0) {
        await reply(client, jid, {
            text: box(`│ *💀 ${mentionTag(player.id)} EST ÉLIMINÉ, LOSER !*`),
            mentions: [player.id]
        });
        session.players.splice(session.turnIndex, 1);
        if (session.turnIndex >= session.players.length) session.turnIndex = 0;
    }
}

async function endGameIfOver(client, jid, session, box) {
    if (session.mode === 'solo') {
        const player = session.players[0];
        if (player.lives <= 0) {
            await reply(client, jid, {
                text: box(
                    `│ *🏁 PARTIE TERMINÉE*`, `│`,
                    `│ *Score final : ${session.score} mot(s) trouvé(s)*`
                )
            });
            clearTimeout(session.timeout);
            sessions.delete(jid);
            return true;
        }
        return false;
    }

    if (session.players.length <= 1) {
        const winner = session.players[0];
        if (winner) recordWin(winner.id, winner.name);
        await reply(client, jid, {
            text: box(
                `│ *🏆 FIN DE LA PARTIE*`, `│`,
                winner ? `│ *Vainqueur : ${mentionTag(winner.id)}*` : `│ *Aucun survivant*`
            ),
            mentions: winner ? [winner.id] : []
        });
        clearTimeout(session.timeout);
        sessions.delete(jid);
        return true;
    }
    return false;
}

async function askTurn(client, jid, session, box) {
    newRound(session);
    const player = currentPlayer(session);

    const scoreLine = session.mode === 'solo' ? [`│ *Score : ${session.score}*`] : [];
    const turnLine  = session.mode === 'solo' ? 'À TOI DE JOUER' : `AU TOUR DE ${mentionTag(player.id)}`;

    await reply(client, jid, {
        text: box(
            `│ *🔤 ${turnLine}*`, `│`,
            `│ *Mot de ${session.length} lettres minimum*`,
            `│ *Commençant par : ${session.letter}*`,
            `│ *Vies restantes : ${'❤️'.repeat(player.lives)}*`,
            ...scoreLine, `│`,
            `│ *⏱️ ${TURN_SECONDS} secondes !*`
        ),
        mentions: [player.id]
    });

    clearTimeout(session.timeout);
    session.timeout = setTimeout(async () => {
        try {
            await reply(client, jid, {
                text: box(`│ *⏰ TEMPS ÉCOULÉ POUR ${mentionTag(player.id)} !*`),
                mentions: [player.id]
            });
            player.lives--;
            await eliminateIfDead(client, jid, session, box);
            const over = await endGameIfOver(client, jid, session, box);
            if (over) return;
            advanceTurn(session);
            await askTurn(client, jid, session, box);
        } catch (e) {
            console.error('Erreur timeout wordgame:', e.message);
        }
    }, TURN_SECONDS * 1000);
}

export default {
    name: 'wordgame',
    version: '1.0.0',
    description: 'Jeu de mots en temps limité (1v1 ou groupe)',
    commands: ['wordgame', 'mg'],
    category: 'game',
    async handler(client, message, args, { box, S }) {
        const jid    = message.key.remoteJid;
        const sender = message.key.participant || message.key.remoteJid;
        const name   = message.pushName || sender.split('@')[0];
        const sub    = (args[0] || '').toLowerCase();

        if (!sub || sub === 'help') {
            return reply(client, jid, {
                text: box(
                    `│ *🔤 WORDGAME*`, `│`,
                    `│ *.wordgame create* — créer une partie`,
                    `│ *.wordgame join* — rejoindre (facultatif en solo)`,
                    `│ *.wordgame start* — démarrer (seul ou à plusieurs)`,
                    `│ *.wordgame stop* — arrêter la partie`,
                    `│ *.wordgame top* — classement des meilleurs joueurs`,
                    `│ *.wordgame reload* — recharger le dictionnaire`
                ),
                nativeFlow: S.chan
            });
        }

        if (sub === 'top' || sub === 'ranking' || sub === 'classement') {
            const top = getTopPlayers(10);
            if (top.length === 0) {
                return reply(client, jid, { text: box(`│ *📊 Aucun classement pour l'instant*`) });
            }
            const medals = ['🥇', '🥈', '🥉'];
            const lines = top.map((p, i) =>
                `│ ${medals[i] || `${i + 1}.`} *${mentionTag(p.id)}* — ${p.points} pts (${p.wins} 🏆, ${p.gamesPlayed} parties)`
            );
            return reply(client, jid, {
                text: box(`│ *📊 CLASSEMENT WORDGAME*`, `│`, ...lines),
                mentions: top.map(p => p.id)
            });
        }

        if (sub === 'create') {
            if (sessions.has(jid)) {
                return reply(client, jid, { text: box(`│ *❌ Une partie existe déjà ici*`) });
            }
            sessions.set(jid, {
                status: 'lobby',
                mode: null,
                score: 0,
                players: [{ id: sender, name, lives: START_LIVES }],
                turnIndex: 0,
                letter: null,
                length: null,
                usedWords: new Set(),
                timeout: null
            });
            return reply(client, jid, {
                text: box(
                    `│ *🎮 PARTIE CRÉÉE PAR ${name}*`, `│`,
                    `│ *.wordgame join* pour rejoindre à plusieurs`,
                    `│ *.wordgame start* pour lancer (seul ou à plusieurs)`
                ),
                nativeFlow: S.chan
            });
        }

        const session = sessions.get(jid);
        if (!session) {
            return reply(client, jid, { text: box(`│ *❌ Aucune partie en cours. Fais .wordgame create*`) });
        }

        if (sub === 'join') {
            if (session.status !== 'lobby') {
                return reply(client, jid, { text: box(`│ *❌ La partie a déjà commencé*`) });
            }
            if (session.players.some(p => p.id === sender)) {
                return reply(client, jid, { text: box(`│ *❌ Tu es déjà inscrit*`) });
            }
            session.players.push({ id: sender, name, lives: START_LIVES });
            return reply(client, jid, {
                text: box(`│ *✅ ${name} a rejoint (${session.players.length} joueurs)*`)
            });
        }

        if (sub === 'start') {
            if (session.status !== 'lobby') {
                return reply(client, jid, { text: box(`│ *❌ La partie a déjà commencé*`) });
            }
            if (!wordSet) {
                await reply(client, jid, {
                    text: box(`│ *📥 Premier lancement : chargement du dictionnaire...*`)
                });
            }
            await ensureWordList();
            if (!wordSet || wordSet.size === 0) {
                return reply(client, jid, {
                    text: box(`│ *❌ Impossible de charger le dictionnaire. Réessaie avec .wordgame reload*`)
                });
            }
            session.mode   = session.players.length === 1 ? 'solo' : 'multi';
            session.status = 'playing';
            recordGameStart(session.players);
            const intro = session.mode === 'solo'
                ? `│ *Mode solo — trouve un maximum de mots avant de perdre tes vies*`
                : `│ *${session.players.length} joueurs, que le meilleur gagne*`;
            await reply(client, jid, {
                text: box(`│ *🚀 LA PARTIE COMMENCE !*`, `│`, intro)
            });
            await askTurn(client, jid, session, box);
            return;
        }

        if (sub === 'stop') {
            clearTimeout(session.timeout);
            sessions.delete(jid);
            return reply(client, jid, { text: box(`│ *🛑 Partie arrêtée*`) });
        }

        if (sub === 'reload') {
            await reply(client, jid, { text: box(`│ *🔄 Retéléchargement du dictionnaire...*`) });
            await reloadWordList();
            return reply(client, jid, {
                text: box(`│ *✅ Dictionnaire rechargé : ${wordSet ? wordSet.size : 0} mots*`)
            });
        }

        return reply(client, jid, { text: box(`│ *❌ Commande inconnue, essaie .wordgame help*`) });
    },

    // Hook appelé sur chaque message : capte les réponses pendant une partie en cours
    async onMessage(client, message, { box }) {
        // Message envoyé par le bot lui-même (ex: le prompt "À TOI DE JOUER") : jamais une réponse du joueur
        if (message.key?.id && ownMessageIds.has(message.key.id)) {
            ownMessageIds.delete(message.key.id);
            return;
        }

        const jid    = message.key.remoteJid;
        const sender = message.key.participant || message.key.remoteJid;
        const session = sessions.get(jid);
        if (!session || session.status !== 'playing') return;

        const body = (message.message?.conversation || message.message?.extendedTextMessage?.text || '').trim();
        // Ignore les messages vides ou qui ressemblent à une commande (préfixe non alphabétique : . - / ! etc.)
        if (!body || !/^[a-zàâäéèêëïîôöùûüÿçñæœ]/i.test(body)) return;

        const player = currentPlayer(session);
        if (!player || sender !== player.id) return; // pas son tour

        const word = normalize(body);
        const letterOk = word.length > 0 && word[0] === normalize(session.letter);
        const lengthOk = word.length >= session.length; // longueur minimale, un mot plus long est accepté
        const notUsed  = !session.usedWords.has(word);
        const isAlpha  = /^[a-zàâäéèêëïîôöùûüÿçñæœ]+$/i.test(word);

        let valid = false;
        if (letterOk && lengthOk && notUsed && isAlpha) {
            valid = wordExists(word);
        }

        clearTimeout(session.timeout);

        if (valid) {
            session.usedWords.add(word);
            if (session.mode === 'solo') session.score++;
            recordWordFound(player.id, player.name);
            await reply(client, jid, {
                text: box(`│ *✅ ${player.name} : "${body}" est valide !*`)
            });
        } else {
            player.lives--;
            let reason = 'Mot invalide';
            if (!letterOk) reason = `Doit commencer par ${session.letter}`;
            else if (!lengthOk) reason = `Doit faire au moins ${session.length} lettres`;
            else if (!notUsed) reason = 'Mot déjà utilisé';
            else if (!isAlpha) reason = 'Caractères invalides';

            await reply(client, jid, {
                text: box(`│ *❌ ${player.name} : ${reason} (-1 vie)*`)
            });
        }

        await eliminateIfDead(client, jid, session, box);
        const over = await endGameIfOver(client, jid, session, box);
        if (over) return;

        advanceTurn(session);
        await askTurn(client, jid, session, box);
    }
};
