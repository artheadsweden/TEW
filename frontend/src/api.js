export async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
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
