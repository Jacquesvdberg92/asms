/**
 * One way out of the process, shared.
 *
 * Ctrl-C, a service stopping ASMS and the Restart button on the Settings page
 * all want the same thing: stop the scheduler, let go of the game servers
 * without killing them, flush the database, close the port, exit. index.ts owns
 * that sequence because it holds the http server; this is how anything else
 * asks for it without importing index.ts back into itself.
 */

type Shutdown = (reason: string) => Promise<void> | void;

let handler: Shutdown | null = null;

export function onShutdown(fn: Shutdown): void {
  handler = fn;
}

/** Runs the registered shutdown. Resolves immediately when nothing registered it. */
export async function shutdownApp(reason: string): Promise<void> {
  await handler?.(reason);
}
