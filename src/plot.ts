/* A point in HP-GL plotter units of 0.025 mm. HP-GL's origin is the lower-left
   corner of the sheet, not the upper-left. */
export type Point = { x: number, y: number };

export const DEFAULT_URL = "wss://plotpi.cymric-logarithm.ts.net:8443/";

export type Connection = ReturnType<typeof createConnection>;

export function createConnection(url: string | URL) {

    /* Receive Queue */

    let controller!: ReadableStreamDefaultController<string>;

    const incoming = new ReadableStream<string>({
        start(c) { controller = c }
    });

    const ws = new WebSocket(url);

    ws.addEventListener('message', ({ data }) => controller.enqueue(String(data)));
    ws.addEventListener('close', () => {
        try { controller.close() } catch { /* already closed */ }
    });

    const reader = incoming.getReader();

    /* Readiness */

    const { promise, resolve, reject } = Promise.withResolvers<true>();

    /* A failed handshake surfaces as `error` with no detail, so the close code
       is the only diagnostic we can hand the user. */
    ws.addEventListener('close', ({ code, reason }) => {
        reject(new Error(`closed (${code})${reason ? `: ${reason}` : ''}`));
    });
    ws.addEventListener('open', () => resolve(true));
    promise.catch(() => { /* reported by whoever awaits ready() */ });

    return {
        ready() {
            return promise;
        },
        read() {
            return reader.read();
        },
        write(data: string) {
            ws.send(data);
        },
        close() {
            ws.close();
        },
        get state() {
            return ws.readyState;
        }
    }
}
