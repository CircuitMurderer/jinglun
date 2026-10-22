import type { MapViewState } from './map-camera';
import type { WorldMap } from './types';

export interface RiverRenderer {
  setView(view: Readonly<MapViewState>): void;
  destroy(): void;
}

type RendererModule = Pick<typeof import('./pixi-rivers'), 'createRiverRenderer'>;

type Status = 'off' | 'loading' | 'gpu' | 'fallback';

/** Lazy GPU enhancement. SVG stays usable while loading or after any failure. */
export class RiverOverlay {
  private world?: WorldMap;
  private view?: Readonly<MapViewState>;
  private renderer?: RiverRenderer;
  private visible = false;
  private disposed = false;
  private revision = 0;
  private pending: Promise<void> = Promise.resolve();
  private host: HTMLElement;
  private onStatus: (status: Status) => void;
  private loadModule: () => Promise<RendererModule>;

  constructor(host: HTMLElement, onStatus: (status: Status) => void,
    loadModule: () => Promise<RendererModule> = () => import('./pixi-rivers')) {
    this.host = host;
    this.onStatus = onStatus;
    this.loadModule = loadModule;
    this.status('off');
  }

  private status(status: Status): void {
    this.host.dataset.riverRenderer = status;
    this.onStatus(status);
  }

  setWorld(world: WorldMap): void {
    this.release();
    this.world = world;
    if (this.visible) void this.load();
  }

  setVisible(visible: boolean): void {
    if (this.disposed || this.visible === visible) return;
    this.visible = visible;
    if (visible) void this.load();
    else this.release();
  }

  setView(view: Readonly<MapViewState>): void {
    this.view = view;
    try { this.renderer?.setView(view); }
    catch { this.fallback(); }
  }

  private load(): Promise<void> {
    if (!this.world || !this.view || this.disposed) return Promise.resolve();
    const revision = ++this.revision;
    const world = this.world;
    const current = () => !this.disposed && this.visible && revision === this.revision;
    this.status('loading');
    // Serialize initialization and teardown: Pixi's global pools must not be
    // released by an obsolete renderer while its replacement is initializing.
    this.pending = this.pending.then(async () => {
      let renderer: RiverRenderer | undefined;
      try {
        if (!current()) return;
        const { createRiverRenderer } = await this.loadModule();
        if (!current()) return;
        renderer = await createRiverRenderer(world, this.view!, this.host, () => {
          if (current()) this.fallback();
        });
        if (!current()) { renderer.destroy(); return; }
        renderer.setView(this.view!);
        this.renderer = renderer;
        this.status('gpu');
      } catch (error) {
        renderer?.destroy();
        if (current()) {
          console.warn('PixiJS river overlay unavailable; using SVG.', error);
          this.fallback();
        }
      }
    });
    return this.pending;
  }

  private release(): void {
    ++this.revision;
    this.renderer?.destroy();
    this.renderer = undefined;
    this.status('off');
  }

  private fallback(): void {
    this.release();
    this.status('fallback');
  }

  destroy(): void {
    this.disposed = true;
    this.release();
    this.world = undefined;
  }
}
