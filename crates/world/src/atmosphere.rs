//! Monthly game-scale climatology. Four acyclic directional streams approximate
//! a two-dimensional wind field; this is not a weather or fluid simulation.
use crate::environment::AtmosphereBudget;
use std::f64::consts::TAU;

pub(crate) struct Climate {
    pub rain: Vec<[f64; 12]>,
    pub shadow: Vec<f64>,
    pub budget: AtmosphereBudget,
}

fn smooth(value: f64, a: f64, b: f64) -> f64 {
    let x = ((value - a) / (b - a)).clamp(0.0, 1.0);
    x * x * (3.0 - 2.0 * x)
}

// A broad land/ocean thermal contrast, not the Voronoi cell boundaries. Separable
// box averaging keeps the coast gradient inexpensive and independent of tessellation.
fn land_fraction(elevation: &[f64], cols: usize, rows: usize) -> Vec<f64> {
    let mut horizontal = vec![0.0; elevation.len()];
    let mut result = horizontal.clone();
    let rx = (cols / 14).max(1);
    let ry = (rows / 14).max(1);
    let mut prefix = vec![0.0; cols.max(rows) + 1];
    for y in 0..rows {
        prefix[0] = 0.0;
        for x in 0..cols {
            prefix[x + 1] = prefix[x] + f64::from(elevation[y * cols + x] > 0.0);
        }
        for x in 0..cols {
            let (a, b) = (x.saturating_sub(rx), (x + rx + 1).min(cols));
            horizontal[y * cols + x] = (prefix[b] - prefix[a]) / (b - a) as f64;
        }
    }
    for x in 0..cols {
        prefix[0] = 0.0;
        for y in 0..rows {
            prefix[y + 1] = prefix[y] + horizontal[y * cols + x];
        }
        for y in 0..rows {
            let (a, b) = (y.saturating_sub(ry), (y + ry + 1).min(rows));
            result[y * cols + x] = (prefix[b] - prefix[a]) / (b - a) as f64;
        }
    }
    result
}

#[derive(Clone, Copy, Default)]
struct Air {
    east: f64,
    south: f64,
    horizontal: f64,
    capacity: f64,
    condensation: f64,
}

pub(crate) fn generate(elevation: &[f64], cols: usize, rows: usize) -> Climate {
    assert_eq!(elevation.len(), cols * rows);
    let land = land_fraction(elevation, cols, rows);
    let mut result = Climate {
        rain: vec![[0.0; 12]; elevation.len()],
        shadow: vec![0.0; elevation.len()],
        budget: AtmosphereBudget::default(),
    };
    let mut shadow_weight = vec![0.0; elevation.len()];
    let mut heat = vec![0.0; elevation.len()];
    let mut air = vec![Air::default(); elevation.len()];
    let mut vapor = vec![0.0; elevation.len()];
    let mut depleted = vapor.clone();
    for month in 0..12 {
        let season = (TAU * (month as f64 - 6.0) / 12.0).cos();
        // The convergence zone migrates with the seasons, rather than imposing
        // a permanently wet or dry stripe at one latitude.
        let rain_latitude = 10.0 * season;
        for (id, value) in heat.iter_mut().enumerate() {
            let latitude = 75.0 - ((id / cols) as f64 + 0.5) / rows as f64 * 150.0;
            let summer = season * (latitude / 12.0).tanh();
            *value = land[id] * summer * (-((latitude.abs() - 25.0) / 25.0).powi(2)).exp();
        }
        let (rx, ry) = ((cols / 28).max(1), (rows / 28).max(1));
        for (id, wind) in air.iter_mut().enumerate() {
            let (x, y) = (id % cols, id / cols);
            let latitude = 75.0 - (y as f64 + 0.5) / rows as f64 * 150.0;
            let lat = latitude.abs();
            let summer = season * (latitude / 12.0).tanh();
            let hx =
                heat[y * cols + (x + rx).min(cols - 1)] - heat[y * cols + x.saturating_sub(rx)];
            let hy =
                heat[(y + ry).min(rows - 1) * cols + x] - heat[y.saturating_sub(ry) * cols + x];
            let u = -1.0 + 2.0 * smooth(lat, 20.0, 40.0) - 1.3 * smooth(lat, 60.0, 75.0) + hx * 4.0;
            let v =
                ((latitude - rain_latitude) / 20.0).tanh() * 0.4 * (1.0 - smooth(lat, 35.0, 55.0))
                    + hy * 4.0;
            let tropical = (-((latitude - rain_latitude) / 14.0).powi(2)).exp();
            let subtropical = (-((lat - 28.0) / 10.0).powi(2)).exp();
            let temperate = (-((lat - 50.0) / 15.0).powi(2)).exp();
            // Warm-season convection over a heated continent can use imported
            // moisture. It never adds water to an isolated dry inland cell.
            let monsoon = summer.max(0.0) * land[id] * (-((lat - 24.0) / 20.0).powi(2)).exp();
            *wind = Air {
                east: 0.5 + 0.48 * (u * 1.5).tanh(),
                south: 0.5 + 0.48 * (v * 1.5).tanh(),
                horizontal: (u.abs() + 0.2) / (u.abs() + v.abs() + 0.4),
                // Monthly advective throughput in mm-equivalent, not the
                // instantaneous atmospheric column water content.
                capacity: 3600.0 * (1.0 - 0.7 * (lat / 90.0).powi(2)) * (1.0 + 0.15 * summer),
                condensation: (0.014 + 0.045 * tropical - 0.008 * subtropical
                    + 0.012 * temperate
                    + 0.08 * monsoon)
                    .clamp(0.004, 0.2),
            };
        }
        // Each stream has two outgoing edges and a topological traversal. Water
        // can cross latitude rows; every injected unit rains or exits the map.
        // No iteration cutoff, unreported atmospheric residue or rain scaling.
        for eastward in [true, false] {
            for southward in [true, false] {
                vapor.fill(0.0);
                depleted.fill(0.0);
                for yy in 0..rows {
                    let y = if southward { yy } else { rows - 1 - yy };
                    for xx in 0..cols {
                        let x = if eastward { xx } else { cols - 1 - xx };
                        let id = y * cols + x;
                        let wind = air[id];
                        if elevation[id] <= 0.0 {
                            let wx = if eastward { wind.east } else { 1.0 - wind.east };
                            let wy = if southward {
                                wind.south
                            } else {
                                1.0 - wind.south
                            };
                            let source = (wind.capacity * wx * wy - vapor[id]).max(0.0) * 0.8;
                            vapor[id] += source;
                            result.budget.months[month].evaporation_input += source;
                            depleted[id] = 0.0;
                        }
                        result.shadow[id] += depleted[id];
                        shadow_weight[id] += depleted[id] + vapor[id];
                        let rain = vapor[id] * wind.condensation;
                        result.rain[id][month] += rain;
                        let remaining = vapor[id] - rain;
                        let next_x = if eastward {
                            (x + 1 < cols).then_some(id + 1)
                        } else {
                            x.checked_sub(1).map(|_| id - 1)
                        };
                        let next_y = if southward {
                            (y + 1 < rows).then_some(id + cols)
                        } else {
                            y.checked_sub(1).map(|_| id - cols)
                        };
                        for (next, share) in
                            [(next_x, wind.horizontal), (next_y, 1.0 - wind.horizontal)]
                        {
                            let moving = remaining * share;
                            if let Some(next) = next {
                                let uplift =
                                    (elevation[next].max(0.0) - elevation[id].max(0.0)).max(0.0);
                                let orographic = moving * (1.0 - (-uplift / 1400.0).exp());
                                result.rain[next][month] += orographic;
                                vapor[next] += moving - orographic;
                                depleted[next] += (depleted[id] * share + orographic) * 0.98;
                            } else {
                                result.budget.months[month].boundary_export += moving;
                            }
                        }
                    }
                }
            }
        }
    }
    for (shadow, weight) in result.shadow.iter_mut().zip(shadow_weight) {
        *shadow = if weight > 0.0 {
            (*shadow / weight).clamp(0.0, 1.0)
        } else {
            0.0
        };
    }
    for (month, budget) in result.budget.months.iter_mut().enumerate() {
        budget.precipitation = result.rain.iter().map(|rain| rain[month]).sum();
        result.budget.evaporation_input += budget.evaporation_input;
        result.budget.precipitation += budget.precipitation;
        result.budget.boundary_export += budget.boundary_export;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn check_budget(climate: &Climate) {
        let b = &climate.budget;
        assert!(
            (b.evaporation_input - b.precipitation - b.boundary_export).abs()
                < b.evaporation_input.max(1.0) * 1e-10
        );
        for month in &b.months {
            assert!(
                (month.evaporation_input - month.precipitation - month.boundary_export).abs()
                    < month.evaporation_input.max(1.0) * 1e-10
            );
        }
        assert!(
            climate
                .rain
                .iter()
                .flatten()
                .all(|r| r.is_finite() && *r >= 0.0)
        );
        assert!(
            climate
                .shadow
                .iter()
                .all(|r| r.is_finite() && (0.0..=1.0).contains(r))
        );
    }

    fn continent(cols: usize, rows: usize) -> Vec<f64> {
        (0..cols * rows)
            .map(|id| {
                let (x, y) = (id % cols, id / cols);
                if x >= cols / 8 && x < cols * 7 / 8 && y >= rows / 8 && y < rows * 7 / 8 {
                    100.0
                } else {
                    -100.0
                }
            })
            .collect()
    }

    #[test]
    fn water_is_conserved_and_convection_cannot_invent_rain_without_a_source() {
        for height in [-100.0, 100.0] {
            let c = generate(&vec![height; 64 * 40], 64, 40);
            check_budget(&c);
            if height > 0.0 {
                assert_eq!(c.budget.precipitation, 0.0);
            } else {
                assert!(c.budget.precipitation > 0.0 && c.budget.boundary_export > 0.0);
            }
        }
    }

    #[test]
    fn a_meridional_coast_supplies_land_even_without_ocean_on_the_same_row() {
        let (cols, rows) = (96, 60);
        let mut elevation = vec![100.0; cols * rows];
        for y in 28..rows {
            elevation[y * cols..(y + 1) * cols].fill(-100.0);
        }
        let c = generate(&elevation, cols, rows);
        let rain: f64 = c.rain[20 * cols + cols / 2].iter().sum();
        assert!(rain > 300.0, "north/south moisture supply: {rain}");
        check_budget(&c);
    }

    #[test]
    fn summer_moisture_and_mountains_create_different_outcomes_at_the_same_latitude() {
        let (cols, rows) = (96, 60);
        let elevation = continent(cols, rows);
        let c = generate(&elevation, cols, rows);
        let coast = &c.rain[18 * cols + 79]; // 28.75° N, eastern maritime plain.
        let summer: f64 = [5, 6, 7].iter().map(|m| coast[*m]).sum();
        let winter: f64 = [11, 0, 1].iter().map(|m| coast[*m]).sum();
        let annual: f64 = coast.iter().sum();
        assert!(summer > winter * 1.5, "summer={summer}, winter={winter}");
        let mean = crate::thermal::mean_temperature(28.75, 100.0, 0.2);
        let profile = crate::seasonal::normals(mean, coast, 28.75, 0.2, 160.0);
        // A warm, seasonal coast need not have annual rainfall exceeding PET.
        // Check usable growing-season supply instead of forcing a humid label.
        assert!(annual / profile.pet() > 0.5);
        assert!(profile.rainfed_months >= 6.0);
        let interior: f64 = c.rain[18 * cols + 48].iter().sum();
        assert!(
            annual > interior * 1.4,
            "coast={annual}, interior={interior}"
        );
        let inland_profile =
            crate::seasonal::normals(mean, &c.rain[18 * cols + 48], 28.75, 0.8, 160.0);
        assert!(profile.crop_opportunity().0 > inland_profile.crop_opportunity().0 * 2.0);
        let mut mountain = elevation;
        for y in 0..rows {
            for x in 35..40 {
                if mountain[y * cols + x] > 0.0 {
                    mountain[y * cols + x] = 2500.0;
                }
            }
        }
        let m = generate(&mountain, cols, rows);
        let windward: f64 = m.rain[10 * cols + 35].iter().sum();
        let lee: f64 = m.rain[10 * cols + 45].iter().sum();
        let unblocked: f64 = c.rain[10 * cols + 45].iter().sum();
        assert!(windward > lee * 1.5, "windward={windward}, lee={lee}");
        assert!(lee < unblocked * 0.8, "lee={lee}, no barrier={unblocked}");
        assert!(m.shadow[10 * cols + 45] > c.shadow[10 * cols + 45]);
        println!(
            "subtropical coast={annual:.0}mm, interior={interior:.0}mm, summer={summer:.0}mm, winter={winter:.0}mm; windward={windward:.0}mm, lee={lee:.0}mm, unblocked={unblocked:.0}mm"
        );
        check_budget(&c);
        check_budget(&m);
    }

    #[test]
    fn hemispheres_reverse_wet_seasons_and_rain_belt_moves_with_the_sun() {
        let (cols, rows) = (64, 40);
        let c = generate(&continent(cols, rows), cols, rows);
        for y in 0..rows {
            for x in 0..cols {
                for month in 0..12 {
                    let north = c.rain[y * cols + x][month];
                    let south = c.rain[(rows - 1 - y) * cols + x][(month + 6) % 12];
                    assert!(
                        (north - south).abs() < 1e-7,
                        "{x},{y},{month}: {north} != {south}"
                    );
                }
            }
        }
        let ocean = generate(&vec![-100.0; cols * rows], cols, rows);
        let rain_center = |month: usize| {
            let mut total = 0.0;
            let mut weighted = 0.0;
            for (id, rain) in ocean.rain.iter().enumerate() {
                let lat = 75.0 - ((id / cols) as f64 + 0.5) / rows as f64 * 150.0;
                total += rain[month];
                weighted += lat * rain[month];
            }
            weighted / total
        };
        assert!(rain_center(6) > rain_center(0) + 3.0);
        check_budget(&ocean);
    }
}
