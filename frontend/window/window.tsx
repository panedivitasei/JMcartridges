// The window: the games on the left, the picked game on the right, Auto Match above them.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { GameEditor } from "./editor.tsx";
import type { Host, Progress } from "./host.ts";
import { countsOf, visibleRows, type ListFilter, type Row, type State, type Status } from "./model.ts";
import { Options } from "./options.tsx";
import { Sources } from "./sources.tsx";
import { TEXT } from "./text.ts";
import { JM_CSS } from "./theme.ts";
import { Button, Card, Chip, Segments, TextInput } from "./widgets.tsx";

const STATUS_TEXT: Record<Status, string> = {
    ready: TEXT.statusReady,
    none: TEXT.statusMatch,
    new: TEXT.statusNew,
    excluded: TEXT.statusSkipped,
};

/** How many list rows get their portrait as a thumbnail; each is one backend read. */
const THUMB_LIMIT = 80;

function progressText(p: Progress): string {
    return p.phase === "finding" ? TEXT.progressFinding(p.done, p.total) : TEXT.progressDone;
}

export function JmWindow({ host, startAppid }: { host: Host; startAppid?: number }) {
    const [state, setState] = useState<State | undefined>();
    const [rows, setRows] = useState<Row[] | undefined>();
    const [failed, setFailed] = useState(false);
    const [selected, setSelected] = useState<number | undefined>(startAppid);
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState<ListFilter>("all");
    const [progress, setProgress] = useState<Progress | undefined>();
    const [running, setRunning] = useState(false);
    const [runFailed, setRunFailed] = useState(false);
    const [options, setOptions] = useState(false);
    const [sources, setSources] = useState(false);
    const [thumbs, setThumbs] = useState<Record<number, string | null>>({});
    const [artTick, setArtTick] = useState(0);
    const alive = useRef(true);
    const asked = useRef(new Set<number>());
    const frame = useRef<HTMLDivElement>(null);
    useEffect(() => () => void (alive.current = false), []);

    // Names this popup's page for theme.ts, which styles Steam's title bar over the header.
    useLayoutEffect(() => {
        const page = frame.current?.ownerDocument.documentElement;
        page?.classList.add("jm-popup");
        return () => page?.classList.remove("jm-popup");
    }, []);

    const rescan = async (): Promise<Row[] | undefined> => {
        const res = await host.scan();
        if (!alive.current) return undefined;
        if (res.error) {
            setFailed(true);
            return undefined;
        }
        setFailed(false);
        setRows(res.games);
        return res.games;
    };

    const logos = async (games: readonly Row[], force?: boolean) => {
        const changed = await host.autoLogos(games, { force }).catch(() => false);
        if (alive.current && changed) setArtTick((n) => n + 1);
    };

    const run = async () => {
        if (running) return;
        setRunning(true);
        setRunFailed(false);
        const out = await host.autoMode((p) => alive.current && setProgress(p));
        if (!alive.current) return;
        if (out.games.length > 0) setRows(out.games);
        asked.current.clear();
        setThumbs({});
        setArtTick((n) => n + 1);
        setRunning(false);
        setRunFailed(!!out.error);
        if (out.error) setProgress(undefined);
        else setTimeout(() => alive.current && setProgress(undefined), 4000);
    };

    // A new install opens on its sources; nothing is matched until Auto Match or a search asks.
    useEffect(() => {
        void (async () => {
            const fresh = await host.firstRun().catch(() => false);
            const st = await host.state().catch(() => undefined);
            if (!alive.current) return;
            if (st) setState(st);
            if (fresh) setSources(true);
            const games = await rescan();
            if (games) void logos(games);
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const counts = useMemo(() => countsOf(rows ?? []), [rows]);
    const shown = useMemo(() => visibleRows(rows ?? [], query, filter), [rows, query, filter]);
    const current = rows?.find((r) => r.appid === selected) ?? shown[0];
    // The first game shown is picked once, so a search or a filter does not swap the game under the user's hands.
    useEffect(() => {
        if (selected === undefined && current) setSelected(current.appid);
    }, [selected, current]);

    // The small portraits of the listed games: the kept ones in one call, the rest as they are made.
    useEffect(() => {
        const want = shown.slice(0, THUMB_LIMIT).filter((row) => !asked.current.has(row.appid));
        if (want.length === 0) return;
        for (const row of want) asked.current.add(row.appid);
        void host
            .thumbs(
                want,
                (appid, image) => alive.current && setThumbs((prev) => ({ ...prev, [appid]: image ?? null })),
                () => !alive.current,
            )
            .catch(() => undefined);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shown]);

    const theme = state?.prefs.theme ?? "dark";
    const share = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : progress?.phase === "done" ? 100 : 0;

    return (
        <div className={`jm jm-${theme}`} ref={frame}>
            <style>{JM_CSS}</style>
            <div className="jm-header">
                <span className="jm-logo" />
                <span className="jm-grow" />
                <TextInput className="jm-search" value={query} onChange={setQuery} placeholder={TEXT.search} />
                <Button onClick={() => setSources(true)}>{TEXT.sources}</Button>
                <Button onClick={() => setOptions(true)}>{TEXT.options}</Button>
            </div>
            <div className="jm-bar">
                <span className="jm-summary">{rows ? TEXT.summary(counts.ready, counts.total) : ""}</span>
                <div className="jm-progress">
                    {(running || progress?.phase === "done") && progress && (
                        <>
                            <div className="jm-track">
                                <div className="jm-fill" style={{ width: `${share}%` }} />
                            </div>
                            <span className="jm-progress-text">{progressText(progress)}</span>
                        </>
                    )}
                    {runFailed && <span className="jm-error">{TEXT.progressFailed}</span>}
                </div>
                <Button primary disabled={running} onClick={() => void run()}>
                    {TEXT.autoMode}
                </Button>
            </div>
            <div className="jm-main">
                <Card
                    className="jm-list"
                    title={TEXT.listTitle}
                    side={
                        <Segments<ListFilter>
                            value={filter}
                            options={[
                                { id: "all", label: TEXT.filterAll },
                                { id: "todo", label: TEXT.filterTodo },
                            ]}
                            onChange={setFilter}
                        />
                    }
                >
                    <div className="jm-card-body">
                        {failed && <div className="jm-empty">{TEXT.loadFailed}</div>}
                        {!failed && rows && rows.length === 0 && <div className="jm-empty">{TEXT.noGames}</div>}
                        {!failed && rows && rows.length > 0 && shown.length === 0 && <div className="jm-empty">{TEXT.listEmpty}</div>}
                        {shown.map((row) => {
                            const thumb = thumbs[row.appid];
                            return (
                                <button
                                    key={row.appid}
                                    type="button"
                                    className={`jm-game${current?.appid === row.appid ? " jm-picked" : ""}`}
                                    onClick={() => setSelected(row.appid)}
                                >
                                    <span className="jm-thumb" style={thumb ? { backgroundImage: `url(${thumb})` } : undefined} />
                                    <span className="jm-game-name">{row.name}</span>
                                    <Chip kind={row.status === "ready" ? "ready" : undefined}>{STATUS_TEXT[row.status]}</Chip>
                                </button>
                            );
                        })}
                    </div>
                </Card>
                {current ? (
                    <Card className="jm-detail" title={current.name} side={STATUS_TEXT[current.status]}>
                        <GameEditor
                            host={host}
                            row={current}
                            state={state}
                            locked={running}
                            artTick={artTick}
                            onChanged={() => void rescan()}
                            onPortrait={(image) => setThumbs((prev) => ({ ...prev, [current.appid]: image ?? null }))}
                        />
                    </Card>
                ) : (
                    <Card className="jm-detail" title={TEXT.app}>
                        <div className="jm-empty">{rows && rows.length > 0 ? TEXT.pickGame : ""}</div>
                    </Card>
                )}
            </div>
            {options && state && <Options host={host} state={state} onState={setState} onClose={() => setOptions(false)} />}
            {sources && state && <Sources host={host} state={state} onState={setState} onClose={() => setSources(false)} />}
        </div>
    );
}
