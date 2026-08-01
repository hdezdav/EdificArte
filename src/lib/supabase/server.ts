export function astroCookieAdapter(
  cookies: any,
  requestHeaders: Headers,
  responseHeaders = new Headers(),
  secure = import.meta.env.PROD
) {
  return {
    getAll: () => [],
    setAll: () => {},
  };
}

export function createServerSupabase(
  _env: any,
  _cookies: any,
  _requestHeaders: Headers,
  _responseHeaders?: Headers,
  _secure?: boolean
) {
  return null;
}
