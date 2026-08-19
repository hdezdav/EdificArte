export function astroCookieAdapter(
  _cookies: unknown,
  _requestHeaders: Headers,
  _responseHeaders = new Headers(),
  _secure = import.meta.env.PROD
) {
  return {
    getAll: () => [],
    setAll: () => {},
  };
}

export function createServerSupabase(
  _env: unknown,
  _cookies: unknown,
  _requestHeaders: Headers,
  _responseHeaders?: Headers,
  _secure?: boolean
) {
  return null;
}
