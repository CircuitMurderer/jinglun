import type { Point } from './types';

/** Renderer-independent view state. Coordinates and pan use world units. */
export interface MapViewState {
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  pixelRatio: number;
  scale: number;
  tx: number;
  ty: number;
  selectedId?: number;
}

/** Match SVG's default xMidYMid meet, including its letterboxing. */
export function screenTransform(view: Readonly<MapViewState>): { scale: number; x: number; y: number } {
  const fit = Math.min(view.viewportWidth / view.width, view.viewportHeight / view.height);
  return {
    scale: fit * view.scale,
    x: (view.viewportWidth - view.width * fit) / 2 + view.tx * fit,
    y: (view.viewportHeight - view.height * fit) / 2 + view.ty * fit,
  };
}

export class MapCamera {
  private current: Readonly<MapViewState> = {
    width: 1600, height: 1000, viewportWidth: 1600, viewportHeight: 1000,
    pixelRatio: 1, scale: 1, tx: 0, ty: 0,
  };
  private listeners = new Set<(view: Readonly<MapViewState>) => void>();

  get state(): Readonly<MapViewState> { return this.current; }

  subscribe(listener: (view: Readonly<MapViewState>) => void): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }

  private update(changes: Partial<MapViewState>): void {
    if (Object.entries(changes).every(([key, value]) => this.current[key as keyof MapViewState] === value)) return;
    this.current = { ...this.current, ...changes };
    for (const listener of this.listeners) listener(this.current);
  }

  setWorld(width: number, height: number): void {
    this.update({ width, height, scale: 1, tx: 0, ty: 0, selectedId: undefined });
  }

  setViewport(viewportWidth: number, viewportHeight: number, pixelRatio: number): void {
    if (viewportWidth <= 0 || viewportHeight <= 0) return;
    this.update({ viewportWidth, viewportHeight, pixelRatio });
  }

  /** Position in the untransformed SVG viewBox, for the single gesture owner. */
  toView(point: Point): Point {
    const view = this.current;
    const fit = Math.min(view.viewportWidth / view.width, view.viewportHeight / view.height);
    return {
      x: (point.x - (view.viewportWidth - view.width * fit) / 2) / fit,
      y: (point.y - (view.viewportHeight - view.height * fit) / 2) / fit,
    };
  }

  pan(tx: number, ty: number): void {
    const { width, height, scale } = this.current;
    this.update({
      tx: Math.max(-width * scale + width * 0.1125, Math.min(width * 0.8875, tx)),
      ty: Math.max(-height * scale + height * 0.12, Math.min(height * 0.88, ty)),
    });
  }

  zoom(factor: number, point: Point = { x: this.current.width / 2, y: this.current.height / 2 }): void {
    const { scale, tx, ty, width, height } = this.current;
    const next = Math.max(0.75, Math.min(7, scale * factor));
    const ratio = next / scale;
    this.update({
      scale: next,
      tx: Math.max(-width * next + width * 0.1125, Math.min(width * 0.8875, point.x - (point.x - tx) * ratio)),
      ty: Math.max(-height * next + height * 0.12, Math.min(height * 0.88, point.y - (point.y - ty) * ratio)),
    });
  }

  /** Absolute camera placement (used by animated fly-to); same limits as pan and zoom. */
  setView(scale: number, tx: number, ty: number): void {
    const { width, height } = this.current;
    const next = Math.max(0.75, Math.min(7, scale));
    this.update({
      scale: next,
      tx: Math.max(-width * next + width * 0.1125, Math.min(width * 0.8875, tx)),
      ty: Math.max(-height * next + height * 0.12, Math.min(height * 0.88, ty)),
    });
  }

  reset(): void { this.update({ scale: 1, tx: 0, ty: 0 }); }
  select(selectedId: number | undefined): void { this.update({ selectedId }); }
}
