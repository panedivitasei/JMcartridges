// Opens a popup window the way Steam opens its own.
import { cloneElement, createElement, type ComponentType, type ReactElement, type ReactNode } from "react";
import { showModal as millenniumShowModal, type ShowModalProps } from "@steambrew/client";
import { resolveAll, resolveOnce } from "./modules";

type SteamShowModal = (modal: ReactElement, parent: EventTarget, props: ShowModalProps) => unknown;
type ConfigRoot = ComponentType<{ IN_DESKTOPUI?: boolean; IN_GAMEPADUI?: boolean; children?: ReactNode }>;

/** Steam's own showModal, which opens the popup at the size asked for. */
function steamShowModal(): SteamShowModal | undefined {
    return resolveOnce<SteamShowModal>(
        "showModal",
        (v) => typeof v === "function" && v.toString().includes("bNeverPopOut") && v.toString().includes("popupWidth"),
        (src) => src.includes("RequestModalMeasure") && src.includes("bNeverPopOut"),
    );
}

let root: ConfigRoot | null | undefined;

/** Steam's config context, which its own controls expect around them; used only when exactly one export fits. */
function configRoot(): ConfigRoot | null {
    if (root !== undefined) return root;
    const hits = resolveAll<ConfigRoot>(
        (v) => typeof v === "function" && /IN_DESKTOPUI/.test(v.toString()) && /\.Provider/.test(v.toString()),
        (src) => src.includes("ConfigContext without a provider"),
    );
    root = hits.length === 1 ? hits[0]! : null;
    return root;
}

export function showDialog(modal: ReactElement, opts: { title: string; width: number; height: number; onClose?: () => void; parent?: Window }): void {
    const parent = opts.parent ?? window;
    // A popup asked from a hidden window would open where nobody sees it.
    if (parent.document?.visibilityState === "hidden") return;
    const props: ShowModalProps = { strTitle: opts.title, popupWidth: opts.width, popupHeight: opts.height, bForcePopOut: true, fnOnClose: opts.onClose };
    const config = configRoot();
    let element = modal;
    if (config) {
        const Wrapped = ({ closeModal }: { closeModal?: () => void }) =>
            createElement(config, { IN_DESKTOPUI: true, IN_GAMEPADUI: false }, closeModal ? cloneElement(modal, { closeModal } as object) : modal);
        element = createElement(Wrapped, { ...(modal.props as object) });
    }
    const show = steamShowModal();
    if (show) void show(element, parent, props);
    else millenniumShowModal(element, parent, props);
}

/** A share of the screen the window is asked from, never under a size the window needs. */
export function screenSize(from: Window = window, scale = { width: 0.82, height: 0.9 }): { width: number; height: number } {
    const screen = from.screen?.availWidth > 100 ? from.screen : undefined;
    return { width: Math.max(1000, Math.round((screen?.availWidth || 1600) * scale.width)), height: Math.max(680, Math.round((screen?.availHeight || 900) * scale.height)) };
}

/** Steam's main window when it can be seen; the plugin itself runs in a hidden one. */
export function mainWindow(): Window | undefined {
    try {
        const popup = (globalThis as unknown as { g_PopupManager?: { GetExistingPopup?(name: string): { m_popup?: Window; window?: Window } | undefined } }).g_PopupManager?.GetExistingPopup?.("SP Desktop_uid0");
        const win = popup?.m_popup ?? popup?.window;
        return win && win.document?.visibilityState === "visible" ? win : undefined;
    } catch {
        return undefined;
    }
}
