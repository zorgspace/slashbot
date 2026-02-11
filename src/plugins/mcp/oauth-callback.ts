/**
 * OAuth Callback Server
 * Bun.serve() on port 19877 to handle OAuth redirect callbacks
 */

const CALLBACK_PORT = 19877;
const CALLBACK_TIMEOUT = 5 * 60 * 1000; // 5 minutes

interface PendingAuth {
  state: string;
  resolve: (code: string) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let server: ReturnType<typeof Bun.serve> | null = null;
let pendingAuth: PendingAuth | null = null;

const HTML_SUCCESS = `<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:60px">
<h1>Authorization Successful</h1><p>You can close this window and return to slashbot.</p></body></html>`;

const HTML_ERROR = (
  msg: string,
) => `<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:60px">
<h1>Authorization Failed</h1><p>${msg}</p></body></html>`;

function handleCallback(req: Request): Response {
  const url = new URL(req.url);
  if (url.pathname !== '/mcp/oauth/callback') {
    return new Response('Not Found', { status: 404 });
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    const desc = url.searchParams.get('error_description') || error;
    if (pendingAuth) {
      pendingAuth.reject(new Error(desc));
      clearTimeout(pendingAuth.timer);
      pendingAuth = null;
    }
    return new Response(HTML_ERROR(desc), {
      headers: { 'Content-Type': 'text/html' },
    });
  }

  if (!code) {
    return new Response(HTML_ERROR('No authorization code received'), {
      headers: { 'Content-Type': 'text/html' },
    });
  }

  if (!pendingAuth) {
    return new Response(HTML_ERROR('No pending authorization'), {
      headers: { 'Content-Type': 'text/html' },
    });
  }

  // CSRF check
  if (state && pendingAuth.state && state !== pendingAuth.state) {
    pendingAuth.reject(new Error('State mismatch - possible CSRF attack'));
    clearTimeout(pendingAuth.timer);
    pendingAuth = null;
    return new Response(HTML_ERROR('State mismatch'), {
      headers: { 'Content-Type': 'text/html' },
    });
  }

  clearTimeout(pendingAuth.timer);
  pendingAuth.resolve(code);
  pendingAuth = null;

  return new Response(HTML_SUCCESS, {
    headers: { 'Content-Type': 'text/html' },
  });
}

export function ensureRunning(): void {
  if (server) return;
  try {
    server = Bun.serve({
      port: CALLBACK_PORT,
      fetch: handleCallback,
    });
  } catch {
    // Port may already be in use
  }
}

export function waitForCallback(state: string): Promise<string> {
  cancelPending();
  ensureRunning();

  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pendingAuth) {
        pendingAuth.reject(new Error('OAuth callback timed out after 5 minutes'));
        pendingAuth = null;
      }
    }, CALLBACK_TIMEOUT);

    pendingAuth = { state, resolve, reject, timer };
  });
}

export function cancelPending(): void {
  if (pendingAuth) {
    clearTimeout(pendingAuth.timer);
    pendingAuth.reject(new Error('Cancelled'));
    pendingAuth = null;
  }
}

export function stop(): void {
  cancelPending();
  if (server) {
    server.stop();
    server = null;
  }
}
