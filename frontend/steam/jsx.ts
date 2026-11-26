// A patch on Steam's shared element factory (`jsx` / `jsxs`) that stays in place and gets along with other plugins' patches.
import { callOriginal, findModuleByExport, replacePatch } from "@steambrew/client";

type JsxFn = (type: unknown, props: unknown, key?: unknown) => unknown;
type Runtime = Record<"jsx" | "jsxs", JsxFn>;
type Patched = JsxFn & { __millenniumPatch?: { original?: JsxFn } };

let runtime: Runtime | undefined;

/** Steam's react/jsx-runtime module, found by its export names. */
export function jsxRuntime(): Runtime | undefined {
    if (runtime) return runtime;
    const found = findModuleByExport((value: unknown, name?: unknown) => (name === "jsx" || name === "jsxs") && typeof value === "function") as Runtime | undefined;
    if (found && typeof found.jsx === "function" && typeof found.jsxs === "function") runtime = found;
    return runtime;
}

/** An element type no real element has: a call with it shows whether calls still reach this plugin's patch. */
const SENTINEL = function JmJsxSentinel() {
    return null;
};

/** Shared by every plugin that guards the factory this way, so there is one guard however many plugins. */
const GUARD_KEY = "__enhancedPluginsJsxGuard";

interface WriteGuard {
    onWrite: Set<() => void>;
}

/** Makes `jsx` and `jsxs` tell the plugins when something writes them, since Millennium itself puts back an older copy at times. */
function writeGuard(target: Runtime): WriteGuard | null {
    const holder = target as unknown as Record<string, WriteGuard | undefined>;
    if (holder[GUARD_KEY]) return holder[GUARD_KEY]!;
    const names = ["jsx", "jsxs"] as const;
    const descriptors = names.map((name) => Object.getOwnPropertyDescriptor(target, name));
    if (descriptors.some((d) => !d || !d.configurable || d.get || d.set || typeof d.value !== "function")) return null;
    const guard: WriteGuard = { onWrite: new Set() };
    let pending = false;
    const notify = () => {
        pending = false;
        for (const fn of guard.onWrite) {
            try {
                fn();
            } catch {
                /* one plugin's repair must not stop another's */
            }
        }
    };
    names.forEach((name, i) => {
        let value = descriptors[i]!.value as JsxFn;
        Object.defineProperty(target, name, {
            configurable: true,
            enumerable: descriptors[i]!.enumerable,
            get: () => value,
            set: (next: JsxFn) => {
                value = next;
                // The patcher links a new function to the one under it only after assigning it, so the check waits a tick.
                if (!pending) {
                    pending = true;
                    queueMicrotask(notify);
                }
            },
        });
    });
    Object.defineProperty(target, GUARD_KEY, { value: guard });
    return guard;
}

/**
 * Lets `replaceType` swap the type of any element Steam creates; it runs for every element, so it must cost a few property reads at most.
 * The patch is put back whenever it is no longer in the chain of patches. Returns false when Steam's factory was not found.
 */
export function watchElements(replaceType: (type: unknown, props: unknown) => unknown): boolean {
    const target = jsxRuntime();
    if (!target) return false;
    const mine: Record<"jsx" | "jsxs", { patched?: Patched; probed: boolean }> = { jsx: { probed: false }, jsxs: { probed: false } };

    const install = (name: "jsx" | "jsxs") => {
        const state = mine[name];
        const patch = replacePatch(target, name, function (this: unknown, args: unknown[]): unknown {
            if (args[0] === SENTINEL) {
                state.probed = true;
                return callOriginal;
            }
            const replacement = replaceType(args[0], args[1]);
            if (replacement === undefined) return callOriginal;
            return (patch as unknown as { original: JsxFn }).original.call(this, replacement, args[1], args[2]);
        } as never);
        state.patched = target[name] as Patched;
    };

    /** Is this plugin's patch still reached: found in the chain, or answering the sentinel through a foreign wrapper. */
    const live = (name: "jsx" | "jsxs"): boolean => {
        const state = mine[name];
        let depth = 0;
        for (let fn = target[name] as Patched | undefined; fn && depth < 64; depth++) {
            if (fn === state.patched) return true;
            fn = fn.__millenniumPatch?.original as Patched | undefined;
        }
        state.probed = false;
        try {
            target[name](SENTINEL, {});
        } catch {
            /* a broken wrapper above: counted as not reaching this one */
        }
        return state.probed;
    };

    const ensure = () => {
        for (const name of ["jsx", "jsxs"] as const) {
            try {
                if (!mine[name].patched || !live(name)) install(name);
            } catch {
                /* tried again on the next pass */
            }
        }
    };
    ensure();
    setInterval(ensure, 5000);
    writeGuard(target)?.onWrite.add(ensure);
    return true;
}
