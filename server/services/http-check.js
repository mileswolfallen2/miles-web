export function classifyHttpStatus(code) {
  if (code >= 200 && code < 400) return 'operational';
  if (code >= 400 && code < 500) return 'degraded';
  if (code >= 500) return 'offline';
  return 'unknown';
}

export async function checkHttp(
  url,
  { timeoutMs = 5000, fetchFn = globalThis.fetch, now = () => Date.now() } = {}
) {
  const started = now();
  try {
    const response = await fetchFn(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'User-Agent': 'milesallen-status/1.0 (+https://milesallen.site)',
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br'
      }
    });
    const responseMs = Math.max(0, now() - started);
    try {
      await response.body?.cancel();
    } catch {
      // ignore body cancellation errors
    }
    return {
      status: classifyHttpStatus(response.status),
      responseMs,
      httpStatus: response.status,
      error: null
    };
  } catch (err) {
    const responseMs = Math.max(0, now() - started);
    const name = err?.name || '';
    let message = 'request failed';
    if (name === 'TimeoutError' || name === 'AbortError') message = 'timeout';
    else if (err?.cause?.code) message = String(err.cause.code);
    else if (err?.message) message = String(err.message);
    return {
      status: 'offline',
      responseMs,
      httpStatus: null,
      error: message.slice(0, 200)
    };
  }
}
