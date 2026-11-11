/**
 * The QA/QC Analysis's checks, as the web system has them (Staff_Attention_UI/src/modules/qa/qaQcAnalysisFormulas.ts):
 * each stage's checks against the Agronomic Growth Standard, GREEN / YELLOW / RED with the Value, the Actual Result and
 * the standard's Corrective Action, every one a formula. Kept as the web has them: a formula's {placeholders} are the
 * check's `fields` ({x}: this record's cell; {x*}: the column over every record; {Value}: a column of the check's own in
 * the same row), worked into this app's formulas by analysis-sheet.ts.
 */


/** A records tab column a check reads: by its stage's box ("3 · …"), the
 * QC record's box, or none (the row's own: Zone, Date); its group; its
 * name. */
export type Field = { box: number | "record" | null; group?: string; name: string };

export type CheckColumn = {
  header: string;
  /** With {field} for the plot's cell, {field*} for the column's records,
   * and {Header} for a column of the check's own in the same row. */
  formula: string;
  format?: string;
  width: number;
};

export type Check = {
  stage: number;
  key: string;
  label: string;
  target?: string;
  fields: Record<string, Field>;
  columns: CheckColumn[];
  /** The standard's Corrective Action for GREEN, YELLOW and RED. */
  messages?: readonly [string, string, string];
};

export const SHARED = {
  batch: { box: "record", name: "Plant batch" },
  block: { box: "record", name: "Block" },
  planting: { box: null, name: "Date" },
  zone: { box: null, name: "Zone" },
} as const satisfies Record<string, Field>;

export const STAGES = [
  { dat: "0 DAT", offset: 0, stage: 1 },
  { dat: "7 DAT", offset: 7, stage: 2 },
  { dat: "30 DAT", offset: 30, stage: 3 },
  { dat: "45 DAT", offset: 45, stage: 4 },
  { dat: "60 DAT", offset: 60, stage: 5 },
  { dat: "75 DAT", offset: 75, stage: 6 },
  { dat: "75 DAT+", offset: null, stage: 7 },
  { dat: "75–150 DAT", offset: null, stage: 8 },
  { dat: "75–150 DAT", offset: null, stage: 9 },
  { dat: "End of cycle", offset: null, stage: 10 },
] as const;

export const STATUS_WIDTH = 84;
const RESULT_WIDTH = 220;
export const ACTION_WIDTH = 220;
const PERCENT = "0%";
const TWO_PLACES = "0.00";

const measure = (stage: number, name: string, group = "Plant average") => ({
  box: stage,
  group,
  name,
});

/** Banded on a value: GREEN at or past `green`, YELLOW at or past
 * `yellow`, else RED (`atMost`: at or under). */
function bands(of: string, green: number, yellow: number, atMost = false) {
  const past = atMost ? "<=" : ">=";
  return `=IF(${of}="","",IF(${of}${past}${green},"GREEN",IF(${of}${past}${yellow},"YELLOW","RED")))`;
}

/** The bucket with the most wins: its share is the Value, its colour the
 * Status, its name the Actual Result (ties to the first listed, as the
 * API's IFS order). */
function majority(
  stage: number,
  key: string,
  label: string,
  group: string,
  buckets: readonly [string, "GREEN" | "YELLOW" | "RED", string][],
): Check {
  const [a, b, c] = ["a", "b", "c"].map((name) => `{${name}}`);
  const all = `${a},${b},${c}`;
  const top = `MAX(${all})`;
  return {
    columns: [
      {
        format: PERCENT,
        formula: `=IF(COUNT(${all})<3,"",IF(${top}=0,"",${top}/SUM(${all})))`,
        header: "Value",
        width: 84,
      },
      {
        formula: `=IF({Value}="","",IFS(${a}=${top},"${buckets[0][1]}",${b}=${top},"${buckets[1][1]}",TRUE,"${buckets[2][1]}"))`,
        header: "Status",
        width: STATUS_WIDTH,
      },
      {
        formula: `=IF({Value}="","",IFS(${a}=${top},"${buckets[0][2]} ("&${a}&" plants)",${b}=${top},"${buckets[1][2]} ("&${b}&" plants)",TRUE,"${buckets[2][2]} ("&${c}&" plants)"))`,
        header: "Actual Result",
        width: RESULT_WIDTH,
      },
    ],
    fields: Object.fromEntries(
      buckets.map(([name], index) => [
        ["a", "b", "c"][index],
        { box: stage, group, name },
      ]),
    ),
    key,
    label,
    stage,
  };
}

/** Which bucket wins, and how decisively: its share, banded 90/70. */
function share(
  stage: number,
  key: string,
  label: string,
  target: string,
  group: string,
  buckets: readonly [string, string][],
  messages: readonly [string, string, string],
): Check {
  const all = "{a},{b},{c}";
  const top = `MAX(${all})`;
  return {
    columns: [
      {
        format: PERCENT,
        formula: `=IF(COUNT(${all})<3,"",IF(SUM(${all})<=0,"",${top}/SUM(${all})))`,
        header: "Value",
        width: 84,
      },
      {
        formula: bands("{Value}", 0.9, 0.7),
        header: "Status",
        width: STATUS_WIDTH,
      },
      {
        formula: `=IF({Value}="","",TEXT({Value},"0%")&" "&IFS({a}=${top},"${buckets[0][1]}",{b}=${top},"${buckets[1][1]}",TRUE,"${buckets[2][1]}")&" ("&{a}&"/"&{b}&"/"&{c}&" of "&SUM(${all})&")")`,
        header: "Actual Result",
        width: RESULT_WIDTH,
      },
    ],
    fields: Object.fromEntries(
      buckets.map(([name], index) => [
        ["a", "b", "c"][index],
        { box: stage, group, name },
      ]),
    ),
    key,
    label,
    messages,
    stage,
    target,
  };
}

/** This plot's reading against its batch's average (every row of the
 * batch on the records tab), banded ±10% / 20% on the side that matters. */
function baseline(
  stage: number,
  key: string,
  label: string,
  name: string,
  unit: string,
  atMost = false,
  target = "Establish Cycle-1 Farm Baseline",
  messages?: readonly [string, string, string],
): Check {
  return {
    columns: [
      {
        format: TWO_PLACES,
        formula: `=IF({batch}="","",IFERROR(AVERAGEIFS({m*},{batch*},{batch}),""))`,
        header: "Baseline",
        width: 96,
      },
      {
        format: TWO_PLACES,
        formula: `=IF({m}="","",{m})`,
        header: "Actual",
        width: 96,
      },
      {
        format: "+0%;-0%;0%",
        formula: `=IF(OR({Actual}="",{Baseline}="",{Baseline}=0),"",({Actual}-{Baseline})/{Baseline})`,
        header: "Deviation",
        width: 90,
      },
      {
        formula: atMost
          ? bands("{Deviation}", 0.1, 0.2, true)
          : `=IF({Deviation}="","",IF({Deviation}>=-0.1,"GREEN",IF({Deviation}>=-0.2,"YELLOW","RED")))`,
        header: "Status",
        width: STATUS_WIDTH,
      },
      {
        formula: `=IF({Deviation}="","",TEXT({Actual},"0.00")&" ${unit} "&IF({Actual}>={Baseline},"+","")&TEXT({Actual}-{Baseline},"0.00")&" ${unit}")`,
        header: "Actual Result",
        width: RESULT_WIDTH,
      },
    ],
    fields: { batch: SHARED.batch, m: measure(stage, name) },
    key,
    label,
    messages,
    stage,
    target,
  };
}

/** A reading banded by itself, its Value and Actual Result as given. */
function banded(
  check: Omit<Check, "columns">,
  value: { format: string; formula: string },
  status: string,
  result?: string,
): Check {
  return {
    ...check,
    columns: [
      { ...value, header: "Value", width: 84 },
      { formula: status, header: "Status", width: STATUS_WIDTH },
      { formula: result ?? "", header: "Actual Result", width: RESULT_WIDTH },
    ],
  };
}

const LENGTH_ACTIONS = [
  "Target Met",
  "Adjust N-P-K balance",
  "Investigate Stress/Seed",
] as const;
const DIAMETER_ACTIONS = [
  "Target Met",
  "Check Water & Potash",
  "Severe Size Issue; Check Roots",
] as const;

/** An average inside the industry's size range: GREEN in it, YELLOW within
 * 10% of it, else RED — the table keeps the plants' average, not each
 * plant's size. */
function inRange(
  stage: number,
  key: string,
  label: string,
  name: string,
  min: number,
  max: number,
  messages: readonly [string, string, string],
): Check {
  return banded(
    {
      fields: { m: measure(stage, name) },
      key,
      label,
      messages,
      stage,
      target: `${min}–${max} cm`,
    },
    { format: TWO_PLACES, formula: `=IF({m}="","",{m})` },
    `=IF({Value}="","",IF(AND({Value}>=${min},{Value}<=${max}),"GREEN",IF(AND({Value}>=${min}*0.9,{Value}<=${max}*1.1),"YELLOW","RED")))`,
    `=IF({Value}="","",TEXT({Value},"0.00")&" cm, "&IF(AND({Value}>=${min},{Value}<=${max}),"within","outside")&" ${min}–${max}")`,
  );
}

const yieldOf = (stage: number) => ({
  harvested: measure(stage, "Harvested", "Cumulative Yield"),
  plants: measure(stage, "Total plant", "Cumulative Yield"),
  rounds: measure(stage, "Harvest rounds", "Cumulative Yield"),
});

/** Every check, stage by stage, as the Analysis has them. */
export const CHECKS: Check[] = [
  majority(
    1,
    "seedlingLeaf",
    "Seedling Leaf (%)",
    "Seedling Leaf Stage (No.)",
    [
      ["4–5, good", "GREEN", "4-5 true leaves"],
      ["3, >5", "YELLOW", "3 or >5 leaves"],
      ["Disease", "RED", "Stunted / Damaged"],
    ],
  ),
  majority(
    1,
    "seedlingHealth",
    "Seedling Health / Vigor (%)",
    "Seedling Health / Vigor (No.)",
    [
      ["Wilt", "RED", "Diseased / Root damage"],
      ["Medium", "YELLOW", "Minor stress"],
      ["Healthy", "GREEN", "Healthy / No disease"],
    ],
  ),
  banded(
    {
      fields: {
        dead: measure(2, "Dead plant", "Plant Survival (No.)"),
        live: measure(2, "Live plant", "Plant Survival (No.)"),
      },
      key: "survival",
      label: "Plant Survival",
      stage: 2,
      target: "≥95%",
    },
    {
      format: "0.0%",
      formula: `=IF(COUNT({live},{dead})=0,"",IF(SUM({live},{dead})<20,"",N({live})/SUM({live},{dead})))`,
    },
    bands("{Value}", 0.95, 0.9),
    `=IF({Value}="","",IF({Value}>=0.95,"≥ 95%",IF({Value}>=0.9,"90–94%","< 90% (mortality)")))`,
  ),
  banded(
    {
      fields: {
        uneven: measure(2, "Uneven / Wilt", "New Growth (No.)"),
        upright: measure(2, "Upright plants", "New Growth (No.)"),
      },
      key: "newGrowth",
      label: "New Growth",
      stage: 2,
      target: "Visible growth, upright",
    },
    {
      format: "0.0%",
      formula: `=IF(COUNT({upright},{uneven})<2,"",IF(SUM({upright},{uneven})<20,"",{upright}/SUM({upright},{uneven})))`,
    },
    bands("{Value}", 0.9, 0.7),
    `=IF({Value}="","",IF({Value}>=0.9,"Uniform Growth",IF({Value}>=0.7,"Localized wilt","Widespread wilt"))&" ("&{upright}&" plants)")`,
  ),
  banded(
    {
      fields: { score: measure(3, "Vigor score (1–5)") },
      key: "vigor",
      label: "Plant Vigor Score (Avg.)",
      stage: 3,
      target: "≥4/5 Preferred",
    },
    { format: TWO_PLACES, formula: `=IF({score}="","",{score})` },
    bands("{Value}", 4, 3),
    `=IF({Value}="","",TEXT({Value},"0.00")&"/5 ("&TEXT({Value}/5,"0%")&")")`,
  ),
  baseline(3, "height", "Plant Height", "Plant height", "cm"),
  baseline(3, "canopyA", "Canopy Diameter A", "Canopy A, widest", "cm"),
  baseline(3, "canopyB", "Canopy Diameter B", "Canopy B, across", "cm"),
  baseline(
    3,
    "branching",
    "Branching",
    "Branches",
    "branch",
    false,
    "Strong Branching",
  ),
  banded(
    {
      fields: { flowering: measure(4, "Plant flowering") },
      key: "flowering",
      label: "Plant Flowering",
      stage: 4,
      target: "≥90%",
    },
    // A percent column holds 0.85 for 85%; typed as 85, it's read out of
    // 100.
    {
      format: PERCENT,
      formula: `=IF({flowering}="","",IF({flowering}>1,{flowering}/100,{flowering}))`,
    },
    `=IF(OR({Value}="",{Value}=0),"",IF({Value}>=0.9,"GREEN",IF({Value}>=0.7,"YELLOW","RED")))`,
  ),
  baseline(
    4,
    "flowersPerPlant",
    "Flowers per Plant",
    "Flowers per plant",
    "flowers/plant",
  ),
  baseline(
    5,
    "youngFruit",
    "Young/Developing Fruit",
    "Young fruits per plant",
    "fruits",
    true,
    "Establish Cycle-1 Farm Baseline",
    ["Target Met", "Add Potassium & Calcium", "Spray Retention + Pest Control"],
  ),
  share(
    5,
    "fruitOrientation",
    "Fruit Orientation",
    "Predominantly upright",
    "Fruit Orientation (No.)",
    [
      ["Upright", "upright"],
      ["Mixed", "mixed"],
      ["Different", "difference"],
    ],
    ["True-to-type", "Monitor Tagged Plants", "Rogue Mutated/Virus Plants"],
  ),
  share(
    5,
    "fruitShape",
    "Fruit Shape",
    "True-to-type",
    "Fruit Shape (No.)",
    [
      ["True-to-type", "true-to-type"],
      ["Variability", "variable"],
      ["Off-type", "off-type"],
    ],
    ["True-to-type", "Check Shape Variance", "Rogue off-type Fruits"],
  ),
  banded(
    {
      fields: {
        harvest: { box: 6, name: "Harvest date" },
        planting: SHARED.planting,
      },
      key: "harvestTiming",
      label: "1st Harvest Trimming",
      messages: [
        "On Schedule",
        "Check Delay Causes",
        "Investigate Crop Failure",
      ],
      stage: 6,
      target: "Target 75 DAT",
    },
    {
      format: '0" DAT"',
      formula: `=IF(OR({harvest}="",{planting}=""),"",{harvest}-{planting})`,
    },
    `=IF({Value}="","",IF(ABS({Value}-75)<=2,"GREEN",IF(ABS({Value}-75)<=7,"YELLOW","RED")))`,
    `=IF({Value}="","","Harvested "&{Value}&" days after planting")`,
  ),
  baseline(
    6,
    "fruitLengthBaseline",
    "Fruit Length (vs. Baseline)",
    "Fruit length",
    "cm",
    true,
    "Establish Cycle-1 Farm Baseline",
    LENGTH_ACTIONS,
  ),
  inRange(
    6,
    "fruitLengthStandard",
    "Fruit Length (Standard)",
    "Fruit length",
    6.5,
    7.8,
    LENGTH_ACTIONS,
  ),
  baseline(
    6,
    "fruitDiameterBaseline",
    "Fruit Diameter (vs. Baseline)",
    "Fruit diameter",
    "cm",
    true,
    "Establish Cycle-1 Farm Baseline",
    DIAMETER_ACTIONS,
  ),
  inRange(
    6,
    "fruitDiameterStandard",
    "Fruit Diameter (Standard)",
    "Fruit diameter",
    1.1,
    1.2,
    DIAMETER_ACTIONS,
  ),
  banded(
    {
      fields: {
        green: measure(7, "Green", "Fruit Color (No.)"),
        red: measure(7, "Red", "Fruit Color (No.)"),
        turning: measure(7, "Turning", "Fruit Color (No.)"),
      },
      key: "fruitColor",
      label: "Fruit Color / Maturity",
      messages: [
        "Normal Color",
        "Boost Potassium & Sunlight",
        "Check Viral Disease/Stress",
      ],
      stage: 7,
      target: "Target ≥80% red mature",
    },
    {
      format: PERCENT,
      formula: `=IF(SUM({green},{turning},{red})<=0,"",N({red})/SUM({green},{turning},{red}))`,
    },
    bands("{Value}", 0.8, 0.6),
    `=IF({Value}="","",N({red})&"/"&SUM({green},{turning},{red})&" red mature (maturity index "&TEXT((N({turning})*0.5+N({red}))/SUM({green},{turning},{red}),"0.0%")&")")`,
  ),
  banded(
    {
      fields: {
        color: measure(8, "Color reject", "Rejected (kg)"),
        deformed: measure(8, "Deformed", "Rejected (kg)"),
        disease: measure(8, "Disease", "Rejected (kg)"),
        marketable: measure(8, "Marketable", "Marketable Fruit (kg)"),
        pest: measure(8, "Pest damage", "Rejected (kg)"),
        rot: measure(8, "Rot", "Rejected (kg)"),
        small: measure(8, "Too small", "Rejected (kg)"),
        total: measure(8, "Total", "Marketable Fruit (kg)"),
      },
      key: "marketableFruit",
      label: "Marketable Fruit",
      messages: [
        "Meets Target",
        "Sort Reject Reasons",
        "Severe Quality Failure",
      ],
      stage: 8,
      target: "Target ≥90%",
    },
    {
      format: "0.0%",
      formula: `=IF(OR({total}="",{total}=0),"",N({marketable})/{total})`,
    },
    bands("{Value}", 0.9, 0.8),
    `=IF({Value}="","",TEXT(N({marketable}),"0.00")&"/"&TEXT({total},"0.00")&" kg marketable"&IF(MAX({pest},{disease},{small},{deformed},{rot},{color})>0," (mostly "&IFS({pest}=MAX({pest},{disease},{small},{deformed},{rot},{color}),"pest damage",{disease}=MAX({pest},{disease},{small},{deformed},{rot},{color}),"disease",{small}=MAX({pest},{disease},{small},{deformed},{rot},{color}),"too small",{deformed}=MAX({pest},{disease},{small},{deformed},{rot},{color}),"deformed",{rot}=MAX({pest},{disease},{small},{deformed},{rot},{color}),"rot",TRUE,"color reject")&")",""))`,
  ),
  banded(
    {
      fields: yieldOf(8),
      key: "yieldPerPlant",
      label: "Cumulative Yield",
      messages: [
        "On Yield Curve",
        "10-20% Low: Add Fertigation",
        ">20% Low: Heavy Booster Spray",
      ],
      stage: 8,
      target: "1.5–1.6 kg/plant",
    },
    {
      format: TWO_PLACES,
      formula: `=IF(OR({harvested}="",{plants}="",N({plants})<=0),"",{harvested}/{plants})`,
    },
    bands("{Value}", 1.5, 1.2),
    `=IF({Value}="","",TEXT({harvested},"0.00")&" kg over "&{rounds}&" round"&IF({rounds}=1,"","s")&" ÷ "&{plants}&" plants")`,
  ),
  banded(
    {
      fields: {
        pests: measure(9, "0–70 DAT", "Pest / Disease per block (No.)"),
      },
      key: "plantHealthW1W10",
      label: "Pest/Disease (W1–W10)",
      messages: [
        "Stable; Low Pest",
        "Targeted IPM Spray",
        "Immediate Emergency Spray",
      ],
      stage: 9,
      target: "Below Farm IPM",
    },
    // 10 weeks of 50 plants watched.
    { format: "0.0%", formula: `=IF({pests}="","",{pests}/(10*50))` },
    bands("{Value}", 0.05, 0.15, true),
    `=IF({Value}="","",{pests}&" pest/disease over weeks 1–10 (50 plants a week)")`,
  ),
  banded(
    {
      fields: {
        early: measure(9, "0–70 DAT", "Pest / Disease per block (No.)"),
        whole: measure(9, "0–150 DAT", "Pest / Disease per block (No.)"),
      },
      key: "plantHealthW11W21",
      label: "Pest/Disease (W11–W21)",
      messages: [
        "Stable; Low Pest",
        "Targeted IPM Spray",
        "Immediate Emergency Spray",
      ],
      stage: 9,
      target: "Below Farm IPM",
    },
    // The weeks after the first 10: 11 of them.
    {
      format: "0.0%",
      formula: `=IF({whole}="","",MAX(0,{whole}-N({early}))/(11*50))`,
    },
    bands("{Value}", 0.05, 0.15, true),
    `=IF({Value}="","",MAX(0,{whole}-N({early}))&" pest/disease over weeks 11–21 (50 plants a week)")`,
  ),
  banded(
    {
      fields: {
        ...yieldOf(10),
        perPlant: measure(10, "Yield per plant", "Cumulative Yield"),
      },
      key: "finalYield",
      label: "Final Cumulative Yield",
      messages: [
        "Target Achieved",
        "Acceptable; Review Plan",
        "Major Failure; Root-Cause Audit",
      ],
      stage: 10,
      target: "1.5–1.6 kg/plant",
    },
    {
      format: TWO_PLACES,
      formula: `=IF({perPlant}<>"",{perPlant},IF(OR({harvested}="",{plants}="",N({plants})<=0),"",{harvested}/{plants}))`,
    },
    bands("{Value}", 1.5, 1.275),
    `=IF(OR({harvested}="",{plants}=""),"",TEXT({harvested},"0.00")&" kg over "&{rounds}&" final round"&IF({rounds}=1,"","s")&" ÷ "&{plants}&" plants")`,
  ),
];

/** The standard's Corrective Action for the Status in the same row. */
export function actionFormula(messages: readonly [string, string, string]) {
  return `=IF({Status}="","",IFS({Status}="GREEN","${messages[0]}",{Status}="YELLOW","${messages[1]}",TRUE,"${messages[2]}"))`;
}

