// Minimal stand-in for Express, so Radiarr's real route files can run inside the demo service worker.
// Routers record their handlers; the service worker dispatches fetch events through them.
export type Handler = (req: DemoRequest, res: DemoResponse, next: (err?: unknown) => void) => unknown;

interface Route {
  method: string; // 'ALL' for router.use
  pattern: RegExp | null; // null = matches everything (middleware)
  keys: string[];
  handlers: Handler[];
}

function compile(path: string, prefixOnly: boolean): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const src = path
    .replace(/\/$/, '')
    .replace(/[.+*?^${}()|[\]\\]/g, '\\$&')
    .replace(/:(\w+)/g, (_m, k) => {
      keys.push(k);
      return '([^/]+)';
    });
  return { pattern: new RegExp(`^${src}${prefixOnly ? '(?:/.*)?' : '/?'}$`), keys };
}

export class ExpressRouter {
  readonly routes: Route[] = [];

  private add(method: string, args: unknown[]): this {
    let paths: string[] | null = null;
    let handlers = args as Handler[];
    if (typeof args[0] === 'string' || Array.isArray(args[0])) {
      paths = ([] as string[]).concat(args[0] as string | string[]);
      handlers = args.slice(1) as Handler[];
    }
    if (!paths) {
      this.routes.push({ method, pattern: null, keys: [], handlers });
      return this;
    }
    for (const p of paths) {
      const { pattern, keys } = compile(p, method === 'ALL');
      this.routes.push({ method, pattern, keys, handlers });
    }
    return this;
  }

  get(...a: (string | string[] | Handler)[]) { return this.add('GET', a); }
  post(...a: (string | string[] | Handler)[]) { return this.add('POST', a); }
  put(...a: (string | string[] | Handler)[]) { return this.add('PUT', a); }
  patch(...a: (string | string[] | Handler)[]) { return this.add('PATCH', a); }
  delete(...a: (string | string[] | Handler)[]) { return this.add('DELETE', a); }
  use(...a: (string | string[] | Handler)[]) { return this.add('ALL', a); }
  all(...a: (string | string[] | Handler)[]) { return this.add('ANY', a); }

  /** Collect handlers matching this request, filling req.params. */
  match(method: string, path: string): { handlers: Handler[]; params: Record<string, string> }[] {
    const out: { handlers: Handler[]; params: Record<string, string> }[] = [];
    for (const r of this.routes) {
      if (r.method !== 'ALL' && r.method !== 'ANY' && r.method !== method) continue;
      if (!r.pattern) {
        out.push({ handlers: r.handlers, params: {} });
        continue;
      }
      const m = path.match(r.pattern);
      if (!m) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      out.push({ handlers: r.handlers, params });
    }
    return out;
  }
}

export interface DemoRequest {
  method: string;
  path: string;
  url: string;
  originalUrl: string;
  query: Record<string, string>;
  params: Record<string, string>;
  body: any;
  headers: Record<string, string>;
  protocol: string;
  secure: boolean;
  user?: unknown;
  [key: string]: unknown;
  get(name: string): string | undefined;
  header(name: string): string | undefined;
}

export class DemoResponse {
  statusCode = 200;
  readonly headers = new Headers();
  private chunks: (string | Uint8Array)[] = [];
  writableEnded = false;
  headersSent = false;
  private resolveDone!: () => void;
  readonly done = new Promise<void>((r) => (this.resolveDone = r));

  status(code: number) { this.statusCode = code; return this; }
  sendStatus(code: number) { this.statusCode = code; return this.end(); }
  setHeader(name: string, value: string | number | string[]) {
    this.headers.set(name, Array.isArray(value) ? value.join(', ') : String(value));
    return this;
  }
  set(name: string | Record<string, string>, value?: string) {
    if (typeof name === 'object') for (const [k, v] of Object.entries(name)) this.setHeader(k, v);
    else this.setHeader(name, value ?? '');
    return this;
  }
  header(name: string, value: string) { return this.setHeader(name, value); }
  getHeader(name: string) { return this.headers.get(name) ?? undefined; }
  type(t: string) { return this.setHeader('Content-Type', t.includes('/') ? t : `text/${t}`); }
  cookie() { return this; }
  clearCookie() { return this; }
  on() { return this; }
  once() { return this; }
  flushHeaders() {}
  write(chunk: string | Uint8Array) { this.chunks.push(chunk); return true; }
  json(obj: unknown) {
    if (!this.headers.has('Content-Type')) this.setHeader('Content-Type', 'application/json; charset=utf-8');
    return this.end(JSON.stringify(obj));
  }
  send(body?: unknown) {
    if (body === undefined || body === null) return this.end();
    if (typeof body === 'string') {
      if (!this.headers.has('Content-Type')) this.setHeader('Content-Type', 'text/html; charset=utf-8');
      return this.end(body);
    }
    if (body instanceof Uint8Array) return this.end(body);
    return this.json(body);
  }
  redirect(a: number | string, b?: string) {
    const url = typeof a === 'string' ? a : b!;
    this.statusCode = typeof a === 'number' ? a : 302;
    this.setHeader('Location', url);
    return this.end();
  }
  download() { return this.status(404).json({ error: 'Downloads are not available in the demo.' }); }
  sendFile() { return this.status(404).end(); }
  end(chunk?: string | Uint8Array) {
    if (this.writableEnded) return this;
    if (chunk !== undefined) this.chunks.push(chunk);
    this.writableEnded = true;
    this.headersSent = true;
    this.resolveDone();
    return this;
  }
  toResponse(): Response {
    const parts = this.chunks.map((c) => (typeof c === 'string' ? new TextEncoder().encode(c) : c));
    const total = parts.reduce((n, p) => n + p.length, 0);
    const body = new Uint8Array(total);
    let o = 0;
    for (const p of parts) { body.set(p, o); o += p.length; }
    const status = this.statusCode;
    const nullBody = status === 204 || status === 304;
    if (status >= 300 && status < 400 && this.headers.get('Location')) {
      return Response.redirect(new URL(this.headers.get('Location')!, self.location.origin).href, status);
    }
    return new Response(nullBody ? null : body, { status, headers: this.headers });
  }
}

export function Router(): ExpressRouter { return new ExpressRouter(); }
const json = () => (_req: unknown, _res: unknown, next: () => void) => next();
const raw = json;
const express = Object.assign(() => { throw new Error('Not available in the demo'); }, { Router, json, raw, static: json });
export default express;
export type Request = DemoRequest;
export type Response_ = DemoResponse;
export type NextFunction = (err?: unknown) => void;
