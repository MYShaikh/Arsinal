export type Category = 'favorite' | 'want_to_go' | 'starred';
export type TravelMode = 'DRIVING' | 'WALKING' | 'BICYCLING' | 'TRANSIT';
export type MapType = 'roadmap' | 'hybrid' | 'terrain';

export const CATEGORIES: { value: Category; label: string; color: string }[] = [
  { value: 'favorite', label: 'Favorite', color: '#d93025' },
  { value: 'want_to_go', label: 'Want to go', color: '#188038' },
  { value: 'starred', label: 'Starred', color: '#f9ab00' },
];

/** A place as the UI sees it, whether it came from Google, a map click or the Django API. */
export interface PlaceInfo {
  name: string;
  address: string;
  /** One line of extra context, e.g. operator and capacity for a nuclear power plant. */
  description?: string;
  lat: number;
  lng: number;
  placeId?: string;
  rating?: number;
  ratingCount?: number;
  website?: string;
  phone?: string;
  photoUrl?: string;
  openNow?: boolean;
  hours?: string[];
}

export interface NuclearPlant {
  id: string;
  name: string;
  operator: string;
  capacity_mw: number | null;
  lat: number;
  lng: number;
}

export type PoiCategory = 'hospital' | 'pharmacy' | 'grocery' | 'ammo';

/** A hospital, pharmacy, grocery store or ammunition shop from OpenStreetMap, via Django. */
export interface Poi {
  id: string;
  category: PoiCategory;
  name: string;
  lat: number;
  lng: number;
}

/** What the sidebar's Nearest tab can look for. */
export type NearestCategory = PoiCategory | 'nuclear' | 'water';

/** A route the sidebar asks the directions panel to show. */
export interface RouteRequest {
  destination: PlaceInfo;
  origin?: { lat: number; lng: number; name: string };
  mode?: TravelMode;
}

/** Nearest place of a category (or river, stream or canal), as answered by Django. */
export interface WaterResult {
  found: boolean;
  category?: string;
  lat?: number;
  lng?: number;
  name?: string;
  kind?: string;
  distance_m?: number;
  bearing_deg?: number;
  /** How far the search reached when nothing was found. */
  searched_m?: number;
  /** A wider search timed out, so there may be water further out. */
  incomplete?: boolean;
}

export type NearestResult = WaterResult;

export type IdentifyKind = 'track' | 'plant';
export type Edibility = 'edible' | 'edible_with_preparation' | 'not_edible' | 'poisonous' | 'unknown' | 'not_applicable';

export interface IdentifyCandidate {
  common_name: string;
  scientific_name: string;
  likelihood: 'likely' | 'possible' | 'unlikely';
  reasoning: string;
  dangerous_to_humans: string;
  edibility: Edibility;
  toxicity: string;
  medicinal_uses: string;
  lookalikes: string;
}

/** What Django returns for a photo of an animal track or a plant. */
export interface IdentifyResult {
  subject: 'animal_track' | 'plant' | 'fungus' | 'other' | 'unclear';
  summary: string;
  confidence: 'high' | 'medium' | 'low';
  candidates: IdentifyCandidate[];
  safety_warning: string;
  photo_tips: string;
}

export type AnimalCategory = 'dangerous' | 'venomous' | 'poisonous';

export interface WildlifeAnimal {
  common_name: string;
  scientific_name: string;
  category: AnimalCategory;
  risk: string;
  precaution: string;
  image_url: string | null;
  page_url: string | null;
}

/** Dangerous, venomous and poisonous animals near a point, as answered by Django. */
export interface WildlifeResult {
  region: string;
  animals: WildlifeAnimal[];
}

export interface SavedPlace {
  id: number;
  name: string;
  address: string;
  lat: number;
  lng: number;
  google_place_id: string;
  category: Category;
  note: string;
  created_at: string;
}

export interface RecentSearch {
  id: number;
  query: string;
  address: string;
  lat: number;
  lng: number;
  google_place_id: string;
  created_at: string;
}

export interface Suggestion {
  text: string;
  main: string;
  secondary: string;
  prediction: google.maps.places.PlacePrediction;
}

export interface RouteStep {
  instructions: string;
  distance: string;
}

export interface RouteInfo {
  distance: string;
  duration: string;
  steps: RouteStep[];
}
