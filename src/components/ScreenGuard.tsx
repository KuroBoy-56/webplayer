// Un error al dibujar una pantalla (2.6.4) ya no cierra la app: la pantalla se cambia por nada y App vuelve a la
// anterior con un aviso; el error queda al panel con su detalle.
import React from 'react';

type Props = { onError: (e: unknown, info: string) => void; children: React.ReactNode };

export default class ScreenGuard extends React.Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(e: unknown, info: { componentStack?: string | null }): void {
    try {
      this.props.onError(e, String(info?.componentStack || '').slice(0, 1500));
    } catch {
      // nada más que hacer
    }
  }

  render(): React.ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
