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
