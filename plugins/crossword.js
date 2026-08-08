// commands/crossword.js
// @cat: game

import fs from 'fs';
import path from 'path';

const GRID_SIZE    = 15;
const TARGET_WORDS = 7;
const SCORES_FILE  = path.join(process.cwd(), 'data', 'crossword_scores.json');

// Banque de mots + indices (français, sans accents pour simplifier la saisie)
const WORD_BANK = [
    ['CHAT', "Animal domestique qui miaule"],
    ['CHIEN', "Meilleur ami de l'homme"],
    ['MAISON', "Lieu où l'on habite"],
    ['SOLEIL', "Étoile au centre du système solaire"],
    ['LUNE', "Satellite naturel de la Terre"],
    ['ARBRE', "Grande plante à tronc et branches"],
    ['FLEUR', "Partie colorée et parfumée d'une plante"],
    ['PAIN', "Aliment fait de farine et d'eau, cuit au four"],
    ['EAU', "Liquide transparent indispensable à la vie"],
    ['FEU', "Combustion qui produit chaleur et lumière"],
    ['VENT', "Air en mouvement"],
    ['PLUIE', "Eau qui tombe du ciel"],
    ['NEIGE', "Précipitation blanche et froide"],
    ['MONTAGNE', "Relief élevé de la Terre"],
    ['RIVIERE', "Cours d'eau qui rejoint un fleuve"],
    ['OCEAN', "Très grande étendue d'eau salée"],
    ['FORET', "Grande étendue couverte d'arbres"],
    ['OISEAU', "Animal qui vole et pond des œufs"],
    ['POISSON', "Animal aquatique qui respire par des branchies"],
    ['LIVRE', "On le lit, plein de pages reliées"],
    ['ECOLE', "Lieu où les enfants apprennent"],
    ['TABLE', "Meuble avec un plateau et des pieds"],
    ['CHAISE', "Siège avec un dossier"],
    ['PORTE', "On l'ouvre pour entrer dans une pièce"],
    ['FENETRE', "Ouverture vitrée dans un mur"],
    ['VOITURE', "Véhicule à quatre roues"],
    ['TRAIN', "Roule sur des rails"],
    ['AVION', "Vole dans les airs"],
    ['BATEAU', "Navigue sur l'eau"],
    ['VELO', "Deux roues actionnées par les jambes"],
    ['MUSIQUE', "Art des sons organisés"],
    ['DANSE', "Mouvement du corps en rythme"],
    ['SPORT', "Activité physique organisée"],
    ['CUISINE', "Pièce où l'on prépare les repas"],
    ['JARDIN', "Espace où l'on cultive des plantes"],
    ['AMI', "Personne avec qui on partage une amitié"],
    ['FAMILLE', "Parents et enfants réunis"],
    ['ENFANT', "Jeune être humain"],
    ['ANNEE', "Période de douze mois"],
    ['JOUR', "Période de 24 heures"],
    ['NUIT', "Période sombre entre le coucher et le lever du soleil"],
    ['ROUGE', "Couleur du sang"],
    ['BLEU', "Couleur du ciel par beau temps"],
    ['VERT', "Couleur de l'herbe"],
    ['NOIR', "Couleur de l'absence de lumière"],
    ['BLANC', "Couleur de la neige"],
    ['ROI', "Souverain d'un royaume"],
    ['REINE', "Épouse du roi"],
    ['CHATEAU', "Grande demeure fortifiée"],
    ['PONT', "Permet de traverser un cours d'eau"],
    ['ROUTE', "Voie pour les véhicules"],
    ['VILLE', "Grande agglomération urbaine"],
    ['PAYS', "Territoire avec ses frontières"],
    ['MONDE', "La Terre et tout ce qu'elle contient"],
    ['ETOILE', "Point lumineux dans le ciel nocturne"],
    ['CIEL', "Espace visible au-dessus de nous"],
    ['MER', "Grande étendue d'eau salée"],
    ['SABLE', "Matière fine que l'on trouve à la plage"],
    ['PLAGE', "Bord de mer couvert de sable"],
    ['ILE', "Terre entourée d'eau"]
];

const sessions = new Map(); // jid -> { grid, solved(bool grid), clues, ownerId, ownerName, score, over }

const ownMessageIds = new Set();

async function reply(client, jid, content) {
    try {
        const sent = await client.sendMessage(jid, content);
        const id = sent?.key?.id;
        if (id) {
            ownMessageIds.add(id);
            setTimeout(() => ownMessageIds.delete(id), 30000);
        }
        return sent;
    } catch (e) {
        console.error('Erreur envoi message mots-croisés:', e.message);
    }
}

// ── Scores persistés ─────────────────────────────────────────────────────
function loadScores() {
    try {
        if (!fs.existsSync(SCORES_FILE)) return {};
        return JSON.parse(fs.readFileSync(SCORES_FILE, 'utf8'));
    } catch (e) {
        console.error('Erreur lecture scores mots-croisés:', e.message);
        return {};
    }
}

function saveScores(scores) {
    try {
        fs.mkdirSync(path.dirname(SCORES_FILE), { recursive: true });
        fs.writeFileSync(SCORES_FILE, JSON.stringify(scores, null, 2));
    } catch (e) {
        console.error('Erreur sauvegarde scores mots-croisés:', e.message);
    }
}

function recordScore(id, name, score) {
    const scores = loadScores();
    if (!scores[id] || score > scores[id].best) {
        scores[id] = { id, name, best: score };
    } else {
        scores[id].name = name;
    }
    saveScores(scores);
}

function getTopScores(limit = 10) {
    return Object.values(loadScores()).sort((a, b) => b.best - a.best).slice(0, limit);
}

// ── Générateur de grille ─────────────────────────────────────────────────
function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function emptyGrid() {
    return Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(null));
}

function canPlaceWord(grid, word, row, col, dir) {
    const len = word.length;
    if (dir === 'H') {
        if (col < 0 || col + len > GRID_SIZE || row < 0 || row >= GRID_SIZE) return false;
        if (col - 1 >= 0 && grid[row][col - 1] !== null) return false;
        if (col + len < GRID_SIZE && grid[row][col + len] !== null) return false;
    } else {
        if (row < 0 || row + len > GRID_SIZE || col < 0 || col >= GRID_SIZE) return false;
        if (row - 1 >= 0 && grid[row - 1][col] !== null) return false;
        if (row + len < GRID_SIZE && grid[row + len][col] !== null) return false;
    }

    let hasIntersection = false;
    for (let i = 0; i < len; i++) {
        const r = dir === 'H' ? row : row + i;
        const c = dir === 'H' ? col + i : col;
        const existing = grid[r][c];
        if (existing !== null) {
            if (existing !== word[i]) return false;
            hasIntersection = true;
        } else if (dir === 'H') {
            if (r - 1 >= 0 && grid[r - 1][c] !== null) return false;
            if (r + 1 < GRID_SIZE && grid[r + 1][c] !== null) return false;
        } else {
            if (c - 1 >= 0 && grid[r][c - 1] !== null) return false;
            if (c + 1 < GRID_SIZE && grid[r][c + 1] !== null) return false;
        }
    }
    return hasIntersection;
}

function placeWord(grid, word, row, col, dir) {
    for (let i = 0; i < word.length; i++) {
        const r = dir === 'H' ? row : row + i;
        const c = dir === 'H' ? col + i : col;
        grid[r][c] = word[i];
    }
}

function findIntersections(word, placedWord) {
    const pairs = [];
    for (let i = 0; i < word.length; i++) {
        for (let j = 0; j < placedWord.word.length; j++) {
            if (word[i] === placedWord.word[j]) pairs.push([i, j]);
        }
    }
    return pairs;
}

function generateCrossword() {
    const pool = shuffle(WORD_BANK).map(([w, clue]) => ({ word: w, clue }));
    const grid = emptyGrid();
    const placed = [];

    const first = pool.shift();
    const startRow = Math.floor(GRID_SIZE / 2);
    const startCol = Math.floor((GRID_SIZE - first.word.length) / 2);
    placeWord(grid, first.word, startRow, startCol, 'H');
    placed.push({ ...first, row: startRow, col: startCol, dir: 'H' });

    for (const candidate of pool) {
        if (placed.length >= TARGET_WORDS) break;
        if (placed.some(p => p.word === candidate.word)) continue;

        let bestPlacement = null;
        for (const p of shuffle(placed)) {
            const pairs = shuffle(findIntersections(candidate.word, p));
            for (const [ci, pi] of pairs) {
                const dir = p.dir === 'H' ? 'V' : 'H';
                const row = dir === 'V' ? p.row - ci : p.row + pi;
                const col = dir === 'V' ? p.col + pi : p.col - ci;
                if (canPlaceWord(grid, candidate.word, row, col, dir)) {
                    bestPlacement = { row, col, dir };
                    break;
                }
            }
            if (bestPlacement) break;
        }

        if (bestPlacement) {
            placeWord(grid, candidate.word, bestPlacement.row, bestPlacement.col, bestPlacement.dir);
            placed.push({ ...candidate, ...bestPlacement });
        }
    }

    // Numérote chaque mot selon l'ordre de lecture (haut→bas, gauche→droite) de sa case de départ
    const sorted = [...placed].sort((a, b) => a.row - b.row || a.col - b.col);
    const numberByPos = new Map();
    let n = 1;
    for (const p of sorted) {
        const key = `${p.row},${p.col}`;
        if (!numberByPos.has(key)) numberByPos.set(key, n++);
    }
    placed.forEach(p => { p.number = numberByPos.get(`${p.row},${p.col}`); p.solved = false; });

    return { grid, placed };
}

// ── Rendu ─────────────────────────────────────────────────────────────────
function renderGrid(session) {
    const { grid, placed } = session;
    let minR = GRID_SIZE, maxR = 0, minC = GRID_SIZE, maxC = 0;
    for (let r = 0; r < GRID_SIZE; r++) {
        for (let c = 0; c < GRID_SIZE; c++) {
            if (grid[r][c]) { minR = Math.min(minR, r); maxR = Math.max(maxR, r); minC = Math.min(minC, c); maxC = Math.max(maxC, c); }
        }
    }

    const revealed = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(false));
    for (const p of placed) {
        if (!p.solved) continue;
        for (let i = 0; i < p.word.length; i++) {
            const r = p.dir === 'H' ? p.row : p.row + i;
            const c = p.dir === 'H' ? p.col + i : p.col;
            revealed[r][c] = true;
        }
    }

    let out = '```\n';
    for (let r = minR; r <= maxR; r++) {
        let line = '';
        for (let c = minC; c <= maxC; c++) {
            if (!grid[r][c]) line += '  ';
            else line += (revealed[r][c] ? grid[r][c] : '▢') + ' ';
        }
        out += line.trimEnd() + '\n';
    }
    out += '```';
    return out;
}

function renderClues(placed) {
    const across = placed.filter(p => p.dir === 'H' && !p.solved).sort((a, b) => a.number - b.number);
    const down   = placed.filter(p => p.dir === 'V' && !p.solved).sort((a, b) => a.number - b.number);
    const lines = [];
    if (across.length) {
        lines.push(`│ *➡️ Horizontal :*`);
        across.forEach(p => lines.push(`│ ${p.number}. (${p.word.length} lettres) ${p.clue}`));
    }
    if (down.length) {
        lines.push(`│`, `│ *⬇️ Vertical :*`);
        down.forEach(p => lines.push(`│ ${p.number}. (${p.word.length} lettres) ${p.clue}`));
    }
    return lines;
}

function renderState(session) {
    const lines = [`│ *🔤 MOTS CROISÉS — ${session.ownerName}*`, `│`, `│ *Score : ${session.score}*`, `│`];
    lines.push(renderGrid(session));
    lines.push(`│`, ...renderClues(session.placed));
    lines.push(`│`, `│ *.mc <n° indice> <mot>* pour répondre`);
    return lines;
}

// Traite une tentative de réponse déjà parsée (numéro + mot)
async function attemptAnswer(client, jid, session, number, guess, box) {
    const clue = session.placed.find(p => p.number === number);
    if (!clue) {
        return reply(client, jid, { text: box(`│ *❌ Indice n°${number} introuvable*`) });
    }
    if (clue.solved) {
        return reply(client, jid, { text: box(`│ *❌ Cet indice est déjà résolu*`) });
    }

    if (guess !== clue.word) {
        return reply(client, jid, { text: box(`│ *❌ Mauvaise réponse pour l'indice n°${number}*`) });
    }

    clue.solved = true;
    session.score += clue.word.length * 10;

    const allSolved = session.placed.every(p => p.solved);
    if (allSolved) {
        session.over = true;
        session.score += 50; // bonus grille complète
        recordScore(session.ownerId, session.ownerName, session.score);
        await reply(client, jid, {
            text: box(
                `│ *🏁 GRILLE TERMINÉE !*`, `│`,
                renderGrid(session), `│`,
                `│ *Score final : ${session.score}*`
            )
        });
        sessions.delete(jid);
        return;
    }

    return reply(client, jid, {
        text: box(`│ *✅ Bravo ! "${clue.word}" trouvé*`, `│`, ...renderState(session))
    });
}

export default {
    name: 'crossword',
    version: '1.0.0',
    description: 'Mots croisés en solo avec grille générée et indices-phrases',
    commands: ['motscroises', 'mc', 'crossword'],
    category: 'game',
    usage: '.mc start puis .mc <n° indice> <mot>',
    tips: [
        'Chaque indice est une phrase décrivant le mot à trouver',
        'Réponds directement avec "<n° indice> <mot>", sans préfixe, une fois la partie lancée',
        'Les cases ▢ sont à découvrir, les lettres révélées appartiennent à un mot déjà trouvé',
        'Une grille terminée entièrement rapporte un bonus de points',
        '.mc top affiche le meilleur score de chaque joueur'
    ],
    async handler(client, message, args, { box, S }) {
        const jid    = message.key.remoteJid;
        const sender = message.key.participant || message.key.remoteJid;
        const name   = message.pushName || sender.split('@')[0];
        const sub    = (args[0] || '').toLowerCase();

        if (!sub || sub === 'help') {
            return reply(client, jid, {
                text: box(
                    `│ *🔤 MOTS CROISÉS*`, `│`,
                    `│ *.mc start* — démarrer une grille`,
                    `│ *.mc <n° indice> <mot>* — répondre, ex: .mc 3 CHAT`,
                    `│ *.mc board* — réafficher la grille et les indices`,
                    `│ *.mc stop* — arrêter la partie`,
                    `│ *.mc top* — meilleurs scores`
                ),
                nativeFlow: S.chan
            });
        }

        if (sub === 'top') {
            const top = getTopScores(10);
            if (top.length === 0) {
                return reply(client, jid, { text: box(`│ *📊 Aucun score enregistré pour l'instant*`) });
            }
            const medals = ['🥇', '🥈', '🥉'];
            const lines = top.map((p, i) => `│ ${medals[i] || `${i + 1}.`} *${p.name}* — ${p.best} pts`);
            return reply(client, jid, { text: box(`│ *📊 TOP MOTS CROISÉS*`, `│`, ...lines) });
        }

        if (sub === 'stop') {
            sessions.delete(jid);
            return reply(client, jid, { text: box(`│ *🛑 Partie de mots croisés arrêtée*`) });
        }

        if (sub === 'start') {
            const { grid, placed } = generateCrossword();
            sessions.set(jid, { grid, placed, score: 0, ownerId: sender, ownerName: name, over: false });
            return reply(client, jid, { text: box(...renderState(sessions.get(jid))) });
        }

        if (sub === 'board') {
            const session = sessions.get(jid);
            if (!session) return reply(client, jid, { text: box(`│ *❌ Aucune partie en cours. .mc start*`) });
            return reply(client, jid, { text: box(...renderState(session)) });
        }

        // ── Réponse : .mc <n° indice> <mot> ──
        const session = sessions.get(jid);
        if (!session || session.over) {
            return reply(client, jid, { text: box(`│ *❌ Aucune partie en cours. .mc start*`) });
        }
        if (sender !== session.ownerId) {
            return reply(client, jid, { text: box(`│ *❌ Ce n'est pas ta partie*`) });
        }

        const number = parseInt(sub, 10);
        const guess  = (args[1] || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (!number || !guess) {
            return reply(client, jid, { text: box(`│ *❌ Usage : .mc <n° indice> <mot>, ex: .mc 3 CHAT*`) });
        }

        return attemptAnswer(client, jid, session, number, guess, box);
    },

    // Hook : permet de répondre juste avec "3 CHAT", sans préfixe ni nom de commande
    async onMessage(client, message, { box }) {
        if (message.key?.id && ownMessageIds.has(message.key.id)) {
            ownMessageIds.delete(message.key.id);
            return;
        }

        const jid    = message.key.remoteJid;
        const sender = message.key.participant || message.key.remoteJid;
        const session = sessions.get(jid);
        if (!session || session.over) return;
        if (sender !== session.ownerId) return;

        const body  = (message.message?.conversation || message.message?.extendedTextMessage?.text || '').trim();
        const parts = body.split(/\s+/);
        if (parts.length !== 2) return;

        const number = parseInt(parts[0], 10);
        if (!number || String(number) !== parts[0]) return; // pas un numéro d'indice valide, on ignore

        const guess = parts[1].toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (!/^[A-Z]+$/.test(guess)) return;

        await attemptAnswer(client, jid, session, number, guess, box);
    }
};
