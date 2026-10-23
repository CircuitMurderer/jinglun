//! Presentation-only shaded relief, using the same immutable elevation samples.
//! Distances are converted to metres. Exaggeration is a disclosed visual choice,
//! never a change to elevation, slope, water, construction or other simulation data.
use crate::{Point, construction::KM_PER_MAP_UNIT};
use serde::Serialize;

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct ReliefSymbol {
    pub position: Point,
    pub terrain: u8,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct NaturalDetail {
    pub version: u8,
    pub columns: usize,
    pub rows: usize,
    pub terrain: Vec<u8>,
    /// Multiplicative light, encoded with 128 = neutral. Water is always neutral.
    pub shade: Vec<u8>,
    pub azimuth_deg: f64,
    pub altitude_deg: f64,
    pub vertical_exaggeration: f64,
    pub symbols: Vec<ReliefSymbol>,
}

pub(crate) fn build(
    elevation: &[f64],
    terrain: &[u8],
    columns: usize,
    rows: usize,
    width: f64,
    height: f64,
) -> NaturalDetail {
    assert!(columns > 0 && rows > 0 && elevation.len() == columns * rows);
    assert_eq!(terrain.len(), elevation.len());
    let dx = width / columns as f64;
    let dy = height / rows as f64;
    let azimuth = 315.0_f64;
    let altitude = 45.0_f64;
    let exaggeration = 24.0;
    let light = (
        azimuth.to_radians().sin() * altitude.to_radians().cos(),
        -azimuth.to_radians().cos() * altitude.to_radians().cos(),
        altitude.to_radians().sin(),
    );
    let dry = |i: usize| elevation[i] > 0.0 && terrain[i] != 10;
    let mut shade = vec![128; elevation.len()];
    for y in 0..rows {
        for x in 0..columns {
            let i = y * columns + x;
            if !dry(i) {
                continue;
            }
            // Horn's weighted 3x3 gradient. Ocean/lake samples do not create a
            // fictitious cliff on the land; use the centre elevation instead.
            let sample = |ox: isize, oy: isize| {
                let xx = (x as isize + ox).clamp(0, columns as isize - 1) as usize;
                let yy = (y as isize + oy).clamp(0, rows as isize - 1) as usize;
                let j = yy * columns + xx;
                if dry(j) { elevation[j] } else { elevation[i] }
            };
            let gx = (sample(1, -1) + 2.0 * sample(1, 0) + sample(1, 1)
                - sample(-1, -1)
                - 2.0 * sample(-1, 0)
                - sample(-1, 1))
                * exaggeration
                / (8.0 * dx * KM_PER_MAP_UNIT * 1000.0);
            let gy = (sample(-1, 1) + 2.0 * sample(0, 1) + sample(1, 1)
                - sample(-1, -1)
                - 2.0 * sample(0, -1)
                - sample(1, -1))
                * exaggeration
                / (8.0 * dy * KM_PER_MAP_UNIT * 1000.0);
            let illumination = ((-gx * light.0 - gy * light.1 + light.2)
                / (gx * gx + gy * gy + 1.0).sqrt())
            .max(0.0);
            let gain = (0.35 + 0.65 * illumination) / (0.35 + 0.65 * light.2);
            shade[i] = (128.0 * gain).round().clamp(0.0, 255.0) as u8;
        }
    }
    // Choose from actual environmental samples, not administrative centroids.
    // A stable spatial hash provides spacing without consuming world RNG state.
    let hash = |i: usize| (i as u64).wrapping_mul(0x9e3779b97f4a7c15).rotate_left(17);
    let mut candidates = Vec::new();
    for by in (0..rows).step_by(6) {
        for bx in (0..columns).step_by(6) {
            let mut mountain = None;
            let mut forest = None;
            for y in by..(by + 6).min(rows) {
                for x in bx..(bx + 6).min(columns) {
                    let i = y * columns + x;
                    if !dry(i) {
                        continue;
                    }
                    if terrain[i] == 7 && mountain.is_none_or(|j| elevation[i] > elevation[j]) {
                        mountain = Some(i);
                    } else if terrain[i] == 4 && forest.is_none_or(|j| hash(i) < hash(j)) {
                        forest = Some(i);
                    }
                }
            }
            if let Some(i) = mountain.or(forest) {
                candidates.push(i);
            }
        }
    }
    candidates.sort_by_key(|&i| (terrain[i] != 7, hash(i)));
    let mut symbols: Vec<ReliefSymbol> = Vec::new();
    for i in candidates {
        let position = Point {
            x: (i % columns) as f64 * dx + dx / 2.0,
            y: (i / columns) as f64 * dy + dy / 2.0,
        };
        if symbols.iter().any(|s| {
            (s.position.x - position.x).hypot(s.position.y - position.y) < dx.min(dy) * 5.0
        }) {
            continue;
        }
        symbols.push(ReliefSymbol {
            position,
            terrain: terrain[i],
        });
        if symbols.len() == 240 {
            break;
        }
    }
    NaturalDetail {
        version: 1,
        columns,
        rows,
        terrain: terrain.to_vec(),
        shade,
        azimuth_deg: azimuth,
        altitude_deg: altitude,
        vertical_exaggeration: exaggeration,
        symbols,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn flat_land_and_water_are_neutral() {
        let d = build(&[100.0; 25], &[2; 25], 5, 5, 50.0, 50.0);
        assert_eq!(d.shade, vec![128; 25]);
        let e: Vec<_> = (0..25).map(|i| (i * i) as f64 * 20.0).collect();
        for t in [0, 1, 10] {
            let e = if t == 10 {
                e.clone()
            } else {
                e.iter().map(|h| -h).collect()
            };
            assert_eq!(build(&e, &[t; 25], 5, 5, 50.0, 50.0).shade, vec![128; 25]);
        }
    }
    #[test]
    fn west_facing_slopes_receive_more_northwest_light() {
        let east: Vec<_> = (0..25).map(|i| 1000.0 + (i % 5) as f64 * 500.0).collect();
        let west: Vec<_> = (0..25).map(|i| 4000.0 - (i % 5) as f64 * 500.0).collect();
        let a = build(&east, &[7; 25], 5, 5, 50.0, 50.0);
        let b = build(&west, &[7; 25], 5, 5, 50.0, 50.0);
        assert!(a.shade[12] > 128);
        assert!(b.shade[12] < 128);
    }
    #[test]
    fn symbols_have_actual_source_terrain_and_are_bounded_deterministic() {
        let terrain: Vec<_> = (0..1600).map(|i| if i % 3 == 0 { 7 } else { 4 }).collect();
        let elevation: Vec<_> = (0..1600).map(|i| 100.0 + i as f64).collect();
        let snapshot = elevation.clone();
        let a = build(&elevation, &terrain, 40, 40, 400.0, 400.0);
        assert!(!a.symbols.is_empty() && a.symbols.len() <= 240);
        for s in &a.symbols {
            let i = (s.position.y / 10.0) as usize * 40 + (s.position.x / 10.0) as usize;
            assert_eq!(s.terrain, terrain[i]);
        }
        assert_eq!(a, build(&elevation, &terrain, 40, 40, 400.0, 400.0));
        assert_eq!(elevation, snapshot);
    }
}
