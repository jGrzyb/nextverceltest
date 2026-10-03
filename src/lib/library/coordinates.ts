/** Immutable geographic coordinates with validation. */
export class Coordinates {
  readonly lat: number;
  readonly lon: number;

  constructor(lat: number, lon: number) {
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      throw new RangeError(`Latitude must be between -90 and 90, got ${lat}`);
    }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      throw new RangeError(
        `Longitude must be between -180 and 180, got ${lon}`
      );
    }
    this.lat = lat;
    this.lon = lon;
  }
}

/** Calculates great-circle distances between coordinates. */
export class DistanceCalculator {
  static readonly EARTH_RADIUS_KM = 6371.0;

  /** Great-circle distance between two coordinates, in kilometers. */
  static haversine(coord1: Coordinates, coord2: Coordinates): number {
    const lat1 = (Math.PI / 180) * coord1.lat;
    const lon1 = (Math.PI / 180) * coord1.lon;
    const lat2 = (Math.PI / 180) * coord2.lat;
    const lon2 = (Math.PI / 180) * coord2.lon;

    const deltaLat = lat2 - lat1;
    const deltaLon = lon2 - lon1;

    const a =
      Math.sin(deltaLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return DistanceCalculator.EARTH_RADIUS_KM * c;
  }
}
