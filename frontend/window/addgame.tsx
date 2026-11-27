// The Add Game card: the purchased Steam games, put in the list one at a time.
import { useMemo, useState } from "react";
import type { Host } from "./host.ts";
import { errorText, TEXT } from "./text.ts";
import { Button, Overlay, TextInput } from "./widgets.tsx";

/** How many games are listed at once; the search narrows the rest. */
const SHOWN = 100;

export function AddGame({ host, onAdded, onClose }: { host: Host; onAdded: (appid: number) => void; onClose: () => void }) {
    const [query, setQuery] = useState("");
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState<string | undefined>();
    const all = useMemo(() => host.steamGames(), [host]);
    const typed = query.trim().toLowerCase();
    const found = useMemo(() => (typed ? all.filter((g) => g.name.toLowerCase().includes(typed)) : all).slice(0, SHOWN), [all, typed]);

    const add = async (game: { appid: number; name: string }) => {
        setBusy(true);
        setFailed(undefined);
        const res = await host.addSteam(game).catch(() => ({ error: "unknown" }));
        setBusy(false);
        if (res.error) setFailed(errorText(res.error));
        else onAdded(game.appid);
    };

    return (
        <Overlay
            title={TEXT.addGame}
            narrow
            onClose={onClose}
            foot={
                <>
                    <span className="jm-grow" />
                    <Button onClick={onClose}>{TEXT.close}</Button>
                </>
            }
        >
            <TextInput value={query} onChange={setQuery} placeholder={TEXT.search} />
            {failed && (
                <div className="jm-error" style={{ marginTop: 6 }}>
                    {failed}
                </div>
            )}
            <div className="jm-add-list">
                {found.length === 0 && <div className="jm-empty">{TEXT.listEmpty}</div>}
                {found.map((game) => (
                    <button key={game.appid} type="button" className="jm-game" disabled={busy} onClick={() => void add(game)}>
                        <span className="jm-game-name">{game.name}</span>
                    </button>
                ))}
            </div>
        </Overlay>
    );
}
