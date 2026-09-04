type Listener = () => void;

const listeners = new Set<Listener>();

let shuttingDown = false;

export function isShuttingDown(): boolean {
  return shuttingDown;
}

export function onShutdown(listener: Listener): () => void {
  if (shuttingDown) {
    listener();
    return () => {};
  }

  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function beginShutdown(): void {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  for (const listener of listeners) {
    try {
      listener();
    } catch {}
  }

  listeners.clear();
}

export function resetShutdownForTests(): void {
  shuttingDown = false;
  listeners.clear();
}
