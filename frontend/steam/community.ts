// Shows a matched game's trailers, artwork and screenshots in Steam's own Community section, as Steam's own cards.
import { createElement, type ComponentType } from "react";
import { afterPatch, callOriginal, replacePatch } from "@steambrew/client";
import { watchElements } from "./jsx";
import { isShortcut, unsigned } from "./library";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface MediaItem {
    kind: "video" | "artwork" | "screenshot";
    url?: string;
    thumb?: string;
    width?: number;
    height?: number;
    youtube?: string;
    source: string;
}

/** Steam's card types: an artwork and a screenshot open its picture viewer, a video its YouTube player. */
const FILE_TYPE = { artwork: 3, video: 4, screenshot: 5 } as const;

/** Our cards' file ids: 15 digits, far above Valve's, one per game and place in its list. */
const ID_BASE = 900_000_000_000_000;
const MAX_ITEMS = 10_000;

/** Each source is a made-up account under 2^31, which Steam's own author parts accept; the 64-bit ids are text because they pass 2^53. */
const ACCOUNTS: Record<string, { steamid: string; account: number }> = {
    igdb: { steamid: "76561200107748829", account: 2147483101 },
    thegamesdb: { steamid: "76561200107748830", account: 2147483102 },
    steam: { steamid: "76561200107748831", account: 2147483103 },
};
const SOURCE_OF_ACCOUNT = new Map(Object.entries(ACCOUNTS).map(([source, a]) => [a.account, source]));

/** A size for a picture whose source gives none and that could not be measured. */
const DEFAULT_SIZE = { width: 1920, height: 1080 };

/** One item of Steam's community feed, with every field its cards read. */
interface FeedItem {
    published_file_id: string;
    type: number;
    title: string;
    description: string;
    preview_image_url: string;
    full_image_url: string;
    image_width: number;
    image_height: number;
    youtube_video_id: string | null;
    comment_count: null;
    votes_for: null;
    content_descriptorids: number[];
    spoiler_tag: boolean;
    rating_stars: number;
    maybe_inappropriate_sex: number;
    maybe_inappropriate_violence: number;
    creator: { name: string; steamid: string; avatar: string; online_state: number };
    reactions: never[];
}

let names: Record<string, string> = {};
let avatars: Record<string, string> = {};
let ourAvatars = new Set<string>();
let report: (where: string, err: unknown) => void = () => {};
let note: (message: string) => void = () => {};
let changed: () => void = () => {};
let sized: (appid: number, sizes: number[][]) => void = () => {};
/** Games whose cards are being made. */
const making = new Set<number>();

/** What each game has, as its source gave it, and the cards made of it once its page was shown. */
const items = new Map<number, MediaItem[]>();
const feeds = new Map<number, FeedItem[]>();
/** The picture a viewer of ours shows, by its link: which source it is from. */
const viewers = new Map<string, string>();

export function isOurFileId(id: unknown): boolean {
    return typeof id === "string" && id.length === 15 && Number(id) >= ID_BASE;
}

/** A picture's size from the picture itself, at the width Steam lays a large card out by. */
function measure(url: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve) => {
        try {
            const img = new Image();
            const timer = setTimeout(() => resolve(DEFAULT_SIZE), 5000);
            img.onload = () => {
                clearTimeout(timer);
                resolve(img.naturalWidth > 0 && img.naturalHeight > 0 ? { width: 1920, height: Math.round((1920 * img.naturalHeight) / img.naturalWidth) } : DEFAULT_SIZE);
            };
            img.onerror = () => {
                clearTimeout(timer);
                resolve(DEFAULT_SIZE);
            };
            img.src = url;
        } catch {
            resolve(DEFAULT_SIZE);
        }
    });
}

/** Is every picture's size known, so the cards can be made without loading anything. */
export function sizesKnown(list: readonly MediaItem[]): boolean {
    return list.every((item) => item.kind === "video" || (!!item.width && !!item.height));
}

/** A game's items as Steam's feed items; Steam lays a picture out by its size, so the ones without a size are measured first, all together. */
export async function toFeed(appid: number, list: MediaItem[]): Promise<{ feed: FeedItem[]; measured: boolean }> {
    const lacking = list.filter((item) => item.kind !== "video" && item.url && !(item.width && item.height));
    await Promise.all(
        lacking.map(async (item) => {
            const size = await measure(item.thumb ?? item.url!);
            item.width = size.width;
            item.height = size.height;
        }),
    );
    const feed: FeedItem[] = [];
    for (const [index, item] of list.entries()) {
        if (index >= MAX_ITEMS) break;
        const video = item.kind === "video";
        if (video ? !item.youtube : !item.url) continue;
        const preview = video ? `https://img.youtube.com/vi/${item.youtube}/hqdefault.jpg` : (item.thumb ?? item.url!);
        const account = ACCOUNTS[item.source];
        feed.push({
            published_file_id: String(ID_BASE + appid * MAX_ITEMS + index),
            type: FILE_TYPE[item.kind],
            title: "",
            description: "",
            preview_image_url: preview,
            full_image_url: video ? preview : item.url!,
            image_width: video ? 0 : item.width!,
            image_height: video ? 0 : item.height!,
            youtube_video_id: video ? item.youtube! : null,
            comment_count: null,
            votes_for: null,
            content_descriptorids: [],
            spoiler_tag: false,
            rating_stars: 0,
            maybe_inappropriate_sex: 0,
            maybe_inappropriate_violence: 0,
            creator: { name: names[item.source] ?? "", steamid: account?.steamid ?? "0", avatar: avatars[item.source] ?? "", online_state: 0 },
            reactions: [],
        });
    }
    return { feed, measured: lacking.length > 0 };
}

/** How Steam's own community feed joins the plugin's cards on a purchased game's page: not at all, or after them. */
export type Native = "first" | "after" | "off";
const natives = new Map<number, Native>();

/** Does the plugin answer Steam's loader for this game: a non-Steam game with cards, or a purchased one whose cards come before Steam's own feed. */
function feeding(appid: unknown): boolean {
    if (typeof appid !== "number") return false;
    const id = unsigned(appid);
    if ((feeds.get(id)?.length ?? 0) === 0) return false;
    return isShortcut(appid) || (natives.get(id) ?? "first") !== "first";
}

/** The mounted Community sections, held weakly: a purchased game's is given a new loader when its cards change. */
const sections = new Set<WeakRef<any>>();

/** Starts a purchased game's section over, so it asks for its first page again. */
function restart(id: number): void {
    for (const ref of [...sections]) {
        const section = ref.deref();
        if (!section) {
            sections.delete(ref);
            continue;
        }
        try {
            const old = section.m_loader;
            if (!old || typeof section.props?.appid !== "number" || unsigned(section.props.appid) !== id) continue;
            old.CancelRequests?.();
            const fresh = new old.constructor(section.props.appid);
            fresh.__jm_section = section;
            const el: HTMLElement | undefined = section.m_elInnerContainer;
            section.m_loader = fresh;
            if (el) fresh.OnBind?.(el.querySelector('[role="row"]')?.clientWidth || el.clientWidth);
            section.forceUpdate?.();
            // With no cards of the plugin's to put first, Steam's own feed is asked for at once.
            if (!feeding(section.props.appid)) fresh.LoadAdditionalContent?.();
        } catch (err) {
            report("community restart", err);
        }
    }
}

/** Does the game have cards to show; its page then gets Steam's Community section. */
export function hasFeed(appid: number): boolean {
    return (feeds.get(unsigned(appid))?.length ?? 0) > 0;
}

/** Is anything known about the game's media yet, shown or not. */
export function knows(appid: number): boolean {
    return items.has(unsigned(appid));
}

/** What a game has, or nothing; its cards are made when its page is shown. */
export function setMedia(appid: number, list: readonly MediaItem[] | undefined, native?: Native): void {
    const id = unsigned(appid);
    const fed = feeding(appid);
    for (const card of feeds.get(id) ?? []) viewers.delete(card.full_image_url);
    feeds.delete(id);
    if (list) items.set(id, [...list]);
    else items.delete(id);
    if (list && native && !isShortcut(appid)) natives.set(id, native);
    else natives.delete(id);
    // A purchased game whose page showed the plugin's cards goes back to Steam's own feed until new ones are made.
    if (fed && !isShortcut(appid)) restart(id);
}

/** Forgets every game's media, for when the sources that feed the pages changed. */
export function forgetMedia(): void {
    for (const id of [...items.keys()]) setMedia(id, undefined);
}

/** The section's own element for a loader, while that loader is still the section's. */
function gridOf(loader: any): HTMLElement | undefined {
    const section = loader?.__jm_section;
    const el: HTMLElement | undefined = section?.m_elInnerContainer;
    return el && el.isConnected && section.m_loader === loader ? el : undefined;
}

/** Steam's size for a large 16:9 picture, one column wide. */
const PICTURE_SIZE = 36;

/** A game's first trailer keeps Steam's wide video card; the ones after it are laid out like pictures, so the feed is even. */
function evenTrailers(known: any, cards: any[]): void {
    const trailer = (card: any) => card?.item?.type === FILE_TYPE.video && isOurFileId(card.item.published_file_id);
    const main = [...(Array.isArray(known) ? known : Array.from(known ?? [])), ...cards].find(trailer);
    for (const card of cards) {
        if (!trailer(card) || card === main) continue;
        card.eSize = PICTURE_SIZE;
        card.nWidth = 1;
    }
}

/** The width a drawn row has on screen, or 0 while no row is drawn; the section's own element can be wider than its rows. */
function widthOnScreen(el: HTMLElement): number {
    return el.querySelector('[role="row"]')?.clientWidth ?? 0;
}

/**
 * Steam counts a row's columns twice: the loader from the width it was bound at, each row from its own width on screen.
 * When the two differ, a row shows only part of its cards and a row that is not full shows nothing; the loader is given the width on screen.
 */
function settle(loader: any): void {
    try {
        const el = gridOf(loader);
        if (!el || !feeding(loader.m_unAppID)) return;
        const width = widthOnScreen(el);
        if (!(width > 0) || width === loader.m_nWidth) return;
        const before = loader.m_nWidth;
        loader.m_nWidth = width;
        loader.CheckAndRebuildTemplates?.();
        note(`community: ${loader.m_unAppID} laid out for width ${width}, was ${before}`);
    } catch (err) {
        report("community width", err);
    }
}

/** Checks the width a few times after cards arrive: the page is still settling when they do. */
function settleSoon(loader: any): void {
    for (const ms of [250, 1000, 2500]) setTimeout(() => settle(loader), ms);
}

/** One log line on how Steam laid a game's cards out. */
function describe(loader: any): void {
    try {
        const rows: any[] = Array.from(loader.m_rows ?? []);
        const placed = rows.reduce((n, row) => n + Array.from(row?.vecItems ?? []).filter((cell: any) => cell?.item).length, 0);
        const el = gridOf(loader);
        const drawn = el ? el.querySelectorAll('[role="row"]').length : "?";
        note(`community: ${loader.m_unAppID} width ${loader.m_nWidth}, ${loader.m_vecRowTemplates?.[0]?.nColumns} column(s), ${rows.length} row(s), ${placed} of ${loader.m_vecCards?.length} card(s) placed, ${drawn} row(s) drawn, section ${el?.clientWidth ?? "?"}, row ${el ? widthOnScreen(el) || "none" : "?"}`);
    } catch (err) {
        report("community layout", err);
    }
}

/** Makes a game's cards and draws its page again with the section; called when its page is shown, and at the start for a game whose sizes are all known. */
export async function showMedia(appid: number): Promise<void> {
    const id = unsigned(appid);
    const list = items.get(id);
    if (!list || feeds.has(id) || making.has(id)) return;
    making.add(id);
    try {
        const { feed, measured } = await toFeed(id, list);
        if (items.get(id) !== list) return;
        feeds.set(id, feed);
        for (const card of feed) if (card.type !== FILE_TYPE.video) viewers.set(card.full_image_url, list[Number(card.published_file_id) % MAX_ITEMS]?.source ?? "");
        note(`community: ${feed.length} card(s) for ${id}`);
        if (measured) sized(id, list.map((item) => [item.width ?? 0, item.height ?? 0]));
        if (feed.length > 0) changed();
        // A purchased game's section is already on its page with Steam's own feed: it starts over with the plugin's cards first.
        if (feed.length > 0 && !isShortcut(appid) && feeding(appid)) restart(id);
    } catch (err) {
        report("community feed", err);
    } finally {
        making.delete(id);
    }
}

/**
 * What the loader answers for one of our games: the whole list as page 1 and nothing after; undefined lets Steam's own loader run.
 * "steam" is for a purchased game whose own feed follows the plugin's cards: Steam is asked for its page before.
 */
function answerFor(rawAppid: unknown, page: unknown): { vecContent: FeedItem[]; mapVotes: Map<string, unknown> } | "steam" | undefined {
    if (!feeding(rawAppid)) return undefined;
    const id = unsigned(rawAppid as number);
    if (Number(page) > 1) return !isShortcut(rawAppid) && natives.get(id) === "after" ? "steam" : { vecContent: [], mapVotes: new Map() };
    // A fresh copy each time: Steam's cards write into what they are given.
    const copy = (feeds.get(id) ?? []).map((item) => ({ ...item, content_descriptorids: [], reactions: [], creator: { ...item.creator } }));
    return { vecContent: copy, mapVotes: new Map() };
}

let loaderPatched = false;

/** Steam's section asks its loader for a game's feed; for our games the loader answers with our cards and asks Valve nothing. */
function patchLoader(section: any): void {
    if (loaderPatched) return;
    loaderPatched = true;
    // The loader's class is not exported: one section is made, never mounted, to reach it.
    const made = new section({ appid: 0, labelId: "" });
    const proto = made.m_loader ? Object.getPrototypeOf(made.m_loader) : undefined;
    if (!proto || typeof proto.LoadCommunityContentAndVotes !== "function") {
        note("community: Steam's loader is not as expected");
        return;
    }

    const loading = replacePatch(proto, "LoadCommunityContentAndVotes", function (this: any, args: unknown[]): any {
        try {
            const answer = answerFor(args[0], args[1]);
            if (answer && Number(args[1]) <= 1) {
                settleSoon(this);
                setTimeout(() => describe(this), 3000);
            }
            // The plugin's cards took the first page, so Steam's own first page is the loader's second.
            if (answer === "steam") return (loading as unknown as { original: (...a: unknown[]) => unknown }).original.call(this, args[0], Number(args[1]) - 1);
            return answer ? Promise.resolve(answer) : callOriginal;
        } catch (err) {
            report("community loader", err);
            return callOriginal;
        }
    } as never);

    const build = proto.BuildRowsForCards;
    if (typeof build === "function") {
        proto.BuildRowsForCards = function (this: any, cards: any[]): any {
            const all = Array.isArray(cards) ? cards.slice() : [];
            try {
                if (feeding(this.m_unAppID)) evenTrailers(this.m_vecCards, all);
            } catch (err) {
                report("community trailers", err);
            }
            const rows = build.call(this, cards);
            try {
                const single = this.m_vecRowTemplates?.[0];
                if (!single || !Array.isArray(rows) || !feeding(this.m_unAppID)) return rows;
                const placed = new Set<unknown>();
                for (const row of rows) for (const cell of row?.vecItems ?? []) placed.add(cell);
                const columns = Number(single.nColumns) || 1;
                let row: unknown[] = [];
                let used = 0;
                for (const card of all) {
                    if (!isOurFileId(card?.item?.published_file_id) || placed.has(card)) continue;
                    const wide = Math.max(1, Number(card.nWidth) || 1);
                    if (wide > columns) continue;
                    if (used + wide > columns) {
                        rows.push({ rowTemplate: single, vecItems: row });
                        row = [];
                        used = 0;
                    }
                    row.push(card);
                    used += wide;
                }
                if (row.length > 0) rows.push({ rowTemplate: single, vecItems: row });
            } catch (err) {
                report("community rows", err);
            }
            return rows;
        };
    }

    // Steam's own two triggers for the first page can both miss on a busy page; ours needs no network, so it loads as soon as the loader is bound.
    const loadFirst = function (this: any, _args: unknown[], ret: unknown): unknown {
        try {
            if (this.m_nNextPage === 1 && this.m_bHasEmptyRows === true && feeding(this.m_unAppID)) this.LoadAdditionalContent?.();
        } catch (err) {
            report("community first page", err);
        }
        return ret;
    };
    if (typeof proto.OnBind === "function") afterPatch(proto, "OnBind", loadFirst as never);
    if (typeof proto.OnResize === "function") {
        afterPatch(proto, "OnResize", function (this: any, args: unknown[], ret: unknown): unknown {
            // Steam hands over the section's width and lays the rows out for it half a second later: it is given the rows' width instead.
            try {
                const el = feeding(this.m_unAppID) ? gridOf(this) : undefined;
                const width = el ? widthOnScreen(el) : 0;
                if (width > 0) this.m_nWidth = width;
            } catch (err) {
                report("community resize", err);
            }
            return loadFirst.call(this, args, ret);
        } as never);
    }

    // A loader is told which section holds it, so the section's element can be measured.
    const mount = section.prototype.componentDidMount;
    section.prototype.componentDidMount = function (this: any, ...rest: unknown[]): unknown {
        const ret = typeof mount === "function" ? mount.apply(this, rest) : undefined;
        try {
            if (this.m_loader) this.m_loader.__jm_section = this;
            sections.add(new WeakRef(this));
        } catch (err) {
            report("community mount", err);
        }
        return ret;
    };

    // Steam keeps the section for the next game but leaves its loader on the game before: it gets a fresh one.
    if (typeof section.prototype.componentDidUpdate === "function") {
        afterPatch(section.prototype, "componentDidUpdate", function (this: any, args: unknown[], ret: unknown): unknown {
            try {
                const appid = this.props?.appid;
                const before = (args[0] as { appid?: unknown } | undefined)?.appid;
                const old = this.m_loader;
                if (typeof appid === "number" && old && before !== appid && old.m_unAppID !== appid) {
                    old.CancelRequests?.();
                    const fresh = new old.constructor(appid);
                    const el: HTMLElement | undefined = this.m_elInnerContainer;
                    if (el) {
                        fresh.OnBind?.(widthOnScreen(el) || el.clientWidth);
                        const box = el.getBoundingClientRect();
                        this.m_bOnScreen = box.bottom > 0 && box.top < (el.ownerDocument.defaultView?.innerHeight ?? 0);
                    }
                    this.m_loader = fresh;
                    this.forceUpdate?.();
                }
                if (this.m_loader) this.m_loader.__jm_section = this;
            } catch (err) {
                report("community loader swap", err);
            }
            return ret;
        } as never);
    }
    note("community: loader hooked");
}

let rowPatched = false;

/** Does a row hold one of our cards. */
function ourRow(row: any): boolean {
    return Array.isArray(row?.vecItems) && row.vecItems.some((cell: any) => isOurFileId(cell?.item?.published_file_id));
}

/**
 * Steam's row draws nothing when its cards cannot fill the columns it counted for itself, and an undrawn row never counts again.
 * A row of ours that would draw nothing is drawn as its template has it, so it is on screen and keeps measuring itself.
 */
function patchRow(type: any): void {
    if (rowPatched) return;
    rowPatched = true;
    const render = type.prototype.render;
    if (typeof render !== "function") return;
    type.prototype.render = function (this: any): unknown {
        const out = render.call(this);
        if (out !== null) return out;
        const state = this.state;
        try {
            if (!ourRow(this.props?.row) || !state?.nColumns) return out;
            this.state = { ...state, nColumns: 0 };
            return render.call(this);
        } catch (err) {
            report("community row", err);
            return out;
        } finally {
            this.state = state;
        }
    };
    note("community: rows hooked");
}

/** Is this the class of Steam's row of cards. */
function isRow(type: unknown, p: Record<string, any>): boolean {
    if (typeof type !== "function" || typeof p.index !== "number" || typeof p.row !== "object" || p.row === null || !("rowTemplate" in p.row)) return false;
    const proto = (type as { prototype?: object }).prototype;
    return !!proto && "CalculateColumns" in proto && "BindRow" in proto;
}

/** Is this the class of Steam's Community section, which owns the loader. */
function isSection(type: unknown, p: Record<string, any>): boolean {
    if (typeof type !== "function" || typeof p.appid !== "number" || !("labelId" in p)) return false;
    const proto = (type as { prototype?: object }).prototype;
    return !!proto && "BindInnerContainer" in proto && "AutoLoadAdditionalContent" in proto && "CheckAndLoadInitialContent" in proto;
}

/** Draws nothing: Steam's vote, award, comment and Report controls act on Valve's servers with a file id Valve does not know. */
const Nothing = (): null => null;
const wrappers = new WeakMap<object, ComponentType<any>>();

/** One stable wrapper per Steam type, so React never rebuilds what is under it. */
function wrapped(type: object, make: (type: any) => ComponentType<any>): ComponentType<any> {
    let w = wrappers.get(type);
    if (!w) {
        w = make(type);
        wrappers.set(type, w);
    }
    return w;
}

/** Our cards and their viewer are Steam's own parts, with what only makes sense for a file of Valve's taken off; every test is a few property reads. */
function replaceCardParts(type: unknown, props: unknown): unknown {
    const p = props as Record<string, any> | null | undefined;
    if (!p || typeof p !== "object") return undefined;
    try {
        if (typeof type === "string") {
            // The viewer's game icon has nothing to show for a file with no app, and would draw a broken picture.
            if (type === "img" && typeof p.className === "string" && p.className.includes("AppIcon") && (p.src === undefined || (typeof p.src === "string" && p.src.includes("avatars.steamstatic.com/")))) return "span";
            return undefined;
        }
        if (typeof type !== "function" && (typeof type !== "object" || type === null)) return undefined;
        // The section is first seen here, before it is made: its loader is hooked in time for its first page.
        if (!loaderPatched && isSection(type, p)) {
            patchLoader(type);
            return undefined;
        }
        if (!rowPatched && isRow(type, p)) {
            patchRow(type);
            return undefined;
        }
        if (p.card !== undefined) {
            if (!isOurFileId(p.card?.item?.published_file_id)) return undefined;
            return "showVotingControls" in p || "onReported" in p ? Nothing : undefined;
        }
        // The card's gamepad menu holds Report only.
        if (typeof p.onMenuButton === "function" && isOurFileId(p["data-id"])) return wrapped(type as object, (T) => (q) => createElement(T, { ...q, onMenuButton: undefined, onMenuActionDescription: undefined }));
        // The author's avatar would open the profile of an account that does not exist.
        if (typeof p.onClick === "function" && typeof p.strAvatarURL === "string" && ourAvatars.has(p.strAvatarURL)) return wrapped(type as object, (T) => (q) => createElement(T, { ...q, onClick: undefined }));
        // The viewer Steam opens on a click: no comment thread and no app for a file Valve does not know, and our source as its author.
        if (typeof p.artworkURL === "string" && viewers.has(p.artworkURL)) {
            return wrapped(type as object, (T) => (q) => {
                const source = viewers.get(q.artworkURL);
                if (source === undefined) return createElement(T, q);
                return createElement(T, { ...q, children: undefined, appid: undefined, file_details: { creator: ACCOUNTS[source]?.steamid ?? "0", time_created: Math.floor(Date.now() / 1000), file_description: "" } });
            });
        }
        // The author row of the viewer: our source's picture and name in place of an unknown account's.
        if (p.friend !== undefined && SOURCE_OF_ACCOUNT.has(p.friend?.m_unAccountID)) return wrapped(type as object, () => (q) => createElement("img", { src: avatars[SOURCE_OF_ACCOUNT.get(q.friend?.m_unAccountID) ?? ""] ?? "", style: { width: 36, height: 36, borderRadius: 4 } }));
        if (p.persona !== undefined && "bParenthesizeNicknames" in p) {
            const id = p.persona?.m_steamid;
            const account = typeof id?.GetAccountID === "function" ? id.GetAccountID() : undefined;
            if (SOURCE_OF_ACCOUNT.has(account)) {
                return wrapped(type as object, () => (q) => {
                    const acct = q.persona?.m_steamid?.GetAccountID?.();
                    return createElement("span", { className: q.className }, names[SOURCE_OF_ACCOUNT.get(acct) ?? ""] ?? "");
                });
            }
        }
    } catch (err) {
        report("community cards", err);
    }
    return undefined;
}

/** Installs the loader and card hooks once Steam's parts are there; `names`: what each source is called on a card, `avatars`: the picture beside each. */
export function installCommunity(opts: { names: Record<string, string>; avatars: Record<string, string>; report(where: string, err: unknown): void; note(message: string): void; changed(): void; sized(appid: number, sizes: number[][]): void }): void {
    names = opts.names;
    avatars = opts.avatars;
    ourAvatars = new Set(Object.values(avatars));
    report = opts.report;
    note = opts.note;
    changed = opts.changed;
    sized = opts.sized;
    let tries = 0;
    const attempt = () => {
        try {
            if (watchElements(replaceCardParts)) {
                note("community: watching for Steam's section");
                return;
            }
        } catch (err) {
            report("community install", err);
        }
        if (++tries < 10) setTimeout(attempt, 3000);
        else note("community: Steam's element factory was not found");
    };
    attempt();
}
