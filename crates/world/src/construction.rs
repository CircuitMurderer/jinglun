//! Natural planning constraints only: no buildings, roads or water entitlements.
use crate::{Point, index, seasonal::ClimateProfile};
use serde::Serialize;

pub const KM_PER_MAP_UNIT: f64 = 10.0;

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct WorldScale {
    pub km_per_map_unit: f64,
    pub sample_area_km2: f64,
    pub water_unit_m3: f64,
}

impl WorldScale {
    pub fn new(sample_width: f64, sample_height: f64) -> Self {
        let sample_area_km2 = sample_width * sample_height * KM_PER_MAP_UNIT.powi(2);
        Self {
            km_per_map_unit: KM_PER_MAP_UNIT,
            sample_area_km2,
            water_unit_m3: sample_area_km2 * 1000.0,
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, PartialEq)]
pub struct Construction {
    pub area_km2: f64,
    pub buildable_fraction: f64,
    pub conditional_fraction: f64,
    pub unavailable_fraction: f64,
    pub buildable_area_km2: f64,
    pub cost_multiplier: Option<f64>,
    pub flood_risk: u8,
    pub natural_support_index: u8,
    pub construction_months: f64,
    pub land_anchor: Option<Point>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Passage {
    pub kind: &'static str,
    pub distance_km: f64,
    pub cost_multiplier: Option<f64>,
    pub crosses_river: bool,
    pub crosses_lake: bool,
    pub crosses_sea: bool,
}
impl Default for Passage {
    fn default() -> Self {
        Self {
            kind: "marine",
            distance_km: 0.0,
            cost_multiplier: None,
            crosses_river: false,
            crosses_lake: false,
            crosses_sea: false,
        }
    }
}

#[derive(Clone, Debug, Default)]
pub(crate) struct Site {
    pub tier: u8, // 0 unsuitable, 1 engineering-dependent, 2 broadly favorable
    pub cost: f64,
    pub flood: u8,
    pub support: u8,
    pub months: f64,
}

pub(crate) fn site(
    flatness: u8,
    lake: bool,
    elevation: f64,
    profile: &ClimateProfile,
    river_distance: usize,
    channel_height: f64,
    soil_depth_cm: f64,
    agriculture: u8,
    fresh_water: f64,
    forest: bool,
) -> Site {
    if elevation <= 0.0 || lake {
        return Site::default();
    }
    let flat = flatness as f64 / 100.0;
    let flood = index(
        (1.0 - channel_height.max(0.0) / 80.0).max(0.0)
            * (1.0 - river_distance.min(4) as f64 / 4.0)
            * flat,
    );
    let months = profile
        .months
        .iter()
        .filter(|m| m.temperature_c > -5.0 && m.precipitation_mm < 200.0)
        .count() as f64;
    let frozen = profile.warmest() <= 0.0;
    let weak_ground = (soil_depth_cm / 300.0).min(1.0) * flat;
    let cost = (1.0
        + (1.0 - flat) * 1.4
        + flood as f64 / 100.0 * 0.8
        + weak_ground * 0.35
        + if forest { 0.2 } else { 0.0 }
        + (12.0 - months) / 12.0 * 0.5)
        .clamp(1.0, 4.5);
    let tier = if frozen || flatness < 15 || flood >= 85 {
        0
    } else if flatness >= 58 && flood < 45 && months >= 6.0 {
        2
    } else {
        1
    };
    let support = index(
        (agriculture as f64 / 100.0 * 0.4 + flat * 0.25 + fresh_water.clamp(0.0, 1.0) * 0.35)
            * if frozen { 0.15 } else { 1.0 },
    );
    Site {
        tier,
        cost,
        flood,
        support,
        months,
    }
}

pub(crate) fn corridor(
    start: Point,
    end: Point,
    elevation: &[f64],
    flatness: &[u8],
    lakes: &[bool],
    rivers: &[bool],
    cols: usize,
    rows: usize,
    width: f64,
    height: f64,
) -> Passage {
    let distance = (end.x - start.x).hypot(end.y - start.y);
    let steps = (distance / (width / cols as f64).min(height / rows as f64) * 2.0)
        .ceil()
        .max(1.0) as usize;
    let (mut sea, mut lake, mut river, mut min_flat) = (false, false, false, 100u8);
    let mut penalty = 0.0;
    for step in 0..=steps {
        let t = step as f64 / steps as f64;
        let x = ((start.x + (end.x - start.x) * t) / width * cols as f64)
            .clamp(0.0, (cols - 1) as f64) as usize;
        let y = ((start.y + (end.y - start.y) * t) / height * rows as f64)
            .clamp(0.0, (rows - 1) as f64) as usize;
        let id = y * cols + x;
        sea |= elevation[id] <= 0.0;
        lake |= lakes[id];
        river |= rivers[id];
        min_flat = min_flat.min(flatness[id]);
        penalty += 1.0 - flatness[id] as f64 / 100.0;
    }
    let kind = if sea {
        "sea_crossing"
    } else if lake {
        "lake_crossing"
    } else if min_flat < 30 {
        "mountain"
    } else if river {
        "river_crossing"
    } else {
        "land"
    };
    Passage {
        kind,
        crosses_river: river,
        crosses_lake: lake,
        crosses_sea: sea,
        distance_km: distance * KM_PER_MAP_UNIT,
        cost_multiplier: if sea || lake {
            None
        } else {
            Some(1.0 + penalty / (steps + 1) as f64 * 2.0 + if river { 0.4 } else { 0.0 })
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn high_flat_land_remains_buildable_and_water_crossing_is_not_an_open_road() {
        let profile = crate::seasonal::normals(12.0, &[800.0 / 12.0; 12], 30.0, 0.5, 100.0);
        let high = site(
            90, false, 1800.0, &profile, 10, 200.0, 100.0, 60, 1.0, false,
        );
        let steep = site(10, false, 200.0, &profile, 10, 100.0, 40.0, 10, 0.0, false);
        assert_eq!(high.tier, 2);
        assert_eq!(steep.tier, 0);
        assert!(high.cost < steep.cost);
        let passage = corridor(
            Point { x: 0.5, y: 0.5 },
            Point { x: 4.5, y: 0.5 },
            &[100.0, 100.0, -5.0, 100.0, 100.0],
            &[90; 5],
            &[false; 5],
            &[false; 5],
            5,
            1,
            5.0,
            1.0,
        );
        assert_eq!(passage.kind, "sea_crossing");
        assert!(passage.crosses_sea);
        assert!(passage.cost_multiplier.is_none());
        assert_eq!(passage.distance_km, 40.0);
        assert_eq!(WorldScale::new(1.0, 1.0).water_unit_m3, 100000.0);
    }
}
