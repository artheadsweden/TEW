function normalizeBaseUrl(base) {
  const s = String(base || '').trim()
  return s.replace(/\/+$/, '')
}

export function getApiBaseUrl() {
  return normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL)
}

export function apiUrl(path) {
  const p = String(path || '')
  if (!p) return p
  if (/^https?:\/\//i.test(p)) return p

  const base = getApiBaseUrl()
  if (!base) return p
  if (p.startsWith('/')) return `${base}${p}`
  return `${base}/${p}`
}

export async function apiFetch(path, options = {}) {
  const res = await fetch(apiUrl(path), {
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
