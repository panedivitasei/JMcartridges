// The plugin's block in Millennium's plugin list: how many games are ready, and Open.
import { useEffect, useRef, useState } from "react";
import type { Host } from "./host.ts";
import { countsOf } from "./model.ts";
import { TEXT } from "./text.ts";
import { JM_CSS } from "./theme.ts";
import { Button } from "./widgets.tsx";

export interface Entry {
    host: Host;
    /** Opens the window over the window the click came from. */
    open(from: Window | undefined, onClose: () => void): void;
}

let entry: Entry | undefined;

export function setEntry(next: Entry): void {
    entry = next;
}

let offered = false;

/** An install nobody has opened yet opens its window by itself, once per Steam session at most. */
export async function openIfNew(from: Window | undefined, onClose: () => void = () => {}): Promise<void> {
    if (!entry || offered || !from || from.document?.visibilityState === "hidden") return;
    offered = true;
    const state = await entry.host.state().catch(() => undefined);
    if (state && !state.prefs.opened) entry.open(from, onClose);
}

export function JmSection() {
    const [counts, setCounts] = useState<{ ready: number; total: number } | undefined>();
    const anchor = useRef<HTMLDivElement>(null);
    const from = () => anchor.current?.ownerDocument?.defaultView ?? undefined;

    const read = () => {
        void entry?.host.scan().then((res) => {
            if (!res.error) setCounts(countsOf(res.games));
        });
    };
    useEffect(read, []);
    useEffect(() => void openIfNew(from(), read), []); // eslint-disable-line react-hooks/exhaustive-deps

    if (!entry) return null;
    const line = counts === undefined ? "" : counts.total === 0 ? TEXT.sectionEmpty : TEXT.sectionReady(counts.ready, counts.total);
    return (
        <div ref={anchor} className="jm jm-dark jm-inline">
            <style>{JM_CSS}</style>
            <div className="jm-panel">
                <span className="jm-logo" />
                <div className="jm-grow">
                    <div className="jm-muted">{line}</div>
                </div>
                <Button primary onClick={() => entry?.open(from(), read)}>
                    {TEXT.sectionOpen}
                </Button>
            </div>
        </div>
    );
}
