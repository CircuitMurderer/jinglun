//! Deterministic world generation, independent of HTTP, storage and the UI.
use noise::{NoiseFn, Simplex};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use voronoice::{BoundingBox, Point as VPoint, Voronoi, VoronoiBuilder};

mod environment;
mod hydrology;
pub use environment::Environment;

pub const GENERATOR_VERSION: &str = "0.2.1";
pub const WIDTH: f64 = 1600.0;
pub const HEIGHT: f64 = 1000.0;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(default, deny_unknown_fields)]
pub struct MapConfig {
    pub seed: String,
    pub cell_count: usize,
    pub relaxations: usize,
    pub land_ratio: f64,
}

impl Default for MapConfig {
    fn default() -> Self {
        Self {
            seed: "经纶·山河初定".into(),
            cell_count: 500,
            relaxations: 2,
            land_ratio: 0.45,
        }
    }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct GenerationError {
    pub code: &'static str,
    pub params: BTreeMap<&'static str, usize>,
}

impl GenerationError {
    fn new(code: &'static str) -> Self {
        Self {
            code,
            params: BTreeMap::new(),
        }
    }
    fn range(code: &'static str, min: usize, max: usize) -> Self {
        Self {
            code,
            params: BTreeMap::from([("min", min), ("max", max)]),
        }
    }
}

impl MapConfig {
    pub fn validate(&self) -> Result<(), GenerationError> {
        if self.seed.trim().is_empty() || self.seed.chars().count() > 64 {
            return Err(GenerationError::range("error.seed", 1, 64));
        }
        if !(100..=2000).contains(&self.cell_count) {
            return Err(GenerationError::range("error.cell_count", 100, 2000));
        }
        if self.relaxations > 3 {
            return Err(GenerationError::range("error.relaxations", 0, 3));
        }
        if !self.land_ratio.is_finite() || !(0.2..=0.8).contains(&self.land_ratio) {
            return Err(GenerationError::range("error.land_ratio", 20, 80));
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Terrain {
    DeepOcean,
    ShallowSea,
    Plains,
    Grassland,
    Forest,
    Desert,
    Hills,
    Mountains,
    Snow,
    Plateau,
    Lake,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Resource {
    pub kind: &'static str,
    pub potential: u8,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Cell {
    pub id: usize,
    pub site: Point,
    pub centroid: Point,
    pub polygon: Vec<Point>,
    pub area: f64,
    pub neighbors: Vec<usize>,
    pub is_land: bool,
    pub is_coastal: bool,
    pub terrain: Terrain,
    pub elevation_m: i32,
    pub rainfall_mm: u32,
    pub temperature_c: f64,
    pub land_fraction: f64,
    pub lake_fraction: f64,
    pub landform: &'static str,
    pub thermal_zone: &'static str,
    pub moisture_zone: &'static str,
    pub vegetation: &'static str,
    pub soil_quality: u8,
    pub agricultural_suitability: u8,
    pub arable_fraction: f64,
    pub irrigation_potential: u8,
    pub river_access: u8,
    pub aridity_index: f64,
    pub causes: Vec<&'static str>,
    pub flatness: u8,
    pub resources: Vec<Resource>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Edge {
    pub id: usize,
    pub a: usize,
    pub b: usize,
    pub start: Point,
    pub end: Point,
    pub length: f64,
    pub kind: &'static str,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct MapStats {
    pub land_cells: usize,
    pub sea_cells: usize,
    pub land_ratio: f64,
    pub landmasses: usize,
    pub coastal_cells: usize,
    pub mountain_cells: usize,
    pub mean_land_elevation_m: i32,
    pub mean_land_rainfall_mm: u32,
    pub river_segments: usize,
    pub lakes: usize,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct WorldMap {
    pub generator_version: &'static str,
    pub config: MapConfig,
    pub width: f64,
    pub height: f64,
    pub cells: Vec<Cell>,
    pub edges: Vec<Edge>,
    pub stats: MapStats,
    pub environment: Environment,
}

// An explicit PRNG and UTF-8 seed hash make results independent of system time
// and of randomized HashMap iteration. This is procedural randomness, not crypto.
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e3779b97f4a7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111eb);
        z ^ (z >> 31)
    }
    fn unit(&mut self) -> f64 {
        ((self.next() >> 11) as f64) / ((1u64 << 53) as f64)
    }
}

fn hash_seed(seed: &str) -> u64 {
    seed.as_bytes().iter().fold(0xcbf29ce484222325, |h, b| {
        (h ^ u64::from(*b)).wrapping_mul(0x100000001b3)
    })
}

fn diagram(sites: Vec<VPoint>) -> Result<Voronoi, GenerationError> {
    VoronoiBuilder::default()
        .set_sites(sites)
        .set_bounding_box(BoundingBox::new(
            VPoint {
                x: WIDTH / 2.0,
                y: HEIGHT / 2.0,
            },
            WIDTH,
            HEIGHT,
        ))
        .build()
        .ok_or_else(|| GenerationError::new("error.geometry"))
}

fn measure(polygon: &[Point]) -> (f64, Point) {
    let (mut cross_sum, mut cx, mut cy) = (0.0, 0.0, 0.0);
    for i in 0..polygon.len() {
        let a = polygon[i];
        let b = polygon[(i + 1) % polygon.len()];
        let cross = a.x * b.y - b.x * a.y;
        cross_sum += cross;
        cx += (a.x + b.x) * cross;
        cy += (a.y + b.y) * cross;
    }
    let centroid = Point {
        x: cx / (3.0 * cross_sum),
        y: cy / (3.0 * cross_sum),
    };
    (cross_sum.abs() / 2.0, centroid)
}

fn fbm(noise: &Simplex, x: f64, y: f64, octaves: usize) -> f64 {
    let (mut result, mut weight, mut frequency, mut total) = (0.0, 1.0, 1.0, 0.0);
    for _ in 0..octaves {
        result += noise.get([x * frequency, y * frequency]) * weight;
        total += weight;
        weight *= 0.5;
        frequency *= 2.0;
    }
    result / total
}

fn index(v: f64) -> u8 {
    (v.clamp(0.0, 1.0) * 100.0).round() as u8
}

pub fn generate(config: MapConfig) -> Result<WorldMap, GenerationError> {
    config.validate()?;
    let seed = hash_seed(&config.seed);
    let mut rng = Rng(seed);
    let sites = (0..config.cell_count)
        .map(|_| VPoint {
            x: 0.001 + rng.unit() * (WIDTH - 0.002),
            y: 0.001 + rng.unit() * (HEIGHT - 0.002),
        })
        .collect();
    let mut voronoi = diagram(sites)?;
    // Lloyd uses polygon area centroids, rather than the average of vertices.
    for _ in 0..config.relaxations {
        let sites = voronoi
            .iter_cells()
            .map(|cell| {
                let polygon = cell
                    .iter_vertices()
                    .map(|p| Point { x: p.x, y: p.y })
                    .collect::<Vec<_>>();
                let (_, centroid) = measure(&polygon);
                VPoint {
                    x: centroid.x,
                    y: centroid.y,
                }
            })
            .collect();
        voronoi = diagram(sites)?;
    }

    let mut cells: Vec<Cell> = voronoi
        .iter_cells()
        .map(|cell| {
            let polygon = cell
                .iter_vertices()
                .map(|p| Point { x: p.x, y: p.y })
                .collect::<Vec<_>>();
            let (area, centroid) = measure(&polygon);
            Cell {
                id: cell.site(),
                site: Point {
                    x: cell.site_position().x,
                    y: cell.site_position().y,
                },
                centroid,
                polygon,
                area,
                neighbors: vec![],
                is_land: false,
                is_coastal: false,
                terrain: Terrain::DeepOcean,
                elevation_m: 0,
                rainfall_mm: 0,
                temperature_c: 0.0,
                land_fraction: 0.0,
                lake_fraction: 0.0,
                landform: "ocean",
                thermal_zone: "temperate",
                moisture_zone: "humid",
                vegetation: "bare",
                soil_quality: 0,
                agricultural_suitability: 0,
                arable_fraction: 0.0,
                irrigation_potential: 0,
                river_access: 0,
                aridity_index: 0.0,
                causes: vec![],
                flatness: 0,
                resources: vec![],
            }
        })
        .collect();

    // Shared geometric edges are the source of truth for adjacency. Point-only
    // contact does not create a neighbor, road, trade route or crossing permission.
    let mut shared: BTreeMap<(usize, usize), Vec<usize>> = BTreeMap::new();
    for (id, vertices) in voronoi.cells().iter().enumerate() {
        for i in 0..vertices.len() {
            let a = vertices[i];
            let b = vertices[(i + 1) % vertices.len()];
            shared.entry((a.min(b), a.max(b))).or_default().push(id);
        }
    }
    let vertices = voronoi.vertices();
    let mut edges = vec![];
    for ((v1, v2), owners) in shared {
        if owners.len() != 2 {
            continue;
        }
        let (a, b) = (owners[0], owners[1]);
        let start = Point {
            x: vertices[v1].x,
            y: vertices[v1].y,
        };
        let end = Point {
            x: vertices[v2].x,
            y: vertices[v2].y,
        };
        let length = (start.x - end.x).hypot(start.y - end.y);
        if length < 1e-8 {
            continue;
        }
        cells[a].neighbors.push(b);
        cells[b].neighbors.push(a);
        edges.push(Edge {
            id: edges.len(),
            a,
            b,
            start,
            end,
            length,
            kind: "sea",
        });
    }
    for cell in &mut cells {
        cell.neighbors.sort_unstable();
    }

    let field = environment::Field::generate(seed, config.land_ratio);
    field.assign_cells(&mut cells);
    for edge in &mut edges {
        edge.kind = match (cells[edge.a].is_land, cells[edge.b].is_land) {
            (true, true) => "land",
            (false, false) => "sea",
            _ => "coast",
        };
    }
    let environment = field.export();

    let land_cells = cells.iter().filter(|c| c.is_land).count();
    let stats = MapStats {
        land_cells,
        sea_cells: cells.len() - land_cells,
        land_ratio: environment.land_ratio,
        landmasses: environment.landmasses,
        coastal_cells: cells.iter().filter(|c| c.is_land && c.is_coastal).count(),
        mountain_cells: cells
            .iter()
            .filter(|c| c.is_land && c.landform == "mountains")
            .count(),
        river_segments: environment.rivers.len(),
        lakes: environment.lakes.len(),
        mean_land_elevation_m: environment.mean_land_elevation_m,
        mean_land_rainfall_mm: environment.mean_land_rainfall_mm,
    };
    Ok(WorldMap {
        generator_version: GENERATOR_VERSION,
        config,
        width: WIDTH,
        height: HEIGHT,
        cells,
        edges,
        stats,
        environment,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replay_is_deterministic_and_seed_changes_world() {
        let first = generate(MapConfig::default()).unwrap();
        assert_eq!(first, generate(MapConfig::default()).unwrap());
        let other = generate(MapConfig {
            seed: "另一片山河".into(),
            ..MapConfig::default()
        })
        .unwrap();
        assert_ne!(first.cells[0].polygon, other.cells[0].polygon);
    }

    #[test]
    fn tessellation_density_does_not_change_the_natural_world() {
        let a = generate(MapConfig::default()).unwrap();
        let b = generate(MapConfig {
            cell_count: 1000,
            relaxations: 0,
            ..MapConfig::default()
        })
        .unwrap();
        assert_eq!(a.environment, b.environment);
        assert_eq!(a.stats.land_ratio, b.stats.land_ratio);
        assert_ne!(a.cells.len(), b.cells.len());
        assert!(
            a.cells
                .iter()
                .any(|c| c.land_fraction > 0.0 && c.land_fraction < 1.0)
        );
        let w = &a.environment.water_budget;
        assert!(
            (w.generated_runoff - w.lake_evaporation - w.ocean_outflow - w.boundary_outflow).abs()
                < w.generated_runoff.max(1.0) * 1e-10
        );
        assert!(
            (a.stats.land_ratio - a.config.land_ratio).abs()
                <= 2.0 / (a.environment.rows * a.environment.columns) as f64
        );
        for cell in &a.cells {
            assert!(cell.lake_fraction <= cell.land_fraction);
            assert!(cell.arable_fraction <= cell.land_fraction);
            assert!(cell.aridity_index.is_finite());
        }
        for surface in &a.environment.layers {
            for band in &surface.bands {
                assert!(!band.path.is_empty());
                if surface.kind == "terrain" {
                    assert!((band.value as usize) < a.environment.terrain_palette.len());
                }
            }
        }
    }

    #[test]
    fn polygons_tile_rectangle_and_graph_matches_shared_borders() {
        for seed in ["经纶·山河初定", "边界测试", "0", "海陆交错"] {
            let map = generate(MapConfig {
                seed: seed.into(),
                ..MapConfig::default()
            })
            .unwrap();
            assert_eq!(map.cells.len(), 500);
            let total_area: f64 = map.cells.iter().map(|c| c.area).sum();
            assert!(
                (total_area - WIDTH * HEIGHT).abs() < 1e-4,
                "area {total_area}"
            );
            for cell in &map.cells {
                assert!(cell.area > 0.0 && cell.centroid.x.is_finite());
                assert!(cell.polygon.len() >= 3);
                for p in &cell.polygon {
                    assert!(p.x >= -1e-6 && p.x <= WIDTH + 1e-6);
                    assert!(p.y >= -1e-6 && p.y <= HEIGHT + 1e-6);
                }
                for &neighbor in &cell.neighbors {
                    assert_ne!(cell.id, neighbor);
                    assert!(map.cells[neighbor].neighbors.contains(&cell.id));
                    assert!(map.edges.iter().any(|e| (e.a == cell.id && e.b == neighbor)
                        || (e.b == cell.id && e.a == neighbor)));
                }
            }
            let mut seen = vec![false; 500];
            let mut stack = vec![0];
            while let Some(id) = stack.pop() {
                if seen[id] {
                    continue;
                }
                seen[id] = true;
                stack.extend(&map.cells[id].neighbors);
            }
            assert!(seen.iter().all(|v| *v));
            let largest = map.cells.iter().map(|c| c.area).fold(0.0, f64::max) / (WIDTH * HEIGHT);
            assert!((map.stats.land_ratio - map.config.land_ratio).abs() <= largest + 1e-8);
            for edge in &map.edges {
                assert!(edge.length > 0.0);
                assert_eq!(
                    edge.kind == "coast",
                    map.cells[edge.a].is_land != map.cells[edge.b].is_land
                );
            }
        }
    }

    #[test]
    fn climate_resources_and_parameter_boundaries_are_valid() {
        for (count, relax, ratio) in [(100, 0, 0.2), (500, 1, 0.45), (2000, 3, 0.8)] {
            let map = generate(MapConfig {
                cell_count: count,
                relaxations: relax,
                land_ratio: ratio,
                ..MapConfig::default()
            })
            .unwrap();
            assert!(map.stats.land_cells > 0 && map.stats.sea_cells > 0);
            for cell in &map.cells {
                assert!(cell.temperature_c.is_finite());
                assert!(cell.rainfall_mm <= 20000);
                assert_eq!(
                    cell.resources.len(),
                    if cell.land_fraction > 0.0 { 10 } else { 0 }
                );
                assert!(cell.resources.iter().all(|r| r.potential <= 100));
                assert_eq!(cell.is_land, cell.land_fraction >= 0.5);
                assert_eq!(
                    matches!(cell.terrain, Terrain::DeepOcean | Terrain::ShallowSea),
                    !cell.is_land,
                    "dominant terrain must agree with the cell's land/sea classification"
                );
                assert!(cell.soil_quality <= 100 && cell.agricultural_suitability <= 100);
            }
            serde_json::to_string(&map).unwrap();
        }
        for invalid in [
            MapConfig {
                cell_count: 99,
                ..MapConfig::default()
            },
            MapConfig {
                cell_count: 2001,
                ..MapConfig::default()
            },
            MapConfig {
                relaxations: 4,
                ..MapConfig::default()
            },
            MapConfig {
                seed: " ".into(),
                ..MapConfig::default()
            },
            MapConfig {
                land_ratio: f64::NAN,
                ..MapConfig::default()
            },
        ] {
            assert!(generate(invalid).is_err());
        }
    }
}
