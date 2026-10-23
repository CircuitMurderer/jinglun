//! Reference aquifers and shared catchment planning envelopes. No withdrawals
//! occur here: a planning ceiling is not a local entitlement or drinking water.
use serde::Serialize;

pub fn quality(volume: f64, tds: f64) -> &'static str {
    if volume <= 1e-8 {
        "dry"
    } else if tds < 1000.0 {
        "fresh"
    } else if tds < 10000.0 {
        "brackish"
    } else {
        "saline"
    }
}

#[derive(Clone, Debug, Default, Serialize, PartialEq)]
pub struct GroundMonth {
    pub recharge_mm: f64,
    pub seepage_mm: f64,
    pub baseflow_mm: f64,
    pub storage_mm: f64,
    pub storage_change_mm: f64,
    pub tds_mg_l: f64,
}

#[derive(Clone, Debug, Default, Serialize, PartialEq)]
pub struct GroundProfile {
    pub initial_storage_mm: f64,
    pub initial_tds_mg_l: f64,
    pub months: [GroundMonth; 12],
}

impl GroundProfile {
    pub fn add(&mut self, other: &Self) {
        self.initial_storage_mm += other.initial_storage_mm;
        self.initial_tds_mg_l += other.initial_tds_mg_l * other.initial_storage_mm;
        for (a, b) in self.months.iter_mut().zip(&other.months) {
            a.recharge_mm += b.recharge_mm;
            a.seepage_mm += b.seepage_mm;
            a.baseflow_mm += b.baseflow_mm;
            // Store concentration * volume until the aggregate is finalized.
            a.tds_mg_l += b.tds_mg_l * b.storage_mm;
            a.storage_mm += b.storage_mm;
            a.storage_change_mm += b.storage_change_mm;
        }
    }
    pub fn average(&mut self, count: f64) {
        self.initial_tds_mg_l = if self.initial_storage_mm > 1e-8 {
            self.initial_tds_mg_l / self.initial_storage_mm
        } else {
            0.0
        };
        self.initial_storage_mm /= count;
        for m in &mut self.months {
            m.tds_mg_l = if m.storage_mm > 1e-8 {
                m.tds_mg_l / m.storage_mm
            } else {
                0.0
            };
            m.recharge_mm /= count;
            m.seepage_mm /= count;
            m.baseflow_mm /= count;
            m.storage_mm /= count;
            m.storage_change_mm /= count;
        }
    }
}

pub(crate) struct Aquifer {
    pub report: GroundProfile,
    storage: f64,
    salt: f64,
    capacity: f64,
    release: f64,
    background_tds: f64,
    before: f64,
}

impl Aquifer {
    pub fn salt_storage(&self) -> f64 {
        self.salt
    }
    pub fn background_tds(&self) -> f64 {
        self.background_tds
    }
    pub fn new(recharge: [f64; 12], capacity: f64, release: f64, background_tds: f64) -> Self {
        let cycle = |mut water: f64| {
            for r in recharge {
                water = ((water + r) * (1.0 - release)).min(capacity);
            }
            water
        };
        let mut storage = 0.0;
        for _ in 0..256 {
            let next = cycle(storage);
            if (next - storage).abs() < 1e-9 {
                break;
            }
            storage = next;
        }
        Self {
            report: GroundProfile {
                initial_storage_mm: storage,
                initial_tds_mg_l: if storage > 1e-8 { background_tds } else { 0.0 },
                ..GroundProfile::default()
            },
            storage,
            salt: storage * background_tds,
            capacity,
            release,
            background_tds,
            before: storage,
        }
    }
    /// Release before lake infiltration, so seepage can return no earlier than
    /// next month; a lake cannot recycle the same water within a routing pass.
    pub fn begin(&mut self, month: usize, recharge: f64) -> (f64, f64) {
        self.before = self.storage;
        self.storage += recharge;
        self.salt += recharge * self.background_tds;
        let tds = if self.storage > 1e-8 {
            self.salt / self.storage
        } else {
            0.0
        };
        let baseflow = (self.storage * self.release).max(self.storage - self.capacity);
        self.storage -= baseflow;
        self.salt = (self.salt - baseflow * tds).max(0.0);
        self.report.months[month].recharge_mm = recharge;
        self.report.months[month].baseflow_mm = baseflow;
        (baseflow, baseflow * tds)
    }
    pub fn infiltrate(&mut self, month: usize, water: f64, salt: f64) {
        self.storage += water;
        self.salt += salt;
        self.report.months[month].seepage_mm += water;
    }
    pub fn finish(&mut self, month: usize) {
        let m = &mut self.report.months[month];
        m.storage_mm = self.storage;
        m.storage_change_mm = self.storage - self.before;
        m.tds_mg_l = if self.storage > 1e-8 {
            self.salt / self.storage
        } else {
            0.0
        };
    }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct SourceMonth {
    pub natural_outflow: f64,
    pub ecological_reserve: f64,
    pub planning_ceiling: f64,
    pub freshwater_ceiling: f64,
    pub tds_mg_l: f64,
    pub quality: &'static str,
}

impl SourceMonth {
    pub fn new(outflow: f64, tds: f64) -> Self {
        // Conservative game rule, not a hydrological or regulatory standard.
        let ecological_reserve = outflow * 0.7;
        let planning_ceiling = outflow - ecological_reserve;
        let quality = quality(outflow, tds);
        Self {
            natural_outflow: outflow,
            ecological_reserve,
            planning_ceiling,
            freshwater_ceiling: if quality == "fresh" {
                planning_ceiling
            } else {
                0.0
            },
            tds_mg_l: tds,
            quality,
        }
    }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct WaterSource {
    /// Final natural drainage sample ID: unique across the whole world.
    pub id: usize,
    pub outlet: &'static str,
    pub months: [SourceMonth; 12],
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn groundwater_delays_recharge_and_lake_seepage_without_creating_water_or_salt() {
        let mut a = Aquifer::new([0.0; 12], 300.0, 0.1, 200.0);
        let (first, _) = a.begin(0, 100.0);
        a.infiltrate(0, 20.0, 20000.0);
        a.finish(0);
        assert!((first - 10.0).abs() < 1e-9);
        let (second, salt) = a.begin(1, 0.0);
        a.finish(1);
        assert!(second > 0.0 && salt / second > 200.0);
        for m in &a.report.months[..2] {
            assert!(
                (m.recharge_mm + m.seepage_mm - m.baseflow_mm - m.storage_change_mm).abs() < 1e-9
            );
        }
        assert!((a.salt + first * 200.0 + salt - 40000.0).abs() < 1e-8);
        let mut dry = Aquifer::new([0.0; 12], 300.0, 0.1, 200.0);
        assert_eq!(dry.begin(0, 0.0), (0.0, 0.0));
    }
    #[test]
    fn saline_water_is_not_fresh_supply_and_reserve_is_not_allocated_twice() {
        for tds in [100.0, 1500.0, 20000.0] {
            let m = SourceMonth::new(100.0, tds);
            assert_eq!(m.ecological_reserve + m.planning_ceiling, 100.0);
            assert_eq!(m.freshwater_ceiling, if tds < 1000.0 { 30.0 } else { 0.0 });
        }
        assert_eq!(SourceMonth::new(0.0, 0.0).quality, "dry");
    }
}
