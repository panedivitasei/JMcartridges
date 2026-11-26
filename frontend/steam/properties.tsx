// Adds a page to a non-Steam game's Properties dialog; Steam builds that dialog's page list on every draw and hands it to its sidebar.
import { Component, createElement, type ComponentType, type ReactNode } from "react";
import { isShortcut, unsigned } from "./library";
import { watchElements } from "./jsx";

const ROUTE_PREFIX = "/app/:appid/properties/";
const SHORTCUT_ROUTE = `${ROUTE_PREFIX}shortcut`;
const OUR_ROUTE = `${ROUTE_PREFIX}cartridge`;
/** Steam's own list has seven pages at most; a longer one is something else. */
const MAX_PAGES = 20;

export interface Page {
    title: string;
    route: string;
    link: string;
    content: unknown;
}

/** The page list of a non-Steam game's Properties dialog in an element's props, when that is what they hold and our page is not in it yet. */
export function shortcutPages(props: unknown): Page[] | undefined {
    if (!props || typeof props !== "object") return undefined;
    const pages = (props as { pages?: unknown }).pages;
    if (!Array.isArray(pages) || pages.length === 0 || pages.length > MAX_PAGES) return undefined;
    if ((pages[0] as Page | undefined)?.route !== SHORTCUT_ROUTE) return undefined;
    for (const page of pages as Page[]) {
        if (!page || typeof page.route !== "string" || !page.route.startsWith(ROUTE_PREFIX) || typeof page.link !== "string") return undefined;
        if (page.route === OUR_ROUTE) return undefined;
    }
    return pages as Page[];
}

/** The game in a page's link, "/app/<appid>/properties/<name>". */
export function appidOfLink(link: string): number | undefined {
    const appid = Number(link.split("/")[2]);
    return Number.isFinite(appid) && isShortcut(appid) ? unsigned(appid) : undefined;
}

/** Keeps an error of our page inside it, so it never takes the Properties dialog down. */
class Boundary extends Component<{ failed: string; report(err: unknown): void; children?: ReactNode }, { failed: boolean }> {
    override state = { failed: false };

    static getDerivedStateFromError(): { failed: boolean } {
        return { failed: true };
    }

    override componentDidCatch(err: unknown): void {
        this.props.report(err);
    }

    override render(): ReactNode {
        return this.state.failed ? createElement("div", { style: { padding: "12px 16px" } }, this.props.failed) : this.props.children;
    }
}

/** Adds a page titled `title` with `body` for the game to every non-Steam game's Properties dialog; false when Steam's element factory was not found. */
export function addPropertiesPage(opts: { title: string; failed: string; body: ComponentType<{ appid: number }>; report(where: string, err: unknown): void }): boolean {
    /** One wrapper per sidebar type of Steam's, so React never rebuilds the dialog. */
    const wrappers = new WeakMap<object, ComponentType<{ pages: Page[] }>>();

    const wrapperFor = (type: object): ComponentType<{ pages: Page[] }> => {
        let wrapper = wrappers.get(type);
        if (!wrapper) {
            const original = type as unknown as ComponentType<{ pages: Page[] }>;
            wrapper = function JmSidebar(props: { pages: Page[] }) {
                // React also calls a component with no props to build an error's component stack.
                if (!props || typeof props !== "object") return null;
                try {
                    const first = props.pages[0]?.link ?? "";
                    const appid = appidOfLink(first);
                    if (appid !== undefined && shortcutPages(props)) {
                        const page: Page = {
                            title: opts.title,
                            route: OUR_ROUTE,
                            link: `/app/${first.split("/")[2]}/properties/cartridge`,
                            content: createElement(
                                "div",
                                { className: "DialogBody" },
                                createElement(Boundary, { failed: opts.failed, report: (err) => opts.report("properties page", err) }, createElement(opts.body, { appid })),
                            ),
                        };
                        return createElement(original, { ...props, pages: [...props.pages, page] });
                    }
                } catch (err) {
                    opts.report("properties", err);
                }
                return createElement(original, props);
            };
            wrappers.set(type, wrapper);
        }
        return wrapper;
    };

    return watchElements((type, props) => {
        // Nearly every element has no `pages`: that is tested first.
        if (!props || typeof props !== "object" || !("pages" in props)) return undefined;
        try {
            if (typeof type !== "function" && (typeof type !== "object" || type === null)) return undefined;
            return shortcutPages(props) ? wrapperFor(type as object) : undefined;
        } catch (err) {
            opts.report("properties", err);
            return undefined;
        }
    });
}
