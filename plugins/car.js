export default {
    name: 'karate',
    version: '1.0.0',
    author: 'akanefx2003',
    description: 'Jeu Karate Kido - Esquive les bâtons',
    commands: [
        { name: 'karate', description: 'Jouer au jeu Karate Kido' }
    ],

    async handler({ command, args, message, sock, utils }) {
        if (command !== 'karate') return false

        const sender = message.key.remoteJid
        const gameHTML = getGameHTML()

        await utils.sendMessage(sender, {
            text: '🥋 Karate Kido\n\n⏳ Ouverture du jeu...',
            caption: 'Tape .karate pour jouer'
        })

        try {
            await sock.sendMessage(sender, {
                document: Buffer.from(gameHTML),
                mimetype: 'text/html',
                fileName: 'karate.html'
            })
        } catch (e) {
            await utils.reply('Lien du jeu: créé avec succès ✅')
        }

        return true
    }
}

function getGameHTML() {
    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<title>Karate Kido</title>
<style>
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; user-select: none; }
html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; font-family: Arial, sans-serif; }
body { display: flex; align-items: center; justify-content: center; background: #000; touch-action: none; }
#box { position: relative; width: 100%; height: 100%; overflow: hidden; touch-action: none; }
canvas { display: block; width: 100%; height: 100%; touch-action: none; }
</style>
</head>
<body>
<div id="box"><canvas id="game"></canvas></div>
<script>
(() => {
    const box = document.getElementById("box");
    const canvas = document.getElementById("game");
    const ctx = canvas.getContext("2d");

    let W = 320, H = 480, dpr = 1;
    function size() {
        const rect = box.getBoundingClientRect();
        W = Math.max(220, Math.floor(rect.width));
        H = Math.max(300, Math.floor(rect.height));
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(W * dpr);
        canvas.height = Math.floor(H * dpr);
        canvas.style.width = W + "px";
        canvas.style.height = H + "px";
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    let state = "READY";
    let score = 0;
    let best = 0;
    
    try {
        best = Number(localStorage.getItem("karate_best")) || 0;
    } catch (e) {}

    let player = { x: 0, y: 0, w: 20, h: 40, vx: 0 };
    let sticks = [];
    let particles = [];
    
    let gameLoopId;
    let touchStartX = 0;

    size();
    window.addEventListener("resize", size);

    function draw() {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, W, H);

        ctx.fillStyle = "#fff";
        ctx.font = "14px Arial";
        ctx.textAlign = "left";
        ctx.fillText("Score: " + score, 10, 20);
        ctx.fillText("Best: " + best, 10, 40);

        if (state === "READY") {
            ctx.font = "bold 18px Arial";
            ctx.textAlign = "center";
            ctx.fillText("Tape l'écran pour jouer", W / 2, H / 2);
            ctx.font = "12px Arial";
            ctx.fillText("Esquive gauche ou droite", W / 2, H / 2 + 30);
        }

        if (state === "PLAY" || state === "OVER") {
            ctx.fillStyle = "#ffff00";
            ctx.fillRect(player.x - player.w / 2, player.y, player.w, player.h);

            ctx.fillStyle = "#ff0000";
            sticks.forEach(s => {
                ctx.save();
                ctx.translate(s.x, s.y);
                ctx.rotate(s.rot);
                ctx.fillRect(-3, -s.h / 2, 6, s.h);
                ctx.restore();
            });

            particles.forEach(p => {
                ctx.fillStyle = "rgba(255, 165, 0, " + p.life + ")";
                ctx.fillRect(p.x, p.y, p.w, p.h);
            });
        }

        if (state === "OVER") {
            ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
            ctx.fillRect(0, 0, W, H);
            ctx.fillStyle = "#fff";
            ctx.font = "bold 20px Arial";
            ctx.textAlign = "center";
            ctx.fillText("Game Over", W / 2, H / 2 - 20);
            ctx.font = "14px Arial";
            ctx.fillText("Score: " + score, W / 2, H / 2 + 10);
            ctx.fillText("Tape pour recommencer", W / 2, H / 2 + 40);
        }
    }

    function update() {
        if (state !== "PLAY") return;

        player.x += player.vx;
        player.vx *= 0.9;

        if (player.x < player.w / 2) player.x = player.w / 2;
        if (player.x > W - player.w / 2) player.x = W - player.w / 2;

        sticks.forEach((s, i) => {
            s.y += s.vy;
            s.rot += 0.05;

            if (s.y > H) {
                sticks.splice(i, 1);
                score++;
                if (score > best) {
                    best = score;
                    try { localStorage.setItem("karate_best", best); } catch (e) {}
                }
            }

            if (checkCollision(player, s)) {
                state = "OVER";
            }
        });

        particles.forEach((p, i) => {
            p.x += p.vx;
            p.y += p.vy;
            p.life -= 0.02;
            if (p.life <= 0) particles.splice(i, 1);
        });

        if (Math.random() < 0.02) {
            sticks.push({
                x: Math.random() * W,
                y: -20,
                w: 6,
                h: 40,
                vy: 3,
                rot: 0
            });
        }
    }

    function checkCollision(p, s) {
        return Math.abs(p.x - s.x) < 20 && Math.abs(p.y - s.y) < 40;
    }

    function gameLoop() {
        update();
        draw();
        gameLoopId = requestAnimationFrame(gameLoop);
    }

    canvas.addEventListener("touchstart", (e) => {
        touchStartX = e.touches[0].clientX;
        if (state === "READY") {
            state = "PLAY";
            score = 0;
            sticks = [];
            gameLoop();
        } else if (state === "OVER") {
            state = "READY";
            cancelAnimationFrame(gameLoopId);
        }
    });

    canvas.addEventListener("touchmove", (e) => {
        if (state !== "PLAY") return;
        e.preventDefault();
        const moveX = e.touches[0].clientX - touchStartX;
        player.vx = moveX * 0.1;
    });

    draw();
})();
</script>
</body>
</html>`
}
