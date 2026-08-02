// utils/pluginManager.js — Cœur du système de plugins

import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { pathToFileURL } from 'url';

const PLUGINS_DIR    = './plugins';
const PLUGINS_LIST   = './database/plugins.json';
const STORE_API      = 'https://akane-plugins.vercel.app/api'; // URL du store

// ─── Structure d'un plugin ────────────────────────────────────────────────────
// {
//   name: 'ping',
//   version: '1.0.0',
//   description: 'Teste la latence du bot',
//   author: 'AkaneMD',
//   commands: ['ping', 'latence'],
//   category: 'tools',
//   url: 'https://...',       // URL source (si installé depuis le store)
//   enabled: true,
// }

class _PluginManager {

    constructor() {
        this.plugins = new Map();   // name → { meta, module }
        this.commands = new Map();  // command → name
        this._ensureDirs();
    }

    _ensureDirs() {
        fs.mkdirSync(PLUGINS_DIR, { recursive: true });
        fs.mkdirSync('./database', { recursive: true });
        if (!fs.existsSync(PLUGINS_LIST)) {
            fs.writeFileSync(PLUGINS_LIST, JSON.stringify([], null, 2));
        }
    }

    // ── Charger tous les plugins au démarrage ──────────────────────────────
    async loadAll() {
        const list = this._readList();
        let loaded = 0;
        for (const meta of list) {
            if (!meta.enabled) continue;
            try {
                await this._loadPlugin(meta);
                loaded++;
            } catch (e) {
                console.error(`❌ Plugin "${meta.name}" échoué : ${e.message}`);
            }
        }
        return loaded;
    }

    async _loadPlugin(meta) {
        const filePath = path.resolve(PLUGINS_DIR, `${meta.name}.js`);
        if (!fs.existsSync(filePath)) throw new Error(`Fichier introuvable : ${filePath}`);
        const fileUrl = pathToFileURL(filePath).href + `?t=${Date.now()}`;
        const mod = await import(fileUrl);
        this.plugins.set(meta.name, { meta, module: mod });
        // Enregistrer chaque commande déclarée
        for (const cmd of (meta.commands || [])) {
            this.commands.set(cmd.toLowerCase(), meta.name);
        }
    }

    // ── Installer depuis une URL ───────────────────────────────────────────
    async installFromUrl(url) {
        // Télécharger le JS
        const code = await this._download(url);

        // Extraire les métadonnées depuis les commentaires du plugin
        const meta = this._parseMeta(code, url);
        if (!meta.name) throw new Error('Le plugin ne contient pas de métadonnées valides (// @name, // @commands...)');

        // Sauvegarder le fichier
        const filePath = path.join(PLUGINS_DIR, `${meta.name}.js`);
        fs.writeFileSync(filePath, code, 'utf-8');

        // Mettre à jour la liste
        const list = this._readList();
        const idx  = list.findIndex(p => p.name === meta.name);
        if (idx !== -1) list[idx] = meta;
        else list.push(meta);
        this._saveList(list);

        // Charger dynamiquement sans redémarrage
        await this._loadPlugin(meta);

        return meta;
    }

    // ── Désinstaller un plugin ─────────────────────────────────────────────
    uninstall(name) {
        const meta = this.plugins.get(name)?.meta;
        if (!meta) throw new Error(`Plugin "${name}" introuvable`);

        // Retirer les commandes
        for (const cmd of (meta.commands || [])) {
            this.commands.delete(cmd.toLowerCase());
        }
        this.plugins.delete(name);

        // Supprimer le fichier
        const filePath = path.join(PLUGINS_DIR, `${name}.js`);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

        // Mettre à jour la liste
        const list = this._readList().filter(p => p.name !== name);
        this._saveList(list);
    }

    // ── Activer / Désactiver ───────────────────────────────────────────────
    toggle(name, enabled) {
        const list = this._readList();
        const idx  = list.findIndex(p => p.name === name);
        if (idx === -1) throw new Error(`Plugin "${name}" introuvable`);
        list[idx].enabled = enabled;
        this._saveList(list);
        if (!enabled) {
            const meta = this.plugins.get(name)?.meta;
            for (const cmd of (meta?.commands || [])) this.commands.delete(cmd.toLowerCase());
            this.plugins.delete(name);
        }
    }

    // ── Exécuter une commande ──────────────────────────────────────────────
    async execute(command, client, message, args) {
        const pluginName = this.commands.get(command.toLowerCase());
        if (!pluginName) return false;
        const entry = this.plugins.get(pluginName);
        if (!entry || !entry.module?.default) return false;
        await entry.module.default(client, message, args, command);
        return true;
    }

    // ── Liste des plugins installés ────────────────────────────────────────
    list() {
        return this._readList();
    }

    count() {
        return this.plugins.size;
    }

    getCommands() {
        return [...this.commands.keys()];
    }

    // ── Helpers ────────────────────────────────────────────────────────────
    _readList() {
        try { return JSON.parse(fs.readFileSync(PLUGINS_LIST, 'utf-8')); }
        catch (e) { return []; }
    }

    _saveList(list) {
        fs.writeFileSync(PLUGINS_LIST, JSON.stringify(list, null, 2));
    }

    _parseMeta(code, url) {
        const get = (key) => {
            const m = code.match(new RegExp(`^\\s*//\\s*@${key}\\s+(.+)$`, 'm'));
            return m ? m[1].trim() : '';
        };
        const cmds = get('commands').split(/[\s,]+/).filter(Boolean);
        return {
            name:        get('name') || '',
            version:     get('version') || '1.0.0',
            description: get('description') || '',
            author:      get('author') || 'Inconnu',
            commands:    cmds,
            category:    get('category') || 'general',
            url:         url,
            enabled:     true,
        };
    }

    _download(url) {
        return new Promise((resolve, reject) => {
            const lib = url.startsWith('https') ? https : http;
            lib.get(url, (res) => {
                if (res.statusCode === 301 || res.statusCode === 302) {
                    return this._download(res.headers.location).then(resolve).catch(reject);
                }
                if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve(data));
            }).on('error', reject);
        });
    }

}

export const PluginManager = new _PluginManager();
