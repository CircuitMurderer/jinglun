//! D8 drainage on a fixed raster. Priority-flood supplies an acyclic hydraulic
//! surface; original terrain is retained, including the depressions.
use crate::Point;
use serde::Serialize;
use std::cmp::Reverse;
use std::collections::{BinaryHeap, VecDeque};

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct River {
    pub id: usize,
    pub points: Vec<Point>,
    pub flow_index: u8,
    pub basin_id: usize,
    pub outlet: &'static str,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Lake {
    pub id: usize,
    pub path: String,
    pub area_fraction: f64,
    pub spill_elevation_m: i32,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct WaterBudget {
    // Sum of depths over equally sized raster samples (not m³ or river speed).
    pub land_precipitation: f64,
    pub land_evapotranspiration: f64,
    pub groundwater_recharge: f64,
    pub generated_runoff: f64,
    pub lake_evaporation: f64,
    pub ocean_outflow: f64,
    pub boundary_outflow: f64,
}

pub(crate) struct Drainage {
    pub receiver: Vec<Option<usize>>,
    pub basin: Vec<usize>,
    pub filled: Vec<f64>,
    pub flow: Vec<f64>,
    pub river_mask: Vec<bool>,
    pub lake_mask: Vec<bool>,
    pub lake_groups: Vec<Vec<usize>>,
    pub river_distance: Vec<usize>,
    pub budget: WaterBudget,
}

pub(crate) fn neighbors(id: usize, cols: usize, rows: usize) -> impl Iterator<Item = usize> {
    let (x, y) = (id % cols, id / cols);
    (-1i32..=1).flat_map(move |dy| {
        (-1i32..=1).filter_map(move |dx| {
            let (nx, ny) = (x as i32 + dx, y as i32 + dy);
            if (dx != 0 || dy != 0) && nx >= 0 && ny >= 0 && nx < cols as i32 && ny < rows as i32 {
                Some(ny as usize * cols + nx as usize)
            } else {
                None
            }
        })
    })
}

pub(crate) fn drain(
    elevation: &[f64],
    rain: &[f64],
    pet: &[f64],
    cols: usize,
    rows: usize,
) -> Drainage {
    let n = elevation.len();
    let mut heap = BinaryHeap::new();
    let mut visited = vec![false; n];
    let mut receiver = vec![None; n];
    let mut filled = elevation.to_vec();
    for id in 0..n {
        if elevation[id] <= 0.0
            || id % cols == 0
            || id % cols == cols - 1
            || id / cols == 0
            || id / cols == rows - 1
        {
            visited[id] = true;
            heap.push(Reverse((elevation[id].round() as i32, id)));
        }
    }
    let mut order = Vec::with_capacity(n);
    while let Some(Reverse((level, id))) = heap.pop() {
        order.push(id);
        for next in neighbors(id, cols, rows) {
            if visited[next] {
                continue;
            }
            visited[next] = true;
            filled[next] = elevation[next].max(level as f64);
            receiver[next] = Some(id);
            heap.push(Reverse((filled[next].round() as i32, next)));
        }
    }
    let mut rank = vec![0; n];
    for (r, &id) in order.iter().enumerate() {
        rank[id] = r;
    }
    // Where a downhill choice exists, prefer steepest descent to heap tie order.
    for id in 0..n {
        if receiver[id].is_none() {
            continue;
        }
        let mut best_slope = 0.0;
        for next in neighbors(id, cols, rows) {
            if rank[next] >= rank[id] {
                continue;
            }
            let diagonal = id % cols != next % cols && id / cols != next / cols;
            let slope = (filled[id] - filled[next]) / if diagonal { 2.0f64.sqrt() } else { 1.0 };
            if slope > best_slope {
                best_slope = slope;
                receiver[id] = Some(next);
            }
        }
    }
    let mut basin = vec![0; n];
    for &id in &order {
        basin[id] = receiver[id].map_or(id, |next| basin[next]);
    }

    let mut budget = WaterBudget {
        land_precipitation: 0.0,
        land_evapotranspiration: 0.0,
        groundwater_recharge: 0.0,
        generated_runoff: 0.0,
        lake_evaporation: 0.0,
        ocean_outflow: 0.0,
        boundary_outflow: 0.0,
    };
    let mut local = vec![0.0; n];
    for id in 0..n {
        if elevation[id] <= 0.0 {
            continue;
        }
        let evap = rain[id].min(pet[id] * 0.72);
        let recharge = (rain[id] - evap) * 0.25;
        local[id] = rain[id] - evap - recharge;
        budget.land_precipitation += rain[id];
        budget.land_evapotranspiration += evap;
        budget.groundwater_recharge += recharge;
        budget.generated_runoff += local[id];
    }
    let mut flow = local.clone();
    for &id in order.iter().rev() {
        if let Some(next) = receiver[id] {
            flow[next] += flow[id];
        }
    }

    let mut lake_mask = vec![false; n];
    let mut grouped = vec![false; n];
    let mut lake_groups = vec![];
    for start in 0..n {
        if grouped[start] || elevation[start] <= 0.0 || filled[start] - elevation[start] < 12.0 {
            continue;
        }
        let mut group = vec![];
        let mut queue = VecDeque::from([start]);
        grouped[start] = true;
        while let Some(id) = queue.pop_front() {
            group.push(id);
            for next in neighbors(id, cols, rows) {
                if !grouped[next]
                    && elevation[next] > 0.0
                    && filled[next] - elevation[next] >= 12.0
                    && (filled[next] - filled[start]).abs() < 1.0
                {
                    grouped[next] = true;
                    queue.push_back(next);
                }
            }
        }
        if group.len() < 4 {
            continue;
        }
        let mut membership = std::collections::BTreeSet::new();
        membership.extend(group.iter().copied());
        let inflow: f64 = group
            .iter()
            .filter(|&&id| receiver[id].is_some_and(|r| !membership.contains(&r)))
            .map(|&id| flow[id])
            .sum();
        let evaporative_demand: f64 = group.iter().map(|&id| pet[id]).sum();
        // First stage models only water-supported overflow lakes. Dry basins are
        // not painted blue simply because priority-flood found a depression.
        if inflow > evaporative_demand * 1.2 {
            for &id in &group {
                lake_mask[id] = true;
            }
            lake_groups.push(group);
        }
    }
    flow.clone_from(&local);
    for &id in order.iter().rev() {
        if lake_mask[id] {
            let loss = flow[id].min(pet[id] * 0.28);
            flow[id] -= loss;
            budget.lake_evaporation += loss;
        }
        if let Some(next) = receiver[id] {
            flow[next] += flow[id];
        } else if elevation[id] <= 0.0 {
            budget.ocean_outflow += flow[id];
        } else {
            budget.boundary_outflow += flow[id];
        }
    }
    let river_mask: Vec<bool> = (0..n)
        .map(|id| elevation[id] > 0.0 && !lake_mask[id] && flow[id] >= 8000.0)
        .collect();
    let mut river_distance = vec![usize::MAX; n];
    let mut queue = VecDeque::new();
    for id in 0..n {
        if river_mask[id] || lake_mask[id] {
            river_distance[id] = 0;
            queue.push_back(id);
        }
    }
    while let Some(id) = queue.pop_front() {
        for next in neighbors(id, cols, rows) {
            if elevation[next] > 0.0 && river_distance[next] == usize::MAX {
                river_distance[next] = river_distance[id] + 1;
                queue.push_back(next);
            }
        }
    }
    Drainage {
        receiver,
        basin,
        filled,
        flow,
        river_mask,
        lake_mask,
        lake_groups,
        river_distance,
        budget,
    }
}

impl Drainage {
    pub fn rivers(&self, cols: usize, step_x: f64, step_y: f64) -> Vec<River> {
        let mut upstream = vec![0usize; self.receiver.len()];
        for (id, &next) in self.receiver.iter().enumerate() {
            if self.river_mask[id] {
                if let Some(next) = next {
                    if self.river_mask[next] {
                        upstream[next] += 1;
                    }
                }
            }
        }
        let max_flow = self.flow.iter().copied().fold(1.0, f64::max);
        let point = |id: usize| Point {
            x: (id % cols) as f64 * step_x + step_x / 2.0,
            y: (id / cols) as f64 * step_y + step_y / 2.0,
        };
        let mut result = vec![];
        for id in 0..self.receiver.len() {
            if !self.river_mask[id] || upstream[id] == 1 {
                continue;
            }
            let mut points = vec![point(id)];
            let mut current = id;
            let mut outlet = "junction";
            let mut flow = self.flow[id];
            while let Some(next) = self.receiver[current] {
                points.push(point(next));
                flow = flow.max(self.flow[current]);
                if self.lake_mask[next] {
                    outlet = "lake";
                    break;
                }
                if !self.river_mask[next] {
                    outlet = "ocean";
                    break;
                }
                current = next;
                if upstream[next] != 1 {
                    break;
                }
            }
            if self.receiver[current].is_none() {
                outlet = "boundary";
            }
            if points.len() >= 2 {
                result.push(River {
                    id: result.len(),
                    points,
                    flow_index: crate::index((flow / max_flow).sqrt()),
                    basin_id: self.basin[id],
                    outlet,
                });
            }
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drainage_is_acyclic_water_balances_and_arid_downstream_receives_water() {
        let (cols, rows) = (16, 12);
        let elevation: Vec<f64> = (0..cols * rows)
            .map(|id| {
                if id % cols == cols - 1 {
                    -50.0
                } else {
                    800.0 - (id % cols) as f64 * 40.0 + ((id / cols) as f64 - 6.0).abs() * 80.0
                }
            })
            .collect();
        let rain: Vec<f64> = (0..cols * rows)
            .map(|id| if id % cols < 6 { 1800.0 } else { 20.0 })
            .collect();
        let d = drain(&elevation, &rain, &vec![700.0; cols * rows], cols, rows);
        for start in 0..elevation.len() {
            let mut id = start;
            let mut steps = 0;
            while let Some(next) = d.receiver[id] {
                assert!(d.filled[next] <= d.filled[id]);
                id = next;
                steps += 1;
                assert!(steps < elevation.len());
            }
        }
        let b = &d.budget;
        assert!(
            (b.land_precipitation
                - b.land_evapotranspiration
                - b.groundwater_recharge
                - b.generated_runoff)
                .abs()
                < 1e-6
        );
        assert!(
            (b.generated_runoff - b.lake_evaporation - b.ocean_outflow - b.boundary_outflow).abs()
                < 1e-6
        );
        assert!(
            (0..elevation.len()).any(|id| id % cols > 9 && elevation[id] > 0.0 && d.river_mask[id])
        );
    }

    #[test]
    fn supported_depression_becomes_lake_but_dry_pit_does_not() {
        let cols = 15;
        let rows = 15;
        let mut elevation = vec![500.0; cols * rows];
        for y in 0..rows {
            elevation[y * cols + cols - 1] = -20.0;
        }
        for y in 4..10 {
            for x in 4..10 {
                elevation[y * cols + x] = 100.0;
            }
        }
        let wet = drain(
            &elevation,
            &vec![6000.0; cols * rows],
            &vec![600.0; cols * rows],
            cols,
            rows,
        );
        assert!(!wet.lake_groups.is_empty());
        let dry = drain(
            &elevation,
            &vec![0.0; cols * rows],
            &vec![1400.0; cols * rows],
            cols,
            rows,
        );
        assert!(dry.lake_groups.is_empty());
        assert!(dry.flow.iter().all(|f| *f == 0.0));
    }
}
