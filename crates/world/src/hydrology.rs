//! D8 drainage on a fixed raster. Priority-flood supplies an acyclic hydraulic
//! surface; original terrain is retained, including the depressions.
use crate::Point;
use crate::lakes::{Basin, Reservoir};
use crate::seasonal::ClimateProfile;
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
    pub annual_flow: f64,
    pub monthly_flow: [f64; 12],
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Lake {
    pub id: usize,
    pub path: String,
    pub area_fraction: f64,
    pub spill_elevation_m: i32,
    pub basin_id: usize,
}

#[derive(Clone, Debug, Default, Serialize, PartialEq)]
pub struct RoutingMonth {
    pub generated_runoff: f64,
    pub lake_evaporation: f64,
    pub lake_storage_change: f64,
    pub ocean_outflow: f64,
    pub boundary_outflow: f64,
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
    pub snow_storage_change: f64,
    pub soil_storage_change: f64,
    pub lake_storage_change: f64,
    pub months: [RoutingMonth; 12],
}

pub(crate) struct Drainage {
    pub receiver: Vec<Option<usize>>,
    pub basin: Vec<usize>,
    pub filled: Vec<f64>,
    pub flow: Vec<f64>,
    pub river_mask: Vec<bool>,
    pub lake_mask: Vec<bool>,
    pub lake_groups: Vec<Vec<usize>>,
    pub lake_basin_ids: Vec<usize>,
    pub lake_id: Vec<Option<usize>>,
    pub basins: Vec<Basin>,
    pub terminal: Vec<&'static str>,
    pub flow_months: Vec<[f64; 12]>,
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
    profiles: &[ClimateProfile],
    cols: usize,
    rows: usize,
) -> Drainage {
    let n = elevation.len();
    let water: Vec<_> = profiles.iter().map(ClimateProfile::water).collect();
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
    let mut budget = WaterBudget {
        land_precipitation: 0.0,
        land_evapotranspiration: 0.0,
        groundwater_recharge: 0.0,
        generated_runoff: 0.0,
        lake_evaporation: 0.0,
        ocean_outflow: 0.0,
        boundary_outflow: 0.0,
        snow_storage_change: 0.0,
        soil_storage_change: 0.0,
        lake_storage_change: 0.0,
        months: std::array::from_fn(|_| RoutingMonth::default()),
    };
    let mut local = vec![0.0; n];
    for id in 0..n {
        if elevation[id] <= 0.0 {
            continue;
        }
        local[id] = water[id].runoff;
        budget.land_precipitation += water[id].precipitation;
        budget.land_evapotranspiration += water[id].evapotranspiration;
        budget.groundwater_recharge += water[id].recharge;
        budget.snow_storage_change += water[id].snow_storage_change;
        budget.soil_storage_change += water[id].soil_storage_change;
        budget.generated_runoff += local[id];
    }

    let mut grouped = vec![false; n];
    let mut depression_member = vec![false; n];
    let mut reservoirs = vec![];
    let mut reservoir_at = vec![None; n];
    for start in 0..n {
        if grouped[start] || elevation[start] <= 0.0 || filled[start] - elevation[start] < 0.5 {
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
                    && filled[next] - elevation[next] >= 0.5
                    && (filled[next] - filled[start]).abs() < 1.0
                {
                    grouped[next] = true;
                    queue.push_back(next);
                }
            }
        }
        // Small numerical pits are still traversed by priority-flood. Retain
        // only depressions with meaningful area AND depth as lake buckets.
        if group.len() < 4 || !group.iter().any(|&i| filled[i] - elevation[i] >= 12.0) {
            continue;
        }
        let outlet = *group.iter().min_by_key(|&&i| rank[i]).unwrap();
        for &id in &group {
            depression_member[id] = true;
            if id != outlet {
                receiver[id] = Some(outlet);
            }
        }
        reservoir_at[outlet] = Some(reservoirs.len());
        reservoirs.push(Reservoir::new(
            reservoirs.len(),
            group,
            outlet,
            filled[outlet],
            elevation,
            profiles,
        ));
    }

    // Collapse each retained depression to its earliest flood-rank outlet.
    // Every routing edge still decreases rank, including cascaded basins.
    // Initialize a reference lake volume from an annual mean balance; it is
    // explicit initial storage, never free runoff or a fabricated precipitation.
    let mut annual = local;
    for &id in order.iter().rev() {
        if let Some(lake) = reservoir_at[id] {
            annual[id] = reservoirs[lake].initialize(annual[id]);
        }
        if let Some(next) = receiver[id] {
            annual[next] += annual[id];
        }
    }

    let mut flow_months = vec![[0.0; 12]; n];
    for month in 0..12 {
        let mut monthly: Vec<f64> = (0..n)
            .map(|id| {
                if elevation[id] > 0.0 {
                    profiles[id].months[month].runoff_mm
                } else {
                    0.0
                }
            })
            .collect();
        let totals = &mut budget.months[month];
        totals.generated_runoff = monthly.iter().sum();
        for &id in order.iter().rev() {
            if let Some(lake) = reservoir_at[id] {
                monthly[id] = reservoirs[lake].step(month, monthly[id]);
                let record = &reservoirs[lake].report.months[month];
                totals.lake_evaporation += record.evaporation;
                totals.lake_storage_change += record.storage_change;
            }
            if let Some(next) = receiver[id] {
                monthly[next] += monthly[id];
            } else if elevation[id] <= 0.0 {
                totals.ocean_outflow += monthly[id];
            } else {
                totals.boundary_outflow += monthly[id];
            }
        }
        for id in 0..n {
            flow_months[id][month] = monthly[id];
        }
        budget.lake_evaporation += totals.lake_evaporation;
        budget.lake_storage_change += totals.lake_storage_change;
        budget.ocean_outflow += totals.ocean_outflow;
        budget.boundary_outflow += totals.boundary_outflow;
    }
    let flow: Vec<f64> = flow_months
        .iter()
        .map(|months| months.iter().sum())
        .collect();
    let mut lake_mask = vec![false; n];
    let mut lake_id = vec![None; n];
    let mut lake_groups = vec![];
    let mut lake_basin_ids = vec![];
    for lake in &mut reservoirs {
        lake.finish();
        if lake.report.months.iter().all(|m| m.overflow == 0.0) {
            receiver[lake.outlet] = None;
        }
        let wet: Vec<usize> = lake
            .members
            .iter()
            .enumerate()
            .filter_map(|(i, &id)| {
                let coverage = lake
                    .report
                    .months
                    .iter()
                    .map(|m| lake.coverage(i, m.water_level_m))
                    .sum::<f64>()
                    / 12.0;
                (coverage >= 0.5).then_some(id)
            })
            .collect();
        if !wet.is_empty() {
            for &id in &wet {
                lake_mask[id] = true;
                lake_id[id] = Some(lake_groups.len());
            }
            lake_groups.push(wet);
            lake_basin_ids.push(lake.report.id);
        }
    }
    let mut basin = vec![0; n];
    let mut terminal = vec!["ocean"; n];
    for &id in &order {
        if let Some(next) = receiver[id] {
            basin[id] = basin[next];
            terminal[id] = terminal[next];
        } else {
            basin[id] = id;
            terminal[id] = if elevation[id] <= 0.0 {
                "ocean"
            } else if reservoir_at[id].is_some() {
                "closed_basin"
            } else {
                "boundary"
            };
        }
    }
    // Basin interiors are represented by the reservoir, not straight artificial
    // river shortcuts. Visible rivers end where they enter a retained basin.
    let river_mask: Vec<bool> = (0..n)
        .map(|id| elevation[id] > 0.0 && !depression_member[id] && flow[id] >= 8000.0)
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
        lake_basin_ids,
        lake_id,
        basins: reservoirs.into_iter().map(|r| r.report).collect(),
        terminal,
        flow_months,
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
            let mut gauge = id;
            while let Some(next) = self.receiver[current] {
                points.push(point(next));
                if self.flow[current] > self.flow[gauge] {
                    gauge = current;
                }
                if self.lake_mask[next] {
                    outlet = "lake";
                    break;
                }
                if !self.river_mask[next] {
                    outlet = if self.receiver[next].is_some() {
                        "lake"
                    } else {
                        self.terminal[next]
                    };
                    break;
                }
                current = next;
                if upstream[next] != 1 {
                    break;
                }
            }
            if self.receiver[current].is_none() {
                outlet = self.terminal[current];
            }
            if points.len() >= 2 {
                result.push(River {
                    id: result.len(),
                    points,
                    flow_index: crate::index((self.flow[gauge] / max_flow).sqrt()),
                    annual_flow: self.flow[gauge],
                    monthly_flow: self.flow_months[gauge],
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

    fn check_routing(d: &Drainage) {
        for m in &d.budget.months {
            let residual = m.generated_runoff
                - m.lake_evaporation
                - m.ocean_outflow
                - m.boundary_outflow
                - m.lake_storage_change;
            assert!(
                residual.abs() < m.generated_runoff.max(1.0) * 1e-9,
                "monthly residual: {residual}"
            );
        }
        for start in 0..d.receiver.len() {
            let (mut id, mut steps) = (start, 0);
            while let Some(next) = d.receiver[id] {
                id = next;
                steps += 1;
                assert!(steps < d.receiver.len(), "cycle after basin routing");
            }
        }
    }

    #[test]
    fn closed_basin_retains_water_and_wet_basin_reconnects_to_ocean() {
        let (cols, rows) = (15, 15);
        let mut elevation: Vec<f64> = (0..cols * rows)
            .map(|id| 500.0 - (id % cols) as f64 * 10.0 + ((id / cols) as f64 - 7.0).abs() * 4.0)
            .collect();
        for y in 0..rows {
            elevation[y * cols + cols - 1] = -20.0;
        }
        let bottom: Vec<_> = (4..10)
            .flat_map(|y| (4..10).map(move |x| y * cols + x))
            .collect();
        for &id in &bottom {
            elevation[id] = 100.0;
        }
        for annual_supply in [600.0, 6000.0] {
            let mut profiles = vec![ClimateProfile::default(); cols * rows];
            for &id in &bottom {
                for month in &mut profiles[id].months {
                    month.precipitation_mm = annual_supply / 12.0;
                    month.runoff_mm = annual_supply / 12.0;
                    month.potential_evapotranspiration_mm = 1000.0 / 12.0;
                }
            }
            let d = drain(&elevation, &profiles, cols, rows);
            assert_eq!(d.basins.len(), 1);
            assert!(!d.lake_groups.is_empty());
            if annual_supply < 1000.0 {
                assert_eq!(d.basins[0].kind, "closed");
                assert_eq!(d.budget.ocean_outflow, 0.0);
                assert!(bottom.iter().all(|&i| d.terminal[i] == "closed_basin"));
            } else {
                assert_eq!(d.basins[0].kind, "overflow");
                assert!(d.budget.ocean_outflow > 0.0);
                assert!(bottom.iter().all(|&i| d.terminal[i] == "ocean"));
            }
            check_routing(&d);
        }
    }

    #[test]
    fn cascaded_lakes_pass_only_real_overflow_without_river_shortcuts() {
        let (cols, rows) = (16, 12);
        let mut elevation: Vec<f64> = (0..cols * rows)
            .map(|id| {
                if id % cols == cols - 1 {
                    -20.0
                } else {
                    1000.0 - (id % cols) as f64 * 40.0 + ((id / cols) as f64 - 6.0).abs() * 60.0
                }
            })
            .collect();
        let mut profiles = vec![ClimateProfile::default(); cols * rows];
        for y in 4..8 {
            for x in 3..6 {
                let id = y * cols + x;
                elevation[id] = 300.0;
                for month in &mut profiles[id].months {
                    month.runoff_mm = 10000.0 / 12.0;
                    month.precipitation_mm = month.runoff_mm;
                }
            }
        }
        for y in 4..8 {
            for x in 9..12 {
                elevation[y * cols + x] = 50.0;
            }
        }
        let d = drain(&elevation, &profiles, cols, rows);
        assert_eq!(d.basins.len(), 2);
        for basin in &d.basins {
            assert!((basin.months.iter().map(|m| m.inflow).sum::<f64>() - 120000.0).abs() < 1e-6);
        }
        assert!((d.budget.ocean_outflow - 120000.0).abs() < 1e-6);
        for river in d.rivers(cols, 1.0, 1.0) {
            assert!((river.monthly_flow.iter().sum::<f64>() - river.annual_flow).abs() < 1e-6);
            assert!(
                river
                    .points
                    .windows(2)
                    .all(|p| (p[0].x - p[1].x).hypot(p[0].y - p[1].y) <= 2.0f64.sqrt() + 1e-9)
            );
        }
        check_routing(&d);
    }

    // Routing tests supply an explicit balanced local water source, independent
    // of the climate model (which has its own snow/soil conservation tests).
    fn inputs(rain: &[f64], pet: &[f64]) -> Vec<ClimateProfile> {
        rain.iter()
            .zip(pet)
            .map(|(&p, &demand)| {
                let evapotranspiration = p.min(demand * 0.72);
                ClimateProfile {
                    months: std::array::from_fn(|_| crate::seasonal::MonthClimate {
                        precipitation_mm: p / 12.0,
                        evapotranspiration_mm: evapotranspiration / 12.0,
                        potential_evapotranspiration_mm: demand / 12.0,
                        recharge_mm: (p - evapotranspiration) * 0.25 / 12.0,
                        runoff_mm: (p - evapotranspiration) * 0.75 / 12.0,
                        ..crate::seasonal::MonthClimate::default()
                    }),
                    ..ClimateProfile::default()
                }
            })
            .collect()
    }

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
        let pet = vec![700.0; cols * rows];
        let d = drain(&elevation, &inputs(&rain, &pet), cols, rows);
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
            (b.generated_runoff
                - b.lake_evaporation
                - b.ocean_outflow
                - b.boundary_outflow
                - b.lake_storage_change)
                .abs()
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
            &inputs(&vec![6000.0; cols * rows], &vec![600.0; cols * rows]),
            cols,
            rows,
        );
        assert!(!wet.lake_groups.is_empty());
        let dry = drain(
            &elevation,
            &inputs(&vec![0.0; cols * rows], &vec![1400.0; cols * rows]),
            cols,
            rows,
        );
        assert!(dry.lake_groups.is_empty());
        assert!(dry.flow.iter().all(|f| *f == 0.0));
    }
}
