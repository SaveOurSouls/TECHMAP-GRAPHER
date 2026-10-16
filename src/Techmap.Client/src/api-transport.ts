import { buildApiUrl, type RuntimeConfig } from "./runtime-config";

export type ApiFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface JsonRequestOptions {
  readonly fetcher: ApiFetcher;
  readonly responseError: (response: Response) => Promise<Error>;
  readonly networkError?: (error: unknown) => unknown;
  readonly invalidJsonError?: (error: unknown) => unknown;
}

/** Transport only: adapters retain validation, conflicts and cancellation policy. */
export function createJsonRequest(config: RuntimeConfig, options: JsonRequestOptions) {
  const { fetcher } = options;
  return async function request<T>(
    path: string,
    init: RequestInit,
    parse: (value: unknown) => T,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetcher(buildApiUrl(config, path), {
        credentials: "same-origin",
        cache: "no-store",
        ...init,
      });
    } catch (error) {
      throw options.networkError
        ? options.networkError(error)
        : new Error("Не удалось связаться с локальным сервером.");
    }

    if (!response.ok) throw await options.responseError(response);

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw options.invalidJsonError
        ? options.invalidJsonError(error)
        : new Error("Сервер вернул нечитаемый ответ.");
    }
    // Keep validation failures outside the transport error handlers.
    return parse(body);
  };
}
