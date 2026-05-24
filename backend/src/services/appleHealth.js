import { XMLParser } from 'fast-xml-parser';

/**
 * Apple Health export: a zip containing export.xml. User uploads either
 * the raw export.xml OR a CSV they created. We accept both.
 *
 * From export.xml we look at <Record type="..."> entries with startDate/endDate.
 * Types we care about:
 *   HKQuantityTypeIdentifierHeartRate           (bpm, instantaneous)
 *   HKQuantityTypeIdentifierActiveEnergyBurned  (kcal, summed)
 * And <Workout> entries with workoutActivityType, duration, totalEnergyBurned.
 *
 * Strategy: for a given session_date (YYYY-MM-DD), find all records that fall
 * inside that local day, and aggregate.
 */

function parseXml(xmlString) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    allowBooleanAttributes: true,
    parseAttributeValue: true,
  });
  const doc = parser.parse(xmlString);
  const root = doc.HealthData || {};
  const records = Array.isArray(root.Record) ? root.Record : (root.Record ? [root.Record] : []);
  const workouts = Array.isArray(root.Workout) ? root.Workout : (root.Workout ? [root.Workout] : []);
  return { records, workouts };
}

function parseCsv(csvString) {
  // Very simple CSV: header row + comma-separated values, no quoted commas
  const lines = csvString.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const cols = line.split(',');
    const row = {};
    header.forEach((h, i) => { row[h] = cols[i]?.trim(); });
    return row;
  });
}

function inSameDay(isoString, dateYmd) {
  if (!isoString) return false;
  // Apple exports look like "2025-05-22 18:42:11 +0530"
  const datePart = isoString.slice(0, 10);
  return datePart === dateYmd;
}

/**
 * @param {string} content - raw file content
 * @param {string} sessionDate - 'YYYY-MM-DD' in user's local TZ
 * @returns {{heart_rate_avg, heart_rate_max, calories, duration_sec}}
 */
export function extractSessionStats(content, sessionDate) {
  const stats = { heart_rate_avg: null, heart_rate_max: null, calories: null, duration_sec: null };

  const looksLikeXml = content.trimStart().startsWith('<');
  if (looksLikeXml) {
    const { records, workouts } = parseXml(content);

    const hrValues = [];
    let calSum = 0;
    let calCount = 0;

    for (const r of records) {
      const type = r.type;
      const start = r.startDate;
      if (!inSameDay(start, sessionDate)) continue;
      const value = parseFloat(r.value);
      if (type === 'HKQuantityTypeIdentifierHeartRate' && !isNaN(value)) {
        hrValues.push(value);
      } else if (type === 'HKQuantityTypeIdentifierActiveEnergyBurned' && !isNaN(value)) {
        calSum += value;
        calCount += 1;
      }
    }

    if (hrValues.length) {
      stats.heart_rate_avg = Math.round(hrValues.reduce((a, b) => a + b, 0) / hrValues.length);
      stats.heart_rate_max = Math.round(Math.max(...hrValues));
    }
    if (calCount) stats.calories = Math.round(calSum);

    // Workouts: take the longest one on this date as the session
    let bestDuration = 0;
    let bestCalories = null;
    for (const w of workouts) {
      const start = w.startDate;
      if (!inSameDay(start, sessionDate)) continue;
      const dur = parseFloat(w.duration);
      const unit = w.durationUnit || 'min';
      const durSec = unit === 'min' ? dur * 60 : (unit === 'hr' ? dur * 3600 : dur);
      if (durSec > bestDuration) {
        bestDuration = durSec;
        const wc = parseFloat(w.totalEnergyBurned);
        bestCalories = isNaN(wc) ? null : Math.round(wc);
      }
    }
    if (bestDuration > 0) stats.duration_sec = Math.round(bestDuration);
    if (bestCalories != null && stats.calories == null) stats.calories = bestCalories;
  } else {
    // CSV path — expect columns like: type,startDate,endDate,value,unit
    const rows = parseCsv(content);
    const hrValues = [];
    let calSum = 0, calCount = 0;
    let maxDuration = 0;
    for (const row of rows) {
      if (!inSameDay(row.startDate, sessionDate)) continue;
      const value = parseFloat(row.value);
      if (row.type?.includes('HeartRate') && !isNaN(value)) {
        hrValues.push(value);
      } else if (row.type?.includes('ActiveEnergyBurned') && !isNaN(value)) {
        calSum += value; calCount += 1;
      } else if (row.type?.toLowerCase().includes('workout')) {
        const dur = parseFloat(row.duration);
        if (!isNaN(dur) && dur > maxDuration) maxDuration = dur;
      }
    }
    if (hrValues.length) {
      stats.heart_rate_avg = Math.round(hrValues.reduce((a, b) => a + b, 0) / hrValues.length);
      stats.heart_rate_max = Math.round(Math.max(...hrValues));
    }
    if (calCount) stats.calories = Math.round(calSum);
    if (maxDuration) stats.duration_sec = Math.round(maxDuration * 60);
  }

  return stats;
}
