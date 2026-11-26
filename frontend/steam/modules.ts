// Access to Steam's own modules, found by what they contain, never by a module number.

interface WebpackRequire {
    (id: string): unknown;
    m: Record<string, unknown>;
}

type Chunks = Array<[string[], Record<string, unknown>, ((r: WebpackRequire) => void)?]>;

let cached: WebpackRequire | undefined;

/** Steam's module loader, taken by pushing a chunk that asks for it; asked again until Steam has it. */
export function steamRequire(): WebpackRequire | undefined {
    if (cached) return cached;
    try {
        const chunks = Reflect.get(globalThis, "webpackChunksteamui") as Chunks | undefined;
        if (!Array.isArray(chunks)) return undefined;
        const key = `__jm_probe_${Date.now()}`;
        let captured: WebpackRequire | undefined;
        chunks.push([[key], { [key]: (_m: unknown, _e: unknown, r: WebpackRequire) => (captured = r) }, (r) => void r(((r as unknown as { s: string }).s = key))]);
        cached = captured;
    } catch {
        cached = undefined;
    }
    return cached;
}

/** Every export of every module; a module that throws while loading is skipped. */
export function* allExports(filter?: (source: string) => boolean): Generator<unknown> {
    const req = steamRequire();
    if (!req) return;
    for (const id of Object.keys(req.m)) {
        let mod: unknown;
        try {
            if (filter && !filter(String(req.m[id]))) continue;
            mod = req(id);
        } catch {
            continue;
        }
        if (!mod || (typeof mod !== "object" && typeof mod !== "function")) continue;
        let keys: string[];
        try {
            keys = Object.keys(mod as object);
        } catch {
            continue;
        }
        for (const key of keys) {
            try {
                yield (mod as Record<string, unknown>)[key];
            } catch {
                /* a getter that throws is not a match */
            }
        }
    }
}

const found = new Map<string, unknown>();

/** Every export that passes `test`. */
export function resolveAll<T>(test: (value: unknown) => boolean, filter?: (source: string) => boolean): T[] {
    const hits: T[] = [];
    for (const value of allExports(filter)) {
        try {
            if (test(value) && !hits.includes(value as T)) hits.push(value as T);
        } catch {
            /* a test that throws is not a match */
        }
    }
    return hits;
}

/** The first export that passes `test`; a find is remembered, a miss is looked for again next time. */
export function resolveOnce<T>(label: string, test: (value: unknown) => boolean, filter?: (source: string) => boolean): T | undefined {
    if (found.has(label)) return found.get(label) as T;
    for (const value of allExports(filter)) {
        try {
            if (!test(value)) continue;
        } catch {
            continue;
        }
        found.set(label, value);
        return value as T;
    }
    return undefined;
}
