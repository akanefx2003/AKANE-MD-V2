// @name        ping
// @version     1.0.0
// @description Teste la latence du bot
// @author      AkaneMD
// @commands    ping latence
// @category    tools

import { box, S } from '../utils/style.js';

export default async function(client, message, args, cmd) {
    const jid   = message.key.remoteJid;
    const start = Date.now();
    await client.sendPresenceUpdate('composing', jid);
    const ms = Date.now() - start;
    await client.sendMessage(jid, {
        text: box(`│ *🏓 PONG !*`, `│`, `│ *⚡ Latence : ${ms}ms*`),
        nativeFlow: S.chan
    });
}
