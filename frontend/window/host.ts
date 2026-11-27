// Everything the window can do, as one object; the window's screens talk to nothing else.
import { base64OfBytes, clearPng, IMAGE_MIME, NO_LOGO_SIZE, prepareImage, type Prepared } from "./image.ts";
import {
    arr,
    emptyInfo,
    isLink,
    matchSources,
    readInfo,
    readRows,
    readSearch,
    readState,
    sameName,
    SLOT_NUMBER,
    steamExt,
    type ArtSlot,
    type Candidate,
    type Info,
    type MatchSource,
    type Row,
    type Part,
    type SourceId,
    type State,
} from "./model.ts";

export interface ArtSlotState {
    present: boolean;
    /** Changes when the picture does, so one that was read already is not read again. */
    stamp?: string;
    /** The window set this picture: Reset is offered. */
    chosen: boolean;
    /** It came with the match, so a new match may replace it. */
    fetched?: boolean;
    /** The logo only: the game is set to have no logo. */
    none?: boolean;
    /** The logo only: the window set "No Logo" by itself. */
    auto?: boolean;
    /** The logo only: the user reset it, so the window leaves it alone. */
    off?: boolean;
    askedAt?: number;
    sig?: string;
    sigNow?: string;
}

export interface ArtOption {
    url: string;
    thumb: string;
    source: SourceId;
    /** Offered in the picker only: the plugin never takes it by itself. */
    by_hand?: boolean;
}

export interface ArtOptions {
    options: ArtOption[];
    needsKey: boolean;
    error?: string;
}

/** Where a new picture comes from. */
export type ArtChoice =
    | { kind: "option"; option: ArtOption }
    | { kind: "text"; text: string }
    | { kind: "bytes"; base64: string; ext: string }
    | { kind: "none" };

export interface Progress {
    phase: "finding" | "done";
    done: number;
    total: number;
}

export interface GameInfo {
    /** What the game shows: the user's edit, else the match's, else just its name. */
    info: Info;
    /** What the match gave. */
    matched?: Info;
    custom: boolean;
}

export interface Host {
    state(): Promise<State>;
    setTheme(theme: "light" | "dark"): Promise<void>;
    /** Whether a game's page opens with its Game Info showing. */
    setShowInfo(on: boolean): Promise<void>;
    /** Whether the games' pages show achievements. */
    setAchievements(on: boolean): Promise<void>;
    /** How many characters of a description a game's page shows; 0 shows all of it. */
    setDescLimit(limit: number): Promise<void>;
    /** Whether one part of what a source gives is used. */
    setPart(id: SourceId, part: Part, on: boolean): Promise<void>;
    /** True once, on an install nobody has opened yet. */
    firstRun(): Promise<boolean>;
    setSourceOrder(order: readonly SourceId[]): Promise<void>;
    setSource(id: SourceId, on: boolean): Promise<void>;
    /** Taken: the sign-in is saved and the source turned on; refused: nothing is kept. */
    signIn(id: SourceId, credentials: Record<string, string>): Promise<boolean>;
    scan(): Promise<{ games: Row[]; error?: string }>;
    /** Matches every game but the excluded ones from the first source, in the user's order, that has its very name, and pulls its pictures. */
    autoMode(onProgress: (p: Progress) => void): Promise<{ games: Row[]; error?: string }>;
    exclude(appid: number): Promise<void>;
    /** Puts an excluded game back in the list as it was. */
    include(appid: number): Promise<void>;
    game(row: Pick<Row, "appid" | "name">): Promise<GameInfo>;
    saveInfo(appid: number, info: Info): Promise<{ error?: string }>;
    resetInfo(appid: number): Promise<{ error?: string }>;
    searchMatches(term: string, only?: MatchSource): Promise<{ results: Candidate[]; none: boolean; errors: string[] }>;
    useMatch(appid: number, candidate: Pick<Candidate, "source" | "id">): Promise<{ error?: string }>;
    /** Takes the match, its info and the pictures that came with it away; the game is left as "no match". */
    unlink(appid: number): Promise<{ error?: string }>;
    /** The purchased Steam games that are not in the list yet, by name. */
    steamGames(): { appid: number; name: string }[];
    /** Puts a purchased game in the list with Steam's own info; its page stays as it is until the user changes something. */
    addSteam(game: { appid: number; name: string }): Promise<{ error?: string }>;
    /** Takes a purchased game out of the list: Steam's own info and pictures show again. */
    removeSteam(appid: number): Promise<{ error?: string }>;
    artState(appid: number): Promise<Record<ArtSlot, ArtSlotState>>;
    /** A slot's picture as a data: URL, or undefined when it is empty. */
    artImage(appid: number, slot: ArtSlot, stamp?: string): Promise<string | undefined>;
    /** The list's small portraits: kept ones at once, the others as they are made. */
    thumbs(rows: readonly Pick<Row, "appid">[], onThumb: (appid: number, image: string | undefined) => void, cancelled?: () => boolean): Promise<void>;
    artOptions(row: Pick<Row, "appid" | "name">, slot: ArtSlot, term?: string): Promise<ArtOptions>;
    setArt(appid: number, slot: ArtSlot, choice: ArtChoice): Promise<{ image?: string; error?: string }>;
    resetArt(appid: number, slot: ArtSlot): Promise<{ error?: string }>;
    /** Takes a slot's picture away; it stays empty until the user sets or resets it. */
    removeArt(appid: number, slot: ArtSlot): Promise<{ error?: string }>;
    /** Fills a matched game's empty slots, with `fresh` also replacing an earlier match's pictures, and never touches a picture the user picked. */
    fetchArt(row: Pick<Row, "appid" | "name">, fresh: boolean, onProgress?: (done: number, total: number, slot: ArtSlot, image?: string) => void): Promise<boolean>;
    /** Ready games with no logo to be had are set to "No Logo"; one set so gets a logo once a source has it. */
    autoLogos(rows: readonly Row[], opts?: { force?: boolean }): Promise<boolean>;
}

/** Steam's own client calls; Steam writes its files itself. */
export interface SteamApps {
    SetCustomArtworkForApp(appid: number, base64: string, ext: string, slot: number): unknown;
    ClearCustomArtworkForApp(appid: number, slot: number): unknown;
    SetShortcutIcon(appid: number, path: string): unknown;
}

export interface HostDeps {
    call<R>(name: string, payload?: object): Promise<R>;
    /** The non-Steam games, as Steam lists them. */
    games(): { appid: number; name: string }[];
    /** The user's purchased Steam games. */
    steamGames?(): { appid: number; name: string }[];
    /** The picture Steam itself shows in a slot of a purchased game. */
    steamArt?(appid: number, slot: ArtSlot): string | undefined;
    steamApps(): SteamApps | undefined;
    /** A custom logo needs a position or Steam does not draw it. */
    logo?: { ensure(appid: number): Promise<void>; clear(appid: number): Promise<void> };
    /** The Game Info setting changed: pages opened from now on follow it. */
    showInfoChanged?(on: boolean): void;
    /** The description limit changed: the pages follow it at once. */
    descLimitChanged?(limit: number): void;
    /** Achievements were switched, or their source was: the pages are brought up to date. */
    achievementsChanged?(): void;
    /** The sources that feed the games' pages changed: what the pages hold is asked for again. */
    mediaChanged?(): void;
    /** A game's shown info changed: its page in Steam is brought up to date. */
    infoChanged?(appid: number, info: Info | undefined): void;
    fetchBytes?(url: string): Promise<{ base64: string; ext: string } | null>;
    prepareImage?(base64: string, slot: ArtSlot): Promise<Prepared>;
    /** Makes a small copy of a picture for the list. */
    shrink?(image: string): Promise<string | undefined>;
    now?(): number;
    log?(message: string): void;
}

/** Hosts whose pictures the page may not read, so the backend downloads them. */
const BACKEND_ONLY = ["cdn.thegamesdb.net"];

/** A "No Logo" the window set is asked about again after this long, or at once when the sources change. */
export const LOGO_ASK_AGAIN_SECONDS = 24 * 60 * 60;

/** How many of a slot's offered pictures are tried before it is left empty. */
const TRIES_PER_SLOT = 3;

export function dataUrl(base64: string, ext: string): string {
    return `data:${(IMAGE_MIME as Record<string, string>)[ext] ?? "application/octet-stream"};base64,${base64}`;
}

/** A link's bytes fetched by the page itself, or null when the site does not allow it. */
export async function pageFetch(url: string): Promise<{ base64: string; ext: string } | null> {
    try {
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const blob = await resp.blob();
        if (blob.size < 100) return null;
        const base64 = await new Promise<string | null>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const text = typeof reader.result === "string" ? reader.result : "";
                resolve(text ? text.substring(text.indexOf(",") + 1) : null);
            };
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
        });
        return base64 ? { base64, ext: "png" } : null;
    } catch {
        return null;
    }
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The height of the list's small portraits, twice what the list shows. */
const THUMB_HEIGHT = 96;

/** A picture as a small JPG data: URL, or undefined where there is no page to draw it on. */
async function shrink(image: string): Promise<string | undefined> {
    try {
        const img = new Image();
        img.src = image;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.height = THUMB_HEIGHT;
        canvas.width = Math.max(1, Math.round((img.naturalWidth / img.naturalHeight) * THUMB_HEIGHT));
        canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/jpeg", 0.8);
    } catch {
        return undefined;
    }
}

/** How many pictures are kept in memory once read. */
const KEPT_PICTURES = 200;

type Image = { base64?: string; ext?: string; error?: string; empty?: boolean };
type Piece = Image & { chunks?: number };

export function createHost(deps: HostDeps): Host {
    const log = (message: string) => deps.log?.(message);
    const seconds = () => (deps.now ? deps.now() : Date.now() / 1000);
    /** Pictures already read, by game, slot and stamp: a game looked at again shows at once. */
    const pictures = new Map<string, string>();

    /** An image from the backend, which sends it in pieces. */
    async function readImage(name: string, payload: object): Promise<Image> {
        const first = await deps.call<Piece>(name, { ...payload, index: 0 });
        if (!first?.base64 || !first.ext) return first ?? { error: "unknown" };
        let base64 = first.base64;
        for (let index = 1; index < (first.chunks ?? 1); index++) {
            const next = await deps.call<Piece>(name, { ...payload, index });
            if (!next?.base64) return { error: next?.error ?? "not-fetched" };
            base64 += next.base64;
        }
        return { base64, ext: first.ext };
    }

    async function state(): Promise<State> {
        return readState(await deps.call("JmState"));
    }

    /** The purchased games in the list: Steam's own pictures stand in for theirs, and none is fetched unasked. */
    const steamIds = new Set<number>();

    async function scan(): Promise<{ games: Row[]; error?: string }> {
        try {
            const res = await deps.call<{ games?: unknown; error?: string }>("JmGames", { games: deps.games() });
            const rows = readRows(res?.games);
            steamIds.clear();
            for (const row of rows) if (row.steam) steamIds.add(row.appid);
            return { games: rows, error: res?.error };
        } catch (err) {
            return { games: [], error: String((err as Error)?.message ?? err) };
        }
    }

    async function game(row: Pick<Row, "appid" | "name">): Promise<GameInfo> {
        const res = await deps.call<{ info?: unknown; matched?: unknown; custom?: boolean }>("JmInfo", { appid: row.appid });
        const info = readInfo(res?.info) ?? emptyInfo(row.name);
        return { info: info.title ? info : { ...info, title: row.name }, matched: readInfo(res?.matched), custom: res?.custom === true };
    }

    /** Tells the game's page in Steam what the game shows now. */
    async function publish(appid: number): Promise<void> {
        if (!deps.infoChanged) return;
        const res = await deps.call<{ info?: unknown; error?: string }>("JmInfo", { appid }).catch(() => undefined);
        // An answer that did not come says nothing about the game: its page is left as it is.
        if (res && !res.error) deps.infoChanged(appid, readInfo(res.info));
    }

    /** The bytes behind a choice, or an error code. */
    async function bytesOf(choice: Exclude<ArtChoice, { kind: "none" }>): Promise<Image> {
        if (choice.kind === "bytes") return { base64: choice.base64, ext: choice.ext };
        const text = choice.kind === "option" ? choice.option.url : choice.text.trim();
        if (text === "") return { error: "bad-link" };
        if (!isLink(text)) return readImage("JmArtReadFile", { path: text });
        if (!BACKEND_ONLY.some((host) => text.includes(`//${host}/`))) {
            const own = await (deps.fetchBytes ?? pageFetch)(text).catch(() => null);
            if (own) return own;
        }
        return readImage("JmArtFetch", { url: text });
    }

    /** "No Logo": a see-through logo, since Steam writes the game's name wherever no logo loads. */
    async function noLogo(): Promise<Prepared> {
        try {
            return { base64: base64OfBytes(await clearPng(NO_LOGO_SIZE.width, NO_LOGO_SIZE.height)), ext: "png" };
        } catch {
            return { error: "unknown" };
        }
    }

    async function setArt(appid: number, slot: ArtSlot, choice: ArtChoice, how?: { by: "match" | "auto"; sig?: string }): Promise<{ image?: string; error?: string }> {
        let image: Prepared;
        if (choice.kind === "none") {
            if (slot !== "logo") return { error: "unknown" };
            image = await noLogo();
        } else {
            const chosen = await bytesOf(choice);
            if (chosen.error || !chosen.base64) return { error: chosen.error ?? "not-fetched" };
            image = await (deps.prepareImage ?? prepareImage)(chosen.base64, slot);
        }
        if (image.error !== undefined) return { error: image.error };
        const ext = steamExt(image.ext, slot);
        if (!ext) return { error: "unsupported" };
        const apps = deps.steamApps();
        if (!apps) return { error: "steam-refused" };

        const began = await deps.call<{ ok?: boolean; present?: boolean; error?: string }>("JmArtBegin", { appid, slot });
        if (!began?.ok) return { error: began?.error ?? "unknown" };
        // What the slot holds now, so a change Steam refuses half way can be undone.
        const before = slot !== "icon" && began.present ? await readImage("JmArtRead", { appid, slot }).catch(() => undefined) : undefined;

        let path: string | undefined;
        try {
            if (slot === "icon") {
                const saved = await deps.call<{ path?: string; error?: string }>("JmArtSaveIcon", { appid, base64: image.base64 });
                if (!saved?.path) throw new Error(saved?.error ?? "not-saved");
                path = saved.path;
                await apps.SetShortcutIcon(appid, path);
            } else {
                const number = SLOT_NUMBER[slot];
                // Steam's clear call answers nothing to wait for and may throw when the slot is empty.
                try {
                    await apps.ClearCustomArtworkForApp(appid, number);
                } catch {
                    /* nothing to clear */
                }
                await wait(100);
                await apps.SetCustomArtworkForApp(appid, image.base64, ext, number);
                if (slot === "logo") await deps.logo?.ensure(appid).catch(() => undefined);
            }
        } catch (err) {
            const code = String((err as Error)?.message ?? err);
            // The slot was cleared for the new picture: the one it held goes back, and only then is its kept copy let go.
            let restored = slot === "icon" || !before?.base64;
            if (slot !== "icon" && before?.base64 && before.ext) {
                try {
                    await apps.SetCustomArtworkForApp(appid, before.base64, before.ext, SLOT_NUMBER[slot]);
                    restored = true;
                } catch {
                    restored = false;
                }
            }
            if (restored) await deps.call("JmArtCancel", { appid, slot }).catch(() => undefined);
            log(`art ${slot}: not set (${code.slice(0, 80)})${restored ? "" : ", the picture before it could not be put back"}`);
            return { error: code === "not-saved" || code === "unsupported" || code === "too-large" ? code : "steam-refused" };
        }
        const source = choice.kind === "none" ? "none" : choice.kind === "option" ? choice.option.source : choice.kind === "bytes" ? "file" : isLink(choice.text) ? "link" : "file";
        const url = choice.kind === "option" ? choice.option.url : choice.kind === "text" && isLink(choice.text) ? choice.text.trim() : undefined;
        await deps.call("JmArtCommit", { appid, slot, source, url, path, by: how?.by ?? "user", sig: how?.sig });
        log(`art ${slot}: set from ${source}${how ? ` (${how.by})` : ""}`);
        return { image: dataUrl(image.base64, ext) };
    }

    async function resetArt(appid: number, slot: ArtSlot, byPlugin = false): Promise<{ error?: string }> {
        try {
            return await resetSlot(appid, slot, byPlugin);
        } catch (err) {
            log(`art ${slot}: reset failed (${String((err as Error)?.message ?? err).slice(0, 80)})`);
            return { error: "unknown" };
        }
    }

    async function resetSlot(appid: number, slot: ArtSlot, byPlugin: boolean): Promise<{ error?: string }> {
        const plan = await deps.call<{ nothing?: boolean; clear?: boolean; restore?: boolean; icon_restore?: string; error?: string }>("JmArtReset", { appid, slot });
        if (!plan || plan.error) return { error: plan?.error ?? "unknown" };
        if (plan.nothing) return {};
        const kept = plan.restore ? await readImage("JmArtReadBackup", { appid, slot }) : undefined;
        if (plan.restore && (!kept?.base64 || !kept.ext)) return { error: "no-backup" };
        const apps = deps.steamApps();
        if (!apps) return { error: "steam-refused" };
        try {
            if (slot === "icon") {
                await apps.SetShortcutIcon(appid, plan.icon_restore ?? "");
            } else {
                const number = SLOT_NUMBER[slot];
                try {
                    await apps.ClearCustomArtworkForApp(appid, number);
                } catch {
                    /* nothing to clear */
                }
                if (kept?.base64 && kept.ext) {
                    await wait(100);
                    await apps.SetCustomArtworkForApp(appid, kept.base64, kept.ext, number);
                    if (slot === "logo") await deps.logo?.ensure(appid).catch(() => undefined);
                } else if (slot === "logo") {
                    await deps.logo?.clear(appid).catch(() => undefined);
                }
            }
        } catch (err) {
            log(`art ${slot}: reset refused (${String((err as Error)?.message ?? err).slice(0, 80)})`);
            return { error: "steam-refused" };
        }
        await deps.call("JmArtResetDone", { appid, slot, by_plugin: byPlugin });
        log(`art ${slot}: reset${byPlugin ? " (plugin)" : ""}`);
        return {};
    }

    async function artState(appid: number): Promise<Record<ArtSlot, ArtSlotState>> {
        const res = await deps.call<{ slots?: Partial<Record<ArtSlot, Record<string, unknown>>> }>("JmArtState", { appid });
        const one = (slot: ArtSlot): ArtSlotState => {
            const s = res?.slots?.[slot] ?? {};
            const out: ArtSlotState = { present: s.present === true, stamp: typeof s.stamp === "string" ? s.stamp : undefined, chosen: s.chosen === true, fetched: s.fetched === true };
            if (slot !== "logo") return out;
            return {
                ...out,
                none: s.none === true,
                auto: s.auto === true,
                off: s.off === true,
                askedAt: typeof s.asked_at === "number" ? s.asked_at : 0,
                sig: typeof s.sig === "string" ? s.sig : undefined,
                sigNow: typeof s.sig_now === "string" ? s.sig_now : undefined,
            };
        };
        return { portrait: one("portrait"), hero: one("hero"), logo: one("logo"), wide: one("wide"), icon: one("icon") };
    }

    async function artOptions(row: Pick<Row, "appid" | "name">, slot: ArtSlot, term?: string): Promise<ArtOptions> {
        const res = await deps.call<{ options?: unknown; needs_key?: boolean; error?: string }>("JmArtOptions", { appid: row.appid, slot, name: row.name, term });
        return { options: arr<ArtOption>(res?.options).filter((o) => typeof o?.url === "string"), needsKey: res?.needs_key === true, error: res?.error };
    }

    /** Sets the first of a slot's offered pictures that Steam takes and gives it back; false when there is none to take, "failed" when the sources did not answer. */
    async function setFirst(row: Pick<Row, "appid" | "name">, slot: ArtSlot, offered?: ArtOptions): Promise<{ image?: string } | false | "failed"> {
        const all = offered ?? (await artOptions(row, slot).catch(() => undefined));
        if (!all) return "failed";
        const list = { ...all, options: all.options.filter((o) => o.by_hand !== true) };
        for (const option of list.options.slice(0, TRIES_PER_SLOT)) {
            const res = await setArt(row.appid, slot, { kind: "option", option }, { by: "match" });
            if (!res.error) return { image: res.image };
            log(`pictures ${slot}: ${res.error}`);
        }
        return list.options.length === 0 && list.error ? "failed" : false;
    }

    /** Games already asked about a logo since the window opened. */
    const asked = new Set<number>();

    /** One game's logo: kept, set from a source, or set to "No Logo" when no source has one; true when it changed. */
    async function ensureLogo(row: Pick<Row, "appid" | "name">, force: boolean): Promise<boolean> {
        if (steamIds.has(row.appid)) return false;
        const logo = (await artState(row.appid)).logo;
        if (logo.off) return false;
        const provisional = logo.present && logo.none === true && logo.auto === true;
        if (logo.present && !provisional) return false;
        if (!logo.present && logo.chosen) return false;
        if (!force) {
            if (!provisional && asked.has(row.appid)) return false;
            if (provisional && logo.sig === logo.sigNow && seconds() - (logo.askedAt ?? 0) < LOGO_ASK_AGAIN_SECONDS) return false;
        }
        asked.add(row.appid);
        const found = await artOptions(row, "logo").catch(() => undefined);
        const offered = found && { ...found, options: found.options.filter((o) => o.by_hand !== true) };
        if (!offered || (offered.options.length === 0 && offered.error)) return false;
        if (offered.options.length === 0) {
            if (provisional) {
                await deps.call("JmLogoAsked", { appid: row.appid, sig: logo.sigNow }).catch(() => undefined);
                return false;
            }
            return !(await setArt(row.appid, "logo", { kind: "none" }, { by: "auto", sig: logo.sigNow })).error;
        }
        // The "No Logo" goes first, so Reset still leads back to what was there before it.
        if (provisional) await resetArt(row.appid, "logo", true);
        if (typeof (await setFirst(row, "logo", offered)) === "object") return true;
        return !(await setArt(row.appid, "logo", { kind: "none" }, { by: "auto", sig: logo.sigNow })).error && !provisional;
    }

    const host: Host = {
        state,

        async setTheme(theme) {
            await deps.call("JmSetPrefs", { prefs: { theme } });
        },

        async setShowInfo(on) {
            await deps.call("JmSetPrefs", { prefs: { show_info: on } });
            deps.showInfoChanged?.(on);
        },

        async firstRun() {
            const st = await state();
            if (st.prefs.opened) return false;
            await deps.call("JmSetPrefs", { prefs: { opened: true } });
            return true;
        },

        async setSourceOrder(order) {
            await deps.call("JmSetPrefs", { prefs: { source_order: order.join(",") } });
            // The order decides whose cards come first on a game's page.
            deps.mediaChanged?.();
        },

        async setSource(id, on) {
            await deps.call("JmSetSource", { id, on });
            if (id === "retroachievements") deps.achievementsChanged?.();
            else deps.mediaChanged?.();
        },

        async setAchievements(on) {
            await deps.call("JmSetPrefs", { prefs: { achievements: on } });
            deps.achievementsChanged?.();
        },

        async setDescLimit(limit) {
            await deps.call("JmSetPrefs", { prefs: { desc_limit: limit } });
            deps.descLimitChanged?.(limit);
        },

        async setPart(id, part, on) {
            await deps.call("JmSetPart", { id, part, on });
            if (part === "media") deps.mediaChanged?.();
            if (part === "achievements") deps.achievementsChanged?.();
        },

        async signIn(id, credentials) {
            const res = await deps.call<{ ok?: boolean }>("JmSignIn", { id, credentials });
            if (res?.ok === true) {
                if (id === "retroachievements") deps.achievementsChanged?.();
                else deps.mediaChanged?.();
            }
            return res?.ok === true;
        },

        scan,

        async autoMode(onProgress) {
            let games: Row[] = [];
            try {
                const first = await scan();
                if (first.error) return { games, error: first.error };
                games = first.games;
                const order = matchSources(await state());
                const todo = games.filter((g) => g.status !== "excluded" && !g.steam);
                let done = 0;
                onProgress({ phase: "finding", done, total: todo.length });
                for (const row of todo) {
                    let matched = row.match !== undefined;
                    let fresh = false;
                    let unsure = false;
                    for (const source of order) {
                        // A match from this source or a better one is kept.
                        if (source === row.match?.source) break;
                        const found = await host.searchMatches(row.name, source);
                        if (found.errors.length > 0) unsure = true;
                        const same = found.results.find((c) => c.source === source && sameName(c.name, row.name));
                        if (!same) continue;
                        if (!(await host.useMatch(row.appid, same)).error) matched = fresh = true;
                        else unsure = true;
                        break;
                    }
                    if (matched) {
                        await host.fetchArt(row, fresh).catch(() => false);
                    } else if (row.status === "new" && !unsure && order.length > 0) {
                        // Every source answered and none has it: it waits for a search by hand.
                        await deps.call("JmSetState", { appid: row.appid, state: "none" }).catch(() => undefined);
                    }
                    onProgress({ phase: "finding", done: ++done, total: todo.length });
                }
                const last = await scan();
                if (!last.error) games = last.games;
                onProgress({ phase: "done", done: 0, total: 0 });
                return { games };
            } catch (err) {
                return { games, error: String((err as Error)?.message ?? err) };
            }
        },

        async exclude(appid) {
            await deps.call("JmSetState", { appid, state: "excluded" });
        },

        async include(appid) {
            await deps.call("JmSetState", { appid });
        },

        game,

        async saveInfo(appid, info) {
            const res = await deps.call<{ error?: string }>("JmSaveInfo", { appid, info }).catch(() => ({ error: "unknown" }));
            if (!res?.error) await publish(appid);
            return { error: res?.error };
        },

        async resetInfo(appid) {
            const res = await deps.call<{ error?: string }>("JmResetInfo", { appid }).catch(() => ({ error: "unknown" }));
            if (!res?.error) await publish(appid);
            return { error: res?.error };
        },

        async searchMatches(term, only) {
            try {
                return readSearch(await deps.call("JmSearch", { term, source: only }));
            } catch {
                return { results: [], none: false, errors: ["unknown"] };
            }
        },

        async useMatch(appid, candidate) {
            const res = await deps.call<{ error?: string }>("JmMatch", { appid, source: candidate.source, id: candidate.id }).catch(() => ({ error: "unknown" }));
            if (res?.error) return { error: res.error };
            asked.delete(appid);
            await publish(appid);
            return {};
        },

        steamGames() {
            return (deps.steamGames?.() ?? []).filter((g) => !steamIds.has(g.appid));
        },

        async addSteam(game) {
            const res = await deps.call<{ ok?: boolean; error?: string }>("JmAddSteam", { steam: game.appid, name: game.name }).catch(() => undefined);
            if (!res?.ok) return { error: res?.error ?? "unknown" };
            steamIds.add(game.appid);
            await publish(game.appid);
            return {};
        },

        async removeSteam(appid) {
            try {
                // Every picture set through the plugin goes back to Steam's own before the game leaves the list.
                const slots = await artState(appid).catch(() => undefined);
                for (const slot of ["portrait", "hero", "logo", "wide"] as const) {
                    if (!slots?.[slot].chosen) continue;
                    const res = await resetArt(appid, slot, true);
                    if (res.error) log(`remove ${appid}: ${slot} not reset (${res.error})`);
                }
                const res = await deps.call<{ error?: string }>("JmRemoveSteam", { appid });
                steamIds.delete(appid);
                asked.delete(appid);
                deps.infoChanged?.(appid, undefined);
                return { error: res?.error };
            } catch (err) {
                return { error: String((err as Error)?.message ?? err) };
            }
        },

        async unlink(appid) {
            try {
                const ours = await deps.call<{ slots?: unknown }>("JmArtFromMatch", { appid });
                for (const slot of arr<ArtSlot>(ours?.slots)) {
                    const res = await resetArt(appid, slot, true);
                    if (res.error) log(`unlink ${appid}: ${slot} not reset (${res.error})`);
                }
                const res = await deps.call<{ error?: string }>("JmUnmatch", { appid });
                asked.delete(appid);
                deps.infoChanged?.(appid, undefined);
                return { error: res?.error };
            } catch (err) {
                return { error: String((err as Error)?.message ?? err) };
            }
        },

        artState,

        async artImage(appid, slot, stamp) {
            const key = `${appid}:${slot}:${stamp}`;
            const kept = stamp ? pictures.get(key) : undefined;
            if (kept) return kept;
            const res = await readImage("JmArtRead", { appid, slot });
            // A purchased game with no picture of the user's in a slot shows Steam's own there.
            const image = res?.base64 && res.ext ? dataUrl(res.base64, res.ext) : steamIds.has(appid) ? deps.steamArt?.(appid, slot) : undefined;
            if (image && stamp) {
                if (pictures.size >= KEPT_PICTURES) pictures.delete(pictures.keys().next().value!);
                pictures.set(key, image);
            }
            return image;
        },

        async thumbs(rows, onThumb, cancelled) {
            const res = await deps.call<{ thumbs?: Record<string, { stamp?: string; base64?: string }> }>("JmThumbs", { appids: rows.map((r) => r.appid) }).catch(() => undefined);
            const known = res?.thumbs && !Array.isArray(res.thumbs) ? res.thumbs : {};
            const missing: [number, string | undefined][] = [];
            for (const row of rows) {
                const kept = known[String(row.appid)];
                if (kept?.base64) onThumb(row.appid, dataUrl(kept.base64, "jpg"));
                else if (kept?.stamp || !res?.thumbs) missing.push([row.appid, kept?.stamp]);
                else onThumb(row.appid, steamIds.has(row.appid) ? deps.steamArt?.(row.appid, "portrait") : undefined);
            }
            // A portrait with no small copy yet is read once, made small, and the small copy kept.
            for (const [appid, stamp] of missing) {
                if (cancelled?.()) return;
                const full = await host.artImage(appid, "portrait", stamp).catch(() => undefined);
                const small = full ? await (deps.shrink ?? shrink)(full) : undefined;
                onThumb(appid, small ?? full);
                if (small && stamp) await deps.call("JmThumbSave", { appid, stamp, base64: small.slice(small.indexOf(",") + 1) }).catch(() => undefined);
            }
        },

        artOptions,
        setArt: (appid, slot, choice) => setArt(appid, slot, choice),
        resetArt: (appid, slot) => resetArt(appid, slot),

        async removeArt(appid, slot) {
            try {
                const apps = deps.steamApps();
                if (!apps) return { error: "steam-refused" };
                const began = await deps.call<{ ok?: boolean; error?: string }>("JmArtBegin", { appid, slot });
                if (!began?.ok) return { error: began?.error ?? "unknown" };
                try {
                    if (slot === "icon") await apps.SetShortcutIcon(appid, "");
                    else {
                        await apps.ClearCustomArtworkForApp(appid, SLOT_NUMBER[slot]);
                        if (slot === "logo") await deps.logo?.clear(appid).catch(() => undefined);
                        await wait(150);
                    }
                } catch {
                    await deps.call("JmArtCancel", { appid, slot }).catch(() => undefined);
                    return { error: "steam-refused" };
                }
                await deps.call("JmArtCommit", { appid, slot, source: "removed", by: "user" });
                log(`art ${slot}: removed`);
                return {};
            } catch {
                return { error: "unknown" };
            }
        },

        async fetchArt(row, fresh, onProgress) {
            // A purchased game keeps Steam's own pictures until the user changes one.
            if (steamIds.has(row.appid)) return false;
            const slots = ["portrait", "hero", "wide", "logo"] as const;
            const now = await artState(row.appid);
            let changed = false;
            for (const [n, slot] of slots.entries()) {
                const s = now[slot];
                const users = s.chosen && !s.fetched && !s.auto;
                // A picture from an earlier match goes first, so Reset still leads back to what was there before any match.
                const replace = fresh && s.fetched === true;
                if (!users && replace) await resetArt(row.appid, slot, true);
                if (users) {
                    /* the user's own pick stays */
                } else if (slot === "logo") {
                    if (await ensureLogo(row, true).catch(() => false)) changed = true;
                } else if (replace || !s.present) {
                    const after = replace ? (await artState(row.appid))[slot] : s;
                    const set = after.present ? false : await setFirst(row, slot);
                    if (typeof set === "object") {
                        changed = true;
                        onProgress?.(n + 1, slots.length, slot, set.image);
                        continue;
                    }
                }
                onProgress?.(n + 1, slots.length, slot);
            }
            return changed;
        },

        async autoLogos(rows, opts) {
            let changed = false;
            for (const row of rows) {
                if (row.status !== "ready") continue;
                if (await ensureLogo(row, opts?.force === true).catch(() => false)) changed = true;
            }
            return changed;
        },
    };
    return host;
}
