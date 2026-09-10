// plugins/car.js
import fs from 'fs';
import path from 'path';

const CARS_FILE = path.join(process.cwd(), 'data', 'cars_players.json');

// Concessionnaire
const CAR_DEALERSHIP = [
    { id: '1', name: 'Peugeot 206', price: 5000, speed: 120, emoji: '🚗' },
    { id: '2', name: 'Golf 7 GTI', price: 15000, speed: 220, emoji: '🏎️' },
    { id: '3', name: 'BMW M4 Comp', price: 45000, speed: 290, emoji: '🏎️' },
    { id: '4', name: 'Porsche 911', price: 90000, speed: 320, emoji: '🏎️' },
    { id: '5', name: 'Lambo Huracán', price: 180000, speed: 345, emoji: '🏎️' },
    { id: '6', name: 'Bugatti Chiron', price: 500000, speed: 420, emoji: '🚀' }
];

function loadData() {
    try {
        if (!fs.existsSync(CARS_FILE)) return {};
        return JSON.parse(fs.readFileSync(CARS_FILE, 'utf8'));
    } catch (e) {
        return {};
    }
}

function saveData(data) {
    try {
        fs.mkdirSync(path.dirname(CARS_FILE), { recursive: true });
        fs.writeFileSync(CARS_FILE, JSON.stringify(data, null, 2));
    } catch (e) {}
}

function getPlayer(data, id, name) {
    if (!data[id]) {
        data[id] = { id, name, money: 10000, cars: [], wins: 0, races: 0 };
    }
    data[id].name = name;
    return data[id];
}

export default {
    name: 'car',
    version: '4.0.0',
    description: 'Jeu de voitures visuel et interactif avec boutons',
    category: 'fun',
    author: 'Akane MD v2',
    commands: ['car', 'voiture', 'garage', 'race'],

    async handler(client, message, args, { box, S }) {
        const jid    = message.key.remoteJid;
        const sender = message.key.participant || message.key.remoteJid;
        const name   = message.pushName || sender.split('@')[0];
        const sub    = (args[0] || '').toLowerCase();

        const data   = loadData();
        const player = getPlayer(data, sender, name);

        // ── SHOP / CONCESSIONNAIRE VIA BOUTONS ─────────────────────────────────
        if (sub === 'shop' || sub === 'store') {
            const catalog = CAR_DEALERSHIP.map(c => 
                `│ *[${c.id}]* ${c.emoji} *${c.name}*\n│    ├ 💵 *${c.price.toLocaleString()} $* | ⚡ *${c.speed} km/h*`
            );

            // Boutons d'achat rapide
            const buttons = CAR_DEALERSHIP.slice(0, 5).map(c => ({
                name: 'quick_reply',
                buttonParamsJson: JSON.stringify({
                    display_text: `Acheter ${c.name}`,
                    id: `.car buy ${c.id}`
                })
            }));

            return client.sendMessage(jid, {
                text: box(
                    `╭┄─̣✦ *🏪 CONCESSIONNAIRE AKANE* ✦─̣┄`,
                    `│ 💰 *Ton Solde :* ${player.money.toLocaleString()} $`,
                    `│┄─̣┄─̣┄─̣┄─̣┄─̣┄─̣┄─̣┄─̣┄─̣┄─̣┄─̣`,
                    ...catalog,
                    `│┄─̣┄─̣┄─̣┄─̣┄─̣┄─̣┄─̣┄─̣┄─̣┄─̣┄─̣`,
                    `│ *Clique sur un bouton ci-dessous pour acheter :*`,
                    `╰┄─̣✦ *© AKANE MD v2 🌹*`
                ),
                buttons: buttons,
                headerType: 1
            }, { quoted: message });
        }

        // ── ACHAT D'UNE VOITURE ───────────────────────────────────────────────
        if (sub === 'buy') {
            const carId = args[1];
            const carToBuy = CAR_DEALERSHIP.find(c => c.id === carId);

            if (!carToBuy) {
                return client.sendMessage(jid, { text: box(`│ *❌ Voiture introuvable. Tape .car shop*`) }, { quoted: message });
            }

            if (player.money < carToBuy.price) {
                return client.sendMessage(jid, {
                    text: box(
                        `│ *❌ SOLDE INSUFFISANT !*`,
                        `│ 💵 Prix : *${carToBuy.price.toLocaleString()} $*`,
                        `│ 💳 Ton Solde : *${player.money.toLocaleString()} $*`
                    )
                }, { quoted: message });
            }

            player.money -= carToBuy.price;
            player.cars.push(carToBuy);
            saveData(data);

            return client.sendMessage(jid, {
                text: box(
                    `╭┄─̣✦ *🎉 ACHAT CONFIRMÉ !* ✦─̣┄`,
                    `│`,
                    `│ Tu as débloqué : ${carToBuy.emoji} *${carToBuy.name}*`,
                    `│ ⚡ Vitesse max : *${carToBuy.speed} km/h*`,
                    `│ 💰 Solde restant : *${player.money.toLocaleString()} $*`,
                    `│`,
                    `╰┄─̣✦ *© AKANE MD v2 🌹*`
                ),
                buttons: [
                    { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '🏎️ Faire une Course', id: '.car race' }) },
                    { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '🚗 Voir mon Garage', id: '.car garage' }) }
                ]
            }, { quoted: message });
        }

        // ── COURSE AUTOMOBILE (INTERACTIVE) ──────────────────────────────────
        if (sub === 'race') {
            if (player.cars.length === 0) {
                return client.sendMessage(jid, {
                    text: box(`│ *❌ Tu dois posséder au moins une voiture ! Tape .car shop*`)
                }, { quoted: message });
            }

            const bestCar = player.cars.reduce((prev, curr) => (prev.speed > curr.speed) ? prev : curr);
            const winChance = Math.min(0.85, (bestCar.speed / 500) + 0.2);
            const isWin = Math.random() < winChance;

            if (isWin) {
                const reward = Math.floor(bestCar.speed * 15 + Math.random() * 2000);
                player.money += reward;
                player.wins++;
                saveData(data);

                return client.sendMessage(jid, {
                    text: box(
                        `╭┄─̣✦ *🏁 VICTOIRE EN COURSE !* ✦─̣┄`,
                        `│`,
                        `│ 🏎️ *Voiture :* ${bestCar.emoji} ${bestCar.name}`,
                        `│ ⚡ *Vitesse :* ${bestCar.speed} km/h`,
                        `│ 💵 *Gain :* +${reward.toLocaleString()} $`,
                        `│ 💰 *Nouveau Solde :* ${player.money.toLocaleString()} $`,
                        `│`,
                        `╰┄─̣✦ *© AKANE MD v2 🌹*`
                    ),
                    buttons: [
                        { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '🔄 Rejouer', id: '.car race' }) },
                        { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '🏪 Shop', id: '.car shop' }) }
                    ]
                }, { quoted: message });
            } else {
                saveData(data);
                return client.sendMessage(jid, {
                    text: box(
                        `╭┄─̣✦ *💥 DÉFAITE EN COURSE !* ✦─̣┄`,
                        `│`,
                        `│ Ton adversaire t'a dépassé sur la ligne !`,
                        `│ 💡 *Achète un véhicule plus rapide sur le Shop.*`,
                        `│`,
                        `╰┄─̣✦ *© AKANE MD v2 🌹*`
                    ),
                    buttons: [
                        { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '🔄 Réessayer', id: '.car race' }) },
                        { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '🏪 Shop', id: '.car shop' }) }
                    ]
                }, { quoted: message });
            }
        }

        // ── GARAGE VISUEL ───────────────────────────────────────────────────
        if (sub === 'garage') {
            if (player.cars.length === 0) {
                return client.sendMessage(jid, {
                    text: box(`│ *🚗 Ton garage est vide ! Visite le shop.*`),
                    buttons: [{ name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '🏪 Visiter le Shop', id: '.car shop' }) }]
                }, { quoted: message });
            }

            const myCars = player.cars.map((c, i) => `│ *${i + 1}.* ${c.emoji} *${c.name}* (${c.speed} km/h)`);
            return client.sendMessage(jid, {
                text: box(
                    `╭┄─̣✦ *🏎️ GARAGE DE ${player.name.toUpperCase()}* ✦─̣┄`,
                    `│ 💰 Solde : *${player.money.toLocaleString()} $*`,
                    `│ 🏆 Victoires : *${player.wins}*`,
                    `│┄─̣┄─̣┄─̣┄─̣┄─̣┄─̣┄─̣┄─̣┄─̣┄─̣┄─̣`,
                    ...myCars,
                    `╰┄─̣✦ *© AKANE MD v2 🌹*`
                ),
                buttons: [
                    { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '🏁 Lancer une Course', id: '.car race' }) },
                    { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '🏪 Shop', id: '.car shop' }) }
                ]
            }, { quoted: message });
        }

        // ── CLASSEMENT TOP ───────────────────────────────────────────────────
        if (sub === 'top') {
            const allPlayers = Object.values(data);
            const sorted = allPlayers.sort((a, b) => b.wins - a.wins || b.money - a.money).slice(0, 10);
            const medals = ['🥇', '🥈', '🥉'];

            const lines = sorted.map((p, i) => `│ ${medals[i] || `*${i + 1}.*`} *${p.name}* ─ 🏆 ${p.wins} victoires`);

            return client.sendMessage(jid, {
                text: box(
                    `╭┄─̣✦ *🏆 CLASSEMENT DES PILOTES* ✦─̣┄`,
                    `│┄─̣┄─̣┄─̣┄─̣┄─̣┄─̣┄─̣┄─̣┄─̣┄─̣┄─̣`,
                    ...lines,
                    `│┄─̣┄─̣┄─̣┄─̣┄─̣┄─̣┄─̣┄─̣┄─̣┄─̣┄─̣`,
                    `╰┄─̣✦ *© AKANE MD v2 🌹*`
                )
            }, { quoted: message });
        }

        // ── MENU PRINCIPAL INTERACTIF (.car) ─────────────────────────────────
        return client.sendMessage(jid, {
            text: box(
                `╭┄─̣✦ *🏎️ GARAGE & CAR STORE* ✦─̣┄`,
                `│`,
                `│ 👤 *Pilote :* ${player.name}`,
                `│ 💰 *Solde :* ${player.money.toLocaleString()} $`,
                `│ 🏆 *Victoires :* ${player.wins}`,
                `│`,
                `│ *Utilise les boutons interactifs ci-dessous pour jouer :*`,
                `│`,
                `╰┄─̣✦ *© AKANE MD v2 🌹*`
            ),
            buttons: [
                { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '🏪 Concessionnaire', id: '.car shop' }) },
                { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '🚗 Mon Garage', id: '.car garage' }) },
                { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '🏁 Course Street', id: '.car race' }) },
                { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '🏆 Classement Top', id: '.car top' }) }
            ],
            headerType: 1
        }, { quoted: message });
    }
};