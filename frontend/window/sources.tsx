// The Sources card: each source's switch and sign-in, in the order they are asked; a source is dragged by its grip.
import { useEffect, useRef, useState, type PointerEvent as GripEvent } from "react";
import type { Host } from "./host.ts";
import { inUse, moveSource, PARTS, type Part, type SourceId, type State } from "./model.ts";
import { TEXT } from "./text.ts";
import { Button, Check, Field, Overlay, TextInput } from "./widgets.tsx";

const NAME: Record<SourceId, string> = {
    steam: TEXT.sourceSteam,
    steamgriddb: TEXT.sourceSteamGridDb,
    igdb: TEXT.matchIgdb,
    thegamesdb: TEXT.sourceTheGamesDb,
    retroachievements: TEXT.sourceRetroAchievements,
};

export const SOURCE_NAME = NAME;

const FIELD: Record<string, string> = {
    steamgriddb_api: TEXT.keySteamGridDb,
    twitch_client_id: TEXT.keyIgdbId,
    twitch_client_secret: TEXT.keyIgdbSecret,
    thegamesdb_api: TEXT.keyTheGamesDb,
    ra_user: TEXT.keyRaUser,
    ra_api: TEXT.keyRaApi,
};

/** Fields that are no secret and show what is typed. */
const PLAIN = new Set(["ra_user"]);

const PART_NAME: Record<Part, string> = {
    info: TEXT.infoTitle,
    art: TEXT.artTitle,
    media: TEXT.communityContent,
    achievements: TEXT.achievements,
};

/** Shown in the fields of a saved sign-in; the page is never told the saved value or its length. */
const MASK = "•".repeat(10);

export function Sources({ host, state, onState, onClose }: { host: Host; state: State; onState: (next: State) => void; onClose: () => void }) {
    const [typed, setTyped] = useState<Record<string, string>>({});
    const [refused, setRefused] = useState<SourceId[]>([]);
    const [busy, setBusy] = useState(false);
    const [order, setOrder] = useState<SourceId[]>(state.sources.map((s) => s.id));
    const [held, setHeld] = useState<SourceId | undefined>();
    const holding = useRef<SourceId | undefined>(undefined);
    const letGo = useRef<(() => void) | undefined>(undefined);
    const blocks = useRef(new Map<SourceId, HTMLDivElement>());
    const latest = useRef(order);
    latest.current = order;
    useEffect(() => () => letGo.current?.(), []);

    const byId = new Map(state.sources.map((s) => [s.id, s] as const));

    const reread = async () => {
        const next = await host.state().catch(() => undefined);
        if (next) onState(next);
    };

    const toggle = async (id: SourceId, on: boolean) => {
        await host.setSource(id, on).catch(() => undefined);
        await reread();
    };

    const part = async (id: SourceId, name: Part, on: boolean) => {
        onState({ ...state, sources: state.sources.map((s) => (s.id === id ? { ...s, parts: { ...s.parts, [name]: on } } : s)) });
        await host.setPart(id, name, on).catch(() => undefined);
        await reread();
    };

    // A source is signed in to once every one of its fields is filled.
    const needs = (id: SourceId) => byId.get(id)?.needs ?? [];
    const filled = (id: SourceId) => needs(id).length > 0 && needs(id).every((key) => (typed[key] ?? "").trim() !== "");
    const ready = order.filter(filled);

    const save = async () => {
        setBusy(true);
        const bad: SourceId[] = [];
        const kept = { ...typed };
        for (const id of ready) {
            const values = Object.fromEntries(needs(id).map((key) => [key, (typed[key] ?? "").trim()]));
            if (await host.signIn(id, values).catch(() => false)) for (const key of needs(id)) delete kept[key];
            else bad.push(id);
        }
        setTyped(kept);
        setRefused(bad);
        await reread();
        setBusy(false);
    };

    // The held source takes a source's place once the pointer has passed that one's middle.
    const dragTo = (y: number) => {
        const id = holding.current;
        if (!id) return;
        const now = latest.current;
        const from = now.indexOf(id);
        let to = from;
        now.forEach((other, place) => {
            const box = blocks.current.get(other)?.getBoundingClientRect();
            if (!box || other === id) return;
            const middle = box.top + box.height / 2;
            if (place < from && y < middle) to = Math.min(to, place);
            if (place > from && y > middle) to = Math.max(to, place);
        });
        if (to !== from) {
            latest.current = moveSource(now, id, to);
            setOrder(latest.current);
        }
    };
    const drop = async () => {
        if (!holding.current) return;
        holding.current = undefined;
        setHeld(undefined);
        if (latest.current.join() === state.sources.map((s) => s.id).join()) return;
        await host.setSourceOrder(latest.current).catch(() => undefined);
        await reread();
    };
    // The pointer is followed on the popup's own page, so the drag goes on while the list reorders under it.
    const grab = (e: GripEvent<HTMLSpanElement>, id: SourceId) => {
        e.preventDefault();
        letGo.current?.();
        const page = e.currentTarget.ownerDocument;
        const move = (at: { clientY: number }) => dragTo(at.clientY);
        const up = () => {
            letGo.current?.();
            void drop();
        };
        letGo.current = () => {
            page.removeEventListener("pointermove", move);
            page.removeEventListener("pointerup", up);
            page.removeEventListener("pointercancel", up);
            letGo.current = undefined;
        };
        page.addEventListener("pointermove", move);
        page.addEventListener("pointerup", up);
        page.addEventListener("pointercancel", up);
        holding.current = id;
        setHeld(id);
    };

    return (
        <Overlay
            title={TEXT.sources}
            narrow
            onClose={onClose}
            foot={
                <>
                    <span className="jm-grow" />
                    <Button disabled={busy || ready.length === 0} onClick={() => void save()}>
                        {TEXT.save}
                    </Button>
                    <Button onClick={onClose}>{TEXT.close}</Button>
                </>
            }
        >
            {order.map((id) => {
                const source = byId.get(id);
                if (!source) return null;
                const saved = source.signed;
                const on = inUse(source);
                return (
                    <div
                        key={id}
                        className={`jm-source-block${held === id ? " jm-held" : ""}`}
                        ref={(el) => {
                            if (el) blocks.current.set(id, el);
                            else blocks.current.delete(id);
                        }}
                    >
                        <div className="jm-source">
                            <span className="jm-source-name">
                                <span className="jm-grip" onPointerDown={(e) => grab(e, id)} />
                                <Check on={on} disabled={!saved || busy} label={NAME[id]} onChange={(next) => void toggle(id, next)} />
                            </span>
                            <span className={on ? "jm-ok" : "jm-muted"}>{on ? TEXT.sourceOn : saved ? "" : TEXT.keyMissing}</span>
                        </div>
                        <div className="jm-parts">
                            {PARTS.filter((name) => source.parts[name] !== undefined).map((name) => (
                                <Check key={name} on={on && source.parts[name] === true} disabled={!on || busy} label={PART_NAME[name]} onChange={(next) => void part(id, name, next)} />
                            ))}
                        </div>
                        {source.needs.length > 0 && (
                            <div className="jm-form">
                                {source.needs.map((key, _n, all) => (
                                    <Field key={key} label={FIELD[key] ?? key} wide={all.length === 1}>
                                        <TextInput
                                            className={refused.includes(id) ? "jm-bad" : saved ? "jm-kept" : undefined}
                                            placeholder={saved ? MASK : undefined}
                                            value={typed[key] ?? ""}
                                            onChange={(value) => {
                                                setTyped((t) => ({ ...t, [key]: value }));
                                                setRefused((r) => r.filter((x) => x !== id));
                                            }}
                                            onEnter={() => ready.length > 0 && !busy && void save()}
                                            type={PLAIN.has(key) ? undefined : "password"}
                                        />
                                    </Field>
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}
        </Overlay>
    );
}
