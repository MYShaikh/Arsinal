/**
 * Markers built on OverlayView. Google's AdvancedMarkerElement needs a cloud Map ID, and a Map ID turns off the
 * JSON map styles that hide the default restaurant/shop icons, so Arsenal draws its own markers instead.
 */
export interface MapMarker {
  setMap(map: google.maps.Map | null): void;
  setPosition(position: google.maps.LatLngLiteral): void;
}

export interface MarkerOptions {
  position: google.maps.LatLngLiteral;
  content: HTMLElement;
  /** Which point of the content sits on the position. Pins point with their tip, badges are centred. */
  anchor?: 'center' | 'bottom';
  title?: string;
  zIndex?: number;
  onClick?: () => void;
}

export type MarkerFactory = (options: MarkerOptions) => MapMarker;

/** Must be called after the Maps script has loaded, because the class extends google.maps.OverlayView. */
export function createMarkerFactory(): MarkerFactory {
  class HtmlMarker extends google.maps.OverlayView implements MapMarker {
    private position: google.maps.LatLngLiteral;
    private readonly el: HTMLElement;

    constructor(options: MarkerOptions) {
      super();
      this.position = options.position;
      this.el = options.content;
      this.el.style.position = 'absolute';
      this.el.style.transform = options.anchor === 'bottom' ? 'translate(-50%, -100%)' : 'translate(-50%, -50%)';
      if (options.zIndex !== undefined) this.el.style.zIndex = String(options.zIndex);
      if (options.title) this.el.title = options.title;
      if (options.onClick) {
        const onClick = options.onClick;
        this.el.style.cursor = 'pointer';
        this.el.addEventListener('click', () => onClick());
      }
      google.maps.OverlayView.preventMapHitsAndGesturesFrom(this.el);
    }

    override onAdd() {
      this.getPanes()?.overlayMouseTarget.appendChild(this.el);
    }

    override draw() {
      const point = this.getProjection()?.fromLatLngToDivPixel(new google.maps.LatLng(this.position));
      if (!point) return;
      this.el.style.left = `${point.x}px`;
      this.el.style.top = `${point.y}px`;
    }

    override onRemove() {
      this.el.remove();
    }

    setPosition(position: google.maps.LatLngLiteral) {
      this.position = position;
      this.draw();
    }
  }
  return (options) => new HtmlMarker(options);
}

// ---- Marker artwork. Colours are fixed constants, never user input, so the innerHTML below is safe. ----

export function redDotContent(): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText =
    'width:14px;height:14px;border-radius:50%;background:#e53935;border:2px solid #fff;' +
    'box-shadow:0 0 0 1px rgba(0,0,0,.35),0 1px 4px rgba(0,0,0,.5)';
  return el;
}

export type BadgeKind = 'hospital' | 'pharmacy' | 'grocery' | 'ammo';

const BADGES: Record<BadgeKind, { background: string; symbol: string }> = {
  hospital: {
    background: '#d93025',
    symbol: '<path fill="#fff" d="M5 4h3.5v6h7V4H19v16h-3.5v-6h-7v6H5z"/>',
  },
  pharmacy: {
    background: '#188038',
    symbol: '<path fill="#fff" d="M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z"/>',
  },
  grocery: {
    background: '#ef6c00',
    symbol:
      '<path fill="#fff" d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49A1 1 0 0 0 20 4H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z"/>',
  },
  ammo: {
    background: '#3c4043',
    symbol: '<g fill="none" stroke="#fff" stroke-width="2"><circle cx="12" cy="12" r="6"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6"/></g>',
  },
};

/** Round badge with a symbol, used for the places Arsenal shows besides the nuclear plants. */
export function badgeContent(kind: BadgeKind): HTMLElement {
  const badge = BADGES[kind];
  const el = document.createElement('div');
  el.style.cssText =
    `width:24px;height:24px;border-radius:50%;display:grid;place-items:center;background:${badge.background};` +
    'border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.3),0 1px 4px rgba(0,0,0,.5)';
  el.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16">${badge.symbol}</svg>`;
  return el;
}

export function waterDotContent(): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText =
    'width:16px;height:16px;border-radius:50%;background:#1e88e5;border:2px solid #fff;' +
    'box-shadow:0 0 0 1px rgba(0,0,0,.35),0 1px 4px rgba(0,0,0,.5)';
  return el;
}

export function pinContent(color: string): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = 'line-height:0;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))';
  el.innerHTML =
    `<svg width="28" height="38" viewBox="-1 -1 26 34"><path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20C24 5.4 18.6 0 12 0z" ` +
    `fill="${color}" stroke="#fff" stroke-width="1.5"/><circle cx="12" cy="12" r="4.5" fill="#fff"/></svg>`;
  return el;
}

export function userDotContent(): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText =
    'width:18px;height:18px;border-radius:50%;background:#1a73e8;border:3px solid #fff;' +
    'box-shadow:0 0 0 2px rgba(26,115,232,.35),0 1px 4px rgba(0,0,0,.4)';
  return el;
}
