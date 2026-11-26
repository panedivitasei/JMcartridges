// The window's rules: no Steam, no I/O, no React, so Node runs the tests on this file directly.

export type Status = "ready" | "none" | "new" | "excluded";

export type SourceId = "steam" | "igdb" | "thegamesdb" | "steamgriddb" | "retroachievements";
export type MatchSource = "steam" | "igdb" | "thegamesdb";

export interface Match {
    source: MatchSource;
    id: number;
    name: string;
}

export interface Row {
    appid: number;
    name: string;
    status: Status;
    match?: Match;
    /** The user's own Game Info differs from the match's. */
    edited: boolean;
}

export interface Source {
    id: SourceId;
    on: boolean;
    /** Signed in, or needs no key. */
    signed: boolean;
    /** The names its sign-in is saved under. */
    needs: string[];
    matchable: boolean;
    /** Its trailers, artwork and screenshots go on the games' pages. */
    media: boolean;
}

export interface State {
    prefs: { theme: "light" | "dark"; showInfo: boolean; /** Achievements go on the games' pages once RetroAchievements is signed in to. */ achievements: boolean; /** Characters of a description shown on a game's page, 0 for all of it. */ descLimit: number; opened: boolean };
    /** Every source, in the user's order. */
    sources: Source[];
}

export interface Info {
    title: string;
    description: string;
    developers: string[];
    publishers: string[];
    franchises: string[];
    genres: string[];
    /** "YYYY-MM-DD" or "". */
    release_date: string;
    modes: { single?: boolean; multi?: boolean; coop?: boolean };
}

/** Game Info as the form holds it: lists are text split by ";". */
export interface Draft {
    title: string;
    description: string;
    developers: string;
    publishers: string;
    genres: string;
    release_date: string;
}

/** The backend sends an empty list as {}. */
export function arr<T>(value: unknown): T[] {
    return Array.isArray(value) ? (value as T[]) : [];
}

const strings = (value: unknown): string[] => arr<unknown>(value).filter((v): v is string => typeof v === "string");

export function readInfo(value: unknown): Info | undefined {
    if (!value || typeof value !== "object") return undefined;
    const v = value as Record<string, unknown>;
    const modes = (v.modes && typeof v.modes === "object" ? v.modes : {}) as Record<string, unknown>;
    return {
        title: typeof v.title === "string" ? v.title : "",
        description: typeof v.description === "string" ? v.description : "",
        developers: strings(v.developers),
        publishers: strings(v.publishers),
        franchises: strings(v.franchises),
        genres: strings(v.genres),
        release_date: typeof v.release_date === "string" ? v.release_date : "",
        modes: { single: modes.single === true || undefined, multi: modes.multi === true || undefined, coop: modes.coop === true || undefined },
    };
}

export function emptyInfo(title: string): Info {
    return { title, description: "", developers: [], publishers: [], franchises: [], genres: [], release_date: "", modes: {} };
}

export function draftOf(info: Info): Draft {
    return {
        title: info.title,
        description: info.description,
        developers: info.developers.join("; "),
        publishers: info.publishers.join("; "),
        genres: info.genres.join("; "),
        release_date: info.release_date,
    };
}

export function splitList(text: string): string[] {
    const out: string[] = [];
    for (const part of text.split(/[;\n]/)) {
        const v = part.trim();
        if (v && !out.includes(v)) out.push(v);
    }
    return out;
}

/** The form's text as Game Info; what the form does not hold is kept from `base`. */
export function infoOf(draft: Draft, base: Info): Info {
    return {
        ...base,
        title: draft.title.trim(),
        description: draft.description.trim(),
        developers: splitList(draft.developers),
        publishers: splitList(draft.publishers),
        genres: splitList(draft.genres),
        release_date: draft.release_date.trim(),
    };
}

export function sameDraft(a: Draft, b: Draft): boolean {
    return a.title === b.title && a.description === b.description && a.developers === b.developers && a.publishers === b.publishers && a.genres === b.genres && a.release_date === b.release_date;
}

/** Empty, or a real day written YYYY-MM-DD. */
export function validDate(text: string): boolean {
    const t = text.trim();
    if (t === "") return true;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
    if (!m) return false;
    const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === t;
}

/** Seconds since 1970 for noon of that day on this computer's clock, or 0; Steam shows the day in local time. */
export function dateSeconds(text: string): number {
    const t = text.trim();
    if (t === "" || !validDate(t)) return 0;
    const [year = 0, month = 1, day = 1] = t.split("-").map(Number);
    return Math.floor(new Date(year, month - 1, day, 12).getTime() / 1000);
}

export function readRows(value: unknown): Row[] {
    const out: Row[] = [];
    for (const item of arr<Record<string, unknown>>(value)) {
        if (!item || typeof item.appid !== "number" || typeof item.name !== "string") continue;
        const status = item.status === "ready" || item.status === "none" || item.status === "excluded" ? item.status : "new";
        const m = item.match as Partial<Match> | undefined;
        const match = m && (m.source === "steam" || m.source === "igdb" || m.source === "thegamesdb") && typeof m.id === "number" ? { source: m.source, id: m.id, name: typeof m.name === "string" ? m.name : "" } : undefined;
        out.push({ appid: item.appid, name: item.name, status, match, edited: item.edited === true });
    }
    return out;
}

export function readState(value: unknown): State {
    const v = (value && typeof value === "object" ? value : {}) as { prefs?: Record<string, unknown>; sources?: unknown };
    const sources: Source[] = [];
    for (const s of arr<Record<string, unknown>>(v.sources)) {
        if (s.id !== "steam" && s.id !== "igdb" && s.id !== "thegamesdb" && s.id !== "steamgriddb" && s.id !== "retroachievements") continue;
        sources.push({ id: s.id, on: s.on === true, signed: s.signed === true, needs: strings(s.needs), matchable: s.matchable === true, media: s.media === true });
    }
    const p = v.prefs ?? {};
    const limit = typeof p.desc_limit === "number" && p.desc_limit >= 0 ? Math.floor(p.desc_limit) : 360;
    return { prefs: { theme: p.theme === "light" ? "light" : "dark", showInfo: p.show_info !== false, achievements: p.achievements !== false, descLimit: limit, opened: p.opened === true }, sources };
}

/** Games that still want a match. */
export function isTodo(status: Status): boolean {
    return status === "none" || status === "new";
}

export function countsOf(rows: readonly Row[]): { total: number; ready: number } {
    return { total: rows.length, ready: rows.filter((r) => r.status === "ready").length };
}

export type ListFilter = "all" | "todo";

/** The rows the list shows: by the search text and the filter, sorted by name. */
export function visibleRows(rows: readonly Row[], query: string, filter: ListFilter): Row[] {
    const q = query.trim().toLowerCase();
    return rows
        .filter((r) => (q === "" || r.name.toLowerCase().includes(q)) && (filter === "all" || isTodo(r.status)))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/** The source that is always first and cannot be moved. */
export const FIXED_SOURCE: SourceId = "steam";

/** In use: switched on and signed in. */
export function inUse(source: Source): boolean {
    return source.on && source.signed;
}

/** The sources a game can be matched from now, in the user's order. */
export function matchSources(state: State | undefined): MatchSource[] {
    return (state?.sources ?? []).filter((s) => s.matchable && inUse(s)).map((s) => s.id as MatchSource);
}

/** `order` with one source moved to place `to`; Steam is not moved and nothing goes above it. */
export function moveSource(order: readonly SourceId[], id: SourceId, to: number): SourceId[] {
    const rest = order.filter((other) => other !== id);
    if (rest.length === order.length || id === FIXED_SOURCE) return [...order];
    const first = rest[0] === FIXED_SOURCE ? 1 : 0;
    rest.splice(Math.max(first, Math.min(rest.length, to)), 0, id);
    return rest;
}

/** One result of the Match search. */
export interface Candidate {
    source: MatchSource;
    id: number;
    name: string;
    year?: number;
    platforms: string[];
}

/** What tells two results of the same name apart: "2014 · Wii U, Switch". */
export function candidateDetails(c: Pick<Candidate, "year" | "platforms">): string {
    const platforms = c.platforms.filter((p) => typeof p === "string" && p !== "").slice(0, 4);
    const year = typeof c.year === "number" && c.year > 0 ? String(c.year) : "";
    return [year, platforms.join(", ")].filter((x) => x !== "").join(" · ");
}

export function readSearch(value: unknown): { results: Candidate[]; none: boolean; errors: string[] } {
    const r = (value && typeof value === "object" ? value : {}) as { results?: unknown; none?: unknown; errors?: unknown; error?: unknown };
    const results: Candidate[] = [];
    for (const c of arr<Partial<Candidate>>(r.results)) {
        if ((c?.source !== "steam" && c?.source !== "igdb" && c?.source !== "thegamesdb") || typeof c.id !== "number" || typeof c.name !== "string") continue;
        results.push({ source: c.source, id: c.id, name: c.name, year: typeof c.year === "number" ? c.year : undefined, platforms: strings(c.platforms) });
    }
    const errors = r.errors && typeof r.errors === "object" ? Object.values(r.errors as Record<string, unknown>).filter((e): e is string => typeof e === "string") : [];
    if (typeof r.error === "string") errors.push("unknown");
    return { results, none: r.none === true, errors };
}

/** Do two names read the same, whatever their case and spacing? */
export function sameName(a: string, b: string): boolean {
    const plain = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
    return plain(a) === plain(b);
}

export const ART_SLOTS = ["portrait", "hero", "logo", "wide", "icon"] as const;
export type ArtSlot = (typeof ART_SLOTS)[number];

/** Steam's custom artwork slot numbers; the icon is not one. */
export const SLOT_NUMBER: Record<Exclude<ArtSlot, "icon">, number> = { portrait: 0, hero: 1, logo: 2, wide: 3 };

/** A web link, rather than a path on this computer? */
export function isLink(text: string): boolean {
    return /^https?:\/\//i.test(text.trim());
}

/** The file type Steam is told for an image: PNG or JPG for the four slots, PNG for an icon. */
export function steamExt(ext: string, slot: ArtSlot): "png" | "jpg" | undefined {
    const e = ext.toLowerCase();
    if (e === "png") return "png";
    if ((e === "jpg" || e === "jpeg") && slot !== "icon") return "jpg";
    return undefined;
}

/** A shortcut's appid as Steam's client calls want it: unsigned. */
export function unsignedAppid(appid: number): number {
    return appid < 0 ? appid + 0x100000000 : appid;
}
