// JMcartridges: frontend entry point.
import { createElement } from "react";
import { definePlugin, IconsModule } from "@steambrew/client";
import { call } from "./backend";
import { mainWindow, screenSize, showDialog } from "./steam/dialog";
import { clearAchievements, hasAchievements, installAchievements, readItems, setAchievements } from "./steam/achievements";
import { forgetMedia, hasFeed, installCommunity, knows, setMedia, showMedia, sizesKnown, type MediaItem, type Native } from "./steam/community";
import { SOURCE_ICONS } from "./steam/source-icons";
import { addSection, installGameInfo, onGameShown, redrawPages, setInfo } from "./steam/game-info";
import { accountId, clearLogoPosition, ensureLogoPosition, listGames, listSteamGames, steamApps, steamArt } from "./steam/library";
import { addPropertiesPage } from "./steam/properties";
import { CartridgePage, setCartridgeHost } from "./window/cartridge";
import { createHost } from "./window/host";
import { readInfo, type Info } from "./window/model";
import { JmSection, openIfNew, setEntry } from "./window/section";
import { errorText, TEXT } from "./window/text";
import { JmWindow } from "./window/window";

const log = (message: string) => void call("JmLog", { tag: "window", message }).catch(() => undefined);

let told = 0;

/** Makes sure the backend knows whose library this is: Steam names the account only after sign-in, and another one may sign in later. */
async function tellAccount(): Promise<void> {
    const account = accountId();
    if (account <= 0 || account === told) return;
    told = account;
    try {
        await call("JmSetAccount", { account });
    } catch {
        told = 0;
    }
}

const host = createHost({
    // Every call of the window goes out after the account, so the backend never reads another account's folder.
    call: async (name, payload) => {
        await tellAccount();
        return call(name, payload);
    },
    games: listGames,
    steamGames: listSteamGames,
    steamArt,
    steamApps,
    logo: { ensure: ensureLogoPosition, clear: clearLogoPosition },
    // A game's match changed with its info: what its page showed of the old match is forgotten.
    infoChanged: (appid, info) => {
        setMedia(appid, undefined);
        setInfo(appid, info);
    },
    showInfoChanged: (on) => void (showInfo = on),
    descLimitChanged: (limit) => {
        descLimit = limit;
        redrawPages();
    },
    // The sources that feed the pages changed: the game on screen is asked again at once, the others when their page is shown.
    mediaChanged: () => {
        forgetMedia();
        if (mediaGame) void askMedia(mediaGame);
    },
    achievementsChanged: () => void reloadAchievements(),
    log,
});

let showInfo = true;
let descLimit = 360;

/** Steam Cartridges hooks the same parts of Steam: while it runs, the games' pages are left to it. */
function otherPluginRuns(): boolean {
    const plugins = (window as unknown as { PLUGIN_LIST?: Record<string, unknown> }).PLUGIN_LIST ?? {};
    return !!(plugins["steam-cartridges"] || plugins["steam-cartridges-dev"]);
}

/** Game Info on the games' own pages. */
async function startGameInfo(): Promise<void> {
    if (otherPluginRuns()) return log("game pages: left alone, Steam Cartridges is running");
    const res = await call<{ games?: Record<string, unknown> }>("JmAllInfo").catch(() => undefined);
    const all: Record<string, Info> = {};
    for (const [appid, value] of Object.entries(res?.games && !Array.isArray(res.games) ? res.games : {})) {
        const info = readInfo(value);
        if (info) all[appid] = info;
    }
    installGameInfo({
        all,
        showByDefault: () => showInfo,
        descriptionLimit: () => descLimit,
        report: (where, err) => log(`game pages: ${where}: ${String((err as Error)?.message ?? err).slice(0, 120)}`),
        note: (message) => log(`game pages: ${message}`),
    });
}

/** Trailers, artwork and screenshots under Game Info, in Steam's own Community section. */
async function startCommunity(): Promise<void> {
    addSection("community", hasFeed);
    installCommunity({
        names: { igdb: TEXT.matchIgdb, thegamesdb: TEXT.sourceTheGamesDb, steam: TEXT.matchSteam },
        avatars: SOURCE_ICONS,
        report: (where, err) => log(`${where}: ${String((err as Error)?.message ?? err).slice(0, 120)}`),
        note: log,
        changed: redrawPages,
        sized: (appid, sizes) => void call("JmMediaSized", { appid, sizes }).catch(() => undefined),
    });
    const kept = await call<{ games?: Record<string, unknown> }>("JmAllMedia").catch(() => undefined);
    for (const [appid, list] of Object.entries(kept?.games && !Array.isArray(kept.games) ? kept.games : {})) {
        if (!Array.isArray(list)) continue;
        setMedia(Number(appid), list as MediaItem[]);
        // A game whose sizes are all kept has its cards before its page is opened.
        if (sizesKnown(list as MediaItem[])) void showMedia(Number(appid));
    }
    // A game's media is asked for the first time its page is shown, and kept from then on.
    onGameShown((appid) => {
        mediaGame = appid;
        void askMedia(appid);
    });
}

/** The game whose page was shown last, for its media. */
let mediaGame = 0;

/** Gets a game's media unless it is known, and makes its cards. */
async function askMedia(appid: number): Promise<void> {
    try {
        log(`community: page ${appid}, media ${knows(appid) ? "known" : "asked"}`);
        if (!knows(appid)) {
            await tellAccount();
            const got = await call<{ items?: unknown; native?: Native }>("JmMedia", { appid }).catch(() => undefined);
            if (!got) return;
            setMedia(appid, Array.isArray(got.items) ? (got.items as MediaItem[]) : [], got.native);
        }
        await showMedia(appid);
    } catch (err) {
        log(`community: ${String((err as Error)?.message ?? err).slice(0, 120)}`);
    }
}

/** The game whose page was shown last. */
let shownGame = 0;

/** Every game's kept achievements, so a page has them before anything is asked. */
async function loadAchievements(): Promise<void> {
    const kept = await call<{ games?: Record<string, { items?: unknown }> }>("JmAllAchievements").catch(() => undefined);
    for (const [appid, one] of Object.entries(kept?.games && !Array.isArray(kept.games) ? kept.games : {})) setAchievements(Number(appid), readItems(one?.items));
}

/** Asks for a game's achievements with the player's unlocks as they are now. */
async function askAchievements(appid: number): Promise<void> {
    await tellAccount();
    const name = listGames().find((g) => g.appid === appid >>> 0)?.name ?? "";
    const got = await call<{ items?: unknown; error?: string }>("JmAchievements", { appid, name }).catch(() => undefined);
    if (!got) return;
    const items = readItems(got.items);
    // An answer that failed keeps what the page already shows.
    if (got.error && items.length === 0) return;
    if (setAchievements(appid, items)) {
        log(`achievements: ${items.length} for ${appid}`);
        redrawPages();
    }
}

/** Achievements were switched on or off, or their source was: what the pages hold is read again. */
async function reloadAchievements(): Promise<void> {
    clearAchievements();
    await loadAchievements();
    if (shownGame) await askAchievements(shownGame);
    redrawPages();
}

/** Achievements in Steam's own Achievements section and its achievements page. */
async function startAchievements(): Promise<void> {
    if (otherPluginRuns()) return;
    addSection("achievements", hasAchievements);
    installAchievements({ report: (where, err) => log(`${where}: ${String((err as Error)?.message ?? err).slice(0, 120)}`), note: log });
    await loadAchievements();
    onGameShown((appid) => {
        // A purchased game has Steam's own achievements.
        if (appid < 0x80000000) return;
        shownGame = appid;
        void askAchievements(appid);
    });
}

/** The Cartridge page in a game's Properties; Steam's element factory may not be there yet when the plugin starts, so it is tried a few times. */
function startPropertiesPage(tries = 0): void {
    setCartridgeHost(host);
    const added = addPropertiesPage({
        title: TEXT.cartridge,
        failed: errorText("unknown"),
        body: CartridgePage,
        report: (where, err) => log(`${where}: ${String((err as Error)?.message ?? err).slice(0, 120)}`),
    });
    if (added) log("properties page: in");
    else if (tries < 10) setTimeout(() => startPropertiesPage(tries + 1), 3000);
    else log("properties page: Steam's element factory was not found");
}

/** A new install opens the window once Steam's main window has been up for two looks in a row. */
function openWhenNew(): void {
    let seen = 0;
    let tries = 0;
    const timer = setInterval(() => {
        const from = mainWindow();
        seen = from ? seen + 1 : 0;
        if (from && seen >= 2) {
            clearInterval(timer);
            void openIfNew(from);
        } else if (++tries >= 45) clearInterval(timer);
    }, 2000);
}

async function init(): Promise<void> {
    setEntry({
        host,
        open: (from, onClose) => showDialog(createElement(JmWindow, { host }), { title: TEXT.app, ...screenSize(from), onClose, parent: from }),
    });
    await tellAccount();
    const state = await host.state().catch(() => undefined);
    showInfo = state?.prefs.showInfo !== false;
    descLimit = state?.prefs.descLimit ?? 360;
    await startGameInfo();
    await startCommunity().catch((err) => log(`community: ${String((err as Error)?.message ?? err).slice(0, 120)}`));
    await startAchievements().catch((err) => log(`achievements: ${String((err as Error)?.message ?? err).slice(0, 120)}`));
    startPropertiesPage();
    openWhenNew();
}

export default definePlugin(() => {
    init().catch((err) => log(`start failed: ${String((err as Error)?.message ?? err).slice(0, 160)}`));
    return { title: TEXT.app, icon: <IconsModule.Settings />, content: <JmSection /> };
});
