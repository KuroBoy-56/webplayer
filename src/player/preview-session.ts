// Una sola vista previa puede poseer el reproductor. La pantalla completa
// espera su cierre asíncrono para liberar la conexión y el decodificador.
type Stop = () => Promise<void>;
let current: Stop | null = null;
let released: Promise<void> = Promise.resolve();

export function stopLivePreview(): Promise<void> {
  const stop = current;
  current = null;
  if (stop) released = Promise.all([released, stop()]).then(() => {}, () => {});
  return released;
}

export function waitForLivePreview(): Promise<void> {
  return released;
}

export function registerLivePreview(stop: Stop): () => void {
  void stopLivePreview();
  current = stop;
  return () => {
    if (current === stop) void stopLivePreview();
    else void stop(); // El cierre de cada sesión es idempotente.
  };
}
