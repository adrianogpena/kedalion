import { request } from '@kedalion/ui';
import type { HttpRequestDraft, HttpRequestSpec, HttpResponseInfo, RestEnvironment } from '@kedalion/server-core/protocol';

/** The server calls the REST/curl views make; the app builds it from its api and passes it to them. */
export interface HttpClient {
  /** Sends `request` after substituting `{{name}}` from `environment` (id; omitted = built-ins only); `draft` is the unresolved editor draft for the history. */
  send: (request: HttpRequestSpec, secretRef: string | undefined, signal: AbortSignal, env?: { environment?: string; draft?: HttpRequestDraft; vars?: Record<string, string> }) => Promise<HttpResponseInfo>;
  /** REST environments; secret variables come back with `value: ''` and `set`. */
  environments: () => Promise<RestEnvironment[]>;
}

/** The default `HttpClient`: the server's `/api/http/send` and `/api/rest/environments` over fetch. */
export const httpClient: HttpClient = {
  send: (httpRequest, secretRef, signal, env = {}) =>
    request<HttpResponseInfo>('POST', '/api/http/send', {}, { request: httpRequest, secretRef, ...env }, { signal }),
  environments: () => request<RestEnvironment[]>('GET', '/api/rest/environments'),
};
