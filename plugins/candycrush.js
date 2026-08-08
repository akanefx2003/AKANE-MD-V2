// commands/candycrush.js
// @cat: game

import fs from 'fs';
import path from 'path';

const SIZE        = 6;
const MOVES_START  = 20;
const CANDIES      = ['🔴', '🟠', '🟡', '🟢', '🔵', '🟣'];
const SCORES_FILE  = path.join(process.cwd(), 'data', 'candy_scores.json');

const sessions = new Map(); // jid -> { grid, score, movesLeft, ownerId, ownerName, over }

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
        console.error('Erreur envoi message candy:', e.message);
    }
}

// ── Scores persistés ─────────────────────────────────────────────────────
function loadScores() {
    try {
        if (!fs.existsSync(SCORES_FILE)) return {};
        return JSON.parse(fs.readFileSync(SCORES_FILE, 'utf8'));
    } catch (e) {
        console.error('Erreur lecture scores candy:', e.message);
        return {};
    }
}

function saveScores(scores) {
    try {
        fs.mkdirSync(path.dirname(SCORES_FILE), { recursive: true });
        fs.writeFileSync(SCORES_FILE, JSON.stringify(scores, null, 2));
    } catch (e) {
        console.error('Erreur sauvegarde scores candy:', e.message);
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

// ── Logique du jeu ───────────────────────────────────────────────────────
function randomCandy() {
    return CANDIES[Math.floor(Math.random() * CANDIES.length)];
}

function generateGrid() {
    const grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            let candy;
            do {
                candy = randomCandy();
            } while (
                (c >= 2 && grid[r][c - 1] === candy && grid[r][c - 2] === candy) ||
                (r >= 2 && grid[r - 1][c] === candy && grid[r - 2][c] === candy)
            );
            grid[r][c] = candy;
        }
    }
    return grid;
}

function findMatches(grid) {
    const matched = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));

    for (let r = 0; r < SIZE; r++) {
        let c = 0;
        while (c < SIZE) {
            const val = grid[r][c];
            if (!val) { c++; continue; }
            let end = c;
            while (end < SIZE && grid[r][end] === val) end++;
            if (end - c >= 3) for (let k = c; k < end; k++) matched[r][k] = true;
            c = end;
        }
    }

    for (let c = 0; c < SIZE; c++) {
        let r = 0;
        while (r < SIZE) {
            const val = grid[r][c];
            if (!val) { r++; continue; }
            let end = r;
            while (end < SIZE && grid[end][c] === val) end++;
            if (end - r >= 3) for (let k = r; k < end; k++) matched[k][c] = true;
            r = end;
        }
    }

    return matched;
}

function countMatched(matched) {
    let n = 0;
    for (const row of matched) for (const v of row) if (v) n++;
    return n;
}

function applyGravity(grid) {
    for (let c = 0; c < SIZE; c++) {
        let writeRow = SIZE - 1;
        for (let r = SIZE - 1; r >= 0; r--) {
            if (grid[r][c]) {
                grid[writeRow][c] = grid[r][c];
                if (writeRow !== r) grid[r][c] = null;
                writeRow--;
            }
        }
        for (let r = writeRow; r >= 0; r--) grid[r][c] = randomCandy();
    }
}

// Enchaîne les vagues de suppressions (cascades). Chaque vague rapporte plus que la précédente.
function resolveCascades(grid) {
    let gained = 0;
    let waves = 0;
    while (true) {
        const matched = findMatches(grid);
        const count = countMatched(matched);
        if (count === 0) break;
        waves++;
        gained += count * 10 * waves;
        for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (matched[r][c]) grid[r][c] = null;
        applyGravity(grid);
    }
    return { gained, waves };
}

function swapCells(grid, r1, c1, r2, c2) {
    const tmp = grid[r1][c1];
    grid[r1][c1] = grid[r2][c2];
    grid[r2][c2] = tmp;
}

function hasAnyMove(grid) {
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            if (c + 1 < SIZE) {
                swapCells(grid, r, c, r, c + 1);
                const has = countMatched(findMatches(grid)) > 0;
                swapCells(grid, r, c, r, c + 1);
                if (has) return true;
            }
            if (r + 1 < SIZE) {
                swapCells(grid, r, c, r + 1, c);
                const has = countMatched(findMatches(grid)) > 0;
                swapCells(grid, r, c, r + 1, c);
                if (has) return true;
            }
        }
    }
    return false;
}

function parseCell(str) {
    const m = new RegExp(`^([A-${String.fromCharCode(64 + SIZE)}])([1-${SIZE}])$`).exec(str);
    if (!m) return null;
    return { r: parseInt(m[2], 10) - 1, c: m[1].charCodeAt(0) - 65 };
}

function renderGridLines(grid) {
    const cols = 'ABCDEFGHIJ'.slice(0, SIZE).split('').join(' ');
    const header = `│    ${cols}`;
    const rows = grid.map((row, r) => `│ ${String(r + 1).padStart(2, ' ')}  ${row.join(' ')}`);
    return [header, ...rows];
}

function renderState(session) {
    const lines = [
        `│ *🍬 CANDY CRUSH — ${session.ownerName}*`, `│`,
        `│ *Score : ${session.score}*`, `│ *Coups restants : ${session.movesLeft}*`, `│`
    ];
    lines.push(...renderGridLines(session.grid));
    lines.push(`│`, `│ *.candy <case1> <case2>* pour échanger, ex: .candy A1 A2`);
    return lines;
}

// Exécute un échange déjà parsé (utilisée par la commande préfixée ET par le raccourci sans préfixe)
async function performSwap(client, jid, session, cell1, cell2, box) {
    const adjacent = Math.abs(cell1.r - cell2.r) + Math.abs(cell1.c - cell2.c) === 1;
    if (!adjacent) {
        return reply(client, jid, { text: box(`│ *❌ Les deux cases doivent être adjacentes*`) });
    }

    swapCells(session.grid, cell1.r, cell1.c, cell2.r, cell2.c);
    const wouldMatch = countMatched(findMatches(session.grid)) > 0;
    if (!wouldMatch) {
        swapCells(session.grid, cell1.r, cell1.c, cell2.r, cell2.c); // annule l'échange
        return reply(client, jid, { text: box(`│ *❌ Aucune combinaison, cet échange est annulé (coup non compté)*`) });
    }

    const { gained, waves } = resolveCascades(session.grid);
    session.score += gained;
    session.movesLeft--;

    if (!hasAnyMove(session.grid)) {
        session.grid = generateGrid();
    }

    if (session.movesLeft <= 0) {
        session.over = true;
        recordScore(session.ownerId, session.ownerName, session.score);
        await reply(client, jid, {
            text: box(
                `│ *🏁 PARTIE TERMINÉE*`, `│`,
                ...renderGridLines(session.grid), `│`,
                `│ *Score final : ${session.score}*`
            )
        });
        sessions.delete(jid);
        return;
    }

    const comboLine = waves > 1 ? [`│ *🔥 Cascade x${waves} !*`, `│`] : [];
    return reply(client, jid, { text: box(...comboLine, ...renderState(session)) });
}

export default {
    name: 'candycrush',
    version: '1.0.0',
    description: 'Candy Crush adapté en texte/emoji : échange des bonbons pour aligner 3 couleurs ou plus',
    commands: ['candy', 'candycrush'],
    category: 'game',
    usage: '.candy start puis .candy <case1> <case2> pour échanger deux bonbons adjacents',
    tips: [
        'Échange deux bonbons adjacents (haut/bas/gauche/droite) pour aligner 3 couleurs ou plus',
        'Aligner 4 ou 5 bonbons, ou déclencher des cascades, rapporte un gros bonus de points',
        'Un échange qui ne crée aucune combinaison est automatiquement annulé et ne coûte pas de coup',
        `La partie se termine après ${MOVES_START} coups`,
        'Si plus aucune combinaison n\'est possible, la grille se mélange automatiquement',
        '.candy top affiche le meilleur score de chaque joueur'
    ],
    async handler(client, message, args, { box, S }) {
        const jid    = message.key.remoteJid;
        const sender = message.key.participant || message.key.remoteJid;
        const name   = message.pushName || sender.split('@')[0];
        const sub    = (args[0] || '').toLowerCase();

        if (!sub || sub === 'help') {
            return reply(client, jid, {
                text: box(
                    `│ *🍬 CANDY CRUSH*`, `│`,
                    `│ *.candy start* — démarrer une partie`,
                    `│ *.candy <case1> <case2>* — échanger, ex: .candy A1 A2`,
                    `│ *.candy board* — réafficher la grille`,
                    `│ *.candy stop* — arrêter la partie`,
                    `│ *.candy top* — meilleurs scores`
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
            return reply(client, jid, { text: box(`│ *📊 TOP CANDY CRUSH*`, `│`, ...lines) });
        }

        if (sub === 'stop') {
            sessions.delete(jid);
            return reply(client, jid, { text: box(`│ *🛑 Partie Candy Crush arrêtée*`) });
        }

        if (sub === 'start') {
            const grid = generateGrid();
            sessions.set(jid, { grid, score: 0, movesLeft: MOVES_START, ownerId: sender, ownerName: name, over: false });
            return reply(client, jid, { text: box(...renderState(sessions.get(jid))) });
        }

        if (sub === 'board') {
            const session = sessions.get(jid);
            if (!session) return reply(client, jid, { text: box(`│ *❌ Aucune partie en cours. .candy start*`) });
            return reply(client, jid, { text: box(...renderState(session)) });
        }

        // ── Échange : .candy <case1> <case2> ──
        const session = sessions.get(jid);
        if (!session || session.over) {
            return reply(client, jid, { text: box(`│ *❌ Aucune partie en cours. .candy start*`) });
        }
        if (sender !== session.ownerId) {
            return reply(client, jid, { text: box(`│ *❌ Ce n'est pas ta partie*`) });
        }

        const cell1 = parseCell(sub.toUpperCase());
        const cell2 = parseCell((args[1] || '').toUpperCase());
        if (!cell1 || !cell2) {
            return reply(client, jid, { text: box(`│ *❌ Usage : .candy <case1> <case2>, ex: .candy A1 A2*`) });
        }

        return performSwap(client, jid, session, cell1, cell2, box);
    },

    // Hook appelé sur chaque message : permet de jouer avec juste "C1 C2", sans préfixe ni nom de commande
    async onMessage(client, message, { box }) {
        if (message.key?.id && ownMessageIds.has(message.key.id)) {
            ownMessageIds.delete(message.key.id);
            return;
        }

        const jid    = message.key.remoteJid;
        const sender = message.key.participant || message.key.remoteJid;
        const session = sessions.get(jid);
        if (!session || session.over) return;
        if (sender !== session.ownerId) return; // pas le propriétaire de la partie

        const body  = (message.message?.conversation || message.message?.extendedTextMessage?.text || '').trim().toUpperCase();
        const parts = body.split(/\s+/);
        if (parts.length !== 2) return; // pas le format "C1 C2", on ignore silencieusement

        const cell1 = parseCell(parts[0]);
        const cell2 = parseCell(parts[1]);
        if (!cell1 || !cell2) return; // pas des coordonnées valides, on ignore

        await performSwap(client, jid, session, cell1, cell2, box);
    }
};
