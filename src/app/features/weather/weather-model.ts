/**
 * The farm's weather, from Open-Meteo (open data, no key): what it is now, and a timeline of days, the last two weeks
 * (from its model of what happened) and the next week (the forecast). Pure: the page fetches and draws what this makes.
 * Only the farm's approximate place goes out (rounded to about a kilometre), nothing else.
 *
 * Besides the weather itself, what a farm reads from it: growing degree days for chili, the soil's warmth and wetness,
 * how long the leaves stay wet, the hours fit to spray, the sun, and warnings drawn from the forecast. Soil and leaf
 * wetness are Open-Meteo's model estimates, not a sensor in the field.
 */

export const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
export const PAST_DAYS = 14;
export const NEXT_DAYS = 7;

export interface Place {
  lat: number;
  lng: number;
}

export interface Now {
  time: string;
  temperature: number | null;
  feels: number | null;
  humidity: number | null;
  rain: number | null;
  wind: number | null;
  code: number | null;
  /** Where the wind comes from (degrees, 0 = north). */
  windDir: number | null;
  gusts: number | null;
  /** Cloud cover (%). */
  cloud: number | null;
  /** Sunlight on the ground now (W/m²). */
  solar: number | null;
  uv: number | null;
  /** The soil 6 cm down (°C). */
  soilTemp: number | null;
  /** Water in the top soil, 3 to 9 cm (% by volume). */
  soilMoisture: number | null;
}

/** An hour of the forecast: what spraying and the leaves depend on. */
export interface Hour {
  /** yyyy-mm-ddThh:mm, the farm's own time. */
  time: string;
  temperature: number | null;
  /** The wet-bulb temperature: the air cooled by evaporating water (°C); Delta-T is temperature minus this. */
  wetBulb: number | null;
  wind: number | null;
  rain: number | null;
  chance: number | null;
  /** The chance the leaves are wet (%). */
  leafWet: number | null;
  soilTemp: number | null;
  soilMoisture: number | null;
  /** Water 9 to 27 cm down, where most roots are (% by volume). */
  soilDeep: number | null;
  day: boolean;
}

export interface Day {
  /** yyyy-mm-dd, the farm's own day. */
  date: string;
  code: number | null;
  max: number | null;
  min: number | null;
  /** Rain over the day (mm). */
  rain: number | null;
  /** The chance of rain (%), only a forecast has one. */
  chance: number | null;
  /** The strongest wind (km/h). */
  wind: number | null;
  past: boolean;
  today: boolean;
  /** The warmest it felt (°C). */
  feels: number | null;
  /** Mean relative humidity (%). */
  humidity: number | null;
  dewPoint: number | null;
  /** The most the air wanted to dry the leaves (vapour pressure deficit, kPa). */
  vpd: number | null;
  /** Mean chance the leaves were wet (%). */
  leafWet: number | null;
  /** Hours the leaves were more likely wet than not. */
  wetHours: number | null;
  /** Water a reference crop gives off (ET₀, mm): what the field loses to the air. */
  et0: number | null;
  /** Sunlight over the day (MJ/m²). */
  solar: number | null;
  /** Hours of sunshine. */
  sunHours: number | null;
  uv: number | null;
  /** Mean cloud cover (%). */
  cloud: number | null;
  windMean: number | null;
  gusts: number | null;
  /** Where the wind mostly came from (degrees). */
  windDir: number | null;
  /** Growing degree days for chili (base 10 °C, cap 30 °C). */
  gdd: number | null;
  /** The day's mean soil warmth (6 cm) and water (3 to 9 cm, 9 to 27 cm, % by volume). */
  soilTemp: number | null;
  soilMoisture: number | null;
  soilDeep: number | null;
}

export interface Weather {
  /** The shape this was saved in: a saved reading of another version is read again. */
  version: number;
  place: Place;
  timezone: string;
  now: Now | null;
  days: Day[];
  hours: Hour[];
  /** When it was read (ISO). */
  fetchedAt: string;
}

/** Bumped when Weather gains or changes a field, so a reading saved before is not shown without it. */
export const WEATHER_VERSION = 2;

/** Chili's growing degree days: no growth under 10 °C, none added above 30 °C. */
export const GDD_BASE = 10;
export const GDD_CAP = 30;

/**
 * What makes an hour fit to spray (a guide, as GRDC's spray advice): a steady light wind (under 3 km/h the mist hangs
 * and drifts, often under an inversion; over 15 km/h it blows away), Delta-T 2 to 8 °C (under 2 the drops stay wet and
 * run off; over 8 they dry before they land), daylight, and no rain in it or likely in the hour after.
 */
export const SPRAY = { windMin: 3, windMax: 15, deltaTMin: 2, deltaTMax: 8, rainChance: 40 } as const;

/** Leaves count as wet in an hour when the chance is at least this (%). */
export const LEAF_WET = 50;

/** Warnings from the forecast: heavy and very heavy rain over a day (mm, as the Thai Meteorological Department grades it), gusts from a near gale (Beaufort 7), heat chili's fruit set suffers in, frost. */
export const ALERT = { heavyRain: 35, veryHeavyRain: 90, gusts: 50, heat: 35, frost: 2 } as const;

/** The place sent to Open-Meteo: about a kilometre, which is all a forecast can tell apart. */
export function roundedPlace(place: Place): Place {
  return { lat: Math.round(place.lat * 100) / 100, lng: Math.round(place.lng * 100) / 100 };
}

export function forecastUrl(place: Place): string {
  const at = roundedPlace(place);
  const query = new URLSearchParams({
    latitude: String(at.lat),
    longitude: String(at.lng),
    timezone: 'auto',
    past_days: String(PAST_DAYS),
    forecast_days: String(NEXT_DAYS + 1),
    current: [
      'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m',
      'wind_direction_10m,wind_gusts_10m,cloud_cover,shortwave_radiation,uv_index,soil_temperature_6cm,soil_moisture_3_to_9cm',
    ].join(','),
    daily: [
      'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max',
      'apparent_temperature_max,relative_humidity_2m_mean,dew_point_2m_mean,vapour_pressure_deficit_max,leaf_wetness_probability_mean',
      'et0_fao_evapotranspiration,shortwave_radiation_sum,sunshine_duration,uv_index_max,cloud_cover_mean',
      'wind_speed_10m_mean,wind_gusts_10m_max,wind_direction_10m_dominant',
    ].join(','),
    hourly: [
      'temperature_2m,wet_bulb_temperature_2m,wind_speed_10m,precipitation,precipitation_probability,leaf_wetness_probability',
      'soil_temperature_6cm,soil_moisture_3_to_9cm,soil_moisture_9_to_27cm,is_day',
    ].join(','),
  });
  return `${FORECAST_URL}?${query}`;
}

type Series = (number | null)[] | undefined;
const at = (series: Series, index: number): number | null => {
  const value = series?.[index];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

/** Soil water comes as m³ of water in a m³ of soil: as a percentage by volume, to a tenth. */
const percent = (value: number | null) => (value === null ? null : Math.round(value * 1000) / 10);

/** Chili's growing degree days for a day: its warmest held to 30 °C and coolest to at least 10 °C, their mean above 10 °C. */
export function degreeDays(max: number | null, min: number | null): number | null {
  if (max === null || min === null) return null;
  const high = Math.min(Math.max(max, GDD_BASE), GDD_CAP);
  const low = Math.min(Math.max(min, GDD_BASE), GDD_CAP);
  return Math.round(Math.max(0, (high + low) / 2 - GDD_BASE) * 10) / 10;
}

const mean = (values: (number | null)[]): number | null => {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : null;
};

/** Open-Meteo's answer as the page shows it; null when it is not one (no days in it). */
export function parseWeather(json: unknown, place: Place, fetchedAt = new Date().toISOString()): Weather | null {
  const body = json as {
    timezone?: string;
    current?: Record<string, unknown>;
    daily?: { time?: string[] } & Record<string, Series | string[]>;
    hourly?: { time?: string[] } & Record<string, Series | string[]>;
  } | null;
  const times = body?.daily?.time;
  if (!body || !Array.isArray(times) || !times.length) return null;
  const daily = body.daily as Record<string, Series>;
  const current = body.current;
  const num = (key: string): number | null => {
    const value = current?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };
  const nowTime = typeof current?.['time'] === 'string' ? (current['time'] as string) : '';
  const today = nowTime.slice(0, 10) || times[Math.min(PAST_DAYS, times.length - 1)];
  const hourly = (body.hourly ?? {}) as Record<string, Series>;
  const hourTimes = Array.isArray(body.hourly?.time) ? body.hourly.time : [];
  const hours: Hour[] = hourTimes.map((time, index) => ({
    time,
    temperature: at(hourly['temperature_2m'], index),
    wetBulb: at(hourly['wet_bulb_temperature_2m'], index),
    wind: at(hourly['wind_speed_10m'], index),
    rain: at(hourly['precipitation'], index),
    chance: at(hourly['precipitation_probability'], index),
    leafWet: at(hourly['leaf_wetness_probability'], index),
    soilTemp: at(hourly['soil_temperature_6cm'], index),
    soilMoisture: percent(at(hourly['soil_moisture_3_to_9cm'], index)),
    soilDeep: percent(at(hourly['soil_moisture_9_to_27cm'], index)),
    day: at(hourly['is_day'], index) !== 0,
  }));
  const byDay = new Map<string, Hour[]>();
  for (const hour of hours) {
    const date = hour.time.slice(0, 10);
    byDay.set(date, [...(byDay.get(date) ?? []), hour]);
  }
  const tenth = (value: number | null) => (value === null ? null : Math.round(value * 10) / 10);
  return {
    version: WEATHER_VERSION,
    place: roundedPlace(place),
    timezone: body.timezone ?? '',
    now: current
      ? {
          time: nowTime,
          temperature: num('temperature_2m'),
          feels: num('apparent_temperature'),
          humidity: num('relative_humidity_2m'),
          rain: num('precipitation'),
          wind: num('wind_speed_10m'),
          code: num('weather_code'),
          windDir: num('wind_direction_10m'),
          gusts: num('wind_gusts_10m'),
          cloud: num('cloud_cover'),
          solar: num('shortwave_radiation'),
          uv: num('uv_index'),
          soilTemp: num('soil_temperature_6cm'),
          soilMoisture: percent(num('soil_moisture_3_to_9cm')),
        }
      : null,
    days: times.map((date, index) => {
      const max = at(daily['temperature_2m_max'], index);
      const min = at(daily['temperature_2m_min'], index);
      const sunshine = at(daily['sunshine_duration'], index);
      const its = byDay.get(date) ?? [];
      const leaves = its.filter((hour) => hour.leafWet !== null);
      return {
        date,
        code: at(daily['weather_code'], index),
        max,
        min,
        rain: at(daily['precipitation_sum'], index),
        chance: date >= today ? at(daily['precipitation_probability_max'], index) : null,
        wind: at(daily['wind_speed_10m_max'], index),
        past: date < today,
        today: date === today,
        feels: at(daily['apparent_temperature_max'], index),
        humidity: at(daily['relative_humidity_2m_mean'], index),
        dewPoint: at(daily['dew_point_2m_mean'], index),
        vpd: at(daily['vapour_pressure_deficit_max'], index),
        leafWet: at(daily['leaf_wetness_probability_mean'], index),
        wetHours: leaves.length ? leaves.filter((hour) => (hour.leafWet ?? 0) >= LEAF_WET).length : null,
        et0: at(daily['et0_fao_evapotranspiration'], index),
        solar: at(daily['shortwave_radiation_sum'], index),
        sunHours: sunshine === null ? null : Math.round(sunshine / 360) / 10,
        uv: at(daily['uv_index_max'], index),
        cloud: at(daily['cloud_cover_mean'], index),
        windMean: at(daily['wind_speed_10m_mean'], index),
        gusts: at(daily['wind_gusts_10m_max'], index),
        windDir: at(daily['wind_direction_10m_dominant'], index),
        gdd: degreeDays(max, min),
        soilTemp: tenth(mean(its.map((hour) => hour.soilTemp))),
        soilMoisture: tenth(mean(its.map((hour) => hour.soilMoisture))),
        soilDeep: tenth(mean(its.map((hour) => hour.soilDeep))),
      };
    }),
    hours,
    fetchedAt,
  };
}

/** A saved reading this version of the page can show (not one saved before it had the farm's readings). */
export function isCurrent(weather: unknown): weather is Weather {
  const saved = weather as Partial<Weather> | null;
  return !!saved && saved.version === WEATHER_VERSION && Array.isArray(saved.days) && Array.isArray(saved.hours);
}

/** Where the wind comes from, as a compass point (the web's eight). */
export function compass(degrees: number | null): string {
  if (degrees === null || !Number.isFinite(degrees)) return '—';
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(degrees / 45) % 8];
}

/** The degree days added up over some days (a missing day adds none). */
export function degreeDaysOver(days: readonly Day[]): number {
  return Math.round(days.reduce((sum, day) => sum + (day.gdd ?? 0), 0));
}

/** Rain less the water the field gives off (ET₀) over some days: below nothing, the crop needs water the rain did not bring. */
export function waterBalance(days: readonly Day[]): number {
  return Math.round(days.reduce((sum, day) => sum + (day.rain ?? 0) - (day.et0 ?? 0), 0) * 10) / 10;
}

/** How likely a fungal disease (anthracnose, leaf spots) is to take hold on a day: long-wet leaves in warm air. A guide only. */
export function diseaseRisk(day: Day): 'high' | 'some' | 'low' | null {
  if (day.wetHours === null) return null;
  const warm = day.max !== null && day.min !== null && (day.max + day.min) / 2 >= 20 && (day.max + day.min) / 2 <= 30;
  if (day.wetHours >= 12 && warm) return 'high';
  if (day.wetHours >= 6) return 'some';
  return 'low';
}

/** Delta-T: how far the air is above its wet-bulb (°C), how fast a drop dries. */
export function deltaT(hour: Hour): number | null {
  return hour.temperature === null || hour.wetBulb === null ? null : Math.round((hour.temperature - hour.wetBulb) * 10) / 10;
}

/** Why an hour is not fit to spray, or null when it is. The hour after counts for rain (the spray needs time to dry on). */
export function sprayBlock(hour: Hour, next: Hour | null): string | null {
  if (!hour.day) return 'Dark';
  if ((hour.rain ?? 0) > 0 || (next?.rain ?? 0) > 0) return 'Rain';
  if ((hour.chance ?? 0) >= SPRAY.rainChance || (next?.chance ?? 0) >= SPRAY.rainChance) return 'Rain likely';
  if (hour.wind === null) return 'No wind reading';
  if (hour.wind < SPRAY.windMin) return 'Too calm: the mist hangs and drifts';
  if (hour.wind > SPRAY.windMax) return 'Too windy';
  const dt = deltaT(hour);
  if (dt === null) return 'No Delta-T reading';
  if (dt < SPRAY.deltaTMin) return 'Too damp: drops run off';
  if (dt > SPRAY.deltaTMax) return 'Too dry: drops dry before they land';
  return null;
}

export interface SprayHour {
  time: string;
  ok: boolean;
  why: string | null;
  wind: number | null;
  deltaT: number | null;
}

/** The hours from the one now holds, each fit to spray or why not. */
export function sprayHours(hours: readonly Hour[], from: string, count = 24): SprayHour[] {
  const start = hours.findIndex((hour) => hour.time.slice(0, 13) >= from.slice(0, 13));
  if (start < 0) return [];
  return hours.slice(start, start + count).map((hour, index) => {
    const why = sprayBlock(hour, hours[start + index + 1] ?? null);
    return { time: hour.time, ok: why === null, why, wind: hour.wind, deltaT: deltaT(hour) };
  });
}

/** The runs of hours fit to spray: from the first such hour to the end of the last. */
export function sprayWindows(hours: readonly SprayHour[]): { start: string; end: string; hours: number }[] {
  const windows: { start: string; end: string; hours: number }[] = [];
  for (const hour of hours) {
    const last = windows[windows.length - 1];
    const after = new Date(Date.parse(`${hour.time}:00Z`) + 3_600_000).toISOString().slice(0, 16);
    if (!hour.ok) continue;
    if (last && last.end === hour.time) {
      last.end = after;
      last.hours++;
    } else {
      windows.push({ start: hour.time, end: after, hours: 1 });
    }
  }
  return windows;
}

export interface Alert {
  kind: 'hail' | 'storm' | 'flood' | 'rain' | 'gusts' | 'heat' | 'frost';
  level: 'danger' | 'warning';
  title: string;
  detail: string;
  /** The days it is forecast for, in order. */
  dates: string[];
}

const ALERT_TEXT: Record<Alert['kind'], { level: Alert['level']; title: (worst: number, many: boolean) => string; detail: string }> = {
  hail: { level: 'danger', title: () => 'Thunderstorm with hail', detail: 'Hail can tear leaves and fruit: pick what is ripe first, and keep people out of the field while it passes.' },
  storm: { level: 'warning', title: () => 'Thunderstorm', detail: 'Lightning and sudden hard rain: keep people out of the open field while it passes.' },
  flood: { level: 'danger', title: (mm, many) => `Very heavy rain, ${many ? 'up to ' : ''}${Math.round(mm)} mm`, detail: 'Flooding and waterlogged beds are likely: clear the drains; hold off fertiliser and spraying.' },
  rain: { level: 'warning', title: (mm, many) => `Heavy rain, ${many ? 'up to ' : ''}${Math.round(mm)} mm`, detail: 'Water may stand in the beds: check the drains; spray and fertiliser would wash off.' },
  gusts: { level: 'warning', title: (kmh, many) => `Strong gusts, ${many ? 'up to ' : ''}${Math.round(kmh)} km/h`, detail: 'Plants and shade nets can be blown over: stake and tie down, and do not spray.' },
  heat: { level: 'warning', title: (deg, many) => `Heat, ${many ? 'up to ' : ''}${Math.round(deg)}°`, detail: 'Above 35° chili drops its flowers and sets less fruit: water early in the day.' },
  frost: { level: 'danger', title: (deg, many) => `Frost risk, ${many ? 'down to ' : ''}${Math.round(deg)}°`, detail: 'Cover young plants overnight.' },
};

/** Warnings drawn from the forecast (today on), one for each kind with the days it falls on: storms, heavy rain, strong gusts, heat, frost. Not an official warning. */
export function alertsOf(days: readonly Day[]): Alert[] {
  const found = new Map<Alert['kind'], { dates: string[]; worst: number }>();
  const hit = (kind: Alert['kind'], date: string, value: number, worse: (a: number, b: number) => boolean = (a, b) => a > b) => {
    const seen = found.get(kind);
    if (!seen) found.set(kind, { dates: [date], worst: value });
    else {
      seen.dates.push(date);
      if (worse(value, seen.worst)) seen.worst = value;
    }
  };
  for (const day of days.filter((item) => !item.past)) {
    if (day.code === 96 || day.code === 99) hit('hail', day.date, 0);
    else if (day.code === 95) hit('storm', day.date, 0);
    if ((day.rain ?? 0) >= ALERT.veryHeavyRain) hit('flood', day.date, day.rain!);
    else if ((day.rain ?? 0) >= ALERT.heavyRain) hit('rain', day.date, day.rain!);
    if ((day.gusts ?? 0) >= ALERT.gusts) hit('gusts', day.date, day.gusts!);
    if ((day.max ?? -99) >= ALERT.heat) hit('heat', day.date, day.max!);
    if ((day.min ?? 99) <= ALERT.frost) hit('frost', day.date, day.min!, (a, b) => a < b);
  }
  return [...found].map(([kind, { dates, worst }]) => ({
    kind,
    level: ALERT_TEXT[kind].level,
    title: ALERT_TEXT[kind].title(worst, dates.length > 1),
    detail: ALERT_TEXT[kind].detail,
    dates,
  }));
}

/** How strong the sun's UV is, in the WHO's words. */
export function uvWord(uv: number | null): string {
  if (uv === null) return '';
  return uv < 3 ? 'Low' : uv < 6 ? 'Moderate' : uv < 8 ? 'High' : uv < 11 ? 'Very high' : 'Extreme';
}

/** What a WMO weather code says, in a word or two. */
export function weatherWord(code: number | null): string {
  if (code === null) return '—';
  if (code === 0) return 'Clear';
  if (code === 1) return 'Mostly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 55) return 'Drizzle';
  if (code === 56 || code === 57) return 'Freezing drizzle';
  if (code === 61) return 'Light rain';
  if (code === 63) return 'Rain';
  if (code === 65) return 'Heavy rain';
  if (code === 66 || code === 67) return 'Freezing rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code === 80) return 'Light showers';
  if (code === 81) return 'Showers';
  if (code === 82) return 'Heavy showers';
  if (code === 85 || code === 86) return 'Snow showers';
  if (code === 95) return 'Thunderstorm';
  if (code === 96 || code === 99) return 'Thunderstorm, hail';
  return 'Weather';
}

/** The mm of rain over some days (a missing day counts as none). */
export function rainOver(days: readonly Day[]): number {
  return Math.round(days.reduce((sum, day) => sum + (day.rain ?? 0), 0) * 10) / 10;
}

/** The scale the day columns share: the lowest and highest temperature in view, and the most rain of a day. */
export function scaleOf(days: readonly Day[]): { low: number; high: number; rain: number } {
  const temps = days.flatMap((day) => [day.min, day.max]).filter((value): value is number => value !== null);
  const low = temps.length ? Math.floor(Math.min(...temps)) : 0;
  const high = temps.length ? Math.ceil(Math.max(...temps)) : 1;
  const rain = Math.max(1, ...days.map((day) => day.rain ?? 0));
  return { low, high: high === low ? low + 1 : high, rain };
}
