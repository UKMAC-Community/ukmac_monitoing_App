/**
 * A number as a sheet's number format writes it: "0", "0.00", "0%", "0.0%", "+0%;-0%;0%" (positive; negative; zero) and
 * text in quotes, '0" DAT"'. The percent formats multiply by 100. Used by TEXT() and by the QA/QC analysis's columns.
 */
export function formatPattern(value: number, pattern: string): string {
  const sections = pattern.split(';');
  let section = sections[0];
  let sign = '';
  let n = value;
  if (value < 0) {
    n = -value;
    if (sections.length > 1) section = sections[1];
    else sign = '-';
  } else if (value === 0 && sections.length > 2) {
    section = sections[2];
  }
  const outsideQuotes = section.replace(/"[^"]*"/g, '');
  if (outsideQuotes.includes('%')) n *= 100;
  let done = false;
  const body = section.replace(/"([^"]*)"|(0+(?:\.0+)?)|(.)/g, (_all, quoted: string | undefined, digits: string | undefined, other: string | undefined) => {
    if (quoted !== undefined) return quoted;
    if (digits !== undefined) {
      if (done) return digits;
      done = true;
      const places = digits.includes('.') ? digits.length - digits.indexOf('.') - 1 : 0;
      return roundedText(n, places);
    }
    return other ?? '';
  });
  // A pattern with no digits to fill shows the number plainly.
  return sign + (done ? body : roundedText(n, 0) + body);
}

/** A number to `places` decimals, halves away from zero as a sheet rounds, shifted through its written exponent (1.005 → 1.01). */
function roundedText(n: number, places: number): string {
  const shift = (x: number, by: number) => {
    const [mantissa, exponent = '0'] = String(x).split('e');
    return Number(`${mantissa}e${Number(exponent) + by}`);
  };
  return shift(Math.round(shift(n, places)), -places).toFixed(places);
}
