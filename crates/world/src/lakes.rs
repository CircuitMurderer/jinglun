//! Conservative lake buckets over priority-flood depressions. Volumes are sums
//! of millimetres over equal-area samples, not cubic metres.
use crate::seasonal::ClimateProfile;
use serde::Serialize;

#[derive(Clone, Debug, Default, Serialize, PartialEq)]
pub struct LakeMonth {
    pub inflow: f64,
    pub evaporation: f64,
    pub seepage: f64,
    pub overflow: f64,
    pub storage_change: f64,
    pub storage: f64,
    pub water_level_m: f64,
    pub tds_mg_l: f64,
    pub salt_storage: f64,
    pub quality: &'static str,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Basin {
    pub id: usize,
    pub kind: &'static str,
    pub spill_elevation_m: f64,
    pub capacity: f64,
    pub initial_storage: f64,
    pub initial_salt_storage: f64,
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
    salt: f64,
    pub seepage: Vec<f64>,
    pub seepage_rate: f64,
    pub outflow_salt: f64,
}

impl Reservoir {
    pub fn salt_storage(&self) -> f64 {
        self.salt
    }
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
        let seepage = vec![0.0; beds.len()];
        Self {
            members,
            outlet,
            beds,
            demand,
            floor,
            storage: 0.0,
            salt: 0.0,
            seepage,
            seepage_rate: 0.0,
            outflow_salt: 0.0,
            report: Basin {
                id,
                kind: "dry",
                spill_elevation_m: spill,
                capacity,
                initial_storage: 0.0,
                initial_salt_storage: 0.0,
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

    pub fn initialize(&mut self, inflow: f64, salt_inflow: f64) -> f64 {
        let demand_at = |level| {
            self.demand
                .iter()
                .enumerate()
                .map(|(i, d)| {
                    (d.iter().sum::<f64>() + self.seepage_rate * 12.0) * self.coverage(i, level)
                })
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
        let annual_seepage: f64 = (0..self.members.len())
            .map(|i| self.seepage_rate * 12.0 * self.coverage(i, level))
            .sum();
        let export = (inflow - full_demand).max(0.0) + annual_seepage;
        // A documented reference reserve, not a claim to historical salt age.
        let tds = if export > 1e-8 {
            salt_inflow / export
        } else if inflow > 1e-8 {
            salt_inflow / inflow
        } else {
            0.0
        };
        self.salt = self.storage * tds;
        self.report.initial_salt_storage = self.salt;
        self.outflow_salt = (inflow - full_demand).max(0.0) * tds;
        (inflow - full_demand).max(0.0)
    }

    pub fn step(&mut self, month: usize, inflow: f64, salt_inflow: f64) -> f64 {
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
        self.salt += salt_inflow;
        let remaining = available - evaporation;
        let requested: f64 = (0..self.members.len())
            .map(|i| self.seepage_rate * self.coverage(i, level))
            .sum();
        let seepage = remaining.min(requested);
        for i in 0..self.members.len() {
            self.seepage[i] = if requested > 0.0 {
                seepage * self.seepage_rate * self.coverage(i, level) / requested
            } else {
                0.0
            };
        }
        let tds = if remaining > 1e-8 {
            self.salt / remaining
        } else {
            0.0
        };
        let overflow = (remaining - seepage - self.report.capacity).max(0.0);
        self.outflow_salt = overflow * tds;
        self.salt = (self.salt - (seepage + overflow) * tds).max(0.0);
        self.storage = (remaining - seepage - overflow).max(0.0);
        self.report.months[month] = LakeMonth {
            inflow,
            evaporation,
            seepage,
            overflow,
            storage_change: self.storage - previous,
            storage: self.storage,
            water_level_m: self.level_at(self.storage),
            tds_mg_l: tds,
            salt_storage: self.salt,
            quality: crate::water::quality(self.storage, tds),
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
            reservoir.initialize(supply, supply * 100.0);
            for m in 0..12 {
                reservoir.step(m, supply / 12.0, supply / 12.0 * 100.0);
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
        reservoir.initialize(7000.0, 700000.0);
        let initial = reservoir.report.initial_storage;
        for m in 0..12 {
            let inflow = if m < 3 { 7000.0 / 3.0 } else { 0.0 };
            reservoir.step(m, inflow, inflow * 100.0);
        }
        reservoir.finish();
        assert_eq!(reservoir.report.kind, "seasonal");
        assert!(reservoir.report.months[0].overflow > 0.0);
        assert!(reservoir.report.months[11].storage < initial);
        assert!(reservoir.report.months[11].evaporation > 0.0);
    }

    #[test]
    fn evaporation_concentrates_salts_and_seepage_exports_water_and_salt_together() {
        let mut reservoir = lake(1000.0);
        reservoir.seepage_rate = 4.0;
        reservoir.initialize(7000.0, 700000.0);
        let (initial_water, initial_salt) = (reservoir.storage, reservoir.salt);
        let initial_tds = initial_salt / initial_water;
        reservoir.step(0, 0.0, 0.0);
        let m = reservoir.report.months[0].clone();
        assert!(m.evaporation > 0.0 && m.seepage > 0.0);
        assert!(m.tds_mg_l > initial_tds);
        assert!((m.storage - initial_water + m.evaporation + m.seepage + m.overflow).abs() < 1e-7);
        assert!(
            (m.salt_storage + (m.seepage + m.overflow) * m.tds_mg_l - initial_salt).abs() < 1e-6
        );
        reservoir.step(1, 500000.0, 500000.0 * 10.0);
        assert!(reservoir.report.months[1].tds_mg_l < m.tds_mg_l);
    }
}
