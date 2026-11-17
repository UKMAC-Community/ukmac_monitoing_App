import {
  alertsOf,
  compass,
  degreeDays,
  degreeDaysOver,
  deltaT,
  diseaseRisk,
  forecastUrl,
  isCurrent,
  parseWeather,
  rainOver,
  roundedPlace,
  scaleOf,
  sprayBlock,
  sprayHours,
  sprayWindows,
  uvWord,
  waterBalance,
  weatherWord,
  type Day,
  type Hour,
} from './weather-model';

const answer = {
  timezone: 'Asia/Phnom_Penh',
  current: { time: '2026-11-17T10:00', temperature_2m: 31.4, apparent_temperature: 36.2, relative_humidity_2m: 61, precipitation: 0, weather_code: 2, wind_speed_10m: 9.4 },
  daily: {
    time: ['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18'],
    weather_code: [63, 3, 2, 95],
    temperature_2m_max: [29, 30.2, 33, 31],
    temperature_2m_min: [23, 23.5, 24, 24.4],
    precipitation_sum: [12.4, 0, 0.2, 18],
    precipitation_probability_max: [null, null, 20, 85],
    wind_speed_10m_max: [14, 12, 15, 22],
  },
};

describe('weather model', () => {
  it('asks for about a kilometre, never the exact place, with two weeks back and a week on', () => {
    const url = new URL(forecastUrl({ lat: 12.137291, lng: 104.095321 }));
    expect(url.origin + url.pathname).toBe('https://api.open-meteo.com/v1/forecast');
    expect(url.searchParams.get('latitude')).toBe('12.14');
    expect(url.searchParams.get('longitude')).toBe('104.1');
    expect(url.searchParams.get('past_days')).toBe('14');
    expect(url.searchParams.get('forecast_days')).toBe('8');
    expect(url.searchParams.get('timezone')).toBe('auto');
    expect(roundedPlace({ lat: 12.136, lng: 104.0949 })).toEqual({ lat: 12.14, lng: 104.09 });
  });

  it('reads the answer as now and a day by day timeline, the days before today past', () => {
    const weather = parseWeather(answer, { lat: 12.137, lng: 104.095 }, '2026-11-17T03:00:00Z')!;
    expect(weather.now).toMatchObject({ temperature: 31.4, feels: 36.2, humidity: 61, wind: 9.4, code: 2 });
    expect(weather.days.map((day) => [day.date, day.past, day.today])).toEqual([
      ['2026-11-15', true, false],
      ['2026-11-16', true, false],
      ['2026-11-17', false, true],
      ['2026-11-18', false, false],
    ]);
    // Only a forecast has a chance of rain.
    expect(weather.days.map((day) => day.chance)).toEqual([null, null, 20, 85]);
    expect(weather.days[3]).toMatchObject({ max: 31, min: 24.4, rain: 18, wind: 22, code: 95 });
  });

  it('is nothing when the answer holds no days, and leaves out what is missing', () => {
    expect(parseWeather({}, { lat: 1, lng: 1 })).toBeNull();
    expect(parseWeather(null, { lat: 1, lng: 1 })).toBeNull();
    const sparse = parseWeather({ daily: { time: ['2026-11-17'], temperature_2m_max: [null] } }, { lat: 1, lng: 1 })!;
    expect(sparse.now).toBeNull();
    expect(sparse.days[0]).toMatchObject({ max: null, rain: null });
  });

  it('names the weather codes, and adds up the rain and sets the scale of the days', () => {
    expect([0, 3, 63, 81, 95, null].map(weatherWord)).toEqual(['Clear', 'Overcast', 'Rain', 'Showers', 'Thunderstorm', '—']);
    const weather = parseWeather(answer, { lat: 1, lng: 1 })!;
    expect(rainOver(weather.days.filter((day) => day.past))).toBe(12.4);
    expect(rainOver(weather.days.filter((day) => !day.past))).toBe(18.2);
    expect(scaleOf(weather.days)).toEqual({ low: 23, high: 33, rain: 18 });
  });

  it('asks for the farm readings: soil, wet leaves, sun, gusts and the hours', () => {
    const url = new URL(forecastUrl({ lat: 12.1, lng: 104.1 }));
    for (const name of ['soil_moisture_3_to_9cm', 'wind_direction_10m']) expect(url.searchParams.get('current')).toContain(name);
    for (const name of ['leaf_wetness_probability_mean', 'et0_fao_evapotranspiration', 'shortwave_radiation_sum', 'wind_gusts_10m_max']) expect(url.searchParams.get('daily')).toContain(name);
    for (const name of ['wet_bulb_temperature_2m', 'soil_moisture_9_to_27cm', 'is_day']) expect(url.searchParams.get('hourly')).toContain(name);
  });

  it('reads the soil as a percentage, the day means from its hours, and how long the leaves were wet', () => {
    const hourTimes = Array.from({ length: 24 }, (_, hour) => `2026-11-17T${String(hour).padStart(2, '0')}:00`);
    const weather = parseWeather(
      {
        current: { time: '2026-11-17T10:00', soil_moisture_3_to_9cm: 0.285, wind_direction_10m: 90 },
        daily: { time: ['2026-11-17'], temperature_2m_max: [33], temperature_2m_min: [24], sunshine_duration: [39906] },
        hourly: {
          time: hourTimes,
          leaf_wetness_probability: hourTimes.map((_, hour) => (hour < 9 ? 80 : 10)),
          soil_moisture_3_to_9cm: hourTimes.map((_, hour) => (hour < 12 ? 0.3 : 0.28)),
          is_day: hourTimes.map((_, hour) => (hour >= 6 && hour < 18 ? 1 : 0)),
        },
      },
      { lat: 1, lng: 1 },
    )!;
    expect(weather.now).toMatchObject({ soilMoisture: 28.5, windDir: 90 });
    expect(weather.hours).toHaveLength(24);
    expect(weather.hours[3].day).toBe(false);
    expect(weather.days[0]).toMatchObject({ wetHours: 9, soilMoisture: 29, sunHours: 11.1, gdd: 17 });
    expect(isCurrent(weather)).toBe(true);
  });

  it('counts chili degree days from 10° and none above 30°', () => {
    expect(degreeDays(33, 24)).toBe(17); // the warmest held to 30: (30 + 24) / 2 - 10
    expect(degreeDays(20, 6)).toBe(5); // the coolest raised to 10: (20 + 10) / 2 - 10
    expect(degreeDays(9, 4)).toBe(0);
    expect(degreeDays(null, 20)).toBeNull();
    expect(degreeDaysOver([{ gdd: 17.4 }, { gdd: null }, { gdd: 16.2 }] as Day[])).toBe(34);
    expect(waterBalance([{ rain: 10, et0: 4 }, { rain: 0, et0: 4.5 }] as Day[])).toBe(1.5);
  });

  it('says when an hour is fit to spray, and why not', () => {
    const hour = (over: Partial<Hour>): Hour => ({ time: '2026-11-17T08:00', temperature: 26, wetBulb: 22, wind: 8, rain: 0, chance: 10, leafWet: 0, soilTemp: null, soilMoisture: null, soilDeep: null, day: true, ...over });
    expect(deltaT(hour({}))).toBe(4);
    expect(sprayBlock(hour({}), null)).toBeNull();
    expect(sprayBlock(hour({ day: false }), null)).toBe('Dark');
    expect(sprayBlock(hour({}), hour({ rain: 0.4 }))).toBe('Rain');
    expect(sprayBlock(hour({ chance: 60 }), null)).toBe('Rain likely');
    expect(sprayBlock(hour({ wind: 1 }), null)).toMatch(/calm/);
    expect(sprayBlock(hour({ wind: 22 }), null)).toBe('Too windy');
    expect(sprayBlock(hour({ wetBulb: 25 }), null)).toMatch(/damp/);
    expect(sprayBlock(hour({ temperature: 34, wetBulb: 24 }), null)).toMatch(/dry/);

    const day = ['06', '07', '08', '09', '10', '11'].map((at, index) => hour({ time: `2026-11-17T${at}:00`, wind: index === 3 ? 20 : 8 }));
    const hours = sprayHours(day, '2026-11-17T07:30', 24);
    expect(hours.map((item) => item.ok)).toEqual([true, true, false, true, true]);
    expect(sprayWindows(hours)).toEqual([
      { start: '2026-11-17T07:00', end: '2026-11-17T09:00', hours: 2 },
      { start: '2026-11-17T10:00', end: '2026-11-17T12:00', hours: 2 },
    ]);
  });

  it('warns from the forecast, one warning a kind with its days, and never for a past day', () => {
    const day = (date: string, over: Partial<Day>): Day => ({ date, past: false, today: false, code: 2, max: 31, min: 24, rain: 0, gusts: 20 } as Day & typeof over);
    const days = [
      { ...day('2026-11-16', {}), past: true, rain: 120, code: 99 },
      { ...day('2026-11-17', {}), today: true, code: 95, max: 36 },
      { ...day('2026-11-18', {}), rain: 40, max: 37.2 },
      { ...day('2026-11-19', {}), rain: 95, gusts: 55, code: 96 },
    ];
    expect(alertsOf(days).map((alert) => [alert.kind, alert.level, alert.title, alert.dates])).toEqual([
      ['storm', 'warning', 'Thunderstorm', ['2026-11-17']],
      ['heat', 'warning', 'Heat, up to 37°', ['2026-11-17', '2026-11-18']],
      ['rain', 'warning', 'Heavy rain, 40 mm', ['2026-11-18']],
      ['hail', 'danger', 'Thunderstorm with hail', ['2026-11-19']],
      ['flood', 'danger', 'Very heavy rain, 95 mm', ['2026-11-19']],
      ['gusts', 'warning', 'Strong gusts, 55 km/h', ['2026-11-19']],
    ]);
    expect(alertsOf([day('2026-11-17', {})])).toEqual([]);
  });

  it('rates the fungus risk from wet hours in warm air, names the wind and the UV', () => {
    const day = (wetHours: number | null, max = 31, min = 24) => ({ wetHours, max, min }) as Day;
    expect([diseaseRisk(day(13)), diseaseRisk(day(13, 16, 8)), diseaseRisk(day(7)), diseaseRisk(day(2)), diseaseRisk(day(null))]).toEqual(['high', 'some', 'some', 'low', null]);
    expect([0, 44, 90, 140, 359, null].map(compass)).toEqual(['N', 'NE', 'E', 'SE', 'N', '—']);
    expect([1, 4, 7.6, 9, 12, null].map(uvWord)).toEqual(['Low', 'Moderate', 'High', 'Very high', 'Extreme', '']);
  });

  it('will not show a reading saved before the farm readings were added', () => {
    expect(isCurrent({ days: [], fetchedAt: '2026-11-17T03:00:00Z' })).toBe(false);
    expect(isCurrent({ version: 2, days: [] })).toBe(false);
    expect(isCurrent(null)).toBe(false);
  });
});
