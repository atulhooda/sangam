/*
 * Stdio carries the JSON-RPC stream, so only the MCP SDK may write to stdout.
 * Library code imported by the server (@sangam/*, the Hedera SDK) can
 * console.log, so silence it before anything is imported. Dynamic import
 * keeps this shim ahead of every other module's evaluation.
 */
const log = console.error.bind(console);
console.log = log;
console.info = log;
console.debug = log;

export {};

await import("./server.ts");
