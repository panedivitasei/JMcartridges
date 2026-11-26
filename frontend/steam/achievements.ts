// Achievements for non-Steam games in Steam's own views: Steam asks its query cache for them, and for a non-Steam game the plugin answers.
import { isShortcut, unsigned } from "./library.ts";
import { resolveAll, resolveOnce } from "./modules.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** One achievement as the backend sends it; `unlocked` is seconds since 1970, 0 while locked. */
export interface AchItem {
    id: string;
    name: string;
    description: string;
    icon: string;
    icon_locked: string;
    unlocked: number;
    pct: number;
}

/** Steam's number for a game's one set of achievements. */
const BASE_GROUP = 0;

const held = new Map<number, AchItem[]>();
let report: (where: string, err: unknown) => void = () => undefined;

/** The achievements out of what the backend sent; anything malformed is left out. */
export function readItems(value: unknown): AchItem[] {
    const out: AchItem[] = [];
    for (const v of Array.isArray(value) ? (value as Record<string, unknown>[]) : []) {
        if (!v || typeof v.id !== "string" || typeof v.name !== "string") continue;
        out.push({
            id: v.id,
            name: v.name,
            description: typeof v.description === "string" ? v.description : "",
            icon: typeof v.icon === "string" ? v.icon : "",
            icon_locked: typeof v.icon_locked === "string" ? v.icon_locked : "",
            unlocked: typeof v.unlocked === "number" && v.unlocked > 0 ? Math.floor(v.unlocked) : 0,
            pct: typeof v.pct === "number" && v.pct >= 0 ? Math.min(100, v.pct) : 0,
        });
    }
    return out;
}

export function hasAchievements(appid: number): boolean {
    return (held.get(unsigned(appid))?.length ?? 0) > 0;
}

/** The list Steam's views read: one set, each achievement numbered by its place. */
export function schemaOf(appid: number, items: readonly AchItem[]): unknown {
    const achievements = items.map((item, i) => ({
        internal_key: i + 1,
        api_name: item.id,
        name: item.name,
        description: item.description,
        hidden: false,
        archived: false,
        icon_achieved: item.icon || undefined,
        icon_unachieved: item.icon_locked || item.icon || undefined,
        groupid: BASE_GROUP,
    }));
    const groups = achievements.length ? [{ id: BASE_GROUP, archived: false, developeronly: false, ispublic: true, dlcappid: 0, order: -1, achievements }] : [];
    return { appid, language: "english", groups, schema_hash: 0, schema_version: 0 };
}

/** How many players have each achievement, by its number. */
export function percentagesOf(items: readonly AchItem[]): unknown {
    const percentages: Record<number, number> = {};
    items.forEach((item, i) => (percentages[i + 1] = item.pct));
    return { percentages };
}

/** A player's unlocks; another player than the one signed in has none. */
export function userOf(appid: number, steamid: string, items: readonly AchItem[], mine: boolean): unknown {
    const achievements: Record<number, { internal_key: number; unlocked: boolean; unlock_time: number }> = {};
    const groups: Record<number, unknown> = {};
    if (mine && items.length > 0) {
        let unlocked = 0;
        let last = 0;
        items.forEach((item, i) => {
            achievements[i + 1] = { internal_key: i + 1, unlocked: item.unlocked > 0, unlock_time: item.unlocked };
            if (item.unlocked > 0) unlocked++;
            last = Math.max(last, item.unlocked);
        });
        const completed = unlocked === items.length;
        groups[BASE_GROUP] = { groupid: BASE_GROUP, is_achievable: true, completed_achievements: unlocked, is_completed: completed, time_completed: completed ? last : undefined };
    }
    return { appid, steamid, achievements, groups, schema_hash: 0 };
}

/** The signed-in player's 64-bit id as text, or undefined while Steam has not said. */
function currentSteamId(): string | undefined {
    try {
        const id = (window as any).App?.m_CurrentUser?.strSteamID;
        return typeof id === "string" && /^\d+$/.test(id) && id !== "0" ? id : undefined;
    } catch {
        return undefined;
    }
}

/** What one of Steam's achievement queries is answered with, or undefined for a query that is not about a non-Steam game. */
export function answerFor(key: unknown): (() => unknown) | undefined {
    if (!Array.isArray(key) || key[0] !== "achievements" || !isShortcut(key[1])) return undefined;
    const appid = key[1];
    const items = () => held.get(unsigned(appid)) ?? [];
    if (key[2] === "schema") return () => schemaOf(appid, items());
    if (key[2] === "globalpercentages") return () => percentagesOf(items());
    if (key[2] === "user_achievements" && typeof key[3] === "string") {
        const steamid = key[3];
        return () => userOf(appid, steamid, items(), steamid === (currentSteamId() ?? steamid));
    }
    return undefined;
}

interface QueryClient {
    getQueryCache(): { getAll(): unknown[]; build(client: unknown, options: { queryKey: unknown[] }): unknown; remove(query: unknown): void };
    invalidateQueries(filters: { queryKey: unknown[] }): Promise<unknown>;
}

let clients: QueryClient[] = [];

/** Steam's query clients, found among its modules by what a client can do. */
function queryClients(): QueryClient[] {
    if (clients.length === 0) {
        clients = resolveAll<QueryClient>(
            (v: any) => !!v && typeof v === "object" && typeof v.getQueryCache === "function" && typeof v.invalidateQueries === "function",
            (source) => source.includes("defaultOptions") && source.includes("staleTime"),
        );
    }
    return clients;
}

let queriesHooked = false;

/** Every query of Steam's takes its options through this: one about a non-Steam game's achievements is answered here and left out of Steam's saved cache. */
function hookQueries(): boolean {
    if (queriesHooked) return true;
    const client = queryClients()[0];
    if (!client) return false;
    const cache = client.getQueryCache();
    let probe = cache.getAll()[0];
    let made = false;
    if (!probe) {
        probe = cache.build(client, { queryKey: ["jm-probe"] });
        made = true;
    }
    const proto = Object.getPrototypeOf(probe);
    if (made) cache.remove(probe);
    if (!proto || typeof proto.setOptions !== "function" || typeof proto.fetch !== "function") return false;
    if (!proto.__jm_achievements) {
        const setOptions = proto.setOptions;
        const fetch = proto.fetch;
        proto.setOptions = function (this: any, options: any): unknown {
            let next = options;
            try {
                const answer = options && answerFor(options.queryKey ?? this.queryKey);
                if (answer) next = { ...options, queryFn: answer, meta: undefined, persister: undefined, retry: false };
            } catch (err) {
                report("achievement query", err);
            }
            return setOptions.call(this, next);
        };
        proto.fetch = function (this: any, options: any, fetchOptions: unknown): unknown {
            // A fetch that brings no options would run the ones the query was made with.
            let next = options;
            try {
                if (!options && answerFor(this.queryKey)) next = this.options;
            } catch (err) {
                report("achievement fetch", err);
            }
            return fetch.call(this, next, fetchOptions);
        };
        proto.__jm_achievements = true;
    }
    queriesHooked = true;
    return true;
}

/** One achievement as Steam's older store holds it. */
function storeItem(item: AchItem): Record<string, unknown> {
    const unlocked = item.unlocked > 0;
    return {
        strID: item.id,
        strName: item.name,
        strDescription: item.description,
        strImage: unlocked ? item.icon : item.icon_locked || item.icon,
        bAchieved: unlocked,
        bHidden: false,
        rtUnlocked: item.unlocked,
        flAchieved: item.pct,
        flCurrentProgress: 0,
    };
}

/** Writes a game's achievements into Steam's older store, which some views still read. */
function fillStore(store: any, appid: number): void {
    const achieved: Record<string, unknown> = {};
    const unachieved: Record<string, unknown> = {};
    const global: Record<string, number> = {};
    for (const item of held.get(unsigned(appid)) ?? []) {
        (item.unlocked > 0 ? achieved : unachieved)[item.id] = storeItem(item);
        global[item.id] = item.pct;
    }
    store.m_mapMyAchievements.set(appid, { data: { achieved, unachieved, hidden: {} } });
    store.m_mapGlobalAchievements.set(appid, { data: global });
}

let fullStore: any;

/** Steam's older achievements store answers a non-Steam game from here and never asks the client for it. */
function hookStore(): boolean {
    if (fullStore) return true;
    const store = resolveOnce<any>(
        "achievements store",
        (v: any) => !!v && typeof v === "object" && typeof v.LoadMyAchievements === "function" && typeof v.GetMyAchievements === "function" && !!v.m_mapMyAchievements && !!v.m_mapGlobalAchievements,
        (source) => source.includes("LoadMyAchievements"),
    );
    const proto = store && Object.getPrototypeOf(store);
    if (!proto || typeof proto.LoadMyAchievements !== "function") return false;
    if (!proto.__jm_achievements) {
        const load = proto.LoadMyAchievements;
        proto.LoadMyAchievements = function (this: any, appid: unknown): unknown {
            try {
                if (isShortcut(appid)) {
                    fillStore(this, appid);
                    this.m_mapInflightMyAchievementsRequests?.delete?.(appid);
                    return Promise.resolve();
                }
            } catch (err) {
                report("achievements store", err);
            }
            return load.call(this, appid);
        };
        proto.__jm_achievements = true;
    }
    fullStore = store;
    return true;
}

/** Gives a game its achievements, or takes them away; Steam's views that show them are asked to read them again. True when something changed. */
export function setAchievements(appid: number, items: readonly AchItem[] | undefined): boolean {
    const id = unsigned(appid);
    const before = JSON.stringify(held.get(id) ?? []);
    if (items && items.length > 0) held.set(id, [...items]);
    else held.delete(id);
    if (JSON.stringify(held.get(id) ?? []) === before) return false;
    refresh(id);
    return true;
}

/** Takes every game's achievements away, for when they are switched off. */
export function clearAchievements(): void {
    const ids = [...held.keys()];
    held.clear();
    ids.forEach(refresh);
}

function refresh(id: number): void {
    for (const appid of [id, id | 0]) {
        for (const client of queryClients()) {
            try {
                void client.invalidateQueries({ queryKey: ["achievements", appid] }).catch(() => undefined);
            } catch (err) {
                report("achievement refresh", err);
            }
        }
        try {
            if (fullStore?.m_mapMyAchievements?.has?.(appid)) fillStore(fullStore, appid);
        } catch (err) {
            report("achievements store", err);
        }
    }
}

/** Puts the hooks in; Steam may not have its query client yet when the plugin starts, so it is tried for a while. */
export function installAchievements(opts: { report(where: string, err: unknown): void; note(message: string): void }): void {
    report = opts.report;
    let tries = 0;
    const attempt = () => {
        let queries = false;
        let store = false;
        try {
            queries = hookQueries();
            store = hookStore();
        } catch (err) {
            report("achievement hooks", err);
        }
        if (queries && store) return opts.note(`achievements: hooks in after ${tries + 1} look(s)`);
        if (++tries < 20) setTimeout(attempt, 3000);
        else opts.note(`achievements: queries ${queries ? "hooked" : "not found"}, store ${store ? "hooked" : "not found"}`);
    };
    attempt();
}
