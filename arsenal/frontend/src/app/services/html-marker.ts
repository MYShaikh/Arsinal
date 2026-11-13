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

export type BadgeKind = 'nuclear' | 'hospital' | 'pharmacy' | 'gun';

/** Radiation trefoil: three 60 degree blades around a centre dot. */
function trefoilPath(): string {
  const point = (radius: number, degrees: number) => {
    const t = ((degrees - 90) * Math.PI) / 180;
    return `${(12 + radius * Math.cos(t)).toFixed(2)} ${(12 + radius * Math.sin(t)).toFixed(2)}`;
  };
  const blade = (centre: number) =>
    `M${point(3.4, centre - 30)} L${point(9.2, centre - 30)} A9.2 9.2 0 0 1 ${point(9.2, centre + 30)} ` +
    `L${point(3.4, centre + 30)} A3.4 3.4 0 0 0 ${point(3.4, centre - 30)} Z`;
  return [0, 120, 240].map(blade).join(' ');
}

const BADGES: Record<BadgeKind, { size: number; background: string; border: string; glow: string; symbol: string }> = {
  nuclear: {
    size: 34,
    background: '#ffd400',
    border: '#111',
    glow: '0 0 0 4px rgba(255,212,0,.35), 0 0 14px 3px rgba(255,212,0,.85)',
    symbol: `<svg viewBox="0 0 24 24" width="24" height="24" fill="#111"><path d="${trefoilPath()}"/><circle cx="12" cy="12" r="2"/></svg>`,
  },
  hospital: {
    size: 26,
    background: '#d93025',
    border: '#fff',
    glow: '0 1px 4px rgba(0,0,0,.5)',
    symbol: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="#fff" d="M5 4h3.5v6h7V4H19v16h-3.5v-6h-7v6H5z"/></svg>',
  },
  pharmacy: {
    size: 26,
    background: '#188038',
    border: '#fff',
    glow: '0 1px 4px rgba(0,0,0,.5)',
    symbol: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="#fff" d="M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z"/></svg>',
  },
  gun: {
    size: 26,
    background: '#3c4043',
    border: '#fff',
    glow: '0 1px 4px rgba(0,0,0,.5)',
    symbol:
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" stroke-width="2"><circle cx="12" cy="12" r="6"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6"/></svg>',
  },
};

export function badgeContent(kind: BadgeKind): HTMLElement {
  const b = BADGES[kind];
  const el = document.createElement('div');
  el.style.cssText =
    `width:${b.size}px;height:${b.size}px;border-radius:50%;display:grid;place-items:center;` +
    `background:${b.background};border:2px solid ${b.border};box-shadow:${b.glow}`;
  el.innerHTML = b.symbol;
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
