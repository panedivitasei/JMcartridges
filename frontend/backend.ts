// Calls to the Lua backend, one at a time: its host runs a single call and loses one that waits too long.

/** The plugin's name in plugin.json. */
export const PLUGIN = "jmcartridges";

const TIMEOUT_MS = 60_000;

let last: Promise<unknown> = Promise.resolve();

async function send<R>(name: string, payload: object): Promise<R> {
    const millennium = (window as unknown as { Millennium?: { callServerMethod?(plugin: string, method: string, args: object): Promise<unknown> } }).Millennium;
    if (typeof millennium?.callServerMethod !== "function") throw new Error("Millennium is not available");
    const raw = await Promise.race([
        millennium.callServerMethod(PLUGIN, name, { payload: JSON.stringify(payload) }),
        new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error(`${name} timed out`)), TIMEOUT_MS)),
    ]);
    return (typeof raw === "string" ? JSON.parse(raw) : raw) as R;
}

export function call<R>(name: string, payload: object = {}): Promise<R> {
    const next = last.then(
        () => send<R>(name, payload),
        () => send<R>(name, payload),
    );
    last = next.catch(() => undefined);
    return next;
}
