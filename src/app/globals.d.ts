export {};

declare global {
  interface Window {
    RadarArtwork?: typeof import('../shared/artwork.js').RadarArtwork;
    RadarEnhancements?: {
      make(tag: string, className?: string, text?: string | null): HTMLElement;
      illustration(kind?: string): HTMLElement;
      pulseSaved(): void;
      feedback(message: string): void;
      attachCompare(card: HTMLElement, game: unknown): void;
    };
    RadarJourney?: { restore: { limit?: number; y?: number; appid?: string | number } | null };
    RadarCompare?: {
      ids(): number[];
      set(ids: number[], silent?: boolean): void;
      toggle(id: number, name: string): boolean;
      url(ids?: number[]): string;
    };
  }
}
