const BLAGUES = [
    "Pourquoi les plongeurs plongent-ils toujours en arrière ? Parce que sinon ils tomberaient dans le bateau ! 😂",
    "Un homme entre dans une bibliothèque et demande : 'Vous avez des livres sur la paranoïa ?' La bibliothécaire répond : 'Ils sont juste derrière vous !' 👀",
    "Qu'est-ce qu'un canif ? Un petit fien ! 🐕",
    "Pourquoi l'épouvantail a-t-il eu une promotion ? Parce qu'il était exceptionnel dans son domaine ! 🌾",
    "Comment appelle-t-on un chat tombé dans un pot de peinture le jour de Noël ? Un chat-peint de Noël ! 🎨",
    "Qu'est-ce qu'un crocodile qui surveille la cour d'école ? Un sac à dents ! 😬",
    "Pourquoi les vampires sont-ils faciles à tromper ? Parce qu'ils sont trop crédules ! 🧛",
    "Comment appelle-t-on un boomerang qui ne revient pas ? Un bâton ! 🪃",
];

export default {
    name: 'blague',
    version: '1.0.0',
    description: 'Envoie une blague aléatoire',
    commands: ['blague', 'joke'],
    category: 'fun',
    async handler(client, message, args, { box, S }) {
        const jid    = message.key.remoteJid;
        const blague = BLAGUES[Math.floor(Math.random() * BLAGUES.length)];
        await client.sendMessage(jid, {
            text: box(`│ *😂 BLAGUE DU JOUR*`, `│`, `│ ${blague}`),
            nativeFlow: S.chan
        }, { quoted: message });
    }
};
