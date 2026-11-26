// The Options card: the window's theme, and the settings few people change.
import type { Host } from "./host.ts";
import type { Source, State } from "./model.ts";
import { SOURCE_NAME } from "./sources.tsx";
import { TEXT } from "./text.ts";
import { Button, Check, Overlay, Section, Segments, TextInput } from "./widgets.tsx";

export function Options({ host, state, onState, onClose }: { host: Host; state: State; onState: (next: State) => void; onClose: () => void }) {
    const change = async (theme: "light" | "dark") => {
        onState({ ...state, prefs: { ...state.prefs, theme } });
        await host.setTheme(theme).catch(() => undefined);
    };
    const showInfo = async (on: boolean) => {
        onState({ ...state, prefs: { ...state.prefs, showInfo: on } });
        await host.setShowInfo(on).catch(() => undefined);
    };

    const achievements = async (on: boolean) => {
        onState({ ...state, prefs: { ...state.prefs, achievements: on } });
        await host.setAchievements(on).catch(() => undefined);
    };

    // Digits only; an empty field is no limit.
    const limit = async (typed: string) => {
        const digits = typed.replace(/\D/g, "").slice(0, 5);
        const descLimit = digits === "" ? 0 : Number(digits);
        if (descLimit === state.prefs.descLimit) return;
        onState({ ...state, prefs: { ...state.prefs, descLimit } });
        await host.setDescLimit(descLimit).catch(() => undefined);
    };
    const media = async (source: Source, on: boolean) => {
        onState({ ...state, sources: state.sources.map((s) => (s.id === source.id ? { ...s, media: on } : s)) });
        await host.setMediaSource(source.id, on).catch(() => undefined);
    };

    return (
        <Overlay
            title={TEXT.optionsTitle}
            narrow
            onClose={onClose}
            foot={
                <>
                    <span className="jm-grow" />
                    <Button onClick={onClose}>{TEXT.close}</Button>
                </>
            }
        >
            <div className="jm-opt-row">
                <span className="jm-opt-name">{TEXT.theme}</span>
                <Segments<"light" | "dark">
                    plain
                    value={state.prefs.theme}
                    options={[
                        { id: "light", label: TEXT.themeLight },
                        { id: "dark", label: TEXT.themeDark },
                    ]}
                    onChange={(theme) => void change(theme)}
                />
            </div>
            <Section title={TEXT.advanced}>
                <div className="jm-opt-row">
                    <Check on={state.prefs.showInfo} label={TEXT.showInfo} onChange={(on) => void showInfo(on)} />
                </div>
                <div className="jm-opt-row">
                    <Check on={state.prefs.achievements} label={TEXT.showAchievements} onChange={(on) => void achievements(on)} />
                </div>
                <div className="jm-opt-row">
                    <span className="jm-opt-name">{TEXT.descLimit}</span>
                    <TextInput className="jm-short" value={state.prefs.descLimit > 0 ? String(state.prefs.descLimit) : ""} onChange={(typed) => void limit(typed)} />
                </div>
                <div className="jm-opt-row">
                    <span className="jm-opt-name">{TEXT.communityContent}</span>
                    {state.sources
                        .filter((s) => s.matchable)
                        .map((s) => (
                            <Check key={s.id} on={s.media} label={SOURCE_NAME[s.id]} onChange={(on) => void media(s, on)} />
                        ))}
                </div>
            </Section>
        </Overlay>
    );
}
