//! Conservative lake buckets over priority-flood depressions. Volumes are sums
//! of millimetres over equal-area samples, not cubic metres.
use crate::seasonal::ClimateProfile;
use serde::Serialize;

#[derive(Clone, Debug, Default, Serialize, PartialEq)]
pub struct LakeMonth {
    pub inflow: f64,
    pub evaporation: f64,
    pub overflow: f64,
    pub storage_change: f64,
    pub storage: f64,
    pub water_level_m: f64,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Basin {
    pub id: usize,
    pub kind: &'static str,
    pub spill_elevation_m: f64,
    pub capacity: f64,
    pub initial_storage: f64,
    pub months: [LakeMonth; 12],
}

pub(crate) struct Reservoir {
    pub members: Vec<usize>,
    pub outlet: usize,
    pub report: Basin,
    beds: Vec<f64>,
    demand: Vec<[f64; 12]>,
    floor: f64,
    storage: f64,
}

impl Reservoir {
    pub fn new(
        id: usize,
        members: Vec<usize>,
        outlet: usize,
        spill: f64,
        elevation: &[f64],
        profiles: &[ClimateProfile],
    ) -> Self {
        let beds: Vec<_> = members.iter().map(|&i| elevation[i]).collect();
        let floor = beds.iter().copied().fold(spill, f64::min);
        let capacity = beds.iter().map(|h| (spill - h).max(0.0) * 1000.0).sum();
        // The land model already charged local ET. Only its unfulfilled demand
        // may be charged to lake water; direct rainfall is not counted twice.
        let demand = members
            .iter()
            .map(|&i| {
                std::array::from_fn(|m| {
                    let month = &profiles[i].months[m];
                    (month.potential_evapotranspiration_mm - month.evapotranspiration_mm).max(0.0)
                })
            })
            .collect();
        Self {
            members,
            outlet,
            beds,
            demand,
            floor,
            storage: 0.0,
            report: Basin {
                id,
                kind: "dry",
                spill_elevation_m: spill,
                capacity,
                initial_storage: 0.0,
                months: std::array::from_fn(|_| LakeMonth::default()),
            },
        }
    }

    fn volume_at(&self, level: f64) -> f64 {
        self.beds
            .iter()
            .map(|h| (level - h).max(0.0) * 1000.0)
            .sum()
    }

    fn level_at(&self, volume: f64) -> f64 {
        let (mut low, mut high) = (self.floor, self.report.spill_elevation_m);
        for _ in 0..32 {
            let level = (low + high) / 2.0;
            if self.volume_at(level) < volume {
                low = level;
            } else {
                high = level;
            }
        }
        (low + high) / 2.0
    }

    // A one-metre shore band permits partial wetting of a raster sample and
    // avoids discontinuous all-or-nothing evaporation over flat basin floors.
    pub fn coverage(&self, sample: usize, level: f64) -> f64 {
        (level - self.beds[sample]).clamp(0.0, 1.0)
    }

    pub fn initialize(&mut self, inflow: f64) -> f64 {
        let demand_at = |level| {
            self.demand
                .iter()
                .enumerate()
                .map(|(i, d)| d.iter().sum::<f64>() * self.coverage(i, level))
                .sum::<f64>()
        };
        let full_demand = demand_at(self.report.spill_elevation_m);
        let level = if inflow <= 0.0 {
            self.floor
        } else if inflow >= full_demand {
            self.report.spill_elevation_m
        } else {
            let (mut low, mut high) = (self.floor, self.report.spill_elevation_m);
            for _ in 0..40 {
                let mid = (low + high) / 2.0;
                if demand_at(mid) < inflow {
                    low = mid;
                } else {
                    high = mid;
                }
            }
            (low + high) / 2.0
        };
        self.storage = self.volume_at(level);
        self.report.initial_storage = self.storage;
        (inflow - full_demand).max(0.0)
    }

    pub fn step(&mut self, month: usize, inflow: f64) -> f64 {
        let previous = self.storage;
        let available = previous + inflow;
        let level = self.level_at(available.min(self.report.capacity));
        let demand: f64 = self
            .demand
            .iter()
            .enumerate()
            .map(|(i, d)| d[month] * self.coverage(i, level))
            .sum();
        let evaporation = available.min(demand);
        let overflow = (available - evaporation - self.report.capacity).max(0.0);
        self.storage = (available - evaporation).min(self.report.capacity).max(0.0);
        self.report.months[month] = LakeMonth {
            inflow,
            evaporation,
            overflow,
            storage_change: self.storage - previous,
            storage: self.storage,
            water_level_m: self.level_at(self.storage),
        };
        overflow
    }

    pub fn finish(&mut self) {
        let wet = self.report.months.iter().any(|m| m.storage > 1e-6);
        let overflow = self
            .report
            .months
            .iter()
            .filter(|m| m.overflow > 0.0)
            .count();
        self.report.kind = if !wet {
            "dry"
        } else if overflow == 0 {
            "closed"
        } else if overflow == 12 {
            "overflow"
        } else {
            "seasonal"
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::seasonal::MonthClimate;

    fn lake(demand: f64) -> Reservoir {
        let profile = ClimateProfile {
            months: std::array::from_fn(|_| MonthClimate {
                potential_evapotranspiration_mm: demand / 12.0,
                ..MonthClimate::default()
            }),
            ..ClimateProfile::default()
        };
        Reservoir::new(
            0,
            vec![0, 1, 2, 3],
            0,
            120.0,
            &[100.0; 4],
            &vec![profile; 4],
        )
    }

    #[test]
    fn dry_closed_and_overflow_basins_have_conservative_months() {
        for supply in [0.0, 2000.0, 12000.0] {
            let mut reservoir = lake(1000.0);
            reservoir.initialize(supply);
            for m in 0..12 {
                reservoir.step(m, supply / 12.0);
            }
            reservoir.finish();
            assert_eq!(
                reservoir.report.kind,
                if supply == 0.0 {
                    "dry"
                } else if supply < 4000.0 {
                    "closed"
                } else {
                    "overflow"
                }
            );
            for m in &reservoir.report.months {
                assert!((m.inflow - m.evaporation - m.overflow - m.storage_change).abs() < 1e-7);
                assert!(m.storage >= 0.0 && m.storage <= reservoir.report.capacity);
                assert!(m.water_level_m >= 100.0 && m.water_level_m <= 120.0);
            }
        }
    }

    #[test]
    fn stored_water_buffers_a_dry_season_and_wet_months_can_spill() {
        let mut reservoir = lake(1000.0);
        reservoir.initialize(7000.0);
        let initial = reservoir.report.initial_storage;
        for m in 0..12 {
            reservoir.step(m, if m < 3 { 7000.0 / 3.0 } else { 0.0 });
        }
        reservoir.finish();
        assert_eq!(reservoir.report.kind, "seasonal");
        assert!(reservoir.report.months[0].overflow > 0.0);
        assert!(reservoir.report.months[11].storage < initial);
        assert!(reservoir.report.months[11].evaporation > 0.0);
    }
}
