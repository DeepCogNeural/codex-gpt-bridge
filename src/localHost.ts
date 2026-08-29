export const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export function isLocalHost(host: string): boolean {
  return LOCAL_HOSTS.has(host);
}
