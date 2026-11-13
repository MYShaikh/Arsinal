import { isDevMode } from '@angular/core';

/** Django API. In production the API is expected to be served from the same origin under /api. */
export const API_BASE = isDevMode() ? 'http://localhost:8000/api' : '/api';
