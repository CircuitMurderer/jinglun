//! Synthetic Earth-like temperature normals and radiation-limited evaporative
//! demand. No measured weather, ocean-current heat transport or energy solver.
use std::f64::consts::{PI, TAU};

#[derive(Clone, Debug)]
pub(crate) struct ThermalProfile {
    pub mean_c: f64,
    pub continentality: f64,
    pub temperature_c: [f64; 12],
    pub pet_mm: [f64; 12],
}

pub(crate) fn mean_temperature(latitude: f64, elevation: f64, continentality: f64) -> f64 {
    let lat = latitude.abs();
    28.0 - 52.0 * (lat / 90.0).powf(1.7)
        - 3.0 * continentality * lat.to_radians().sin()
        - elevation.max(0.0) * 0.006
}

/// Daily extraterrestrial radiation in MJ/m², using a circular orbit, twelve
/// equal model months and June solstice. Polar night/day are handled explicitly.
pub(crate) fn radiation(latitude: f64, month: usize) -> f64 {
    let phi = latitude.to_radians();
    let delta = 0.409 * (TAU * (month as f64 - 5.0) / 12.0).cos();
    let sunset = (-phi.tan() * delta.tan()).clamp(-1.0, 1.0).acos();
    ((1440.0 / PI)
        * 0.0820
        * (sunset * phi.sin() * delta.sin() + phi.cos() * delta.cos() * sunset.sin()))
    .max(0.0)
}

pub(crate) fn solar_year(latitude: f64) -> [f64; 12] {
    std::array::from_fn(|month| radiation(latitude, month))
}

impl ThermalProfile {
    pub fn new(
        mean_c: f64,
        latitude: f64,
        continentality: f64,
        rain: &[f64; 12],
        solar: &[f64; 12],
    ) -> Self {
        let amplitude = latitude.to_radians().sin() * (8.0 + 22.0 * continentality);
        let temperature_c = std::array::from_fn(|month| {
            mean_c + amplitude * (TAU * (month as f64 - 6.0) / 12.0).cos()
        });
        let pet_mm = std::array::from_fn(|month| {
            // Daily temperature range is a synthetic proxy, NOT the annual
            // summer/winter range. Rain provides a bounded cloudiness proxy.
            let daily_range =
                (8.0 + 8.0 * continentality) * (1.0 - 0.25 * (rain[month] / 150.0).clamp(0.0, 1.0));
            // FAO-56 Eq. 52 uses Ra in mm/day, not MJ/m²/day: convert by 0.408.
            // Each model month has 30 days, consistent with the water buckets.
            0.0023
                * (temperature_c[month] + 17.8).max(0.0)
                * daily_range.sqrt()
                * solar[month]
                * 0.408
                * 30.0
        });
        Self {
            mean_c,
            continentality,
            temperature_c,
            pet_mm,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn latitude_anchors_lapse_rate_and_coastal_temperature_range_are_calibrated() {
        for (lat, low, high) in [
            (0.0, 27.0, 29.0),
            (30.0, 19.0, 21.0),
            (45.0, 11.0, 13.0),
            (60.0, 1.0, 3.0),
            (75.0, -11.0, -9.0),
        ] {
            let temp = mean_temperature(lat, 0.0, 0.0);
            assert!((low..high).contains(&temp), "{lat}°: {temp}");
            assert!((temp - mean_temperature(lat, 1000.0, 0.0) - 6.0).abs() < 1e-10);
        }
        let solar = solar_year(45.0);
        let coast = ThermalProfile::new(12.0, 45.0, 0.0, &[75.0; 12], &solar);
        let inland = ThermalProfile::new(10.0, 45.0, 1.0, &[75.0; 12], &solar);
        assert!(coast.temperature_c[0] > inland.temperature_c[0]);
        assert!(coast.temperature_c[6] < inland.temperature_c[6]);
        for p in [&coast, &inland] {
            assert!((p.temperature_c.iter().sum::<f64>() / 12.0 - p.mean_c).abs() < 1e-10);
        }
    }

    #[test]
    fn solar_energy_and_pet_respect_units_polar_night_and_hemisphere_seasons() {
        // About 37.6 MJ/m²/day at the equator on an equinox; 0.408 converts
        // energy to a water-equivalent depth, preventing a 2.45× PET error.
        assert!((radiation(0.0, 2) - 37.587).abs() < 0.02);
        assert_eq!(radiation(75.0, 11), 0.0);
        assert!(radiation(75.0, 5) > 40.0);
        let north = ThermalProfile::new(12.0, 45.0, 0.3, &[75.0; 12], &solar_year(45.0));
        let south = ThermalProfile::new(12.0, -45.0, 0.3, &[75.0; 12], &solar_year(-45.0));
        for m in 0..12 {
            assert!((north.pet_mm[m] - south.pet_mm[(m + 6) % 12]).abs() < 1e-8);
            assert!((north.temperature_c[m] - south.temperature_c[(m + 6) % 12]).abs() < 1e-8);
        }
        assert!(north.pet_mm[6] > north.pet_mm[0] * 3.0);
        assert!((500.0..1300.0).contains(&north.pet_mm.iter().sum::<f64>()));
        let frozen = ThermalProfile::new(-40.0, 75.0, 0.0, &[0.0; 12], &solar_year(75.0));
        assert!(frozen.pet_mm.iter().all(|v| v.is_finite() && *v == 0.0));
    }
}
