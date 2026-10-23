//! Presentation-only contours. Never mutate samples, topology or random state.
//! Sample centres are extended to the world edge, then padded outside it so
//! contours close at the rectangle without inventing an ocean rim.
use crate::Point;
use serde::Serialize;
use std::fmt::Write;

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct NaturalBand {
    pub terrain: u8,
    pub path: String,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct NaturalSurface {
    pub version: u8,
    pub land_path: String,
    pub coast_path: String,
    pub shallow_path: String,
    pub terrain: Vec<NaturalBand>,
}

pub(crate) fn build(
    elevation: &[f64],
    terrain: &[u8],
    columns: usize,
    rows: usize,
    width: f64,
    height: f64,
) -> NaturalSurface {
    let land = contours(elevation, columns, rows, width, height, 0.0);
    let mask = |test: &dyn Fn(usize) -> bool| {
        (0..elevation.len())
            .map(|i| if test(i) { 1.0 } else { 0.0 })
            .collect::<Vec<_>>()
    };
    let terrain = (2..=11)
        .filter_map(|kind| {
            if !terrain.contains(&kind) {
                return None;
            }
            let values = mask(&|i| terrain[i] == kind);
            Some(NaturalBand {
                terrain: kind,
                path: path(&contours(&values, columns, rows, width, height, 0.5)),
            })
        })
        .collect();
    NaturalSurface {
        version: 1,
        land_path: path(&land),
        coast_path: coastline(&land, width, height),
        // The existing environment classifies shallow sea above -650 metres.
        shallow_path: path(&contours(elevation, columns, rows, width, height, -650.0)),
        terrain,
    }
}

fn path(rings: &[Vec<Point>]) -> String {
    let mut result = String::new();
    for ring in rings {
        for (i, p) in ring.iter().enumerate() {
            write!(
                result,
                "{}{:.2},{:.2}",
                if i == 0 { 'M' } else { 'L' },
                p.x,
                p.y
            )
            .unwrap();
        }
        result.push('Z');
    }
    result
}

// Do not label the edge of our rectangular world as a physical coastline.
fn coastline(rings: &[Vec<Point>], width: f64, height: f64) -> String {
    let mut result = String::new();
    let equal = |a: f64, b: f64| (a - b).abs() < 1e-7;
    for ring in rings {
        let mut connected = false;
        for i in 0..ring.len() {
            let a = &ring[i];
            let b = &ring[(i + 1) % ring.len()];
            let border = (equal(a.x, 0.0) && equal(b.x, 0.0))
                || (equal(a.x, width) && equal(b.x, width))
                || (equal(a.y, 0.0) && equal(b.y, 0.0))
                || (equal(a.y, height) && equal(b.y, height));
            if border {
                connected = false;
                continue;
            }
            if !connected {
                write!(result, "M{:.2},{:.2}", a.x, a.y).unwrap();
            }
            write!(result, "L{:.2},{:.2}", b.x, b.y).unwrap();
            connected = true;
        }
    }
    result
}

/// Marching Squares with interpolated crossings and a bilinear asymptotic
/// decider for saddle cases. Shared edges are keyed by grid identity, not
/// rounded float coordinates. Rings use even-odd fill so holes remain holes.
fn contours(
    values: &[f64],
    columns: usize,
    rows: usize,
    width: f64,
    height: f64,
    level: f64,
) -> Vec<Vec<Point>> {
    assert!(columns > 0 && rows > 0 && values.len() == columns * rows);
    let nx = columns + 4;
    let ny = rows + 4;
    let dx = width / columns as f64;
    let dy = height / rows as f64;
    let value = |x: usize, y: usize| {
        if x == 0 || y == 0 || x == nx - 1 || y == ny - 1 {
            level - 1.0
        } else {
            values
                [y.saturating_sub(2).min(rows - 1) * columns + x.saturating_sub(2).min(columns - 1)]
        }
    };
    let coordinate = |x: usize, y: usize| Point {
        x: ((x as f64 - 1.5) * dx).clamp(0.0, width),
        y: ((y as f64 - 1.5) * dy).clamp(0.0, height),
    };
    let missing = usize::MAX;
    let mut links = vec![[missing; 2]; nx * ny * 2];
    let mut points = vec![Point { x: 0.0, y: 0.0 }; nx * ny * 2];
    let mut starts = Vec::new();
    for y in 0..ny - 1 {
        for x in 0..nx - 1 {
            let v = [
                value(x, y),
                value(x + 1, y),
                value(x + 1, y + 1),
                value(x, y + 1),
            ];
            let case = v
                .iter()
                .enumerate()
                .fold(0, |n, (i, v)| n | (usize::from(*v > level) << i));
            let q = (v[0] - level) * (v[2] - level) - (v[1] - level) * (v[3] - level);
            let pairs: &[(usize, usize)] = match case {
                0 | 15 => &[],
                1 | 14 => &[(3, 0)],
                2 | 13 => &[(0, 1)],
                3 | 12 => &[(3, 1)],
                4 | 11 => &[(1, 2)],
                6 | 9 => &[(0, 2)],
                7 | 8 => &[(3, 2)],
                5 if q > 0.0 => &[(0, 1), (2, 3)],
                5 => &[(3, 0), (1, 2)],
                10 if q < 0.0 => &[(3, 0), (1, 2)],
                10 => &[(0, 1), (2, 3)],
                _ => unreachable!(),
            };
            let edges = [
                ((x, y), (x + 1, y)),
                ((x + 1, y), (x + 1, y + 1)),
                ((x, y + 1), (x + 1, y + 1)),
                ((x, y), (x, y + 1)),
            ];
            let key = |edge: usize| {
                let ((ax, ay), (_, by)) = edges[edge];
                (ay * nx + ax) * 2 + usize::from(ay != by)
            };
            for &(a, b) in pairs {
                let ka = key(a);
                let kb = key(b);
                for (edge, here, other) in [(a, ka, kb), (b, kb, ka)] {
                    if links[here][0] == missing {
                        starts.push(here);
                        links[here][0] = other;
                        let ((ax, ay), (bx, by)) = edges[edge];
                        let va = value(ax, ay);
                        let vb = value(bx, by);
                        let t = ((level - va) / (vb - va)).clamp(0.0, 1.0);
                        let pa = coordinate(ax, ay);
                        let pb = coordinate(bx, by);
                        points[here] = Point {
                            x: pa.x + (pb.x - pa.x) * t,
                            y: pa.y + (pb.y - pa.y) * t,
                        };
                    } else {
                        debug_assert_eq!(links[here][1], missing);
                        links[here][1] = other;
                    }
                }
            }
        }
    }
    let mut seen = vec![false; links.len()];
    let mut rings = Vec::new();
    for start in starts {
        if seen[start] {
            continue;
        }
        let mut ring: Vec<Point> = Vec::new();
        let (mut current, mut previous) = (start, missing);
        loop {
            seen[current] = true;
            let p = points[current];
            if ring
                .last()
                .is_none_or(|last| (last.x - p.x).abs() + (last.y - p.y).abs() > 1e-9)
            {
                ring.push(p);
            }
            let [a, b] = links[current];
            let next = if a != previous { a } else { b };
            assert_ne!(next, missing, "contour must be closed");
            if next == start {
                break;
            }
            assert!(!seen[next], "contour must not enter another ring");
            previous = current;
            current = next;
        }
        if ring.len() > 1 && ring.first() == ring.last() {
            ring.pop();
        }
        if ring.len() >= 3 && area(&ring).abs() > 1e-9 {
            rings.push(ring);
        }
    }
    rings
}

fn area(ring: &[Point]) -> f64 {
    (0..ring.len())
        .map(|i| {
            let a = ring[i];
            let b = ring[(i + 1) % ring.len()];
            a.x * b.y - b.x * a.y
        })
        .sum::<f64>()
        / 2.0
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn empty_and_full_fields_respect_rectangle_without_fake_coast() {
        assert!(contours(&[-1.0; 12], 4, 3, 40.0, 30.0, 0.0).is_empty());
        let rings = contours(&[1.0; 12], 4, 3, 40.0, 30.0, 0.0);
        assert_eq!(rings.len(), 1);
        assert!((area(&rings[0]).abs() - 1200.0).abs() < 1e-6);
        assert!(coastline(&rings, 40.0, 30.0).is_empty());
    }
    #[test]
    fn interpolates_height_instead_of_rounding_a_pixel_mask() {
        let rings = contours(&[-1.0, 3.0, -1.0, 3.0], 2, 2, 20.0, 20.0, 0.0);
        assert_eq!(rings.len(), 1);
        assert!(rings[0].iter().any(|p| (p.x - 7.5).abs() < 1e-8));
        assert!((area(&rings[0]).abs() - 250.0).abs() < 1e-6);
    }
    #[test]
    fn retains_islands_holes_and_deterministic_saddles() {
        let mut field = vec![1.0; 25];
        field[12] = -1.0;
        let rings = contours(&field, 5, 5, 50.0, 50.0, 0.0);
        assert_eq!(rings.len(), 2);
        assert_eq!(path(&rings).matches('Z').count(), 2);
        for field in [[3.0, -1.0, -1.0, 3.0], [1.0, -3.0, -3.0, 1.0]] {
            let rings = contours(&field, 2, 2, 20.0, 20.0, 0.0);
            assert_eq!(rings.len(), if field[0] == 3.0 { 1 } else { 2 });
            assert_eq!(rings, contours(&field, 2, 2, 20.0, 20.0, 0.0));
            assert!(rings.iter().flatten().all(|p| p.x.is_finite()
                && p.y.is_finite()
                && (0.0..=20.0).contains(&p.x)
                && (0.0..=20.0).contains(&p.y)));
        }
    }
    #[test]
    fn equal_saddles_do_not_join_islands_that_only_touch_diagonally() {
        for values in [[1.0, -1.0, -1.0, 1.0], [-1.0, 1.0, 1.0, -1.0]] {
            assert_eq!(contours(&values, 2, 2, 20.0, 20.0, 0.0).len(), 2);
        }
    }

    #[test]
    fn threshold_vertices_and_single_samples_do_not_break_stitching() {
        for values in [[0.0, 1.0, -1.0, 0.0], [0.0; 4], [1.0, 0.0, 0.0, -1.0]] {
            let _ = contours(&values, 2, 2, 20.0, 20.0, 0.0);
        }
        assert!((area(&contours(&[1.0], 1, 1, 10.0, 10.0, 0.0)[0]).abs() - 100.0).abs() < 1e-6);
    }
}
