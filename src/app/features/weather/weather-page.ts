import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';

import { WorkbookStore } from '@core/workbook-store';
import { buildZoneLayout, mapCentre, plotShapes } from '@shared/map/zone-layout';
import { Icon } from '@shared/ui/icon';
import {
  ALERT,
  alertsOf,
  compass,
  degreeDaysOver,
  diseaseRisk,
  forecastUrl,
  GDD_BASE,
  GDD_CAP,
  isCurrent,
  LEAF_WET,
  NEXT_DAYS,
  PAST_DAYS,
  parseWeather,
  rainOver,
  roundedPlace,
  scaleOf,
  SPRAY,
  sprayHours,
  sprayWindows,
  uvWord,
  waterBalance,
  weatherWord,
  type Day,
  type Place,
  type Weather,
} from './weather-model';

const CACHE_KEY = 'ukmac.weather';
/** A reading younger than this (ms) is shown as it is, without asking again. */
const FRESH = 30 * 60_000;
/** The height the temperature bars and rain bars are drawn in (px). */
const BAR = 112;
const RAIN_BAR = 56;

/**
 * Weather: what the farm's weather is now, and a timeline of days (the last two weeks, then the next week) from
 * Open-Meteo, an open weather service. The farm's place is the MAC's own, else the middle of its plots; only that,
 * rounded to about a kilometre, is sent. The last reading is kept, so the page opens at once and still shows something offline.
 */
@Component({
  selector: 'app-weather-page',
  imports: [RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.mac(); as mac) {
      <div class="page">
        <header class="page-header">
          <a class="page-back-icon" [routerLink]="['/mac', mac.macId]" title="Back to the dashboard" aria-label="Back"><app-icon name="arrow-left" [size]="16" /></a>
          <div class="page-header-text">
            <h1 class="page-title">Weather <span class="badge neutral">{{ mac.macCode }}</span></h1>
            <p class="page-desc">The weather at {{ mac.macName }}: now, the last {{ past }} days and the next {{ next }}, from Open-Meteo.</p>
          </div>
          <button type="button" class="btn btn-secondary btn-sm refresh" [disabled]="loading() || !place()" (click)="reload()" title="Read the weather again">
            <app-icon name="refresh" [size]="14" /> {{ loading() ? 'Reading…' : 'Refresh' }}
          </button>
        </header>

        @if (!place()) {
          <div class="card empty">
            <strong>No place for the farm yet</strong>
            <p>Add the MAC's latitude and longitude (on the home page, open the ⋮ on its card and choose Edit), or the plots' outlines in Zones, and its weather shows here.</p>
          </div>
        } @else {
          @if (error()) {
            <div class="alert-box error"><app-icon name="alert" /> {{ error() }}{{ weather() ? ' Showing what was read ' + ago() + '.' : '' }}</div>
          }
          @if (weather(); as w) {
            <section class="now card" aria-label="Weather now">
              @if (w.now; as now) {
               <div class="now-top">
                <div class="now-main">
                  <strong class="now-temp">{{ round(now.temperature) }}°</strong>
                  <div class="now-text">
                    <span class="now-word">{{ word(now.code) }}</span>
                    <small class="muted">Feels like {{ round(now.feels) }}°</small>
                  </div>
                </div>
                <ul class="now-facts">
                  <li><app-icon name="droplet" [size]="15" /><span>Humidity</span><b>{{ whole(now.humidity) }}%</b></li>
                  <li><app-icon name="wind" [size]="15" /><span>Wind</span><b>{{ whole(now.wind) }} km/h {{ compass(now.windDir) }}</b></li>
                  <li><app-icon name="cloud-sun" [size]="15" /><span>Rain now</span><b>{{ one(now.rain) }} mm</b></li>
                  <li title="Water in the top soil (3 to 9 cm), and its warmth 6 cm down: Open-Meteo's model estimate"><app-icon name="shovel" [size]="15" /><span>Soil</span><b>{{ one(now.soilMoisture) }}% · {{ round(now.soilTemp) }}°</b></li>
                  <li><app-icon name="sun" [size]="15" /><span>Sun</span><b>{{ whole(now.solar) }} W/m² · {{ whole(now.cloud) }}% cloud</b></li>
                </ul>
               </div>
              }
              <ul class="totals">
                <li><span>Rain, last {{ past }} days</span><b>{{ pastRain() }} mm</b></li>
                <li><span>Rain, next {{ next }} days</span><b>{{ nextRain() }} mm</b></li>
                <li><span>Wettest day</span><b>{{ wettest() }}</b></li>
              </ul>
            </section>

            <section class="card timeline" aria-label="Timeline">
              <header class="tl-head">
                <div>
                  <h2 class="label">Timeline</h2>
                  <p class="muted">Each day's warmest and coolest, and its rain. The days before today are what the weather did; after, the forecast.</p>
                </div>
                <button type="button" class="btn btn-secondary btn-sm" (click)="centreToday(true)">Today</button>
              </header>
              <div class="strip" #strip role="list">
                @for (day of w.days; track day.date) {
                  <div
                    class="col"
                    role="listitem"
                    tabindex="0"
                    [class.today]="day.today"
                    [class.past]="day.past"
                    [class.picked]="day.date === this.day()?.date && !day.today"
                    [attr.data-day]="day.date"
                    [title]="'See ' + weekday(day.date) + ' ' + short(day.date) + ' on the farm'"
                    (click)="pickDay(day)"
                    (keydown.enter)="pickDay(day)"
                  >
                    <div class="col-date">
                      <b>{{ weekday(day.date) }}</b>
                      <span>{{ short(day.date) }}</span>
                      @if (day.today) {
                        <i class="here">Today</i>
                      }
                    </div>
                    <div class="col-word" [title]="word(day.code)">{{ word(day.code) }}</div>
                    <div class="temp" [style.height.px]="bar">
                      @if (day.max !== null && day.min !== null) {
                        <i class="range" [style.top.px]="top(day)" [style.height.px]="size(day)"></i>
                        <span class="hi" [style.top.px]="top(day) - 16">{{ round(day.max) }}°</span>
                        <span class="lo" [style.top.px]="top(day) + size(day) + 1">{{ round(day.min) }}°</span>
                      }
                    </div>
                    <div class="rain" [style.height.px]="rainBar" [title]="one(day.rain) + ' mm of rain'">
                      <i [style.height.px]="rainHeight(day)"></i>
                    </div>
                    <div class="col-foot">
                      <span><b>{{ one(day.rain) }}</b> mm</span>
                      @if (day.chance !== null) {
                        <span class="chance">{{ whole(day.chance) }}%</span>
                      }
                      <span class="wind">{{ whole(day.wind) }} km/h</span>
                    </div>
                  </div>
                }
              </div>
            </section>

            <section class="card warnings" aria-label="Warnings from the forecast">
              <header class="sec-head">
                <h2 class="label"><app-icon name="alert" [size]="14" /> Warnings</h2>
                <span class="muted">From the forecast for the next {{ next }} days, not an official warning</span>
              </header>
              @if (alerts().length) {
                <ul class="warn-list">
                  @for (alert of alerts(); track alert.kind) {
                    <li [class]="'warn ' + alert.level">
                      <app-icon [name]="alert.kind === 'storm' || alert.kind === 'hail' ? 'zap' : alert.kind === 'heat' ? 'thermometer' : alert.kind === 'gusts' ? 'wind' : 'umbrella'" [size]="16" />
                      <div>
                        <b>{{ alert.title }}</b>
                        <span class="warn-days">{{ daysOf(alert.dates) }}</span>
                        <p>{{ alert.detail }}</p>
                      </div>
                    </li>
                  }
                </ul>
              } @else {
                <p class="calm"><app-icon name="check" [size]="15" /> No storms, heavy rain, strong gusts, heat over {{ heat }}° or frost in the forecast.</p>
              }
            </section>

            @if (day(); as d) {
              <section class="card farm-day" aria-label="The farm's weather on a day">
                <header class="sec-head day-head">
                  <div>
                    <h2 class="label">{{ d.today ? 'Today' : weekday(d.date) + ' ' + short(d.date) }} on the farm</h2>
                    <span class="muted">{{ d.past ? 'What the weather did, as Open-Meteo works it out' : d.today ? 'Today, measured so far and forecast for the rest' : 'The forecast' }} · tap a day in the timeline to see it here</span>
                  </div>
                  @if (!d.today) {
                    <button type="button" class="btn btn-secondary btn-sm" (click)="picked.set(null)">Back to today</button>
                  }
                </header>
                <div class="kpis">
                  <article class="kpi">
                    <div class="kpi-top"><p>Temperature &amp; growth</p><span class="kpi-icon warm"><app-icon name="thermometer" [size]="16" /></span></div>
                    <strong class="kpi-value">{{ round(d.max) }}° / {{ round(d.min) }}°</strong>
                    <dl>
                      <div><dt>Feels like</dt><dd>{{ round(d.feels) }}°</dd></div>
                      <div [title]="'Growing degree days for chili: the mean of the day above ' + gddBase + ' °C, its warmest held to ' + gddCap + ' °C. They add up to how far the plants have grown.'"><dt>Degree days</dt><dd>{{ one(d.gdd) }}</dd></div>
                      <div><dt>Last {{ past }} days</dt><dd>{{ gddPast() }} GDD</dd></div>
                      <div><dt>Next {{ next }} days</dt><dd>{{ gddNext() }} GDD</dd></div>
                    </dl>
                  </article>
                  <article class="kpi">
                    <div class="kpi-top"><p>Rainfall</p><span class="kpi-icon rain"><app-icon name="umbrella" [size]="16" /></span></div>
                    <strong class="kpi-value">{{ one(d.rain) }} mm</strong>
                    <dl>
                      <div><dt>Chance</dt><dd>{{ d.chance === null ? '—' : whole(d.chance) + '%' }}</dd></div>
                      <div title="Reference evapotranspiration (ET₀): the water a field gives off to the air in a day"><dt>Water lost (ET₀)</dt><dd>{{ one(d.et0) }} mm</dd></div>
                      <div title="Rain less the water lost (ET₀) over the last days: below zero, the crop needed water the rain did not bring"><dt>Balance, last {{ past }} d</dt><dd [class.dry]="balancePast() < 0">{{ signed(balancePast()) }} mm</dd></div>
                      <div title="Rain less the water lost (ET₀) over the next days, as forecast"><dt>Balance, next {{ next }} d</dt><dd [class.dry]="balanceNext() < 0">{{ signed(balanceNext()) }} mm</dd></div>
                    </dl>
                  </article>
                  <article class="kpi" title="Open-Meteo's model estimate of the soil, not a sensor in the field">
                    <div class="kpi-top"><p>Soil <span class="kpi-note">estimate</span></p><span class="kpi-icon soil"><app-icon name="shovel" [size]="16" /></span></div>
                    <strong class="kpi-value">{{ one(d.soilMoisture) }}% <small>water, 3–9 cm</small></strong>
                    <dl>
                      <div><dt>Roots, 9–27 cm</dt><dd>{{ one(d.soilDeep) }}%</dd></div>
                      <div><dt>Warmth, 6 cm</dt><dd>{{ one(d.soilTemp) }}°</dd></div>
                      <div><dt>Vs day before</dt><dd>{{ soilChange() }}</dd></div>
                    </dl>
                  </article>
                  <article class="kpi">
                    <div class="kpi-top"><p>Humidity &amp; wet leaves</p><span class="kpi-icon leaf"><app-icon name="leaf" [size]="16" /></span></div>
                    <strong class="kpi-value">{{ whole(d.humidity) }}% <small>humidity</small></strong>
                    <dl>
                      <div [title]="'Hours the leaves were more likely wet than not (a chance of ' + leafWet + '% or more)'"><dt>Leaves wet</dt><dd>{{ d.wetHours === null ? '—' : d.wetHours + ' h' }}</dd></div>
                      <div title="A guide: leaves wet 12 hours or more in warm air (a mean of 20 to 30°) let fungal disease like anthracnose take hold; 6 hours or more, some risk"><dt>Fungus risk</dt><dd><span class="badge" [class.warning]="risk() === 'high'" [class.info]="risk() === 'some'" [class.success]="risk() === 'low'">{{ riskWord() }}</span></dd></div>
                      <div><dt>Dew point</dt><dd>{{ one(d.dewPoint) }}°</dd></div>
                      <div title="Vapour pressure deficit: how hard the air pulls water from the leaves (high: the plants lose water fast)"><dt>VPD (max)</dt><dd>{{ d.vpd === null ? '—' : d.vpd.toFixed(2) + ' kPa' }}</dd></div>
                    </dl>
                  </article>
                  <article class="kpi">
                    <div class="kpi-top"><p>Wind</p><span class="kpi-icon wind"><app-icon name="wind" [size]="16" /></span></div>
                    <strong class="kpi-value">{{ whole(d.windMean) }} km/h <small>mean</small></strong>
                    <dl>
                      <div><dt>Strongest</dt><dd>{{ whole(d.wind) }} km/h</dd></div>
                      <div><dt>Gusts</dt><dd>{{ whole(d.gusts) }} km/h</dd></div>
                      <div><dt>From</dt><dd class="dir">@if (d.windDir !== null) {<app-icon name="navigation" [size]="12" [style.transform]="'rotate(' + (d.windDir + 180) + 'deg)'" />} {{ compass(d.windDir) }}</dd></div>
                    </dl>
                  </article>
                  <article class="kpi">
                    <div class="kpi-top"><p>Sun &amp; cloud</p><span class="kpi-icon sun"><app-icon name="sun" [size]="16" /></span></div>
                    <strong class="kpi-value">{{ one(d.solar) }} <small>MJ/m² of sun</small></strong>
                    <dl>
                      <div><dt>Sunshine</dt><dd>{{ one(d.sunHours) }} h</dd></div>
                      <div><dt>Cloud</dt><dd>{{ whole(d.cloud) }}%</dd></div>
                      <div><dt>UV (max)</dt><dd>{{ one(d.uv) }} {{ uv(d.uv) }}</dd></div>
                      <div><dt>Weather</dt><dd>{{ word(d.code) }}</dd></div>
                    </dl>
                  </article>
                </div>
              </section>
            }

            <p class="source muted">
              Weather from <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>, an open weather service, for {{ w.place.lat }}, {{ w.place.lng }} ({{ w.timezone || 'local time' }}), read {{ ago() }}. Only the farm's
              place, to about a kilometre, is sent to it. The soil and the wet leaves are its model's estimates, not a sensor in the field; the fungus risk
              and warnings are worked out from the forecast as a guide.
            </p>
          } @else if (loading()) {
            <div class="card empty"><span class="spinner-sm"></span><p>Reading the weather…</p></div>
          }
        }
      </div>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    /* The page scrolls; its cards keep their full height (a card that clips its content would otherwise be squeezed to a line). */
    .page > * { flex: none; }
    .refresh { margin-left: auto; align-self: center; }
    /* Panels line up with the header, as Data Check's does: the page's own padding is the only inset. */
    .empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 36px 20px; text-align: center; }
    .empty p { max-width: 440px; margin: 0; color: var(--text-muted); font-size: 0.875rem; line-height: 1.5; }
    /* The small mono caps that head a part of a panel. */
    .label { display: inline-flex; align-items: center; gap: 6px; margin: 0; font-family: var(--mono); font-size: 0.6875rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); }
    /* What sits inside a panel: a raised, lighter card. */
    .now-facts li, .totals li, .col, .warn, .kpi { border: var(--hairline) solid var(--border); background: var(--surface-solid); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05); }
    .now { display: flex; flex-direction: column; gap: 16px; padding: 24px 28px; }
    .now-top { display: flex; flex-wrap: wrap; align-items: center; gap: 14px 32px; }
    .now-main { display: flex; align-items: center; gap: 16px; }
    .now-temp { font-size: 2.75rem; font-weight: 600; line-height: 1; font-variant-numeric: tabular-nums; letter-spacing: -0.03em; }
    .now-text { display: flex; flex-direction: column; gap: 2px; }
    .now-word { font-size: 1rem; font-weight: 600; }
    .now-facts, .totals { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; padding: 0; list-style: none; }
    .now-facts li { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 999px; font-size: 0.8125rem; }
    .now-facts span, .totals span { color: var(--text-muted); }
    .now-facts b { font-weight: 600; font-variant-numeric: tabular-nums; }
    .now-facts app-icon { color: var(--text-muted); }
    .totals { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .totals li { display: flex; flex-direction: column; gap: 4px; padding: 12px 14px; border-radius: 12px; }
    .totals span { font-family: var(--mono); font-size: 0.6875rem; letter-spacing: 0.06em; text-transform: uppercase; }
    .totals b { font-size: 1.0625rem; font-weight: 600; font-variant-numeric: tabular-nums; }
    .timeline { display: flex; flex-direction: column; gap: 14px; padding: 24px 28px; overflow: hidden; }
    .tl-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .tl-head p { margin: 6px 0 0; font-size: 0.8125rem; }
    .strip { display: flex; gap: 8px; overflow-x: auto; margin: 0 -4px; padding: 4px 4px 10px; scrollbar-width: thin; }
    .col { flex: none; width: 96px; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 12px 4px; border-radius: 14px; font-size: 0.8125rem; }
    .col.past { opacity: 0.8; }
    .col.today { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 7%, var(--surface-solid)); opacity: 1; }
    .col-date { display: flex; flex-direction: column; align-items: center; gap: 1px; height: 68px; }
    .col-date span { color: var(--text-muted); font-size: 0.75rem; }
    .here { margin-top: 3px; padding: 1px 8px; border-radius: 999px; background: var(--accent); color: #fff; font-size: 0.6875rem; font-style: normal; font-weight: 600; }
    .col-word { width: 100%; height: 16px; text-align: center; color: var(--text-muted); font-size: 0.75rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .temp { position: relative; width: 100%; }
    .range { position: absolute; left: 50%; width: 10px; margin-left: -5px; border-radius: 999px; background: linear-gradient(to bottom, var(--warning), #f5c26b); }
    .hi, .lo { position: absolute; left: 0; right: 0; text-align: center; font-size: 0.75rem; font-variant-numeric: tabular-nums; line-height: 15px; }
    .hi { font-weight: 600; }
    .lo { color: var(--text-muted); }
    .rain { position: relative; width: 100%; display: flex; align-items: flex-end; justify-content: center; border-bottom: var(--hairline) solid var(--border); }
    .rain i { display: block; width: 22px; border-radius: 4px 4px 0 0; background: #4ea6dc; }
    .col-foot { display: flex; flex-direction: column; align-items: center; gap: 2px; font-variant-numeric: tabular-nums; }
    .col-foot .chance { color: #2f86bd; font-size: 0.75rem; }
    .col-foot .wind { color: var(--text-muted); font-size: 0.75rem; }
    .source { margin: 0 4px; font-size: 0.75rem; line-height: 1.5; }
    .sec-head { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; }
    .sec-head > .muted, .day-head .muted { font-size: 0.8125rem; }
    .warnings { padding: 24px 28px; }
    .warn-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; margin: 14px 0 0; padding: 0; list-style: none; }
    .warn { display: flex; gap: 10px; padding: 12px 14px; border-radius: 12px; background: var(--warning-soft); color: var(--text); font-size: 0.8125rem; line-height: 1.45; }
    .warn > app-icon { margin-top: 2px; color: var(--warning); }
    .warn.danger { background: var(--danger-soft); }
    .warn.danger > app-icon { color: var(--danger); }
    .warn b { font-weight: 600; }
    .warn-days { margin-left: 8px; color: var(--text-muted); font-size: 0.75rem; }
    .warn p { margin: 2px 0 0; color: var(--text-muted); }
    .calm { display: flex; align-items: center; gap: 8px; margin: 14px 0 0; font-size: 0.875rem; color: var(--text-muted); }
    .calm app-icon { color: var(--success); }
    .farm-day { padding: 24px 28px; container-type: inline-size; }
    .day-head { justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .day-head > div { display: flex; flex-direction: column; gap: 2px; }
    /* Six cards: three a row, two when narrow, one on a phone. */
    .kpis { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    @container (max-width: 820px) { .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @container (max-width: 480px) { .kpis { grid-template-columns: minmax(0, 1fr); } }
    .kpi { min-width: 0; margin: 0; padding: 16px; border-radius: 12px; }
    .kpi-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .kpi-top p { margin: 0; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; color: var(--text-muted); }
    .kpi-note { margin-left: 4px; font-weight: 500; text-transform: none; opacity: 0.8; }
    .kpi-icon { flex: none; display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%; }
    .kpi-icon.warm { background: var(--warning-soft); color: var(--warning); }
    .kpi-icon.rain { background: var(--accent-soft); color: var(--accent); }
    .kpi-icon.soil { background: #f3ebe1; color: #8a6040; }
    .kpi-icon.leaf { background: var(--success-soft); color: var(--success); }
    .kpi-icon.wind { background: #f0edfa; color: #6e57a5; }
    .kpi-icon.sun { background: #fdf5d8; color: #b58a00; }
    .kpi-value { display: block; margin-top: 12px; font-size: 1.5rem; font-weight: 600; line-height: 1.2; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .kpi-value small { font-size: 0.75rem; font-weight: 500; color: var(--text-muted); }
    .kpi dl { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; margin: 16px 0 0; }
    .kpi dl > div { min-width: 0; }
    .kpi dt { font-size: 0.625rem; font-weight: 500; text-transform: uppercase; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .kpi dd { display: flex; align-items: center; gap: 4px; margin: 2px 0 0; font-size: 0.75rem; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .kpi dd.dry { color: var(--danger); }
    .kpi dd .badge { font-size: 0.6875rem; }
    .spray { padding: 24px 28px; }
    .spray .sec-head b { color: var(--text); }
    .hours { display: grid; grid-template-columns: repeat(24, minmax(0, 1fr)); gap: 3px; margin: 14px 0 0; }
    .hr { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .hr i { height: 22px; border-radius: 5px; background: var(--surface-hover, #f2f2f4); }
    .hr.ok i { background: var(--success); }
    .hr span { height: 14px; font-size: 0.6875rem; color: var(--text-muted); font-variant-numeric: tabular-nums; }
    .windows { margin: 8px 0 0; font-size: 0.8125rem; }
    .rule { margin: 8px 0 0; font-size: 0.75rem; line-height: 1.5; }
    .col { cursor: pointer; }
    .col:hover:not(.today):not(.picked) { box-shadow: 0 3px 10px rgba(0, 0, 0, 0.09); }
    .col.picked { border-color: var(--accent); opacity: 1; }
    .col:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
    .source a { color: inherit; text-decoration: underline; }
  `,
})
export class WeatherPage {
  readonly store = inject(WorkbookStore);
  readonly past = PAST_DAYS;
  readonly next = NEXT_DAYS;
  readonly bar = BAR;
  readonly rainBar = RAIN_BAR;

  readonly weather = signal<Weather | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  private readonly strip = viewChild<ElementRef<HTMLElement>>('strip');
  /** Each read has a number, so the answer for a place left since is dropped. */
  private reads = 0;

  /** The farm's place: the MAC's own, else the middle of its plots' outlines. */
  readonly place = computed<Place | null>(() => {
    const mac = this.store.mac();
    if (!mac) return null;
    const sheets = this.store.sheets();
    const zones = sheets.find((sheet) => sheet.templateKey === 'zones') ?? null;
    const records = sheets.find((sheet) => sheet.templateKey === 'zone-records') ?? null;
    return mapCentre(mac, plotShapes(buildZoneLayout(zones, records)));
  });

  readonly scale = computed(() => scaleOf(this.weather()?.days ?? []));

  readonly gddBase = GDD_BASE;
  readonly gddCap = GDD_CAP;
  readonly leafWet = LEAF_WET;
  readonly sprayRule = SPRAY;
  readonly heat = ALERT.heat;
  /** The day the farm's cards show (its date): today unless one is picked in the timeline. */
  readonly picked = signal<string | null>(null);
  readonly day = computed<Day | null>(() => {
    const days = this.weather()?.days ?? [];
    return days.find((day) => day.date === this.picked()) ?? days.find((day) => day.today) ?? null;
  });
  readonly alerts = computed(() => alertsOf(this.weather()?.days ?? []));
  readonly gddPast = computed(() => degreeDaysOver((this.weather()?.days ?? []).filter((day) => day.past)));
  readonly gddNext = computed(() => degreeDaysOver((this.weather()?.days ?? []).filter((day) => !day.past && !day.today)));
  readonly balancePast = computed(() => waterBalance((this.weather()?.days ?? []).filter((day) => day.past)));
  readonly balanceNext = computed(() => waterBalance((this.weather()?.days ?? []).filter((day) => !day.past && !day.today)));
  readonly risk = computed(() => {
    const day = this.day();
    return day ? diseaseRisk(day) : null;
  });
  readonly riskWord = computed(() => {
    const risk = this.risk();
    return risk ? { high: 'High', some: 'Some', low: 'Low' }[risk] : '—';
  });
  readonly soilChange = computed(() => {
    const days = this.weather()?.days ?? [];
    const index = days.findIndex((day) => day.date === this.day()?.date);
    const now = days[index]?.soilMoisture;
    const before = index > 0 ? days[index - 1].soilMoisture : null;
    if (now === null || now === undefined || before === null) return '—';
    const change = Math.round((now - before) * 10) / 10;
    return change === 0 ? 'the same' : `${change > 0 ? '+' : ''}${change} pts`;
  });
  /** Each of the next 24 hours, fit to spray or why not, and the runs of good hours over the next 48. */
  readonly spray = computed(() => {
    const weather = this.weather();
    return weather?.now ? sprayHours(weather.hours, weather.now.time, 24) : [];
  });
  readonly windows = computed(() => {
    const weather = this.weather();
    return weather?.now ? sprayWindows(sprayHours(weather.hours, weather.now.time, 48)) : [];
  });
  readonly pastRain = computed(() => rainOver((this.weather()?.days ?? []).filter((day) => day.past)));
  readonly nextRain = computed(() => rainOver((this.weather()?.days ?? []).filter((day) => !day.past)));
  readonly wettest = computed(() => {
    const days = (this.weather()?.days ?? []).filter((day) => (day.rain ?? 0) > 0);
    if (!days.length) return 'none';
    const day = days.reduce((best, item) => ((item.rain ?? 0) > (best.rain ?? 0) ? item : best));
    return `${this.short(day.date)} · ${this.one(day.rain)} mm`;
  });

  constructor() {
    effect(() => {
      const place = this.place();
      if (place) untracked(() => void this.load(place, false));
    });
  }

  pickDay(day: Day) {
    this.picked.set(day.today ? null : day.date);
  }

  /** The hours of a day fit to spray (the hour after counts for rain). */
  sprayOn(date: string): string {
    const hours = this.weather()?.hours ?? [];
    const first = hours.findIndex((hour) => hour.time.startsWith(date));
    if (first < 0) return '—';
    const count = sprayHours(hours, hours[first].time, 24).filter((hour) => hour.ok && hour.time.startsWith(date)).length;
    return count ? `${count} h` : 'none';
  }

  hourTitle(hour: { time: string; ok: boolean; why: string | null; wind: number | null; deltaT: number | null }) {
    const when = `${this.dayWord(hour.time.slice(0, 10))} ${hour.time.slice(11, 16)}`;
    return `${when}: ${hour.ok ? 'good to spray' : hour.why} · wind ${this.whole(hour.wind)} km/h · Delta-T ${hour.deltaT ?? '—'}°`;
  }

  windowText(window: { start: string; end: string; hours: number }) {
    return `${this.dayWord(window.start.slice(0, 10))} ${window.start.slice(11, 16)}–${window.end.slice(11, 16)} (${window.hours} h)`;
  }

  laterWindows() {
    return this.windows()
      .slice(1)
      .map((window) => this.windowText(window))
      .join(', ');
  }

  /** Today, Tomorrow, or the weekday and date. */
  dayWord(date: string) {
    const days = this.weather()?.days ?? [];
    const index = days.findIndex((day) => day.today);
    if (index >= 0 && days[index].date === date) return 'Today';
    if (index >= 0 && days[index + 1]?.date === date) return 'Tomorrow';
    return `${this.weekday(date)} ${this.short(date)}`;
  }

  daysOf(dates: string[]) {
    return dates.map((date) => this.dayWord(date)).join(', ');
  }

  reload() {
    const place = this.place();
    if (place) void this.load(place, true);
  }

  private async load(place: Place, force: boolean) {
    const key = JSON.stringify(roundedPlace(place));
    const cached = readCache(key);
    if (cached) {
      this.weather.set(cached);
      this.settle();
      if (!force && Date.now() - new Date(cached.fetchedAt).getTime() < FRESH) return;
    } else {
      this.weather.set(null);
    }
    const mine = ++this.reads;
    this.loading.set(true);
    this.error.set('');
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      let json: unknown;
      try {
        const response = await fetch(forecastUrl(place), { signal: controller.signal });
        if (!response.ok) throw new Error(`Open-Meteo answered ${response.status}.`);
        json = await response.json();
      } finally {
        clearTimeout(timer);
      }
      if (mine !== this.reads) return;
      const parsed = parseWeather(json, place);
      if (!parsed) throw new Error('Open-Meteo sent no days.');
      this.weather.set(parsed);
      writeCache(key, parsed);
      this.settle();
    } catch (error) {
      if (mine !== this.reads) return;
      this.error.set(`Couldn’t read the weather${error instanceof Error && error.name !== 'AbortError' ? `: ${error.message}` : ' (no answer in time)'}. Check the internet connection.`);
    } finally {
      if (mine === this.reads) this.loading.set(false);
    }
  }

  /** Once the days are drawn: the timeline opens on today. */
  private settle() {
    setTimeout(() => this.centreToday(false), 60);
  }

  centreToday(smooth: boolean) {
    const strip = this.strip()?.nativeElement;
    const today = strip?.querySelector<HTMLElement>('.col.today');
    if (!strip || !today) return;
    strip.scrollTo({ left: today.offsetLeft - (strip.clientWidth - today.clientWidth) / 2, behavior: smooth ? 'smooth' : 'auto' });
  }

  top(day: Day): number {
    const { low, high } = this.scale();
    return Math.round(((high - (day.max ?? high)) / (high - low)) * (BAR - 48)) + 16;
  }

  size(day: Day): number {
    const { low, high } = this.scale();
    return Math.max(8, Math.round((((day.max ?? 0) - (day.min ?? 0)) / (high - low)) * (BAR - 48)));
  }

  rainHeight(day: Day): number {
    const rain = day.rain ?? 0;
    return rain <= 0 ? 0 : Math.max(3, Math.round((rain / this.scale().rain) * RAIN_BAR));
  }

  word = weatherWord;
  compass = compass;
  uv = uvWord;
  signed(value: number) {
    return `${value > 0 ? '+' : ''}${value}`;
  }
  round(value: number | null) {
    return value === null ? '—' : Math.round(value);
  }
  whole(value: number | null) {
    return value === null ? '—' : Math.round(value);
  }
  one(value: number | null) {
    return value === null ? '0' : (Math.round(value * 10) / 10).toString();
  }
  weekday(date: string) {
    return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
  }
  short(date: string) {
    return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  }
  ago() {
    const at = this.weather()?.fetchedAt;
    if (!at) return '';
    const minutes = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60_000));
    return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`;
  }
}

function readCache(key: string): Weather | null {
  try {
    const saved = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as { key: string; weather: Weather } | null;
    // A reading saved before the page read the farm's soil, leaves and hours is read again.
    return saved && saved.key === key && isCurrent(saved.weather) ? saved.weather : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, weather: Weather) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ key, weather }));
  } catch {
    /* kept for this run only */
  }
}
