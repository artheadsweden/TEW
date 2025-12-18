const API_BASE_RAW = (import.meta.env && import.meta.env.VITE_API_BASE_URL) || ''
const API_BASE = API_BASE_RAW.replace(/\/+$/, '')

function toUrl(path) {
  if (!API_BASE) return path
  // Only prefix relative API paths ("/api/...", "/downloads/...", etc).
  if (typeof path === 'string' && path.startsWith('/')) return `${API_BASE}${path}`
  return path
}

export async function apiFetch(path, options = {}) {
  const res = await fetch(toUrl(path), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    credentials: 'include',
  })

  const isJson = (res.headers.get('content-type') || '').includes('application/json')
  const body = isJson ? await res.json() : await res.text()

  if (!res.ok) {
    const msg = isJson && body && body.error ? body.error : `Request failed (${res.status})`
    throw new Error(msg)
  }

  return body
}
