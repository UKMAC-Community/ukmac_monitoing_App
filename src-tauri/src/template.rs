//! The chili template: the tables a new chili MAC starts with — the
//! server's chili navs (`guidelines/templates.py`) and the tables that were
//! fixed there (Batch, Nursery Progress, Zone Records), every one
//! an ordinary sheet here: renamed, re-columned or deleted at will.
//!
//! Column names are the server's Excel template headers, so a template
//! already filled from the server imports as it is.
//!
//! One table departs from that on purpose, at the farm's request: Zone Measurement follows the farm's own
//! zone → zone plot → zone measurement design (`zone_measurement_columns`), and answers to the server's old
//! Width / Length / Area headers as other names.

use crate::model::Column;

pub struct TemplateSheet {
    pub key: &'static str,
    pub title: &'static str,
    pub heading: &'static str,
    pub icon: &'static str,
    pub about: &'static str,
    pub columns: Vec<Column>,
}

fn col(name: &str, col_type: &str) -> Column {
    Column::new(name, col_type)
}

fn text(name: &str) -> Column {
    col(name, "text")
}

fn number(name: &str) -> Column {
    col(name, "number")
}

fn date(name: &str) -> Column {
    col(name, "date")
}

fn required(mut column: Column) -> Column {
    column.required = true;
    column
}

fn link(name: &str, source: &str) -> Column {
    let mut column = col(name, "link");
    column.source = Some(source.into());
    column
}

fn formula(name: &str, formula: &str) -> Column {
    let mut column = col(name, "formula");
    column.formula = Some(formula.into());
    column
}

/// Other names a file's header may call the column by: matched as the column's own name is.
fn also_called(mut column: Column, names: &[&str]) -> Column {
    column.aliases = names.iter().map(|name| name.to_string()).collect();
    column
}

/// A number or percentage that may only be between `min` and `max` (`None`: no limit that way).
fn between(mut column: Column, min: Option<f64>, max: Option<f64>) -> Column {
    column.min = min;
    column.max = max;
    column
}

fn in_group(mut column: Column, group: &str) -> Column {
    column.group = Some(group.into());
    column
}

fn with_unit(mut column: Column, unit: &str) -> Column {
    column.unit = Some(unit.into());
    column
}

fn in_box(columns: Vec<Column>, box_name: &str) -> Vec<Column> {
    columns
        .into_iter()
        .map(|mut column| {
            column.box_name = Some(box_name.into());
            column
        })
        .collect()
}

const ZONE_SOURCE: &str = "'Zones'[Plot]";
const VARIETY_SOURCE: &str = "'Batch'[Variety name]";
const BATCH_SOURCE: &str = "'Batch'[Batch number]";

/// A row's Date and Zone, as the server's feature tables start.
fn date_zone() -> Vec<Column> {
    vec![date("Date"), link("Zone", ZONE_SOURCE)]
}

// ---------------------------------------------------------------- QA/QC

fn stage_box(number: u32, title: &str, target: Option<&str>) -> String {
    match target {
        Some(target) => format!("{number} · {title} ({target})"),
        None => format!("{number} · {title}"),
    }
}

/// A stage of the QC form, a box of its own, laid out as the old QA QC sheet has it: first the date the stage was
/// observed (typed; the sheet's column of that name, "30 DAT Vegetative"), then the stage's groups of measures.
fn stage(
    number: u32,
    title: &str,
    target: Option<&str>,
    observed: &str,
    measures: Vec<Column>,
) -> Vec<Column> {
    let box_name = stage_box(number, title, target);
    let mut columns = vec![date(observed)];
    columns.extend(measures);
    in_box(columns, &box_name)
}

/// One column per plant (P#1–P#20) for a measure the old sheet took on each of a block's 20 plants. `name` gives the
/// column's name for a plant: as in the sheet, the same "P#3" under each measure's group.
fn per_plant(
    group: &str,
    unit: Option<&str>,
    min: f64,
    max: Option<f64>,
    name: impl Fn(u32) -> String,
) -> Vec<Column> {
    (1..=PLANTS)
        .map(|plant| {
            let column = between(in_group(number(&name(plant)), group), Some(min), max);
            match unit {
                Some(unit) => with_unit(column, unit),
                None => column,
            }
        })
        .collect()
}

/// A count or measure of the form: never below zero.
fn count(name: &str, group: &str) -> Column {
    between(in_group(number(name), group), Some(0.0), None)
}

fn count_unit(name: &str, group: &str, unit: &str) -> Column {
    with_unit(count(name, group), unit)
}

const LEAF: &str = "Seedling Leaf Stage (No.)";
const VIGOR: &str = "Seedling Health / Vigor (No.)";
const YIELD: &str = "Cumulative Yield";
const REJECTED: &str = "Rejected (kg)";
const REJECTS: [&str; 6] = [
    "Pest damage",
    "Disease",
    "Too small",
    "Deformed",
    "Rot",
    "Color reject",
];
/// The harvest rounds the old sheet kept (a date and kilos per plant each), at Harvest and at End of Cycles.
const ROUNDS: [&str; 5] = ["1st", "2nd", "3rd", "4th", "5th"];
/// Weeks of pest / disease checks, W1–W21: the first ten are the 0–70 DAT group, the rest 0–150 DAT.
const WEEKS: u32 = 21;
const WEEKS_EARLY: &str = "Pest/Disease Status 0–70 DAT (No. affected)";
const WEEKS_LATE: &str = "Pest/Disease Status 0–150 DAT (No. affected)";
/// The plants a block's observations are taken on: one column each, P#1–P#20.
const PLANTS: u32 = 20;

fn qa_qc_columns() -> Vec<Column> {
    let harvest_box = stage_box(8, "Harvest", Some("75–150 DAT"));
    let rejected_kg = REJECTS
        .iter()
        .map(|name| format!("[{harvest_box} › {REJECTED} › {name}]"))
        .collect::<Vec<_>>()
        .join(",");

    // The sheet's Planting Date and Block (a plot code: A1, B3…), the row's own; Notes closes the row (below).
    let mut columns = vec![
        required(also_called(date("Date"), &["Planting Date"])),
        required(also_called(link("Zone", ZONE_SOURCE), &["Block"])),
    ];
    columns.extend(stage(
        1,
        "Transplant",
        Some("0 DAT"),
        "0 DAT Transplant",
        vec![
            count("4–5, good", LEAF),
            count("3, >5", LEAF),
            count("Disease", LEAF),
            count("Healthy", VIGOR),
            count("Medium", VIGOR),
            count("Wilt", VIGOR),
        ],
    ));
    columns.extend(stage(
        2,
        "Establishment",
        Some("7 DAT"),
        "7 DAT Establishment",
        vec![
            count("Live plant", "Plant Survival (No.)"),
            // 20 plants a block: those not alive (the old sheet's =20-N7).
            in_group(
                formula("Dead plant", r#"=IF([Live plant]="","",20-[Live plant])"#),
                "Plant Survival (No.)",
            ),
            count("Upright plants", "New Growth (No.)"),
            count("Uneven / Wilt", "New Growth (No.)"),
        ],
    ));
    columns.extend(stage(
        3,
        "Vegetative",
        Some("30 DAT"),
        "30 DAT Vegetative",
        // The sheet's 20 plants for each measure: a score from 1 to 5, heights and the two canopy widths in cm, branches.
        per_plant("Plant Vigor Score (1–5)", None, 1.0, Some(5.0), |plant| {
            format!("P#{plant}")
        })
        .into_iter()
        .chain(per_plant(
            "Plant Height (cm)",
            Some("cm"),
            0.0,
            None,
            |plant| format!("P#{plant}"),
        ))
        .chain(per_plant(
            "Canopy Diameter A (cm) – widest direction",
            Some("cm"),
            0.0,
            None,
            |plant| format!("{plant}A"),
        ))
        .chain(per_plant(
            "Canopy Diameter B (cm) – perpendicular direction",
            Some("cm"),
            0.0,
            None,
            |plant| format!("{plant}B"),
        ))
        .chain(per_plant(
            "Branching (No. branches/plant)",
            None,
            0.0,
            None,
            |plant| format!("P#{plant}"),
        ))
        .collect(),
    ));
    columns.extend(stage(
        4,
        "Flowering",
        Some("45 DAT"),
        "45 DAT Flowering",
        per_plant(
            "Plant Flowering – Flowers per Plant (No.)",
            None,
            0.0,
            None,
            |plant| format!("P#{plant}"),
        )
        .into_iter()
        // The sheet's Flower Abortion, a percentage of the block.
        .chain([in_group(
            between(col("Flower abortion", "percentage"), Some(0.0), Some(100.0)),
            "Flower Abortion",
        )])
        .collect(),
    ));
    columns.extend(stage(
        5,
        "Fruit set",
        Some("60 DAT"),
        "60 DAT Fruit set",
        vec![
            count("Upright", "Fruit Orientation (No.)"),
            count("Mixed", "Fruit Orientation (No.)"),
            count("Different", "Fruit Orientation (No.)"),
            count("True-to-type", "Fruit Shape (No.)"),
            count("Variability", "Fruit Shape (No.)"),
            count("Off-type", "Fruit Shape (No.)"),
        ]
        .into_iter()
        .chain(per_plant(
            "Young/Developing Fruits (No. fruits/plant)",
            None,
            0.0,
            None,
            |plant| format!("P#{plant}"),
        ))
        .collect(),
    ));
    columns.extend(stage(
        6,
        "First Harvest",
        Some("75 DAT"),
        "75 DAT First Harvest",
        vec![date("Harvest date")]
            .into_iter()
            .chain(per_plant(
                "Fruit Length (cm)",
                Some("cm"),
                0.0,
                None,
                |plant| format!("P#{plant}"),
            ))
            .chain(per_plant(
                "Fruit Diameter (cm)",
                Some("cm"),
                0.0,
                None,
                |plant| format!("P#{plant}"),
            ))
            .collect(),
    ));
    columns.extend(stage(
        7,
        "Maturity",
        Some("75 DAT+"),
        "75 DAT+ Maturity",
        vec![
            count("Green", "Fruit Color (No.)"),
            count("Turning", "Fruit Color (No.)"),
            count("Red", "Fruit Color (No.)"),
        ],
    ));
    let mut harvest = vec![
        count_unit("Total", "Marketable Fruit (kg)", "kg"),
        count_unit("Marketable", "Marketable Fruit (kg)", "kg"),
    ];
    harvest.extend(REJECTS.iter().map(|name| count_unit(name, REJECTED, "kg")));
    // Every reason entered, their sum (the old sheet's Total (kg)).
    harvest.push(with_unit(
        in_group(
            formula(
                "Total",
                &format!(r#"=IF(COUNT({rejected_kg})<6,"",SUM({rejected_kg}))"#),
            ),
            REJECTED,
        ),
        "kg",
    ));
    harvest.push(count("Total plant", YIELD));
    // Each round's date and kilos per plant, as the sheet names them ("1st Date", "1st Harvest").
    for round in ROUNDS {
        harvest.push(in_group(date(&format!("{round} Date")), YIELD));
        harvest.push(count_unit(&format!("{round} Harvest"), YIELD, "kg/plant"));
    }
    columns.extend(stage(
        8,
        "Harvest",
        Some("75–150 DAT"),
        "75–150 DAT Harvest",
        harvest,
    ));
    // Each week's date and number affected (W1–W21), as the sheet has them.
    let mut health = Vec::new();
    for week in 1..=WEEKS {
        let group = if week <= 10 { WEEKS_EARLY } else { WEEKS_LATE };
        health.push(in_group(date(&format!("W{week} Date")), group));
        health.push(count(&format!("W{week}"), group));
    }
    columns.extend(stage(
        9,
        "Plant Health",
        Some("75–150 DAT"),
        "75–150 DAT Plant Health",
        health,
    ));
    let mut end = vec![count("Total plant", YIELD)];
    // Each round's date ("1st Date") and kilos per plant ("1st Harvest"), as the sheet names them.
    for round in ROUNDS {
        end.push(in_group(date(&format!("{round} Date")), YIELD));
        end.push(count_unit(&format!("{round} Harvest"), YIELD, "kg/plant"));
    }
    columns.extend(stage(10, "End of Cycles", None, "End of Cycles", end));
    // The old sheet's last column.
    columns.push(also_called(text("Notes"), &["Outside", "Other › Outside"]));
    columns
}

/// A column told apart by its stage box, group and name ("box|group|name", any part empty).
pub fn identity(column: &Column) -> String {
    format!(
        "{}|{}|{}",
        column.box_name.clone().unwrap_or_default(),
        column.group.clone().unwrap_or_default(),
        column.name
    )
}

/// The 72 columns the QA/QC table had before it followed the old sheet: a planned Date and Days after transplant in
/// every stage, the "Plant average" columns, the two pest / disease totals. A table made then still has them.
pub const QA_QC_BEFORE: [&str; 72] = [
    "||Date",
    "||Zone",
    "QC record||Plant batch",
    "QC record||Block",
    "1 · Transplant (0 DAT)||Date",
    "1 · Transplant (0 DAT)||Days after transplant",
    "1 · Transplant (0 DAT)|Seedling Leaf Stage (No.)|4–5, good",
    "1 · Transplant (0 DAT)|Seedling Leaf Stage (No.)|3, >5",
    "1 · Transplant (0 DAT)|Seedling Leaf Stage (No.)|Disease",
    "1 · Transplant (0 DAT)|Seedling Health / Vigor (No.)|Healthy",
    "1 · Transplant (0 DAT)|Seedling Health / Vigor (No.)|Medium",
    "1 · Transplant (0 DAT)|Seedling Health / Vigor (No.)|Wilt",
    "2 · Establishment (7 DAT)||Date",
    "2 · Establishment (7 DAT)||Days after transplant",
    "2 · Establishment (7 DAT)|Plant Survival (No.)|Live plant",
    "2 · Establishment (7 DAT)|Plant Survival (No.)|Dead plant",
    "2 · Establishment (7 DAT)|New Growth (No.)|Upright plants",
    "2 · Establishment (7 DAT)|New Growth (No.)|Uneven / Wilt",
    "3 · Vegetative (30 DAT)||Date",
    "3 · Vegetative (30 DAT)||Days after transplant",
    "3 · Vegetative (30 DAT)|Plant average|Vigor score (1–5)",
    "3 · Vegetative (30 DAT)|Plant average|Plant height",
    "3 · Vegetative (30 DAT)|Plant average|Canopy A, widest",
    "3 · Vegetative (30 DAT)|Plant average|Canopy B, across",
    "3 · Vegetative (30 DAT)|Plant average|Branches",
    "4 · Flowering (45 DAT)||Date",
    "4 · Flowering (45 DAT)||Days after transplant",
    "4 · Flowering (45 DAT)|Plant average|Plant flowering",
    "4 · Flowering (45 DAT)|Plant average|Flowers per plant",
    "5 · Fruit set (60 DAT)||Date",
    "5 · Fruit set (60 DAT)||Days after transplant",
    "5 · Fruit set (60 DAT)|Fruit Orientation (No.)|Upright",
    "5 · Fruit set (60 DAT)|Fruit Orientation (No.)|Mixed",
    "5 · Fruit set (60 DAT)|Fruit Orientation (No.)|Different",
    "5 · Fruit set (60 DAT)|Fruit Shape (No.)|True-to-type",
    "5 · Fruit set (60 DAT)|Fruit Shape (No.)|Variability",
    "5 · Fruit set (60 DAT)|Fruit Shape (No.)|Off-type",
    "5 · Fruit set (60 DAT)|Plant average|Young fruits per plant",
    "6 · First Harvest (75 DAT)||Date",
    "6 · First Harvest (75 DAT)||Days after transplant",
    "6 · First Harvest (75 DAT)||Harvest date",
    "6 · First Harvest (75 DAT)|Plant average|Fruit length",
    "6 · First Harvest (75 DAT)|Plant average|Fruit diameter",
    "7 · Maturity (75 DAT+)||Date",
    "7 · Maturity (75 DAT+)||Days after transplant",
    "7 · Maturity (75 DAT+)|Fruit Color (No.)|Green",
    "7 · Maturity (75 DAT+)|Fruit Color (No.)|Turning",
    "7 · Maturity (75 DAT+)|Fruit Color (No.)|Red",
    "8 · Harvest (75–150 DAT)||Date",
    "8 · Harvest (75–150 DAT)||Days after transplant",
    "8 · Harvest (75–150 DAT)|Marketable Fruit (kg)|Total",
    "8 · Harvest (75–150 DAT)|Marketable Fruit (kg)|Marketable",
    "8 · Harvest (75–150 DAT)|Rejected (kg)|Pest damage",
    "8 · Harvest (75–150 DAT)|Rejected (kg)|Disease",
    "8 · Harvest (75–150 DAT)|Rejected (kg)|Too small",
    "8 · Harvest (75–150 DAT)|Rejected (kg)|Deformed",
    "8 · Harvest (75–150 DAT)|Rejected (kg)|Rot",
    "8 · Harvest (75–150 DAT)|Rejected (kg)|Color reject",
    "8 · Harvest (75–150 DAT)|Rejected (kg)|Total",
    "8 · Harvest (75–150 DAT)|Cumulative Yield|Harvest rounds",
    "8 · Harvest (75–150 DAT)|Cumulative Yield|Harvested",
    "8 · Harvest (75–150 DAT)|Cumulative Yield|Total plant",
    "9 · Plant Health (75–150 DAT)||Date",
    "9 · Plant Health (75–150 DAT)||Days after transplant",
    "9 · Plant Health (75–150 DAT)|Pest / Disease per block (No.)|0–70 DAT",
    "9 · Plant Health (75–150 DAT)|Pest / Disease per block (No.)|0–150 DAT",
    "10 · End of Cycles||Date",
    "10 · End of Cycles||Days after transplant",
    "10 · End of Cycles|Cumulative Yield|Harvest rounds",
    "10 · End of Cycles|Cumulative Yield|Harvested",
    "10 · End of Cycles|Cumulative Yield|Total plant",
    "10 · End of Cycles|Cumulative Yield|Yield per plant",
];

/// The checks the QA/QC table was given besides the sheet's own columns ("OK" or what the counts added up to) and the
/// sums the dashboards used, all taken out again: the table is only the columns the farm's sheet has.
const QA_QC_REMOVED: [&str; 7] = [
    "1 · Transplant (0 DAT)|Seedling Leaf Stage (No.)|Leaf stage check",
    "1 · Transplant (0 DAT)|Seedling Health / Vigor (No.)|Health check",
    "2 · Establishment (7 DAT)|New Growth (No.)|Growth check",
    "5 · Fruit set (60 DAT)|Fruit Orientation (No.)|Orientation check",
    "5 · Fruit set (60 DAT)|Fruit Shape (No.)|Shape check",
    "7 · Maturity (75 DAT+)|Fruit Color (No.)|Color check",
    "8 · Harvest (75–150 DAT)|Marketable Fruit (kg)|Marketable check",
];

/// A column of an earlier template that this one doesn't have (a table made earlier still has it, and may have values in it).
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Retired {
    #[serde(rename = "box", skip_serializing_if = "Option::is_none")]
    pub box_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    pub name: String,
}

/// The columns of the QA/QC template as it was, now gone from it.
fn qa_qc_retired() -> Vec<Retired> {
    let now: std::collections::HashSet<String> = qa_qc_columns().iter().map(identity).collect();
    QA_QC_BEFORE
        .iter()
        .chain(QA_QC_REMOVED.iter())
        .filter(|old| !now.contains(**old))
        .map(|old| {
            let mut parts = old.splitn(3, '|');
            let (box_name, group, name) = (
                parts.next().unwrap_or(""),
                parts.next().unwrap_or(""),
                parts.next().unwrap_or(""),
            );
            Retired {
                box_name: (!box_name.is_empty()).then(|| box_name.to_string()),
                group: (!group.is_empty()).then(|| group.to_string()),
                name: name.to_string(),
            }
        })
        .collect()
}

/// The columns a template table gives now, and those it used to give that are gone (by its `template_key`).
pub fn columns_and_retired(template_key: &str) -> (Vec<Column>, Vec<Retired>) {
    let columns = chili_template()
        .into_iter()
        .find(|sheet| sheet.key == template_key)
        .map(|sheet| sheet.columns)
        .unwrap_or_default();
    let retired = match template_key {
        "qa-qc-management" => qa_qc_retired(),
        "zone-measurement" => zone_measurement_retired(),
        _ => Vec::new(),
    };
    (columns, retired)
}

// -------------------------------------------------------------- Nursery

/// The Batch table: one row for each nursery batch, its number (B1, B2, …) and the variety it is: the farm's two columns, no more.
fn batch_columns() -> Vec<Column> {
    vec![
        also_called(required(text("Batch number")), &["Batch #", "Batch", "Batch no", "Batch No."]),
        also_called(required(text("Variety name")), &["Plant type", "Variety", "Variety Name"]),
    ]
}

/// A seedling count: never below zero.
fn seedlings(name: &str) -> Column {
    between(number(name), Some(0.0), None)
}

/// The Nursery Progress table: each assessment of a batch, how many seedlings, how many healthy, what was wrong with the rest, and the supply dates.
fn nursery_batch_columns() -> Vec<Column> {
    // The table's two header rows: a band naming what the columns under it are, over each column's own name.
    nursery_columns()
        .into_iter()
        .map(|column| {
            let band = match column.name.as_str() {
                "Batch number" | "Variety name" => "Batch",
                "Total number" | "Healthy number" => "Seedlings",
                "Stem rot" | "Leaf rot" | "Smaller" | "Disease" | "Physical damage" | "Total unhealthy" => "Not healthy",
                "Healthy %" | "Count check" => "Check",
                _ => "Supply",
            };
            in_group(column, band)
        })
        .collect()
}

fn nursery_columns() -> Vec<Column> {
    let damage = r#"[Stem rot],[Leaf rot],[Smaller],[Disease],[Physical damage]"#;
    // Everything the batch's seedlings were sorted into: healthy and each kind of not healthy.
    let sorted = format!("[Healthy number],{damage}");
    vec![
        // The batch picks its number from the Batch table.
        also_called(required(link("Batch number", BATCH_SOURCE)), &["Batch #", "Batch", "Batch no", "Batch No."]),
        // Its variety, read from the Batch table by the number (worked out here, so a file's "Variety" or "Plant type" fills nothing).
        also_called(
            formula(
                "Variety name",
                r#"=IF([Batch number]="","",LOOKUP('Batch'[Variety name],'Batch'[Batch number],[Batch number],""))"#,
            ),
            &["Variety", "Plant type"],
        ),
        required(seedlings("Total number")),
        also_called(seedlings("Healthy number"), &["Healthy"]),
        seedlings("Stem rot"),
        seedlings("Leaf rot"),
        seedlings("Smaller"),
        seedlings("Disease"),
        seedlings("Physical damage"),
        also_called(
            formula(
                "Total unhealthy",
                &format!(r#"=IF(COUNT({damage})=0,"",SUM({damage}))"#),
            ),
            &["Not healthy"],
        ),
        formula(
            "Healthy %",
            r#"=IF(OR([Healthy number]="",[Total number]="",[Total number]=0),"",ROUND([Healthy number]/[Total number]*100,2))"#,
        ),
        // Total number must equal the healthy ones plus every not-healthy one: "OK", or how many are missing or over.
        formula(
            "Count check",
            &format!(
                r#"=IF(OR([Total number]="",COUNT({sorted})=0),"",IF(SUM({sorted})=[Total number],"OK",IF(SUM({sorted})<[Total number],([Total number]-SUM({sorted}))&" missing",(SUM({sorted})-[Total number])&" over")))"#
            ),
        ),
        also_called(date("Supply date start"), &["Supply date", "Supply start"]),
        also_called(date("Supply date end"), &["Supply end"]),
    ]
}

fn zone_record_columns() -> Vec<Column> {
    vec![
        // The nursery batch comes first, after the row's ID, then its variety; then the zone number and the plot.
        link("Nursery batch", BATCH_SOURCE),
        link("Plant type", VARIETY_SOURCE),
        // The plot's zone number, read from Zones (never typed): the group the farm adds its plots up by.
        formula(
            "Zone number",
            r#"=IF([Zone plot]="","",LOOKUP('Zones'[Zone number],'Zones'[Plot],[Zone plot],""))"#,
        ),
        required(link("Zone plot", ZONE_SOURCE)),
        required(date("Record date")),
        number("Day number"),
        number("Plant count"),
        date("Replant date"),
        number("Replant count"),
        number("Dead plant"),
        // The status is the last thing said about the record, just before its note.
        text("Status"),
        text("Note"),
    ]
}

/// The Harvest table, as the farm's own design has it (harvest_id, zone_plot, chili_type, date_harvest, harvest_yield):
/// the ID the app numbers is harvest_id, the plot is one of the Zones' plots, the chili is ripe or unripe, and the yield
/// is a weight in kg that is never below zero (the design's DECIMAL(10, 2)). Three columns work themselves out and are
/// never typed: the plot's zone number (read from Zones), and the yield again as ripe and as unripe, which the
/// dashboard adds up by day and by zone number.
fn harvest_columns() -> Vec<Column> {
    let mut chili_type = required(col("Chili type", "choice"));
    chili_type.options = vec!["ripe".into(), "unripe".into()];
    let kind = |name: &str, kind: &str| {
        with_unit(
            formula(name, &format!(r#"=IF([Chili type]="{kind}",[Harvest yield],"")"#)),
            "kg",
        )
    };
    vec![
        also_called(required(link("Zone plot", ZONE_SOURCE)), &["Zone", "Plot"]),
        // The plot's zone number, from the Zones table: nothing is typed here.
        formula(
            "Zone number",
            r#"=IF([Zone plot]="","",LOOKUP('Zones'[Zone number],'Zones'[Plot],[Zone plot],""))"#,
        ),
        chili_type,
        also_called(required(date("Date harvest")), &["Date", "Harvest date"]),
        also_called(
            required(with_unit(between(number("Harvest yield"), Some(0.0), None), "kg")),
            &["Yield", "Harvest yield (kg)", "Weight", "Weight (kg)"],
        ),
        kind("Ripe yield", "ripe"),
        kind("Unripe yield", "unripe"),
    ]
}

/// A log the farm fills in day by day: Date, Zone, then what it records.
fn zone_log(extra: Vec<Column>) -> Vec<Column> {
    let mut columns = date_zone();
    columns.extend(extra);
    columns.push(text("Note"));
    columns
}

/// A plot's measurement, as the farm's own design has it (zone → zone plot → zone measurement): the plot is the record
/// that matters, and its zone name and zone number are only the group it belongs to, so they are read from Zones here
/// and never typed twice. The area in the plan is typed, the width and length measured; the actual area, the error and
/// the error as a percentage of the plan work themselves out (rounded to 2 places, as the design's DECIMAL(10, 2)).
///
/// Unlike the rest of the template this does not keep the server's Excel headers: the server's own Width / Length / Area
/// are still accepted as other names (`also_called`), so a file made from the server's template fills the same columns.
fn zone_measurement_columns() -> Vec<Column> {
    let size = |name: &str, unit: &str| with_unit(between(number(name), Some(0.0), None), unit);
    vec![
        required(link("Zone plot", ZONE_SOURCE)),
        // The plot's group, from the Zones table: nothing is typed here.
        formula(
            "Zone",
            r#"=IF([Zone plot]="","",LOOKUP('Zones'[Zone],'Zones'[Plot],[Zone plot],""))"#,
        ),
        formula(
            "Zone number",
            r#"=IF([Zone plot]="","",LOOKUP('Zones'[Zone number],'Zones'[Plot],[Zone plot],""))"#,
        ),
        size("Area in plan", "m²"),
        also_called(size("Actual width", "m"), &["Width", "Width (m)"]),
        also_called(size("Actual length", "m"), &["Length", "Length (m)"]),
        also_called(
            with_unit(
                formula(
                    "Actual area",
                    r#"=IF(OR([Actual width]="",[Actual length]=""),"",ROUND([Actual width]*[Actual length],2))"#,
                ),
                "m²",
            ),
            &["Area", "Area (m²)"],
        ),
        // Actual area − area in plan: over the plan is positive, short of it negative.
        with_unit(
            formula(
                "Measure error",
                r#"=IF(OR([Actual width]="",[Actual length]="",[Area in plan]=""),"",ROUND([Actual width]*[Actual length]-[Area in plan],2))"#,
            ),
            "m²",
        ),
        formula(
            "Error %",
            r#"=IF(OR([Actual width]="",[Actual length]="",[Area in plan]="",[Area in plan]=0),"",ROUND((ROUND([Actual width]*[Actual length],2)-[Area in plan])/[Area in plan]*100,2))"#,
        ),
        text("Note"),
    ]
}

/// What Zone Measurement had before it followed the farm's design. A table made then still has these: one with no rows
/// and nothing of the person's own is brought up to date when it is opened, one holding values keeps them.
fn zone_measurement_retired() -> Vec<Retired> {
    [
        "Planned plot",
        "Actual plot",
        "Number each plot",
        "Actual planting plot",
        "Width",
        "Length",
        "Area",
    ]
    .iter()
    .map(|name| Retired {
        box_name: None,
        group: None,
        name: name.to_string(),
    })
    .collect()
}

/// The ID every table starts with, first: a number the app gives each row (1, 2, 3…), never typed or changed (src/ids.rs).
/// A file's "ID", "Id" or "No" column is this one's, so it is not added as a column of its own.
pub fn id_column() -> Column {
    let mut column = also_called(number("ID"), &["Id", "No", "No."]);
    column.auto = true;
    column
}

/// The chili template's tables, each with its ID first.
pub fn chili_template() -> Vec<TemplateSheet> {
    chili_sheets()
        .into_iter()
        .map(|mut sheet| {
            sheet.columns.insert(0, id_column());
            sheet
        })
        .collect()
}

fn chili_sheets() -> Vec<TemplateSheet> {
    vec![
        TemplateSheet {
            key: "zones",
            title: "Zones",
            heading: "Setup",
            icon: "map",
            about: "The farm's zones and plots. Every table's Zone picks a Plot from here.",
            columns: vec![
                required(text("Zone")),
                required(text("Plot")),
                number("Plant capacity"),
                text("Note"),
                number("Zone number"),
                number("Row"),
                number("Column"),
                text("Plot status"),
                text("Status name"),
                text("Outline"),
            ],
        },
        TemplateSheet {
            key: "zone-measurement",
            title: "Zone Measurement",
            heading: "Setup",
            icon: "ruler",
            about: "Each plot's measured size: the area in the plan against the width and length measured, and the error between them. The zone and zone number are the plot's group, read from Zones.",
            columns: zone_measurement_columns(),
        },
        TemplateSheet {
            key: "batches",
            title: "Batch",
            heading: "Nursery",
            icon: "package",
            about: "The nursery's batches: a number (B1, B2, …) and the variety each is. Nursery Progress and Zone Records pick their batch from here.",
            columns: batch_columns(),
        },
        TemplateSheet {
            key: "nursery-batches",
            title: "Nursery Progress",
            heading: "Nursery",
            icon: "seedling",
            about: "How each batch is doing in the nursery: how many seedlings, how many healthy, what was wrong with the rest, and when it was supplied.",
            columns: nursery_batch_columns(),
        },
        TemplateSheet {
            key: "zone-records",
            title: "Zone Records",
            heading: "Planting",
            icon: "clipboard",
            about: "Plant progress by zone plot: plants planted, replanted and dead, and how they're growing.",
            columns: zone_record_columns(),
        },
        TemplateSheet {
            key: "soil-preparation",
            title: "Soil Preparation",
            heading: "Planting",
            icon: "shovel",
            about: "Record how each zone's soil is prepared before planting — ploughing, beds, compost and soil tests.",
            columns: zone_log(vec![]),
        },
        TemplateSheet {
            key: "irrigation",
            title: "Irrigation",
            heading: "Planting",
            icon: "droplets",
            about: "Plan and log watering for each zone: when, how long and how much.",
            columns: zone_log(vec![]),
        },
        TemplateSheet {
            key: "fertigation",
            title: "Fertigation",
            heading: "Planting",
            icon: "flask",
            about: "Log the fertilizer given through the irrigation water — mix, dose and date — for each zone.",
            columns: zone_log(vec![]),
        },
        TemplateSheet {
            key: "pruning",
            title: "Pruning",
            heading: "Planting",
            icon: "scissors",
            about: "Track pruning rounds across the zones and who did them.",
            columns: zone_log(vec![]),
        },
        TemplateSheet {
            key: "pesticides",
            title: "Pesticides",
            heading: "Planting",
            icon: "spray",
            about: "Record every spray: the product, dose, target pest and the safe-to-harvest date.",
            columns: zone_log(vec![]),
        },
        TemplateSheet {
            key: "harvest",
            title: "Harvest",
            heading: "Planting",
            icon: "wheat",
            about: "Record each harvest: the plot, whether the chili was ripe or unripe, the date and the yield in kg. Its dashboard adds them up by day and by zone number.",
            columns: harvest_columns(),
        },
        TemplateSheet {
            key: "qa-qc-management",
            title: "QA/QC Management",
            heading: "QA/QC",
            icon: "check",
            about: "Quality checks on the crop, plot by plot and stage by stage: the approved 10-stage QC form, a row per QC record (its plot the row's Zone, its planting the row's Date).",
            columns: qa_qc_columns(),
        },
        TemplateSheet {
            key: "planting-date",
            title: "Planting Date",
            heading: "QA/QC",
            icon: "calendar",
            about: "Each zone's planting date and expected harvest window (75–150 days after transplant).",
            columns: vec![
                required(link("Zone", ZONE_SOURCE)),
                required(date("Planting date")),
                formula(
                    "Harvest from",
                    r#"=IF([Planting date]="","",[Planting date]+75)"#,
                ),
                formula(
                    "Harvest to",
                    r#"=IF([Planting date]="","",[Planting date]+150)"#,
                ),
                text("Note"),
            ],
        },
        TemplateSheet {
            key: "inventory",
            title: "Inventory Management",
            heading: "Inventory",
            icon: "package",
            about: "The stock in the greenhouse: stock in and stock out by quantity.",
            columns: vec![
                date("Date"),
                required(text("Item")),
                number("Stock in"),
                number("Stock out"),
                text("Unit"),
                text("Note"),
            ],
        },
        TemplateSheet {
            key: "finance",
            title: "Finance & Accounting",
            heading: "Operational",
            icon: "wallet",
            about: "The project's income and costs: purchases, sales and the accounts behind them.",
            columns: vec![
                date("Date"),
                required(text("Description")),
                text("Category"),
                number("Income"),
                number("Cost"),
                text("Note"),
            ],
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn qa_qc_follows_the_old_sheet() {
        let columns = qa_qc_columns();
        // The row's Date (the sheet's Planting Date) and Zone (its Block), then each stage as the old sheet lays it
        // out, then Notes: the sheet's 287 columns and nothing the sheet does not have (no checks, no sums added for the
        // dashboards). Only its two own totals are worked out: the dead plants and the rejected kilos. No planned Date,
        // no plant averages, no QC record.
        assert_eq!(columns.len(), 287);
        assert_eq!(
            columns
                .iter()
                .filter(|c| c.col_type == "formula")
                .map(|c| c.name.as_str())
                .collect::<Vec<_>>(),
            ["Dead plant", "Total"]
        );
        let boxes: HashSet<_> = columns.iter().filter_map(|c| c.box_name.clone()).collect();
        assert_eq!(boxes.len(), 10);
        assert_eq!(columns[0].name, "Date");
        assert_eq!(columns[1].source.as_deref(), Some("'Zones'[Plot]"));
        // Each stage begins with the date it was observed, named as the sheet names that column.
        for (stage, label) in [
            ("1 ·", "0 DAT Transplant"),
            ("2 ·", "7 DAT Establishment"),
            ("3 ·", "30 DAT Vegetative"),
            ("4 ·", "45 DAT Flowering"),
            ("5 ·", "60 DAT Fruit set"),
            ("6 ·", "75 DAT First Harvest"),
            ("7 ·", "75 DAT+ Maturity"),
            ("8 ·", "75–150 DAT Harvest"),
            ("9 ·", "75–150 DAT Plant Health"),
            ("10 ·", "End of Cycles"),
        ] {
            let first = columns
                .iter()
                .find(|c| c.box_name.as_deref().is_some_and(|b| b.starts_with(stage)))
                .unwrap();
            assert_eq!(
                (first.name.as_str(), first.col_type.as_str()),
                (label, "date"),
                "{stage}"
            );
        }
        assert!(
            columns.iter().all(|c| c.name != "Days after transplant"
                && c.group.as_deref() != Some("Plant average"))
        );
    }

    /// What the template had before it followed the sheet, and no longer has: all of it by design, and nothing else.
    #[test]
    fn qa_qc_drops_only_what_the_sheet_has_no_column_for() {
        let retired = qa_qc_retired();
        // 32 of the stages, and the QC record's Plant batch and Block (the sheet has none), then the 5 sums the dashboards
        // used (Harvest rounds and Harvested at two stages, Yield per plant) and the 7 checks.
        assert_eq!(retired.len(), 34 + 5 + 7);
        assert_eq!(
            retired
                .iter()
                .filter(|old| old.box_name.as_deref() == Some("QC record"))
                .count(),
            2
        );
        let names: Vec<String> = retired
            .iter()
            .map(|old| format!("{}|{}", old.group.clone().unwrap_or_default(), old.name))
            .collect();
        // A planned Date and Days after transplant at each of the ten stages (20), the Plant average group (10), the two totals.
        assert_eq!(
            names.iter().filter(|name| name.ends_with("|Date")).count(),
            10
        );
        assert_eq!(
            names
                .iter()
                .filter(|name| name.ends_with("|Days after transplant"))
                .count(),
            10
        );
        assert_eq!(
            names
                .iter()
                .filter(|name| name.starts_with("Plant average|"))
                .count(),
            10
        );
        assert!(names.contains(&"Pest / Disease per block (No.)|0–70 DAT".to_string()));
        assert!(names.contains(&"Pest / Disease per block (No.)|0–150 DAT".to_string()));
        // Everything the dashboards read is still there.
        let now: Vec<String> = qa_qc_columns().iter().map(identity).collect();
        for needed in [
            "Live plant",
            "Dead plant",
            "Marketable",
            "Zone",
            "Date",
        ] {
            assert!(
                now.iter().any(|id| id.ends_with(&format!("|{needed}"))),
                "{needed}"
            );
        }
    }

    /// The columns of the table before that the template still has: all there, in the same order.
    #[test]
    fn qa_qc_keeps_the_rest_of_what_it_had_in_the_same_order() {
        let now: Vec<String> = qa_qc_columns().iter().map(identity).collect();
        let gone: HashSet<String> = qa_qc_retired()
            .iter()
            .map(|old| {
                format!(
                    "{}|{}|{}",
                    old.box_name.clone().unwrap_or_default(),
                    old.group.clone().unwrap_or_default(),
                    old.name
                )
            })
            .collect();
        let mut at = 0;
        for old in QA_QC_BEFORE.iter().filter(|old| !gone.contains(**old)) {
            let found = now[at..]
                .iter()
                .position(|name| name == old)
                .unwrap_or_else(|| panic!("{old} is gone or moved"));
            at += found + 1;
        }
    }

    #[test]
    fn the_sheet_s_own_names_for_the_row_s_columns_are_known() {
        let columns = qa_qc_columns();
        let named = |name: &str| columns.iter().find(|c| c.name == name).unwrap();
        assert_eq!(named("Date").aliases, ["Planting Date"]);
        assert_eq!(named("Zone").aliases, ["Block"]);
        assert_eq!(named("Notes").aliases, ["Outside", "Other › Outside"]);
        // No other column answers to one of those names, or "Block" would match two.
        let mut seen = HashSet::new();
        for column in &columns {
            for alias in &column.aliases {
                assert!(seen.insert(alias.to_lowercase()), "{alias} is twice");
                assert!(
                    columns
                        .iter()
                        .all(|other| other.name.to_lowercase() != alias.to_lowercase()),
                    "{alias} is also a name"
                );
            }
        }
    }

    #[test]
    fn qa_qc_columns_are_told_apart_by_stage_group_and_name() {
        // Bringing a table up to date matches columns by these three, so no two may share them.
        let mut seen = HashSet::new();
        for column in qa_qc_columns() {
            let name = identity(&column);
            assert!(seen.insert(name.clone()), "{name} is twice");
        }
    }

    /// The app's tests (src/app/sheet/fixtures/qa-qc-columns.json) run the template's QA/QC formulas in the app's own
    /// engine from this copy: when the template changes, make it again with
    /// `TEMPLATE_OUT=/tmp/t.json cargo test dump_template -- --ignored` (its "qa-qc-management" columns).
    #[test]
    fn the_qa_qc_columns_the_app_tests_use_are_the_template_s() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../src/app/sheet/fixtures/qa-qc-columns.json"
        ))
        .unwrap();
        let mut columns = qa_qc_columns();
        for (index, column) in columns.iter_mut().enumerate() {
            column.key = format!("c{}", index + 1);
        }
        assert_eq!(
            fixture,
            serde_json::to_value(&columns).unwrap(),
            "the QA/QC fixture is out of date"
        );
    }

    /// The app's tests (src/app/sheet/fixtures/nursery-columns.json) run these columns' formulas in the app's own engine from
    /// this copy: when they change, make it again with `TEMPLATE_OUT=/tmp/t.json cargo test dump_template -- --ignored`
    /// (its "nursery-batches" columns).
    #[test]
    fn the_nursery_columns_the_app_tests_use_are_the_template_s() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../src/app/sheet/fixtures/nursery-columns.json"
        ))
        .unwrap();
        let mut columns = nursery_batch_columns();
        for (index, column) in columns.iter_mut().enumerate() {
            column.key = format!("c{}", index + 1);
        }
        assert_eq!(
            fixture,
            serde_json::to_value(&columns).unwrap(),
            "the nursery fixture is out of date"
        );
    }

    /// The app's tests (src/app/sheet/fixtures/batches-columns.json) run the Batches table's check in the app's own engine
    /// from this copy; make it again with `TEMPLATE_OUT=/tmp/t.json cargo test dump_template -- --ignored` ("batches").
    #[test]
    fn the_batch_columns_the_app_tests_use_are_the_template_s() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../src/app/sheet/fixtures/batches-columns.json"
        ))
        .unwrap();
        let mut columns = batch_columns();
        for (index, column) in columns.iter_mut().enumerate() {
            column.key = format!("c{}", index + 1);
        }
        assert_eq!(
            fixture,
            serde_json::to_value(&columns).unwrap(),
            "the batches fixture is out of date"
        );
    }

    #[test]
    fn the_batches_table_comes_before_the_nursery_progress_it_feeds() {
        let sheets = chili_template();
        let at = |title: &str| sheets.iter().position(|sheet| sheet.title == title).unwrap();
        // The nursery has these two tables and no variety list of its own.
        assert!(sheets.iter().all(|sheet| sheet.title != "Chili Varieties"));
        assert_eq!(at("Batch") + 1, at("Nursery Progress"));
        let batches = &sheets[at("Batch")];
        assert_eq!(batches.heading, "Nursery");
        let names: Vec<&str> = batches.columns.iter().map(|column| column.name.as_str()).collect();
        assert_eq!(names, ["ID", "Batch number", "Variety name"]);
        assert!(batches.columns[1].required && batches.columns[2].required);
    }

    #[test]
    fn nursery_counts_are_never_negative_and_the_sorting_is_checked_against_the_total() {
        let columns = nursery_batch_columns();
        let named = |name: &str| columns.iter().find(|c| c.name == name).unwrap();
        for name in ["Total number", "Healthy number", "Stem rot", "Leaf rot", "Smaller", "Disease", "Physical damage"] {
            assert_eq!((named(name).min, named(name).max), (Some(0.0), None), "{name}");
        }
        assert_eq!(named("Count check").col_type, "formula");
        let at = |name: &str| columns.iter().position(|c| c.name == name).unwrap();
        // Beside the percentage, before the dates.
        assert_eq!(at("Count check"), at("Healthy %") + 1);
    }

    #[test]
    fn nursery_progress_follows_the_note_and_picks_its_batch_from_the_batch_table() {
        let columns = nursery_batch_columns();
        let names: Vec<&str> = columns.iter().map(|column| column.name.as_str()).collect();
        assert_eq!(
            names,
            [
                "Batch number", "Variety name", "Total number", "Healthy number", "Stem rot", "Leaf rot", "Smaller", "Disease",
                "Physical damage", "Total unhealthy", "Healthy %", "Count check", "Supply date start", "Supply date end",
            ]
        );
        assert_eq!(columns[0].col_type, "link");
        assert_eq!(columns[0].source.as_deref(), Some("'Batch'[Batch number]"));
        // An older file's names still find their column.
        let called = |name: &str| columns.iter().find(|c| c.aliases.iter().any(|a| a == name)).map(|c| c.name.as_str());
        assert_eq!(called("Healthy"), Some("Healthy number"));
        assert_eq!(called("Not healthy"), Some("Total unhealthy"));
        assert_eq!(called("Supply date"), Some("Supply date start"));
        assert_eq!(called("Batch #"), Some("Batch number"));
    }

    #[test]
    fn qa_qc_counts_are_never_negative_and_scores_and_percentages_have_their_range() {
        let columns = qa_qc_columns();
        let named = |name: &str| columns.iter().find(|c| c.name == name).unwrap();
        let vigor = named("P#1");
        assert_eq!((vigor.min, vigor.max), (Some(1.0), Some(5.0)));
        for name in ["Flower abortion"] {
            assert_eq!(
                (named(name).min, named(name).max),
                (Some(0.0), Some(100.0)),
                "{name}"
            );
        }
        // Every count, measure and weekly number: zero or more, no upper limit (a block can have any number of cases).
        for column in columns.iter().filter(|c| c.col_type == "number") {
            let score = column.group.as_deref() == Some("Plant Vigor Score (1–5)");
            assert_eq!(
                column.min,
                Some(if score { 1.0 } else { 0.0 }),
                "{}",
                column.name
            );
        }
        let week = named("W21");
        assert_eq!((week.min, week.max), (Some(0.0), None));
        // Dates and formulas have no range.
        assert!(
            columns
                .iter()
                .filter(|c| c.col_type == "date" || c.col_type == "formula")
                .all(|c| c.min.is_none() && c.max.is_none())
        );
    }

    #[test]
    fn a_column_saved_before_ranges_has_none_and_a_range_is_kept_as_written() {
        let old: Column =
            serde_json::from_str(r#"{"key":"c1","name":"Live plant","type":"number"}"#).unwrap();
        assert_eq!((old.min, old.max), (None, None));
        assert!(!serde_json::to_string(&old).unwrap().contains("min"));
        let with: Column = serde_json::from_str(
            r#"{"key":"c2","name":"Vigor","type":"number","min":1,"max":5.5}"#,
        )
        .unwrap();
        assert_eq!((with.min, with.max), (Some(1.0), Some(5.5)));
        let back: Column = serde_json::from_str(&serde_json::to_string(&with).unwrap()).unwrap();
        assert_eq!((back.min, back.max), (Some(1.0), Some(5.5)));
    }

    #[test]
    fn every_formula_names_columns_the_table_has() {
        for sheet in chili_template() {
            let names: HashSet<String> = sheet
                .columns
                .iter()
                .flat_map(|c| {
                    let mut names = vec![c.name.clone()];
                    if let Some(b) = &c.box_name {
                        names.push(format!("{b} › {}", c.name));
                        if let Some(g) = &c.group {
                            names.push(format!("{b} › {g} › {}", c.name));
                        }
                    }
                    names
                })
                .collect();
            for column in sheet.columns.iter().filter(|c| c.col_type == "formula") {
                let formula = column.formula.as_deref().unwrap();
                let mut rest = formula;
                while let Some(start) = rest.find('[') {
                    let end = rest[start..].find(']').unwrap() + start;
                    let name = &rest[start + 1..end];
                    // 'Table'[Column] is another table's column (LOOKUP, COUNTIF…): checked by `links_point_at_template_tables`' kind of test below.
                    let other_table = rest[..start].ends_with('\'');
                    if other_table {
                        let table = rest[..start - 1].rsplit('\'').next().unwrap();
                        let target = chili_template()
                            .into_iter()
                            .find(|s| s.title == table)
                            .unwrap_or_else(|| panic!("{}: {} names the table '{}'", sheet.title, column.name, table));
                        assert!(
                            target.columns.iter().any(|c| c.name == name),
                            "{}: {} names '{}'[{}]",
                            sheet.title,
                            column.name,
                            table,
                            name
                        );
                    } else {
                        assert!(
                            names.contains(name),
                            "{}: {} names [{}]",
                            sheet.title,
                            column.name,
                            name
                        );
                    }
                    rest = &rest[end + 1..];
                }
            }
        }
    }

    /// The app's tests (src/app/sheet/fixtures/zone-measurement-columns.json) run these columns' formulas in the app's own
    /// engine from this copy; make it again with `TEMPLATE_OUT=/tmp/t.json cargo test dump_template -- --ignored`
    /// (the "zone-measurement" table's "columns").
    #[test]
    fn the_zone_measurement_columns_the_app_tests_use_are_the_template_s() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../src/app/sheet/fixtures/zone-measurement-columns.json"
        ))
        .unwrap();
        let mut columns = zone_measurement_columns();
        for (index, column) in columns.iter_mut().enumerate() {
            column.key = format!("c{}", index + 1);
        }
        assert_eq!(
            fixture,
            serde_json::to_value(&columns).unwrap(),
            "the zone measurement fixture is out of date"
        );
    }

    /// The app's tests (src/app/sheet/fixtures/zone-records-columns.json) add the Zone Records up by zone number from this
    /// copy; make it again with `TEMPLATE_OUT=/tmp/t.json cargo test dump_template -- --ignored` (the "zone-records" table's "columns").
    #[test]
    fn the_zone_record_columns_the_app_tests_use_are_the_template_s() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../src/app/sheet/fixtures/zone-records-columns.json"
        ))
        .unwrap();
        let mut columns = zone_record_columns();
        for (index, column) in columns.iter_mut().enumerate() {
            column.key = format!("c{}", index + 1);
        }
        assert_eq!(
            fixture,
            serde_json::to_value(&columns).unwrap(),
            "the zone records fixture is out of date"
        );
    }

    /// The app's tests (src/app/sheet/fixtures/harvest-columns.json) add the harvests up by day and by zone number from this
    /// copy (the "harvest" table's "columns" without its ID); a copy that drifts fails here.
    #[test]
    fn the_harvest_columns_the_app_tests_use_are_the_template_s() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!("../../src/app/sheet/fixtures/harvest-columns.json")).unwrap();
        let mut columns = harvest_columns();
        for (index, column) in columns.iter_mut().enumerate() {
            column.key = format!("c{}", index + 1);
        }
        assert_eq!(fixture, serde_json::to_value(&columns).unwrap(), "the harvest fixture is out of date");
    }

    #[test]
    fn zone_measurement_follows_the_farms_zone_plot_design() {
        let columns = zone_measurement_columns();
        let names: Vec<&str> = columns.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(
            names,
            [
                "Zone plot",
                "Zone",
                "Zone number",
                "Area in plan",
                "Actual width",
                "Actual length",
                "Actual area",
                "Measure error",
                "Error %",
                "Note"
            ]
        );
        let by = |name: &str| columns.iter().find(|c| c.name == name).unwrap();
        // The plot is the record (required, picked from Zones); its zone name and number are its group, read, never typed.
        assert!(by("Zone plot").required);
        assert_eq!(by("Zone plot").source.as_deref(), Some("'Zones'[Plot]"));
        assert_eq!(by("Zone").col_type, "formula");
        assert_eq!(by("Zone number").col_type, "formula");
        // Typed: the plan and the two measures, never below zero (the design's CHECK >= 0). Worked out: the rest.
        for name in ["Area in plan", "Actual width", "Actual length"] {
            assert_eq!(by(name).col_type, "number", "{name}");
            assert_eq!((by(name).min, by(name).max), (Some(0.0), None), "{name}");
        }
        for name in ["Actual area", "Measure error", "Error %"] {
            assert_eq!(by(name).col_type, "formula", "{name}");
        }
        assert_eq!(by("Actual width").unit.as_deref(), Some("m"));
        assert_eq!(by("Area in plan").unit.as_deref(), Some("m²"));
        // The server's own headers still fill the same columns.
        assert_eq!(by("Actual width").aliases, ["Width", "Width (m)"]);
        assert_eq!(by("Actual length").aliases, ["Length", "Length (m)"]);
        assert_eq!(by("Actual area").aliases, ["Area", "Area (m²)"]);
    }

    #[test]
    fn an_older_zone_measurement_table_is_told_what_changed() {
        let (columns, retired) = columns_and_retired("zone-measurement");
        assert_eq!(columns.len(), 11);
        let old: Vec<&str> = retired.iter().map(|r| r.name.as_str()).collect();
        assert_eq!(
            old,
            ["Planned plot", "Actual plot", "Number each plot", "Actual planting plot", "Width", "Length", "Area"]
        );
        // Nothing the template has now is called gone, or an up-to-date table would lose a column.
        for gone in &retired {
            assert!(columns.iter().all(|c| c.name != gone.name), "{}", gone.name);
        }
    }

    #[test]
    fn every_table_starts_with_an_id_the_app_numbers() {
        for sheet in chili_template() {
            let first = &sheet.columns[0];
            assert_eq!((first.name.as_str(), first.col_type.as_str(), first.auto), ("ID", "number", true), "{}", sheet.title);
            assert_eq!(sheet.columns.iter().filter(|column| column.auto).count(), 1, "{}", sheet.title);
        }
    }

    #[test]
    fn harvest_follows_the_farms_design() {
        let sheet = chili_template().into_iter().find(|sheet| sheet.key == "harvest").unwrap();
        let shape: Vec<_> = sheet.columns.iter().map(|c| (c.name.as_str(), c.col_type.as_str(), c.required)).collect();
        assert_eq!(
            shape,
            [
                ("ID", "number", false),
                ("Zone plot", "link", true),
                ("Zone number", "formula", false),
                ("Chili type", "choice", true),
                ("Date harvest", "date", true),
                ("Harvest yield", "number", true),
                ("Ripe yield", "formula", false),
                ("Unripe yield", "formula", false),
            ]
        );
        assert_eq!(sheet.columns[1].source.as_deref(), Some("'Zones'[Plot]"));
        assert_eq!(sheet.columns[3].options, ["ripe", "unripe"]);
        assert_eq!((sheet.columns[5].unit.as_deref(), sheet.columns[5].min), (Some("kg"), Some(0.0)));
    }

    #[test]
    fn links_point_at_template_tables() {
        let sheets = chili_template();
        for sheet in &sheets {
            for column in sheet.columns.iter().filter(|c| c.col_type == "link") {
                let source = column.source.as_deref().unwrap();
                let table = source.trim_start_matches('\'').split("'[").next().unwrap();
                let name = source.split("'[").nth(1).unwrap().trim_end_matches(']');
                let target = sheets.iter().find(|s| s.title == table).expect(table);
                assert!(target.columns.iter().any(|c| c.name == name), "{source}");
            }
        }
    }
}

#[cfg(test)]
mod dump {
    /// `TEMPLATE_OUT=file cargo test dump_template -- --ignored`: the template as JSON, to check its formulas in the app's engine.
    #[test]
    #[ignore]
    fn dump_template() {
        let sheets: Vec<_> = super::chili_template()
            .into_iter()
            .map(|sheet| {
                let mut columns = sheet.columns;
                for (index, column) in columns.iter_mut().enumerate() {
                    column.key = format!("c{}", index + 1);
                }
                serde_json::json!({ "key": sheet.key, "title": sheet.title, "heading": sheet.heading, "icon": sheet.icon, "about": sheet.about, "columns": columns })
            })
            .collect();
        std::fs::write(
            std::env::var("TEMPLATE_OUT").unwrap(),
            serde_json::to_string_pretty(&sheets).unwrap(),
        )
        .unwrap();
    }
}
