//! Static surface gyres and monthly slab-ocean climatology. Currents are
//! dimensionless game indices, not measured velocities or a dynamic ocean.
use serde::Serialize;
use std::{
    collections::VecDeque,
    f64::consts::{PI, TAU},
};

#[derive(Clone, Debug, Default, Serialize, PartialEq)]
pub struct OceanProfile {
    pub surface_temperature_c: [f64; 12],
    pub temperature_anomaly_c: [f64; 12],
    /// Mean vector in east/north map directions; cancellation is intentional.
    pub current_east: f64,
    pub current_north: f64,
    /// Mean local magnitude, 0..1; can remain nonzero when vectors cancel.
    pub current_strength: f64,
}
impl OceanProfile {
    pub(crate) fn add(&mut self, other: &Self) {
        for m in 0..12 {
            self.surface_temperature_c[m] += other.surface_temperature_c[m];
            self.temperature_anomaly_c[m] += other.temperature_anomaly_c[m];
        }
        self.current_east += other.current_east;
        self.current_north += other.current_north;
        self.current_strength += other.current_strength;
    }
    pub(crate) fn average(&mut self, count: f64) {
        for m in 0..12 {
            self.surface_temperature_c[m] /= count;
            self.temperature_anomaly_c[m] /= count;
        }
        self.current_east /= count;
        self.current_north /= count;
        self.current_strength /= count;
    }
}

#[derive(Clone, Debug, Default, Serialize, PartialEq)]
pub struct OceanSummary {
    pub model: &'static str,
    pub mean_surface_temperature_c: f64,
    pub mean_abs_anomaly_c: f64,
    pub max_abs_anomaly_c: f64,
}
pub(crate) struct Ocean {
    pub profiles: Vec<OceanProfile>,
    pub coastal_adjustment_c: Vec<[f64; 12]>,
    pub distance: Vec<usize>,
    pub summary: OceanSummary,
}

pub(crate) fn latitude(y: usize, rows: usize) -> f64 {
    75.0 - (y as f64 + 0.5) / rows as f64 * 150.0
}
fn neighbors(id: usize, cols: usize, rows: usize) -> [Option<usize>; 4] {
    let (x, y) = (id % cols, id / cols);
    [
        x.checked_sub(1).map(|_| id - 1),
        (x + 1 < cols).then_some(id + 1),
        y.checked_sub(1).map(|_| id - cols),
        (y + 1 < rows).then_some(id + cols),
    ]
}

/// Water's thermal inertia is represented by a smaller annual amplitude and an
/// August peak in the north (February in the south), using equal model months.
fn radiative_baseline(latitude: f64) -> [f64; 12] {
    let mean = 28.0 - 35.0 * (latitude.abs() / 75.0).powf(1.7);
    std::array::from_fn(|m| {
        (mean + 5.0 * latitude.to_radians().sin() * (TAU * (m as f64 - 7.0) / 12.0).cos())
            .clamp(-1.8, 32.0)
    })
}

#[derive(Clone, Default)]
struct Flow {
    next: [usize; 4],
    incoming: [f64; 4],
    outgoing: f64,
    east: f64,
    north: f64,
}

fn circulation(elevation: &[f64], cols: usize, rows: usize) -> Vec<Flow> {
    // Vertex streamfunction: every vertex touching land or the map boundary is
    // zero. The discrete curl then has zero divergence AND zero flux through
    // every coast/boundary face, including narrow channels and isolated seas.
    let stride = cols + 1;
    let mut distance = vec![usize::MAX; stride * (rows + 1)];
    let mut queue = VecDeque::new();
    for y in 0..=rows {
        for x in 0..=cols {
            if x == 0
                || y == 0
                || x == cols
                || y == rows
                || [
                    elevation[(y - 1) * cols + x - 1],
                    elevation[(y - 1) * cols + x],
                    elevation[y * cols + x - 1],
                    elevation[y * cols + x],
                ]
                .iter()
                .any(|h| *h > 0.0)
            {
                distance[y * stride + x] = 0;
                queue.push_back(y * stride + x);
            }
        }
    }
    while let Some(id) = queue.pop_front() {
        for n in neighbors(id, stride, rows + 1).into_iter().flatten() {
            if distance[n] == usize::MAX {
                distance[n] = distance[id] + 1;
                queue.push_back(n);
            }
        }
    }
    let psi: Vec<_> = distance
        .iter()
        .enumerate()
        .map(|(id, d)| {
            let lat = 75.0 - (id / stride) as f64 / rows as f64 * 150.0;
            let d = *d as f64;
            (PI * lat / 50.0).sin() * d / (1.0 + d / 12.0)
        })
        .collect();
    let mut flows = vec![Flow::default(); elevation.len()];
    let mut max_out: f64 = 0.0;
    for (id, flow) in flows.iter_mut().enumerate() {
        flow.next = neighbors(id, cols, rows).map(|n| n.unwrap_or(id));
        if elevation[id] > 0.0 {
            continue;
        }
        let (x, y) = (id % cols, id / cols);
        let (nw, ne, sw, se) = (
            psi[y * stride + x],
            psi[y * stride + x + 1],
            psi[(y + 1) * stride + x],
            psi[(y + 1) * stride + x + 1],
        );
        let (west, east, north, south) = (sw - nw, se - ne, nw - ne, sw - se);
        flow.incoming = [
            west.max(0.0),
            (-east).max(0.0),
            north.max(0.0),
            (-south).max(0.0),
        ];
        flow.outgoing = (-west).max(0.0) + east.max(0.0) + (-north).max(0.0) + south.max(0.0);
        flow.east = (west + east) / 2.0;
        flow.north = -(north + south) / 2.0;
        max_out = max_out.max(flow.outgoing);
    }
    let scale = 0.4 / max_out.max(1e-9);
    for flow in &mut flows {
        flow.incoming.iter_mut().for_each(|v| *v *= scale);
        flow.outgoing *= scale;
        flow.east *= scale;
        flow.north *= scale;
    }
    flows
}

fn transport(baseline: &[[f64; 12]], elevation: &[f64], flows: &[Flow]) -> Vec<[f64; 12]> {
    let mut heat = baseline.to_vec();
    let mut next = heat.clone();
    // Solve a restoring/upwind steady balance for each month. All weights are
    // positive; incoming == outgoing makes it a convex average. Advection alone
    // conserves heat over each disconnected sea. Restoring exchanges heat with
    // the imposed radiation baseline; this is not a planetary energy budget.
    for _ in 0..256 {
        let mut change: f64 = 0.0;
        for (id, flow) in flows.iter().enumerate() {
            if elevation[id] > 0.0 {
                continue;
            }
            for m in 0..12 {
                let incoming: f64 = (0..4)
                    .map(|k| flow.incoming[k] * heat[flow.next[k]][m])
                    .sum();
                next[id][m] = (0.025 * baseline[id][m] + incoming) / (0.025 + flow.outgoing);
                change = change.max((next[id][m] - heat[id][m]).abs());
            }
        }
        std::mem::swap(&mut heat, &mut next);
        if change < 1e-5 {
            break;
        }
    }
    heat
}

impl Ocean {
    pub fn generate(elevation: &[f64], cols: usize, rows: usize) -> Self {
        let flows = circulation(elevation, cols, rows);
        let baseline: Vec<_> = (0..elevation.len())
            .map(|id| radiative_baseline(latitude(id / cols, rows)))
            .collect();
        let heat = transport(&baseline, elevation, &flows);
        let max_speed = flows
            .iter()
            .map(|f| f.east.hypot(f.north))
            .fold(1e-9, f64::max);
        let profiles: Vec<_> = flows
            .iter()
            .enumerate()
            .map(|(id, flow)| {
                if elevation[id] > 0.0 {
                    return OceanProfile::default();
                }
                OceanProfile {
                    surface_temperature_c: heat[id],
                    temperature_anomaly_c: std::array::from_fn(|m| heat[id][m] - baseline[id][m]),
                    current_east: flow.east / max_speed,
                    current_north: flow.north / max_speed,
                    current_strength: flow.east.hypot(flow.north) / max_speed,
                }
            })
            .collect();
        let mut distance = vec![usize::MAX; elevation.len()];
        let mut queue = VecDeque::new();
        let mut coast: Vec<_> = profiles.iter().map(|p| p.temperature_anomaly_c).collect();
        for (id, h) in elevation.iter().enumerate() {
            if *h <= 0.0 {
                distance[id] = 0;
                queue.push_back(id);
            }
        }
        while let Some(id) = queue.pop_front() {
            for n in neighbors(id, cols, rows).into_iter().flatten() {
                if distance[n] == usize::MAX {
                    distance[n] = distance[id] + 1;
                    queue.push_back(n);
                }
            }
        }
        let mut next = coast.clone();
        // Bounded diffusion spreads ocean anomalies a few natural samples onto
        // land. Ocean values remain fixed; continental interiors decay to zero.
        for _ in 0..40 {
            for id in 0..elevation.len() {
                if elevation[id] <= 0.0 {
                    continue;
                }
                let ns = neighbors(id, cols, rows);
                let count = ns.iter().flatten().count() as f64;
                for m in 0..12 {
                    next[id][m] =
                        0.94 * ns.iter().flatten().map(|n| coast[*n][m]).sum::<f64>() / count;
                }
            }
            std::mem::swap(&mut coast, &mut next);
        }
        for (id, c) in coast.iter_mut().enumerate() {
            if elevation[id] > 0.0 {
                c.iter_mut().for_each(|v| *v *= 0.65);
            }
        }
        let mut summary = OceanSummary {
            model: "static_surface_gyres_v1",
            ..OceanSummary::default()
        };
        let mut count: f64 = 0.0;
        for (id, p) in profiles.iter().enumerate() {
            if elevation[id] > 0.0 {
                continue;
            }
            for m in 0..12 {
                count += 1.0;
                summary.mean_surface_temperature_c += p.surface_temperature_c[m];
                summary.mean_abs_anomaly_c += p.temperature_anomaly_c[m].abs();
                summary.max_abs_anomaly_c = summary
                    .max_abs_anomaly_c
                    .max(p.temperature_anomaly_c[m].abs());
            }
        }
        summary.mean_surface_temperature_c /= count.max(1.0);
        summary.mean_abs_anomaly_c /= count.max(1.0);
        Self {
            profiles,
            coastal_adjustment_c: coast,
            distance,
            summary,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn currents_are_closed_divergence_free_and_do_not_cross_a_land_barrier() {
        let (cols, rows) = (64, 40);
        let mut h = vec![-100.0; cols * rows];
        for y in 0..rows {
            h[y * cols + cols / 2] = 100.0;
        }
        let flows = circulation(&h, cols, rows);
        for (id, flow) in flows.iter().enumerate() {
            assert!((flow.incoming.iter().sum::<f64>() - flow.outgoing).abs() < 1e-12);
            for k in 0..4 {
                if h[flow.next[k]] > 0.0 || flow.next[k] == id {
                    assert_eq!(flow.incoming[k], 0.0);
                }
            }
        }
        let mut base = vec![[10.0; 12]; h.len()];
        let before = transport(&base, &h, &flows);
        for y in 0..rows {
            for x in 0..cols / 2 {
                base[y * cols + x] = [30.0; 12];
            }
        }
        let after = transport(&base, &h, &flows);
        for y in 0..rows {
            for x in cols / 2 + 1..cols {
                assert_eq!(before[y * cols + x], after[y * cols + x]);
            }
        }
    }

    #[test]
    fn gyres_transport_warm_and_cold_water_and_coastal_effects_fade_inland() {
        let (cols, rows) = (96, 60);
        let mut h = vec![100.0; cols * rows];
        for y in 5..55 {
            h[y * cols + 18..y * cols + 78].fill(-100.0);
        }
        let ocean = Ocean::generate(&h, cols, rows);
        let west = &ocean.profiles[18 * cols + 19];
        let east = &ocean.profiles[18 * cols + 76];
        assert!(west.current_north > 0.0 && east.current_north < 0.0);
        let mean = |p: &OceanProfile| p.temperature_anomaly_c.iter().sum::<f64>() / 12.0;
        assert!(
            mean(west) > 0.5 && mean(east) < -0.5,
            "west={}, east={}",
            mean(west),
            mean(east)
        );
        assert!(
            ocean
                .profiles
                .iter()
                .flat_map(|p| p.surface_temperature_c)
                .all(|v| v.is_finite() && (-1.8 - 1e-8..=32.0).contains(&v))
        );
        let coastal = ocean.coastal_adjustment_c[18 * cols + 17][6].abs();
        let inland = ocean.coastal_adjustment_c[18 * cols + 1][6].abs();
        assert!(coastal > 0.1 && inland < coastal * 0.05);
        for m in 0..12 {
            assert!(
                (radiative_baseline(40.0)[m] - radiative_baseline(-40.0)[(m + 6) % 12]).abs()
                    < 1e-10
            );
        }
        assert!(radiative_baseline(40.0)[7] > radiative_baseline(40.0)[6]);
    }
}
