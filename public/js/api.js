// Talking to the LookBlog server.

export async function api(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json", "X-LookBlog": "1" },
      credentials: "same-origin",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw { error: "Can’t reach the server. Check your connection." };
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !window.__lbPanel) {
    location.assign("/"); // the session ended: back to the log in page
    throw data;
  }
  if (!res.ok) throw data;
  return data;
}

// Upload one file with progress (0..1). Resolves to { url, kind }.
// Online the file goes straight to storage (start -> send -> finish). Locally it goes to the server.
let direct = null; // null = don't know yet
export async function upload(file, onProgress = () => {}) {
  if (direct !== false) {
    let start;
    try { start = await api("/api/upload/start", { method: "POST", body: { type: file.type, size: file.size } }); direct = true; }
    catch (err) { if (direct === true || err.error !== "Not found.") throw err; direct = false; }
    if (start) {
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", start.uploadUrl);
        xhr.setRequestHeader("Content-Type", start.type);
        xhr.setRequestHeader("x-upsert", "false");
        xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject({ error: "Upload failed. Try again." }));
        xhr.onerror = () => reject({ error: "Upload failed. Check your connection." });
        xhr.send(file);
      });
      return api("/api/upload/finish", { method: "POST", body: { name: start.name, type: start.type, ticket: start.ticket } });
    }
  }
  return uploadToServer(file, onProgress);
}
function uploadToServer(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.setRequestHeader("X-LookBlog", "1");
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(data.error ? data : { error: "Upload failed. Try again." });
    };
    xhr.onerror = () => reject({ error: "Upload failed. Check your connection." });
    xhr.send(file);
  });
}
