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
export interface GroundMonth {
  recharge_mm: number; seepage_mm: number; baseflow_mm: number;
  storage_mm: number; storage_change_mm: number; tds_mg_l: number;
}
export type WaterQuality = 'dry' | 'fresh' | 'brackish' | 'saline';
export interface SourceMonth {
  natural_outflow: number; ecological_reserve: number; planning_ceiling: number;
  freshwater_ceiling: number; tds_mg_l: number; quality: WaterQuality;
}
export interface WaterSource { id: number; outlet: 'ocean' | 'boundary' | 'closed_basin'; months: SourceMonth[] }
export type ResourceKind = 'grain' | 'livestock' | 'fiber' | 'timber' | 'stone' | 'coal' | 'iron' | 'oil' | 'rare_earth' | 'freshwater';
export interface Resource { kind: ResourceKind; potential: number }
export type GeologyKind = 'sedimentary' | 'craton' | 'orogenic' | 'igneous' | 'ocean';
export interface MineralOccurrence {
  deposit_id: number; kind: ResourceKind; reserve_units: number; grade_index: number;
  depth_m: number; extraction_difficulty: number;
}
export interface SoilProfile {
  depth_cm: number; sand_fraction: number; organic_percent: number; erosion_mm_year: number;
  deposition_mm_year: number; water_capacity_mm: number; quality: number;
}
export interface Construction {
  area_km2: number; buildable_fraction: number; conditional_fraction: number;
  unavailable_fraction: number; buildable_area_km2: number; cost_multiplier: number | null;
  flood_risk: number; natural_support_index: number; construction_months: number; land_anchor: Point | null;
}
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
  endorheic_land_fraction: number;
  lake_ids: number[];
  water_source_ids: number[];
  groundwater: { initial_storage_mm: number; initial_tds_mg_l: number; months: GroundMonth[] };
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
  geology_kind: GeologyKind;
  geology_provinces: number[];
  minerals: MineralOccurrence[];
  soil_profile: SoilProfile;
  construction: Construction;
}
export interface Edge {
  id: number; a: number; b: number; start: Point; end: Point; length: number;
  kind: 'land' | 'sea' | 'coast';
  passage: { kind: 'marine' | 'land' | 'mountain' | 'river_crossing' | 'lake_crossing' | 'sea_crossing'; distance_km: number; cost_multiplier: number | null; crosses_river: boolean; crosses_lake: boolean; crosses_sea: boolean };
}
export interface LakeMonth {
  inflow: number; evaporation: number; overflow: number; storage_change: number;
  storage: number; water_level_m: number;
  seepage: number; tds_mg_l: number; salt_storage: number; quality: WaterQuality;
}
export interface Basin {
  id: number; kind: 'dry' | 'closed' | 'seasonal' | 'overflow';
  spill_elevation_m: number; capacity: number; initial_storage: number; months: LakeMonth[];
}
export interface NaturalDetail {
  version: 1; columns: number; rows: number; terrain: number[]; shade: number[];
  azimuth_deg: number; altitude_deg: number; vertical_exaggeration: number;
  symbols: Array<{ position: Point; terrain: number }>;
}
export interface NaturalSurface {
  version: 1;
  land_path: string;
  coast_path: string;
  shallow_path: string;
  terrain: Array<{ terrain: number; path: string }>;
  detail?: NaturalDetail; // Phase 2 enhancement; Phase 1 payloads remain supported.
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
    natural_surface?: NaturalSurface; // Additive presentation data; absent on older servers.
    rivers: Array<{id: number; points: Point[]; flow_index: number; basin_id: number; outlet: 'junction' | 'ocean' | 'lake' | 'boundary' | 'closed_basin'; annual_flow: number; monthly_flow: number[]; monthly_flow_index: number[]}>;
    lakes: Array<{id: number; path: string; area_fraction: number; spill_elevation_m: number; basin_id: number}>;
    basins: Basin[];
    water_sources: WaterSource[];
    scale: { km_per_map_unit: number; sample_area_km2: number; water_unit_m3: number };
    geology_provinces: Array<{ id: number; kind: GeologyKind; rock: 'sandstone_shale' | 'ancient_basement' | 'metamorphic' | 'granite_basalt' }>;
    deposits: Array<{ id: number; kind: ResourceKind; province_id: number; area_km2: number; reserve_units: number; grade_index: number; depth_m: number }>;
    sediment_budget: { reference_years: number; eroded_m3: number; deposited_land_m3: number; trapped_lake_m3: number; ocean_export_m3: number; boundary_export_m3: number };
  };
}
export interface MapResponse { map: WorldMap; meta: { generation_ms: number } }
export type Layer = 'terrain' | 'elevation' | 'temperature' | 'rainfall' | 'water' | 'soil' | 'agriculture' | 'resources' | 'geology' | 'construction';
