// Unix sockets under the macOS temp dirs stay open so tsx can listen on its
// local pipe. /var/folders and /tmp resolve to /private/..., which is the
// path the kernel checks. mDNSResponder lives outside those dirs, so DNS
// stays denied. Anything else on the network stays denied except localhost.
export const NETWORK_DENY_PROFILE =
  '(version 1)(allow default)(deny network*)(allow network-outbound (remote ip "localhost:*"))(allow network-bind (local ip "localhost:*"))(allow network-inbound (local ip "localhost:*"))(allow network-bind (local unix-socket (subpath "/private/var/folders")))(allow network-inbound (local unix-socket (subpath "/private/var/folders")))(allow network-outbound (remote unix-socket (subpath "/private/var/folders")))(allow network-bind (local unix-socket (subpath "/private/tmp")))(allow network-inbound (local unix-socket (subpath "/private/tmp")))(allow network-outbound (remote unix-socket (subpath "/private/tmp")))';

export function wrapWithNetworkDeny(
  cmd: string[],
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string[] {
  if (env.CONTEXT_MODE_ALLOW_NETWORK === "1") return cmd;
  if (platform !== "darwin") {
    throw new Error(
      `[ERROR] context-mode: network isolation unsupported on ${platform}; set CONTEXT_MODE_ALLOW_NETWORK=1 to run without it`,
    );
  }
  return ["/usr/bin/sandbox-exec", "-p", NETWORK_DENY_PROFILE, ...cmd];
}
