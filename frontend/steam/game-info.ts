// Puts a non-Steam game's info on its page, in Steam's own Game Info panel; every hook falls back to Steam's own behaviour on an error.
import { afterPatch } from "@steambrew/client";
import { dateSeconds, type Info } from "../window/model";
import { isShortcut, unsigned } from "./library";
import { resolveAll, resolveOnce, steamRequire } from "./modules";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Steam's store categories for the player modes. */
const MODE_CATEGORY = { single: 2, multi: 1, coop: 9 } as const;
const OUR_CATEGORIES: readonly number[] = Object.values(MODE_CATEGORY);

/** The longest description Steam's panel shows well, used until the user's own limit is known. */
export const DESCRIPTION_LENGTH = 360;

let descriptionLimit: () => number = () => DESCRIPTION_LENGTH;

let showByDefault: () => boolean = () => true;
let report: (where: string, err: unknown) => void = () => {};
let note: (message: string) => void = () => {};
/** Games whose info was written into Steam since it started, so each is logged once. */
const written = new Set<number>();

/** The info each game shows, by unsigned appid. */
const infos = new Map<number, Info>();
/** What was last written into Steam per game, so the same data is never written twice. */
const applied = new Map<number, { signature: string; descriptions: unknown; released: number }>();
/** What Steam held before the first write, for when a game's info is taken away. */
const originals = new Map<number, { descriptionsData?: unknown; associationData?: unknown; release?: unknown; steamRelease?: unknown; hasDetails?: boolean; hasOverview?: boolean }>();
const categories = new Map<number, Set<number>>();

const detailsStore = (): any => (window as any).appDetailsStore;
const appStore = (): any => (window as any).appStore;
/** Steam keeps a shortcut under its appid as an unsigned or as a signed number, so both are asked. */
const detailsOf = (appid: number): any => detailsStore()?.GetAppData?.(appid) ?? detailsStore()?.GetAppData?.(appid | 0);
const overviewOf = (appid: number): any => appStore()?.GetAppOverviewByAppID?.(appid) ?? appStore()?.GetAppOverviewByAppID?.(appid | 0);

/** A description cut at a sentence end that fits, else at a word with "...". */
export function shorten(text: string, max = DESCRIPTION_LENGTH): string {
    if (!text || text.length <= max) return text;
    const ends = /[.!?]+["'’)\]}]*(?=\s|$)/g;
    let end = -1;
    for (let m = ends.exec(text); m !== null; m = ends.exec(text)) {
        if (m.index + m[0].length > max) break;
        end = m.index + m[0].length;
    }
    if (end >= max / 2) return text.slice(0, end).trim();
    const cut = text.slice(0, max);
    const space = cut.search(/\s+\S*$/);
    return (space > 0 ? cut.slice(0, space) : cut).replace(/[\s,;:-]+$/, "") + "...";
}

/** Components that show Game Info, held weakly, to be drawn again when a game's info changes. */
const mounted = new Set<WeakRef<any>>();
const seen = new WeakSet<object>();

function remember(instance: any): void {
    if (!instance || typeof instance !== "object" || seen.has(instance)) return;
    seen.add(instance);
    mounted.add(new WeakRef(instance));
}

/** A component made before its class was hooked holds its props as its own; they are handed to the hook. */
function adopt(instance: any): boolean {
    if (!instance || !Object.prototype.hasOwnProperty.call(instance, "props")) return false;
    const own = instance.props;
    delete instance.props;
    instance.props = own;
    return true;
}

/** The pages Steam draws games on: its main window and Big Picture, besides this one. */
function pages(): Document[] {
    const out: Document[] = [];
    try {
        if (typeof document !== "undefined") out.push(document);
        const manager = (window as any).g_PopupManager;
        for (const name of ["SP Desktop_uid0", "SP BPM_uid0"]) {
            const popup = manager?.GetExistingPopup?.(name);
            const doc = (popup?.m_popup ?? popup?.window)?.document;
            if (doc && !out.includes(doc)) out.push(doc);
        }
    } catch {
        /* the pages found so far */
    }
    return out;
}

/** React's record of one drawn component. */
interface Fiber {
    type?: any;
    stateNode?: any;
    child?: Fiber | null;
    sibling?: Fiber | null;
    return?: Fiber | null;
}

/** The top of React's tree, reached from any element React drew. */
function treeRoot(): Fiber | undefined {
    for (const doc of pages()) {
        for (const el of [...doc.querySelectorAll("body *")].slice(0, 200)) {
            const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
            let fiber: Fiber | undefined = key ? (el as any)[key] : undefined;
            if (!fiber) continue;
            while (fiber.return) fiber = fiber.return;
            return fiber;
        }
    }
    return undefined;
}

/** How many of React's records one pass looks at, at most. */
const TREE_LIMIT = 300_000;

/**
 * Steam builds its game page once and reuses it for every game, so its panel can be older than the hooks: React's whole
 * tree is walked for components of the hooked classes, and each one made before its hook is handed over to it.
 */
function reseat(): void {
    let adopted = 0;
    try {
        const root = treeRoot();
        const stack: Fiber[] = root ? [root] : [];
        for (let n = 0; stack.length > 0 && n < TREE_LIMIT; n++) {
            const fiber = stack.pop()!;
            if (fiber.sibling) stack.push(fiber.sibling);
            if (fiber.child) stack.push(fiber.child);
            const type = fiber.type;
            if (typeof type !== "function" || !fiber.stateNode) continue;
            // The panel's inner part is whatever class it draws first, and may be one no earlier render showed.
            if (type.__jm_panel === true) {
                for (let inner = fiber.child, depth = 0; inner && depth < 3; inner = inner.child, depth++) {
                    if (typeof inner.type === "function" && inner.type.prototype?.render) {
                        hookProps(inner.type, true, "inner");
                        break;
                    }
                }
            }
            if (type.__jm_start === true) remember(fiber.stateNode);
            if (type.__jm_props !== true) continue;
            if (adopt(fiber.stateNode)) adopted++;
            remember(fiber.stateNode);
        }
    } catch (err) {
        report("reseat", err);
    }
    if (adopted > 0) note(`${adopted} component(s) made before the hooks now read through them`);
}

let redrawAsked = false;

/** Draws the hooked components again, once however often it is asked for in one go. */
function redraw(): void {
    if (redrawAsked) return;
    redrawAsked = true;
    setTimeout(() => {
        redrawAsked = false;
        drawAgain();
    }, 0);
}

function drawAgain(): void {
    reseat();
    for (const ref of [...mounted]) {
        const instance = ref.deref();
        if (!instance) {
            mounted.delete(ref);
            continue;
        }
        try {
            instance.forceUpdate?.();
        } catch {
            mounted.delete(ref);
        }
    }
}

const owned = new WeakMap<object, any>();

/** An overview that says it is not a shortcut, for the hooked components only and always the same one per overview; Steam's own object is never changed. */
function asOwned(overview: any): any {
    if (!overview || overview.__jm_owned) return overview;
    const made = owned.get(overview);
    if (made) return made;
    const proxy = new Proxy(overview, {
        get(target, prop, receiver) {
            if (prop === "__jm_owned") return true;
            if (prop === "BIsModOrShortcut") return () => false;
            if (prop === "GetGameID") return () => target.m_gameid || (typeof target.GetGameID === "function" ? target.GetGameID() : String(target.appid));
            if (prop === "gameid") return target.m_gameid || target.gameid;
            const value = Reflect.get(target, prop, receiver);
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
    owned.set(overview, proxy);
    return proxy;
}

/** Steam asks the overview's class whether a game has a store category: ours are answered from `categories`. */
function hookCategories(overview: any): void {
    for (let proto = overview; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
        if (typeof proto.BHasStoreCategory !== "function" || Object.prototype.hasOwnProperty.call(proto, "__jm_categories")) continue;
        if (!Object.prototype.hasOwnProperty.call(proto, "BHasStoreCategory")) continue;
        proto.__jm_categories = true;
        const original = proto.BHasStoreCategory;
        proto.BHasStoreCategory = function (id: number) {
            try {
                if (isShortcut(this.appid) && categories.get(unsigned(this.appid))?.has(id)) return true;
            } catch (err) {
                report("categories", err);
            }
            return original.call(this, id);
        };
    }
}

/** Tells Steam's own watchers and the mounted panels that a game's details changed. */
function announce(appid: number): void {
    try {
        detailsStore()?.AppDetailsChanged?.(appid);
    } catch {
        /* Steam redraws on its next change */
    }
    redraw();
}

/** Writes a game's info into Steam's stores unless Steam already holds it; with `rendering` (Steam is drawing) the redraw waits. */
function apply(appid: number, rendering = false): boolean {
    const info = infos.get(appid);
    if (!info) return false;
    try {
        const limit = descriptionLimit();
        const description = limit > 0 ? shorten(info.description, limit) : info.description;
        const released = dateSeconds(info.release_date);
        const wanted = new Set<number>();
        for (const mode of ["single", "multi", "coop"] as const) if (info.modes[mode]) wanted.add(MODE_CATEGORY[mode]);
        const signature = JSON.stringify([description, info.developers, info.publishers, info.franchises, released, [...wanted]]);
        const data = detailsOf(appid);
        const overview = overviewOf(appid);
        const last = applied.get(appid);
        const dated = !overview || (released > 0 ? overview.rt_original_release_date === released : last?.released === 0);
        const live = last && last.signature === signature && data && data.descriptionsData === last.descriptions && dated;
        if (live) return true;

        const kept = originals.get(appid) ?? {};
        if (data) {
            if (!kept.hasDetails) Object.assign(kept, { hasDetails: true, descriptionsData: data.descriptionsData, associationData: data.associationData });
            data.descriptionsData = { strSnippet: description, strFullDescription: description };
            const named = (list: string[]) => list.map((strName) => ({ strName, strURL: null }));
            data.associationData = { rgDevelopers: named(info.developers), rgPublishers: named(info.publishers), rgFranchises: named(info.franchises) };
            applied.set(appid, { signature, descriptions: data.descriptionsData, released });
            if (!written.has(appid)) {
                written.add(appid);
                note(`info written for ${appid}`);
            }
        }
        // A purchased game keeps the player modes Steam lists for it.
        const shortcut = isShortcut(appid);
        if (shortcut) categories.set(appid, wanted);
        if (overview) {
            if (!kept.hasOverview) Object.assign(kept, { hasOverview: true, release: overview.rt_original_release_date, steamRelease: overview.rt_steam_release_date });
            if (shortcut) hookCategories(overview);
            const set = shortcut ? overview.m_setStoreCategories : undefined;
            if (set && typeof set.add === "function" && typeof set.delete === "function") {
                for (const id of OUR_CATEGORIES) if (wanted.has(id)) set.add(id);
                    else set.delete(id);
            }
            if (released > 0) {
                overview.rt_original_release_date = released;
                overview.rt_steam_release_date = released;
            } else if (last && last.released > 0) {
                // A date that was taken away again: Steam's own goes back.
                overview.rt_original_release_date = kept.release;
                overview.rt_steam_release_date = kept.steamRelease;
            }
        }
        originals.set(appid, kept);
        // A redraw asked for while Steam draws would loop: it waits for the draw to end.
        if (data && rendering) setTimeout(() => announce(appid), 0);
        else if (data) announce(appid);
        return !!data;
    } catch (err) {
        report("apply", err);
        return false;
    }
}

/** Puts back what Steam held before the plugin wrote a game's info. */
function revert(appid: number): void {
    try {
        const kept = originals.get(appid);
        const data = detailsOf(appid);
        const overview = overviewOf(appid);
        if (kept?.hasDetails && data) {
            data.descriptionsData = kept.descriptionsData;
            data.associationData = kept.associationData;
        }
        if (kept?.hasOverview && overview) {
            overview.rt_original_release_date = kept.release;
            overview.rt_steam_release_date = kept.steamRelease;
            const set = overview.m_setStoreCategories;
            if (set && typeof set.delete === "function") for (const id of categories.get(appid) ?? []) set.delete(id);
        }
        originals.delete(appid);
        applied.delete(appid);
        categories.delete(appid);
        announce(appid);
    } catch (err) {
        report("revert", err);
    }
}

/** A game's shown info changed, or (undefined) was taken away. */
export function setInfo(appid: number, info: Info | undefined): void {
    const id = unsigned(appid);
    if (info) {
        infos.set(id, info);
        apply(id);
    } else if (infos.delete(id)) {
        revert(id);
    }
}

/** Does this overview belong to a non-Steam game the plugin holds info for? */
function ours(overview: any): number | undefined {
    if (!overview || !isShortcut(overview.appid)) return undefined;
    const id = unsigned(overview.appid);
    return infos.has(id) ? id : undefined;
}

/** Other sections of Steam's page a game gets besides Game Info, each with the test of whether the game has something for it. */
const extras: [string, (appid: number) => boolean][] = [];
export function addSection(name: string, has: (appid: number) => boolean): void {
    extras.push([name, has]);
}

/** Told each time the page comes to show another game the plugin holds info for. */
const shownListeners: ((appid: number) => void)[] = [];
export function onGameShown(fn: (appid: number) => void): void {
    shownListeners.push(fn);
}

/** Draws the page's hooked parts again, for when what a game has changed. */
export function redrawPages(): void {
    redraw();
}

/** The game the play bar was last drawn for. */
let shownApp = 0;

/** A component reads its props through this: a game with info gets an overview that passes as an owned game. */
function hookProps(component: any, needsInfo: boolean, label: string): void {
    if (!component?.prototype || component.__jm_props) return;
    component.__jm_props = true;
    try {
        Object.defineProperty(component.prototype, "props", {
            get() {
                const raw = this.__jm_raw;
                try {
                    remember(this);
                    const overview = raw?.overview;
                    if (!overview) return raw;
                    if (!isShortcut(overview.appid)) {
                        // A purchased game the user edits: Steam draws its page as ever, and only the info is kept written.
                        const held = typeof overview.appid === "number" && infos.has(overview.appid);
                        if (label === "bar" && shownApp !== overview.appid) {
                            shownApp = overview.appid;
                            const shown = shownApp;
                            if (held) for (const fn of shownListeners) setTimeout(() => fn(shown), 0);
                        }
                        if (needsInfo && held) apply(overview.appid, true);
                        return raw;
                    }
                    if (label === "bar" && shownApp !== unsigned(overview.appid)) {
                        shownApp = unsigned(overview.appid);
                        const shown = shownApp;
                        if (infos.has(shown)) for (const fn of shownListeners) setTimeout(() => fn(shown), 0);
                        // The page now shows another game: its panel is brought under the hooks once the draw is over.
                        setTimeout(redraw, 0);
                        setTimeout(redraw, 700);
                    }
                    const id = ours(overview);
                    if (needsInfo) {
                        if (id === undefined) return raw;
                        apply(id, true);
                    }
                    if (this.__jm_patched && this.__jm_from === raw) return this.__jm_patched;
                    this.__jm_from = raw;
                    this.__jm_patched = new Proxy(raw, {
                        get: (target, prop, receiver) => (prop === "overview" ? asOwned(overview) : Reflect.get(target, prop, receiver)),
                    });
                    return this.__jm_patched;
                } catch (err) {
                    report("props", err);
                    return raw;
                }
            },
            set(next) {
                this.__jm_raw = next;
                this.__jm_from = undefined;
                this.__jm_patched = undefined;
            },
            configurable: true,
        });
    } catch (err) {
        report("props hook", err);
    }
    // An instance made before the hook is handed over the next time it draws.
    const render = component.prototype.render;
    if (typeof render === "function") {
        component.prototype.render = function (...args: unknown[]) {
            try {
                adopt(this);
            } catch (err) {
                report("adopt", err);
            }
            return render.apply(this, args);
        };
    }
}

let innerHooked = false;
let barHooked = false;
let headerHooked = false;
let sectionsHooked = false;

/** Steam's Game Info panel leaves a shortcut's description and credits out; its container and inner component are given an owned-looking overview. */
function patchPanel(): boolean {
    const containers = resolveAll<any>((v) => {
        const proto = typeof v === "function" ? (v as any).prototype : undefined;
        return !!proto && typeof proto.onCollapseStarted === "function" && typeof proto.onCollapseComplete === "function" && typeof proto.setBoxHeight === "function";
    });
    const container = containers[0];
    if (!container) return false;
    if (container.__jm_panel) return true;
    note(`${containers.length} class(es) look like the panel's container`);
    // Steam has more than one such class; every one is hooked, the first also for its inner part.
    for (const [n, other] of containers.entries()) {
        other.__jm_panel = true;
        hookProps(other, true, n === 0 ? "container" : `container${n + 1}`);
    }
    const hookInner = (tree: any) => {
        const inner = tree?.props?.children?.[0]?.type;
        if (typeof inner !== "function" || !inner.prototype) return;
        hookProps(inner, true, "inner");
        if (!innerHooked) {
            innerHooked = true;
            note("the panel's inner part is hooked");
            // Inner parts already on a page were made before this.
            setTimeout(redraw, 0);
        }
    };
    // The inner component is known only from a render: one is made with stand-in props.
    try {
        const props = { overview: { appid: 1, BIsModOrShortcut: () => true, GetCanonicalReleaseDate: () => 0, display_name: "" }, details: { unAppID: 1 }, expand: true, collapsible: false };
        const probe = new container(props);
        probe.props = props;
        hookInner(probe.render());
    } catch {
        /* found on the first real render instead */
    }
    const render = container.prototype.render;
    if (typeof render === "function") {
        container.prototype.render = function (...args: unknown[]) {
            const tree = render.apply(this, args);
            try {
                hookInner(tree);
            } catch (err) {
                report("panel", err);
            }
            return tree;
        };
    }
    return true;
}

/** Steam replaces a game's overview now and then, which drops the release date: it is written again. */
function patchOverviewChanges(tries = 0): void {
    const store = (window as any).collectionStore;
    if (!store) {
        if (tries < 40) setTimeout(() => patchOverviewChanges(tries + 1), 500);
        return;
    }
    const owner = Object.prototype.hasOwnProperty.call(store, "OnAppOverviewChange") ? store : Object.getPrototypeOf(store);
    if (typeof owner?.OnAppOverviewChange !== "function" || owner.__jm_overviews) return;
    owner.__jm_overviews = true;
    afterPatch(owner, "OnAppOverviewChange", (args: unknown[], ret: unknown) => {
        try {
            const held = (app: any): number | undefined => (typeof app?.appid === "number" && infos.has(unsigned(app.appid)) ? unsigned(app.appid) : undefined);
            const changed = (Array.isArray(args[0]) ? args[0] : []).map(held).filter((id): id is number => id !== undefined);
            // Off Steam's own stack, so a write never lands inside the change it reacts to.
            if (changed.length > 0) setTimeout(() => changed.forEach((id) => apply(id)), 0);
        } catch (err) {
            report("overview change", err);
        }
        return ret;
    });
}

/** The play bar's info button is hidden for shortcuts, and a page decides in its constructor whether Game Info starts open. */
function patchPlayBar(): void {
    const bar = resolveOnce<any>("PlayBar", (v) => typeof v === "function" && (v as any).s_setGameInfoVisible instanceof Set && Array.isArray((v as any).s_rgFakeDetails));
    if (bar && !bar.__jm_bar) {
        bar.__jm_bar = true;
        barHooked = true;
        hookProps(bar, false, "bar");
    }
    patchPanelStart();
}

/** Games folded with the info button since Steam started; with the setting on, every other game's panel is open. */
const folded = new Set<number>();

/**
 * Steam keeps one page component for every game and decides only when it builds it whether the panel is open, so a
 * panel that started closed stays closed from game to game: the page's own record of open panels and its state per game are answered here.
 */
function patchPanelStart(): void {
    const page = resolveOnce<any>("library page", (v) => {
        if (typeof v !== "function" || !(v as any).prototype || !((v as any).s_setGameInfoVisible instanceof Set)) return false;
        const names = Object.getOwnPropertyNames((v as any).prototype);
        return ["onGameInfoToggle", "OnHeaderWaypointEnter", "OnHeaderWaypointLeave"].every((name) => names.includes(name));
    });
    if (!page || page.__jm_start) return;
    page.__jm_start = true;
    headerHooked = true;
    try {
        const open = page.s_setGameInfoVisible as Set<number>;
        const add = open.add.bind(open);
        const remove = open.delete.bind(open);
        const has = open.has.bind(open);
        open.add = (appid: number) => {
            folded.delete(appid);
            return add(appid);
        };
        open.delete = (appid: number) => {
            folded.add(appid);
            return remove(appid);
        };
        // Steam reads this when it first builds the page.
        open.has = (appid: number) => (showByDefault() ? !folded.has(appid) : has(appid));

        // Steam gives a non-Steam game's page three sections and Game Info is not one of them: a game the plugin holds info for gets it.
        const sections = page.prototype.GetSections;
        if (typeof sections === "function") {
            page.prototype.GetSections = function (overview: any, ...rest: unknown[]) {
                const listed = sections.call(this, overview, ...rest);
                try {
                    remember(this);
                    const id = ours(overview);
                    if (!(listed instanceof Set) || listed.has("info") || id === undefined) return listed;
                    const extra = extras.filter(([, has]) => has(id)).map(([name]) => name);
                    // The same set is handed back while Steam's own stays the same, as Steam does, so nothing draws again for no reason.
                    if (this.__jm_listed !== listed || this.__jm_extra !== extra.join()) {
                        this.__jm_listed = listed;
                        this.__jm_extra = extra.join();
                        // Steam's notice that a non-Steam game has no details is left out: this game has them.
                        this.__jm_sections = new Set(["info", ...extra, ...[...listed].filter((name) => name !== "nonsteam")]);
                    }
                    return this.__jm_sections;
                } catch (err) {
                    report("sections", err);
                    return listed;
                }
            };
            sectionsHooked = true;
        }

        // The page is kept when the user goes to another game, so the panel is set again for each one.
        const previous = page.getDerivedStateFromProps;
        page.getDerivedStateFromProps = (props: any, state: any) => {
            const base = typeof previous === "function" ? previous(props, state) : null;
            try {
                const appid = props?.overview?.appid;
                if (!showByDefault() || appid === undefined || state?.__jm_app === appid) return base;
                return { ...(base ?? {}), __jm_app: appid, bShowGameInfo: !folded.has(appid) };
            } catch (err) {
                report("start", err);
                return base;
            }
        };
    } catch (err) {
        report("start hook", err);
    }
}

/** Installs the hooks once Steam's modules are there; `all`: every game's shown info by appid. */
export function installGameInfo(opts: { all: Record<string, Info>; showByDefault(): boolean; descriptionLimit(): number; report(where: string, err: unknown): void; note(message: string): void }): void {
    showByDefault = opts.showByDefault;
    descriptionLimit = opts.descriptionLimit;
    report = opts.report;
    note = opts.note;
    for (const [key, info] of Object.entries(opts.all)) {
        const id = Number(key);
        if (Number.isFinite(id) && id !== 0) infos.set(unsigned(id), info);
    }
    let tries = 0;
    const attempt = () => {
        try {
            if (steamRequire() && patchPanel()) {
                patchPlayBar();
                patchOverviewChanges();
                for (const id of infos.keys()) apply(id);
                note(`hooks in after ${tries + 1} look(s): info for ${infos.size} game(s), inner part ${innerHooked ? "hooked" : "not seen yet"}, play bar ${barHooked ? "hooked" : "not found"}, page header ${headerHooked ? "hooked" : "not found"}, sections ${sectionsHooked ? "hooked" : "not found"}, ${pages().length} page(s), stores ${detailsStore() && appStore() ? "there" : "missing"}`);
                redraw();
                // Pages that were still being built get one more pass.
                setTimeout(redraw, 3000);
                return;
            }
        } catch (err) {
            report("install", err);
        }
        if (++tries < 10) setTimeout(attempt, 3000);
        else note(steamRequire() ? "Steam's Game Info panel was not found" : "Steam's modules could not be reached");
    };
    attempt();
}
