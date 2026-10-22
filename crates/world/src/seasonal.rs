//! Monthly climate normals and a conservative reference-year land water bucket.
//! This is a game-scale climatology, not weather, a crop model or a glacier model.
use serde::Serialize;
use std::f64::consts::TAU;

#[derive(Clone, Copy, Debug, Default, Serialize, PartialEq)]
pub struct MonthClimate {
    pub temperature_c: f64,
    pub precipitation_mm: f64,
    pub snowfall_mm: f64,
    pub snowmelt_mm: f64,
    pub potential_evapotranspiration_mm: f64,
    pub evapotranspiration_mm: f64,
    pub runoff_mm: f64,
    pub recharge_mm: f64,
    pub soil_water_mm: f64,
}

#[derive(Clone, Debug, Default, Serialize, PartialEq)]
pub struct ClimateProfile {
    /// January to December; all depths are water equivalents, not snow depth.
    pub months: [MonthClimate; 12],
    pub continentality: f64,
    pub growing_months: f64,
    pub rainfed_months: f64,
    pub cold_months: f64,
    pub snow_storage_change_mm: f64,
    pub soil_storage_change_mm: f64,
}

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct WaterInput {
    pub precipitation: f64,
    pub evapotranspiration: f64,
    pub recharge: f64,
    pub runoff: f64,
    pub snow_storage_change: f64,
    pub soil_storage_change: f64,
}

impl ClimateProfile {
    pub(crate) fn add(&mut self, other: &Self) {
        for (a, b) in self.months.iter_mut().zip(&other.months) {
            a.temperature_c += b.temperature_c;
            a.precipitation_mm += b.precipitation_mm;
            a.snowfall_mm += b.snowfall_mm;
            a.snowmelt_mm += b.snowmelt_mm;
            a.potential_evapotranspiration_mm += b.potential_evapotranspiration_mm;
            a.evapotranspiration_mm += b.evapotranspiration_mm;
            a.runoff_mm += b.runoff_mm;
            a.recharge_mm += b.recharge_mm;
            a.soil_water_mm += b.soil_water_mm;
        }
        self.continentality += other.continentality;
        self.growing_months += other.growing_months;
        self.rainfed_months += other.rainfed_months;
        self.cold_months += other.cold_months;
        self.snow_storage_change_mm += other.snow_storage_change_mm;
        self.soil_storage_change_mm += other.soil_storage_change_mm;
    }

    pub(crate) fn average(&mut self, count: f64) {
        for m in &mut self.months {
            m.temperature_c /= count;
            m.precipitation_mm /= count;
            m.snowfall_mm /= count;
            m.snowmelt_mm /= count;
            m.potential_evapotranspiration_mm /= count;
            m.evapotranspiration_mm /= count;
            m.runoff_mm /= count;
            m.recharge_mm /= count;
            m.soil_water_mm /= count;
        }
        self.continentality /= count;
        self.growing_months /= count;
        self.rainfed_months /= count;
        self.cold_months /= count;
        self.snow_storage_change_mm /= count;
        self.soil_storage_change_mm /= count;
    }

    pub(crate) fn water(&self) -> WaterInput {
        WaterInput {
            precipitation: self.months.iter().map(|m| m.precipitation_mm).sum(),
            evapotranspiration: self.months.iter().map(|m| m.evapotranspiration_mm).sum(),
            recharge: self.months.iter().map(|m| m.recharge_mm).sum(),
            runoff: self.months.iter().map(|m| m.runoff_mm).sum(),
            snow_storage_change: self.snow_storage_change_mm,
            soil_storage_change: self.soil_storage_change_mm,
        }
    }

    pub(crate) fn pet(&self) -> f64 {
        self.months
            .iter()
            .map(|m| m.potential_evapotranspiration_mm)
            .sum()
    }

    pub(crate) fn warmest(&self) -> f64 {
        self.months
            .iter()
            .map(|m| m.temperature_c)
            .fold(f64::NEG_INFINITY, f64::max)
    }

    /// Eight favorable months saturate this generic annual opportunity index.
    /// The irrigated gap still needs an actual water source and infrastructure.
    pub(crate) fn crop_opportunity(&self) -> (f64, f64) {
        let (mut rainfed, mut deficit) = (0.0, 0.0);
        for m in &self.months {
            let heat = ((m.temperature_c - 3.0) / 12.0).clamp(0.0, 1.0)
                * ((40.0 - m.temperature_c) / 12.0).clamp(0.0, 1.0);
            let water = if m.potential_evapotranspiration_mm > 0.0 {
                (m.evapotranspiration_mm / m.potential_evapotranspiration_mm).clamp(0.0, 1.0)
            } else {
                0.0
            };
            rainfed += heat * water;
            deficit += heat * (1.0 - water);
        }
        ((rainfed / 8.0).min(1.0), (deficit / 8.0).min(1.0))
    }
}

pub(crate) fn normals(
    mean_c: f64,
    annual_rain: f64,
    latitude: f64,
    continentality: f64,
    capacity: f64,
) -> ClimateProfile {
    let mut result = ClimateProfile {
        continentality,
        ..ClimateProfile::default()
    };
    let signed_latitude = latitude.to_radians().sin();
    let equatorial = (-(latitude / 14.0).powi(2)).exp();
    let subtropical = (-((latitude.abs() - 30.0) / 12.0).powi(2)).exp();
    let mut weights = [0.0; 12];
    for (month, weight) in weights.iter_mut().enumerate() {
        let season = (TAU * (month as f64 - 6.0) / 12.0).cos();
        // The signed latitude reverses hemispheres continuously at the equator.
        let local_summer = season * (latitude / 12.0).tanh();
        result.months[month].temperature_c =
            mean_c + 22.0 * signed_latitude * (0.35 + 0.65 * continentality) * season;
        *weight = (1.0
            + local_summer
                * (1.0 - equatorial)
                * (0.65 * (0.3 + 0.7 * continentality)
                    - 0.35 * subtropical * (1.0 - continentality))
            + equatorial * 0.35 * (TAU * 2.0 * (month as f64 - 3.0) / 12.0).cos())
        .max(0.1);
        let m = &mut result.months[month];
        m.potential_evapotranspiration_mm = (25.0 + (m.temperature_c + 5.0).max(0.0) * 3.0)
            * (1.0 + 0.65 * signed_latitude * season);
    }
    let total: f64 = weights.iter().sum();
    let mut melt_capacity = [0.0; 12];
    for (month, m) in result.months.iter_mut().enumerate() {
        m.precipitation_mm = annual_rain * weights[month] / total;
        m.snowfall_mm = m.precipitation_mm * ((2.0 - m.temperature_c) / 4.0).clamp(0.0, 1.0);
        // A bounded degree-day proxy, 1.5 mm / °C / day over 30 model days.
        melt_capacity[month] = m.temperature_c.max(0.0) * 45.0;
    }
    let annual_snow: f64 = result.months.iter().map(|m| m.snowfall_mm).sum();
    let annual_melt: f64 = melt_capacity.iter().sum();
    let mut suffix = 0.0f64;
    let mut initial_snow = 0.0f64;
    for month in (0..12).rev() {
        suffix += result.months[month].snowfall_mm - melt_capacity[month];
        initial_snow = initial_snow.max(suffix);
    }
    if annual_snow > annual_melt {
        // Perennial accumulation has no periodic fixed point. Use a finite
        // reference reserve that can supply the year's melt, and report gain;
        // this is not an estimate of historical glacier thickness.
        initial_snow = annual_melt;
    }
    let mut snow = initial_snow;
    let mut liquid = [0.0; 12];
    for (month, m) in result.months.iter_mut().enumerate() {
        snow += m.snowfall_mm;
        m.snowmelt_mm = snow.min(melt_capacity[month]);
        snow -= m.snowmelt_mm;
        liquid[month] = m.precipitation_mm - m.snowfall_mm + m.snowmelt_mm;
    }
    result.snow_storage_change_mm = snow - initial_snow;

    // Reuse last year's soil reserve until the reference cycle converges. Any
    // residual storage change is kept in the budget, never silently discarded.
    let cycle = |initial: f64, months: &mut [MonthClimate; 12]| {
        let mut soil = initial;
        for (month, m) in months.iter_mut().enumerate() {
            let available = soil + liquid[month];
            m.evapotranspiration_mm = available.min(m.potential_evapotranspiration_mm);
            let remaining = available - m.evapotranspiration_mm;
            let excess = (remaining - capacity).max(0.0);
            let retained = remaining.min(capacity);
            m.recharge_mm = excess * 0.25 + retained * 0.03;
            m.runoff_mm = excess * 0.75;
            soil = retained * 0.97;
            m.soil_water_mm = soil;
        }
        soil
    };
    let mut initial_soil = capacity * 0.5;
    for _ in 0..64 {
        let next = cycle(initial_soil, &mut result.months);
        if (next - initial_soil).abs() < 1e-8 {
            break;
        }
        initial_soil = next;
    }
    result.soil_storage_change_mm = cycle(initial_soil, &mut result.months) - initial_soil;
    for m in &result.months {
        let growing = (5.0..=35.0).contains(&m.temperature_c);
        result.growing_months += f64::from(growing);
        result.rainfed_months += f64::from(
            growing && m.evapotranspiration_mm >= m.potential_evapotranspiration_mm * 0.5,
        );
        result.cold_months += f64::from(m.temperature_c < 0.0);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    fn check_budget(p: &ClimateProfile) {
        let w = p.water();
        assert!(
            (w.precipitation
                - w.evapotranspiration
                - w.recharge
                - w.runoff
                - w.snow_storage_change
                - w.soil_storage_change)
                .abs()
                < 1e-7
        );
        for m in &p.months {
            assert!(m.runoff_mm >= 0.0 && m.soil_water_mm >= 0.0 && m.snowmelt_mm >= 0.0);
        }
    }
    #[test]
    fn hemispheres_reverse_seasons_coast_buffers_temperature_and_annual_rain_is_preserved() {
        let north = normals(10.0, 900.0, 45.0, 0.9, 160.0);
        let south = normals(10.0, 900.0, -45.0, 0.9, 160.0);
        let coast = normals(10.0, 900.0, 45.0, 0.05, 160.0);
        assert!(north.months[6].temperature_c > north.months[0].temperature_c);
        for month in 0..12 {
            assert!(
                (north.months[month].temperature_c - south.months[(month + 6) % 12].temperature_c)
                    .abs()
                    < 1e-10
            );
        }
        assert!(
            coast.months[6].temperature_c - coast.months[0].temperature_c
                < north.months[6].temperature_c - north.months[0].temperature_c
        );
        for p in [&north, &south, &coast] {
            assert!(
                (p.months.iter().map(|m| m.temperature_c).sum::<f64>() / 12.0 - 10.0).abs() < 1e-10
            );
            assert!((p.water().precipitation - 900.0).abs() < 1e-8);
            check_budget(p);
        }
    }
    #[test]
    fn winter_snow_is_stored_until_thaw_and_perennial_accumulation_is_accounted_for() {
        let seasonal = normals(3.0, 1200.0, 55.0, 0.8, 150.0);
        assert!(seasonal.months[0].snowfall_mm > 0.0);
        assert_eq!(seasonal.months[0].snowmelt_mm, 0.0);
        assert!(
            seasonal
                .months
                .iter()
                .any(|m| m.snowmelt_mm > m.precipitation_mm)
        );
        assert!(seasonal.snow_storage_change_mm.abs() < 1e-8);
        let frozen = normals(-30.0, 400.0, 70.0, 0.8, 150.0);
        assert!((frozen.snow_storage_change_mm - 400.0).abs() < 1e-8);
        assert_eq!(frozen.water().runoff, 0.0);
        check_budget(&seasonal);
        check_budget(&frozen);
    }
    #[test]
    fn drought_and_short_summers_constrain_growth_and_soil_stores_buffer_dry_months() {
        let humid = normals(20.0, 1800.0, 30.0, 0.6, 180.0);
        let dry = normals(20.0, 60.0, 30.0, 0.6, 180.0);
        let cold = normals(-8.0, 900.0, 60.0, 0.9, 180.0);
        let seasonal_soil = normals(15.0, 900.0, 45.0, 0.8, 180.0);
        assert!(humid.rainfed_months > dry.rainfed_months);
        assert!(humid.crop_opportunity().0 > dry.crop_opportunity().0);
        assert!(cold.growing_months < humid.growing_months);
        assert!(humid.months.iter().any(|m| m.soil_water_mm > 0.0));
        assert!(
            seasonal_soil
                .months
                .iter()
                .any(|m| m.evapotranspiration_mm
                    > m.precipitation_mm - m.snowfall_mm + m.snowmelt_mm)
        );
        for p in [
            &humid,
            &dry,
            &cold,
            &seasonal_soil,
            &normals(25.0, 0.0, 0.0, 0.0, 100.0),
        ] {
            check_budget(p);
        }
    }
}
