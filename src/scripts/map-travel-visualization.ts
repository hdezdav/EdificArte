import mapboxgl from 'mapbox-gl';
import type { CustomLayerInterface, GeoJSONSource, Map } from 'mapbox-gl';
import * as THREE from 'three';

export const WALKING_MAX_KM = 3;
export const FLIGHT_MIN_KM = 250;

export type TravelMode = 'walking' | 'driving' | 'flight';
type Coordinate = [number, number];

interface TravelState {
  mode: TravelMode;
  coordinates: Coordinate[];
  distances: number[];
  progress: number;
  distanceKm?: number;
}

const ROUTE_SOURCE = 'route';
const ROUTE_PROGRESS_SOURCE = 'route-progress';
const ROUTE_BG_LAYER = 'route-line-bg';
const ROUTE_LAYER = 'route-line';
const MODEL_LAYER = 'travel-model';
const ROUTE_COLOR = '#818cf8';
const ROUTE_BG_COLOR = '#6366f1';

export function getTravelMode(distanceKm: number): TravelMode {
  if (distanceKm <= WALKING_MAX_KM) return 'walking';
  if (distanceKm < FLIGHT_MIN_KM) return 'driving';
  return 'flight';
}

function lineFeature(
  coordinates: Coordinate[]
): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates },
  };
}

function cumulativeDistances(coordinates: Coordinate[]): number[] {
  const distances = [0];
  for (let index = 1; index < coordinates.length; index += 1) {
    const [previousLng, previousLat] = coordinates[index - 1];
    const [lng, lat] = coordinates[index];
    const averageLat = ((previousLat + lat) * Math.PI) / 360;
    const dx = (lng - previousLng) * Math.cos(averageLat);
    const dy = lat - previousLat;
    distances.push(distances[index - 1] + Math.hypot(dx, dy));
  }
  return distances;
}

function pointAtProgress(
  coordinates: Coordinate[],
  distances: number[],
  progress: number
): Coordinate {
  const target = distances[distances.length - 1] * progress;
  let index = 1;
  while (index < distances.length && distances[index] < target) index += 1;
  if (index >= coordinates.length) return coordinates[coordinates.length - 1];
  const segmentLength = distances[index] - distances[index - 1];
  const segmentProgress =
    segmentLength === 0 ? 0 : (target - distances[index - 1]) / segmentLength;
  return [
    coordinates[index - 1][0] +
      (coordinates[index][0] - coordinates[index - 1][0]) * segmentProgress,
    coordinates[index - 1][1] +
      (coordinates[index][1] - coordinates[index - 1][1]) * segmentProgress,
  ];
}

function revealedCoordinates(
  coordinates: Coordinate[],
  distances: number[],
  progress: number
): Coordinate[] {
  if (progress >= 1) return coordinates;
  const target = distances[distances.length - 1] * progress;
  let endIndex = 1;
  while (endIndex < distances.length && distances[endIndex] < target)
    endIndex += 1;
  return [
    ...coordinates.slice(0, endIndex),
    pointAtProgress(coordinates, distances, progress),
  ];
}

function createCar(): THREE.Group {
  const car = new THREE.Group();
  const bodyMaterial = new THREE.MeshLambertMaterial({ color: 0x2563eb });
  const darkMaterial = new THREE.MeshLambertMaterial({ color: 0x172033 });
  const glassMaterial = new THREE.MeshLambertMaterial({ color: 0x9bd8f5 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2, 0.8), bodyMaterial);
  body.position.z = 0.7;
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(2.1, 1.65, 0.75),
    glassMaterial
  );
  cabin.position.set(-0.2, 0, 1.45);
  car.add(body, cabin);
  for (const x of [-1.35, 1.35]) {
    for (const y of [-1.05, 1.05]) {
      const wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.42, 0.35, 8),
        darkMaterial
      );
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(x, y, 0.45);
      car.add(wheel);
    }
  }
  return car;
}

function createPlane(): THREE.Group {
  const plane = new THREE.Group();
  const bodyMaterial = new THREE.MeshLambertMaterial({ color: 0xf8fafc });
  const accentMaterial = new THREE.MeshLambertMaterial({ color: 0x2563eb });
  const fuselage = new THREE.Mesh(
    new THREE.ConeGeometry(1.1, 7, 8),
    bodyMaterial
  );
  fuselage.rotation.z = -Math.PI / 2;
  const wings = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 9, 0.25),
    accentMaterial
  );
  wings.position.x = -0.5;
  const tail = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 3.4, 0.2),
    accentMaterial
  );
  tail.position.x = -2.6;
  const fin = new THREE.Mesh(
    new THREE.ConeGeometry(0.65, 2.2, 4),
    accentMaterial
  );
  fin.rotation.z = -Math.PI / 2;
  fin.position.set(-2.7, 0, 0.8);
  plane.add(fuselage, wings, tail, fin);
  return plane;
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.Line))
      return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    materials.forEach((material) => material.dispose());
  });
}

function unwrapLongitude(longitude: number, reference: number): number {
  let result = longitude;
  while (result - reference > 180) result -= 360;
  while (result - reference < -180) result += 360;
  return result;
}

export function createFlightArc(
  from: Coordinate,
  to: Coordinate,
  segments = 96
): Coordinate[] {
  const toVector = ([lng, lat]: Coordinate) => {
    const phi = (lat * Math.PI) / 180;
    const lambda = (lng * Math.PI) / 180;
    return new THREE.Vector3(
      Math.cos(phi) * Math.cos(lambda),
      Math.cos(phi) * Math.sin(lambda),
      Math.sin(phi)
    );
  };
  const start = toVector(from);
  const end = toVector(to);
  const angle = Math.acos(THREE.MathUtils.clamp(start.dot(end), -1, 1));
  const sinAngle = Math.sin(angle);
  const coordinates: Coordinate[] = [];
  let previousLng = from[0];

  for (let index = 0; index <= segments; index += 1) {
    const t = index / segments;
    const vector =
      sinAngle < 1e-6
        ? start.clone().lerp(end, t).normalize()
        : start
            .clone()
            .multiplyScalar(Math.sin((1 - t) * angle) / sinAngle)
            .add(end.clone().multiplyScalar(Math.sin(t * angle) / sinAngle));
    const lat = (Math.asin(vector.z) * 180) / Math.PI;
    const rawLng = (Math.atan2(vector.y, vector.x) * 180) / Math.PI;
    const lng = unwrapLongitude(rawLng, previousLng);
    coordinates.push([lng, lat]);
    previousLng = lng;
  }
  return coordinates;
}

function greatCircleDistanceKm(from: Coordinate, to: Coordinate): number {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const dLat = toRadians(to[1] - from[1]);
  const dLng = toRadians(to[0] - from[0]);
  const fromLat = toRadians(from[1]);
  const toLat = toRadians(to[1]);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

class TravelModelLayer implements CustomLayerInterface {
  readonly id = MODEL_LAYER;
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;
  private camera?: THREE.Camera;
  private scene?: THREE.Scene;
  private renderer?: THREE.WebGLRenderer;
  private model?: THREE.Group;
  private arc?: THREE.Line;

  constructor(private readonly state: TravelState) {}

  onAdd(map: Map, gl: WebGL2RenderingContext) {
    this.camera = new THREE.Camera();
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 2.2));
    const directional = new THREE.DirectionalLight(0xffffff, 2.4);
    directional.position.set(0, -10, 20);
    this.scene.add(directional);

    this.model = this.state.mode === 'driving' ? createCar() : createPlane();
    this.scene.add(this.model);
    if (this.state.mode === 'flight') {
      const positions: number[] = [];
      const distanceKm = this.state.distanceKm ?? 250;
      const peakAltitude = Math.min(
        1_200_000,
        Math.max(80_000, distanceKm * 850)
      );
      this.state.coordinates.forEach(([lng, lat], index) => {
        const t = index / (this.state.coordinates.length - 1);
        const altitude = 4 * peakAltitude * t * (1 - t);
        const coordinate = mapboxgl.MercatorCoordinate.fromLngLat(
          [lng, lat],
          altitude
        );
        positions.push(coordinate.x, coordinate.y, coordinate.z);
      });
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(positions, 3)
      );
      this.arc = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({
          color: ROUTE_COLOR,
          transparent: true,
          opacity: 0.9,
        })
      );
      this.scene.add(this.arc);
    }
    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl,
      antialias: false,
    });
    this.renderer.autoClear = false;
  }

  render(_gl: WebGL2RenderingContext, matrix: number[]) {
    if (!this.camera || !this.scene || !this.renderer || !this.model) return;
    const [lng, lat] = pointAtProgress(
      this.state.coordinates,
      this.state.distances,
      this.state.progress
    );
    const next = pointAtProgress(
      this.state.coordinates,
      this.state.distances,
      Math.min(1, this.state.progress + 0.002)
    );
    const altitude =
      this.state.mode === 'flight'
        ? 4 *
          Math.min(
            1_200_000,
            Math.max(80_000, (this.state.distanceKm ?? 250) * 850)
          ) *
          this.state.progress *
          (1 - this.state.progress)
        : 1.5;
    const coordinate = mapboxgl.MercatorCoordinate.fromLngLat(
      [lng, lat],
      altitude
    );
    const modelMeters =
      this.state.mode === 'driving'
        ? 2.2
        : Math.max(18, Math.min(180, this.state.coordinates.length * 1.2));
    const scale = coordinate.meterInMercatorCoordinateUnits() * modelMeters;
    this.model.position.set(coordinate.x, coordinate.y, coordinate.z);
    this.model.scale.set(scale, -scale, scale);
    this.model.rotation.z = Math.atan2(
      next[1] - lat,
      (next[0] - lng) * Math.cos((lat * Math.PI) / 180)
    );
    this.camera.projectionMatrix.fromArray(matrix);
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
  }

  onRemove() {
    if (this.model) disposeObject(this.model);
    if (this.arc) disposeObject(this.arc);
    this.renderer?.dispose();
    this.model = undefined;
    this.arc = undefined;
    this.renderer = undefined;
    this.scene = undefined;
    this.camera = undefined;
  }
}

export class TravelVisualization {
  private state: TravelState | null = null;
  private frameId: number | null = null;
  private destroyed = false;
  private readonly reducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)'
  ).matches;

  constructor(
    private readonly map: Map,
    private readonly isActive: () => boolean
  ) {}

  showRoute(mode: 'walking' | 'driving', coordinates: Coordinate[]) {
    const routeCoordinates = coordinates.map(
      (coordinate) => [...coordinate] as Coordinate
    );
    this.replace({
      mode,
      coordinates: routeCoordinates,
      distances: cumulativeDistances(routeCoordinates),
      progress: this.reducedMotion ? 1 : 0,
    });
  }

  showFlight(from: Coordinate, to: Coordinate) {
    const coordinates = createFlightArc(from, to);
    this.replace({
      mode: 'flight',
      coordinates,
      distances: cumulativeDistances(coordinates),
      progress: this.reducedMotion ? 0.5 : 0,
      distanceKm: greatCircleDistanceKm(from, to),
    });
  }

  restoreAfterStyleLoad() {
    if (!this.state || this.destroyed || !this.isActive()) return;
    this.addCurrentState();
  }

  clear() {
    this.cancelAnimation();
    this.removeMapResources();
    this.state = null;
  }

  destroy() {
    this.destroyed = true;
    this.clear();
  }

  private replace(state: TravelState) {
    this.cancelAnimation();
    this.removeMapResources();
    this.state = state;
    this.addCurrentState();
    if (!this.reducedMotion) this.startAnimation();
  }

  private addCurrentState() {
    if (!this.state || !this.map.isStyleLoaded()) return;
    if (this.state.mode !== 'flight') {
      this.map.addSource(ROUTE_SOURCE, {
        type: 'geojson',
        data: lineFeature(this.state.coordinates),
      });
      this.map.addSource(ROUTE_PROGRESS_SOURCE, {
        type: 'geojson',
        data: lineFeature(
          revealedCoordinates(
            this.state.coordinates,
            this.state.distances,
            this.state.progress
          )
        ),
      });
      this.map.addLayer({
        id: ROUTE_BG_LAYER,
        type: 'line',
        source: ROUTE_SOURCE,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ROUTE_BG_COLOR,
          'line-width': 8,
          'line-opacity': 0.3,
        },
      });
      this.map.addLayer({
        id: ROUTE_LAYER,
        type: 'line',
        source: ROUTE_PROGRESS_SOURCE,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ROUTE_COLOR,
          'line-width': 4,
          'line-opacity': 0.9,
        },
      });
    }
    if (this.state.mode !== 'walking')
      this.map.addLayer(new TravelModelLayer(this.state));
  }

  private startAnimation() {
    const mode = this.state?.mode;
    const duration =
      mode === 'walking' ? 4_500 : mode === 'driving' ? 12_000 : 14_000;
    const startedAt =
      performance.now() - (this.state?.progress ?? 0) * duration;
    const animate = (now: number) => {
      if (!this.state || this.destroyed || !this.isActive()) {
        this.frameId = null;
        return;
      }
      this.state.progress = Math.min(1, (now - startedAt) / duration);
      if (this.state.mode !== 'flight') {
        const source = this.map.getSource(ROUTE_PROGRESS_SOURCE) as
          GeoJSONSource | undefined;
        if (source) {
          source.setData(
            lineFeature(
              revealedCoordinates(
                this.state.coordinates,
                this.state.distances,
                this.state.progress
              )
            )
          );
        }
      }
      if (!this.destroyed && this.isActive()) this.map.triggerRepaint();
      if (this.state.progress < 1)
        this.frameId = requestAnimationFrame(animate);
      else this.frameId = null;
    };
    this.frameId = requestAnimationFrame(animate);
  }

  private cancelAnimation() {
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    this.frameId = null;
  }

  private removeMapResources() {
    if (this.map.getLayer(MODEL_LAYER)) this.map.removeLayer(MODEL_LAYER);
    if (this.map.getLayer(ROUTE_LAYER)) this.map.removeLayer(ROUTE_LAYER);
    if (this.map.getLayer(ROUTE_BG_LAYER)) this.map.removeLayer(ROUTE_BG_LAYER);
    if (this.map.getSource(ROUTE_PROGRESS_SOURCE))
      this.map.removeSource(ROUTE_PROGRESS_SOURCE);
    if (this.map.getSource(ROUTE_SOURCE)) this.map.removeSource(ROUTE_SOURCE);
  }
}
