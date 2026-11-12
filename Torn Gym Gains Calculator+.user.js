// ==UserScript==
// @name         Torn Gym Gains Calculator+
// @namespace    http://tampermonkey.net/
// @version      2.0.1
// @description  Plan gym training with Vladar's formula. Auto-pulls everything from API. Single session, multi-day, goal estimation, balance planner, gym comparison. Switchable color themes.
// @author       Rowage [3926289]
// @copyright    2026, Rowage [3926289]
// @match        https://www.torn.com/gym.php*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @connect      api.torn.com
// @run-at       document-end
// @license      GPL-3.0-or-later
// @downloadURL https://update.greasyfork.org/scripts/575551/Torn%20Gym%20Gains%20Calculator%2B.user.js
// @updateURL https://update.greasyfork.org/scripts/575551/Torn%20Gym%20Gains%20Calculator%2B.meta.js
// ==/UserScript==

(function () {
    'use strict';

    if (window.__tgcPlusLoaded) return;
    window.__tgcPlusLoaded = true;

    const STAT_CONSTS = {
        strength:  { A: 1600, B: 1700, C: 700  },
        defense:   { A: 2100, B: -600, C: 1500 },
        speed:     { A: 1600, B: 2000, C: 1350 },
        dexterity: { A: 1800, B: 1500, C: 1000 }
    };
    const STAT_ORDER = ['strength', 'defense', 'speed', 'dexterity'];
    const STAT_LABELS = {
        strength:  'Strength',
        defense:   'Defense',
        speed:     'Speed',
        dexterity: 'Dexterity'
    };
    const STAT_SHORT = {
        strength:  'STR',
        defense:   'DEF',
        speed:     'SPD',
        dexterity: 'DEX'
    };
    const STAT_COLORS = {
        strength:  'var(--tgc-str)',
        defense:   'var(--tgc-def)',
        speed:     'var(--tgc-spd)',
        dexterity: 'var(--tgc-dex)'
    };

    const SPECIAL_GYMS = {
        balboas:   {
            label: "Balboas Gym",
            energy: 25,
            dots: { strength: 0, defense: 75, speed: 0, dexterity: 75 },
            check: s => (s.defense + s.dexterity) >= 1.25 * (s.strength + s.speed),
            description: "DEF + DEX >= 125% of STR + SPD"
        },
        frontline: {
            label: "Frontline Fitness",
            energy: 25,
            dots: { strength: 75, defense: 0, speed: 75, dexterity: 0 },
            check: s => (s.strength + s.speed) >= 1.25 * (s.defense + s.dexterity),
            description: "STR + SPD >= 125% of DEF + DEX"
        },
        gym3000:   {
            label: "Gym 3000",
            energy: 50,
            dots: { strength: 80, defense: 0, speed: 0, dexterity: 0 },
            stat: 'strength',
            check: s => {
                const sorted = [s.strength, s.defense, s.speed, s.dexterity].sort((a, b) => b - a);
                return sorted[0] === s.strength && s.strength >= 1.25 * sorted[1];
            },
            description: "STR >= 125% of second highest"
        },
        isoyamas:  {
            label: "Mr. Isoyamas",
            energy: 50,
            dots: { strength: 0, defense: 80, speed: 0, dexterity: 0 },
            stat: 'defense',
            check: s => {
                const sorted = [s.strength, s.defense, s.speed, s.dexterity].sort((a, b) => b - a);
                return sorted[0] === s.defense && s.defense >= 1.25 * sorted[1];
            },
            description: "DEF >= 125% of second highest"
        },
        totalrebound: {
            label: "Total Rebound",
            energy: 50,
            dots: { strength: 0, defense: 0, speed: 80, dexterity: 0 },
            stat: 'speed',
            check: s => {
                const sorted = [s.strength, s.defense, s.speed, s.dexterity].sort((a, b) => b - a);
                return sorted[0] === s.speed && s.speed >= 1.25 * sorted[1];
            },
            description: "SPD >= 125% of second highest"
        },
        elites:    {
            label: "Elites",
            energy: 50,
            dots: { strength: 0, defense: 0, speed: 0, dexterity: 80 },
            stat: 'dexterity',
            check: s => {
                const sorted = [s.strength, s.defense, s.speed, s.dexterity].sort((a, b) => b - a);
                return sorted[0] === s.dexterity && s.dexterity >= 1.25 * sorted[1];
            },
            description: "DEX >= 125% of second highest"
        }
    };

    const INCOMPATIBLE_PAIRS = [
        ['balboas', 'frontline'],
        ['gym3000', 'isoyamas'],
        ['gym3000', 'totalrebound'],
        ['gym3000', 'elites'],
        ['isoyamas', 'totalrebound'],
        ['isoyamas', 'elites'],
        ['totalrebound', 'elites']
    ];

    function gymPairCompatible(a, b) {
        if (!a || !b || a === b) return false;
        return !INCOMPATIBLE_PAIRS.some(p =>
            (p[0] === a && p[1] === b) || (p[0] === b && p[1] === a)
        );
    }

    const SPECIAL_GYM_IDS = {
        25: 'balboas',
        26: 'frontline',
        27: 'gym3000',
        28: 'isoyamas',
        29: 'totalrebound',
        30: 'elites'
    };

    const STORAGE_KEY = 'tgcPlusState_v2';
    const API_BASE = 'https://api.torn.com';
    const RATE_LIMIT = 70;
    const RATE_WINDOW_MS = 60000;
    const ENERGY_PER_XANAX = 250;
    const MAX_XANAX_PER_DAY = 3;
    const REFILLS_PER_DAY = 1;
    const NATURAL_REFILLS_PER_DAY = 24 / 5;

    const KEY_URL = 'https://www.torn.com/preferences.php#tab=api?step=addNewKey&title=GymGainsCalculator&user=bars,battlestats,gym,perks&torn=gyms';
    const GITHUB_URL = 'https://github.com/Rowage3/Torn-Gym-Gains-Calculator-Plus';

    const MAX_HISTORY_POINTS = 400;
    const MAX_DAY_SERIES_POINTS = 1500;
    const MAX_PROJECTION_DAYS = 50000;
    const MAX_SESSIONS_PER_DAY = 50;

    const clampInt = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.floor(v) || lo));

    function dailyEnergyBudget(maxEnergy) {
        const max = Math.max(1, maxEnergy || 150);
        const regen = max * NATURAL_REFILLS_PER_DAY;
        const refill = max * REFILLS_PER_DAY;
        const xanax = MAX_XANAX_PER_DAY * ENERGY_PER_XANAX;
        return { regen, refill, xanax, total: regen + refill + xanax, max };
    }

    function estimateDailyConsumables(energyPerDay, maxEnergy) {
        const b = dailyEnergyBudget(maxEnergy);
        const out = { xanax: 0, refill: 0, fromRegen: 0, overflow: 0, breachedCap: false };
        const need = Math.max(0, energyPerDay);

        const regenCap = b.regen;
        const refillCap = b.refill;

        let xanaxNeeded = 0;
        let refillNeeded = 0;

        if (need > regenCap) {
            const afterRegen = need - regenCap;
            if (afterRegen <= refillCap) {
                refillNeeded = 1;
            } else {
                refillNeeded = 1;
                const afterRefill = afterRegen - refillCap;
                xanaxNeeded = Math.min(MAX_XANAX_PER_DAY, Math.ceil(afterRefill / ENERGY_PER_XANAX));
            }
        }

        out.xanax = xanaxNeeded;
        out.refill = refillNeeded;

        const fromItems = xanaxNeeded * ENERGY_PER_XANAX + refillNeeded * refillCap;
        const remainder = need - fromItems;
        if (remainder > 0) {
            out.fromRegen = Math.min(remainder, regenCap);
            const afterAll = remainder - out.fromRegen;
            if (afterAll > 0) {
                out.overflow = afterAll;
                out.breachedCap = true;
            }
        }

        return out;
    }

    function estimatePresetConsumablesPerDay(preset, items, sessionsPerDay) {
        if (!items || preset === 'k99' || preset === 'none') return null;
        const n = Math.max(1, sessionsPerDay || 1);
        return {
            xanax:   (items.xanax   || 0) * n,
            refill:  (items.refill  ? 1 : 0) * n,
            edvd:    (items.edvd    || 0) * n,
            candy:   (items.candy   || 0) * n,
            candyValue: items.candyValue || 0,
            ecstasy: (items.ecstasy ? 1 : 0) * n
        };
    }

    function formatConsumablesLine(est) {
        if (!est) return '';
        const parts = [];
        if (est.xanax)  parts.push(`${est.xanax} xanax`);
        if (est.refill) parts.push(`${est.refill} refill`);
        if (est.fromRegen > 0) parts.push(`${fmtInt(est.fromRegen)}E natural`);
        return parts.join(' + ');
    }

    function formatPresetConsumablesLine(est) {
        if (!est) return '';
        const parts = [];
        if (est.xanax)    parts.push(`${est.xanax} xanax`);
        if (est.refill)   parts.push(`${est.refill} refill`);
        if (est.edvd)     parts.push(`${est.edvd}x eDVD`);
        if (est.candy)    parts.push(`${est.candy}x ${est.candyValue}h candy`);
        if (est.ecstasy)  parts.push(`${est.ecstasy}x ecstasy`);
        return parts.join(' + ');
    }

    function scaleConsumables(perDay, days) {
        if (!perDay) return null;
        const out = {};
        for (const k of Object.keys(perDay)) {
            if (k === 'candyValue') { out[k] = perDay[k]; continue; }
            out[k] = (perDay[k] || 0) * days;
        }
        return out;
    }

    function buildCostBlock(c, trainingDays, sessionsPerTrainDay) {
        const energyPerTrainDay = c.energy * sessionsPerTrainDay;
        const jumpResolved = resolveJump({
            preset: c.jumpPreset,
            candyValue: c.candyValue,
            customItems: c.customItems,
            baseHappy: state.apiData.maxHappy || 250,
            maxEnergy: state.apiData.maxEnergy || 150,
            factionCandyPct: c.bonuses.factionCandy
        });
        const usePreset = c.jumpPreset === 'choco' || c.jumpPreset === 'happy' || c.jumpPreset === 'custom';
        const presetPerDay = usePreset ? estimatePresetConsumablesPerDay(c.jumpPreset, jumpResolved.items, sessionsPerTrainDay) : null;
        const energyPerDay = usePreset ? null : estimateDailyConsumables(energyPerTrainDay, state.apiData.maxEnergy);
        const presetTotal = presetPerDay ? scaleConsumables(presetPerDay, trainingDays) : null;
        const energyTotal = energyPerDay ? scaleConsumables({ xanax: energyPerDay.xanax, refill: energyPerDay.refill }, trainingDays) : null;

        const dailyLine = usePreset
            ? formatPresetConsumablesLine(presetPerDay) || '(none)'
            : (formatConsumablesLine(energyPerDay) || 'free (within natural regen)');
        const totalLine = usePreset
            ? formatPresetConsumablesLine(presetTotal) || '(none)'
            : formatConsumablesLine({ xanax: energyTotal.xanax, refill: energyTotal.refill, fromRegen: 0 });

        const breachWarn = !usePreset && energyPerDay && energyPerDay.breachedCap;
        const presetBreach = usePreset && presetPerDay && presetPerDay.xanax > MAX_XANAX_PER_DAY;
        const skipped = c.jumpPreset === 'k99';

        return el('div', { class: 'tgc-info' },
            skipped
                ? el('span', {}, 'Cost estimate skipped for 99k Jump (mechanics are too situational).')
                : el('span', {},
                    el('strong', {}, 'Per training day: '), dailyLine, el('br'),
                    el('strong', {}, `Across ${trainingDays} days: `), totalLine || '(none)'
                ),
            breachWarn ? el('div', { class: 'tgc-warn-line' },
                `Daily energy exceeds the 3 xanax + 1 refill + natural regen cap by ${fmtInt(energyPerDay.overflow)}E. You'll need energy cans, JP specials, or other boosters too.`
            ) : null,
            presetBreach ? el('div', { class: 'tgc-warn-line' },
                `${presetPerDay.xanax} xanax/day exceeds the 3 xanax/day cap. Reduce sessions per day or stretch over more days.`
            ) : null
        );
    }

    const clone = v => {
        try { return JSON.parse(JSON.stringify(v)); }
        catch { return v; }
    };

    const Storage = {
        get(k, def) {
            try {
                const v = GM_getValue(k, null);
                return v == null ? def : JSON.parse(v);
            } catch { return def; }
        },
        set(k, v) {
            try { GM_setValue(k, JSON.stringify(v)); } catch {}
        },
        del(k) {
            try { GM_deleteValue(k); } catch {}
        }
    };

    function emptyStatMap(general = false) {
        const o = { strength: 0, defense: 0, speed: 0, dexterity: 0 };
        if (general) o.general = 0;
        return o;
    }

    function emptyParsedPerks() {
        return {
            education:        emptyStatMap(true),
            factionSteadfast: emptyStatMap(false),
            factionCandy: 0,
            property: emptyStatMap(true),
            job:      emptyStatMap(true),
            book:     emptyStatMap(true)
        };
    }

    const defaultState = {
        apiKey: '',
        currentTab: 'calc',
        apiData: {
            loaded: false,
            loadedAt: 0,
            gyms: null,
            stats: null,
            maxHappy: 99999,
            maxEnergy: 150,
            activeGym: null,
            unlockedGyms: null,
            parsedPerks: emptyParsedPerks()
        },
        calc: {
            stat: 'strength',
            statTotal: 1000000,
            happy: 99999,
            energy: 150,
            gymId: null,
            jumpPreset: 'none',
            candyValue: 100,
            customItems: {
                xanax: 0,
                edvd: 0,
                candy: 0,
                candyValue: 100,
                ecstasy: false,
                refill: false
            },
            bonuses: {
                property: 0,
                eduGeneral: 0,
                eduStat: 0,
                factionSteadfast: 0,
                factionCandy: 0,
                job: 0,
                book: 0
            }
        },
        planner: {
            days: 30,
            trainEvery: 1,
            sessionsPerTrainDay: 1
        },
        goal: {
            type: 'stat',
            statGoal: 5000000,
            percentGoal: 50,
            daysGoal: 90,
            trainEvery: 1,
            sessionsPerTrainDay: 1
        },
        balance: {
            mode: 'ratio',
            ratio: { strength: 25, defense: 25, speed: 25, dexterity: 25 },
            gym1: '',
            gym2: '',
            precision: 'precise'
        },
        ui: {}
    };

    function isPlainObject(v) {
        return v != null && typeof v === 'object' && !Array.isArray(v);
    }

    function mergeDeep(target, source) {
        if (!isPlainObject(source)) return target;
        if (!isPlainObject(target)) target = {};
        for (const k of Object.keys(source)) {
            const sv = source[k];
            if (isPlainObject(sv)) {
                target[k] = mergeDeep(isPlainObject(target[k]) ? target[k] : {}, sv);
            } else {
                target[k] = sv;
            }
        }
        return target;
    }

    function normalizeGyms(raw) {
        if (!raw) return {};
        const list = Array.isArray(raw) ? raw.map(g => [g && g.id, g]) : Object.entries(raw);
        const out = {};
        for (const [id, g] of list) {
            if (!g || id == null) continue;
            const m = g.modifiers;
            out[id] = m ? {
                name: g.name,
                energy: g.energy_cost,
                strength:  (m.strength  || 0) * 10,
                defense:   (m.defense   || 0) * 10,
                speed:     (m.speed     || 0) * 10,
                dexterity: (m.dexterity || 0) * 10
            } : g;
        }
        return out;
    }

    function migrateSavedState(saved) {
        if (!saved || !saved.apiData) return saved;
        if (saved.apiData.gyms) saved.apiData.gyms = normalizeGyms(saved.apiData.gyms);
        if (!saved.apiData.parsedPerks) return saved;
        const pp = saved.apiData.parsedPerks;
        for (const k of ['property', 'job', 'book']) {
            if (typeof pp[k] === 'number') {
                pp[k] = { strength: 0, defense: 0, speed: 0, dexterity: 0, general: pp[k] };
            }
        }
        return saved;
    }

    let state = mergeDeep(clone(defaultState), migrateSavedState(Storage.get(STORAGE_KEY, {})));
    const PDA_KEY_TOKEN = '###PDA-APIKEY###';
    const PDA_KEY = PDA_KEY_TOKEN.indexOf('PDA-APIKEY') === -1 ? PDA_KEY_TOKEN.trim() : '';
    if (!state.apiKey && PDA_KEY) state.apiKey = PDA_KEY;
    const persist = debounce(() => Storage.set(STORAGE_KEY, state), 200);

    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

    function el(tag, attrs = {}, ...children) {
        const node = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) {
            if (k === 'class') node.className = v;
            else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
            else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
            else if (k === 'dataset') Object.assign(node.dataset, v);
            else if (v === true) node.setAttribute(k, '');
            else if (v !== false && v != null) node.setAttribute(k, v);
        }
        for (const c of children.flat()) {
            if (c == null || c === false) continue;
            node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        }
        return node;
    }

    const round4 = x => Math.round(x * 10000) / 10000;

    function fmt(n) {
        if (!Number.isFinite(n)) return '-';
        if (Math.abs(n) < 100) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
        return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
    }
    function fmtBig(n) {
        if (!Number.isFinite(n)) return '-';
        const abs = Math.abs(n);
        if (abs >= 1e12) return (n / 1e12).toFixed(2) + 'T';
        if (abs >= 1e9)  return (n / 1e9 ).toFixed(2) + 'B';
        if (abs >= 1e6)  return (n / 1e6 ).toFixed(2) + 'M';
        if (abs >= 1e3)  return (n / 1e3 ).toFixed(2) + 'K';
        return fmt(n);
    }
    const fmtInt = n => Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '-';
    const fmtPct = n => (n >= 0 ? '+' : '') + n.toFixed(2) + '%';

    function debounce(fn, ms = 150) {
        let t;
        return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
    }

    function timeAgo(ts) {
        if (!ts) return 'never';
        const d = Math.floor((Date.now() - ts) / 1000);
        if (d < 60)    return d + 's ago';
        if (d < 3600)  return Math.floor(d / 60) + 'm ago';
        if (d < 86400) return Math.floor(d / 3600) + 'h ago';
        return Math.floor(d / 86400) + 'd ago';
    }

    function downsample(arr, max) {
        if (!arr || arr.length <= max) return arr;
        const step = Math.ceil(arr.length / max);
        const out = [];
        for (let i = 0; i < arr.length; i += step) out.push(arr[i]);
        if (out[out.length - 1] !== arr[arr.length - 1]) out.push(arr[arr.length - 1]);
        return out;
    }

    function httpGetText(url, headers = {}) {
        const pda = window.flutter_inappwebview;
        if (pda && typeof pda.callHandler === 'function') {
            return Promise.resolve(pda.callHandler('PDA_httpGet', url, headers)).then(r => {
                if (r == null) throw new Error('Network error');
                return typeof r === 'string' ? r : (r.responseText || '');
            });
        }
        return new Promise((resolve, reject) => GM_xmlhttpRequest({
            method: 'GET', url, headers, timeout: 15000,
            onload: r => resolve(r.responseText),
            onerror: () => reject(new Error('Network error')),
            ontimeout: () => reject(new Error('Request timed out'))
        }));
    }

    const api = {
        callTimes: [],
        canCall() {
            const cutoff = Date.now() - RATE_WINDOW_MS;
            this.callTimes = this.callTimes.filter(t => t > cutoff);
            return this.callTimes.length < RATE_LIMIT;
        },
        track() { this.callTimes.push(Date.now()); },
        async raw(path) {
            if (!state.apiKey) throw new Error('API key not set');
            if (!this.canCall()) throw new Error('Local rate limit hit, wait a moment');
            this.track();
            const url = `${API_BASE}${path}${path.includes('?') ? '&' : '?'}key=${encodeURIComponent(state.apiKey)}`;
            const text = await httpGetText(url);
            let d;
            try { d = JSON.parse(text); }
            catch (e) { throw new Error('Invalid API response'); }
            if (d && d.error) throw new Error('API: ' + (API_ERRORS[d.error.code] || d.error.error));
            return d;
        }
    };

    const API_ERRORS = {
        1: 'API key is empty',
        2: 'Incorrect API key, press Create API key in Setup to make one',
        5: 'Too many requests, wait a minute',
        8: 'IP temporarily blocked by Torn, try later',
        9: 'Torn API is disabled right now, try later',
        13: 'Key disabled, owner inactive for over 7 days',
        16: 'This key is missing permissions, press Create API key in Setup and use the new key',
        17: 'Torn backend error, try again',
        18: 'API key is paused'
    };

    function parsePerks(raw) {
        const out = emptyParsedPerks();

        const reStat     = /\+?\s*(\d+(?:\.\d+)?)\s*%\s+(strength|speed|dexterity|defense)\s+gym\s+gains?/i;
        const reGen      = /\+?\s*(\d+(?:\.\d+)?)\s*%\s+(?:to\s+)?(?:all\s+)?gym\s+gains?/i;
        const reBookStat = /(?:increases?\s+)?(strength|speed|dexterity|defense)\s+gym\s+gains?\s+by\s+(\d+(?:\.\d+)?)\s*%/i;
        const reBookGen  = /(?:increases?\s+)?(?:all\s+)?gym\s+gains?\s+by\s+(\d+(?:\.\d+)?)\s*%/i;
        const reCandy    = /(\d+(?:\.\d+)?)\s*%[^.\n]*?(?:candy|chocolate|sweet|effects?\s+of\s+candy)/i;

        const matchStat = perk => {
            const m1 = perk.match(reStat);
            if (m1) return { stat: m1[2].toLowerCase(), pct: parseFloat(m1[1]) };
            const m2 = perk.match(reBookStat);
            if (m2) return { stat: m2[1].toLowerCase(), pct: parseFloat(m2[2]) };
            return null;
        };
        const matchGen = perk => {
            if (matchStat(perk)) return 0;
            const m = perk.match(reGen) || perk.match(reBookGen);
            return m ? parseFloat(m[1]) : 0;
        };
        const matchCandy = perk => {
            const m = perk.match(reCandy);
            return m ? parseFloat(m[1]) : 0;
        };

        const distribute = (perkList, bucket) => {
            for (const p of perkList || []) {
                const s = matchStat(p);
                if (s) bucket[s.stat] += s.pct;
                else   bucket.general += matchGen(p);
            }
        };

        distribute(raw.education, out.education);
        distribute(raw.property,  out.property);
        distribute(raw.job,       out.job);
        distribute(raw.book,      out.book);

        for (const p of raw.faction || []) {
            const s = matchStat(p);
            if (s) out.factionSteadfast[s.stat] += s.pct;
            const c = matchCandy(p);
            if (c) out.factionCandy += c;
        }

        return out;
    }

    function calcGain({ S, H, G, E, stat, perks = [], includeRandom = false }) {
        const C = STAT_CONSTS[stat];
        if (!C) return 0;

        let Scap = S;
        if (S > 50000000) {
            Scap = 50000000 + 0.057406 * Math.pow(S - 50000000, 0.928996);
        }

        const innerLog = round4(Math.log(1 + H / 250));
        const happyMult = round4(1 + 0.07 * innerLog);
        const baseFromStat = Scap * happyMult;
        const happyPower = 8 * Math.pow(Math.max(0, H), 1.05);
        const highHappyAdj = (1 - Math.pow(Math.min(H, 99999) / 99999, 2)) * C.A;
        const random = includeRandom ? (Math.random() * 2 - 1) * C.C : 0;
        const inner = baseFromStat + happyPower + highHappyAdj + C.B + random;
        const base = (inner / 200000) * G * E;
        const perkMult = perks.reduce((acc, p) => acc * (1 + p), 1);
        return Math.max(0, base * perkMult);
    }

    function happyLossAvg(energyPerTrain) {
        return Math.round(0.1 * energyPerTrain * 5);
    }

    function simulateSession({ initialHappy, initialStat, energyBudget, gym, stat, perks, collectHistory = true }) {
        const E = gym && gym.energy;
        const G = gym ? gym.dots / 10 : 0;

        if (!E || E <= 0 || !Number.isFinite(E)) {
            return {
                totalGain: 0, trains: 0,
                finalHappy: initialHappy, finalStat: initialStat, energyLeft: energyBudget,
                energyHist: [0], cumGainHist: [0], happyHist: [initialHappy]
            };
        }

        let happy = initialHappy;
        let statTotal = initialStat;
        let energyLeft = energyBudget;

        let totalGain = 0;
        let trains = 0;
        const energyHist  = collectHistory ? [0] : null;
        const cumGainHist = collectHistory ? [0] : null;
        const happyHist   = collectHistory ? [happy] : null;

        while (energyLeft >= E) {
            const g = calcGain({ S: statTotal, H: happy, G, E, stat, perks });
            totalGain += g;
            statTotal += g;
            energyLeft -= E;
            happy = Math.max(0, happy - happyLossAvg(E));
            trains++;
            if (collectHistory) {
                energyHist.push(energyBudget - energyLeft);
                cumGainHist.push(totalGain);
                happyHist.push(happy);
            }
            if (trains > 200000) break;
        }
        return {
            totalGain, trains,
            finalHappy: happy, finalStat: statTotal, energyLeft,
            energyHist, cumGainHist, happyHist
        };
    }

    function resolveJump(ctx) {
        const { preset, candyValue, customItems, baseHappy, maxEnergy, factionCandyPct } = ctx;

        if (preset === 'k99') {
            return {
                items: { xanax: 0, edvd: 0, candy: 0, candyValue: 0, ecstasy: false, refill: true, stacked: 1000 },
                startHappy: 99999,
                startEnergy: 1000 + maxEnergy,
                summary: `99k Jump: stacked to 1000 energy + 1 refill (+${maxEnergy}E). Happy locked at 99,999.`
            };
        }

        let items;
        if (preset === 'choco') {
            items = { xanax: 1, edvd: 0, candy: 48, candyValue, ecstasy: true, refill: true };
        } else if (preset === 'happy') {
            items = { xanax: 4, edvd: 5, candy: 0, candyValue: 0, ecstasy: true, refill: true };
        } else if (preset === 'custom') {
            items = { ...customItems };
        } else {
            items = { xanax: 0, edvd: 0, candy: 0, candyValue: 0, ecstasy: false, refill: false };
        }

        let h = baseHappy;
        h += items.edvd * 2500;
        h += items.candy * items.candyValue * (1 + (factionCandyPct || 0) / 100);
        if (items.ecstasy) h *= 2;
        h = Math.min(h, 99999);

        let e;
        if (preset === 'none') {
            e = null;
        } else if (preset === 'happy') {
            e = 1000 + (items.refill ? maxEnergy : 0);
        } else {
            e = maxEnergy + (items.xanax * ENERGY_PER_XANAX) + (items.refill ? maxEnergy : 0);
        }

        let summary;
        if (preset === 'none') {
            summary = 'No jump. Energy and happy come from your direct inputs.';
        } else if (preset === 'choco') {
            summary = `Choco Jump: 48x ${candyValue}h candy, 1x xanax (+250E), 1x ecstasy (x2 happy), 1x refill (+${maxEnergy}E)`;
        } else if (preset === 'happy') {
            summary = `Happy Jump: 5x eDVD (+12500 happy), 4x xanax (1000E), 1x ecstasy (x2 happy), 1x refill (+${maxEnergy}E)`;
        } else {
            summary = `Custom: ${items.xanax}x xanax, ${items.edvd}x eDVD, ${items.candy}x ${items.candyValue}h candy${items.ecstasy ? ', ecstasy' : ''}${items.refill ? ', refill' : ''}`;
        }

        return { items, startHappy: h, startEnergy: e, summary };
    }

    function getActivePerks(c) {
        const list = [];
        for (const k of ['property', 'eduGeneral', 'eduStat', 'factionSteadfast', 'job', 'book']) {
            const v = c.bonuses[k] || 0;
            if (v) list.push(v / 100);
        }
        return list;
    }

    function getPerksForStat(stat) {
        const p = state.apiData.parsedPerks;
        const list = [];
        const values = [
            statBonusFor(p.property, stat),
            p.education.general || 0,
            p.education[stat] || 0,
            p.factionSteadfast[stat] || 0,
            statBonusFor(p.job, stat),
            statBonusFor(p.book, stat)
        ];
        for (const v of values) if (v) list.push(v / 100);
        return list;
    }

    function perkTotalPct(stat) {
        return getPerksForStat(stat).reduce((acc, v) => acc * (1 + v), 1);
    }

    function getActiveGym(c) {
        const gyms = state.apiData.gyms;
        if (!gyms) return null;
        const id = c.gymId;
        if (id == null || !gyms[id]) return null;
        const dots = gyms[id][c.stat] || 0;
        return { id, name: gyms[id].name, energy: gyms[id].energy, dots };
    }

    let unlockedGymIdsCache = null;

    function scanUnlockedGymIds() {
        if (unlockedGymIdsCache) return unlockedGymIdsCache;
        const ids = [];
        for (const btn of document.querySelectorAll('[class*="gymButton"]')) {
            const cls = btn.className || '';
            if (/(^|\s)(locked|inProgress)(___|\s|$)/.test(cls)) continue;
            const icon = btn.querySelector('[class*="gymIcon"]');
            const m = icon && (icon.className || '').match(/\bgym-(\d+)(?:___|\b)/);
            if (m) ids.push(parseInt(m[1], 10));
        }
        if (ids.length) unlockedGymIdsCache = ids;
        return ids.length ? ids : null;
    }

    function knownUnlockedIds() {
        const u = state.apiData.unlockedGyms;
        return Array.isArray(u) && u.length ? u : scanUnlockedGymIds();
    }

    function isGymUnlocked(id) {
        const ids = knownUnlockedIds();
        return !ids || ids.includes(parseInt(id, 10));
    }

    function buildGymPool(maxEnergyPerTrain) {
        const a = state.apiData;
        if (!a.gyms) return [];

        let source = 'api';
        let ids = Array.isArray(a.unlockedGyms) && a.unlockedGyms.length ? a.unlockedGyms : null;
        if (!ids) {
            source = 'page';
            ids = scanUnlockedGymIds();
        }
        if (!ids) {
            source = 'guess';
            const activeId = Math.min(parseInt(a.activeGym, 10) || 0, 24);
            ids = Object.keys(a.gyms).map(Number).filter(id => id <= activeId);
        }

        const seen = {};
        const all = ids.slice();
        for (const key of Object.keys(SPECIAL_GYM_IDS)) all.push(parseInt(key, 10));

        const pool = [];
        for (const id of all) {
            if (seen[id]) continue;
            seen[id] = true;
            const g = a.gyms[id];
            if (!g) continue;
            if (maxEnergyPerTrain && g.energy > maxEnergyPerTrain) continue;
            const dots = {};
            let best = 0;
            for (const s of STAT_ORDER) {
                dots[s] = g[s] || 0;
                if (dots[s] > best) best = dots[s];
            }
            if (best <= 0) continue;
            pool.push({ id, name: g.name, energy: g.energy, dots, specialKey: SPECIAL_GYM_IDS[id] || null });
        }
        pool.source = source;
        return pool;
    }

    function bestGymForStat(pool, stat, stats) {
        let best = null;
        for (const g of pool) {
            if (g.dots[stat] <= 0) continue;
            if (g.specialKey && !SPECIAL_GYMS[g.specialKey].check(stats)) continue;
            if (!best || g.dots[stat] > best.dots[stat]) best = g;
        }
        return best;
    }

    function buildUniformDays(items, dailyBudget, out) {
        const keys = [];
        const index = {};
        let totalEnergy = 0;
        for (const t of items) {
            const k = t.stat + '|' + t.gymId;
            if (index[k] === undefined) {
                index[k] = keys.length;
                keys.push({ energy: t.energy, items: [] });
            }
            keys[index[k]].items.push(t);
            totalEnergy += t.energy;
        }
        if (!keys.length) return;

        let numDays = Math.max(1, Math.ceil(totalEnergy / dailyBudget));
        let plan = null;
        for (let guard = 0; guard < 100000; guard++) {
            plan = keys.map(k => ({
                energy: k.energy,
                items: k.items,
                base: Math.floor(k.items.length / numDays),
                extra: k.items.length % numDays
            }));
            let fullest = 0;
            for (const p of plan) fullest += (p.base + (p.extra > 0 ? 1 : 0)) * p.energy;
            if (fullest <= dailyBudget) break;
            numDays++;
        }

        const taken = plan.map(() => 0);
        for (let d = 0; d < numDays; d++) {
            const day = { energy: 0, items: [] };
            for (let k = 0; k < plan.length; k++) {
                const p = plan[k];
                const n = p.base + (d < p.extra ? 1 : 0);
                for (let t = 0; t < n; t++) {
                    const item = p.items[taken[k]++];
                    if (!item) break;
                    day.items.push(item);
                    day.energy += item.energy;
                }
            }
            if (day.items.length) out.push(day);
        }
    }

    function packDays(queue, dailyBudget) {
        const days = [];
        let i = 0;
        while (i < queue.length) {
            const phase = queue[i].phase;
            let j = i;
            while (j < queue.length && queue[j].phase === phase) j++;
            buildUniformDays(queue.slice(i, j), dailyBudget, days);
            i = j;
        }
        return days;
    }

    function pickBestGymForStat(stat) {
        const gyms = state.apiData.gyms;
        if (!gyms) return null;
        let best = null, bestDots = 0;
        for (const [id, g] of Object.entries(gyms)) {
            if (!isGymUnlocked(id)) continue;
            const d = g[stat] || 0;
            if (d > bestDots) { bestDots = d; best = parseInt(id, 10); }
        }
        return best;
    }

    function statBonusFor(p, stat) {
        return (p.general || 0) + (p[stat] || 0);
    }

    function applyParsedBonuses() {
        const p = state.apiData.parsedPerks;
        const stat = state.calc.stat;
        const b = state.calc.bonuses;
        b.property         = statBonusFor(p.property, stat);
        b.eduGeneral       = p.education.general || 0;
        b.eduStat          = p.education[stat]   || 0;
        b.factionSteadfast = p.factionSteadfast[stat] || 0;
        b.factionCandy     = p.factionCandy;
        b.job              = statBonusFor(p.job, stat);
        b.book             = statBonusFor(p.book, stat);
    }

    function applyJumpPreset() {
        const c = state.calc;
        const j = resolveJump({
            preset: c.jumpPreset,
            candyValue: c.candyValue,
            customItems: c.customItems,
            baseHappy: state.apiData.maxHappy || 250,
            maxEnergy: state.apiData.maxEnergy || 150,
            factionCandyPct: c.bonuses.factionCandy
        });
        if (c.jumpPreset !== 'none') {
            c.happy = j.startHappy;
            if (j.startEnergy != null) c.energy = j.startEnergy;
        }
    }

    function applyApiData() {
        const a = state.apiData;
        if (!a.loaded) return;
        const c = state.calc;
        c.statTotal = a.stats[c.stat] || 0;
        c.happy = a.maxHappy;
        c.energy = a.maxEnergy;
        if (a.activeGym && a.gyms && a.gyms[a.activeGym] && (a.gyms[a.activeGym][c.stat] || 0) > 0) {
            c.gymId = parseInt(a.activeGym, 10);
        } else {
            c.gymId = pickBestGymForStat(c.stat);
        }
        applyParsedBonuses();
        applyJumpPreset();
    }

    function onStatChange(newStat) {
        if (state.calc.stat === newStat) return;
        state.calc.stat = newStat;
        if (state.apiData.loaded) {
            state.calc.statTotal = state.apiData.stats[newStat] || state.calc.statTotal;
            applyParsedBonuses();
        }
        const gyms = state.apiData.gyms;
        const g = gyms && state.calc.gymId != null ? gyms[state.calc.gymId] : null;
        if (!g || (g[newStat] || 0) === 0) {
            state.calc.gymId = pickBestGymForStat(newStat);
        }
        persist();
        renderTab();
    }

    function injectStyles() {
        if ($('#tgc-styles')) return;
        const css = `
        html.tgc-lock, html.tgc-lock body { overflow: hidden !important; }

        .tgc-launch,
        .tgc-overlay {
            --tgc-str: var(--default-red-color, #D83500);
            --tgc-def: var(--default-purple-color, #5f3dc4);
            --tgc-spd: var(--default-blue-color-new, #1864ab);
            --tgc-dex: var(--default-base-gold-color, #CC9900);
            --tgc-happy: var(--sidebar-happy-bar-border-color, #cac732);
            --tgc-good: var(--gym-green-color, #668c00);
            --tgc-warn: var(--default-orange-color, #E67700);
            --tgc-bad: var(--default-base-important-color, #AA0000);
            --tgc-text: var(--default-color, #333);
            --tgc-text-2: var(--default-full-text-6-color, #666);
            --tgc-muted: var(--default-base-grey1-color, #858585);
            --tgc-panel: var(--default-bg-panel-color, #f2f2f2);
            --tgc-panel-hi: var(--default-bg-panel-active-color, #fff);
            --tgc-line-dark: var(--default-panel-divider-outer-side-color, #ccc);
            --tgc-line-light: var(--default-panel-divider-inner-side-color, #fff);
            --tgc-page: var(--page-background-color, #ccc);
            --tgc-head: var(--title-black-gradient, linear-gradient(180deg, #555 0%, #333 100%));
            --tgc-title: linear-gradient(180deg, #fff 0%, #ddd 100%);
            --tgc-title-color: #333;
            --tgc-title-shadow: 0 1px 0 #fff;
            --tgc-title-border: #ccc;
            --tgc-shadow: 0 0 3px rgba(50, 50, 50, 0.3);
            --tgc-on-stat: #fff;
            --tgc-h: 26px;
            font: 12px/1.4 Arial, Helvetica, sans-serif;
            color: var(--tgc-text);
        }
        body.dark-mode .tgc-launch,
        body.dark-mode .tgc-overlay {
            --tgc-on-stat: #000;
            --tgc-title: linear-gradient(180deg, #666 0%, #444 100%);
            --tgc-title-color: #fff;
            --tgc-title-shadow: 0 0 2px #000;
            --tgc-title-border: #222;
            color-scheme: dark;
        }
        .tgc-launch *, .tgc-overlay *,
        .tgc-launch *::before, .tgc-overlay *::before,
        .tgc-launch *::after, .tgc-overlay *::after { box-sizing: border-box; }

        .tgc-launch {
            display: flex;
            align-items: center;
            gap: 10px;
            margin: 0 0 10px;
            padding: 6px 6px 6px 12px;
            background: var(--info-msg-bg-gradient, linear-gradient(to bottom, #fff 0%, #e4e4e4 100%));
            color: var(--info-msg-font-color, #666);
            border-radius: 5px;
            box-shadow: var(--tgc-shadow);
        }
        .tgc-launch-text { flex: 1; min-width: 0; }
        .tgc-launch-text b { color: var(--tgc-text); }
        .tgc-launch.floating { position: fixed; left: 12px; bottom: 12px; z-index: 99999; margin: 0; }
        .tgc-launch.floating .tgc-launch-long { display: none; }

        .tgc-overlay {
            position: fixed;
            inset: 0;
            z-index: 100000;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(0, 0, 0, 0.6);
        }
        .tgc-overlay[hidden] { display: none; }
        .tgc-window:focus { outline: none; }
        .tgc-window {
            display: flex;
            flex-direction: column;
            width: min(980px, calc(100vw - 40px));
            height: min(820px, calc(100vh - 60px));
            background: var(--tgc-page);
            border-radius: 5px;
            box-shadow: 0 0 12px rgba(0, 0, 0, 0.65);
            overflow: hidden;
        }

        .tgc-titlebar {
            display: flex;
            align-items: center;
            gap: 8px;
            height: 36px;
            padding: 0 6px 0 12px;
            background: var(--tgc-head);
            color: #fff;
            text-shadow: 0 0 2px #000;
            flex-shrink: 0;
        }
        .tgc-titlebar .tgc-heading {
            flex: 1;
            min-width: 0;
            margin: 0;
            padding: 0;
            color: inherit;
            font: 16px/36px "Fjalla One", Arial, sans-serif;
            text-transform: uppercase;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .tgc-sub { font-size: 11px; opacity: 0.7; white-space: nowrap; }
        .tgc-icon {
            display: grid;
            place-items: center;
            width: 30px;
            height: 30px;
            padding: 0;
            border: 0;
            border-radius: 5px;
            background: none;
            color: inherit;
            opacity: 0.75;
            cursor: pointer;
        }
        .tgc-icon:hover { opacity: 1; background: rgba(255, 255, 255, 0.08); }
        .tgc-icon:focus-visible { opacity: 1; outline: 1px solid currentColor; }
        .tgc-icon svg { width: 14px; height: 14px; fill: currentColor; filter: drop-shadow(0 0 2px #000); }

        .tgc-tabs {
            display: flex;
            height: 34px;
            flex-shrink: 0;
            background: var(--tabs-bg-gradient, linear-gradient(180deg, #fff 0%, #ddd 100%));
            border-bottom: 1px solid var(--tabs-border-bottom-color, #ccc);
        }
        .tgc-tab {
            flex: 1;
            min-width: 0;
            margin: 0;
            padding: 0 6px;
            border: 0;
            background: none;
            color: var(--tabs-color, #666);
            text-shadow: var(--tabs-text-shadow, 0 1px 0 #fff);
            font: bold 12px Arial, Helvetica, sans-serif;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            cursor: pointer;
        }
        .tgc-tab + .tgc-tab {
            border-left: 1px solid var(--tabs-divider-border-left-color, #ccc);
            box-shadow: inset 1px 0 0 var(--tabs-border-top-color, #fff);
        }
        .tgc-tab:hover { background: var(--tabs-hover-bg-gradient, linear-gradient(0deg, #eee 0%, #fff 100%)); }
        .tgc-tab.active {
            background: var(--tabs-active-bg-gradient, linear-gradient(180deg, #ddd 0%, #fff 100%));
            color: var(--default-tabs-active-color, #666);
            text-shadow: var(--default-tabs-active-text-shadow, 0 1px 0 #fff);
        }
        .tgc-tab:focus-visible { outline: 1px solid var(--tgc-good); outline-offset: -3px; }
        .tgc-tab-s { display: none; }

        .tgc-overlay {
            --tgc-scroll: #aaa;
            --tgc-scroll-hover: #888;
        }
        body.dark-mode .tgc-overlay {
            --tgc-scroll: #555;
            --tgc-scroll-hover: #777;
        }
        .tgc-overlay ::-webkit-scrollbar { width: 10px; height: 10px; }
        .tgc-overlay ::-webkit-scrollbar-track { background: transparent; }
        .tgc-overlay ::-webkit-scrollbar-corner { background: transparent; }
        .tgc-overlay ::-webkit-scrollbar-thumb {
            background: var(--tgc-scroll);
            background-clip: padding-box;
            border: 2px solid transparent;
            border-radius: 6px;
        }
        .tgc-overlay ::-webkit-scrollbar-thumb:hover { background-color: var(--tgc-scroll-hover); }
        @supports not selector(::-webkit-scrollbar) {
            .tgc-overlay * { scrollbar-width: thin; scrollbar-color: var(--tgc-scroll) transparent; }
        }
        .tgc-body {
            flex: 1 1 auto;
            min-height: 0;
            padding: 10px;
            overflow-x: hidden;
            overflow-y: auto;
            overscroll-behavior: contain;
            scrollbar-gutter: stable;
        }
        .tgc-status { min-height: 16px; margin: 0 0 8px; color: var(--tgc-muted); }
        .tgc-status.error { color: var(--tgc-bad); }
        .tgc-status.ok { color: var(--tgc-good); }
        .tgc-status.warn { color: var(--tgc-warn); }

        .tgc-cols {
            display: grid;
            grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
            gap: 10px;
            align-items: start;
        }
        .tgc-cols.even { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
        .tgc-cols > div { min-width: 0; }

        .tgc-section {
            margin-bottom: 10px;
            padding: 0 10px 10px;
            background: var(--tgc-panel);
            border-radius: 5px;
            box-shadow: var(--tgc-shadow);
        }
        .tgc-section:last-child { margin-bottom: 0; }
        .tgc-section-title {
            border-bottom: 1px solid var(--tgc-title-border);
            height: 30px;
            margin: 0 -10px 10px;
            padding: 0 10px;
            line-height: 30px;
            background: var(--tgc-title);
            color: var(--tgc-title-color);
            text-shadow: var(--tgc-title-shadow);
            font-weight: bold;
            border-radius: 5px 5px 0 0;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .tgc-section:has(> .tgc-section-title:only-child) { padding-bottom: 0; margin-bottom: 6px; }
        .tgc-section-title:only-child { margin-bottom: 0; border-radius: 5px; }

        .tgc-row {
            display: grid;
            grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
            gap: 8px 10px;
            margin-bottom: 8px;
        }
        .tgc-row:last-child { margin-bottom: 0; }
        .tgc-row.r1 { grid-template-columns: minmax(0, 1fr); }
        .tgc-row.r3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .tgc-row.r4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
        .tgc-field { display: flex; flex-direction: column; justify-content: flex-end; gap: 4px; min-width: 0; }
        .tgc-field label {
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            gap: 6px;
            color: var(--tgc-text);
        }
        .tgc-hint { color: var(--tgc-muted); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .tgc-field input,
        .tgc-field select {
            width: 100%;
            min-width: 0;
            height: var(--tgc-h);
            margin: 0;
            padding: 0 8px;
            border: 1px solid var(--input-border-color, #ccc);
            border-radius: 5px;
            background: var(--input-background-color, #fff);
            color: var(--input-color, #000);
            font: 12px Arial, Helvetica, sans-serif;
            -moz-appearance: textfield;
        }
        .tgc-field select option {
            background-color: var(--tgc-panel);
            color: var(--tgc-text);
        }
        .tgc-field input::-webkit-outer-spin-button,
        .tgc-field input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        .tgc-field input:hover,
        .tgc-field select:hover {
            border-color: var(--input-hover-border-color, #999);
            box-shadow: var(--input-hover-box-shadow, none);
        }
        .tgc-field input:focus,
        .tgc-field select:focus {
            outline: none;
            border-color: var(--default-blue-color, #069);
            box-shadow: var(--input-focus-box-shadow, none);
        }
        .tgc-field-checkbox {
            display: flex;
            align-items: center;
            gap: 8px;
            min-height: var(--tgc-h);
            color: var(--tgc-text);
            cursor: pointer;
            user-select: none;
            -webkit-user-select: none;
        }
        .tgc-field-checkbox input {
            flex-shrink: 0;
            width: 16px;
            height: 16px;
            margin: 0;
            border: 1px solid var(--input-border-color, #ccc);
            border-radius: 3px;
            background: var(--input-background-color, #fff);
            -webkit-appearance: none;
            appearance: none;
            cursor: pointer;
        }
        .tgc-field-checkbox:hover input { border-color: var(--input-hover-border-color, #999); }
        .tgc-field-checkbox input:checked {
            border-color: var(--tgc-good);
            background: var(--tgc-good) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 6.5 5 9l4.5-6' fill='none' stroke='%23fff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / 12px no-repeat;
        }
        body.dark-mode .tgc-field-checkbox input:checked { background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 6.5 5 9l4.5-6' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"); }
        .tgc-field-checkbox input:focus-visible { outline: 1px solid var(--tgc-good); outline-offset: 2px; }

        .tgc-num { display: flex; min-width: 0; }
        .tgc-field .tgc-num input { flex: 1; min-width: 0; border-radius: 0; text-align: center; }
        .tgc-step {
            flex: 0 0 24px;
            height: var(--tgc-h);
            margin: 0;
            padding: 0;
            border: var(--btn-border, 1px solid #aaa);
            background: var(--btn-background, linear-gradient(180deg, #DEDEDE 0%, #F7F7F7 25%, #CFCFCF 60%, #E7E7E7 78%, #D9D9D9 100%));
            color: var(--btn-color, #555);
            text-shadow: var(--btn-text-shadow, 0 1px 0 #FFFFFF40);
            font: bold 14px/1 Arial, Helvetica, sans-serif;
            cursor: pointer;
            user-select: none;
            -webkit-user-select: none;
            -webkit-touch-callout: none;
            touch-action: none;
        }
        .tgc-step:first-child { border-right: 0; border-radius: 5px 0 0 5px; }
        .tgc-step:last-child { border-left: 0; border-radius: 0 5px 5px 0; }
        .tgc-step:hover {
            background: var(--btn-hover-background, linear-gradient(180deg, #CCC 0%, #FFF 25%, #BBB 60%, #EEE 78%, #BBB 100%));
            color: var(--btn-hover-color, #444);
        }
        .tgc-step:active { background: var(--btn-active-background, linear-gradient(180deg, #c4c4c4 0%, #e9e9e9 100%)); }

        .tgc-select { position: relative; min-width: 0; }
        .tgc-select-btn {
            display: flex;
            align-items: center;
            gap: 8px;
            width: 100%;
            height: var(--tgc-h);
            margin: 0;
            padding: 0 10px 0 8px;
            border: 1px solid var(--input-border-color, #ccc);
            border-radius: 5px;
            background: var(--input-background-color, #fff);
            color: var(--input-color, #000);
            font: 12px Arial, Helvetica, sans-serif;
            text-align: left;
            cursor: pointer;
        }
        .tgc-select-btn:hover { border-color: var(--input-hover-border-color, #999); box-shadow: var(--input-hover-box-shadow, none); }
        .tgc-select-btn:focus-visible,
        .tgc-select-btn[aria-expanded="true"] { outline: none; border-color: var(--default-blue-color, #069); }
        .tgc-select-btn:disabled { opacity: 0.6; cursor: default; }
        .tgc-select-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .tgc-chev {
            flex-shrink: 0;
            border-top: 5px solid currentColor;
            border-left: 4px solid transparent;
            border-right: 4px solid transparent;
            opacity: 0.7;
            transition: transform 150ms ease;
        }
        .tgc-select-btn[aria-expanded="true"] .tgc-chev { transform: rotate(180deg); }
        .tgc-select-list {
            position: fixed;
            z-index: 2;
            padding: 3px 0;
            overflow-y: auto;
            background: var(--tgc-panel);
            color: var(--tgc-text);
            border: 1px solid var(--input-border-color, #ccc);
            border-radius: 5px;
            box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
            font: 12px Arial, Helvetica, sans-serif;
        }
        .tgc-select-opt { padding: 7px 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
        .tgc-select-opt.active { background: var(--tgc-panel-hi); }
        .tgc-select-opt.selected { color: var(--tgc-good); font-weight: bold; }

        .tgc-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            height: var(--tgc-h);
            padding: 0 12px;
            border: var(--btn-border, 1px solid #aaa);
            border-radius: 5px;
            background: var(--btn-background, linear-gradient(180deg, #DEDEDE 0%, #F7F7F7 25%, #CFCFCF 60%, #E7E7E7 78%, #D9D9D9 100%));
            color: var(--btn-color, #555);
            text-shadow: var(--btn-text-shadow, 0 1px 0 #FFFFFF40);
            font: 14px "Fjalla One", Arial, serif;
            text-transform: uppercase;
            text-decoration: none;
            white-space: nowrap;
            cursor: pointer;
        }
        .tgc-btn:hover,
        .tgc-btn:focus-visible {
            outline: none;
            border: var(--btn-hover-border, 1px solid #999);
            background: var(--btn-hover-background, linear-gradient(180deg, #CCC 0%, #FFF 25%, #BBB 60%, #EEE 78%, #BBB 100%));
            color: var(--btn-hover-color, #444);
            text-shadow: var(--btn-hover-text-shadow, 0 0 5px #FFF);
        }
        .tgc-btn:active {
            background: var(--btn-active-background, linear-gradient(180deg, #c4c4c4 0%, #e9e9e9 100%));
            color: var(--btn-active-color, #444);
            box-shadow: var(--btn-active-box-shadow, none);
        }
        .tgc-btn:disabled {
            background: var(--btn-disable-background, linear-gradient(180deg, #c4c4c4 0%, #e9e9e9 100%));
            color: var(--btn-disable-color, #aaa);
            cursor: default;
        }
        .tgc-btn.full { width: 100%; margin-bottom: 10px; }
        .tgc-btn.tiny { height: 22px; padding: 0 8px; font-size: 12px; }

        .tgc-stat-pills {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 6px;
            margin-bottom: 10px;
        }
        .tgc-stat-pill {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 1px;
            height: 46px;
            min-width: 0;
            padding: 0 4px 3px;
            border: 0;
            border-radius: 5px;
            background: linear-gradient(180deg, #666 0%, #333 100%);
            box-shadow: inset 0 -3px 0 var(--pill-c);
            color: #fff;
            text-shadow: 0 0 2px #000;
            font: 14px "Fjalla One", Arial, serif;
            text-transform: uppercase;
            cursor: pointer;
            overflow: hidden;
        }
        .tgc-stat-pill:hover { background: linear-gradient(180deg, #777 0%, #444 100%); }
        .tgc-stat-pill:focus-visible { outline: 1px solid var(--tgc-good); outline-offset: 1px; }
        .tgc-stat-pill.active {
            background: color-mix(in srgb, var(--pill-c) 22%, var(--tgc-panel));
            box-shadow: inset 0 0 0 2px var(--pill-c);
            color: var(--tgc-text);
            text-shadow: none;
        }
        .tgc-stat-pill[data-stat="strength"]  { --pill-c: var(--tgc-str); }
        .tgc-stat-pill[data-stat="defense"]   { --pill-c: var(--tgc-def); }
        .tgc-stat-pill[data-stat="speed"]     { --pill-c: var(--tgc-spd); }
        .tgc-stat-pill[data-stat="dexterity"] { --pill-c: var(--tgc-dex); }
        .tgc-pill-val { font: bold 12px Arial, Helvetica, sans-serif; text-transform: none; opacity: 0.85; }

        .tgc-segmented {
            display: flex;
            height: 28px;
            border-radius: 5px;
            overflow: hidden;
            background: var(--tabs-bg-gradient, linear-gradient(180deg, #fff 0%, #ddd 100%));
            box-shadow: 0 0 0 1px var(--tabs-border-bottom-color, #ccc);
        }
        .tgc-segmented button {
            flex: 1;
            min-width: 0;
            padding: 0 6px;
            border: 0;
            background: none;
            color: var(--tabs-color, #666);
            text-shadow: var(--tabs-text-shadow, 0 1px 0 #fff);
            font: bold 12px Arial, Helvetica, sans-serif;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            cursor: pointer;
        }
        .tgc-segmented button + button {
            border-left: 1px solid var(--tabs-divider-border-left-color, #ccc);
            box-shadow: inset 1px 0 0 var(--tabs-border-top-color, #fff);
        }
        .tgc-segmented button:hover { background: var(--tabs-hover-bg-gradient, linear-gradient(0deg, #eee 0%, #fff 100%)); }
        .tgc-segmented button.active {
            background: var(--tabs-active-bg-gradient, linear-gradient(180deg, #ddd 0%, #fff 100%));
            color: var(--default-tabs-active-color, #666);
            box-shadow: inset 0 -2px 0 var(--tgc-good);
        }

        .tgc-result {
            margin-bottom: 10px;
            background: var(--tgc-panel);
            border-radius: 5px;
            box-shadow: var(--tgc-shadow);
            overflow: hidden;
        }
        .tgc-result > .tgc-info {
            margin: 0;
            padding: 8px 12px;
            background: none;
            border-top: 1px solid var(--tgc-line-dark);
            border-radius: 0;
            box-shadow: none;
        }
        .tgc-result > .tgc-info.warn { box-shadow: inset 3px 0 0 var(--tgc-warn); }
        .tgc-result-grid {
            display: grid;
            grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
            gap: 1px;
            background: var(--tgc-line-dark);
        }
        .tgc-stat-readout {
            display: flex;
            flex-direction: column;
            gap: 2px;
            min-width: 0;
            padding: 10px 12px;
            background: var(--tgc-panel);
        }
        .tgc-result-grid.wide { grid-template-columns: repeat(4, minmax(0, 1fr)); }
        .tgc-bd-value { color: var(--tgc-text); font: 22px/1.1 "Fjalla One", Arial, serif; word-break: break-word; }
        .tgc-bd .tgc-hint { margin-bottom: 6px; }
        .tgc-bd-row {
            display: flex;
            justify-content: space-between;
            gap: 8px;
            padding: 4px 0;
            border-top: 1px solid var(--tgc-line-dark);
            font-size: 12px;
        }
        .tgc-bd-row span { color: var(--tgc-muted); flex: none; }
        .tgc-bd-row strong { min-width: 0; text-align: right; overflow-wrap: anywhere; }
        .tgc-r-label { color: var(--tgc-muted); font-size: 11px; text-transform: uppercase; }
        .tgc-r-value {
            color: var(--tgc-good);
            font: 26px/1.1 "Fjalla One", Arial, serif;
            word-break: break-word;
        }
        .tgc-r-value.small { color: var(--tgc-text); font-size: 19px; }
        .tgc-r-sub { color: var(--tgc-text-2); font-size: 11px; }

        .tgc-info {
            margin-bottom: 10px;
            padding: 8px 10px;
            background: var(--info-msg-bg-gradient, linear-gradient(to bottom, #fff 0%, #e4e4e4 100%));
            color: var(--info-msg-font-color, #666);
            border-radius: 5px;
            box-shadow: var(--tgc-shadow);
            line-height: 1.5;
        }
        .tgc-info:last-child { margin-bottom: 0; }
        .tgc-section .tgc-info,
        .tgc-collapsible-body .tgc-info {
            margin: 10px 0 0;
            padding: 8px 0 0;
            background: none;
            color: var(--tgc-text-2);
            border-top: 1px solid var(--tgc-line-dark);
            border-radius: 0;
            box-shadow: none;
        }
        .tgc-section .tgc-section-title + .tgc-info {
            margin: 0 0 10px;
            padding: 0;
            border-top: 0;
        }
        .tgc-info strong { color: var(--tgc-text); }
        .tgc-info.warn { box-shadow: inset 3px 0 0 var(--tgc-warn), var(--tgc-shadow); }
        .tgc-info.ok { box-shadow: inset 3px 0 0 var(--tgc-good), var(--tgc-shadow); }
        .tgc-warn-line { margin-top: 4px; color: var(--tgc-warn); }

        .tgc-collapsible {
            margin-bottom: 10px;
            background: var(--tgc-panel);
            border-radius: 5px;
            box-shadow: var(--tgc-shadow);
            overflow: hidden;
        }
        .tgc-collapsible-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            width: 100%;
            height: 30px;
            padding: 0 10px;
            border: 0;
            border-bottom: 1px solid var(--tgc-title-border);
            background: var(--tgc-title);
            color: var(--tgc-title-color);
            text-shadow: var(--tgc-title-shadow);
            font: bold 12px Arial, Helvetica, sans-serif;
            cursor: pointer;
        }
        .tgc-collapsible-head:focus-visible { outline: 1px solid var(--tgc-good); outline-offset: -2px; }
        .tgc-caret { font-size: 10px; transition: transform 150ms ease; }
        .tgc-collapsible.open .tgc-caret { transform: rotate(90deg); }
        .tgc-collapsible-body { display: none; padding: 10px; }
        .tgc-collapsible.open .tgc-collapsible-body { display: block; }
        .tgc-bonus-toolbar { display: flex; justify-content: flex-end; margin-bottom: 8px; }
        .tgc-jump-summary { margin-top: 8px; color: var(--tgc-text-2); font-size: 11px; line-height: 1.5; }

        .tgc-tscroll {
            margin-bottom: 10px;
            border-radius: 5px;
            box-shadow: var(--tgc-shadow);
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
        }
        .tgc-overlay .tgc-table {
            width: 100%;
            border-collapse: collapse;
            background: var(--tgc-panel);
            color: var(--tgc-text);
            font-size: 12px;
        }
        .tgc-overlay .tgc-table th {
            border-bottom: 1px solid var(--tgc-title-border);
            vertical-align: middle;
            line-height: 30px;
            height: 30px;
            padding: 0 10px;
            background: var(--tgc-title);
            color: var(--tgc-title-color);
            text-shadow: var(--tgc-title-shadow);
            font-weight: bold;
            text-align: left;
            white-space: nowrap;
        }
        .tgc-overlay .tgc-table td {
            height: auto;
            max-width: none;
            padding: 7px 10px;
            color: var(--tgc-text);
            background: none;
            font: 12px/1.4 Arial, Helvetica, sans-serif;
            vertical-align: middle;
            border-top: 1px solid var(--tgc-line-light);
            border-bottom: 1px solid var(--tgc-line-dark);
            white-space: nowrap;
        }
        .tgc-overlay .tgc-table td:not(.num):not(.num-d) { white-space: normal; min-width: 70px; }
        .tgc-overlay .tgc-table tr:first-child td { border-top: 0; }
        .tgc-overlay .tgc-table tr:last-child td { border-bottom: 0; }
        .tgc-overlay .tgc-table tbody tr:hover td { background: var(--tgc-panel-hi); }
        .tgc-overlay .tgc-table .num, .tgc-overlay .tgc-table .num-d { text-align: right; }
        .tgc-overlay .tgc-table td.num { color: var(--tgc-good); font-weight: bold; }
        .tgc-overlay .tgc-table .winner td { background: color-mix(in srgb, var(--tgc-good) 14%, var(--tgc-panel)); }
        .tgc-overlay .tgc-table.tgc-kv { border-radius: 5px; box-shadow: var(--tgc-shadow); }
        .tgc-overlay .tgc-table.tgc-kv td { white-space: normal; overflow-wrap: anywhere; vertical-align: top; }
        .tgc-overlay .tgc-table.tgc-kv td:first-child { width: 42%; color: var(--tgc-text-2); }

        .tgc-ratio-bar {
            display: flex;
            gap: 2px;
            height: 10px;
            margin: 4px 0 10px;
            border-radius: 5px;
            overflow: hidden;
            background: var(--progressbar-bg-linear-gradient, #ccc);
        }
        .tgc-ratio-bar span { display: block; transition: flex 300ms ease; }
        .tgc-ratio-label { margin-bottom: 3px; color: var(--tgc-muted); font-size: 11px; }

        .tgc-gym-picker {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 6px;
        }
        .tgc-gym-pill {
            padding: 8px 6px 10px;
            border: 0;
            border-radius: 5px;
            background: var(--gym-button-gradient, linear-gradient(180deg, #fff 0%, #e4e4e4));
            box-shadow: 0 0 3px rgba(0, 0, 0, 0.2), inset 0 -3px 0 var(--gym-specialist-bottom-line-bg-color, #f5e8c2);
            color: var(--gym-name-font-color, #444);
            font: bold 12px Arial, Helvetica, sans-serif;
            text-align: center;
            cursor: pointer;
        }
        .tgc-gym-pill:hover { background: var(--gym-button-hover-bg, #fff); }
        .tgc-gym-pill:focus-visible { outline: 1px solid var(--tgc-good); }
        .tgc-gym-pill.active {
            background: var(--gym-active-button-bg, linear-gradient(180deg, #fafeec 0%, #e2e6d4));
            box-shadow: var(--gym-active-button-box-shadow, inset 0 0 0 1px #a9e34b);
        }
        .tgc-gym-pill.locked {
            background: var(--gym-button-locked-gradient, linear-gradient(180deg, #d5d5d5 0%, #dbdbdb));
            opacity: 0.55;
            cursor: not-allowed;
        }
        .tgc-pill-e { display: block; margin-top: 2px; color: var(--gym-class-font-color, #888); font-weight: normal; font-size: 11px; }

        .tgc-balance-day {
            margin-bottom: 6px;
            background: var(--tgc-panel);
            border-radius: 5px;
            box-shadow: var(--tgc-shadow);
            overflow: hidden;
        }
        .tgc-balance-day-head {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: space-between;
            gap: 2px 10px;
            min-height: 30px;
            padding: 4px 10px;
            border-bottom: 1px solid var(--tgc-title-border);
            background: var(--tgc-title);
            color: var(--tgc-title-color);
            text-shadow: var(--tgc-title-shadow);
        }
        .tgc-day-label { font: 14px "Fjalla One", Arial, serif; text-transform: uppercase; }
        .tgc-balance-day-body { display: flex; flex-direction: column; padding: 2px 10px; }
        .tgc-balance-train-row {
            display: grid;
            grid-template-columns: auto minmax(0, 1fr) auto;
            align-items: center;
            gap: 4px 10px;
            padding: 6px 0;
            border-bottom: 1px solid var(--tgc-line-dark);
            box-shadow: 0 1px 0 var(--tgc-line-light);
        }
        .tgc-balance-train-row:last-child { border-bottom: 0; box-shadow: none; }
        .tgc-btn-stat {
            min-width: 38px;
            padding: 2px 5px;
            border-radius: 3px;
            color: var(--tgc-on-stat);
            font: bold 11px Arial, Helvetica, sans-serif;
            text-align: center;
        }
        .tgc-train-detail { min-width: 0; color: var(--tgc-text-2); overflow-wrap: anywhere; }
        .tgc-train-gym { white-space: nowrap; }
        .tgc-train-gain { color: var(--tgc-good); font-weight: bold; white-space: nowrap; }

        .tgc-github-btn { display: inline-flex; align-items: center; gap: 6px; color: var(--default-blue-color, #069); text-decoration: none; line-height: 16px; }
        .tgc-github-btn:hover { text-decoration: underline; }
        .tgc-github-btn svg { display: block; flex-shrink: 0; width: 14px; height: 14px; fill: currentColor; }
        .tgc-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin-top: 10px; }

        .tgc-chart {
            margin-bottom: 10px;
            padding: 8px 10px 6px;
            background: var(--tgc-panel);
            border-radius: 5px;
            box-shadow: var(--tgc-shadow);
        }
        .tgc-legend { display: flex; flex-wrap: wrap; gap: 4px 16px; min-height: 18px; margin-bottom: 4px; }
        .tgc-legend button {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 0;
            border: 0;
            background: none;
            color: var(--tgc-text);
            font: 12px Arial, Helvetica, sans-serif;
            cursor: pointer;
        }
        .tgc-legend button.off { opacity: 0.4; text-decoration: line-through; }
        .tgc-legend button:focus-visible { outline: 1px solid var(--tgc-good); }
        .tgc-legend i { display: inline-block; width: 18px; border-top: 3px solid; border-radius: 2px; }
        .tgc-legend .dash i { border-top-style: dashed; border-top-width: 2px; }
        .tgc-chart:empty { display: none; }
        .tgc-plot { position: relative; height: 260px; touch-action: pan-y; }
        .tgc-chart.tall .tgc-plot { height: 320px; }
        .tgc-plot svg { display: block; overflow: visible; }
        .tgc-grid { stroke: var(--tgc-line-dark); shape-rendering: crispEdges; }
        .tgc-axis { stroke: var(--tgc-muted); shape-rendering: crispEdges; }
        .tgc-axis-text { fill: var(--tgc-muted); font: 10px Arial, Helvetica, sans-serif; }
        .tgc-axis-title { fill: var(--tgc-text-2); font: 11px Arial, Helvetica, sans-serif; }
        .tgc-cross { stroke: var(--tgc-text-2); stroke-dasharray: 3 3; shape-rendering: crispEdges; }
        .tgc-dot { stroke: var(--tgc-panel); stroke-width: 2; }
        .tgc-tip {
            position: absolute;
            top: 0;
            left: 0;
            z-index: 2;
            min-width: 130px;
            padding: 6px 8px;
            background: var(--tooltip-bg-color, #f2f2f2);
            color: var(--tgc-text);
            border: 1px solid var(--tooltip-border-color, rgba(85, 85, 85, 0.12));
            border-radius: 5px;
            box-shadow: var(--tooltip-shadow, 0 0 8px rgba(0, 0, 0, 0.3));
            white-space: nowrap;
            pointer-events: none;
        }
        .tgc-tip b { display: block; margin-bottom: 3px; }
        .tgc-tip div { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .tgc-tip i { display: inline-block; width: 8px; height: 8px; margin-right: 5px; border-radius: 50%; }

        @media (max-width: 784px) {
            .tgc-overlay { --tgc-h: 36px; align-items: stretch; background: var(--tgc-page); }
            .tgc-launch { --tgc-h: 34px; }
            .tgc-launch-long { display: none; }
            .tgc-window { width: 100%; height: 100vh; height: 100dvh; border-radius: 0; box-shadow: none; }
            .tgc-titlebar { height: calc(46px + env(safe-area-inset-top, 0px)); padding-top: env(safe-area-inset-top, 0px); }
            .tgc-titlebar .tgc-heading { font-size: 18px; line-height: 46px; }
            .tgc-sub { display: none; }
            .tgc-icon { width: 40px; height: 40px; }
            .tgc-icon svg { width: 16px; height: 16px; }
            .tgc-tabs { height: 46px; }
            .tgc-tab { padding: 0 2px; font-size: 12px; }
            .tgc-tab.active { box-shadow: inset 0 -3px 0 var(--tgc-good); }
            .tgc-tab-l { display: none; }
            .tgc-tab-s { display: inline; }
            .tgc-body { padding: 8px 8px calc(8px + env(safe-area-inset-bottom, 0px)); }
            .tgc-cols, .tgc-cols.even { display: flex; flex-direction: column; align-items: stretch; gap: 0; }
            .tgc-cols > div { display: contents; }
            .tgc-cols .tgc-section:last-child,
            .tgc-cols .tgc-info:last-child { margin-bottom: 10px; }
            .tgc-cols.calc > div > .tgc-collapsible,
            .tgc-cols.calc > div > .tgc-btn { order: 1; }
            .tgc-row.r4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
            .tgc-row.r3 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
            .tgc-row.r3 > :first-child { grid-column: 1 / -1; }
            .tgc-field input, .tgc-field select { font-size: 16px; }
            .tgc-btn { font-size: 15px; }
            .tgc-btn.tiny { height: 30px; font-size: 13px; }
            .tgc-stat-pills { grid-template-columns: repeat(2, minmax(0, 1fr)); }
            .tgc-stat-pill { height: 50px; font-size: 15px; }
            .tgc-segmented { height: 38px; }
            .tgc-gym-picker { grid-template-columns: repeat(2, minmax(0, 1fr)); }
            .tgc-gym-pill { padding: 10px 6px 12px; }
            .tgc-plot, .tgc-chart.tall .tgc-plot { height: 210px; }
            .tgc-result-grid.wide { grid-template-columns: repeat(2, minmax(0, 1fr)); }
            .tgc-step { flex-basis: 36px; font-size: 18px; }
            .tgc-select-btn { font-size: 16px; }
            .tgc-select-opt { padding: 11px 12px; font-size: 15px; }
            .tgc-field-checkbox input { width: 20px; height: 20px; }
            .tgc-field-checkbox input:checked { background-size: 15px; }
            .tgc-r-value { font-size: 22px; }
            .tgc-r-value.small { font-size: 17px; }
            .tgc-stat-readout { padding: 8px 10px; }
            .tgc-legend button { min-height: 28px; }

            .tgc-tscroll { overflow: visible; box-shadow: none; border-radius: 0; }
            .tgc-overlay .tgc-table.tgc-cards { background: none; }
            .tgc-overlay .tgc-table.tgc-cards thead { display: none; }
            .tgc-overlay .tgc-table.tgc-cards tbody { display: block; }
            .tgc-overlay .tgc-table.tgc-cards tr {
                display: grid;
                grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
                gap: 2px 14px;
                margin-bottom: 6px;
                padding: 8px 10px;
                background: var(--tgc-panel);
                border-radius: 5px;
                box-shadow: var(--tgc-shadow);
            }
            .tgc-overlay .tgc-table.tgc-cards td {
                display: flex;
                justify-content: space-between;
                gap: 8px;
                padding: 3px 0;
                border: 0;
                background: none !important;
                white-space: normal;
                text-align: right;
            }
            .tgc-overlay .tgc-table.tgc-cards td::before { content: attr(data-label); color: var(--tgc-muted); font-weight: normal; text-align: left; }
            .tgc-overlay .tgc-table.tgc-cards td:first-child {
                grid-column: 1 / -1;
                justify-content: flex-start;
                margin-bottom: 2px;
                padding-bottom: 5px;
                border-bottom: 1px solid var(--tgc-line-dark);
                font: 15px "Fjalla One", Arial, serif;
                text-transform: uppercase;
            }
            .tgc-overlay .tgc-table.tgc-cards td:first-child::before { content: none; }
            .tgc-overlay .tgc-table.tgc-cards tr.winner { box-shadow: inset 3px 0 0 var(--tgc-good), var(--tgc-shadow); }
        }
        `;
        const style = el('style', { id: 'tgc-styles' });
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
    }

    let overlayEl, bodyEl, statusEl, tabsEl, closeBtnEl, lastFocus = null;
    let renderGen = 0;

    const TABS = [
        { id: 'calc',     label: 'Calculator', short: 'Calc'    },
        { id: 'planner',  label: 'Multi-day',  short: 'Days'    },
        { id: 'goal',     label: 'Goal',       short: 'Goal'    },
        { id: 'balance',  label: 'Balance',    short: 'Balance' },
        { id: 'compare',  label: 'Gyms',       short: 'Gyms'    },
        { id: 'settings', label: 'Setup',      short: 'Setup'   }
    ];
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const ICON_CLOSE = 'M3.3 2 8 6.7 12.7 2 14 3.3 9.3 8 14 12.7 12.7 14 8 9.3 3.3 14 2 12.7 6.7 8 2 3.3z';
    const ICON_RELOAD = 'M13.7 2.3v4.5H9.2l1.7-1.7A4.4 4.4 0 1 0 12.4 9h1.7a6 6 0 1 1-2-5.5z';

    function svgIcon(d) {
        const s = document.createElementNS(SVG_NS, 'svg');
        s.setAttribute('viewBox', '0 0 16 16');
        s.setAttribute('aria-hidden', 'true');
        const p = document.createElementNS(SVG_NS, 'path');
        p.setAttribute('d', d);
        s.appendChild(p);
        return s;
    }

    function buildModal() {
        statusEl = el('div', { class: 'tgc-status', role: 'status' });
        tabsEl = el('nav', { class: 'tgc-tabs', role: 'tablist' });
        for (const t of TABS) {
            tabsEl.appendChild(el('button', {
                type: 'button',
                role: 'tab',
                class: 'tgc-tab' + (state.currentTab === t.id ? ' active' : ''),
                'aria-selected': String(state.currentTab === t.id),
                dataset: { tab: t.id },
                onclick: () => setTab(t.id)
            }, el('span', { class: 'tgc-tab-l' }, t.label), el('span', { class: 'tgc-tab-s' }, t.short)));
        }
        closeBtnEl = el('button', { type: 'button', class: 'tgc-icon', title: 'Close', 'aria-label': 'Close', onclick: closeModal }, svgIcon(ICON_CLOSE));
        const titlebar = el('div', { class: 'tgc-titlebar' },
            el('div', { id: 'tgc-title', class: 'tgc-heading', role: 'heading', 'aria-level': '2' }, 'Gym Gains Calculator+'),
            el('span', { class: 'tgc-sub' }, 'Vladar formula'),
            el('button', { type: 'button', class: 'tgc-icon', title: 'Reload from API', 'aria-label': 'Reload from API', onclick: () => loadFromApi() }, svgIcon(ICON_RELOAD)),
            closeBtnEl
        );
        bodyEl = el('div', { class: 'tgc-body' });
        const win = el('div', { class: 'tgc-window', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tgc-title', tabindex: '-1' }, titlebar, tabsEl, bodyEl);
        overlayEl = el('div', { class: 'tgc-overlay', id: 'tgc-overlay' }, win);
        overlayEl.hidden = true;
        overlayEl.addEventListener('pointerdown', e => { if (e.target === overlayEl) closeModal(); });
        return overlayEl;
    }

    function openModal() {
        if (!overlayEl.hidden) return;
        lastFocus = document.activeElement;
        overlayEl.hidden = false;
        document.documentElement.classList.add('tgc-lock');
        renderTab();
        overlayEl.firstChild.focus();
    }

    function closeModal() {
        if (overlayEl.hidden) return;
        overlayEl.hidden = true;
        document.documentElement.classList.remove('tgc-lock');
        renderGen++;
        bodyEl.innerHTML = '';
        if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
    }

    function keyButton() {
        return el('a', { class: 'tgc-btn', href: KEY_URL, target: '_blank', rel: 'noopener noreferrer' }, 'Create API key');
    }

    function notLoadedInfo() {
        return el('div', { class: 'tgc-section' },
            el('div', { class: 'tgc-section-title' }, 'Get started'),
            el('div', { class: 'tgc-info' },
                el('strong', {}, '1.'), ' Press ', el('strong', {}, 'Create API key'), '. Torn opens with everything this script needs already ticked, confirm it and copy the key.', el('br'),
                el('strong', {}, '2.'), ' Paste the key in ', el('strong', {}, 'Setup'), ' and press ', el('strong', {}, 'Load'), '. Everything fills in from your account.'
            ),
            el('div', { class: 'tgc-actions' },
                keyButton(),
                el('button', { type: 'button', class: 'tgc-btn', onclick: () => setTab('settings') }, 'Go to Setup')
            )
        );
    }

    function buildLauncher() {
        return el('div', { class: 'tgc-launch', id: 'tgc-launch' },
            el('div', { class: 'tgc-launch-text' },
                el('b', {}, 'Gym Gains Calculator+'),
                el('span', { class: 'tgc-launch-long' }, ' - plan trains, jumps, goals and stat balance.')
            ),
            state.apiKey ? null : keyButton(),
            el('button', { type: 'button', class: 'tgc-btn', onclick: openModal }, 'Open')
        );
    }

    let launcherEl = null;

    function mountLauncher() {
        const root = document.getElementById('gymroot');
        if (!root || !root.parentNode) return false;
        if (!launcherEl) launcherEl = buildLauncher();
        if (launcherEl.nextSibling === root) return true;
        launcherEl.classList.remove('floating');
        root.parentNode.insertBefore(launcherEl, root);
        return true;
    }

    function setTab(tabId) {
        state.currentTab = tabId;
        persist();
        $$('.tgc-tab', tabsEl).forEach(t => {
            t.classList.toggle('active', t.dataset.tab === tabId);
            t.setAttribute('aria-selected', String(t.dataset.tab === tabId));
        });
        renderTab();
    }

    function renderTab() {
        renderGen++;
        overlayEl.querySelectorAll('.tgc-select-list').forEach(n => n.remove());
        bodyEl.innerHTML = '';
        bodyEl.scrollTop = 0;
        if (overlayEl.hidden) return;
        switch (state.currentTab) {
            case 'calc':     return renderCalcTab();
            case 'planner':  return renderPlannerTab();
            case 'goal':     return renderGoalTab();
            case 'balance':  return renderBalanceTab();
            case 'compare':  return renderCompareTab();
            case 'settings': return renderSettingsTab();
        }
    }

    function setStatus(msg, kind = '') {
        if (!statusEl) return;
        statusEl.className = 'tgc-status ' + kind;
        statusEl.textContent = msg;
    }

    function field(label, input, hint) {
        let ctrl = input;
        if (input.tagName === 'SELECT') ctrl = enhanceSelect(input);
        else if (input.tagName === 'INPUT' && input.type === 'number') ctrl = enhanceNumber(input);
        return el('div', { class: 'tgc-field' },
            el('label', {},
                label,
                hint ? el('span', { class: 'tgc-hint' }, hint) : null
            ),
            ctrl
        );
    }

    function enhanceNumber(input) {
        const step = parseFloat(input.step) || 1;
        const min = input.min !== '' ? parseFloat(input.min) : -Infinity;
        const max = input.max !== '' ? parseFloat(input.max) : Infinity;
        const dec = (String(step).split('.')[1] || '').length;
        const bump = (dir, mult = 1) => {
            const cur = parseFloat(input.value) || 0;
            const next = Math.min(max, Math.max(min, Number((cur + dir * step * mult).toFixed(dec))));
            if (next === cur) return false;
            input.value = next;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
        };
        let timer = null;
        const stop = () => { clearTimeout(timer); timer = null; };
        const hold = (dir, n) => {
            const mult = n < 20 ? 1 : n < 45 ? 10 : 100;
            if (!bump(dir, mult)) { stop(); return; }
            timer = setTimeout(() => hold(dir, n + 1), Math.max(30, 160 * Math.pow(0.88, n)));
        };
        const btn = (dir, label, text) => {
            const b = el('button', { type: 'button', class: 'tgc-step', tabindex: '-1', 'aria-label': label }, text);
            b.addEventListener('pointerdown', e => {
                if (e.button !== 0) return;
                e.preventDefault();
                stop();
                try { b.setPointerCapture(e.pointerId); } catch {}
                if (bump(dir)) timer = setTimeout(() => hold(dir, 0), 400);
            });
            for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, stop);
            b.addEventListener('contextmenu', e => e.preventDefault());
            return b;
        };
        return el('div', { class: 'tgc-num' }, btn(-1, 'Decrease', '−'), input, btn(1, 'Increase', '+'));
    }

    function enhanceSelect(sel) {
        const label = el('span', { class: 'tgc-select-label' });
        const btn = el('button', { type: 'button', class: 'tgc-select-btn', 'aria-haspopup': 'listbox', 'aria-expanded': 'false' },
            label, el('span', { class: 'tgc-chev', 'aria-hidden': 'true' }));
        sel.hidden = true;
        sel.tabIndex = -1;
        const sync = () => {
            const o = sel.options[sel.selectedIndex];
            label.textContent = o ? o.textContent : '';
            btn.disabled = sel.disabled;
        };
        sync();
        sel.addEventListener('change', sync);

        let list = null;
        let active = -1;
        const close = focus => {
            if (!list) return;
            list.remove();
            list = null;
            btn.setAttribute('aria-expanded', 'false');
            document.removeEventListener('pointerdown', outside, true);
            bodyEl.removeEventListener('scroll', closeQuiet);
            window.removeEventListener('resize', closeQuiet);
            if (focus) btn.focus();
        };
        const closeQuiet = () => close(false);
        const outside = e => { if (list && !list.contains(e.target) && !btn.contains(e.target)) close(false); };
        const pick = i => {
            if (i >= 0 && sel.selectedIndex !== i) {
                sel.selectedIndex = i;
                sel.dispatchEvent(new Event('change'));
            }
            close(true);
        };
        const setActive = i => {
            const items = list.children;
            if (!items.length) return;
            if (items[active]) items[active].classList.remove('active');
            active = Math.max(0, Math.min(items.length - 1, i));
            items[active].classList.add('active');
            items[active].scrollIntoView({ block: 'nearest' });
        };
        const open = () => {
            if (list || btn.disabled) return;
            list = el('div', { class: 'tgc-select-list', role: 'listbox' });
            Array.from(sel.options).forEach((o, i) => {
                const opt = el('div', {
                    class: 'tgc-select-opt' + (i === sel.selectedIndex ? ' selected' : ''),
                    role: 'option',
                    'aria-selected': String(i === sel.selectedIndex)
                }, o.textContent);
                opt.addEventListener('click', () => pick(i));
                opt.addEventListener('pointermove', () => { if (active !== i) setActive(i); });
                list.appendChild(opt);
            });
            overlayEl.appendChild(list);
            const r = btn.getBoundingClientRect();
            const below = window.innerHeight - r.bottom - 8;
            const above = r.top - 8;
            const up = below < 180 && above > below;
            list.style.left = r.left + 'px';
            list.style.width = r.width + 'px';
            list.style.maxHeight = Math.max(120, Math.min(320, up ? above : below)) + 'px';
            if (up) list.style.bottom = (window.innerHeight - r.top + 2) + 'px';
            else list.style.top = (r.bottom + 2) + 'px';
            btn.setAttribute('aria-expanded', 'true');
            active = -1;
            setActive(Math.max(0, sel.selectedIndex));
            document.addEventListener('pointerdown', outside, true);
            bodyEl.addEventListener('scroll', closeQuiet, { passive: true });
            window.addEventListener('resize', closeQuiet);
        };
        btn.addEventListener('click', () => (list ? close(true) : open()));
        btn.addEventListener('keydown', e => {
            if (!list) {
                if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); open(); }
                return;
            }
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
            else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(active); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
            else if (e.key === 'Tab') close(false);
        });
        return el('div', { class: 'tgc-select' }, btn, sel);
    }

    function numInput(value, onchange, attrs = {}) {
        const i = el('input', { type: 'number', value: value == null ? 0 : value, ...attrs });
        i.addEventListener('input', () => {
            const raw = i.value;
            const v = raw === '' || raw === '-' ? 0 : parseFloat(raw);
            onchange(Number.isFinite(v) ? v : 0);
        });
        return i;
    }

    function checkbox(label, value, onchange) {
        const wrap = el('label', { class: 'tgc-field-checkbox' });
        const i = el('input', { type: 'checkbox' });
        i.checked = !!value;
        i.addEventListener('change', () => onchange(i.checked));
        wrap.append(i, document.createTextNode(label));
        return wrap;
    }

    function statPills(currentStat, onchange) {
        const wrap = el('div', { class: 'tgc-stat-pills' });
        for (const s of STAT_ORDER) {
            const v = state.apiData.stats ? state.apiData.stats[s] : null;
            wrap.appendChild(el('button', {
                type: 'button',
                class: 'tgc-stat-pill' + (s === currentStat ? ' active' : ''),
                'aria-pressed': String(s === currentStat),
                dataset: { stat: s },
                onclick: () => onchange(s)
            },
                STAT_LABELS[s],
                v != null ? el('span', { class: 'tgc-pill-val' }, fmtBig(v)) : null
            ));
        }
        return wrap;
    }

    function gymSelect(currentGymId, currentStat, onchange) {
        const sel = el('select', {});
        const gyms = state.apiData.gyms;
        if (!gyms) {
            sel.appendChild(el('option', { value: '' }, 'Click Load in Setup'));
            sel.disabled = true;
            return sel;
        }
        const candidates = Object.entries(gyms)
            .filter(([, g]) => (g[currentStat] || 0) > 0)
            .map(([id, g]) => ({
                id: parseInt(id, 10),
                name: g.name,
                energy: g.energy,
                dots: (g[currentStat] || 0) / 10
            }))
            .sort((a, b) => b.dots - a.dots || a.energy - b.energy);

        if (!candidates.length) {
            sel.appendChild(el('option', { value: '' }, 'No gyms train this stat'));
            return sel;
        }
        for (const g of candidates) {
            const lock = isGymUnlocked(g.id) ? '' : ' (locked)';
            const o = el('option', { value: g.id }, `${g.name}${lock} - ${g.dots.toFixed(1)} dots, ${g.energy}E/train`);
            if (g.id === currentGymId) o.selected = true;
            sel.appendChild(o);
        }
        sel.addEventListener('change', () => onchange(parseInt(sel.value, 10) || null));
        return sel;
    }

    function buildCollapsible(title, body, openByDefault = false) {
        const wrap = el('div', { class: 'tgc-collapsible' + (openByDefault ? ' open' : '') });
        const head = el('button', { type: 'button', class: 'tgc-collapsible-head', 'aria-expanded': String(openByDefault) },
            el('span', {}, title),
            el('span', { class: 'tgc-caret', 'aria-hidden': 'true' }, '\u25B8')
        );
        head.addEventListener('click', () => {
            wrap.classList.toggle('open');
            head.setAttribute('aria-expanded', String(wrap.classList.contains('open')));
        });
        const bodyW = el('div', { class: 'tgc-collapsible-body' }, body);
        wrap.append(head, bodyW);
        return wrap;
    }

    function buildGithubBtn() {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '14');
        svg.setAttribute('height', '14');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'currentColor');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z');
        svg.appendChild(path);

        const btn = el('a', {
            class: 'tgc-github-btn',
            href: GITHUB_URL,
            target: '_blank',
            rel: 'noopener noreferrer'
        });
        btn.appendChild(svg);
        btn.appendChild(document.createTextNode('Guide & Documentation'));
        return btn;
    }

    function buildCustomItemsUI(c, syncInputs, onChangeNow) {
        const ci = c.customItems;
        const update = () => {
            applyJumpPreset();
            syncInputs();
            onChangeNow();
        };
        const xanaxI = numInput(ci.xanax, v => { ci.xanax = v; update(); }, { min: 0, step: 1 });
        const edvdI  = numInput(ci.edvd,  v => { ci.edvd  = v; update(); }, { min: 0, step: 1 });
        const candyI = numInput(ci.candy, v => { ci.candy = v; update(); }, { min: 0, step: 1 });
        const candyValueI = el('select', {},
            el('option', { value: '50' }, '50h'),
            el('option', { value: '100' }, '100h')
        );
        candyValueI.value = String(ci.candyValue || 100);
        candyValueI.addEventListener('change', () => {
            ci.candyValue = parseInt(candyValueI.value, 10);
            update();
        });

        const wrap = el('div', { class: 'tgc-row r4' },
            field('Xanax', xanaxI, '+250E ea'),
            field('eDVD', edvdI, '+2500h ea'),
            field('Candies', candyI),
            field('Candy type', candyValueI)
        );

        const toggles = el('div', { class: 'tgc-row' },
            checkbox('Use ecstasy (x2 happy)', ci.ecstasy, v => { ci.ecstasy = v; update(); }),
            checkbox(`Use refill (+${state.apiData.maxEnergy}E)`, ci.refill, v => { ci.refill = v; update(); })
        );

        return [wrap, toggles];
    }

    function renderCalcTab() {
        const c = state.calc;
        const onChange = debounce(() => { persist(); recompute(); }, 120);
        const onChangeNow = () => { persist(); recompute(); };

        if (!state.apiData.loaded) {
            bodyEl.append(statusEl, notLoadedInfo());
            return;
        }

        const statSel = statPills(c.stat, onStatChange);

        const statTotalI = numInput(c.statTotal, v => { c.statTotal = v; onChange(); }, { min: 0, step: 1000 });
        const happyI     = numInput(c.happy,     v => { c.happy = v; onChange(); }, { min: 0, max: 99999, step: 1 });
        const energyI    = numInput(c.energy,    v => { c.energy = v; onChange(); }, { min: 0, step: 5 });
        const gymS       = gymSelect(c.gymId, c.stat, id => { c.gymId = id; onChangeNow(); });

        const syncInputs = () => {
            happyI.value = c.happy;
            energyI.value = c.energy;
        };

        const jumpSel = el('select', {});
        const jumps = [
            { v: 'none',   t: 'None - no items'      },
            { v: 'choco',  t: 'Choco Jump'            },
            { v: 'happy',  t: 'Happy Jump'            },
            { v: 'k99',    t: '99k Jump (max happy)'  },
            { v: 'custom', t: 'Custom items'          }
        ];
        for (const j of jumps) jumpSel.appendChild(el('option', { value: j.v }, j.t));
        jumpSel.value = c.jumpPreset;
        jumpSel.addEventListener('change', () => {
            c.jumpPreset = jumpSel.value;
            applyJumpPreset();
            persist();
            renderTab();
        });

        const candyValSel = el('select', {});
        candyValSel.appendChild(el('option', { value: '50'  }, '50 happy / candy'));
        candyValSel.appendChild(el('option', { value: '100' }, '100 happy / candy'));
        candyValSel.value = String(c.candyValue);
        candyValSel.addEventListener('change', () => {
            c.candyValue = parseInt(candyValSel.value, 10);
            applyJumpPreset();
            syncInputs();
            persist();
            recompute();
        });

        const jumpInfo = el('div', { class: 'tgc-jump-summary' });

        let customParts = null;
        if (c.jumpPreset === 'custom') {
            customParts = buildCustomItemsUI(c, syncInputs, onChangeNow);
        }

        const bonusToolbar = el('div', { class: 'tgc-bonus-toolbar' },
            el('button', {
                class: 'tgc-btn secondary tiny',
                type: 'button',
                title: 'Reapply API-detected perks for the current stat',
                onclick: () => {
                    applyParsedBonuses();
                    persist();
                    renderTab();
                    setStatus('Bonuses reset to API-detected values', 'ok');
                }
            }, 'Reset to detected')
        );
        const bonusBody = el('div', {}, bonusToolbar);
        const bonusFields = [
            ['property',         'Property %',                       'PI gym gains'],
            ['eduGeneral',       'Edu. general %',                   'all stats'],
            ['eduStat',          `Edu. ${STAT_SHORT[c.stat]} %`,     'this stat'],
            ['factionSteadfast', `Steadfast ${STAT_SHORT[c.stat]} %`,'faction'],
            ['factionCandy',     'Faction candy %',                  'happy boost'],
            ['job',              'Job %',                            'gym gains'],
            ['book',             'Book %',                           'temporary']
        ];
        const br1 = el('div', { class: 'tgc-row' });
        const br2 = el('div', { class: 'tgc-row' });
        const br3 = el('div', { class: 'tgc-row' });
        const br4 = el('div', { class: 'tgc-row r1' });
        const grids = [br1, br1, br2, br2, br3, br3, br4];
        bonusFields.forEach(([k, label, hint], i) => {
            const inp = numInput(c.bonuses[k] || 0, v => { c.bonuses[k] = v; onChange(); }, { step: 0.5 });
            grids[i].appendChild(field(label, inp, hint));
        });
        bonusBody.append(br1, br2, br3, br4);

        const calcBtn = el('button', {
            class: 'tgc-btn full',
            type: 'button',
            onclick: onChangeNow
        }, 'Recalculate');
        const resultWrap = el('div', { class: 'tgc-result', id: 'tgc-calc-result' });
        const chartWrap  = el('div', { class: 'tgc-chart', id: 'tgc-calc-chart' });

        const showChocoSelect = c.jumpPreset === 'choco';
        const left = el('div', {},
            el('div', { class: 'tgc-section' },
                el('div', { class: 'tgc-section-title' }, 'Stat'),
                statSel,
                el('div', { class: 'tgc-row r3' },
                    field('Stat total', statTotalI),
                    field('Happy', happyI, '0-99,999'),
                    field('Energy', energyI, 'to spend')
                ),
                el('div', { class: 'tgc-row r1' },
                    field('Gym', gymS)
                )
            ),
            el('div', { class: 'tgc-section' },
                el('div', { class: 'tgc-section-title' }, 'Jump'),
                el('div', { class: showChocoSelect ? 'tgc-row' : 'tgc-row r1' },
                    field('Preset', jumpSel),
                    showChocoSelect ? field('Candy type', candyValSel) : null
                ),
                customParts ? customParts[0] : null,
                customParts ? customParts[1] : null,
                jumpInfo
            ),
            buildCollapsible('Bonuses & Perks', bonusBody, true),
            calcBtn
        );
        bodyEl.append(statusEl, el('div', { class: 'tgc-cols calc' }, left, el('div', {}, resultWrap, chartWrap)));

        recompute();
    }

    function recompute() {
        const c = state.calc;
        const gym = getActiveGym(c);
        const result = $('#tgc-calc-result');
        const jumpInfo = $('.tgc-jump-summary');
        if (!result) return;

        const j = resolveJump({
            preset: c.jumpPreset,
            candyValue: c.candyValue,
            customItems: c.customItems,
            baseHappy: state.apiData.maxHappy || 250,
            maxEnergy: state.apiData.maxEnergy || 150,
            factionCandyPct: c.bonuses.factionCandy
        });
        if (jumpInfo) {
            const lines = [j.summary];
            if (c.jumpPreset !== 'none') {
                lines.push(`Starting happy ${fmtInt(j.startHappy)}, energy ${fmtInt(j.startEnergy != null ? j.startEnergy : c.energy)}`);
            }
            jumpInfo.textContent = lines.join('  ·  ');
        }

        if (!gym) {
            result.innerHTML = '';
            result.appendChild(el('div', { class: 'tgc-info' }, 'Pick a gym above.'));
            return;
        }
        if (gym.dots === 0) {
            result.innerHTML = '';
            result.appendChild(el('div', { class: 'tgc-info' }, `${gym.name} doesn't train ${STAT_LABELS[c.stat]}.`));
            return;
        }

        const perks = getActivePerks(c);
        const sim = simulateSession({
            initialHappy: c.happy,
            initialStat: c.statTotal,
            energyBudget: c.energy,
            gym: { dots: gym.dots, energy: gym.energy },
            stat: c.stat,
            perks,
            collectHistory: true
        });

        const pctIncrease = c.statTotal > 0 ? (sim.totalGain / c.statTotal) * 100 : 0;
        const energySpent = sim.trains * gym.energy;
        const perEnergy = energySpent > 0 ? sim.totalGain / energySpent : 0;

        const energyUsed = c.energy - sim.energyLeft;

        result.innerHTML = '';
        result.appendChild(el('div', { class: 'tgc-result-grid' },
            readout('Total gain', fmtBig(sim.totalGain), `${sim.trains} trains · ${fmtBig(perEnergy)}/E`, true),
            readout('Final stat', fmtBig(sim.finalStat), `${fmtPct(pctIncrease)} increase`),
            readout('Happy used', fmtInt(c.happy - sim.finalHappy), `${fmtInt(c.happy)} → ${fmtInt(sim.finalHappy)}`),
            readout('Energy used', fmtInt(energyUsed), sim.energyLeft > 0 ? `${sim.energyLeft}E unused` : 'all spent')
        ));

        if (c.jumpPreset === 'none') {
            const consumables = estimateDailyConsumables(energyUsed, state.apiData.maxEnergy);
            const costLine = formatConsumablesLine(consumables) || 'free (within natural regen)';
            result.appendChild(el('div', { class: 'tgc-info', style: { marginTop: '10px', marginBottom: '0' } },
                el('strong', {}, 'Session cost: '), costLine,
                consumables.breachedCap ? el('span', { class: 'tgc-warn-line', style: { display: 'inline', marginTop: '0' } }, ` (needs +${fmtInt(consumables.overflow)}E from boosters/cans)`) : null
            ));
        }

        if (sim.finalHappy === 0 && sim.trains > 1) {
            result.appendChild(el('div', { class: 'tgc-info warn', style: { marginTop: '10px', marginBottom: '0' } },
                'Happy hit 0 mid-session. Last trains were below max efficiency, try a higher-energy gym or fewer trains per session.'
            ));
        }

        drawCalcChart(sim, c.stat);
    }

    function readout(label, value, sub, big = false) {
        return el('div', { class: 'tgc-stat-readout' },
            el('span', { class: 'tgc-r-label' }, label),
            el('span', { class: 'tgc-r-value' + (big ? '' : ' small') }, value),
            sub ? el('span', { class: 'tgc-r-sub' }, sub) : null
        );
    }

    function drawCalcChart(sim, statName) {
        lineChart($('#tgc-calc-chart'), {
            label: 'Gain and happy across the session',
            x: downsample(sim.energyHist, MAX_HISTORY_POINTS),
            xLabel: 'Energy spent',
            xFmt: v => fmtInt(v) + ' energy spent',
            zeroBase: true,
            series: [
                { label: 'Total gain', color: STAT_COLORS[statName], data: downsample(sim.cumGainHist, MAX_HISTORY_POINTS), fill: true, fmt: fmtBig },
                { label: 'Happy', color: 'var(--tgc-happy)', data: downsample(sim.happyHist, MAX_HISTORY_POINTS), axis: 'y1', dash: true, width: 1.5, fmt: fmtInt }
            ]
        });
    }

    function renderPlannerTab() {
        const p = state.planner;
        const onChange = debounce(runPlanner, 120);

        if (!state.apiData.loaded) {
            bodyEl.append(statusEl, notLoadedInfo());
            return;
        }

        const daysI = numInput(p.days, v => { p.days = clampInt(v, 1, 5000); onChange(); }, { min: 1, max: 5000, step: 1 });
        const trainEveryI = numInput(p.trainEvery, v => { p.trainEvery = clampInt(v, 1, 365); onChange(); }, { min: 1, max: 365, step: 1 });
        const sessionsI = numInput(p.sessionsPerTrainDay, v => { p.sessionsPerTrainDay = clampInt(v, 1, MAX_SESSIONS_PER_DAY); onChange(); }, { min: 1, max: MAX_SESSIONS_PER_DAY, step: 1 });

        bodyEl.append(
            statusEl,
            el('div', { class: 'tgc-section' },
                el('div', { class: 'tgc-section-title' }, 'Schedule'),
                el('div', { class: 'tgc-row r3' },
                    field('Total days', daysI),
                    field('Train every X days', trainEveryI),
                    field('Sessions per train day', sessionsI)
                ),
                el('div', { class: 'tgc-info' },
                    'Projects gains over time using your ', el('strong', {}, 'Calculator'),
                    ' inputs (stat, happy, energy, gym, jump preset, bonuses). Each training day runs the configured sessions.'
                )
            ),
            el('div', { id: 'tgc-plan-result' }),
            el('div', { class: 'tgc-chart tall', id: 'tgc-plan-chart' })
        );

        runPlanner();
    }

    function runPlanner() {
        const myGen = renderGen;
        const p = state.planner;
        const c = state.calc;
        const gym = getActiveGym(c);
        const out = $('#tgc-plan-result');
        if (!out) return;
        out.innerHTML = '';

        if (!gym || gym.dots === 0) {
            out.appendChild(el('div', { class: 'tgc-info' }, 'Set a gym in Calculator that trains your selected stat.'));
            return;
        }

        const perks = getActivePerks(c);
        let statTotal = c.statTotal;
        const series = [{ day: 0, stat: statTotal }];

        for (let d = 1; d <= p.days; d++) {
            if (d % p.trainEvery === 0) {
                for (let s = 0; s < p.sessionsPerTrainDay; s++) {
                    const r = simulateSession({
                        initialHappy: c.happy,
                        initialStat: statTotal,
                        energyBudget: c.energy,
                        gym: { dots: gym.dots, energy: gym.energy },
                        stat: c.stat,
                        perks,
                        collectHistory: false
                    });
                    statTotal = r.finalStat;
                }
            }
            series.push({ day: d, stat: statTotal });
        }

        if (myGen !== renderGen) return;

        const totalGain = statTotal - c.statTotal;
        const trainingDays = Math.floor(p.days / p.trainEvery);
        const totalSessions = trainingDays * p.sessionsPerTrainDay;
        const totalEnergy = totalSessions * c.energy;
        const avgPerSession = totalSessions > 0 ? totalGain / totalSessions : 0;
        const pctInc = c.statTotal > 0 ? (totalGain / c.statTotal) * 100 : 0;

        out.appendChild(el('div', { class: 'tgc-result' },
            el('div', { class: 'tgc-result-grid wide' },
                readout('Total gain', fmtBig(totalGain), `${trainingDays} train days · ${totalSessions} sessions`, true),
                readout('Final stat', fmtBig(statTotal), `${fmtPct(pctInc)} increase`),
                readout('Avg / session', fmtBig(avgPerSession), `${fmtInt(c.energy)}E per session`),
                readout('Total energy', fmtInt(totalEnergy), `${gym.name}`)
            ),
            buildCostBlock(c, trainingDays, p.sessionsPerTrainDay)
        ));

        drawPlanChart(series, c.stat);
    }

    function drawPlanChart(series, statName) {
        const ds = downsample(series, MAX_DAY_SERIES_POINTS);
        lineChart($('#tgc-plan-chart'), {
            label: 'Stat total by day',
            x: ds.map(s => s.day),
            xLabel: 'Day',
            xFmt: v => 'Day ' + fmtInt(v),
            series: [
                { label: STAT_LABELS[statName], color: STAT_COLORS[statName], data: ds.map(s => s.stat), fill: true, fmt: fmtBig }
            ]
        });
    }

    function renderGoalTab() {
        const g = state.goal;
        const c = state.calc;

        if (!state.apiData.loaded) {
            bodyEl.append(statusEl, notLoadedInfo());
            return;
        }

        const seg = el('div', { class: 'tgc-segmented' });
        for (const t of [
            { id: 'stat',    label: 'Stat target' },
            { id: 'percent', label: '% increase' },
            { id: 'days',    label: 'Project days' }
        ]) {
            seg.appendChild(el('button', {
                type: 'button',
                class: g.type === t.id ? 'active' : '',
                onclick: () => { g.type = t.id; persist(); renderTab(); }
            }, t.label));
        }

        const inputs = el('div', { class: 'tgc-row r1' });
        if (g.type === 'stat') {
            inputs.appendChild(field('Stat goal',
                numInput(g.statGoal, v => { g.statGoal = v; persist(); }, { min: 0, step: 100000 }),
                `from ${fmtBig(c.statTotal)}`));
        } else if (g.type === 'percent') {
            inputs.appendChild(field('% increase',
                numInput(g.percentGoal, v => { g.percentGoal = v; persist(); }, { min: 0, step: 1 }),
                `from ${fmtBig(c.statTotal)}`));
        } else {
            inputs.appendChild(field('Days to project',
                numInput(g.daysGoal, v => { g.daysGoal = clampInt(v, 1, MAX_PROJECTION_DAYS); persist(); }, { min: 1, max: MAX_PROJECTION_DAYS, step: 1 })));
        }

        const trainEveryI = numInput(g.trainEvery, v => { g.trainEvery = clampInt(v, 1, 365); persist(); }, { min: 1, max: 365, step: 1 });
        const sessionsI   = numInput(g.sessionsPerTrainDay, v => { g.sessionsPerTrainDay = clampInt(v, 1, MAX_SESSIONS_PER_DAY); persist(); }, { min: 1, max: MAX_SESSIONS_PER_DAY, step: 1 });

        const runBtn = el('button', { class: 'tgc-btn full', type: 'button', style: { marginBottom: '0' }, onclick: runGoal }, 'Estimate');

        bodyEl.append(
            statusEl,
            el('div', { class: 'tgc-cols even' },
                el('div', {},
                    el('div', { class: 'tgc-section' },
                        el('div', { class: 'tgc-section-title' }, 'Goal'),
                        seg,
                        el('div', { style: { marginTop: '10px' } }, inputs)
                    )
                ),
                el('div', {},
                    el('div', { class: 'tgc-section' },
                        el('div', { class: 'tgc-section-title' }, 'Routine'),
                        el('div', { class: 'tgc-row' },
                            field('Train every X days', trainEveryI),
                            field('Sessions per train day', sessionsI)
                        ),
                        el('div', { style: { marginTop: '10px' } }, runBtn)
                    )
                )
            ),
            el('div', { id: 'tgc-goal-result', style: { marginTop: '10px' } },
                el('div', { class: 'tgc-info' },
                    'Uses your ', el('strong', {}, 'Calculator'), ' inputs. Press ', el('strong', {}, 'Estimate'),
                    ' after changing values, long projections can take a moment.'
                )
            ),
            el('div', { class: 'tgc-chart tall', id: 'tgc-goal-chart' })
        );
    }

    function runGoal() {
        const myGen = renderGen;
        const g = state.goal;
        const c = state.calc;
        const gym = getActiveGym(c);
        const out = $('#tgc-goal-result');
        if (!out) return;
        out.innerHTML = '';

        if (!gym || gym.dots === 0) {
            out.appendChild(el('div', { class: 'tgc-info' }, 'Set a gym in Calculator that trains your selected stat.'));
            return;
        }

        const perks = getActivePerks(c);

        if (g.type === 'days') {
            let stat = c.statTotal;
            const series = [{ day: 0, stat }];
            for (let d = 1; d <= g.daysGoal; d++) {
                if (d % g.trainEvery === 0) {
                    for (let s = 0; s < g.sessionsPerTrainDay; s++) {
                        const r = simulateSession({
                            initialHappy: c.happy, initialStat: stat, energyBudget: c.energy,
                            gym: { dots: gym.dots, energy: gym.energy }, stat: c.stat, perks,
                            collectHistory: false
                        });
                        stat = r.finalStat;
                    }
                }
                series.push({ day: d, stat });
            }

            if (myGen !== renderGen) return;

            const gain = stat - c.statTotal;
            const pct = c.statTotal > 0 ? (gain / c.statTotal) * 100 : 0;
            const trainDays = Math.floor(g.daysGoal / g.trainEvery);
            const sessions = trainDays * g.sessionsPerTrainDay;
            const energyTotal = sessions * c.energy;
            out.appendChild(el('div', { class: 'tgc-result' },
                el('div', { class: 'tgc-result-grid wide' },
                    readout(`After ${g.daysGoal} days`, fmtBig(stat), `+${fmtBig(gain)}`, true),
                    readout('% increase', fmtPct(pct), `from ${fmtBig(c.statTotal)}`),
                    readout('Energy used', fmtInt(energyTotal), `${sessions} sessions`),
                    readout('Train days', fmtInt(trainDays), `every ${g.trainEvery}d`)
                ),
                buildCostBlock(c, trainDays, g.sessionsPerTrainDay)
            ));
            drawGoalChart(series, c.stat, null);
            return;
        }

        const goalStat = g.type === 'stat' ? g.statGoal : c.statTotal * (1 + g.percentGoal / 100);
        if (goalStat <= c.statTotal) {
            out.appendChild(el('div', { class: 'tgc-info' }, 'Goal is at or below your current stat.'));
            return;
        }

        let stat = c.statTotal;
        const series = [{ day: 0, stat }];
        let reachedDay = -1;
        let actualSessions = 0;

        for (let d = 1; d <= MAX_PROJECTION_DAYS; d++) {
            if (d % g.trainEvery === 0) {
                for (let s = 0; s < g.sessionsPerTrainDay; s++) {
                    const r = simulateSession({
                        initialHappy: c.happy, initialStat: stat, energyBudget: c.energy,
                        gym: { dots: gym.dots, energy: gym.energy }, stat: c.stat, perks,
                        collectHistory: false
                    });
                    stat = r.finalStat;
                    actualSessions++;
                    if (stat >= goalStat) { reachedDay = d; break; }
                }
            }
            series.push({ day: d, stat });
            if (reachedDay > 0) break;
        }

        if (myGen !== renderGen) return;

        if (reachedDay < 0) {
            out.appendChild(el('div', { class: 'tgc-info warn' },
                `Goal not reached in ${MAX_PROJECTION_DAYS} days. Final: ${fmtBig(stat)}. Try a better gym or higher energy/happy.`
            ));
            drawGoalChart(series, c.stat, goalStat);
            return;
        }

        const totalSessions = actualSessions;
        const energyTotal = totalSessions * c.energy;
        const trainDaysReached = Math.ceil(reachedDay / g.trainEvery);
        out.appendChild(el('div', { class: 'tgc-result' },
            el('div', { class: 'tgc-result-grid wide' },
                readout('Days to goal', fmtInt(reachedDay), `~${(reachedDay / 365).toFixed(2)} years`, true),
                readout('Goal', fmtBig(goalStat), `from ${fmtBig(c.statTotal)}`),
                readout('Final stat', fmtBig(stat)),
                readout('Energy needed', fmtInt(energyTotal), `${totalSessions} sessions`)
            ),
            buildCostBlock(c, trainDaysReached, g.sessionsPerTrainDay)
        ));
        drawGoalChart(series, c.stat, goalStat);
    }

    function drawGoalChart(series, statName, goalLine) {
        const ds = downsample(series, MAX_DAY_SERIES_POINTS);
        const lines = [
            { label: STAT_LABELS[statName], color: STAT_COLORS[statName], data: ds.map(s => s.stat), fill: true, fmt: fmtBig }
        ];
        if (goalLine) lines.push({ label: 'Goal', color: 'var(--tgc-good)', data: ds.map(() => goalLine), dash: true, width: 1.5, fmt: fmtBig });
        lineChart($('#tgc-goal-chart'), {
            label: 'Projected stat by day',
            x: ds.map(s => s.day),
            xLabel: 'Day',
            xFmt: v => 'Day ' + fmtInt(v),
            series: lines
        });
    }

    function renderBalanceTab() {
        const b = state.balance;
        const c = state.calc;
        const a = state.apiData;

        if (!a.loaded) {
            bodyEl.append(statusEl, notLoadedInfo());
            return;
        }

        const dailyBudget = c.energy;
        const pool = buildGymPool(dailyBudget);

        const currentTotal = STAT_ORDER.reduce((s, k) => s + (a.stats[k] || 0), 0);
        const currentRatio = currentStatRatio();
        const ratioStr = STAT_ORDER.map(s => `${STAT_SHORT[s]} ${currentRatio[s].toFixed(1)}%`).join(' · ');
        const gymSource = {
            api: 'unlocked list from API',
            page: 'read from the gym page',
            guess: 'no unlock data, assuming everything up to your active gym'
        }[pool.source];
        const gymLine = pool.length
            ? `${pool.length} usable, ${gymSource} · picked per stat · ${dailyBudget}E budget/day`
            : `Nothing fits a ${dailyBudget}E budget`;

        const infoBox = el('div', { class: 'tgc-info' },
            el('strong', {}, 'Total battle stats: '), fmtBig(currentTotal), el('br'),
            el('strong', {}, 'Current ratio: '), ratioStr, el('br'),
            el('strong', {}, 'Gyms: '), gymLine, el('br'),
            'Picks the best gym and each stat\u0027s own perks, rechecking special gym access as your stats move. Calculator bonus edits are not used here.'
        );

        const modeSeg = el('div', { class: 'tgc-segmented' });
        for (const t of [
            { id: 'ratio', label: 'Custom ratio' },
            { id: 'gym',   label: 'Special gyms'  }
        ]) {
            modeSeg.appendChild(el('button', {
                type: 'button',
                class: b.mode === t.id ? 'active' : '',
                onclick: () => { b.mode = t.id; persist(); renderTab(); }
            }, t.label));
        }

        const precSeg = el('div', { class: 'tgc-segmented' });
        const precBtns = {};
        for (const t of [
            { id: 'fast',    label: 'Fast (within 1%)' },
            { id: 'precise', label: 'Precise (within 0.5%)' }
        ]) {
            const btn = el('button', {
                type: 'button',
                class: (b.precision || 'precise') === t.id ? 'active' : '',
                onclick: () => {
                    b.precision = t.id;
                    persist();
                    for (const [id, pb] of Object.entries(precBtns)) {
                        pb.classList.toggle('active', id === t.id);
                    }
                }
            }, t.label);
            precBtns[t.id] = btn;
            precSeg.appendChild(btn);
        }
        let modeSection;
        if (b.mode === 'ratio') {
            modeSection = buildRatioSection();
        } else {
            modeSection = buildGymSection();
        }

        const runBtn = el('button', { class: 'tgc-btn full', type: 'button', onclick: runBalance }, 'Calculate Plan');

        bodyEl.append(
            statusEl,
            el('div', { class: 'tgc-cols' },
                el('div', {},
                    el('div', { class: 'tgc-section' },
                        el('div', { class: 'tgc-section-title' }, 'Target'),
                        modeSeg
                    ),
                    modeSection,
                    el('div', { class: 'tgc-section' },
                        el('div', { class: 'tgc-section-title' }, 'Precision'),
                        precSeg
                    ),
                    runBtn,
                    infoBox
                ),
                el('div', { id: 'tgc-balance-result' },
                    el('div', { class: 'tgc-info' }, 'Pick a target on the left and press ', el('strong', {}, 'Calculate plan'), '. The summary, training breakdown and day by day plan show up here.')
                )
            )
        );
    }

    function buildRatioSection() {
        const b = state.balance;
        const r = b.ratio;

        const rawInputs = {};
        const totalEl = el('span', { style: { color: 'var(--tgc-muted)', fontSize: '11px' } });

        const updateTotal = () => {
            const sum = STAT_ORDER.reduce((acc, s) => acc + (parseFloat(rawInputs[s] && rawInputs[s].value) || 0), 0);
            const rounded = Math.round(sum * 10) / 10;
            totalEl.textContent = `sum: ${rounded.toFixed(1)}%`;
            totalEl.style.color = Math.abs(rounded - 100) < 0.05 ? 'var(--tgc-good)' : 'var(--tgc-warn)';
        };

        const row1 = el('div', { class: 'tgc-row' });
        const row2 = el('div', { class: 'tgc-row' });

        STAT_ORDER.forEach((s, i) => {
            const inp = el('input', {
                type: 'number',
                value: r[s],
                min: 0,
                max: 100,
                step: 0.1,
                style: { boxShadow: `inset 3px 0 0 ${STAT_COLORS[s]}` }
            });
            rawInputs[s] = inp;
            inp.addEventListener('input', () => {
                r[s] = Math.max(0, parseFloat(inp.value) || 0);
                persist();
                updateTotal();
            });
            (i < 2 ? row1 : row2).appendChild(field(`${STAT_LABELS[s]} %`, inp));
        });

        updateTotal();

        const currentRatio = currentStatRatio();
        const barWrap = el('div', { class: 'tgc-ratio-bar' });
        for (const s of STAT_ORDER) {
            const span = el('span', { style: { background: STAT_COLORS[s], flex: String(currentRatio[s] || 0.01) } });
            barWrap.appendChild(span);
        }

        const normalizeBtn = el('button', {
            class: 'tgc-btn secondary tiny',
            type: 'button',
            onclick: () => {
                const sum = STAT_ORDER.reduce((a, s) => a + r[s], 0);
                if (sum <= 0) return;
                for (const s of STAT_ORDER) {
                    r[s] = Math.round((r[s] / sum * 100) * 10) / 10;
                    rawInputs[s].value = r[s];
                }
                r[STAT_ORDER[3]] = Math.round((100 - STAT_ORDER.slice(0, 3).reduce((a, s) => a + r[s], 0)) * 10) / 10;
                rawInputs[STAT_ORDER[3]].value = r[STAT_ORDER[3]];
                persist();
                updateTotal();
            }
        }, 'Normalize to 100%');

        return el('div', { class: 'tgc-section' },
            el('div', { class: 'tgc-section-title' }, 'Target ratio'),
            el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' } },
                el('span', { style: { fontSize: '10px', color: 'var(--tgc-muted)' } }, 'Current distribution'),
                totalEl
            ),
            barWrap,
            row1,
            row2,
            el('div', { style: { marginTop: '6px', display: 'flex', justifyContent: 'flex-end' } }, normalizeBtn)
        );
    }

    function currentStatRatio() {
        const a = state.apiData;
        if (!a.loaded || !a.stats) return { strength: 25, defense: 25, speed: 25, dexterity: 25 };
        const total = STAT_ORDER.reduce((s, k) => s + (a.stats[k] || 0), 0);
        if (total === 0) return { strength: 25, defense: 25, speed: 25, dexterity: 25 };
        const out = {};
        for (const s of STAT_ORDER) out[s] = (a.stats[s] || 0) / total * 100;
        return out;
    }

    function buildGymSection() {
        const b = state.balance;

        const gymKeys = Object.keys(SPECIAL_GYMS);
        const picker = el('div', { class: 'tgc-gym-picker' });
        const pills = {};

        const refresh = () => {
            for (const [k, pill] of Object.entries(pills)) {
                const sel1 = b.gym1 === k;
                const sel2 = b.gym2 === k;
                const blocked = (b.gym1 && !sel1 && b.gym1 !== '' && !gymPairCompatible(b.gym1, k)) ||
                                (b.gym2 && !sel2 && b.gym2 !== '' && !gymPairCompatible(b.gym2, k));
                pill.classList.toggle('active', sel1 || sel2);
                pill.classList.toggle('locked', !!blocked && !sel1 && !sel2);
            }
        };

        for (const k of gymKeys) {
            const g = SPECIAL_GYMS[k];
            const pill = el('div', {
                class: 'tgc-gym-pill',
                onclick: () => {
                    if (b.gym1 === k) {
                        b.gym1 = b.gym2;
                        b.gym2 = '';
                    } else if (b.gym2 === k) {
                        b.gym2 = '';
                    } else {
                        const blocked = (b.gym1 && b.gym1 !== k && !gymPairCompatible(b.gym1, k));
                        if (blocked) return;
                        if (!b.gym1 || b.gym1 === '') {
                            b.gym1 = k;
                        } else if (!b.gym2 || b.gym2 === '') {
                            if (!gymPairCompatible(b.gym1, k)) return;
                            b.gym2 = k;
                        } else {
                            b.gym1 = k;
                            b.gym2 = '';
                        }
                    }
                    persist();
                    refresh();
                }
            },
                g.label,
                el('span', { class: 'tgc-pill-e' }, `${g.energy}E/train`)
            );
            pills[k] = pill;
            picker.appendChild(pill);
        }

        refresh();

        return el('div', { class: 'tgc-section' },
            el('div', { class: 'tgc-section-title' }, 'Target gyms (pick 1 or 2)'),
            picker
        );
    }

    function resolveTargetRatioFromGyms(gym1Key, gym2Key) {
        if (!gym1Key) return null;

        if (!gym2Key) {
            if (gym1Key === 'balboas')   return { strength: 19.0, defense: 31.0, speed: 19.0, dexterity: 31.0 };
            if (gym1Key === 'frontline') return { strength: 31.0, defense: 19.0, speed: 31.0, dexterity: 19.0 };
            const stat = SPECIAL_GYMS[gym1Key].stat;
            const targets = { strength: 22.9, defense: 22.9, speed: 22.9, dexterity: 22.9 };
            targets[stat] = 31.4;
            return targets;
        }

        const DUAL_RATIOS = {
            'balboas_isoyamas':      { strength: 22.2, defense: 31.0, speed: 22.2, dexterity: 24.6 },
            'balboas_elites':        { strength: 22.2, defense: 24.6, speed: 22.2, dexterity: 31.0 },
            'balboas_gym3000':       { strength: 35.0, defense: 28.0, speed:  9.0, dexterity: 28.0 },
            'balboas_totalrebound':  { strength:  9.0, defense: 28.0, speed: 35.0, dexterity: 28.0 },
            'frontline_gym3000':     { strength: 31.0, defense: 22.2, speed: 24.6, dexterity: 22.2 },
            'frontline_totalrebound':{ strength: 24.6, defense: 22.2, speed: 31.0, dexterity: 22.2 },
            'frontline_isoyamas':    { strength: 27.8, defense: 35.0, speed: 27.8, dexterity:  9.4 },
            'frontline_elites':      { strength: 27.8, defense:  9.4, speed: 27.8, dexterity: 35.0 }
        };

        return DUAL_RATIOS[gym1Key + '_' + gym2Key] || DUAL_RATIOS[gym2Key + '_' + gym1Key] || null;
    }

    function runBalance() {
        const b = state.balance;
        const c = state.calc;
        const a = state.apiData;
        const out = $('#tgc-balance-result');
        if (!out) return;
        out.innerHTML = '';

        if (!a.loaded || !a.stats) {
            out.appendChild(el('div', { class: 'tgc-info' }, 'Load your stats from API first.'));
            return;
        }

        const dailyBudget = c.energy;
        const pool = buildGymPool(dailyBudget);

        if (!pool.length) {
            out.appendChild(el('div', { class: 'tgc-info warn' }, `No gym fits a ${dailyBudget}E daily budget. Increase your energy in Calculator.`));
            return;
        }

        let targetRatioPct;

        if (b.mode === 'ratio') {
            const rawSum = STAT_ORDER.reduce((s, k) => s + (b.ratio[k] || 0), 0);
            if (Math.abs(rawSum - 100) > 1) {
                out.appendChild(el('div', { class: 'tgc-info warn' }, `Your ratios sum to ${rawSum.toFixed(1)}%, they must add up to 100%. Use the Normalize button.`));
                return;
            }
            targetRatioPct = {};
            for (const s of STAT_ORDER) targetRatioPct[s] = b.ratio[s];
        } else {
            if (!b.gym1) {
                out.appendChild(el('div', { class: 'tgc-info' }, 'Pick at least one special gym above.'));
                return;
            }
            targetRatioPct = resolveTargetRatioFromGyms(b.gym1, b.gym2 || '');
            if (!targetRatioPct) {
                out.appendChild(el('div', { class: 'tgc-info warn' }, 'Could not resolve a valid ratio for this gym combination.'));
                return;
            }
        }

        const currentStats = { ...a.stats };
        const currentTotal = STAT_ORDER.reduce((s, k) => s + (currentStats[k] || 0), 0);

        if (currentTotal === 0) {
            out.appendChild(el('div', { class: 'tgc-info' }, 'Your stats appear to be zero - load from API first.'));
            return;
        }

        const perksByStat = {};
        for (const s of STAT_ORDER) perksByStat[s] = getPerksForStat(s);
        const maxHappy = a.maxHappy || 99999;
        const precision = b.precision || 'precise';
        const threshold = precision === 'fast' ? 1.0 : 0.5;

        const gainOneTrain = (stat, currentStatVal, pick) => {
            const r = simulateSession({
                initialHappy: maxHappy,
                initialStat: currentStatVal,
                energyBudget: pick.energy,
                gym: { dots: pick.dots[stat], energy: pick.energy },
                stat,
                perks: perksByStat[stat],
                collectHistory: false
            });
            return r.totalGain;
        };

        const statsNow = { ...currentStats };
        const trainCounts = { strength: 0, defense: 0, speed: 0, dexterity: 0 };
        const totalGains  = { strength: 0, defense: 0, speed: 0, dexterity: 0 };
        const trainQueue = [];
        const specialsInPool = pool.filter(g => g.specialKey);
        let phaseId = 0;
        let lastEligible = null;
        const MAX_TRAINS = 500000;
        let totalTrains = 0;

        const getRatioDiff = (stats) => {
            const tot = STAT_ORDER.reduce((s, k) => s + stats[k], 0);
            if (tot === 0) return STAT_ORDER.map(() => 0);
            return STAT_ORDER.map(s => targetRatioPct[s] - (stats[s] / tot * 100));
        };

        const meetsMet = (stats) => {
            const diffs = getRatioDiff(stats);
            if (b.mode === 'gym') {
                const keys = [b.gym1, b.gym2].filter(Boolean);
                if (!keys.every(k => SPECIAL_GYMS[k].check(stats))) return false;
                return diffs.every(d => Math.abs(d) < threshold);
            }
            return diffs.every(d => Math.abs(d) < threshold);
        };

        if (meetsMet(statsNow)) {
            out.appendChild(el('div', { class: 'tgc-info ok' }, 'You already meet the target ratio with your current stats!'));
            renderCurrentDistribution(out, statsNow, targetRatioPct);
            return;
        }

        while (totalTrains < MAX_TRAINS) {
            const diffs = getRatioDiff(statsNow);
            let maxDiff = -Infinity;
            let statToTrain = null;
            STAT_ORDER.forEach((s, i) => {
                if (diffs[i] > maxDiff) { maxDiff = diffs[i]; statToTrain = s; }
            });

            if (maxDiff < threshold) {
                if (b.mode !== 'gym') break;
                const keys = [b.gym1, b.gym2].filter(Boolean);
                if (keys.every(k => SPECIAL_GYMS[k].check(statsNow))) break;
            }

            if (!statToTrain) break;

            let eligible = '';
            for (const g of specialsInPool) {
                if (SPECIAL_GYMS[g.specialKey].check(statsNow)) eligible += g.id + ',';
            }
            if (eligible !== lastEligible) {
                if (lastEligible !== null) phaseId++;
                lastEligible = eligible;
            }

            const pick = bestGymForStat(pool, statToTrain, statsNow);
            if (!pick) break;
            const gain = gainOneTrain(statToTrain, statsNow[statToTrain], pick);
            if (gain <= 0) break;
            statsNow[statToTrain] += gain;
            trainCounts[statToTrain]++;
            totalGains[statToTrain] += gain;
            trainQueue.push({ stat: statToTrain, gymId: pick.id, gymName: pick.name, energy: pick.energy, gain, phase: phaseId });
            totalTrains++;
        }

        const finalTotal = STAT_ORDER.reduce((s, k) => s + statsNow[k], 0);
        const finalRatioPct = {};
        for (const s of STAT_ORDER) finalRatioPct[s] = (statsNow[s] / finalTotal) * 100;

        const totalTrainCount = trainQueue.length;
        const totalEnergyNeeded = trainQueue.reduce((s, t) => s + t.energy, 0);
        const days = packDays(trainQueue, dailyBudget);
        const totalDays = days.length;

        const usageMap = new Map();
        for (const t of trainQueue) {
            const key = t.gymId + '|' + t.stat;
            const rec = usageMap.get(key) || { gymId: t.gymId, gymName: t.gymName, stat: t.stat, trains: 0, energy: 0, gain: 0 };
            rec.trains++;
            rec.energy += t.energy;
            rec.gain += t.gain;
            usageMap.set(key, rec);
        }
        const usageRows = Array.from(usageMap.values()).sort((x, y) => y.trains - x.trains);
        const gymsUsed = new Set(usageRows.map(r => r.gymId)).size;
        const gymLabelForStat = (s) => {
            const rows = usageRows.filter(r => r.stat === s);
            if (!rows.length) return '-';
            if (rows.length === 1) return rows[0].gymName;
            return rows.map(r => `${r.gymName} x${fmtInt(r.trains)}`).join(', ');
        };

        out.appendChild(el('div', { class: 'tgc-section' },
            el('div', { class: 'tgc-section-title' }, 'Summary')
        ));

        const summaryGrid = el('div', { class: 'tgc-result' },
            el('div', { class: 'tgc-result-grid' },
                readout('Total trains', fmtInt(totalTrainCount), `${dailyBudget}E budget/day`, true),
                readout('Estimated days', fmtInt(totalDays), `${(totalDays / 365).toFixed(2)} years`),
                readout('Total energy', fmtInt(totalEnergyNeeded), `${gymsUsed} gym${gymsUsed !== 1 ? 's' : ''} used`),
                readout('Total stat gain', fmtBig(STAT_ORDER.reduce((s, k) => s + totalGains[k], 0)), 'across all stats')
            )
        );
        out.appendChild(summaryGrid);

        renderCurrentDistribution(out, statsNow, targetRatioPct);

        out.appendChild(el('div', { class: 'tgc-section', style: { marginTop: '14px' } },
            el('div', { class: 'tgc-section-title' }, 'Training breakdown')
        ));

        const row = (k, v, style) => el('div', { class: 'tgc-bd-row' }, el('span', {}, k), el('strong', style ? { style } : {}, v));
        out.appendChild(el('div', { class: 'tgc-result' },
            el('div', { class: 'tgc-result-grid' },
                ...STAT_ORDER.map(s => {
                    const diff = finalRatioPct[s] - targetRatioPct[s];
                    const diffStr = (diff >= 0 ? '+' : '') + diff.toFixed(1) + '%';
                    const idle = trainCounts[s] === 0;
                    return el('div', { class: 'tgc-stat-readout tgc-bd', style: { boxShadow: `inset 0 3px 0 ${STAT_COLORS[s]}` } },
                        el('div', { class: 'tgc-r-label', style: { color: STAT_COLORS[s], fontWeight: 700 } }, STAT_LABELS[s]),
                        el('div', { class: 'tgc-bd-value' }, fmtBig(statsNow[s])),
                        el('div', { class: 'tgc-hint' }, idle ? 'no training' : '+' + fmtBig(totalGains[s]) + ' gained'),
                        row('Trains', idle ? '-' : fmtInt(trainCounts[s])),
                        row('Gym', gymLabelForStat(s)),
                        row('Perks', '+' + ((perkTotalPct(s) - 1) * 100).toFixed(1) + '%'),
                        row('Final', finalRatioPct[s].toFixed(1) + '%'),
                        row('Target', targetRatioPct[s].toFixed(1) + '% (' + diffStr + ')',
                            { color: Math.abs(diff) <= threshold ? 'var(--tgc-good)' : 'var(--tgc-warn)' })
                    );
                })
            )
        ));

        if (totalTrainCount > 0) {
            buildDayPlan(out, days, dailyBudget);
        }
    }

    function renderCurrentDistribution(container, finalStats, targetRatioPct) {
        const a = state.apiData;
        const finalTotal = STAT_ORDER.reduce((s, k) => s + finalStats[k], 0);

        const makeBar = (stats, total, opacity) => {
            const bar = el('div', { class: 'tgc-ratio-bar' });
            for (const s of STAT_ORDER) {
                const pct = total > 0 ? (stats[s] / total) : 0.25;
                bar.appendChild(el('span', {
                    style: { background: STAT_COLORS[s], flex: String(Math.max(pct, 0.001)), opacity: opacity || '1' },
                    title: `${STAT_LABELS[s]}: ${(pct * 100).toFixed(1)}%`
                }));
            }
            return bar;
        };

        const targetBar = el('div', { class: 'tgc-ratio-bar' });
        for (const s of STAT_ORDER) {
            targetBar.appendChild(el('span', {
                style: { background: STAT_COLORS[s], flex: String(Math.max(targetRatioPct[s] || 0.001, 0.001)), opacity: '0.55' },
                title: `${STAT_LABELS[s]}: ${(targetRatioPct[s] || 0).toFixed(1)}%`
            }));
        }

        const label = (txt) => el('div', { style: { fontSize: '10px', color: 'var(--tgc-muted)', marginBottom: '3px' } }, txt);

        const wrap = el('div', { style: { marginTop: '10px', marginBottom: '4px' } });

        if (a.loaded && a.stats) {
            const curTotal = STAT_ORDER.reduce((s, k) => s + (a.stats[k] || 0), 0);
            wrap.appendChild(label('Current'));
            wrap.appendChild(makeBar(a.stats, curTotal, '1'));
        }

        wrap.appendChild(el('div', { style: { marginTop: '6px' } }));
        wrap.appendChild(label('After plan'));
        wrap.appendChild(makeBar(finalStats, finalTotal, '1'));

        wrap.appendChild(el('div', { style: { marginTop: '6px' } }));
        wrap.appendChild(label('Target'));
        wrap.appendChild(targetBar);

        container.appendChild(wrap);
    }

    function buildDayPlan(container, days, dailyBudget) {
        if (!days.length) return;

        container.appendChild(el('div', { class: 'tgc-section', style: { marginTop: '14px' } },
            el('div', { class: 'tgc-section-title' }, 'Day-by-day plan')
        ));

        const summariseDay = (day) => {
            const rows = [];
            const index = {};
            for (const t of day.items) {
                const key = t.stat + '|' + t.gymId;
                if (index[key] === undefined) {
                    index[key] = rows.length;
                    rows.push({ stat: t.stat, gymId: t.gymId, gymName: t.gymName, trains: 0, energy: 0, gain: 0 });
                }
                const r = rows[index[key]];
                r.trains++;
                r.energy += t.energy;
                r.gain += t.gain;
            }
            return rows;
        };

        const blocks = [];
        days.forEach((day, idx) => {
            const rows = summariseDay(day);
            const sig = rows.map(r => r.stat + ':' + r.gymId + ':' + r.trains).sort().join('|');
            let block = blocks[blocks.length - 1];
            if (!block || block.sig !== sig) {
                block = {
                    sig, start: idx + 1, end: idx + 1, days: 0, energy: 0, trains: 0, rows: new Map(),
                    minDayTrains: day.items.length, maxDayTrains: day.items.length,
                    minDayEnergy: day.energy, maxDayEnergy: day.energy
                };
                blocks.push(block);
            }
            block.end = idx + 1;
            block.days++;
            block.energy += day.energy;
            if (day.items.length < block.minDayTrains) block.minDayTrains = day.items.length;
            if (day.items.length > block.maxDayTrains) block.maxDayTrains = day.items.length;
            if (day.energy < block.minDayEnergy) block.minDayEnergy = day.energy;
            if (day.energy > block.maxDayEnergy) block.maxDayEnergy = day.energy;
            for (const r of rows) {
                const key = r.stat + '|' + r.gymId;
                const acc = block.rows.get(key) || {
                    stat: r.stat, gymName: r.gymName, trains: 0, energy: 0, gain: 0,
                    minTrains: r.trains, maxTrains: r.trains
                };
                acc.trains += r.trains;
                acc.energy += r.energy;
                acc.gain += r.gain;
                if (r.trains < acc.minTrains) acc.minTrains = r.trains;
                if (r.trains > acc.maxTrains) acc.maxTrains = r.trains;
                block.rows.set(key, acc);
                block.trains += r.trains;
            }
        });

        const range = (lo, hi, suffix) => (lo === hi ? `${fmtInt(lo)}${suffix}` : `${fmtInt(lo)}-${fmtInt(hi)}${suffix}`);

        const MAX_BLOCKS_SHOWN = 40;
        const blocksToShow = Math.min(blocks.length, MAX_BLOCKS_SHOWN);

        for (let i = 0; i < blocksToShow; i++) {
            const b = blocks[i];
            const multi = b.days > 1;
            const label = multi ? `Days ${b.start} - ${b.end}` : `Day ${b.start}`;

            const rows = Array.from(b.rows.values())
                .sort((x, y) => y.trains - x.trains)
                .map(r => {
                    const perTrain = Math.round(r.energy / r.trains);
                    return {
                        stat: r.stat,
                        gymName: r.gymName,
                        gain: r.gain,
                        minTrains: r.minTrains,
                        maxTrains: r.maxTrains,
                        minEnergy: r.minTrains * perTrain,
                        maxEnergy: r.maxTrains * perTrain
                    };
                });

            const headMinTrains = b.minDayTrains;
            const headMaxTrains = b.maxDayTrains;
            const headMinEnergy = b.minDayEnergy;
            const headMaxEnergy = b.maxDayEnergy;

            const dayCard = el('div', { class: 'tgc-balance-day' });
            dayCard.appendChild(el('div', { class: 'tgc-balance-day-head' },
                el('span', { class: 'tgc-day-label' }, label),
                el('span', {}, `${fmtInt(b.days)} day${b.days !== 1 ? 's' : ''} · ${range(headMinTrains, headMaxTrains, '')} trains/day · ${range(headMinEnergy, headMaxEnergy, 'E')}/day`)
            ));

            const dayBody = el('div', { class: 'tgc-balance-day-body' });
            for (const r of rows) {
                dayBody.appendChild(el('div', { class: 'tgc-balance-train-row' },
                    el('span', {
                        class: 'tgc-btn-stat',
                        style: { background: STAT_COLORS[r.stat] }
                    }, STAT_SHORT[r.stat]),
                    el('span', { class: 'tgc-train-detail' },
                        `${range(r.minTrains, r.maxTrains, '')}/day · ${range(r.minEnergy, r.maxEnergy, 'E')}/day · `,
                        el('span', { class: 'tgc-train-gym' }, r.gymName)
                    ),
                    el('span', { class: 'tgc-train-gain' }, '+' + fmtBig(r.gain) + (multi ? ' total' : ''))
                ));
            }

            dayCard.appendChild(dayBody);
            container.appendChild(dayCard);
        }

        if (blocks.length > MAX_BLOCKS_SHOWN) {
            const restDays = days.length - blocks[MAX_BLOCKS_SHOWN - 1].end;
            container.appendChild(el('div', { class: 'tgc-info', style: { marginTop: '6px' } },
                `Showing the first ${MAX_BLOCKS_SHOWN} phases. ${fmtInt(restDays)} further day${restDays !== 1 ? 's' : ''} follow on the same ${dailyBudget}E budget.`
            ));
        }
    }

    function renderCompareTab() {
        const c = state.calc;

        if (!state.apiData.loaded) {
            bodyEl.append(statusEl, notLoadedInfo());
            return;
        }

        const perks = getActivePerks(c);
        const rows = [];
        for (const [id, raw] of Object.entries(state.apiData.gyms)) {
            const dots = raw[c.stat] || 0;
            if (dots === 0) continue;
            const gym = { dots, energy: raw.energy };
            const single = calcGain({ S: c.statTotal, H: c.happy, G: dots / 10, E: raw.energy, stat: c.stat, perks });
            const sess = simulateSession({
                initialHappy: c.happy, initialStat: c.statTotal, energyBudget: c.energy,
                gym, stat: c.stat, perks, collectHistory: false
            });
            const energySpent = sess.trains * raw.energy;
            const perE = energySpent > 0 ? sess.totalGain / energySpent : 0;
            const locked = !isGymUnlocked(id);
            rows.push({
                id: parseInt(id, 10), name: raw.name + (locked ? ' (locked)' : ''), energy: raw.energy, dots: dots / 10,
                single, session: sess.totalGain, trains: sess.trains, perE, locked
            });
        }
        rows.sort((a, b) => (a.locked - b.locked) || b.session - a.session);
        const winner = rows.find(r => !r.locked) || rows[0];

        const tbl = el('table', { class: 'tgc-table tgc-cards' },
            el('thead', {},
                el('tr', {},
                    el('th', {}, 'Gym'),
                    el('th', { class: 'num-d' }, 'Dots'),
                    el('th', { class: 'num-d' }, 'E'),
                    el('th', { class: 'num' }, 'Per train'),
                    el('th', { class: 'num' }, 'Per session'),
                    el('th', { class: 'num' }, '/ E')
                )
            ),
            el('tbody', {},
                ...rows.slice(0, 30).map(r => {
                    const classes = [];
                    if (r === winner) classes.push('winner');
                    if (r.id === c.gymId) classes.push('current');
                    return el('tr', { class: classes.join(' ') },
                        el('td', {}, (r.id === c.gymId ? '\u2605 ' : '') + r.name),
                        el('td', { class: 'num-d', 'data-label': 'Dots' }, r.dots.toFixed(1)),
                        el('td', { class: 'num-d', 'data-label': 'Energy' }, String(r.energy)),
                        el('td', { class: 'num', 'data-label': 'Per train' }, fmtBig(r.single)),
                        el('td', { class: 'num', 'data-label': 'Per session' }, fmtBig(r.session)),
                        el('td', { class: 'num', 'data-label': 'Per energy' }, fmtBig(r.perE))
                    );
                })
            )
        );

        bodyEl.append(
            statusEl,
            el('div', { class: 'tgc-info' },
                `${STAT_LABELS[c.stat]} · ${fmtBig(c.statTotal)} stat · ${fmtInt(c.happy)} happy · ${fmtInt(c.energy)} energy. Sorted by per-session gain. \u2605 = current.`
            ),
            el('div', { class: 'tgc-tscroll' }, tbl)
        );
    }

    function renderSettingsTab() {
        const apiInput = el('input', {
            type: 'text',
            value: state.apiKey,
            placeholder: 'Paste your API key here',
            spellcheck: 'false',
            autocomplete: 'off',
            autocorrect: 'off',
            autocapitalize: 'off'
        });
        apiInput.addEventListener('input', () => { state.apiKey = apiInput.value.trim(); persist(); });

        const loadBtn = el('button', {
            class: 'tgc-btn full',
            type: 'button',
            onclick: () => loadFromApi()
        }, 'Load everything from API');

        const cacheInfo = el('div', { class: 'tgc-info', id: 'tgc-cache-info' });
        renderCacheInfoInto(cacheInfo);

        const clearBtn = el('button', {
            class: 'tgc-btn secondary',
            type: 'button',
            onclick: () => {
                if (!clearBtn.dataset.armed) {
                    clearBtn.dataset.armed = '1';
                    clearBtn.textContent = 'Tap again to confirm';
                    setTimeout(() => {
                        delete clearBtn.dataset.armed;
                        clearBtn.textContent = 'Reset everything';
                    }, 3000);
                    return;
                }
                Storage.del(STORAGE_KEY);
                state = clone(defaultState);
                state.apiKey = PDA_KEY;
                unlockedGymIdsCache = null;
                if (!state.apiKey) state.currentTab = 'settings';
                renderTab();
                setStatus('Reset complete', 'ok');
            }
        }, 'Reset everything');

        const a = state.apiData;
        const stat = state.calc.stat;
        const propEff = a.loaded ? statBonusFor(a.parsedPerks.property, stat) : 0;
        const jobEff  = a.loaded ? statBonusFor(a.parsedPerks.job, stat)      : 0;
        const bookEff = a.loaded ? statBonusFor(a.parsedPerks.book, stat)     : 0;

        const pStat = (m, k) => `${m[k] || 0}`;
        const allStats = m => `${pStat(m,'strength')}/${pStat(m,'defense')}/${pStat(m,'speed')}/${pStat(m,'dexterity')}`;
        const allStatsGen = m => `${allStats(m)}/${m.general || 0}`;

        const summaryRows = a.loaded ? [
            ['Active gym',       (a.gyms && a.gyms[a.activeGym] && a.gyms[a.activeGym].name) || '-'],
            ['Max happy',        fmtInt(a.maxHappy)],
            ['Max energy',       fmtInt(a.maxEnergy)],
            ['STR / DEF / SPD / DEX',
                `${fmtBig(a.stats.strength)} / ${fmtBig(a.stats.defense)} / ${fmtBig(a.stats.speed)} / ${fmtBig(a.stats.dexterity)}`],
            [`Property (eff. ${STAT_SHORT[stat]})`, `${propEff}% (S/D/Sp/Dx/gen ${allStatsGen(a.parsedPerks.property)})`],
            ['Edu general',      fmtPct(a.parsedPerks.education.general || 0)],
            ['Edu by stat (S/D/Sp/Dx)', `${allStats(a.parsedPerks.education)}%`],
            ['Steadfast (S/D/Sp/Dx)',   `${allStats(a.parsedPerks.factionSteadfast)}%`],
            ['Faction candy',    fmtPct(a.parsedPerks.factionCandy)],
            [`Job (eff. ${STAT_SHORT[stat]})`,  `${jobEff}% (S/D/Sp/Dx/gen ${allStatsGen(a.parsedPerks.job)})`],
            [`Book (eff. ${STAT_SHORT[stat]})`, `${bookEff}% (S/D/Sp/Dx/gen ${allStatsGen(a.parsedPerks.book)})`]
        ] : [];

        const summary = a.loaded
            ? el('table', { class: 'tgc-table tgc-kv' },
                el('tbody', {},
                    ...summaryRows.map(([k, v]) => el('tr', {},
                        el('td', {}, k),
                        el('td', { class: 'num' }, v)
                    ))
                )
            )
            : el('div', { class: 'tgc-info' }, 'Click Load to pull everything.');

        bodyEl.append(
            statusEl,
            el('div', { class: 'tgc-cols even' },
                el('div', {},
                    el('div', { class: 'tgc-section' },
                        el('div', { class: 'tgc-section-title' }, 'API key'),
                        el('div', { class: 'tgc-info' },
                            'No key yet? Press ', el('strong', {}, 'Create API key'), '. Torn opens with exactly the permissions this script needs already ticked. Confirm, copy the key, paste it below.'
                        ),
                        el('div', { class: 'tgc-actions', style: { marginTop: '0', marginBottom: '10px' } }, keyButton()),
                        el('div', { class: 'tgc-row r1' }, field('Key', apiInput)),
                        el('div', { style: { marginTop: '10px' } }, loadBtn),
                        el('div', { class: 'tgc-info' },
                            'Your key is stored only in your userscript manager and is sent only to api.torn.com. In Torn PDA the key is filled in automatically.'
                        )
                    ),
                    el('div', { class: 'tgc-section' },
                        el('div', { class: 'tgc-section-title' }, 'Cache and limits'),
                        cacheInfo,
                        el('div', { class: 'tgc-actions' }, buildGithubBtn(), clearBtn)
                    )
                ),
                el('div', {},
                    el('div', { class: 'tgc-section' },
                        el('div', { class: 'tgc-section-title' }, 'What was loaded'),
                        summary
                    )
                )
            )
        );
    }

    function renderCacheInfoInto(node) {
        const a = state.apiData;
        node.innerHTML = '';
        node.append(
            `Last load: ${timeAgo(a.loadedAt)}`, el('br'),
            `Gyms cached: ${a.gyms ? Object.keys(a.gyms).length : 0}`, el('br'),
            `API calls last 60s: ${api.callTimes.length} / ${RATE_LIMIT}`
        );
    }

    async function loadFromApi() {
        if (!state.apiKey) {
            setStatus('Add your API key first', 'warn');
            setTab('settings');
            return;
        }
        try {
            setStatus('Loading gyms...');
            const gymsRes = await api.raw('/v2/torn/gyms');
            setStatus('Loading user data...');
            const userRes = await api.raw('/v2/user?selections=bars,gym,perks,battlestats');

            const a = state.apiData;
            a.gyms = normalizeGyms(gymsRes.gyms);
            if (!Object.keys(a.gyms).length) throw new Error('Gym list came back in an unrecognised shape');
            const bs = userRes.battlestats || {};
            const statVal = k => (bs[k] && bs[k].value) || 0;
            a.stats = {
                strength:  statVal('strength'),
                defense:   statVal('defense'),
                speed:     statVal('speed'),
                dexterity: statVal('dexterity')
            };
            const bars = userRes.bars || {};
            a.maxHappy = (bars.happy && bars.happy.maximum) || 99999;
            a.maxEnergy = (bars.energy && bars.energy.maximum) || 150;
            a.activeGym = (userRes.gym && userRes.gym.id) || null;
            const unlocked = (userRes.gym && userRes.gym.unlocked_gyms) || [];
            a.unlockedGyms = unlocked.filter(g => g && g.available !== false).map(g => g.id);
            a.parsedPerks = parsePerks(userRes.perks || {});
            a.loaded = true;
            a.loadedAt = Date.now();

            applyApiData();
            persist();
            const activeName = (a.gyms[a.activeGym] && a.gyms[a.activeGym].name) || 'no gym';
            const totalBs = STAT_ORDER.reduce((s, k) => s + (a.stats[k] || 0), 0);
            setStatus(`Loaded · total BS ${fmtBig(totalBs)} · ${activeName}`, 'ok');
            renderTab();
        } catch (e) {
            setStatus(e.message || 'Load failed', 'error');
        }
    }

    function svgEl(tag, attrs = {}, style) {
        const n = document.createElementNS(SVG_NS, tag);
        for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
        if (style) Object.assign(n.style, style);
        return n;
    }

    function niceScale(lo, hi, count = 5) {
        if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1; }
        if (hi === lo) { const pad = Math.abs(hi) * 0.05 || 1; lo -= pad; hi += pad; }
        const raw = (hi - lo) / Math.max(1, count);
        const mag = Math.pow(10, Math.floor(Math.log10(raw)));
        const n = raw / mag;
        const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
        const a = Math.floor(lo / step) * step;
        const b = Math.ceil(hi / step) * step;
        const ticks = [];
        for (let i = 0, v = a; v <= b + step * 1e-6 && i < 50; i++, v = a + i * step) ticks.push(v);
        return { lo: a, hi: b, ticks };
    }

    const fmtAxis = v => Math.abs(v) < 1000 ? fmt(v) : fmtBig(v).replace(/\.?0+([KMBT])$/, '$1');

    let chartSeq = 0;

    function lineChart(host, cfg) {
        if (!host) return;
        host.innerHTML = '';
        const xs = cfg.x || [];
        const series = cfg.series.filter(s => s.data && s.data.length);
        if (xs.length < 2 || !series.length) return;

        const legend = el('div', { class: 'tgc-legend' });
        const plot = el('div', { class: 'tgc-plot' });
        const tip = el('div', { class: 'tgc-tip' });
        tip.hidden = true;
        host.append(legend, plot);

        const off = new Set();
        const gid = 'tgc-grad-' + (++chartSeq);
        let geom = null;

        series.forEach((s, i) => {
            const b = el('button', { type: 'button', class: s.dash ? 'dash' : '', 'aria-pressed': 'true' },
                el('i', { style: { borderTopColor: s.color } }), s.label);
            b.addEventListener('click', () => {
                if (off.has(i)) off.delete(i); else off.add(i);
                b.classList.toggle('off', off.has(i));
                b.setAttribute('aria-pressed', String(!off.has(i)));
                draw();
            });
            legend.appendChild(b);
        });

        const scaleFor = (axis, count) => {
            let lo = Infinity, hi = -Infinity;
            series.forEach((s, i) => {
                if (off.has(i) || (s.axis || 'y') !== axis) return;
                for (const v of s.data) { if (v < lo) lo = v; if (v > hi) hi = v; }
            });
            if (lo === Infinity) return null;
            if (cfg.zeroBase && axis === 'y') lo = Math.min(0, lo);
            if (axis === 'y1') lo = Math.min(0, lo);
            return niceScale(lo, hi, count);
        };

        function draw() {
            const W = plot.clientWidth, H = plot.clientHeight;
            if (!W || !H) return;
            const compact = W < 520;
            const hasY1 = series.some((s, i) => s.axis === 'y1' && !off.has(i));
            const m = { l: compact ? 46 : 60, r: hasY1 ? (compact ? 42 : 52) : 14, t: 8, b: cfg.xLabel ? 36 : 22 };
            const iw = Math.max(10, W - m.l - m.r);
            const ih = Math.max(10, H - m.t - m.b);
            const sy = scaleFor('y', compact ? 4 : 5);
            const sy1 = hasY1 ? scaleFor('y1', compact ? 4 : 5) : null;
            const xMin = xs[0], xMax = xs[xs.length - 1];
            const X = v => m.l + (xMax === xMin ? iw / 2 : (v - xMin) / (xMax - xMin) * iw);
            const Y = (v, s) => m.t + ih - (v - s.lo) / (s.hi - s.lo) * ih;
            const bottom = m.t + ih;

            const svg = svgEl('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': cfg.label || 'Chart' });
            const defs = svgEl('defs');
            svg.appendChild(defs);

            if (sy) {
                for (const t of sy.ticks) {
                    const y = Math.round(Y(t, sy)) + 0.5;
                    svg.appendChild(svgEl('line', { class: 'tgc-grid', x1: m.l, x2: m.l + iw, y1: y, y2: y }));
                    const tx = svgEl('text', { class: 'tgc-axis-text', x: m.l - 6, y: y + 3, 'text-anchor': 'end' });
                    tx.textContent = (cfg.yFmt || fmtAxis)(t);
                    svg.appendChild(tx);
                }
            }
            if (sy1) {
                for (const t of sy1.ticks) {
                    const tx = svgEl('text', { class: 'tgc-axis-text', x: m.l + iw + 6, y: Y(t, sy1) + 3, 'text-anchor': 'start' });
                    tx.textContent = fmtAxis(t);
                    svg.appendChild(tx);
                }
            }
            const by = Math.round(bottom) + 0.5;
            svg.appendChild(svgEl('line', { class: 'tgc-axis', x1: m.l, x2: m.l + iw, y1: by, y2: by }));
            const xt = niceScale(xMin, xMax, compact ? 4 : 7).ticks.filter(v => v >= xMin && v <= xMax);
            for (const t of xt) {
                const x = Math.round(X(t)) + 0.5;
                svg.appendChild(svgEl('line', { class: 'tgc-axis', x1: x, x2: x, y1: by, y2: by + 4 }));
                const tx = svgEl('text', { class: 'tgc-axis-text', x, y: by + 15, 'text-anchor': 'middle' });
                tx.textContent = fmtAxis(t);
                svg.appendChild(tx);
            }
            if (cfg.xLabel) {
                const tx = svgEl('text', { class: 'tgc-axis-title', x: m.l + iw / 2, y: H - 3, 'text-anchor': 'middle' });
                tx.textContent = cfg.xLabel;
                svg.appendChild(tx);
            }

            const hover = svgEl('g', {}, { display: 'none' });
            const vline = svgEl('line', { class: 'tgc-cross', y1: m.t, y2: bottom });
            hover.appendChild(vline);
            const dots = [];

            series.forEach((s, i) => {
                if (off.has(i)) return;
                const sc = s.axis === 'y1' ? sy1 : sy;
                if (!sc) return;
                let d = '';
                for (let k = 0; k < s.data.length; k++) {
                    d += (k ? 'L' : 'M') + X(xs[k]).toFixed(1) + ',' + Y(s.data[k], sc).toFixed(1);
                }
                if (s.fill) {
                    const g = svgEl('linearGradient', { id: gid + '-' + i, x1: 0, y1: 0, x2: 0, y2: 1 });
                    g.appendChild(svgEl('stop', { offset: '0%' }, { stopColor: s.color, stopOpacity: 0.35 }));
                    g.appendChild(svgEl('stop', { offset: '100%' }, { stopColor: s.color, stopOpacity: 0 }));
                    defs.appendChild(g);
                    const last = X(xs[s.data.length - 1]).toFixed(1);
                    svg.appendChild(svgEl('path', { d: `${d}L${last},${bottom}L${X(xs[0]).toFixed(1)},${bottom}Z`, fill: `url(#${gid}-${i})` }));
                }
                svg.appendChild(svgEl('path', {
                    d, fill: 'none',
                    'stroke-width': s.width || 2,
                    'stroke-linejoin': 'round',
                    'stroke-linecap': 'round',
                    'stroke-dasharray': s.dash ? '6 4' : null
                }, { stroke: s.color }));
                const dot = svgEl('circle', { class: 'tgc-dot', r: 4 }, { fill: s.color });
                hover.appendChild(dot);
                dots.push({ s, sc, dot });
            });
            svg.appendChild(hover);
            plot.replaceChildren(svg, tip);
            tip.hidden = true;
            geom = { X, Y, m, iw, W, hover, vline, dots };
        }

        const hide = () => {
            tip.hidden = true;
            if (geom) geom.hover.style.display = 'none';
        };
        const onMove = e => {
            if (!geom) return;
            const r = plot.getBoundingClientRect();
            const px = e.clientX - r.left;
            if (px < geom.m.l - 12 || px > geom.m.l + geom.iw + 12) { hide(); return; }
            let k = 0, best = Infinity;
            for (let j = 0; j < xs.length; j++) {
                const dx = Math.abs(geom.X(xs[j]) - px);
                if (dx < best) { best = dx; k = j; }
            }
            const x = geom.X(xs[k]);
            geom.vline.setAttribute('x1', x);
            geom.vline.setAttribute('x2', x);
            const rows = [];
            for (const { s, sc, dot } of geom.dots) {
                const v = s.data[k];
                dot.setAttribute('cx', x);
                dot.setAttribute('cy', geom.Y(v, sc));
                rows.push(el('div', {},
                    el('span', {}, el('i', { style: { background: s.color } }), s.label),
                    el('strong', {}, (s.fmt || fmtBig)(v))
                ));
            }
            if (!rows.length) { hide(); return; }
            geom.hover.style.display = '';
            tip.replaceChildren(el('b', {}, (cfg.xFmt || fmtInt)(xs[k])), ...rows);
            tip.hidden = false;
            let left = x + 12;
            if (left + tip.offsetWidth > geom.W) left = x - 12 - tip.offsetWidth;
            tip.style.left = Math.max(0, left) + 'px';
            tip.style.top = geom.m.t + 'px';
        };
        plot.addEventListener('pointermove', onMove);
        plot.addEventListener('pointerdown', onMove);
        plot.addEventListener('pointerleave', hide);

        if (typeof ResizeObserver === 'function') {
            const ro = new ResizeObserver(() => {
                if (!host.isConnected) { ro.disconnect(); return; }
                draw();
            });
            ro.observe(plot);
        }
        draw();
    }

    function init() {
        if (!document.body) return;
        injectStyles();
        if (!state.apiKey) state.currentTab = 'settings';
        document.body.appendChild(buildModal());

        mountLauncher();
        new MutationObserver(() => {
            if (!launcherEl || !launcherEl.isConnected || launcherEl.classList.contains('floating')) mountLauncher();
        }).observe(document.body, { childList: true, subtree: true });
        setTimeout(() => {
            if (mountLauncher()) return;
            if (!launcherEl) launcherEl = buildLauncher();
            launcherEl.classList.add('floating');
            document.body.appendChild(launcherEl);
        }, 3000);

        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && overlayEl && !overlayEl.hidden) closeModal();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
