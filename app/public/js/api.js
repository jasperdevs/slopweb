export async function checkAuthStatus() {
  const res = await fetch('/api/auth/status');
  if (!res.ok) throw new Error(`Auth check failed: ${res.status}`);
  return res.json();
}

export async function readNdjsonStream(response, onEvent) {
  if (!response.body) throw new Error('Streaming is not supported in this client.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line && line !== '\r') onEvent(JSON.parse(line));
      }
    }
    buffer += decoder.decode();
    if (buffer && buffer !== '\r') onEvent(JSON.parse(buffer));
  } finally {
    reader.releaseLock();
  }
}

export async function listSavedPages() {
  const res = await fetch('/api/pages');
  if (!res.ok) throw new Error(`Saved pages failed: ${res.status}`);
  const data = await res.json();
  return { pages: Array.isArray(data?.pages) ? data.pages : [] };
}

export async function deleteSavedPage(fileName) {
  const res = await fetch(`/api/pages/${encodeURIComponent(fileName)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
  return res.json();
}
