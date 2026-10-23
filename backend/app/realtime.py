"""In-process pub/sub for Server-Sent Events. Safe to publish from worker threads."""
import asyncio
import json


class Hub:
    def __init__(self):
        self.subs: dict[int, set[asyncio.Queue]] = {}
        self.loop: asyncio.AbstractEventLoop | None = None

    def bind(self, loop: asyncio.AbstractEventLoop):
        self.loop = loop

    def subscribe(self, child_id: int) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=200)
        self.subs.setdefault(child_id, set()).add(q)
        return q

    def unsubscribe(self, child_id: int, q: asyncio.Queue):
        self.subs.get(child_id, set()).discard(q)

    def _put(self, child_id: int, message: str):
        for q in list(self.subs.get(child_id, ())):
            if q.full():
                try:
                    q.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            q.put_nowait(message)

    def publish(self, child_id: int, event: str, data: dict):
        if not self.loop or child_id not in self.subs:
            return
        message = f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if running is self.loop:
            self._put(child_id, message)
        else:
            self.loop.call_soon_threadsafe(self._put, child_id, message)


hub = Hub()
