//! One static structural skeleton shared by relief, rocks and mineral hosts.
//! Vectors classify synthetic boundary settings; they do not move plates in time.
use crate::{Point, fbm};
use noise::{NoiseFn, Simplex};
use serde::Serialize;
use std::collections::BTreeSet;
use std::f64::consts::TAU;

pub(crate) const KINDS: [&str; 4] = ["sedimentary", "craton", "orogenic", "igneous"];

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Region {
    pub id: usize,
    /// Map coordinates, independent of governance polygons.
    pub center: Point,
    /// Dimensionless relative tendency, not a measured velocity.
    pub tendency: Point,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Boundary {
    pub a: usize,
    pub b: usize,
    pub kind: &'static str,
    pub strength: f64,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct Setting {
    pub region: usize,
    pub kind: usize,
    pub uplift: f64,
    pub highland: f64,
    pub basin: f64,
    pub magmatic: f64,
    pub plateau: f64,
}

pub(crate) struct Structure {
    pub regions: Vec<Region>,
    pub boundaries: Vec<Boundary>,
    pub settings: Vec<Setting>,
}

fn smooth(v: f64, a: f64, b: f64) -> f64 {
    let t = ((v - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn boundary(a: &Region, b: &Region) -> Boundary {
    let dx = b.center.x - a.center.x;
    let dy = b.center.y - a.center.y;
    let distance = dx.hypot(dy);
    let closing =
        ((a.tendency.x - b.tendency.x) * dx + (a.tendency.y - b.tendency.y) * dy) / distance;
    let kind = if closing > 0.25 {
        "convergent"
    } else if closing < -0.25 {
        "divergent"
    } else {
        "transform"
    };
    Boundary {
        a: a.id,
        b: b.id,
        kind,
        strength: (closing.abs() / 1.5).clamp(0.15, 1.0),
    }
}

impl Structure {
    pub fn generate(seed: u64, cols: usize, rows: usize) -> Self {
        let noise = Simplex::new(seed as u32 ^ (seed >> 32) as u32 ^ 0x37cd49);
        let regions = (0..12)
            .map(|id| {
                let angle = (noise.get([id as f64 * 2.7, 8.3]) + 1.0) * TAU;
                Region {
                    id,
                    center: Point {
                        x: ((id % 4) as f64 + 0.5 + noise.get([id as f64, 18.1]) * 0.35) / 4.0
                            * crate::WIDTH,
                        y: ((id / 4) as f64 + 0.5 + noise.get([id as f64, 42.7]) * 0.35) / 3.0
                            * crate::HEIGHT,
                    },
                    tendency: Point {
                        x: angle.cos(),
                        y: angle.sin(),
                    },
                }
            })
            .collect();
        Self::from_regions(&noise, regions, cols, rows)
    }

    fn from_regions(noise: &Simplex, regions: Vec<Region>, cols: usize, rows: usize) -> Self {
        let mut settings = Vec::with_capacity(cols * rows);
        let mut pairs = BTreeSet::new();
        let mut distances = vec![0.0; regions.len()];
        for id in 0..cols * rows {
            let x = (id % cols) as f64 / cols as f64;
            let y = (id / cols) as f64 / rows as f64;
            let px = (x + noise.get([x * 2.8, y * 2.0]) * 0.055) * crate::WIDTH;
            let py = (y + noise.get([x * 2.8 + 19.0, y * 2.0 + 19.0]) * 0.055) * crate::HEIGHT;
            for (d, r) in distances.iter_mut().zip(&regions) {
                *d = (r.center.x - px).powi(2) + (r.center.y - py).powi(2);
            }
            let home = (0..regions.len())
                .min_by(|&a, &b| distances[a].total_cmp(&distances[b]))
                .unwrap();
            // Nearest bisector, rather than simply the second-nearest center.
            let (other, distance) = (0..regions.len())
                .filter(|&j| j != home)
                .map(|j| {
                    let separation = (regions[j].center.x - regions[home].center.x)
                        .hypot(regions[j].center.y - regions[home].center.y);
                    (
                        j,
                        (distances[j] - distances[home]).max(0.0) / (2.0 * separation),
                    )
                })
                .min_by(|a, b| a.1.total_cmp(&b.1))
                .unwrap();
            let (a, b) = (home.min(other), home.max(other));
            pairs.insert((a, b));
            let edge = boundary(&regions[a], &regions[b]);
            let d = distance / crate::HEIGHT;
            let history = fbm(noise, x * 4.0 + 31.0, y * 3.0, 3);
            let broad_basin = smooth(history, 0.03, 0.28) * 0.75;
            let intrusion = smooth(fbm(noise, x * 6.0, y * 4.0 + 13.0, 3), 0.18, 0.42);
            let mut setting = Setting {
                region: home,
                kind: 1,
                uplift: 0.0,
                highland: 0.0,
                basin: broad_basin,
                magmatic: intrusion * 0.65,
                plateau: smooth(fbm(noise, x * 3.0 + 45.0, y * 2.0, 2), -0.05, 0.25),
            };
            match edge.kind {
                "convergent" => {
                    setting.uplift = edge.strength * (-(d / 0.028).powi(2)).exp();
                    setting.highland = edge.strength * (-(d / 0.095).powi(2)).exp();
                    // A foreland depression outside the compressed core.
                    setting.basin = setting
                        .basin
                        .max(edge.strength * (-((d - 0.12) / 0.035).powi(2)).exp());
                    if home == b {
                        setting.magmatic = setting
                            .magmatic
                            .max(edge.strength * (-((d - 0.045) / 0.018).powi(2)).exp());
                    }
                }
                "divergent" => {
                    setting.basin = setting
                        .basin
                        .max(edge.strength * (-(d / 0.06).powi(2)).exp());
                    setting.magmatic = setting
                        .magmatic
                        .max(edge.strength * (-(d / 0.014).powi(2)).exp());
                }
                _ => {}
            }
            setting.kind = if setting.uplift > 0.28 {
                2
            } else if setting.magmatic > 0.4 {
                3
            } else if setting.basin > 0.3 {
                0
            } else {
                1
            };
            settings.push(setting);
        }
        let boundaries = pairs
            .into_iter()
            .map(|(a, b)| boundary(&regions[a], &regions[b]))
            .collect();
        Self {
            regions,
            boundaries,
            settings,
        }
    }
}

/// The same uplift/basin/intrusion fields that selected rock backgrounds also
/// shape terrain. A compressed broad highland can contain flat plateau patches.
pub(crate) fn land_elevation(setting: &Setting, continental_height: f64, ridge: f64) -> f64 {
    let base = 35.0 + continental_height.powf(1.1) * 1000.0;
    // Blend structural relief into the continental lowlands. Otherwise the
    // first land sample can jump from sea level to a multi-kilometre cliff.
    let relief = smooth(continental_height, 0.0, 0.2);
    let mountains = setting.uplift * (1800.0 + ridge.powi(3) * 2000.0);
    let highland = setting.highland * 1500.0;
    let rugged = base + (mountains + highland + setting.magmatic * ridge.powi(4) * 650.0) * relief;
    let plateau_weight =
        setting.plateau * smooth(setting.highland, 0.25, 0.65) * (1.0 - 0.85 * setting.uplift);
    let plateau = base + (1400.0 + 500.0 * setting.highland) * relief;
    ((rugged * (1.0 - plateau_weight) + plateau * plateau_weight) - setting.basin * 450.0)
        .max(20.0)
        .round()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pair(converging: bool) -> Structure {
        let direction = if converging { 1.0 } else { -1.0 };
        Structure::from_regions(
            &Simplex::new(42),
            vec![
                Region {
                    id: 0,
                    center: Point { x: 400.0, y: 500.0 },
                    tendency: Point {
                        x: direction,
                        y: 0.0,
                    },
                },
                Region {
                    id: 1,
                    center: Point {
                        x: 1200.0,
                        y: 500.0,
                    },
                    tendency: Point {
                        x: -direction,
                        y: 0.0,
                    },
                },
            ],
            96,
            60,
        )
    }

    #[test]
    fn compressional_belts_jointly_raise_mountains_and_select_metamorphic_hosts() {
        let s = pair(true);
        assert_eq!(s.boundaries[0].kind, "convergent");
        let core: Vec<_> = s.settings.iter().filter(|s| s.uplift > 0.7).collect();
        let interior: Vec<_> = s
            .settings
            .iter()
            .filter(|s| s.highland < 0.05 && s.basin < 0.3)
            .collect();
        assert!(core.len() > 100 && interior.len() > 100);
        assert!(core.iter().all(|s| KINDS[s.kind] == "orogenic"));
        let mean = |samples: &[&Setting]| {
            samples
                .iter()
                .map(|s| land_elevation(s, 0.3, 0.6))
                .sum::<f64>()
                / samples.len() as f64
        };
        assert!(mean(&core) > mean(&interior) + 2500.0);
    }

    #[test]
    fn extensional_settings_create_depressions_and_distinct_magmatic_cores() {
        let s = pair(false);
        assert_eq!(s.boundaries[0].kind, "divergent");
        assert!(s.settings.iter().any(|s| s.basin > 0.7 && s.kind == 3));
        let sediment = s
            .settings
            .iter()
            .find(|s| s.basin > 0.5 && s.magmatic < 0.3 && s.kind == 0)
            .unwrap();
        let stable = Setting {
            basin: 0.0,
            magmatic: 0.0,
            ..*sediment
        };
        assert!(land_elevation(sediment, 0.5, 0.4) < land_elevation(&stable, 0.5, 0.4));
    }

    #[test]
    fn broad_uplift_can_form_a_flat_high_plateau_and_coasts_have_a_gradual_transition() {
        let s = Setting {
            region: 0,
            kind: 1,
            uplift: 0.05,
            highland: 1.0,
            basin: 0.0,
            magmatic: 0.0,
            plateau: 1.0,
        };
        let low = land_elevation(&s, 0.4, 0.1);
        let high = land_elevation(&s, 0.4, 1.0);
        assert!(low > 1800.0 && high - low < 20.0, "{low}..{high}");
        let mountain = Setting {
            uplift: 1.0,
            plateau: 0.0,
            ..s
        };
        let shore = land_elevation(&mountain, 0.001, 0.8);
        assert!(shore < 50.0);
        assert!(land_elevation(&mountain, 0.3, 0.8) > 3000.0);
    }
}
