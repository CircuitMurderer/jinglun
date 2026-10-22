// Wire contract for jinglun-world. Coordinates are map units, not kilometres.
export interface MapConfig {
  seed: string;
  cell_count: number;
  relaxations: number;
  land_ratio: number;
}
export interface Point { x: number; y: number }
export type Terrain = 'deep_ocean' | 'shallow_sea' | 'plains' | 'grassland' | 'forest' | 'desert' | 'hills' | 'mountains' | 'snow' | 'plateau' | 'lake' | 'tundra';
export interface MonthClimate {
  temperature_c: number; precipitation_mm: number; snowfall_mm: number; snowmelt_mm: number;
  potential_evapotranspiration_mm: number; evapotranspiration_mm: number;
  runoff_mm: number; recharge_mm: number; soil_water_mm: number;
}
export interface ClimateProfile {
  months: MonthClimate[];
  continentality: number; growing_months: number; rainfed_months: number; cold_months: number;
  snow_storage_change_mm: number; soil_storage_change_mm: number;
}
export type ResourceKind = 'grain' | 'livestock' | 'fiber' | 'timber' | 'stone' | 'coal' | 'iron' | 'oil' | 'rare_earth' | 'freshwater';
export interface Resource { kind: ResourceKind; potential: number }
export interface Cell {
  id: number;
  site: Point;
  centroid: Point;
  polygon: Point[];
  area: number;
  neighbors: number[];
  is_land: boolean;
  is_coastal: boolean;
  terrain: Terrain;
  elevation_m: number;
  rainfall_mm: number;
  temperature_c: number;
  climate: ClimateProfile;
  land_fraction: number;
  lake_fraction: number;
  landform: 'ocean' | 'lowland' | 'plateau' | 'hills' | 'mountains';
  thermal_zone: 'cold' | 'temperate' | 'warm';
  moisture_zone: 'arid' | 'semi_arid' | 'subhumid' | 'humid';
  vegetation: 'bare' | 'grassland' | 'woodland' | 'forest' | 'alpine';
  soil_quality: number;
  agricultural_suitability: number;
  arable_fraction: number;
  irrigation_potential: number;
  river_access: number;
  aridity_index: number;
  causes: Array<'coastal_moisture' | 'rain_shadow' | 'water_deficit' | 'river_water' | 'irrigation_opportunity' | 'flat_plateau' | 'cold_limit' | 'steep_limit' | 'regional_climate' | 'snowmelt_supply' | 'seasonal_drought'>;
  flatness: number;
  resources: Resource[];
}
export interface Edge {
  id: number; a: number; b: number; start: Point; end: Point; length: number;
  kind: 'land' | 'sea' | 'coast';
}
export interface WorldMap {
  generator_version: string;
  config: MapConfig;
  width: number;
  height: number;
  cells: Cell[];
  edges: Edge[];
  stats: {
    land_cells: number; sea_cells: number; land_ratio: number; landmasses: number;
    coastal_cells: number; mountain_cells: number;
    mean_land_elevation_m: number; mean_land_rainfall_mm: number;
    river_segments: number; lakes: number;
  };
  environment: {
    columns: number; rows: number; fingerprint: string;
    latitude_range: [number, number];
    land_ratio: number; landmasses: number;
    terrain_palette: Terrain[];
    layers: Array<{kind: Exclude<Layer, 'resources' | 'temperature'>; bands: Array<{value: number; path: string}>}>;
    coast_path: string;
    rivers: Array<{id: number; points: Point[]; flow_index: number; basin_id: number; outlet: 'junction' | 'ocean' | 'lake' | 'boundary'}>;
    lakes: Array<{id: number; path: string; area_fraction: number; spill_elevation_m: number}>;
  };
}
export interface MapResponse { map: WorldMap; meta: { generation_ms: number } }
export type Layer = 'terrain' | 'elevation' | 'temperature' | 'rainfall' | 'water' | 'soil' | 'agriculture' | 'resources';
