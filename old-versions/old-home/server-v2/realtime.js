// Live updates with Server-Sent Events: follower counts, reactions, views, comments, new posts.

const clients = new Set();

function handleEvents(req, res, me) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 3000\n\n");
  const client = { res, userId: me.id };
  clients.add(client);
  req.on("close", () => clients.delete(client));
}

function broadcast(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const c of clients) c.res.write(data);
}

// Keep connections open through proxies
setInterval(() => {
  for (const c of clients) c.res.write(": ping\n\n");
}, 25000).unref();

module.exports = { handleEvents, broadcast };
