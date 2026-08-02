// Plugin : ping
// Commandes : ping, latence

export default {
    name: 'ping',
    version: '1.0.0',
    description: 'Teste la latence du bot',
    commands: ['ping', 'latence'],
    category: 'tools',

    async handler(client, message, args, { box, S }) {
        const jid   = message.key.remoteJid;
        const start = Date.now();
        await client.sendPresenceUpdate('composing', jid);
        const ms = Date.now() - start;
        await client.sendMessage(jid, {
            text: box(`│ *🏓 PONG !*`, `│`, `│ *⚡ LATENCE : ${ms}ms*`),
            nativeFlow: S.chan
        }, { quoted: message });
    }
};
