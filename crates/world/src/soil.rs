//! A bounded reference interval of soil detachment and conservative routing.
//! It changes soil properties, never silently reshapes the drainage DEM.
use crate::{geology::Rock, hydrology::Drainage, index};
use serde::Serialize;
use std::collections::VecDeque;

const YEARS: f64 = 200.0;

#[derive(Clone, Debug, Default, Serialize, PartialEq)]
pub struct Soil {
    pub depth_cm: f64,
    pub sand_fraction: f64,
    pub organic_percent: f64,
    pub erosion_mm_year: f64,
    pub deposition_mm_year: f64,
    pub water_capacity_mm: f64,
    pub quality: u8,
}

#[derive(Clone, Debug, Default, Serialize, PartialEq)]
pub struct SedimentBudget {
    pub reference_years: f64,
    pub eroded_m3: f64,
    pub deposited_land_m3: f64,
    pub trapped_lake_m3: f64,
    pub ocean_export_m3: f64,
    pub boundary_export_m3: f64,
}

impl Soil {
    pub fn add(&mut self, b: &Self) {
        self.depth_cm += b.depth_cm;
        self.sand_fraction += b.sand_fraction;
        self.organic_percent += b.organic_percent;
        self.erosion_mm_year += b.erosion_mm_year;
        self.deposition_mm_year += b.deposition_mm_year;
        self.water_capacity_mm += b.water_capacity_mm;
        // Quality is already aggregated separately by Field.
    }
    pub fn average(&mut self, n: f64) {
        self.depth_cm /= n;
        self.sand_fraction /= n;
        self.organic_percent /= n;
        self.erosion_mm_year /= n;
        self.deposition_mm_year /= n;
        self.water_capacity_mm /= n;
    }
}

pub(crate) fn initial_depth(rock: &Rock, flatness: u8) -> f64 {
    rock.weathering_depth_cm * (0.25 + flatness as f64 / 100.0 * 0.75)
}

pub(crate) fn generate(
    rocks: &[Rock],
    elevation: &[f64],
    flatness: &[u8],
    rain: &[f64],
    temperature: &[f64],
    drainage: &Drainage,
    sample_area_km2: f64,
) -> (Vec<Soil>, SedimentBudget) {
    let n = rocks.len();
    let mut soil = vec![Soil::default(); n];
    let mut detached = vec![0.0; n];
    let mut load = vec![0.0; n];
    for id in 0..n {
        if elevation[id] <= 0.0 {
            continue;
        }
        let depth = initial_depth(&rocks[id], flatness[id]);
        let vegetation = (rain[id] / (600.0 + temperature[id].max(0.0) * 35.0)).clamp(0.0, 1.0);
        let exposure = 1.0 - 0.75 * vegetation;
        let slope = 1.0 - flatness[id] as f64 / 100.0;
        let annual = (rain[id] / 1000.0 * slope.powi(2) * rocks[id].erodibility * exposure * 6.0)
            .min(depth * 10.0 * 0.6 / YEARS);
        detached[id] = if drainage.sediment_trap[id] {
            0.0
        } else {
            annual * YEARS
        };
        load[id] = detached[id];
        soil[id] = Soil {
            depth_cm: depth - detached[id] / 10.0,
            sand_fraction: rocks[id].sand,
            organic_percent: (0.8 + vegetation * 3.5)
                / (1.0 + (temperature[id] - 18.0).max(0.0) * 0.035),
            erosion_mm_year: detached[id] / YEARS,
            ..Soil::default()
        };
    }
    let mut incoming = vec![0usize; n];
    for &next in &drainage.receiver {
        if let Some(next) = next {
            incoming[next] += 1;
        }
    }
    let mut queue: VecDeque<usize> = (0..n).filter(|&id| incoming[id] == 0).collect();
    let mut budget = SedimentBudget {
        reference_years: YEARS,
        eroded_m3: detached.iter().sum::<f64>() * sample_area_km2 * 1000.0,
        ..SedimentBudget::default()
    };
    let mut visited = 0;
    while let Some(id) = queue.pop_front() {
        visited += 1;
        let material = load[id];
        let deposited = if elevation[id] <= 0.0 {
            budget.ocean_export_m3 += material * sample_area_km2 * 1000.0;
            material
        } else if drainage.sediment_trap[id] {
            budget.trapped_lake_m3 += material * sample_area_km2 * 1000.0;
            material
        } else {
            let slowing = (flatness[id] as f64 / 100.0).powi(3) * 0.8;
            // Stop active soil deposits at three metres; excess travels on.
            let deposit = (material * slowing).min((300.0 - soil[id].depth_cm).max(0.0) * 10.0);
            budget.deposited_land_m3 += deposit * sample_area_km2 * 1000.0;
            deposit
        };
        if elevation[id] > 0.0 && !drainage.sediment_trap[id] {
            soil[id].depth_cm += deposited / 10.0;
            soil[id].deposition_mm_year = deposited / YEARS;
            let alluvium = (deposited / (soil[id].depth_cm * 10.0).max(1.0)).clamp(0.0, 1.0);
            soil[id].sand_fraction = soil[id].sand_fraction * (1.0 - alluvium) + 0.35 * alluvium;
        }
        let outgoing = (material - deposited).max(0.0);
        if let Some(next) = drainage.receiver[id] {
            load[next] += outgoing;
            incoming[next] -= 1;
            if incoming[next] == 0 {
                queue.push_back(next);
            }
        } else if elevation[id] > 0.0 {
            budget.boundary_export_m3 += outgoing * sample_area_km2 * 1000.0;
        }
    }
    assert_eq!(
        visited, n,
        "sediment routing requires an acyclic drainage network"
    );
    for (id, s) in soil.iter_mut().enumerate() {
        if elevation[id] <= 0.0 {
            continue;
        }
        let root_depth_mm = (s.depth_cm * 10.0).min(1000.0);
        s.water_capacity_mm = (root_depth_mm * (0.08 + (1.0 - s.sand_fraction) * 0.15)
            + s.organic_percent * 4.0)
            .clamp(20.0, 240.0);
        let texture = 1.0 - (s.sand_fraction - 0.4).abs();
        let leaching = (rain[id] / 4000.0).clamp(0.0, 1.0) * 0.15;
        s.quality = index(
            (s.depth_cm / 100.0).min(1.0) * 0.3
                + texture * 0.25
                + s.organic_percent / 6.0 * 0.35
                + flatness[id] as f64 / 100.0 * 0.1
                - leaching,
        );
    }
    (soil, budget)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn material_is_conserved_steep_soils_thin_and_deposition_is_not_unlimited_fertility() {
        let (cols, rows) = (12, 8);
        let elevation: Vec<_> = (0..cols * rows)
            .map(|i| {
                if i % cols == cols - 1 {
                    -20.0
                } else {
                    1000.0 - (i % cols) as f64 * 80.0
                }
            })
            .collect();
        let structure = crate::tectonics::Structure::generate(42, cols, rows);
        let geology =
            crate::geology::Geology::generate(42, &structure, &elevation, cols, rows, 1.0);
        let profiles = vec![
            crate::seasonal::normals(15.0, &[1000.0 / 12.0; 12], 30.0, 0.5, 100.0);
            elevation.len()
        ];
        let d = crate::hydrology::drain(&elevation, &profiles, cols, rows);
        let flatness: Vec<_> = (0..elevation.len())
            .map(|i| if i % cols < 5 { 10 } else { 95 })
            .collect();
        let (soil, b) = generate(
            &geology.rocks,
            &elevation,
            &flatness,
            &vec![1000.0; elevation.len()],
            &vec![15.0; elevation.len()],
            &d,
            1.0,
        );
        assert!(
            (b.eroded_m3
                - b.deposited_land_m3
                - b.trapped_lake_m3
                - b.ocean_export_m3
                - b.boundary_export_m3)
                .abs()
                < b.eroded_m3 * 1e-10
        );
        assert!(soil.iter().any(|s| s.deposition_mm_year > 0.0));
        assert!(soil[2].depth_cm < initial_depth(&geology.rocks[2], flatness[2]));
        assert!(
            soil.iter()
                .all(|s| s.depth_cm >= 0.0 && s.depth_cm <= 300.0)
        );
    }
}
