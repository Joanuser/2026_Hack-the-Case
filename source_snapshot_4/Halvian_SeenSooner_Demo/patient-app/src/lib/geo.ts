interface GeoPoint { lat: number; lng: number; accuracy?: number | null }

export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function getPosition(timeoutMs = 10000): Promise<GeoPoint> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('unsupported'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 },
    );
  });
}

/** Hospital reference point from local configuration. Exact patient GPS is never persisted. */
export function hospitalPoint(): GeoPoint | null {
  const lat = Number(import.meta.env.VITE_HOSPITAL_LAT);
  const lng = Number(import.meta.env.VITE_HOSPITAL_LNG);
  if (Number.isFinite(lat) && Number.isFinite(lng) && import.meta.env.VITE_HOSPITAL_LAT) return { lat, lng };
  return null;
}

export const EXIT_RADIUS_M = Number(import.meta.env.VITE_EXIT_RADIUS_METERS || 150);
