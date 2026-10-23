//! Synthetic geological provinces and finite, grid-based mineral occurrences.
//! Geological history is independent of today's rainfall and governance cells.
use crate::{
    fbm, index,
    tectonics::{KINDS, Structure},
};
use noise::Simplex;
use serde::Serialize;
use std::collections::VecDeque;

pub const MINERALS: [&str; 5] = ["stone", "coal", "iron", "oil", "rare_earth"];

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Province {
    pub id: usize,
    pub kind: &'static str,
    pub rock: &'static str,
    pub tectonic_region_id: usize,
}

#[derive(Clone, Debug)]
pub(crate) struct Rock {
    pub province: usize,
    pub sand: f64,
    pub erodibility: f64,
    pub weathering_depth_cm: f64,
    pub strength: f64,
    pub grade: [u8; 5],
    pub depth: [f64; 5],
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct MineralOccurrence {
    pub deposit_id: usize,
    pub kind: &'static str,
    /// Estimated geological stock in game resource units, not proven tonnes.
    pub reserve_units: f64,
    pub grade_index: f64,
    pub depth_m: f64,
    pub extraction_difficulty: f64,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Deposit {
    pub id: usize,
    pub kind: &'static str,
    pub province_id: usize,
    pub area_km2: f64,
    pub reserve_units: f64,
    pub grade_index: f64,
    pub depth_m: f64,
}

pub(crate) struct Geology {
    pub provinces: Vec<Province>,
    pub rocks: Vec<Rock>,
    pub deposits: Vec<Deposit>,
    pub occurrences: Vec<Vec<MineralOccurrence>>,
}

fn suitability(kind: &str) -> [f64; 5] {
    match kind {
        "sedimentary" => [0.65, 1.0, 0.08, 1.0, 0.02],
        "craton" => [0.85, 0.02, 1.0, 0.0, 0.4],
        "orogenic" => [0.9, 0.05, 0.85, 0.03, 0.2],
        _ => [1.0, 0.0, 0.35, 0.0, 1.0],
    }
}

impl Geology {
    pub fn generate(
        seed: u64,
        structure: &Structure,
        elevation: &[f64],
        cols: usize,
        rows: usize,
        sample_area: f64,
    ) -> Self {
        let noise = Simplex::new(seed as u32 ^ (seed >> 32) as u32 ^ 0x96bd31);
        let rocks = [
            "sandstone_shale",
            "ancient_basement",
            "metamorphic",
            "granite_basalt",
        ];
        let provinces: Vec<_> = structure
            .regions
            .iter()
            .flat_map(|region| {
                KINDS.iter().enumerate().map(move |(kind, &name)| Province {
                    id: region.id * 4 + kind,
                    kind: name,
                    rock: rocks[kind],
                    tectonic_region_id: region.id,
                })
            })
            .collect();
        let mut field = Vec::with_capacity(elevation.len());
        for id in 0..elevation.len() {
            let (x, y) = (
                (id % cols) as f64 / cols as f64,
                (id / cols) as f64 / rows as f64,
            );
            let setting = &structure.settings[id];
            let province = setting.region * 4 + setting.kind;
            let kind = provinces[province].kind;
            let match_rock = match kind {
                "sedimentary" => (0.55, 0.85, 140.0, 0.4),
                "craton" => (0.6, 0.35, 100.0, 0.9),
                "orogenic" => (0.4, 0.45, 75.0, 0.85),
                _ => (0.35, 0.55, 115.0, 0.8),
            };
            let eligible = suitability(kind);
            let grade = std::array::from_fn(|m| {
                let history = (fbm(&noise, x * 10.0 + m as f64 * 23.0, y * 7.0, 3) + 1.0) * 0.5;
                let value = eligible[m] * history;
                if elevation[id] <= 0.0 || (m > 0 && value < [0.0, 0.43, 0.4, 0.47, 0.5][m]) {
                    0
                } else {
                    index(value)
                }
            });
            let burial = (fbm(&noise, x * 5.0 + 29.0, y * 4.0, 2) + 1.0) * 0.5;
            field.push(Rock {
                province,
                sand: match_rock.0,
                erodibility: match_rock.1,
                weathering_depth_cm: match_rock.2,
                strength: match_rock.3,
                grade,
                depth: [
                    10.0 + burial * 40.0,
                    50.0 + burial * 700.0,
                    20.0 + burial * 500.0,
                    600.0 + burial * 3000.0,
                    15.0 + burial * 250.0,
                ],
            });
        }
        let mut deposits = vec![];
        let mut occurrences = vec![vec![]; elevation.len()];
        for (mineral, &kind) in MINERALS.iter().enumerate() {
            let mut visited = vec![false; elevation.len()];
            for start in 0..elevation.len() {
                if visited[start] || field[start].grade[mineral] == 0 {
                    continue;
                }
                let province_id = field[start].province;
                let mut queue = VecDeque::from([start]);
                visited[start] = true;
                let mut deposit = Deposit {
                    id: deposits.len(),
                    kind,
                    province_id,
                    area_km2: 0.0,
                    reserve_units: 0.0,
                    grade_index: 0.0,
                    depth_m: 0.0,
                };
                while let Some(id) = queue.pop_front() {
                    let grade = field[id].grade[mineral] as f64;
                    let reserve = sample_area * grade / 100.0 * [12.0, 8.0, 5.0, 3.0, 0.8][mineral];
                    deposit.area_km2 += sample_area;
                    deposit.reserve_units += reserve;
                    deposit.grade_index += grade * reserve;
                    deposit.depth_m += field[id].depth[mineral] * reserve;
                    occurrences[id].push(MineralOccurrence {
                        deposit_id: deposit.id,
                        kind,
                        reserve_units: reserve,
                        grade_index: grade,
                        depth_m: field[id].depth[mineral],
                        extraction_difficulty: (field[id].depth[mineral] / 45.0
                            + field[id].strength * 25.0
                            + (100.0 - grade) * 0.3)
                            .clamp(0.0, 100.0),
                    });
                    for next in crate::hydrology::neighbors(id, cols, rows) {
                        if !visited[next]
                            && field[next].province == province_id
                            && field[next].grade[mineral] > 0
                        {
                            visited[next] = true;
                            queue.push_back(next);
                        }
                    }
                }
                deposit.grade_index /= deposit.reserve_units;
                deposit.depth_m /= deposit.reserve_units;
                deposits.push(deposit);
            }
        }
        Self {
            provinces,
            rocks: field,
            deposits,
            occurrences,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn deposits_have_eligible_hosts_and_partitioned_stock_matches_global_stock() {
        let structure = Structure::generate(42, 80, 50);
        let g = Geology::generate(42, &structure, &vec![200.0; 80 * 50], 80, 50, 10.0);
        for kind in MINERALS {
            assert!(g.deposits.iter().any(|d| d.kind == kind), "missing {kind}");
        }
        for d in &g.deposits {
            let total: f64 = g
                .occurrences
                .iter()
                .flatten()
                .filter(|o| o.deposit_id == d.id)
                .map(|o| o.reserve_units)
                .sum();
            assert!((total - d.reserve_units).abs() < total * 1e-10);
            if d.kind == "oil" || d.kind == "coal" {
                assert_eq!(g.provinces[d.province_id].kind, "sedimentary");
            }
        }
        let sea = Geology::generate(42, &structure, &vec![-10.0; 80 * 50], 80, 50, 10.0);
        assert!(sea.deposits.is_empty());
        assert_eq!(g.provinces, sea.provinces);
    }
}
