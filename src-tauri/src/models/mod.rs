use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// A table's column. Types: `text`, `number`, `percentage`, `date`,
/// `choice` (one of `options`), `yesno`, `link` (a value of another
/// table's column, `source` = `'Zones'[Plot]`) and `formula` (worked out on
/// every row, `formula` = `=[Live plant] * 2`; never typed or imported).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Column {
    #[serde(default)]
    pub key: String,
    pub name: String,
    #[serde(rename = "type", default = "text_type")]
    pub col_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    #[serde(rename = "box", default, skip_serializing_if = "Option::is_none")]
    pub box_name: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub formula: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default)]
    pub required: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// Other names the column answers to when a file's headers are matched to a table's columns ("Block" for Zone).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub aliases: Vec<String>,
    /// The least a number or percentage may be, and the most (none: no limit).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
    /// A number the app gives each row by itself (an ID): never typed, never changed, never used twice in the table.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub auto: bool,
}

fn text_type() -> String {
    "text".into()
}

impl Column {
    pub fn new(name: &str, col_type: &str) -> Self {
        Column {
            key: String::new(),
            name: name.into(),
            col_type: col_type.into(),
            unit: None,
            group: None,
            box_name: None,
            options: Vec::new(),
            formula: None,
            source: None,
            required: false,
            width: None,
            note: None,
            aliases: Vec::new(),
            min: None,
            max: None,
            auto: false,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mac {
    pub mac_id: i64,
    pub mac_uuid: String,
    pub mac_name: String,
    pub mac_code: String,
    pub mac_location: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub crop: String,
    pub note: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub sheet_count: i64,
    #[serde(default)]
    pub row_count: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MacInput {
    pub mac_name: String,
    pub mac_code: String,
    pub mac_location: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub crop: Option<String>,
    pub note: Option<String>,
    /// On create: start with the crop's template tables.
    #[serde(default)]
    pub use_template: Option<bool>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sheet {
    pub sheet_id: i64,
    pub mac_id: i64,
    pub title: String,
    pub heading: String,
    pub icon: Option<String>,
    pub about: String,
    pub template_key: Option<String>,
    pub columns: Vec<Column>,
    /// Its KPI cards, charts and summaries, as the app keeps them (null: the suggested ones).
    pub dashboard: Option<Value>,
    pub display_order: i64,
    pub row_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    pub row_id: i64,
    pub sheet_id: i64,
    pub position: f64,
    pub data: Map<String, Value>,
    pub import_id: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetWithRows {
    #[serde(flatten)]
    pub sheet: Sheet,
    pub rows: Vec<Row>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Workbook {
    pub mac: Mac,
    pub sheets: Vec<SheetWithRows>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRecord {
    pub import_id: i64,
    pub sheet_id: i64,
    pub file_name: String,
    pub mode: String,
    pub row_count: i64,
    pub rows_left: i64,
    pub imported_at: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellChange {
    pub row_id: i64,
    pub key: String,
    /// Blank or null: the cell emptied.
    pub value: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportInfo {
    pub file_name: String,
    /// `append` (after the rows there) or `replace` (the rows there out).
    pub mode: String,
}
