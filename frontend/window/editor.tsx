// One game: a preview, its five pictures, what it is matched to, and its Game Info.
import { useEffect, useRef, useState } from "react";
import type { ArtSlotState, GameInfo, Host } from "./host.ts";
import { ART_SLOTS, candidateDetails, draftOf, infoOf, matchSources, sameDraft, validDate, type ArtSlot, type Candidate, type Draft, type MatchSource, type Row, type State } from "./model.ts";
import { ArtPicker, SLOT_LABEL } from "./picker.tsx";
import { errorText, TEXT } from "./text.ts";
import { Button, Chip, Field, LinkButton, Section, Select, TextInput } from "./widgets.tsx";

const SOURCE_LABEL: Record<MatchSource | "none", string> = {
    steam: TEXT.matchSteam,
    igdb: TEXT.matchIgdb,
    thegamesdb: TEXT.sourceTheGamesDb,
    none: TEXT.matchNone,
};

/** The width of each picture tile; they share one height. */
const TILE_WIDTH: Record<ArtSlot, number> = { portrait: 84, hero: 220, logo: 150, wide: 180, icon: 108 };

const NO_ART: Record<ArtSlot, ArtSlotState> = {
    portrait: { present: false, chosen: false },
    hero: { present: false, chosen: false },
    logo: { present: false, chosen: false },
    wide: { present: false, chosen: false },
    icon: { present: false, chosen: false },
};

/** One action of the panel: it gets the token of the game it was started on, and whether that game is still shown. */
interface Work {
    (token: number, shown: () => boolean): Promise<void>;
}

export function GameEditor({
    host,
    row,
    state,
    onChanged,
    onPortrait,
    locked,
    artTick,
}: {
    host: Host;
    row: Row;
    state?: State;
    /** The game's match or status changed: the window reads the list again. */
    onChanged: () => void;
    onPortrait?: (image: string | undefined) => void;
    /** Auto Match is running: nothing can be changed meanwhile. */
    locked?: boolean;
    /** Counts up when the window changed a picture by itself: the pictures are read again. */
    artTick?: number;
}) {
    const appid = row.appid;
    const [game, setGame] = useState<GameInfo | undefined>();
    const [draft, setDraft] = useState<Draft | undefined>();
    const [stored, setStored] = useState<Draft | undefined>();
    const [art, setArt] = useState<Record<ArtSlot, ArtSlotState>>(NO_ART);
    const [images, setImages] = useState<Partial<Record<ArtSlot, string>>>({});
    const [picker, setPicker] = useState<ArtSlot | undefined>();
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<{ ok: boolean; text: string } | undefined>();
    const [searching, setSearching] = useState(false);
    // The source picked in the Match row's menu: the search asks it alone.
    const [picked, setPicked] = useState<MatchSource | undefined>();
    // A match is pulling the game's pictures: how many slots are done.
    const [pulling, setPulling] = useState<{ done: number; total: number } | undefined>();
    const [term, setTerm] = useState("");
    const [results, setResults] = useState<Candidate[] | undefined>();
    const [searchError, setSearchError] = useState<string | undefined>();
    const [noSource, setNoSource] = useState(false);
    const live = useRef(0);

    const status = row.status;
    const matchSource: MatchSource | "none" = row.match?.source ?? "none";

    const loadInfo = async (token: number) => {
        const g = await host.game(row).catch(() => undefined);
        if (live.current !== token || !g) return;
        const d = draftOf(g.info);
        setGame(g);
        setDraft(d);
        setStored(d);
    };
    const loadArt = async (token: number, only?: ArtSlot) => {
        const st = await host.artState(appid).catch(() => undefined);
        if (live.current !== token) return;
        if (st) setArt(st);
        for (const slot of only ? [only] : ART_SLOTS) {
            const image = await host.artImage(appid, slot, st?.[slot].stamp).catch(() => undefined);
            if (live.current !== token) return;
            setImages((prev) => ({ ...prev, [slot]: image }));
            if (slot === "portrait") onPortrait?.(image);
        }
    };

    useEffect(() => {
        if (artTick) void loadArt(live.current);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [artTick]);

    // Another game, or this game with another status: everything is read again.
    useEffect(() => {
        const token = ++live.current;
        setPulling(undefined);
        setGame(undefined);
        setDraft(undefined);
        setStored(undefined);
        setArt(NO_ART);
        setImages({});
        setNote(undefined);
        setPicker(undefined);
        setPicked(undefined);
        setSearching(false);
        setResults(undefined);
        setSearchError(undefined);
        setNoSource(false);
        setTerm(row.name);
        void loadInfo(token);
        void loadArt(token);
        return () => {
            live.current++;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [appid, status]);

    const set = (key: keyof Draft) => (value: string) => {
        setNote(undefined);
        setDraft((d) => (d ? { ...d, [key]: value } : d));
    };

    const dirty = !!draft && !!stored && !sameDraft(draft, stored);
    const edited = !!game?.custom && !(game.matched && stored && sameDraft(stored, draftOf(game.matched)));
    const sources = matchSources(state);

    // One action at a time: `work` gets the game's token, so what it reads lands only while that game is still shown.
    const act = async (work: Work) => {
        const token = live.current;
        setBusy(true);
        try {
            await work(token, () => live.current === token);
        } catch {
            if (live.current === token) setNote({ ok: false, text: errorText("unknown") });
        } finally {
            setBusy(false);
        }
    };

    const save = () => {
        if (!draft || !game) return;
        if (!validDate(draft.release_date)) return setNote({ ok: false, text: errorText("bad-date") });
        const info = infoOf({ ...draft, title: draft.title.trim() || row.name }, game.info);
        void act(async (token, shown) => {
            const res = await host.saveInfo(appid, info);
            if (res.error) return void (shown() && setNote({ ok: false, text: errorText("not-saved") }));
            await loadInfo(token);
            if (shown()) setNote({ ok: true, text: TEXT.saved });
            // A game filled in by hand needs no match to be ready.
            if (status !== "ready") onChanged();
        });
    };

    const resetInfo = () =>
        act(async (token, shown) => {
            const res = await host.resetInfo(appid);
            await loadInfo(token);
            if (shown()) setNote(res.error ? { ok: false, text: errorText("not-saved") } : undefined);
            onChanged();
        });

    const resetArt = (slot: ArtSlot) =>
        act(async (token, shown) => {
            const res = await host.resetArt(appid, slot);
            await loadArt(token, slot);
            if (shown()) setNote(res.error ? { ok: false, text: errorText(res.error) } : undefined);
        });

    const removeArt = (slot: ArtSlot) =>
        act(async (token, shown) => {
            const res = await host.removeArt(appid, slot);
            await loadArt(token, slot);
            if (shown()) setNote(res.error ? { ok: false, text: errorText(res.error) } : undefined);
        });

    const exclude = () =>
        act(async () => {
            await host.exclude(appid);
            onChanged();
        });

    const include = () =>
        act(async () => {
            await host.include(appid);
            onChanged();
        });

    const unlink = () =>
        act(async (token, shown) => {
            const res = await host.unlink(appid);
            if (res.error && shown()) setNote({ ok: false, text: errorText("unknown") });
            await loadInfo(token);
            await loadArt(token);
            onChanged();
        });

    // Lists a source's results; nothing is taken until Use is pressed on one.
    const ask = (text: string, source: MatchSource | undefined) => {
        if (text.trim() === "") return Promise.resolve();
        setSearchError(undefined);
        return act(async (_token, shown) => {
            const res = await host.searchMatches(text.trim(), source);
            if (!shown()) return;
            setResults(res.results);
            setNoSource(res.none);
            if (res.errors.length > 0) setSearchError(res.errors.map((code) => errorText(code)).join(" "));
        });
    };

    // A match brings its info and its pictures with it, slot by slot, with a bar that says how far.
    const useMatch = (candidate: Candidate) =>
        act(async (token, shown) => {
            const res = await host.useMatch(appid, candidate);
            if (res.error) return void (shown() && setSearchError(errorText(res.error)));
            if (shown()) {
                setSearching(false);
                setResults(undefined);
                setPicked(undefined);
                setPulling({ done: 0, total: 4 });
            }
            await loadInfo(token);
            try {
                await host.fetchArt(row, true, (done, total, slot, image) => {
                    if (!shown()) return;
                    setPulling({ done, total });
                    // A picture just set is shown as it came; only the logo, which may have become No Logo, is read again.
                    if (image) {
                        setImages((prev) => ({ ...prev, [slot]: image }));
                        setArt((prev) => ({ ...prev, [slot]: { present: true, chosen: true, fetched: true } }));
                        if (slot === "portrait") onPortrait?.(image);
                    } else if (slot === "logo") void loadArt(token, "logo");
                });
            } finally {
                if (shown()) setPulling(undefined);
            }
            onChanged();
        });

    const matchFrom = async (source: MatchSource) => {
        if (source === matchSource && !picked) return;
        const wanted = (row.match?.name || row.name).trim();
        setPicked(source);
        setSearching(true);
        setTerm(wanted);
        await ask(wanted, source);
    };

    const off = busy || !!locked;
    const year = draft && validDate(draft.release_date) ? draft.release_date.slice(0, 4) : "";
    const line = [draft?.developers.split(";")[0]?.trim(), year].filter((x) => !!x).join(" · ");
    const showSearch = searching || status === "none";

    return (
        <>
            <div className="jm-card-body">
                <Section title={TEXT.preview} side={edited ? <Chip>{TEXT.edited}</Chip> : undefined}>
                    <div className="jm-preview" style={images.hero ? { backgroundImage: `url(${images.hero})` } : undefined}>
                        <div className="jm-preview-shade" />
                        {images.logo ? <img className="jm-preview-logo" src={images.logo} alt="" /> : <div className="jm-preview-title">{draft?.title || row.name}</div>}
                    </div>
                    <div className="jm-preview-info">
                        <div className="jm-preview-portrait" style={images.portrait ? { backgroundImage: `url(${images.portrait})` } : undefined} />
                        <div className="jm-preview-text">
                            <div className="jm-preview-name">{draft?.title || row.name}</div>
                            {line && <div className="jm-preview-meta">{line}</div>}
                            <div className="jm-preview-desc">{draft?.description.trim() ? draft.description : <span className="jm-muted">{TEXT.previewNoDescription}</span>}</div>
                        </div>
                    </div>
                </Section>

                <div className="jm-cols">
                    <div className="jm-col">
                        <Section title={TEXT.infoTitle}>
                            {draft && (
                                <div className="jm-form">
                                    <Field label={TEXT.fieldTitle} wide>
                                        <TextInput value={draft.title} onChange={set("title")} />
                                    </Field>
                                    <Field label={TEXT.fieldDescription} wide>
                                        <textarea className="jm-textarea" rows={5} value={draft.description} spellCheck={false} onChange={(e) => set("description")(e.target.value)} />
                                    </Field>
                                    <Field label={TEXT.fieldDevelopers}>
                                        <TextInput value={draft.developers} onChange={set("developers")} placeholder={TEXT.fieldListHint} />
                                    </Field>
                                    <Field label={TEXT.fieldPublishers}>
                                        <TextInput value={draft.publishers} onChange={set("publishers")} placeholder={TEXT.fieldListHint} />
                                    </Field>
                                    <Field label={TEXT.fieldGenres}>
                                        <TextInput value={draft.genres} onChange={set("genres")} placeholder={TEXT.fieldListHint} />
                                    </Field>
                                    <Field label={TEXT.fieldRelease}>
                                        <TextInput value={draft.release_date} onChange={set("release_date")} placeholder={TEXT.fieldDateHint} />
                                    </Field>
                                </div>
                            )}
                        </Section>
                    </div>
                    <div className="jm-col">
                        <Section title={TEXT.artTitle}>
                            <div className="jm-art">
                                {ART_SLOTS.map((slot) => (
                                    <div key={slot} className="jm-tile" style={{ width: TILE_WIDTH[slot] }}>
                                        <button
                                            type="button"
                                            className={`jm-tile-pic${slot === "logo" || slot === "icon" ? " jm-contain" : ""}${art[slot].none ? " jm-none" : ""}`}
                                            style={images[slot] && !art[slot].none ? { backgroundImage: `url(${images[slot]})` } : undefined}
                                            disabled={off}
                                            title={TEXT.change}
                                            onClick={() => setPicker(slot)}
                                        >
                                            {art[slot].none ? TEXT.noLogo : null}
                                        </button>
                                        <div className="jm-tile-foot">
                                            <b>{SLOT_LABEL[slot]}</b>
                                            <span className="jm-tile-links">
                                                <LinkButton disabled={off} onClick={() => setPicker(slot)}>
                                                    {TEXT.change}
                                                </LinkButton>
                                                {art[slot].chosen && (
                                                    <LinkButton disabled={off} onClick={() => void resetArt(slot)}>
                                                        {TEXT.reset}
                                                    </LinkButton>
                                                )}
                                                {art[slot].present && (
                                                    <LinkButton disabled={off} onClick={() => void removeArt(slot)}>
                                                        {TEXT.remove}
                                                    </LinkButton>
                                                )}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </Section>

                        <Section title={TEXT.matchTitle}>
                            {pulling && (
                                <div className="jm-row" style={{ marginBottom: 8 }}>
                                    <div className="jm-track">
                                        <div className="jm-fill" style={{ width: `${Math.round((pulling.done / pulling.total) * 100)}%` }} />
                                    </div>
                                </div>
                            )}
                            <div className="jm-row">
                                {sources.length > 0 ? (
                                    <Select<MatchSource>
                                        label={SOURCE_LABEL[picked ?? matchSource]}
                                        value={picked ?? (matchSource === "none" ? undefined : matchSource)}
                                        options={sources.map((id) => ({ id, label: SOURCE_LABEL[id] }))}
                                        disabled={off}
                                        onChange={(source) => void matchFrom(source)}
                                    />
                                ) : (
                                    <Chip>{SOURCE_LABEL[matchSource]}</Chip>
                                )}
                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.match?.name ?? ""}</span>
                                <span className="jm-grow" />
                                {status === "excluded" ? (
                                    <LinkButton disabled={off} onClick={() => void include()}>
                                        {TEXT.include}
                                    </LinkButton>
                                ) : (
                                    <LinkButton disabled={off} onClick={() => void exclude()}>
                                        {TEXT.leaveAlone}
                                    </LinkButton>
                                )}
                                {row.match && (
                                    <LinkButton disabled={off} onClick={() => void unlink()}>
                                        {TEXT.unlink}
                                    </LinkButton>
                                )}
                                {status !== "none" && (
                                    <LinkButton disabled={off} onClick={() => setSearching((s) => !s)}>
                                        {TEXT.change}
                                    </LinkButton>
                                )}
                            </div>
                            {showSearch && (
                                <>
                                    <div className="jm-row" style={{ marginTop: 8 }}>
                                        <div style={{ flex: "1 1 auto" }}>
                                            <TextInput value={term} onChange={setTerm} placeholder={TEXT.search} onEnter={() => void ask(term, picked)} />
                                        </div>
                                        <Button small disabled={off || term.trim() === ""} onClick={() => void ask(term, picked)}>
                                            {TEXT.matchSearchButton}
                                        </Button>
                                    </div>
                                    {searchError && (
                                        <div className="jm-error" style={{ marginTop: 6 }}>
                                            {searchError}
                                        </div>
                                    )}
                                    {noSource && (
                                        <div className="jm-muted" style={{ marginTop: 6 }}>
                                            {TEXT.matchNoSource}
                                        </div>
                                    )}
                                    {results && results.length === 0 && !searchError && !noSource && (
                                        <div className="jm-muted" style={{ marginTop: 6 }}>
                                            {TEXT.matchNoResults}
                                        </div>
                                    )}
                                    {results && results.length > 0 && (
                                        <div className="jm-results">
                                            {results.map((c) => (
                                                <div key={`${c.source}-${c.id}`} className="jm-result">
                                                    <Chip>{SOURCE_LABEL[c.source]}</Chip>
                                                    <span className="jm-grow">
                                                        {c.name}
                                                        {candidateDetails(c) && <span className="jm-muted jm-result-details">{candidateDetails(c)}</span>}
                                                    </span>
                                                    <Button small disabled={off} onClick={() => void useMatch(c)}>
                                                        {TEXT.matchUse}
                                                    </Button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </>
                            )}
                        </Section>
                    </div>
                </div>
            </div>
            <div className="jm-foot jm-cols">
                <div className="jm-col jm-row">
                    {note && <span className={note.ok ? "jm-ok" : "jm-error"}>{note.text}</span>}
                    <span className="jm-grow" />
                    <Button disabled={off || !edited} onClick={() => void resetInfo()}>
                        {TEXT.reset}
                    </Button>
                    <Button primary disabled={off || !dirty} onClick={() => void save()}>
                        {TEXT.save}
                    </Button>
                </div>
                <div className="jm-col" />
            </div>
            {picker && (
                <ArtPicker
                    host={host}
                    row={row}
                    slot={picker}
                    onClose={() => setPicker(undefined)}
                    onDone={(image, none) => {
                        const slot = picker;
                        setPicker(undefined);
                        setImages((prev) => ({ ...prev, [slot]: image }));
                        setArt((prev) => ({ ...prev, [slot]: { present: true, chosen: true, none: none === true } }));
                        if (slot === "portrait") onPortrait?.(image);
                    }}
                />
            )}
        </>
    );
}
