// The picture picker for one slot of one game: the sources' pictures, a file from this computer, or a link.
import { useEffect, useRef, useState } from "react";
import type { ArtOption, ArtOptions, Host } from "./host.ts";
import { IMAGE_ACCEPT, MAX_IMAGE_BYTES } from "./image.ts";
import type { ArtSlot, Row, SourceId } from "./model.ts";
import { errorText, TEXT } from "./text.ts";
import { Button, Overlay, TextInput } from "./widgets.tsx";

export const SLOT_LABEL: Record<ArtSlot, string> = {
    portrait: TEXT.slotPortrait,
    hero: TEXT.slotHero,
    logo: TEXT.slotLogo,
    wide: TEXT.slotWide,
    icon: TEXT.slotIcon,
};

const SOURCE_TAG: Record<SourceId, string> = {
    steam: TEXT.sourceSteam,
    igdb: TEXT.matchIgdb,
    thegamesdb: TEXT.sourceTheGamesDb,
    steamgriddb: TEXT.sourceSteamGridDb,
    retroachievements: TEXT.sourceRetroAchievements,
};

/** Width / height of a slot's picture, for the grid cells. */
export const SLOT_RATIO: Record<ArtSlot, number> = { portrait: 2 / 3, hero: 1920 / 620, logo: 2, wide: 460 / 215, icon: 1 };

function readFile(file: File): Promise<string | null> {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const text = typeof reader.result === "string" ? reader.result : "";
            resolve(text ? text.substring(text.indexOf(",") + 1) : null);
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
    });
}

export function ArtPicker({
    host,
    row,
    slot,
    onDone,
    onClose,
}: {
    host: Host;
    row: Pick<Row, "appid" | "name">;
    slot: ArtSlot;
    /** The slot changed: the new picture as a data: URL; `none`: the game was set to have no logo. */
    onDone: (image: string, none?: boolean) => void;
    onClose: () => void;
}) {
    const appid = row.appid;
    const [found, setFound] = useState<ArtOptions | undefined>();
    const [picked, setPicked] = useState<ArtOption | undefined>();
    const [gone, setGone] = useState<string[]>([]);
    const [term, setTerm] = useState("");
    const [text, setText] = useState("");
    const [key, setKey] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | undefined>();
    const fileInput = useRef<HTMLInputElement>(null);
    const alive = useRef(true);
    useEffect(() => () => void (alive.current = false), []);

    const load = (search?: string) => {
        setFound(undefined);
        setPicked(undefined);
        setGone([]);
        void host
            .artOptions(row, slot, search)
            .then((res) => alive.current && setFound(res))
            .catch(() => alive.current && setFound({ options: [], needsKey: false, error: "unknown" }));
    };
    useEffect(() => load(), [appid, slot]); // eslint-disable-line react-hooks/exhaustive-deps

    const working = useRef(false);
    const apply = async (choice: Parameters<Host["setArt"]>[2]) => {
        if (working.current) return;
        working.current = true;
        setBusy(true);
        setError(undefined);
        const res = await host.setArt(appid, slot, choice).catch(() => ({ error: "unknown" }) as { image?: string; error?: string });
        working.current = false;
        if (!alive.current) return;
        setBusy(false);
        if (res.error || !res.image) setError(errorText(res.error));
        else onDone(res.image, choice.kind === "none");
    };

    const onFile = async (file: File | undefined) => {
        if (!file) return;
        if (file.size > MAX_IMAGE_BYTES) return setError(errorText("too-large"));
        const base64 = await readFile(file);
        if (!base64) return setError(errorText("not-found"));
        // The picture's kind is told by its bytes, whatever the file is called.
        await apply({ kind: "bytes", base64, ext: "png" });
    };

    const saveKey = async () => {
        if (key.trim() === "" || working.current) return;
        working.current = true;
        setBusy(true);
        await host.signIn("steamgriddb", { steamgriddb_api: key }).catch(() => false);
        working.current = false;
        if (!alive.current) return;
        setBusy(false);
        setKey("");
        load(term.trim() || undefined);
    };

    const ratio = SLOT_RATIO[slot];
    const wideCells = slot === "hero" || slot === "wide";
    // A source's picture that does not load is left out.
    const options = (found?.options ?? []).filter((o) => !gone.includes(o.url));
    return (
        <Overlay
            title={SLOT_LABEL[slot]}
            side={row.name}
            onClose={onClose}
            foot={
                <>
                    <input
                        ref={fileInput}
                        type="file"
                        accept={IMAGE_ACCEPT}
                        style={{ display: "none" }}
                        onChange={(e) => {
                            const file = e.target.files?.[0];
                            // So the same file can be chosen again after an error.
                            e.target.value = "";
                            void onFile(file);
                        }}
                    />
                    <Button disabled={busy} onClick={() => fileInput.current?.click()}>
                        {TEXT.pickerFile}
                    </Button>
                    {slot === "logo" && (
                        <Button disabled={busy} onClick={() => void apply({ kind: "none" })}>
                            {TEXT.noLogo}
                        </Button>
                    )}
                    <div style={{ flex: "1 1 220px", minWidth: 160 }}>
                        <TextInput value={text} onChange={setText} placeholder={TEXT.pickerLink} onEnter={() => text.trim() && void apply({ kind: "text", text })} />
                    </div>
                    <Button disabled={busy || text.trim() === ""} onClick={() => void apply({ kind: "text", text })}>
                        {TEXT.pickerUse}
                    </Button>
                    <span className="jm-grow" />
                    <Button disabled={busy} onClick={onClose}>
                        {TEXT.cancel}
                    </Button>
                    <Button primary disabled={busy || !picked} onClick={() => picked && void apply({ kind: "option", option: picked })}>
                        {TEXT.pickerUseThis}
                    </Button>
                </>
            }
        >
            <div className="jm-row" style={{ marginBottom: 12 }}>
                <div style={{ flex: "0 1 300px" }}>
                    <TextInput value={term} onChange={setTerm} placeholder={TEXT.pickerSearch} onEnter={() => load(term.trim() || undefined)} />
                </div>
                <Button small onClick={() => load(term.trim() || undefined)}>
                    {TEXT.matchSearchButton}
                </Button>
                <span className="jm-grow" />
                {error && <span className="jm-error">{error}</span>}
            </div>
            {found === undefined ? (
                <div className="jm-empty">{TEXT.pickerLoading}</div>
            ) : (
                <>
                    {options.length > 0 ? (
                        <div className={`jm-grid${wideCells ? " jm-grid-wide" : ""}`}>
                            {options.map((o) => (
                                <button
                                    key={o.url}
                                    type="button"
                                    className={`jm-option${slot === "logo" || slot === "icon" ? " jm-contain" : ""}${picked?.url === o.url ? " jm-picked" : ""}`}
                                    style={{ aspectRatio: String(ratio) }}
                                    onClick={() => setPicked(o)}
                                    onDoubleClick={() => void apply({ kind: "option", option: o })}
                                >
                                    <img
                                        src={o.thumb}
                                        alt=""
                                        loading="lazy"
                                        onError={() => {
                                            setGone((g) => [...g, o.url]);
                                            setPicked((p) => (p?.url === o.url ? undefined : p));
                                        }}
                                    />
                                    <span className="jm-option-tag">{SOURCE_TAG[o.source] ?? ""}</span>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <div className="jm-empty">{found.error ? errorText(found.error) : TEXT.pickerEmpty}</div>
                    )}
                    {found.needsKey && (
                        <div className="jm-row" style={{ marginTop: 14 }}>
                            <span className="jm-muted">{TEXT.pickerNeedsKey}</span>
                            <div style={{ flex: "0 1 260px" }}>
                                <TextInput value={key} onChange={setKey} placeholder={TEXT.keySteamGridDb} type="password" onEnter={() => void saveKey()} />
                            </div>
                            <Button small disabled={busy || key.trim() === ""} onClick={() => void saveKey()}>
                                {TEXT.save}
                            </Button>
                        </div>
                    )}
                </>
            )}
        </Overlay>
    );
}
