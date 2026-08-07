export default {
    name: 'weather',
    version: '1.0.0',
    description: 'Météo en temps réel pour n\'importe quelle ville',
    commands: ['meteo', 'weather'],
    category: 'tools',
    async handler(client, message, args, { box, S }) {
        const jid  = message.key.remoteJid;
        const city = args.join(' ');
        if (!city) return client.sendMessage(jid, {
            text: box(`│ *🌤️ MÉTÉO*`, `│`, `│ *Usage : .meteo [ville]*`, `│ *Ex : .meteo Paris*`),
            nativeFlow: S.chan
        }, { quoted: message });

        try {
            const res  = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
            const data = await res.json();
            const cur  = data.current_condition[0];
            const desc = cur.lang_fr?.[0]?.value || cur.weatherDesc[0].value;
            const temp = cur.temp_C;
            const feel = cur.FeelsLikeC;
            const hum  = cur.humidity;
            const wind = cur.windspeedKmph;
            await client.sendMessage(jid, {
                text: box(
                    `│ *🌍 MÉTÉO : ${city.toUpperCase()}*`, `│`,
                    `│ *🌡️ TEMPÉRATURE : ${temp}°C*`,
                    `│ *🤔 RESSENTI : ${feel}°C*`,
                    `│ *💧 HUMIDITÉ : ${hum}%*`,
                    `│ *💨 VENT : ${wind} km/h*`,
                    `│ *☁️ ÉTAT : ${desc}*`,
                ),
                nativeFlow: S.chan
            }, { quoted: message });
        } catch (e) {
            await client.sendMessage(jid, { text: box(`│ *❌ Ville introuvable ou erreur réseau*`), nativeFlow: S.chan });
        }
    }
};
