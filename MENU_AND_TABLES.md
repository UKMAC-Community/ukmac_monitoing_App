# UKMAC Monitoring: menu, tables and features

What each item in the sidebar opens, which **table** it needs, the table's **columns**, and the **features** on that page.

Sources: the sidebar of the Pursat MAC, the chili template (`src-tauri/src/template.rs`), the suggested dashboards (`src/app/dashboard/dashboard-model.ts`) and the real database on this Mac, read on 2026-11-07. Row counts are Pursat's today.

Column notes: `*` = required · `→ Zones[Plot]` = a **link** column, a pick-list filled from that other table · `ƒ` = a **formula** column, worked out automatically, never typed.

---

## 1. The menu at a glance

| Menu group | Menu item | Table it needs | Rows now | Kind of page |
|---|---|---|---:|---|
| (top) | Dashboard | reads Nursery Batches, Zone Records, QA/QC Management | | MAC dashboard |
| **Farm Layout** | Zone Map | **Zones** + **Zone Records** | 142 + 120 | Map page |
| | Zone Measurement | **Zone Measurement** | 0 | Table page |
| **Farm Progress › Nursery** | Chili Varieties | **Chili Varieties** | 7 | Table page |
| | Nursery Batches | **Nursery Batches** | 139 | Table page |
| **Farm Progress › Planting** | Zone Records | **Zone Records** | 120 | Table page |
| | Soil Preparation | **Soil Preparation** | 0 | Table page |
| | Irrigation | **Irrigation** | 0 | Table page |
| | Fertigation | **Fertigation** | 0 | Table page |
| | Pruning | **Pruning** | 0 | Table page |
| | Pesticides | **Pesticides** | 0 | Table page |
| | Harvest | **Harvest** | 0 | Table page |
| **Farm Progress › QA/QC** | QA/QC Management | **QA/QC Management** | 663 | Table page |
| | Planting Date | **Planting Date** | 0 | Table page |
| *(below the screenshot)* **Inventory** | Inventory Management | **Inventory Management** | 0 | Table page |
| *(below the screenshot)* **Operational** | Finance & Accounting | **Finance & Accounting** | 0 | Table page |

The **Zones** table has no menu item of its own. The Zone Map page is its front door. The Zone Map shows "Open Zones" when the table has no layout yet.

---

## 2. Features every table page has

All the "Table page" items above are ordinary tables with the same tools:

- **Dashboard strip** at the top: KPI cards and charts worked out from the rows as they change. It starts as a suggested dashboard (listed per table below). **Edit dashboard** changes the cards, charts and summaries. **Hide / Show** folds it away.
- **Summary tables** under the rows (for example "By Zone plot"), shown when the dashboard has them.
- **Search rows** box and click-to-sort column headers.
- **Open in sheet**: the table as a full spreadsheet (Univer, like the web system): formula bar, fonts, colours, borders, filter, sort, conditional formatting, freeze columns, pick-lists in link/choice/Yes-No cells. Every change is saved as it's made, and the MAC's tables are the tabs along the bottom.
- **Export**: the table to Excel (formulas worked out), or a blank Excel template with this table's headers.
- **Import** an Excel file into the table, checked first. **Imports** lists what came in from Excel and can undo it.
- **Table settings (⚙)**: rename the table, change its note, delete it. **Columns**: add, rename, move, resize, delete, set type (text, number, percentage, date, choice, Yes/No, link, formula), group under boxes.
- **Google Sheets**: a table linked to a tab shows a "Google Sheets · read …" chip and a **Sync** button that re-reads the tab (sign in under Connections & backup first).
- **Power BI**: all tables go out in one `.xlsx` (Connections & backup).
- A MAC can be **saved to a `.ukmac` file** (⋮ on its card) and **imported** on another computer, with all of the above.

---

## 3. Farm Layout

### Zone Map: tables **Zones** + **Zone Records**

A page, not a table. It draws every plot of the farm at its place in its zone.

**Tables it needs**

| Table | Why | Columns it reads |
|---|---|---|
| **Zones** | where each plot is | Zone · Zone number · Row · Column · Plot · Plot status · Status name · Outline · Plant capacity · Note |
| **Zone Records** | which plots are planted (a plot with at least one record is *planted*) | Zone plot · Record date · Plant count · Plant type · Status · Note |
| the MAC itself | the satellite view | Latitude and Longitude (set in Edit MAC). Without them only the Grid view shows. |

**Features**
- Five count tiles: **Plots**, **Planted**, **Not planted yet**, **Not in use**, **Water**.
- **Satellite** view: plots drawn on the satellite image with their outlines, plot labels and zone labels. **Top / 3D** tilt, turn left / turn right, zoom, and **Open** (full-window map).
- **Grid** view: each zone as a block, its numbered sections stacked, every plot at its row and column.
- Colours: planted plots in the stronger shade of their section colour, unplanted plots paler, **Not in use** grey, **Water** blue.
- Click a plot to see its details: zone and section, place (row / column), use, plant capacity, note, and its last 5 records (date, plant count, type, status).

### Zone Measurement: table **Zone Measurement**

The measured size of each plot (planned against actual).

| Column | Type | Notes |
|---|---|---|
| Zone plot | link → Zones[Plot] | |
| Planned plot | text | |
| Actual plot | text | |
| Number each plot | number | |
| Actual planting plot | text | |
| Width (m) | number | |
| Length (m) | number | |
| Area (m²) | ƒ | `Width × Length`, blank until both are filled |
| Note | text | |

**Features:** the standard table page (section 2) with a generated dashboard: cards **Rows**, **Number each plot**, **Width (m)**, **Length (m)**; a bar chart **Number each plot by Zone plot**; a summary **By Zone plot** (Rows, Number each plot, Width, Length). Empty for now: import an Excel file or Open in sheet and type the rows.

---

## 4. Farm Progress › Nursery

### Chili Varieties: table **Chili Varieties**

The list of varieties the farm grows. Nursery Batches and Zone Records pick their *Plant type* from here.

| Column | Type |
|---|---|
| Variety name * | text |
| Plant name | text |
| Plant type | text |
| Origin | text |
| Description | text |

**Features:** cards **Varieties**, **Plant types**, **Origins**; a donut **Varieties by origin**; a column chart **Varieties by plant type**.

### Nursery Batches: table **Nursery Batches**

Each batch of seedlings from the supplier: how many, how healthy, how tall, and what they were fed and sprayed with.

| Group | Columns |
|---|---|
| Batch | Batch # · Plant type * (link → Chili Varieties[Variety name]) · Origin · Supply date · Total number * |
| Health count | Healthy · Stem rot · Leaf rot · Smaller · Disease · Physical damage · **Not healthy** ƒ (sum of the five problem counts) · **Healthy %** ƒ (`Healthy ÷ Total number × 100`) |
| Planting window | Planting start date · Planting end date |
| Height | Min height (cm) · Min height (%) · Max height (cm) · Max height (%) · Mean height (cm) · Mean height (%) |
| Care | Leaf #/plant · Fertilizer name · Fertilizer concentration · Pesticide name · Pesticide concentration · Watering (times/day) |
| | Note |

**Features:** cards **Batches**, **Seedlings**, **Healthy seedlings**, **Healthy %** (goal 90); charts **Seedlings by plant type** (column) and **Seedlings by month** (line, by Supply date). Feeds the **Dashboard** page (Seedlings, Healthy %, Batches, Healthy seedlings, Not healthy, Stem rot, Average height) and the *Nursery batch* pick-list in Zone Records.

---

## 5. Farm Progress › Planting

### Zone Records: table **Zone Records**

What was planted in each plot and what happened to it. **This table is what turns a plot "Planted" on the Zone Map.**

| Column | Type |
|---|---|
| Zone plot * | link → Zones[Plot] |
| Record date * | date |
| Day number | number |
| Plant count | number |
| Plant type | link → Chili Varieties[Variety name] |
| Nursery batch | link → Nursery Batches[Batch #] |
| Status | text |
| Replant date | date |
| Replant count | number |
| Dead plant | number |
| Note | text |

**Features:** cards **Records**, **Plants**, **Replanted**, **Dead plants** (lower is better); charts **Plants by zone plot** (column) and **Dead plants by month** (line); summary **By zone plot** (Records, Plants, Replanted, Dead). Feeds the **Dashboard** page (Plants planted, Dead after planting).

### The six day-to-day tables: Soil Preparation, Irrigation, Fertigation, Pruning, Pesticides, Harvest

These six are **separate tables with the same three columns**. Each is empty now.

| Column | Type |
|---|---|
| Date | date |
| Zone | link → Zones[Plot] |
| Note | text |

| Menu item | Table | What the table is for (its own note in the app) |
|---|---|---|
| Soil Preparation | **Soil Preparation** | How each zone's soil is prepared before planting: ploughing, beds, compost and soil tests |
| Irrigation | **Irrigation** | Plan and log watering for each zone: when, how long and how much |
| Fertigation | **Fertigation** | Fertilizer given through the irrigation water: mix, dose and date, per zone |
| Pruning | **Pruning** | Pruning rounds across the zones and who did them |
| Pesticides | **Pesticides** | Every spray: the product, dose, target pest and the safe-to-harvest date |
| Harvest | **Harvest** | What each zone harvests, round by round, by weight and grade |

**Features (all six):** the standard table page with a generated dashboard: card **Rows**; charts **Rows by month** (by Date) and **Rows by Zone**; summary **By Zone**.

> **Gap to know about:** the notes above describe more than the columns hold. Only Date, Zone and Note exist today. For example Pesticides has no product, dose or safe-to-harvest columns, and Harvest has no weight or grade. Add them with **Columns → Add** (or in Open in sheet) when you want them. The columns that the notes mention are:
> - Soil Preparation: work done, beds, compost, soil test.
> - Irrigation: duration, amount.
> - Fertigation: mix, dose.
> - Pruning: done by.
> - Pesticides: product, dose, target pest, safe-to-harvest date.
> - Harvest: round, weight, grade.

---

## 6. Farm Progress › QA/QC

### QA/QC Management: table **QA/QC Management**

The approved 10-stage QC form. **One row per QC record**: the row's *Zone* is the plot checked and its *Date* is the planting date. 72 columns, 23 of them formulas.

| Part | Columns |
|---|---|
| Row | **Date** * (the planting date) · **Zone** * (link → Zones[Plot]) |
| QC record | Plant batch · Block |
| **1 · Transplant (0 DAT)** | Date ƒ · Days after transplant ƒ · Seedling Leaf Stage (No.): `4–5, good`, `3, >5`, Disease · Seedling Health / Vigor (No.): Healthy, Medium, Wilt |
| **2 · Establishment (7 DAT)** | Date ƒ · Days after transplant ƒ · Plant Survival: Live plant, **Dead plant** ƒ (`20 − Live plant`) · New Growth: Upright plants, Uneven / Wilt |
| **3 · Vegetative (30 DAT)** | Date ƒ · Days ƒ · Plant average: Vigor score (1–5), Plant height (cm), Canopy A widest (cm), Canopy B across (cm), Branches |
| **4 · Flowering (45 DAT)** | Date ƒ · Days ƒ · Plant average: Plant flowering (%), Flowers per plant |
| **5 · Fruit set (60 DAT)** | Date ƒ · Days ƒ · Fruit Orientation: Upright, Mixed, Different · Fruit Shape: True-to-type, Variability, Off-type · Plant average: Young fruits per plant |
| **6 · First Harvest (75 DAT)** | Date ƒ · Days ƒ · Harvest date · Plant average: Fruit length (cm), Fruit diameter (cm) |
| **7 · Maturity (75 DAT+)** | Date ƒ · Days ƒ · Fruit Color (No.): Green, Turning, Red |
| **8 · Harvest (75–150 DAT)** | Date ƒ · Days ƒ · Marketable Fruit (kg): Total, Marketable · Rejected (kg): Pest damage, Disease, Too small, Deformed, Rot, Color reject, **Total** ƒ (sum of the six) · Cumulative Yield: Harvest rounds, Harvested (kg), Total plant |
| **9 · Plant Health (75–150 DAT)** | Date ƒ · Days ƒ · Pest / Disease per block (No.): `0–70 DAT`, `0–150 DAT` |
| **10 · End of Cycles** | Date ƒ · Days ƒ · Cumulative Yield: Harvest rounds, Harvested (kg), Total plant, **Yield per plant** ƒ (`Harvested ÷ Total plant`) |

Each stage's *Date* formula is the row's planting Date plus the stage's day (0, 7, 30, 45, 60, 75, 75, 75, 75, 150). It stays blank until that day has come (stages 1 to 3 show 3 days ahead). *Days after transplant* counts from the planting Date.

**Features:** cards **QC records**, **Zones checked**, **Live plants (of 20)** (goal 18), **Dead plants** (lower is better), **Marketable fruit (kg)**, **Yield per plant (kg)**; charts **Live plants by zone** (column) and **Marketable fruit by month** (line); summary **By zone** (QC records, Live plants avg, Dead plants, Marketable, Harvested). The columns sit under their stage boxes, with groups, in the sheet view. Feeds the **Dashboard** page (Harvest kg, QC records).

### Planting Date: table **Planting Date**

Each zone's planting date and the harvest window it implies (75 to 150 days after transplant).

| Column | Type |
|---|---|
| Zone * | link → Zones[Plot] |
| Planting date * | date |
| Harvest from | ƒ `Planting date + 75` |
| Harvest to | ƒ `Planting date + 150` |
| Note | text |

**Features:** cards **Zones planted**; chart **Plantings by month** (column).

---

## 7. Below the screenshot: Inventory and Operational

### Inventory Management: table **Inventory Management**

Stock in the greenhouse, in and out by quantity.

| Column | Type |
|---|---|
| Date | date |
| Item * | text |
| Stock in | number |
| Stock out | number |
| Unit | text |
| Note | text |

**Features:** cards **Items**, **Stock in**, **Stock out**; bar chart **Stock in by item**; summary **By item** (Stock in, Stock out).

### Finance & Accounting: table **Finance & Accounting**

The project's income and costs.

| Column | Type |
|---|---|
| Date | date |
| Description * | text |
| Category | text |
| Income | number |
| Cost | number |
| Note | text |

**Features:** cards **Income**, **Cost** (lower is better); column charts **Income by month** and **Cost by month**; summary **By category** (Income, Cost).

---

## 8. How the tables connect

```
Zones (every plot: Zone, Plot, Row, Column, Outline …)
 ├─ picked by: Zone Records · Zone Measurement · Soil Preparation · Irrigation · Fertigation
 │             · Pruning · Pesticides · Harvest · QA/QC Management · Planting Date
 └─ drawn by:  Zone Map  (planted = the plot has a row in Zone Records)

Chili Varieties (Variety name)
 ├─ picked by: Nursery Batches (Plant type)
 └─ picked by: Zone Records (Plant type)

Nursery Batches (Batch #)
 └─ picked by: Zone Records (Nursery batch)
```

A link column only offers values that exist in its source table, so **fill the source tables first**.

**Suggested order:** 1. Zones (rows, columns, outlines) → 2. Chili Varieties → 3. Nursery Batches → 4. Zone Records and Planting Date → 5. QA/QC Management and the day-to-day Planting tables.

Inventory Management, Finance & Accounting, Zone Measurement and the six day-to-day tables don't depend on anything except Zones.
