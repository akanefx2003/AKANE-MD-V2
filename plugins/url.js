export default {
    name:        'url',
    version:     '1.0.0',
    description: 'Upload un média et génère son lien CDN direct',
    author:      'AkaneMD',
    commands:    ['url'],
    category:    'tools',

    async handler(client, message, args, { box, S }) {
        const jid    = message.key.remoteJid;
        const sender = message.key.participant || message.key.remoteJid;

        const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;

        // ── Pas de média cité ──────────────────────────────────────────────
        if (!quoted) {
            return client.sendMessage(jid, {
                text: box(
                    `│ *🔗 URL UPLOADER*`, `│`,
                    `│ *⚠️ RÉPONDS À UN MÉDIA*`,
                    `│ *POUR GÉNÉRER SON LIEN !*`, `│`,
                    `│ *📁 SUPPORTS :*`,
                    `│ 🖼️ Image • 🎥 Vidéo`,
                    `│ 🎵 Audio • 📄 Document`, `│`,
                    `│ *💡 Réponds à un média puis tape .url*`,
                ),
                nativeFlow: S.chan
            }, { quoted: message });
        }

        const mediaData = quoted.imageMessage
            || quoted.videoMessage
            || quoted.audioMessage
            || quoted.documentMessage;

        if (!mediaData) {
            return client.sendMessage(jid, {
                text: box(`│ *❌ MÉDIA NON SUPPORTÉ*`, `│`, `│ *Réponds à une image, vidéo,*`, `│ *audio ou document.*`),
                nativeFlow: S.chan
            }, { quoted: message });
        }

        // Réaction d'attente
        await client.sendMessage(jid, { react: { text: '⏳', key: message.key } });

        try {
            // ── Télécharger le média du message cité ──────────────────────
            const { downloadMediaMessage } = await import('@crysnovax/baileys');
            const fakeMsg = { key: { ...message.key }, message: quoted };
            const buffer  = await downloadMediaMessage(fakeMsg, 'buffer', {});

            if (!buffer || buffer.length === 0) throw new Error('Impossible de télécharger le média');

            // ── Déterminer l'extension ────────────────────────────────────
            let extension = 'bin';
            try {
                const { fileTypeFromBuffer } = await import('file-type');
                const type = await fileTypeFromBuffer(buffer);
                extension  = type?.ext || quoted.documentMessage?.fileName?.split('.').pop() || 'bin';
            } catch (e) {
                extension = quoted.documentMessage?.fileName?.split('.').pop() || 'bin';
            }

            // ── Upload vers CDN Crysnovax ─────────────────────────────────
            const fileName = `akane_${Date.now()}.${extension}`;
            const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);

            // Construire le multipart/form-data manuellement (sans axios ni form-data)
            const header = Buffer.from(
                `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`
            );
            const footer  = Buffer.from(`\r\n--${boundary}--\r\n`);
            const body    = Buffer.concat([header, buffer, footer]);

            const ctrl    = new AbortController();
            const timeout = setTimeout(() => ctrl.abort(), 20000);

            const res = await fetch('https://cdn.crysnovax.link/upload', {
                method:  'POST',
                signal:  ctrl.signal,
                headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
                body,
            });
            clearTimeout(timeout);

            const data = await res.json();
            let link   = data?.url || data?.link || (typeof data === 'string' ? data : null);
            if (typeof link === 'object') link = link?.url || link?.link;
            if (!link) throw new Error('CDN n\'a pas retourné de lien');
            link = link.trim();

            const sizeMB = (buffer.length / 1024 / 1024).toFixed(2);

            // Réaction succès
            await client.sendMessage(jid, { react: { text: '✅', key: message.key } });

            // ── Réponse selon le type de média ────────────────────────────
            const typeLabel = quoted.imageMessage ? '🖼️ Image'
                : quoted.videoMessage   ? '🎥 Vidéo'
                : quoted.audioMessage   ? '🎵 Audio'
                : `📄 ${quoted.documentMessage?.fileName || `fichier.${extension}`}`;

            if (quoted.imageMessage) {
                await client.sendMessage(jid, {
                    image:   buffer,
                    caption: box(
                        `│ *✅ LIEN GÉNÉRÉ !*`, `│`,
                        `│ *${typeLabel} • ${sizeMB} MB*`, `│`,
                        `│ *🌐 LIEN DIRECT :*`,
                        `│ ${link}`, `│`,
                        `│ *📂 CDN Crysnovax*`,
                    ),
                    nativeFlow: [{ text: '📋 Copier le lien', copy: link }]
                }, { quoted: message });
            } else {
                await client.sendMessage(jid, {
                    text: box(
                        `│ *✅ LIEN GÉNÉRÉ !*`, `│`,
                        `│ *${typeLabel} • ${sizeMB} MB*`, `│`,
                        `│ *🌐 LIEN DIRECT :*`,
                        `│ ${link}`, `│`,
                        `│ *📂 CDN Crysnovax*`,
                    ),
                    nativeFlow: [{ text: '📋 Copier le lien', copy: link }]
                }, { quoted: message });
            }

        } catch (error) {
            await client.sendMessage(jid, { react: { text: '❌', key: message.key } });
            await client.sendMessage(jid, {
                text: box(
                    `│ *❌ ÉCHEC DE L'UPLOAD*`, `│`,
                    `│ *${error.message}*`, `│`,
                    `│ *💡 Réessaie dans quelques secondes*`,
                ),
                nativeFlow: S.chan
            }, { quoted: message });
        }
    }
};
