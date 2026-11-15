export const AUTH_TOKEN_KEY = 'radiarr_auth_token';

/**
 * Returns the currently stored authentication token from localStorage, if available.
 */
export function getStoredAuthToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * Persists an authentication token in localStorage.
 */
export function setStoredAuthToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(AUTH_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(AUTH_TOKEN_KEY);
    }
  } catch {
    // LocalStorage quota or access denied in strict sandboxes
  }
}

/**
 * Authenticated fetch helper for Radiarr API requests.
 * Automatically injects the Authorization: Bearer <token> header and credentials: 'include'.
 * Works reliably across all browser contexts without monkey-patching window.fetch.
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const token = getStoredAuthToken();

  const headers = new Headers(
    init?.headers || (input instanceof Request ? input.headers : undefined)
  );

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const modifiedInit: RequestInit = {
    ...init,
    headers,
    credentials: init?.credentials || 'include',
  };

  return fetch(input, modifiedInit);
}

/**
 * Legacy no-op stub for backwards compatibility.
 */
export function installApiInterceptor(): void {
  // No-op: We use explicit apiFetch rather than monkey-patching getter-only window.fetch
}
