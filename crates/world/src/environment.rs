//! Natural geography is sampled independently of the governance tessellation.
use crate::hydrology::{self, Drainage, Lake, River, WaterBudget};
use crate::seasonal::{self, ClimateProfile};
use crate::{Cell, HEIGHT, Point, Resource, Terrain, WIDTH, fbm, index};
use noise::{NoiseFn, Simplex};
use serde::Serialize;
use std::collections::{BTreeMap, VecDeque};
use std::fmt::Write;

pub(crate) const COLS: usize = 256;
pub(crate) const ROWS: usize = 160;
const DX: f64 = WIDTH / COLS as f64;
const DY: f64 = HEIGHT / ROWS as f64;

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct SurfaceBand {
    pub value: u8,
    pub path: String,
}
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct SurfaceLayer {
    pub kind: &'static str,
    pub bands: Vec<SurfaceBand>,
}
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct AtmosphereBudget {
    pub evaporation_input: f64,
    pub precipitation: f64,
    pub boundary_export: f64,
}
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Environment {
    pub terrain_palette: Vec<Terrain>,
    pub columns: usize,
    pub rows: usize,
    pub fingerprint: String,
    pub latitude_range: [f64; 2],
    pub land_ratio: f64,
    pub landmasses: usize,
    pub mean_land_elevation_m: i32,
    pub mean_land_rainfall_mm: u32,
    pub layers: Vec<SurfaceLayer>,
    pub coast_path: String,
    pub rivers: Vec<River>,
    pub lakes: Vec<Lake>,
    pub atmosphere_budget: AtmosphereBudget,
    pub water_budget: WaterBudget,
}

#[derive(Clone, Debug)]
struct Sample {
    elevation: f64,
    rain: f64,
    temperature: f64,
    climate: ClimateProfile,
    pet: f64,
    flatness: u8,
    soil: u8,
    agriculture: u8,
    irrigation: u8,
    arable: bool,
    coastal: bool,
    shadow: f64,
    terrain: Terrain,
    landform: &'static str,
    thermal: &'static str,
    moisture: &'static str,
    vegetation: &'static str,
}
pub(crate) struct Field {
    seed: u64,
    samples: Vec<Sample>,
    drainage: Drainage,
    atmosphere_budget: AtmosphereBudget,
}

fn smooth(value: f64, a: f64, b: f64) -> f64 {
    let x = ((value - a) / (b - a)).clamp(0.0, 1.0);
    x * x * (3.0 - 2.0 * x)
}
fn cardinal(id: usize) -> impl Iterator<Item = usize> {
    let (x, y) = (id % COLS, id / COLS);
    [
        x.checked_sub(1).map(|xx| y * COLS + xx),
        (x + 1 < COLS).then_some(id + 1),
        y.checked_sub(1).map(|yy| yy * COLS + x),
        (y + 1 < ROWS).then_some(id + COLS),
    ]
    .into_iter()
    .flatten()
}

fn local_flatness(elevation: &[f64], id: usize, cols: usize, rows: usize) -> u8 {
    let (x, y) = (id % cols, id / cols);
    let (mut low, mut high) = (elevation[id], elevation[id]);
    for yy in y.saturating_sub(2)..=(y + 2).min(rows - 1) {
        for xx in x.saturating_sub(2)..=(x + 2).min(cols - 1) {
            let h = elevation[yy * cols + xx];
            if h > 0.0 {
                low = low.min(h);
                high = high.max(h);
            }
        }
    }
    // Relative relief over the fixed sampling window, not absolute elevation.
    // The scale is a game index, not an uncalibrated claim about slope degrees.
    index((-(high - low) / 500.0).exp())
}

fn landform(elevation: f64, flatness: u8) -> &'static str {
    if elevation <= 0.0 {
        "ocean"
    } else if elevation > 850.0 && flatness >= 58 {
        "plateau"
    } else if flatness < 22 || (elevation > 2100.0 && flatness < 58) {
        "mountains"
    } else if flatness < 58 {
        "hills"
    } else {
        "lowland"
    }
}

// Two opposed, steady moisture transports blended smoothly by latitude.
// These are climatological proxies, not forecasts or a fluid solver.
fn climate(
    elevation: &[f64],
    seed: u32,
    cols: usize,
    rows: usize,
) -> (Vec<f64>, Vec<f64>, AtmosphereBudget) {
    let texture = Simplex::new(seed ^ 0x745af);
    let mut rainfall = vec![0.0; elevation.len()];
    let mut shadow = vec![0.0; elevation.len()];
    let mut budget = AtmosphereBudget {
        evaporation_input: 0.0,
        precipitation: 0.0,
        boundary_export: 0.0,
    };
    for y in 0..rows {
        let ny = (y as f64 + 0.5) / rows as f64;
        let latitude = (ny - 0.5).abs() * 150.0;
        let westerly = smooth(latitude, 20.0, 40.0);
        let tropical = (-(latitude / 17.0).powi(2)).exp();
        let subtropical = (-((latitude - 28.0) / 10.0).powi(2)).exp();
        let temperate = (-((latitude - 50.0) / 15.0).powi(2)).exp();
        let capacity = 2800.0 * (0.65 + 0.4 * latitude.to_radians().cos());
        for (eastward, weight) in [(true, westerly), (false, 1.0 - westerly)] {
            if weight == 0.0 {
                continue;
            }
            let mut vapor = 0.0;
            let mut previous = 0.0;
            let mut barrier = 0.0f64;
            for step in 0..cols {
                let x = if eastward { step } else { cols - 1 - step };
                let id = y * cols + x;
                let h = elevation[id].max(0.0);
                if elevation[id] <= 0.0 {
                    let evaporated = (capacity - vapor).max(0.0) * 0.6;
                    vapor += evaporated;
                    budget.evaporation_input += evaporated * weight * 12.0;
                    barrier = 0.0;
                }
                let uplift = (h - previous).max(0.0);
                let regional = 1.0 + texture.get([x as f64 / cols as f64 * 3.0, ny * 2.0]) * 0.12;
                let condensation = ((0.022 + tropical * 0.055 - subtropical * 0.012
                    + temperate * 0.018
                    + uplift / 1000.0 * 0.5)
                    * regional)
                    .clamp(0.005, 0.85);
                let rain = vapor * condensation;
                vapor -= rain;
                rainfall[id] += rain * weight * 12.0;
                budget.precipitation += rain * weight * 12.0;
                if h > 0.0 && barrier > h + 350.0 {
                    shadow[id] += (1.0 - vapor / capacity).clamp(0.0, 1.0) * weight;
                }
                barrier = (barrier - 25.0).max(h);
                previous = h;
            }
            budget.boundary_export += vapor * weight * 12.0;
        }
    }
    (rainfall, shadow, budget)
}

impl Field {
    pub fn generate(seed: u64, land_ratio: f64) -> Self {
        let continental = Simplex::new(seed as u32);
        let detail = Simplex::new((seed >> 32) as u32 ^ 0x139a);
        let soil_noise = Simplex::new(seed as u32 ^ 0x751a);
        let mut raw = vec![0.0; COLS * ROWS];
        for (id, value) in raw.iter_mut().enumerate() {
            let (x, y) = (
                (id % COLS) as f64 / COLS as f64,
                (id / COLS) as f64 / ROWS as f64,
            );
            let wx = x + detail.get([x * 3.0, y * 2.0]) * 0.12;
            let wy = y + detail.get([x * 3.0 + 31.0, y * 2.0 + 31.0]) * 0.12;
            let rim = (x.min(1.0 - x).min(y.min(1.0 - y)) / 0.16).clamp(0.0, 1.0);
            *value = fbm(&continental, wx * 3.0, wy * 1.9, 4) * 0.8
                + fbm(&detail, x * 8.0, y * 5.0, 3) * 0.1
                - (1.0 - rim) * 0.32;
        }
        let mut sorted = raw.clone();
        sorted.sort_by(f64::total_cmp);
        let sea_index = ((1.0 - land_ratio) * raw.len() as f64).round() as usize;
        let sea = sorted[sea_index.min(sorted.len() - 2)];
        let low = sorted[0];
        let high = sorted[sorted.len() - 1];
        let elevation: Vec<f64> = raw
            .iter()
            .enumerate()
            .map(|(id, h)| {
                if *h <= sea {
                    return (-40.0 - (sea - h) / (sea - low).max(1e-9) * 4000.0).round();
                }
                let (x, y) = (
                    (id % COLS) as f64 / COLS as f64,
                    (id / COLS) as f64 / ROWS as f64,
                );
                let u = (h - sea) / (high - sea).max(1e-9);
                let ridge = 1.0 - detail.get([x * 6.0 + 7.0, y * 4.0 + 7.0]).abs();
                let rugged = 30.0 + u.powf(1.25) * 2600.0 + ridge.powi(5) * u * 1100.0;
                let plateau =
                    smooth(fbm(&soil_noise, x * 2.5, y * 1.6, 2), 0.05, 0.3) * smooth(u, 0.16, 0.4);
                (rugged * (1.0 - plateau)
                    + (1550.0 + detail.get([x * 0.8, y * 0.8]) * 60.0) * plateau)
                    .round()
            })
            .collect();
        let (rain, shadow, atmosphere_budget) = climate(&elevation, seed as u32, COLS, ROWS);
        let temperature: Vec<f64> = elevation
            .iter()
            .enumerate()
            .map(|(id, h)| {
                let latitude = (((id / COLS) as f64 + 0.5) / ROWS as f64 - 0.5).abs() * 150.0;
                31.0 - latitude * 0.6 - h.max(0.0) * 0.0058
            })
            .collect();
        let mut ocean_distance = vec![usize::MAX; elevation.len()];
        let mut queue = VecDeque::new();
        for (id, &h) in elevation.iter().enumerate() {
            if h <= 0.0 {
                ocean_distance[id] = 0;
                queue.push_back(id);
            }
        }
        while let Some(id) = queue.pop_front() {
            for next in cardinal(id) {
                if ocean_distance[next] == usize::MAX {
                    ocean_distance[next] = ocean_distance[id] + 1;
                    queue.push_back(next);
                }
            }
        }
        let flatness: Vec<u8> = (0..raw.len())
            .map(|id| local_flatness(&elevation, id, COLS, ROWS))
            .collect();
        let profiles: Vec<ClimateProfile> = (0..raw.len())
            .map(|id| {
                let latitude = (0.5 - ((id / COLS) as f64 + 0.5) / ROWS as f64) * 150.0;
                let continentality = 1.0 - (-(ocean_distance[id] as f64) / 18.0).exp();
                // Root-zone capacity is a bounded terrain proxy, not measured soil depth.
                let capacity = 80.0 + flatness[id] as f64 * 1.2;
                let mut profile = seasonal::normals(
                    temperature[id],
                    rain[id],
                    latitude,
                    continentality,
                    capacity,
                );
                if elevation[id] <= 0.0 {
                    // Marine samples provide atmospheric normals only. Do not
                    // invent terrestrial soil, crops or runoff over the ocean.
                    for month in &mut profile.months {
                        month.snowfall_mm = 0.0;
                        month.snowmelt_mm = 0.0;
                        month.evapotranspiration_mm = 0.0;
                        month.runoff_mm = 0.0;
                        month.recharge_mm = 0.0;
                        month.soil_water_mm = 0.0;
                    }
                    profile.growing_months = 0.0;
                    profile.rainfed_months = 0.0;
                    profile.snow_storage_change_mm = 0.0;
                    profile.soil_storage_change_mm = 0.0;
                }
                profile
            })
            .collect();
        let pet: Vec<f64> = profiles.iter().map(ClimateProfile::pet).collect();
        let water: Vec<_> = profiles.iter().map(ClimateProfile::water).collect();
        let drainage = hydrology::drain(&elevation, &water, &pet, COLS, ROWS);
        let mut samples = Vec::with_capacity(raw.len());
        for id in 0..raw.len() {
            let h = elevation[id];
            let temp = temperature[id];
            let aridity = rain[id] / pet[id];
            let thermal = if temp < 6.0 {
                "cold"
            } else if temp < 20.0 {
                "temperate"
            } else {
                "warm"
            };
            let moisture = if aridity < 0.2 {
                "arid"
            } else if aridity < 0.5 {
                "semi_arid"
            } else if aridity < 1.0 {
                "subhumid"
            } else {
                "humid"
            };
            let flatness = flatness[id];
            let form = landform(h, flatness);
            let vegetation = if profiles[id].warmest() < 8.0 {
                "alpine"
            } else if aridity > 0.95 {
                "forest"
            } else if aridity > 0.65 {
                "woodland"
            } else if aridity > 0.23 {
                "grassland"
            } else {
                "bare"
            };
            let (x, y) = (
                (id % COLS) as f64 / COLS as f64,
                (id / COLS) as f64 / ROWS as f64,
            );
            let river_nearness = 1.0 - (drainage.river_distance[id].min(4) as f64 / 4.0);
            let parent = 0.5 + fbm(&soil_noise, x * 3.0, y * 2.0, 3) * 0.3;
            let organic = aridity.min(1.3) / 1.3 * 0.13;
            let erosion = (1.0 - flatness as f64 / 100.0) * 0.28;
            let soil = index(
                parent + organic - erosion + river_nearness * flatness as f64 / 100.0 * 0.16
                    - (rain[id] / 3500.0).clamp(0.0, 1.0) * 0.08,
            );
            let slope_factor = (flatness as f64 / 75.0).clamp(0.0, 1.0);
            let (rainfed, irrigable) = profiles[id].crop_opportunity();
            let agriculture = index(soil as f64 / 100.0 * slope_factor * rainfed);
            let irrigation = index(river_nearness * irrigable * slope_factor * soil as f64 / 100.0);
            let terrain = if h <= 0.0 {
                if h > -650.0 {
                    Terrain::ShallowSea
                } else {
                    Terrain::DeepOcean
                }
            } else if drainage.lake_mask[id] {
                Terrain::Lake
            } else if profiles[id].warmest() <= 0.0 {
                Terrain::Snow
            } else if profiles[id].warmest() < 8.0 {
                Terrain::Tundra
            } else if aridity < 0.2 {
                Terrain::Desert
            } else if form == "mountains" {
                Terrain::Mountains
            } else if form == "plateau" {
                Terrain::Plateau
            } else if vegetation == "forest" || vegetation == "woodland" {
                Terrain::Forest
            } else if form == "hills" {
                Terrain::Hills
            } else if vegetation == "grassland" {
                Terrain::Grassland
            } else {
                Terrain::Plains
            };
            samples.push(Sample {
                elevation: h,
                rain: rain[id],
                temperature: temp,
                climate: profiles[id].clone(),
                pet: pet[id],
                flatness,
                soil,
                agriculture,
                irrigation,
                arable: h > 0.0
                    && !drainage.lake_mask[id]
                    && profiles[id].growing_months >= 3.0
                    && flatness > 35
                    && soil >= 30
                    && (agriculture >= 25 || irrigation >= 15),
                coastal: h > 0.0 && cardinal(id).any(|n| elevation[n] <= 0.0),
                shadow: shadow[id],
                terrain,
                landform: form,
                thermal,
                moisture,
                vegetation,
            });
        }
        Self {
            seed,
            samples,
            drainage,
            atmosphere_budget,
        }
    }

    pub fn assign_cells(&self, cells: &mut [Cell]) {
        #[derive(Default)]
        struct Aggregate {
            total: usize,
            land: usize,
            lakes: usize,
            coastal: bool,
            elevation: f64,
            rain: f64,
            temp: f64,
            flatness: f64,
            soil: f64,
            agriculture: f64,
            irrigation: f64,
            arable: usize,
            river: usize,
            aridity: f64,
            shadow: f64,
            climate: ClimateProfile,
            terrain: BTreeMap<usize, usize>,
            form: BTreeMap<&'static str, usize>,
            thermal: BTreeMap<&'static str, usize>,
            moisture: BTreeMap<&'static str, usize>,
            vegetation: BTreeMap<&'static str, usize>,
        }
        let mut aggregates: Vec<Aggregate> =
            (0..cells.len()).map(|_| Aggregate::default()).collect();
        let mut owners = vec![0; self.samples.len()];
        let mut nearest = 0;
        let distance =
            |cell: &Cell, p: Point| (cell.site.x - p.x).powi(2) + (cell.site.y - p.y).powi(2);
        for (id, owner) in owners.iter_mut().enumerate() {
            let p = Point {
                x: (id % COLS) as f64 * DX + DX / 2.0,
                y: (id / COLS) as f64 * DY + DY / 2.0,
            };
            loop {
                let mut next = nearest;
                let mut best = distance(&cells[nearest], p);
                for &neighbor in &cells[nearest].neighbors {
                    let d = distance(&cells[neighbor], p);
                    if d < best - 1e-9 {
                        best = d;
                        next = neighbor;
                    }
                }
                if next == nearest {
                    break;
                }
                nearest = next;
            }
            *owner = nearest;
        }
        for (id, &owner) in owners.iter().enumerate() {
            let s = &self.samples[id];
            let a = &mut aggregates[owner];
            a.total += 1;
            a.elevation += s.elevation;
            if s.elevation <= 0.0 {
                continue;
            }
            a.land += 1;
            a.lakes += usize::from(self.drainage.lake_mask[id]);
            a.coastal |= s.coastal;
            a.rain += s.rain;
            a.temp += s.temperature;
            a.climate.add(&s.climate);
            a.flatness += s.flatness as f64;
            if !self.drainage.lake_mask[id] {
                a.soil += s.soil as f64;
                a.agriculture += s.agriculture as f64;
                a.irrigation += s.irrigation as f64;
                a.arable += usize::from(s.arable);
            }
            a.river += usize::from(self.drainage.river_distance[id] <= 2);
            a.aridity += s.rain / s.pet;
            a.shadow += s.shadow;
            *a.terrain.entry(terrain_id(s.terrain)).or_default() += 1;
            *a.form.entry(s.landform).or_default() += 1;
            *a.thermal.entry(s.thermal).or_default() += 1;
            *a.moisture.entry(s.moisture).or_default() += 1;
            *a.vegetation.entry(s.vegetation).or_default() += 1;
        }
        let geology = Simplex::new(self.seed as u32 ^ 0x9f44);
        for (cell, a) in cells.iter_mut().zip(aggregates.iter_mut()) {
            // Very tiny unrelaxed cells can contain no raster centre. A single
            // centroid sample is a bounded fallback, not a different world field.
            if a.total == 0 {
                let x = ((cell.centroid.x / DX) as usize).min(COLS - 1);
                let y = ((cell.centroid.y / DY) as usize).min(ROWS - 1);
                let s = &self.samples[y * COLS + x];
                a.total = 1;
                a.elevation = s.elevation;
                if s.elevation > 0.0 {
                    a.land = 1;
                    a.rain = s.rain;
                    a.temp = s.temperature;
                    a.climate = s.climate.clone();
                    a.flatness = s.flatness as f64;
                    a.soil = s.soil as f64;
                    a.agriculture = s.agriculture as f64;
                    a.irrigation = s.irrigation as f64;
                    a.aridity = s.rain / s.pet;
                    a.coastal = s.coastal;
                    a.arable = usize::from(s.arable);
                    a.lakes = usize::from(self.drainage.lake_mask[y * COLS + x]);
                    if a.lakes > 0 {
                        a.soil = 0.0;
                        a.agriculture = 0.0;
                        a.irrigation = 0.0;
                        a.arable = 0;
                    }
                    a.terrain.insert(terrain_id(s.terrain), 1);
                    a.form.insert(s.landform, 1);
                    a.thermal.insert(s.thermal, 1);
                    a.moisture.insert(s.moisture, 1);
                    a.vegetation.insert(s.vegetation, 1);
                }
            }
            cell.land_fraction = a.land as f64 / a.total as f64;
            cell.lake_fraction = a.lakes as f64 / a.total as f64;
            cell.is_land = cell.land_fraction >= 0.5;
            cell.is_coastal = a.coastal || (a.land > 0 && a.land < a.total);
            cell.elevation_m = (a.elevation / a.total as f64).round() as i32;
            if a.land == 0 {
                cell.terrain = if cell.elevation_m > -650 {
                    Terrain::ShallowSea
                } else {
                    Terrain::DeepOcean
                };
                let x = (cell.centroid.x / DX) as usize;
                let y = (cell.centroid.y / DY) as usize;
                let s = &self.samples[y.min(ROWS - 1) * COLS + x.min(COLS - 1)];
                cell.temperature_c = (s.temperature * 10.0).round() / 10.0;
                cell.rainfall_mm = s.rain.round() as u32;
                cell.climate = s.climate.clone();
                continue;
            }
            let count = a.land as f64;
            let mode = |m: &BTreeMap<&'static str, usize>| {
                *m.iter().max_by_key(|&(k, n)| (*n, *k)).unwrap().0
            };
            cell.terrain = if !cell.is_land {
                if cell.elevation_m > -650 {
                    Terrain::ShallowSea
                } else {
                    Terrain::DeepOcean
                }
            } else {
                terrain_from_id(*a.terrain.iter().max_by_key(|&(k, n)| (*n, *k)).unwrap().0)
            };
            cell.landform = mode(&a.form);
            cell.thermal_zone = mode(&a.thermal);
            cell.moisture_zone = mode(&a.moisture);
            cell.vegetation = mode(&a.vegetation);
            cell.rainfall_mm = (a.rain / count).round() as u32;
            cell.temperature_c = (a.temp / count * 10.0).round() / 10.0;
            cell.climate = a.climate.clone();
            cell.climate.average(count);
            cell.flatness = (a.flatness / count).round() as u8;
            cell.soil_quality = (a.soil / count).round() as u8;
            cell.agricultural_suitability = (a.agriculture / count).round() as u8;
            cell.irrigation_potential = (a.irrigation / count).round() as u8;
            cell.arable_fraction = a.arable as f64 / a.total as f64;
            cell.river_access = index(a.river as f64 / count);
            cell.aridity_index = (a.aridity / count * 1000.0).round() / 1000.0;
            if cell.is_coastal && cell.rainfall_mm > 900 {
                cell.causes.push("coastal_moisture");
            }
            if a.shadow / count > 0.25 && cell.aridity_index < 0.6 {
                cell.causes.push("rain_shadow");
            }
            if cell.aridity_index < 0.5 {
                cell.causes.push("water_deficit");
            }
            if cell.river_access > 10 {
                cell.causes.push("river_water");
            }
            if cell.irrigation_potential >= 8 {
                cell.causes.push("irrigation_opportunity");
            }
            if cell.landform == "plateau" {
                cell.causes.push("flat_plateau");
            }
            if cell.climate.growing_months < 4.0 {
                cell.causes.push("cold_limit");
            }
            if cell
                .climate
                .months
                .iter()
                .map(|m| m.snowmelt_mm)
                .sum::<f64>()
                > 50.0
            {
                cell.causes.push("snowmelt_supply");
            }
            if cell.climate.growing_months - cell.climate.rainfed_months >= 2.0 {
                cell.causes.push("seasonal_drought");
            }
            if cell.flatness < 30 {
                cell.causes.push("steep_limit");
            }
            if cell.causes.is_empty() {
                cell.causes.push("regional_climate");
            }
            let (x, y) = (cell.centroid.x / WIDTH, cell.centroid.y / HEIGHT);
            let ore = |offset: f64, threshold: f64| {
                ((fbm(&geology, x * 7.0 + offset, y * 4.5 + offset, 2) + 1.0) / 2.0 - threshold)
                    .max(0.0)
                    / (1.0 - threshold)
            };
            let fraction = cell.land_fraction;
            let agriculture = cell.agricultural_suitability as f64 / 100.0;
            let water = (cell.aridity_index / 1.2).min(1.0);
            let resource = |kind, v| Resource {
                kind,
                potential: index(v * fraction),
            };
            cell.resources = vec![
                resource("grain", agriculture),
                resource("livestock", water * (cell.flatness as f64 / 100.0) * 0.75),
                resource(
                    "fiber",
                    agriculture * (cell.temperature_c / 22.0).clamp(0.0, 1.0),
                ),
                resource(
                    "timber",
                    water
                        * if cell.vegetation == "forest" {
                            0.85
                        } else {
                            0.35
                        },
                ),
                resource("stone", 0.2 + (1.0 - cell.flatness as f64 / 100.0) * 0.7),
                resource("coal", ore(0.0, 0.52)),
                resource("iron", ore(19.4, 0.5)),
                resource("oil", ore(41.7, 0.59)),
                resource("rare_earth", ore(73.1, 0.64)),
                resource(
                    "freshwater",
                    (water * 0.6 + cell.river_access as f64 / 100.0 * 0.65).min(1.0),
                ),
            ];
        }
    }

    fn bands(&self, kind: &'static str, values: &[u8]) -> SurfaceLayer {
        let mut paths: BTreeMap<u8, String> = BTreeMap::new();
        for y in 0..ROWS {
            let mut x = 0;
            while x < COLS {
                let value = values[y * COLS + x];
                let mut end = x + 1;
                while end < COLS && values[y * COLS + end] == value {
                    end += 1;
                }
                let path = paths.entry(value).or_default();
                write!(
                    path,
                    "M{} {}h{}v{}h-{}z",
                    x as f64 * DX,
                    y as f64 * DY,
                    (end - x) as f64 * DX,
                    DY,
                    (end - x) as f64 * DX
                )
                .unwrap();
                x = end;
            }
        }
        SurfaceLayer {
            kind,
            bands: paths
                .into_iter()
                .map(|(value, path)| SurfaceBand { value, path })
                .collect(),
        }
    }

    pub fn export(&self) -> Environment {
        let terrain: Vec<u8> = self
            .samples
            .iter()
            .map(|s| terrain_id(s.terrain) as u8)
            .collect();
        let scalar = |f: fn(&Sample) -> f64| {
            self.samples
                .iter()
                .map(|s| {
                    if s.elevation <= 0.0 {
                        0
                    } else {
                        1 + (f(s).clamp(0.0, 1.0) * 15.0).round() as u8
                    }
                })
                .collect::<Vec<_>>()
        };
        let elevation = self
            .samples
            .iter()
            .map(|s| {
                ((s.elevation + 4040.0) / 8000.0 * 31.0)
                    .clamp(0.0, 31.0)
                    .round() as u8
            })
            .collect::<Vec<_>>();
        let rainfall = scalar(|s| s.rain / 2400.0);
        let soil = scalar(|s| s.soil as f64 / 100.0);
        let agriculture = scalar(|s| s.agriculture as f64 / 100.0);
        let water = scalar(|s| (s.rain / s.pet / 1.5).min(1.0));
        let layers = vec![
            self.bands("terrain", &terrain),
            self.bands("elevation", &elevation),
            self.bands("rainfall", &rainfall),
            self.bands("soil", &soil),
            self.bands("agriculture", &agriculture),
            self.bands("water", &water),
        ];
        let mut coast_path = String::new();
        for (id, s) in self.samples.iter().enumerate() {
            if s.elevation <= 0.0 {
                continue;
            }
            let x = (id % COLS) as f64 * DX;
            let y = (id / COLS) as f64 * DY;
            if id % COLS > 0 && self.samples[id - 1].elevation <= 0.0 {
                write!(coast_path, "M{x} {y}v{DY}").unwrap();
            }
            if id % COLS + 1 < COLS && self.samples[id + 1].elevation <= 0.0 {
                write!(coast_path, "M{} {y}v{DY}", x + DX).unwrap();
            }
            if id / COLS > 0 && self.samples[id - COLS].elevation <= 0.0 {
                write!(coast_path, "M{x} {y}h{DX}").unwrap();
            }
            if id / COLS + 1 < ROWS && self.samples[id + COLS].elevation <= 0.0 {
                write!(coast_path, "M{x} {}h{DX}", y + DY).unwrap();
            }
        }
        let mut seen = vec![false; self.samples.len()];
        let mut landmasses = 0;
        for id in 0..seen.len() {
            if seen[id] || self.samples[id].elevation <= 0.0 {
                continue;
            }
            landmasses += 1;
            seen[id] = true;
            let mut queue = VecDeque::from([id]);
            while let Some(i) = queue.pop_front() {
                for next in cardinal(i) {
                    if !seen[next] && self.samples[next].elevation > 0.0 {
                        seen[next] = true;
                        queue.push_back(next);
                    }
                }
            }
        }
        let mut fingerprint = 0xcbf29ce484222325u64;
        for s in &self.samples {
            for v in [
                s.elevation.round() as i64,
                s.rain.round() as i64,
                (s.temperature * 10.0).round() as i64,
                (s.climate.growing_months * 10.0).round() as i64,
                s.climate.water().runoff.round() as i64,
            ] {
                for b in v.to_le_bytes() {
                    fingerprint = (fingerprint ^ u64::from(b)).wrapping_mul(0x100000001b3);
                }
            }
        }
        let mut lakes = vec![];
        for group in &self.drainage.lake_groups {
            let mut path = String::new();
            for &id in group {
                write!(
                    path,
                    "M{} {}h{DX}v{DY}h-{DX}z",
                    (id % COLS) as f64 * DX,
                    (id / COLS) as f64 * DY
                )
                .unwrap();
            }
            lakes.push(Lake {
                id: lakes.len(),
                path,
                area_fraction: group.len() as f64 / self.samples.len() as f64,
                spill_elevation_m: self.drainage.filled[group[0]].round() as i32,
            });
        }
        let land: Vec<_> = self.samples.iter().filter(|s| s.elevation > 0.0).collect();
        Environment {
            terrain_palette: (0..=11).map(terrain_from_id).collect(),
            columns: COLS,
            rows: ROWS,
            fingerprint: format!("{fingerprint:016x}"),
            latitude_range: [-75.0, 75.0],
            land_ratio: land.len() as f64 / self.samples.len() as f64,
            landmasses,
            mean_land_elevation_m: (land.iter().map(|s| s.elevation).sum::<f64>()
                / land.len() as f64)
                .round() as i32,
            mean_land_rainfall_mm: (land.iter().map(|s| s.rain).sum::<f64>() / land.len() as f64)
                .round() as u32,
            layers,
            coast_path,
            rivers: self.drainage.rivers(COLS, DX, DY),
            lakes,
            atmosphere_budget: self.atmosphere_budget.clone(),
            water_budget: self.drainage.budget.clone(),
        }
    }
}

fn terrain_id(t: Terrain) -> usize {
    match t {
        Terrain::DeepOcean => 0,
        Terrain::ShallowSea => 1,
        Terrain::Plains => 2,
        Terrain::Grassland => 3,
        Terrain::Forest => 4,
        Terrain::Desert => 5,
        Terrain::Hills => 6,
        Terrain::Mountains => 7,
        Terrain::Snow => 8,
        Terrain::Plateau => 9,
        Terrain::Lake => 10,
        Terrain::Tundra => 11,
    }
}
fn terrain_from_id(id: usize) -> Terrain {
    [
        Terrain::DeepOcean,
        Terrain::ShallowSea,
        Terrain::Plains,
        Terrain::Grassland,
        Terrain::Forest,
        Terrain::Desert,
        Terrain::Hills,
        Terrain::Mountains,
        Terrain::Snow,
        Terrain::Plateau,
        Terrain::Lake,
        Terrain::Tundra,
    ][id]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn high_plateau_is_flat_and_low_hills_are_not() {
        let plateau = vec![2300.0; 25];
        assert_eq!(local_flatness(&plateau, 12, 5, 5), 100);
        assert_eq!(landform(2300.0, 100), "plateau");
        let mut hills = vec![50.0; 25];
        hills[12] = 950.0;
        assert!(local_flatness(&hills, 12, 5, 5) < 30);
    }

    #[test]
    fn moisture_budget_balances_and_mountain_has_directional_rain_shadow() {
        let (cols, rows) = (96, 60);
        let mut elevation = vec![-100.0; cols * rows];
        for y in 0..rows {
            for x in 12..94 {
                elevation[y * cols + x] = if (35..40).contains(&x) { 2500.0 } else { 100.0 };
            }
        }
        let (rain, _, budget) = climate(&elevation, 123, cols, rows);
        let y = 10; // Mid-latitude, predominantly westerly transport.
        assert!(rain[y * cols + 35] > rain[y * cols + 45]);
        assert!(
            (budget.evaporation_input - budget.precipitation - budget.boundary_export).abs()
                < budget.evaporation_input * 1e-10
        );
    }
}
