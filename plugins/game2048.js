// commands/game2048.js
// @cat: game

import fs from 'fs';
import path from 'path';

const SIZE       = 4;
const WIN_VALUE  = 2048;
const SCORES_FILE = path.join(process.cwd(), 'data', '2048_scores.json');

const sessions = new Map(); // jid -> { grid, score, ownerId, ownerName, over, won }

// IDs des messages envoyés par le bot lui-même, pour ne jamais les traiter comme un coup joué
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
        console.error('Erreur envoi message 2048:', e.message);
    }
}

// ── Scores persistés ─────────────────────────────────────────────────────
function loadScores() {
    try {
        if (!fs.existsSync(SCORES_FILE)) return {};
        return JSON.parse(fs.readFileSync(SCORES_FILE, 'utf8'));
    } catch (e) {
        console.error('Erreur lecture scores 2048:', e.message);
        return {};
    }
}

function saveScores(scores) {
    try {
        fs.mkdirSync(path.dirname(SCORES_FILE), { recursive: true });
        fs.writeFileSync(SCORES_FILE, JSON.stringify(scores, null, 2));
    } catch (e) {
        console.error('Erreur sauvegarde scores 2048:', e.message);
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
function emptyGrid() {
    return Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
}

function emptyCells(grid) {
    const cells = [];
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (grid[r][c] === 0) cells.push([r, c]);
    return cells;
}

function spawnTile(grid) {
    const cells = emptyCells(grid);
    if (cells.length === 0) return false;
    const [r, c] = cells[Math.floor(Math.random() * cells.length)];
    grid[r][c] = Math.random() < 0.9 ? 2 : 4;
    return true;
}

function transpose(grid) {
    const res = emptyGrid();
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) res[c][r] = grid[r][c];
    return res;
}

function reverseRows(grid) {
    return grid.map(row => [...row].reverse());
}

function slideRowLeft(row) {
    const nums = row.filter(v => v !== 0);
    let gained = 0;
    for (let i = 0; i < nums.length - 1; i++) {
        if (nums[i] === nums[i + 1]) {
            nums[i] *= 2;
            gained += nums[i];
            nums.splice(i + 1, 1);
        }
    }
    while (nums.length < SIZE) nums.push(0);
    return { row: nums, gained };
}

function slideAndMergeGrid(grid) {
    let gained = 0;
    const newGrid = grid.map(row => {
        const { row: newRow, gained: g } = slideRowLeft(row);
        gained += g;
        return newRow;
    });
    return { grid: newGrid, gained };
}

// Ramène toujours au cas "glisser vers la gauche" via transpose/inversion, puis revient
function move(grid, direction) {
    let g = grid;
    let gained = 0;

    if (direction === 'gauche') {
        ({ grid: g, gained } = slideAndMergeGrid(g));
    } else if (direction === 'droite') {
        g = reverseRows(g);
        ({ grid: g, gained } = slideAndMergeGrid(g));
        g = reverseRows(g);
    } else if (direction === 'haut') {
        g = transpose(g);
        ({ grid: g, gained } = slideAndMergeGrid(g));
        g = transpose(g);
    } else if (direction === 'bas') {
        g = transpose(g);
        g = reverseRows(g);
        ({ grid: g, gained } = slideAndMergeGrid(g));
        g = reverseRows(g);
        g = transpose(g);
    }

    return { grid: g, gained };
}

function gridsEqual(a, b) {
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (a[r][c] !== b[r][c]) return false;
    return true;
}

function canMove(grid) {
    if (emptyCells(grid).length > 0) return true;
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
        const v = grid[r][c];
        if (c < SIZE - 1 && grid[r][c + 1] === v) return true;
        if (r < SIZE - 1 && grid[r + 1][c] === v) return true;
    }
    return false;
}

function renderGrid(grid) {
    const cell = v => (v === 0 ? '.' : String(v));
    const lines = grid.map(row => row.map(v => cell(v).padStart(5, ' ')).join('')).join('\n');
    return '```\n' + lines + '\n```';
}

const DIRECTIONS = {
    haut: 'haut', h: 'haut', up: 'haut', z: 'haut', '⬆️': 'haut',
    bas: 'bas', b: 'bas', down: 'bas', s: 'bas', '⬇️': 'bas',
    gauche: 'gauche', g: 'gauche', left: 'gauche', q: 'gauche', '⬅️': 'gauche',
    droite: 'droite', d: 'droite', right: 'droite', '➡️': 'droite'
};

export default {
    name: '2048',
    version: '1.0.0',
    description: 'Le jeu 2048 classique, jouable en solo directement dans le chat',
    commands: ['2048'],
    category: 'game',
    usage: '.2048 start puis haut/bas/gauche/droite (ou h/b/g/d)',
    tips: [
        'Fusionne deux tuiles de même valeur pour les doubler',
        'Le but est d\'atteindre la tuile 2048, mais tu peux continuer après',
        'La partie se termine quand plus aucun mouvement n\'est possible',
        '.2048 top affiche le meilleur score de chaque joueur'
    ],
    async handler(client, message, args, { box, S }) {
        const jid    = message.key.remoteJid;
        const sender = message.key.participant || message.key.remoteJid;
        const name   = message.pushName || sender.split('@')[0];
        const sub    = (args[0] || '').toLowerCase();

        if (!sub || sub === 'help') {
            return reply(client, jid, {
                text: box(
                    `│ *🎮 2048*`, `│`,
                    `│ *.2048 start* — démarrer une partie`,
                    `│ *haut / bas / gauche / droite* — jouer (ou h/b/g/d)`,
                    `│ *.2048 stop* — arrêter la partie`,
                    `│ *.2048 top* — meilleurs scores`
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
            return reply(client, jid, { text: box(`│ *📊 TOP 2048*`, `│`, ...lines) });
        }

        if (sub === 'stop') {
            sessions.delete(jid);
            return reply(client, jid, { text: box(`│ *🛑 Partie 2048 arrêtée*`) });
        }

        if (sub === 'start') {
            const grid = emptyGrid();
            spawnTile(grid);
            spawnTile(grid);
            sessions.set(jid, { grid, score: 0, ownerId: sender, ownerName: name, over: false, won: false });
            return reply(client, jid, {
                text: box(
                    `│ *🎮 2048 — ${name}*`, `│`,
                    renderGrid(grid), `│`,
                    `│ *Score : 0*`, `│`,
                    `│ *haut / bas / gauche / droite pour jouer*`
                )
            });
        }

        return reply(client, jid, { text: box(`│ *❌ Commande inconnue, essaie .2048 help*`) });
    },

    // Hook appelé sur chaque message : capte haut/bas/gauche/droite pendant une partie
    async onMessage(client, message, { box }) {
        if (message.key?.id && ownMessageIds.has(message.key.id)) {
            ownMessageIds.delete(message.key.id);
            return;
        }

        const jid    = message.key.remoteJid;
        const sender = message.key.participant || message.key.remoteJid;
        const session = sessions.get(jid);
        if (!session || session.over) return;
        if (sender !== session.ownerId) return; // seul celui qui a lancé la partie peut jouer

        const body = (message.message?.conversation || message.message?.extendedTextMessage?.text || '').trim().toLowerCase();
        const direction = DIRECTIONS[body];
        if (!direction) return; // pas une commande de direction, on ignore silencieusement

        const { grid: newGrid, gained } = move(session.grid, direction);
        if (gridsEqual(newGrid, session.grid)) return; // mouvement sans effet

        session.grid = newGrid;
        session.score += gained;
        spawnTile(session.grid);

        const reachedWin = !session.won && session.grid.some(row => row.includes(WIN_VALUE));
        if (reachedWin) session.won = true;

        if (!canMove(session.grid)) {
            session.over = true;
            recordScore(session.ownerId, session.ownerName, session.score);
            await reply(client, jid, {
                text: box(
                    `│ *🏁 PARTIE TERMINÉE*`, `│`,
                    renderGrid(session.grid), `│`,
                    `│ *Score final : ${session.score}*`
                )
            });
            sessions.delete(jid);
            return;
        }

        await reply(client, jid, {
            text: box(
                reachedWin ? `│ *👑 2048 ATTEINT ! Continue si tu veux*` : `│ *🎮 2048*`, `│`,
                renderGrid(session.grid), `│`,
                `│ *Score : ${session.score}*`
            )
        });
    }
};
