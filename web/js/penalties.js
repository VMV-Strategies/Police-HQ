// Port of PoliceHQCore PenaltyCalculator. A missing amount is never zero, and a total is
// shown only when every component is known.

export function money(cents) {
  const neg = cents < 0;
  const c = Math.abs(cents);
  const d = Math.floor(c / 100).toLocaleString('en-CA');
  return `${neg ? '-' : ''}$${d}.${String(c % 100).padStart(2, '0')}`;
}

function parseDate(s) { return s ? new Date(s + 'T00:00:00') : null; }

function effective(records, date) {
  return records.filter(r => {
    if (!r.effective_from && !r.effective_to) return true;
    if (!date) return false;
    const from = parseDate(r.effective_from), to = parseDate(r.effective_to);
    if (from && date < from) return false;
    if (to && date >= to) return false;
    return true;
  });
}

const V = {
  amount: (cents, id) => ({ kind: 'amount', cents, id, display: money(cents), known: true }),
  na: note => ({ kind: 'not-applicable', note, display: 'Not applicable', known: true }),
  notInstalled: note => ({ kind: 'not-installed', note, display: 'Not installed', known: false }),
  notVerified: note => ({ kind: 'not-verified', note, display: 'Not verified', known: false }),
  court: note => ({ kind: 'court-determined', note, display: 'Court-determined', known: false }),
};

function value(component, records, anyDated) {
  const r = records.find(x => x.component === component);
  if (!r) return anyDated ? V.notVerified('No version of this component is installed for the offence date.') : V.notInstalled('No record installed.');
  switch (r.status) {
    case 'verified-extraction': return r.amount_cents != null ? V.amount(r.amount_cents, r.component_id) : V.court(r.notes || "Depends on the court's decision.");
    case 'not-installed': return V.notInstalled(r.notes || '');
    case 'not-verified': return V.notVerified(r.notes || '');
    case 'not-applicable': return V.na(r.notes || '');
    default: return V.notVerified(r.notes || '');
  }
}

function perUnit(r, cond, units) {
  const base = { componentId: r.component_id, provisionId: r.provision_id, label: cond.input_label || 'Units' };
  if (units == null || Number.isNaN(units)) return { ...base, cents: null, explanation: `Enter the ${cond.input_label || 'value'} to calculate the statutory fine on conviction.` };
  if (units <= 0) return { ...base, cents: null, explanation: 'No amount: the value entered is not over the limit.' };
  for (const b of cond.brackets || []) {
    if (units >= b.from_inclusive && (b.to_exclusive == null || units < b.to_exclusive)) {
      const cents = units * b.cents_per_unit;
      return { ...base, cents, explanation: `${units} × ${money(b.cents_per_unit)} (${b.label}) = ${money(cents)}. ${cond.presentation || ''}`.trim() };
    }
  }
  return { ...base, cents: null, explanation: `No installed bracket covers ${units}.` };
}

export function breakdown(all, { offenceDate = null, units = null } = {}) {
  const anyDated = all.some(r => r.effective_from || r.effective_to);
  const records = effective(all, offenceDate);
  const setFine = value('set-fine', records, anyDated);
  const vfs = value('victim-fine-surcharge', records, anyDated);
  const costs = value('court-costs', records, anyDated);
  const other = records.some(r => r.component === 'other-charge')
    ? value('other-charge', records, anyDated)
    : V.na('No other prescribed charge is recorded for this offence in installed material.');
  const lines = [['Set fine', setFine], ['Victim fine surcharge', vfs], ['Court costs', costs], ['Other prescribed charges', other]];

  let total;
  if (setFine.kind === 'not-applicable' && vfs.kind === 'court-determined') {
    total = { kind: 'court', display: 'No fixed ticket total — court-determined', note: 'This offence has no set fine in the installed material; penalties are determined by a court within the statutory limits shown.' };
  } else if (setFine.kind === 'not-applicable') {
    total = { kind: 'court', display: 'No fixed ticket total — court-determined', note: 'No set fine applies in the installed material; any penalty is court-determined.' };
  } else if (lines.every(([, v]) => v.known)) {
    total = { kind: 'total', display: money(lines.reduce((a, [, v]) => a + (v.kind === 'amount' ? v.cents : 0), 0)) };
  } else {
    total = { kind: 'cannot-verify', display: 'Total cannot be verified.', missing: lines.filter(([, v]) => !v.known).map(([n]) => n) };
  }

  const pr = records.find(r => r.component === 'demerit-points');
  let points;
  if (!pr) points = anyDated ? { display: 'Not verified', note: 'No points record for the offence date.' } : { display: 'Not installed', note: 'No points record installed.' };
  else if (pr.status === 'verified-extraction') points = pr.points != null ? { display: String(pr.points), id: pr.component_id } : { display: 'Not verified', note: 'Points value missing from record.' };
  else points = { display: { 'not-applicable': 'Not applicable', 'not-installed': 'Not installed' }[pr.status] || 'Not verified', note: pr.notes || '' };

  const notes = ['Issuing a ticket does not itself establish that demerit points have been recorded; points follow a conviction under the applicable regulation.'];
  const ranges = [], calcs = [];
  for (const r of records.filter(x => x.component === 'statutory-range' && x.status === 'verified-extraction')) {
    let cond = {};
    try { cond = JSON.parse(r.conditions_json || '{}'); } catch (_) {}
    if (cond.type === 'per-unit-bracket') calcs.push({ ...perUnit(r, cond, units), excerpt: r.excerpt, notes: r.notes });
    else ranges.push({ componentId: r.component_id, min: r.range_min_cents, max: r.range_max_cents, applies: cond.applies || 'On conviction', also: cond.also, provisionId: r.provision_id, excerpt: r.excerpt, notes: r.notes });
  }
  if (ranges.length || calcs.length) notes.push('Statutory fines and ranges apply on conviction. They are not ticket amounts and are never added to a ticket total.');
  const amps = records.filter(r => r.component === 'administrative-penalty').map(r =>
    r.status === 'verified-extraction' && r.amount_cents != null ? V.amount(r.amount_cents, r.component_id) : value('administrative-penalty', [r], false));
  if (amps.length) notes.push('Administrative penalties are a separate municipal process and are not part of an offence ticket total.');
  const needsUnits = records.some(r => { try { return JSON.parse(r.conditions_json || '{}').type === 'per-unit-bracket'; } catch (_) { return false; } });
  return { lines, total, points, ranges, calcs, amps, notes, needsUnits };
}
