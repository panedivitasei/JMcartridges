// What Steam knows about the user's non-Steam games, and the client calls that change their pictures.
import type { SteamApps } from "../window/host";

interface Overview {
    appid: number;
    display_name?: string;
}

interface SteamWindow {
    appStore?: { allApps?: Overview[]; GetAppOverviewByAppID?(appid: number): Overview | undefined };
    appDetailsStore?: {
        GetAppData?(appid: number): { customImageInfo?: { logoPosition?: unknown } } | undefined;
        RequestCustomImageInfo?(overview: Overview): Promise<unknown>;
        SaveCustomLogoPosition?(overview: Overview, position: object): Promise<unknown>;
        ClearCustomLogoPosition?(overview: Overview): Promise<unknown>;
    };
    SteamClient?: { Apps?: SteamApps };
    App?: { m_CurrentUser?: { strSteamID?: string } };
}

const steam = () => window as unknown as SteamWindow;

/** A shortcut's appid has the top bit set; Steam hands it over signed or unsigned. */
export function isShortcut(appid: unknown): appid is number {
    return typeof appid === "number" && (appid < 0 || appid >= 0x80000000);
}

export function unsigned(appid: number): number {
    return appid >>> 0;
}

/** Every non-Steam game in the library, with the name Steam shows. */
export function listGames(): { appid: number; name: string }[] {
    try {
        return (steam().appStore?.allApps ?? []).filter((a) => isShortcut(a?.appid)).map((a) => ({ appid: unsigned(a.appid), name: String(a.display_name ?? a.appid) }));
    } catch {
        return [];
    }
}

/** Every purchased game in the library, by name. */
export function listSteamGames(): { appid: number; name: string }[] {
    try {
        const apps = (steam().appStore?.allApps ?? []) as (Overview & { app_type?: number })[];
        return apps
            .filter((a) => typeof a?.appid === "number" && a.appid > 0 && !isShortcut(a.appid) && a.app_type === 1 && !!a.display_name)
            .map((a) => ({ appid: a.appid, name: String(a.display_name) }))
            .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
        return [];
    }
}

/** The picture Steam itself shows in a slot of a purchased game: its cached copy when it has one, else the one on Steam's servers. */
export function steamArt(appid: number, slot: string): string | undefined {
    try {
        const stores = steam() as unknown as { appStore?: Record<string, (o: unknown) => unknown>; appDetailsStore?: Record<string, (o: unknown) => unknown> };
        const overview = steam().appStore?.GetAppOverviewByAppID?.(appid);
        if (!overview) return undefined;
        const first = (list: unknown) => (Array.isArray(list) ? list.find((u): u is string => typeof u === "string" && u !== "") : typeof list === "string" && list ? list : undefined);
        const app = stores.appStore;
        const details = stores.appDetailsStore;
        if (slot === "portrait") return first(app?.GetCachedVerticalCapsuleURL?.(overview)) ?? first(app?.GetVerticalCapsuleURLForApp?.(overview));
        if (slot === "wide") return first(details?.GetHeaderImages?.(overview));
        if (slot === "hero") return first((details?.GetHeroImages?.(overview) as { rgHeroImages?: unknown } | undefined)?.rgHeroImages);
        if (slot === "logo") return first((details?.GetLogoImages?.(overview) as { rgLogoImages?: unknown } | undefined)?.rgLogoImages);
    } catch {
        /* no picture is shown */
    }
    return undefined;
}

export function steamApps(): SteamApps | undefined {
    return steam().SteamClient?.Apps;
}

/** The signed-in account's 32-bit id, or 0 while Steam has not said. */
export function accountId(): number {
    try {
        const friends = Reflect.get(globalThis, "friendStore") as { currentUserSteamID?: { GetAccountID?(): number } } | undefined;
        const known = friends?.currentUserSteamID?.GetAccountID?.();
        if (typeof known === "number" && known > 0) return known;
        const id = steam().App?.m_CurrentUser?.strSteamID;
        return id && /^\d+$/.test(id) ? Number(BigInt(id) & 0xffffffffn) : 0;
    } catch {
        return 0;
    }
}

/** Steam's own default; a custom logo stays hidden until it has a position. */
const LOGO_POSITION = { pinnedPosition: "BottomLeft", nWidthPct: 50, nHeightPct: 50 };

/** Gives a logo a position unless it has one. */
export async function ensureLogoPosition(appid: number): Promise<void> {
    const store = steam().appDetailsStore;
    const overview = steam().appStore?.GetAppOverviewByAppID?.(appid);
    if (!store || !overview || typeof store.SaveCustomLogoPosition !== "function") return;
    await store.RequestCustomImageInfo?.(overview);
    if (store.GetAppData?.(appid)?.customImageInfo?.logoPosition) return;
    await store.SaveCustomLogoPosition(overview, LOGO_POSITION);
}

export async function clearLogoPosition(appid: number): Promise<void> {
    const store = steam().appDetailsStore;
    const overview = steam().appStore?.GetAppOverviewByAppID?.(appid);
    if (store && overview) await store.ClearCustomLogoPosition?.(overview);
}
