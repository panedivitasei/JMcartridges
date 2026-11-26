// The Cartridge page of a game's Properties dialog: the window's game panel for that one game.
import { useEffect, useRef, useState } from "react";
import { GameEditor } from "./editor.tsx";
import type { Host } from "./host.ts";
import type { Row, State } from "./model.ts";
import { JM_CSS } from "./theme.ts";
import { FloatHome } from "./widgets.tsx";

let host: Host | undefined;

export function setCartridgeHost(next: Host): void {
    host = next;
}

export function CartridgePage({ appid }: { appid: number }) {
    const [row, setRow] = useState<Row | undefined>();
    const [state, setState] = useState<State | undefined>();
    const [home, setHome] = useState<HTMLElement | undefined>();
    const alive = useRef(true);
    useEffect(() => () => void (alive.current = false), []);

    const read = async () => {
        if (!host) return;
        const [games, st] = await Promise.all([host.scan(), host.state().catch(() => undefined)]);
        if (!alive.current) return;
        if (st) setState(st);
        setRow(games.games.find((g) => g.appid === appid));
    };
    useEffect(() => void read(), [appid]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!host || !row) return null;
    return (
        <div className="jm jm-dark jm-inline jm-page" ref={(el) => setHome(el?.ownerDocument.body ?? undefined)}>
            <style>{JM_CSS}</style>
            <FloatHome.Provider value={home}>
                <GameEditor host={host} row={row} state={state} onChanged={() => void read()} />
            </FloatHome.Provider>
        </div>
    );
}
