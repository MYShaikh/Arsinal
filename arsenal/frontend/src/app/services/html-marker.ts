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
