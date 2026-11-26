// Building blocks of the window: plain React with theme.ts classes and no Steam component, so they also run in the
// dev harness (dev/harness).
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function Button({
    children,
    onClick,
    primary,
    small,
    disabled,
    title,
}: {
    children: ReactNode;
    onClick?: () => void;
    primary?: boolean;
    small?: boolean;
    disabled?: boolean;
    title?: string;
}) {
    return (
        <button type="button" className={`jm-btn${primary ? " jm-primary" : ""}${small ? " jm-small" : ""}`} disabled={disabled} onClick={onClick} title={title}>
            {children}
        </button>
    );
}

export function LinkButton({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) {
    return (
        <button type="button" className="jm-link" disabled={disabled} onClick={onClick}>
            {children}
        </button>
    );
}

/** A row of joined buttons with one on; `plain` styles it for a card body instead of a title bar. */
export function Segments<T extends string>({
    value,
    options,
    onChange,
    plain,
}: {
    value: T;
    options: readonly { id: T; label: string }[];
    onChange: (id: T) => void;
    plain?: boolean;
}) {
    return (
        <span className={`jm-seg${plain ? " jm-plain" : ""}`}>
            {options.map((o) => (
                <button key={o.id} type="button" className={o.id === value ? "jm-on" : ""} onClick={() => onChange(o.id)}>
                    {o.label}
                </button>
            ))}
        </span>
    );
}

/** A dropdown opened from a chip, drawn in the page so it behaves the same in Steam's popup and in a browser. */
export function Select<T extends string>({
    label,
    value,
    options,
    onChange,
    disabled,
}: {
    label: string;
    value?: T;
    options: readonly { id: T; label: string }[];
    onChange: (id: T) => void;
    disabled?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const list = useRef<HTMLSpanElement>(null);
    useEffect(() => {
        if (open) list.current?.scrollIntoView({ block: "nearest" });
    }, [open]);
    return (
        <span className="jm-select" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOpen(false)}>
            <button type="button" className="jm-chip jm-select-button" disabled={disabled} onClick={() => setOpen((o) => !o)}>
                {label}
                <span className="jm-select-mark" />
            </button>
            {open && !disabled && (
                <span className="jm-select-list" ref={list}>
                    {options.map((o) => (
                        <button
                            key={o.id}
                            type="button"
                            className={o.id === value ? "jm-on" : ""}
                            onClick={() => {
                                setOpen(false);
                                onChange(o.id);
                            }}
                        >
                            {o.label}
                        </button>
                    ))}
                </span>
            )}
        </span>
    );
}

/** A round check that shows a green dot when on. */
export function Check({ on, label, onChange, disabled }: { on: boolean; label: string; onChange: (on: boolean) => void; disabled?: boolean }) {
    return (
        <label className={`jm-check${disabled ? " jm-off" : ""}`} onClick={() => !disabled && onChange(!on)}>
            <span className={`jm-dot${on ? " jm-on" : ""}`} />
            <span>{label}</span>
        </label>
    );
}

export function Chip({ kind, children }: { kind?: "ready" | "ask"; children: ReactNode }) {
    return <span className={`jm-chip${kind ? ` jm-${kind}` : ""}`}>{children}</span>;
}

export function Section({ title, side, children }: { title: string; side?: ReactNode; children: ReactNode }) {
    return (
        <div className="jm-section">
            <div className="jm-section-head">
                <h3>{title}</h3>
                <span className="jm-grow" />
                {side}
            </div>
            {children}
        </div>
    );
}

export function Card({ title, side, className, children }: { title: ReactNode; side?: ReactNode; className?: string; children: ReactNode }) {
    return (
        <section className={`jm-card${className ? ` ${className}` : ""}`}>
            <div className="jm-card-title">
                <span>{title}</span>
                {side !== undefined && <span className="jm-side">{side}</span>}
            </div>
            {children}
        </section>
    );
}

/** A card over the dimmed window; a click on the dimmed part closes it. */
export function Overlay({
    title,
    side,
    narrow,
    onClose,
    children,
    foot,
}: {
    title: string;
    side?: ReactNode;
    narrow?: boolean;
    onClose: () => void;
    children: ReactNode;
    foot?: ReactNode;
}) {
    const home = useContext(FloatHome);
    const overlay = (
        <div className="jm-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
            <Card title={title} side={side} className={narrow ? "jm-narrow" : undefined}>
                <div className="jm-card-body">{children}</div>
                {foot && <div className="jm-foot">{foot}</div>}
            </Card>
        </div>
    );
    return home ? createPortal(<div className="jm jm-dark jm-inline jm-float">{overlay}</div>, home) : overlay;
}

/** Where an overlay goes when its page scrolls inside someone else's window: that window's body. */
export const FloatHome = createContext<HTMLElement | undefined>(undefined);

export function Field({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
    return (
        <div className={`jm-field${wide ? " jm-wide" : ""}`}>
            <div className="jm-label">{label}</div>
            {children}
        </div>
    );
}

export function TextInput({
    value,
    onChange,
    placeholder,
    onEnter,
    className,
    type,
}: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    onEnter?: () => void;
    className?: string;
    type?: "text" | "password";
}) {
    return (
        <input
            className={`jm-input${className ? ` ${className}` : ""}`}
            type={type ?? "text"}
            value={value}
            placeholder={placeholder}
            spellCheck={false}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
        />
    );
}
