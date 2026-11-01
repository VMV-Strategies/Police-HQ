import * as S from './store.js';
import { breakdown, money } from './penalties.js';
import { h, append, snippet, highlighted, stemsFor, badge, banner, section, row, toast, fmtDate, fmtBytes, STATUS_LABEL, REVIEW_LABEL } from './ui.js';
import { APP_VERSION } from './trusted-keys.js';

const view = document.getElementById('view');
const titleEl = document.getElementById('title');
const backBtn = document.getElementById('back');
let state = null;          // install state from the worker
let navDepth = 0;
let renderToken = 0;

// ---------------- routing ----------------

const routes = [
  [/^$/, home, 'home'],
  [/^guides$/, guides, 'guides'],
  [/^authorities$/, authorities, 'guides'],
  [/^authorities\/([\w-]+)$/, authorityCategory, 'guides'],
  [/^rights$/, rights, 'guides'],
  [/^rights\/([\w-]+)$/, rightsStage, 'guides'],
  [/^cautions$/, cautions, 'guides'],
  [/^guide\/(.+)$/, guideDetail, 'guides'],
  [/^penalties\/(.+)$/, penalties, 'guides'],
  [/^gaps$/, gaps, 'settings'],
  [/^statutes$/, statutes, 'home'],
  [/^doc\/([^/]+)$/, reader, 'home'],
  [/^search$/, searchView, 'search'],
  [/^saved$/, saved, 'saved'],
  [/^settings$/, settings, 'settings'],
];

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  return { path: decodeURIComponent(path || ''), params: new URLSearchParams(qs || '') };
}


async function render() {
  const token = ++renderToken;
  const { path, params } = parseHash();
  const match = routes.find(([re]) => re.test(path));
  const [re, fn, tab] = match || routes[0];
  const args = (path.match(re) || []).slice(1).map(decodeURIComponent);
  document.querySelectorAll('#tabs a').forEach(a => a.setAttribute('aria-current', a.dataset.tab === tab ? 'page' : 'false'));
  backBtn.hidden = !(navDepth > 0 && !TAB_ROOTS.has(path));
  const container = h('div', { class: 'page' });
  try {
    const title = await fn(container, ...args, params);
    if (token !== renderToken) return;
    titleEl.textContent = title || 'Police HQ';
    document.title = title ? `${title} · Police HQ` : 'Police HQ';
  } catch (e) {
    if (token !== renderToken) return;
    container.replaceChildren(banner('Something went wrong', [String(e.message || e)], 'error'));
    titleEl.textContent = 'Police HQ';
  }
  view.replaceChildren(container);
  if (!params.get('p') && !params.get('page')) window.scrollTo(0, 0);
  container.dispatchEvent(new Event('mounted'));
}

const TAB_ROOTS = new Set(['', 'guides', 'search', 'saved', 'settings']);
let goingBack = false;
backBtn.addEventListener('click', () => { goingBack = true; history.back(); });
window.addEventListener('hashchange', () => {
  if (goingBack) { navDepth = Math.max(0, navDepth - 1); goingBack = false; } else navDepth++;
  render();
});
document.getElementById('tabs').addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (a && a.getAttribute('href') !== (location.hash || '#/')) navDepth = -1;
});

function needContent(c) {
  if (state && state.current) return false;
  c.append(noContent());
  return true;
}

function noContent() {
  return h('div', { class: 'empty' },
    h('h2', {}, 'No content installed'),
    h('p', {}, 'Police HQ needs a signed content package (a .phqpkg file) before it can show legislation and guides. It is installed once and then works offline.'),
    h('a', { class: 'btn primary', href: '#/settings' }, 'Go to Content status'));
}

// ---------------- home ----------------

async function home(c) {
  c.append(
    h('h1', { class: 'hero' }, 'What are you dealing with?'),
    h('p', { class: 'lede' }, 'Describe the situation, or choose a guide.'));
  if (needContent(c)) return 'Police HQ';
  const ta = h('textarea', { rows: 3, placeholder: 'Describe the situation', 'aria-label': 'Describe the situation', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false' });
  const out = h('div');
  const form = h('form', { class: 'describe', onsubmit: async (e) => { e.preventDefault(); await suggest(ta.value, out); } },
    ta,
    h('div', { class: 'describe-actions' },
      h('button', { class: 'btn primary', type: 'submit' }, 'Find guides'),
      h('button', { class: 'btn', type: 'button', onclick: () => { ta.value = ''; out.replaceChildren(); } }, 'Clear')),
    h('p', { class: 'fine' }, 'Not saved. What you type here stays on this phone and is cleared when you leave this screen.'));
  c.append(form, out);
  const tiles = [
    ['#/statutes', '📚', 'Statutes'], ['#/authorities', '🛡', 'Authorities'],
    ['#/rights', '⚖️', 'Rights'], ['#/cautions', '💬', 'Cautions'],
  ];
  c.append(h('div', { class: 'tiles' }, tiles.map(([href, icon, label]) =>
    h('a', { class: 'tile', href }, h('span', { class: 'tile-icon', 'aria-hidden': 'true' }, icon), h('span', {}, label)))));
  const offences = await S.guideEntries('offence');
  c.append(section('Offence guides', offences.map(e => row(`#/guide/${encodeURIComponent(e.entry_id)}`, e.title, REVIEW_LABEL[e.review_status] || e.review_status))));
  return 'Police HQ';
}

async function suggest(text, out) {
  out.replaceChildren();
  const words = S.tokens(text);
  if (!words.length) return;
  const lower = ' ' + text.toLowerCase() + ' ';
  const all = [];
  for (const kind of ['offence', 'authority', 'right', 'caution', 'checklist']) all.push(...await S.guideEntries(kind));
  const scored = all.map(e => {
    const b = JSON.parse(e.body_json || '{}');
    let score = 0;
    for (const k of b.keywords || []) if (lower.includes(k.toLowerCase())) score += 3;
    const title = e.title.toLowerCase();
    for (const w of words) if (w.length > 3 && title.includes(w)) score += 1;
    return { e, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 8);
  out.append(banner('Matched by keywords only', ['This is not an assessment of the situation, the grounds, or which powers apply. Read each guide and its sources.'], 'info'));
  if (scored.length) {
    out.append(section('Possibly relevant guides', scored.map(({ e }) => row(`#/guide/${encodeURIComponent(e.entry_id)}`, e.title, kindLabel(e.kind)))));
  } else {
    out.append(h('p', { class: 'muted' }, 'No guide matched those words.'));
  }
  out.append(h('a', { class: 'btn', href: `#/search?q=${encodeURIComponent(text.slice(0, 120))}` }, 'Search all sources for these words'));
}

const kindLabel = k => ({ offence: 'Offence guide', authority: 'Authority card', right: 'Right', caution: 'Caution', checklist: 'Checklist' }[k] || k);

// ---------------- guides ----------------

async function guides(c) {
  if (needContent(c)) return 'Guides';
  c.append(section('Hubs',
    row('#/authorities', 'Authorities', 'Arrest, detention, search, seizure, entry, release'),
    row('#/rights', 'Rights', 'By stage of the encounter'),
    row('#/cautions', 'Cautions', 'Approved wording status'),
    row('#/statutes', 'Statutes', 'Browse every installed source')));
  const [off, chk] = await Promise.all([S.guideEntries('offence'), S.guideEntries('checklist')]);
  c.append(section('Offence guides', off.map(e => row(`#/guide/${encodeURIComponent(e.entry_id)}`, e.title, REVIEW_LABEL[e.review_status]))));
  c.append(section('Checklists', chk.map(e => row(`#/guide/${encodeURIComponent(e.entry_id)}`, e.title, REVIEW_LABEL[e.review_status]))));
  c.append(banner('All guides are drafts', ['No qualified legal review has been recorded for any guide in this package. Use them as source references, not operational approval.']));
  c.append(h('p', {}, h('a', { href: '#/gaps' }, 'What is not installed (coverage gaps)')));
  return 'Guides';
}

const basisLabel = b => ({ 'statutory': 'Statutory power', 'common-law': 'Common-law power — source not installed', 'judicial-authorization': 'Judicial authorization', 'consent': 'Consent-based pathway' }[b] || b);

async function authorities(c) {
  if (needContent(c)) return 'Authorities';
  c.append(h('div', { class: 'card' }, S.AUTHORITY_CATEGORIES.map(cat =>
    h('a', { class: 'row big', href: `#/authorities/${cat.id}` }, h('span', { class: 'row-icon', 'aria-hidden': 'true' }, cat.icon), h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, cat.title)), h('span', { class: 'chev' }, '›')))));
  c.append(h('p', { class: 'fine' }, 'Statutory powers, common-law powers, judicial authorizations and consent are labelled separately. Creating an offence does not create a power to arrest, enter, search or seize.'));
  return 'Authorities';
}

async function authorityCategory(c, cat) {
  if (needContent(c)) return 'Authorities';
  const meta = S.AUTHORITY_CATEGORIES.find(x => x.id === cat) || { title: cat };
  const entries = await S.guideEntries('authority', cat);
  if (!entries.length) c.append(h('p', {}, `No ${meta.title.toLowerCase()} authority cards are installed. This does not mean no authority exists.`));
  c.append(h('div', { class: 'card' }, entries.map(e => {
    const b = JSON.parse(e.body_json || '{}');
    return row(`#/guide/${encodeURIComponent(e.entry_id)}`, e.title, `${basisLabel(b.basis_type)} · ${REVIEW_LABEL[e.review_status]}`);
  })));
  return meta.title;
}

async function rights(c) {
  if (needContent(c)) return 'Rights';
  c.append(h('div', { class: 'card' }, S.STAGES.map(s => row(`#/rights/${s.id}`, s.title))));
  c.append(h('p', { class: 'fine' }, 'Rights of suspects, detained and accused persons, including youth safeguards where the installed law provides them. Interpretation depends on case law that is not installed.'));
  return 'Rights';
}

async function rightsStage(c, stage) {
  if (needContent(c)) return 'Rights';
  const meta = S.STAGES.find(s => s.id === stage) || { title: stage };
  const list = (await S.guideEntries('right')).filter(r => (JSON.parse(r.body_json).stages || []).includes(stage));
  if (!list.length) c.append(h('p', {}, 'No rights entries are installed for this stage.'));
  c.append(h('div', { class: 'card' }, list.map(r => {
    const b = JSON.parse(r.body_json);
    return row(`#/guide/${encodeURIComponent(r.entry_id)}`, r.title, REVIEW_LABEL[r.review_status], b.youth ? badge('Youth', 'youth') : null);
  })));
  c.append(h('p', { class: 'fine' }, 'Reassess rights whenever the stage changes (for example detention becomes arrest).'));
  return meta.title;
}

function cautionInstalled(e, b) {
  return b.approved_wording && e.review_status === 'approved' && b.approving_organization;
}

async function cautions(c) {
  if (needContent(c)) return 'Cautions';
  const list = await S.guideEntries('caution');
  c.append(h('div', { class: 'card' }, list.map(e => {
    const b = JSON.parse(e.body_json);
    return row(`#/guide/${encodeURIComponent(e.entry_id)}`, e.title, null, cautionInstalled(e, b) ? badge('Approved wording installed', 'ok') : badge('Approved wording not installed.', 'missing'));
  })));
  c.append(h('p', { class: 'fine' }, 'Available without a situation and without any assistant. The app never generates or paraphrases official wording.'));
  return 'Cautions';
}

// ---------------- guide detail ----------------

async function guideDetail(c, id) {
  if (needContent(c)) return 'Guide';
  const e = await S.guideEntry(id);
  if (!e) { c.append(h('p', {}, 'This guide is not installed.')); return 'Guide not installed'; }
  const b = e.body;
  const levelId = await S.getSetting('explanationLevel', 'plain-language');
  const body = h('div');
  const levelSel = h('select', { 'aria-label': 'Explanation level', onchange: () => draw(levelSel.value) },
    S.EXPLANATION_LEVELS.map(l => h('option', { value: l.id, selected: l.id === levelId }, l.title)));
  c.append(h('h1', { class: 'detail-title' }, e.title),
    h('div', { class: 'meta-row' }, badge(REVIEW_LABEL[e.review_status] || e.review_status, e.review_status === 'approved' ? 'ok' : 'draft'), h('span', { class: 'muted' }, `v${e.version}`)),
    h('label', { class: 'level' }, 'Explanation ', levelSel), body);
  const titles = await S.guideTitles([...(b.linked_rights || []), ...(b.linked_cautions || []), ...(b.linked_checklists || []), ...(b.linked_authorities || []), ...(b.related_authorities || [])]);
  const allGaps = await S.coverageGaps();

  const cite = (i) => e.citations[i];
  const citeLink = (cit, text) => cit ? h('a', { href: provHref(cit.source_id, cit.provision_id) }, text || `${cit.source_title}, ${cit.pinpoint}`) : null;
  const quote = (label, text, citIdx) => h('blockquote', { class: 'quote' },
    label ? h('div', { class: 'quote-label' }, label) : null,
    h('div', { class: 'quote-text' }, `“${text}”`),
    citIdx != null && cite(citIdx) ? h('div', { class: 'quote-src' }, citeLink(cite(citIdx))) : null);
  const list = (title, items) => items && items.length ? section(title, h('ul', { class: 'plain' }, items.map(x => h('li', {}, x)))) : null;
  const labeled = (t, v) => v ? h('div', { class: 'labeled' }, h('div', { class: 'lab' }, t), h('div', {}, v)) : null;
  const links = (title, ids) => ids && ids.length ? section(title, ids.map(i => row(`#/guide/${encodeURIComponent(i)}`, titles[i] || i))) : null;

  function draw(level) {
    S.setSetting('explanationLevel', level);
    const L = S.EXPLANATION_LEVELS.find(l => l.id === level);
    const summary = L.key && b.summaries ? b.summaries[L.key] : null;
    const showFull = level === 'legal-analysis' || level === 'detailed' || !summary;
    const parts = [];
    if (e.kind === 'caution') {
      if (cautionInstalled(e, b)) {
        parts.push(section(`Approved wording — ${b.approving_organization}, version ${e.version}`, h('div', { class: 'caution-text' }, b.approved_wording)));
      } else {
        parts.push(h('div', { class: 'not-installed' }, h('div', { class: 'ni-title' }, 'Approved wording not installed.'), h('div', {}, `Missing: ${b.missing_material || 'Approved wording and its approval record.'}`)));
      }
      parts.push(section('Purpose and circumstances', h('p', {}, b.purpose || ''), b.applicable_circumstances ? h('p', { class: 'fine' }, `Applies: ${b.applicable_circumstances}`) : null, b.statutory_content_note ? h('p', { class: 'fine' }, b.statutory_content_note) : null));
      parts.push(list('Accompanying steps', b.accompanying_steps));
      parts.push(list('Documentation', b.documentation));
      parts.push(h('p', { class: 'fine' }, 'Recording that wording was read does not establish understanding, a valid waiver or compliance.'));
    }
    if (summary) {
      parts.push(h('div', { class: 'summary' }, h('p', {}, summary), h('p', { class: 'fine' }, e.review_status === 'approved' ? `Reviewed explanation (${L.title.toLowerCase()}).` : `Draft explanation (${L.title.toLowerCase()}) — not reviewed. The quoted legal wording below governs.`)));
    } else if (level !== 'legal-analysis' && e.kind !== 'caution') {
      parts.push(h('p', { class: 'fine' }, 'No reviewed simplification is installed for this guide. The supported wording is shown instead.'));
    } else if (level === 'legal-analysis') {
      parts.push(h('p', { class: 'fine' }, 'Legal analysis: full installed text of each cited provision.'));
    }
    if (b.quotes && b.quotes.length) parts.push(section('Exact wording', b.quotes.map(q => quote(q.label, q.text, q.citation))));
    if (e.kind === 'authority') {
      parts.push(section('What the authority permits',
        labeled('Basis', basisLabel(b.basis_type)), labeled('Proposed action', b.action), labeled('Permits', b.permits), labeled('Who may exercise it', b.who),
        labeled('Territorial scope', b.territorial_scope), labeled('Judicial authorization', b.judicial_authorization), labeled('Pathway', b.pathway)));
      if (b.not_authority_for && b.not_authority_for.length) parts.push(section('Not authority for', h('ul', { class: 'plain no' }, b.not_authority_for.map(x => h('li', {}, x)))));
      parts.push(links('Linked rights', b.linked_rights), links('Linked cautions', b.linked_cautions), links('Linked checklists', b.linked_checklists));
      parts.push(list('Documentation', b.documentation), list('Follow-up obligations', b.follow_up));
      if (b.deadline_rule) parts.push(section('Timing', h('p', { class: 'strong' }, b.deadline_rule.statutory_text), h('p', { class: 'fine' }, 'No deadline is calculated: the rule has not been reviewed and exceptions are not modelled.')));
    } else if (e.kind === 'right') {
      parts.push(section('Who and when', labeled('Protects', b.protects), labeled('Triggered by', b.triggers), labeled('Timing', b.timing)));
      parts.push(list('Officer obligations', b.officer_obligations), list('Comprehension, language and communication', b.communication), list('Documentation', b.documentation));
      parts.push(links('Linked authorities', b.linked_authorities), links('Linked cautions', b.linked_cautions));
    } else if (e.kind === 'offence') {
      parts.push(section('Offence', labeled('Jurisdiction', b.jurisdiction_label), labeled('Procedure', b.procedure),
        b.modes && b.modes.length ? labeled('Ways of committing', h('ul', { class: 'plain' }, b.modes.map(m => h('li', {}, m.label)))) : null));
      parts.push(section('Elements and facts in issue', (b.elements || []).map(el => h('div', { class: 'element' },
        h('div', { class: 'strong' }, el.text),
        el.quote ? quote(null, el.quote, el.citation) : null,
        el.general ? h('div', { class: 'fine' }, el.basis || '') : null))));
      if (b.defences && b.defences.length) parts.push(section('Exceptions and defences', b.defences.map(d => h('div', { class: 'element' }, h('div', {}, d.text), d.quote ? quote(null, d.quote, d.citation) : null))));
      parts.push(list('Consider (possible exculpatory information)', b.exculpatory_prompts), list('Questions to establish the facts', b.lawful_questions));
      parts.push(section(null, row(`#/penalties/${encodeURIComponent(e.entry_id)}`, 'Penalties and points', 'Set fine, surcharge, costs, points, statutory ranges')));
      parts.push(links('Related authorities', b.related_authorities));
      if (b.municipal_references && b.municipal_references.length) parts.push(section('Municipal references (unvalidated)', b.municipal_references.map(id => row(`#/doc/${encodeURIComponent(id)}`, id))));
    } else if (e.kind === 'checklist') {
      parts.push(section('Items', (b.items || []).map(it => h('div', { class: 'element' },
        h('div', { class: 'strong' }, it.requirement),
        h('div', { class: 'fine' }, `Trigger: ${it.trigger} · Applies: ${it.applicability}`),
        it.quote ? quote(null, it.quote, it.citation) : null))));
      parts.push(h('p', { class: 'fine' }, 'This is a reference list. Nothing is marked complete here.'));
    }
    if (b.conditions && b.conditions.length) parts.push(list('Required conditions', b.conditions));
    const limits = [...(b.limits || []), ...(b.limitations || [])];
    if (limits.length) parts.push(list('Limits and exceptions', limits));
    if (e.citations.length) parts.push(section('Sources', e.citations.map(ci => h('div', { class: 'citation' },
      h('div', {}, citeLink(ci), ' ', h('span', { class: 'muted' }, `(${ci.role})`)),
      h('div', { class: 'fine' }, ci.jurisdiction_label),
      showFull ? h('pre', { class: 'excerpt' }, ci.excerpt) : h('details', {}, h('summary', {}, 'Show installed text'), h('pre', { class: 'excerpt' }, ci.excerpt))))));
    const g = allGaps.filter(x => (b.gaps || []).includes(x.gap_id));
    if (g.length) parts.push(banner('Coverage limitations', g.map(x => `${x.title}: ${x.description}`)));
    body.replaceChildren(...parts.filter(Boolean));
  }
  draw(levelId);
  return kindLabel(e.kind);
}

const provHref = (sourceId, provisionId) => `#/doc/${encodeURIComponent(sourceId)}${provisionId ? `?p=${encodeURIComponent(provisionId)}` : ''}`;

// ---------------- penalties ----------------

async function penalties(c, id) {
  if (needContent(c)) return 'Penalties';
  const e = await S.guideEntry(id);
  const comps = await S.penaltyComponents(id);
  c.append(h('h1', { class: 'detail-title' }, e ? e.title : id));
  if (!comps.length) { c.append(h('p', {}, 'No penalty records are installed for this offence. Nothing is assumed.')); return 'Penalties and points'; }
  const date = h('input', { type: 'date', value: new Date().toISOString().slice(0, 10), 'aria-label': 'Offence date' });
  const units = h('input', { type: 'number', inputmode: 'numeric', min: '0', placeholder: 'e.g. 25', 'aria-label': 'Units' });
  const out = h('div');
  const first = breakdown(comps, {});
  const inputs = h('div', { class: 'card form' },
    h('label', {}, 'Offence date', date),
    first.needsUnits ? h('label', {}, 'km/h over the speed limit', units) : null);
  c.append(inputs, out);
  const draw = () => {
    const d = date.value ? new Date(date.value + 'T00:00:00') : null;
    const u = units.value === '' ? null : parseInt(units.value, 10);
    const r = breakdown(comps, { offenceDate: d, units: u });
    const src = (pid) => pid ? h('a', { class: 'fine', href: provHref(pid.split(':')[0], pid) }, `Source: ${pid.split(':').slice(1).join(':')}`) : null;
    const line = (name, v) => h('div', { class: 'pline' }, h('div', { class: 'pname' }, name), h('div', { class: `pval v-${v.kind}` }, v.display), v.note ? h('div', { class: 'fine pnote' }, v.note) : null);
    const parts = [
      section('Ticket components', r.lines.map(([n, v]) => line(n, v)),
        h('div', { class: `pline total ${r.total.kind}` }, h('div', { class: 'pname' }, 'Total'), h('div', { class: 'pval' }, r.total.display),
          r.total.missing ? h('div', { class: 'fine pnote' }, `Missing: ${r.total.missing.join(', ')}`) : null,
          r.total.note ? h('div', { class: 'fine pnote' }, r.total.note) : null)),
      section('Demerit points', h('div', { class: 'pline' }, h('div', { class: 'pname' }, 'Points'), h('div', { class: 'pval' }, r.points.display), r.points.note ? h('div', { class: 'fine pnote' }, r.points.note) : null)),
    ];
    if (r.calcs.length) parts.push(section('Statutory fine on conviction (calculated from installed text)', r.calcs.map(x => h('div', { class: 'element' },
      h('div', { class: 'pval big' }, x.cents != null ? money(x.cents) : '—'), h('p', {}, x.explanation), x.notes ? h('p', { class: 'fine' }, x.notes) : null, src(x.provisionId)))));
    if (r.ranges.length) parts.push(section('Statutory ranges on conviction', r.ranges.map(x => h('div', { class: 'element' },
      h('div', { class: 'strong' }, x.min != null && x.max != null ? `${money(x.min)} to ${money(x.max)}` : x.max != null ? `Up to ${money(x.max)}` : x.min != null ? `At least ${money(x.min)}` : 'See source'),
      h('div', {}, x.applies), x.also ? h('div', { class: 'fine' }, x.also) : null, x.notes ? h('div', { class: 'fine' }, x.notes) : null, src(x.provisionId)))));
    if (r.amps.length) parts.push(section('Administrative penalties (separate process)', r.amps.map(v => line('Administrative penalty', v))));
    parts.push(h('ul', { class: 'plain fine' }, r.notes.map(n => h('li', {}, n))));
    out.replaceChildren(...parts);
  };
  date.addEventListener('input', draw);
  units.addEventListener('input', draw);
  draw();
  return 'Penalties and points';
}

async function gaps(c) {
  if (needContent(c)) return 'Coverage gaps';
  const list = await S.coverageGaps();
  c.append(h('p', {}, 'Material that is not installed. Where a guide depends on it, the guide says so and gives no test or wording in its place.'));
  for (const g of list) c.append(section(g.title, h('p', {}, g.description), g.acquisition ? h('p', { class: 'fine' }, `To fill this gap: ${g.acquisition}`) : null, h('div', { class: 'fine' }, `Category: ${g.category}`)));
  return 'Coverage gaps';
}

// ---------------- statutes ----------------

async function statutes(c, params) {
  if (needContent(c)) return 'Statutes';
  let level = params.get('level') || '';
  let muni = params.get('m') || '';
  const find = h('input', { type: 'search', placeholder: 'Find by title, abbreviation, citation or by-law number', 'aria-label': 'Find a source', value: params.get('f') || '' });
  const levelChips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Level' });
  const muniChips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Municipality' });
  const list = h('div', { class: 'card' });
  const count = h('p', { class: 'fine' });
  const chip = (label, active, onclick) => h('button', { class: `chip${active ? ' on' : ''}`, type: 'button', 'aria-pressed': String(active), onclick }, label);
  async function draw() {
    levelChips.replaceChildren(chip('All', !level, () => { level = ''; muni = ''; draw(); }), ...S.LEVELS.map(l => chip(l.title, level === l.id, () => { level = l.id; if (l.id !== 'municipal') muni = ''; draw(); })));
    muniChips.hidden = level !== 'municipal';
    muniChips.replaceChildren(chip('All municipalities', !muni, () => { muni = ''; draw(); }), ...S.MUNICIPALITIES.map(m => chip(m.title, muni === m.id, () => { muni = m.id; draw(); })));
    const rows = await S.sources({ level: level || null, municipality: muni || null, text: find.value });
    count.textContent = `${rows.length} source${rows.length === 1 ? '' : 's'}`;
    list.replaceChildren(...rows.map(s => row(`#/doc/${encodeURIComponent(s.source_id)}`, s.title, `${s.jurisdiction_label}${s.citation ? ' · ' + s.citation : ''}`)));
    history.replaceState(null, '', `#/statutes?level=${level}&m=${muni}&f=${encodeURIComponent(find.value)}`);
  }
  let t;
  find.addEventListener('input', () => { clearTimeout(t); t = setTimeout(draw, 200); });
  c.append(find, levelChips, muniChips, count, list);
  await draw();
  return 'Statutes';
}

// ---------------- reader ----------------

async function reader(c, sourceId, params) {
  if (needContent(c)) return 'Document';
  const src = await S.source(sourceId);
  if (!src) { c.append(h('p', {}, 'This source is not installed.')); return 'Not installed'; }
  const bms = await S.bookmarks();
  const bmSet = new Set(bms.map(b => b.provisionId));
  const heuristic = ['heuristic-structure', 'image-only'].includes(src.extraction_quality);

  // Header
  c.append(h('div', { class: 'doc-head' },
    h('h1', { class: 'detail-title' }, src.title),
    h('div', { class: 'meta-row' }, badge(src.jurisdiction_label, `lvl-${src.level}`), src.citation ? h('span', { class: 'muted' }, src.citation) : null),
    h('div', { class: 'fine' }, S.currencyLine(src)),
    h('div', { class: 'notice' }, S.reproductionNotice(src.level)),
    heuristic ? banner('Structure detected automatically', ['Sections in this document were recognised heuristically. Cite by page and check the original.'], 'info') : null,
    h('details', { class: 'about' }, h('summary', {}, 'About this document'),
      h('dl', {}, [
        ['Type', src.doc_type], ['Issued by', src.issuing_authority], ['Applies in', src.territorial_application],
        ['Consolidation', S.cleanMeta(src.consolidation)], ['Last amended', S.cleanMeta(src.last_amended)],
        ['Publisher', src.publisher_status], ['Verification', src.verification_status], ['Extraction', `${src.extraction_quality} — ${src.extraction_method}`],
        ['Quality notes', src.quality_notes], ['Original file', src.original_filename], ['Official URL', src.official_url || `Not recorded (${src.official_url_status})`],
      ].filter(([, v]) => v).map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])))));

  // Toolbar
  const findInput = h('input', { type: 'search', placeholder: 'Search this document', 'aria-label': 'Search this document', enterkeyhint: 'search' });
  const findCount = h('span', { class: 'find-count', 'aria-live': 'polite' });
  const prevBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Previous match', disabled: true }, '▲');
  const nextBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Next match', disabled: true }, '▼');
  const tocBtn = h('button', { class: 'btn small', type: 'button' }, 'Contents');
  const origBtn = h('button', { class: 'btn small', type: 'button' }, 'Original');
  const modeBtn = h('button', { class: 'btn small', type: 'button' }, 'Page text');
  c.append(h('div', { class: 'doc-tools' },
    h('form', { class: 'find', onsubmit: (ev) => { ev.preventDefault(); runFind(); findInput.blur(); } }, findInput, findCount, prevBtn, nextBtn),
    h('div', { class: 'tool-row' }, tocBtn, modeBtn, origBtn)));

  const textEl = h('div', { class: 'doc-text' });
  const topMore = h('button', { class: 'btn ghost', type: 'button', hidden: true }, 'Show earlier text');
  const sentinel = h('div', { class: 'sentinel' });
  c.append(topMore, textEl, sentinel);

  let mode = 'structured';
  let minOrd = null, maxOrd = null, exhausted = false, loading = false;
  let matches = [], mi = -1, stems = [];

  const provEl = (p) => {
    const st = p.status !== 'in-force' ? badge(STATUS_LABEL[p.status] || p.status, `st-${p.status}`) : null;
    const isHead = ['heading', 'part', 'schedule'].includes(p.kind) && !p.number;
    const el = h('div', { class: `prov k-${p.kind}${isHead ? ' head' : ''}`, id: `p-${p.ordinal}`, dataset: { ord: p.ordinal, pid: p.provision_id }, style: `--d:${Math.min(p.depth, 6)}` });
    if (isHead) {
      append(el, [h('div', { class: 'prov-heading' }, highlighted(p.text || p.label, stems)), st]);
      return el;
    }
    const star = h('button', { class: `star${bmSet.has(p.provision_id) ? ' on' : ''}`, type: 'button', 'aria-label': bmSet.has(p.provision_id) ? 'Remove bookmark' : 'Bookmark',
      onclick: async () => {
        const on = await S.toggleBookmark({ provisionId: p.provision_id, sourceId, sourceTitle: src.title, label: p.label, heading: p.heading || '', jurisdiction: src.jurisdiction_label });
        on ? bmSet.add(p.provision_id) : bmSet.delete(p.provision_id);
        star.classList.toggle('on', on);
        star.setAttribute('aria-label', on ? 'Remove bookmark' : 'Bookmark');
        toast(on ? 'Bookmarked' : 'Bookmark removed');
      } }, '★');
    append(el, [
      h('div', { class: 'prov-top' }, h('span', { class: 'prov-label' }, p.kind === 'section' || p.depth === 0 ? p.label : (p.number || p.label)), p.heading && p.kind !== 'definition' ? h('span', { class: 'prov-note' }, p.heading) : null, st, star),
      h('div', { class: 'prov-body' }, highlighted(p.text || '', stems)),
      p.history ? h('div', { class: 'prov-hist' }, p.history) : null]);
    return el;
  };

  async function loadFrom(ord) {
    loading = true;
    const before = await S.provisionsBefore(sourceId, ord, 15);
    const after = await S.provisionsFrom(sourceId, ord, 120);
    const all = before.concat(after);
    textEl.replaceChildren(...all.map(provEl));
    minOrd = all.length ? all[0].ordinal : null;
    maxOrd = all.length ? all[all.length - 1].ordinal : null;
    exhausted = after.length < 120;
    topMore.hidden = !before.length || before.length < 15;
    loading = false;
    if (!all.length) textEl.replaceChildren(h('p', { class: 'muted' }, 'No structured text was extracted from this document. Use Page text or the original.'));
  }
  async function loadMore() {
    if (loading || exhausted || maxOrd == null || mode !== 'structured') return;
    loading = true;
    const more = await S.provisionsFrom(sourceId, maxOrd + 1, 150);
    textEl.append(...more.map(provEl));
    if (more.length) maxOrd = more[more.length - 1].ordinal;
    exhausted = more.length < 150;
    loading = false;
  }
  topMore.addEventListener('click', async () => {
    const prev = await S.provisionsBefore(sourceId, minOrd, 150);
    if (!prev.length) { topMore.hidden = true; return; }
    const anchor = textEl.firstChild;
    const y = anchor ? anchor.getBoundingClientRect().top : 0;
    textEl.prepend(...prev.map(provEl));
    minOrd = prev[0].ordinal;
    if (anchor) window.scrollBy(0, anchor.getBoundingClientRect().top - y);
    topMore.hidden = prev.length < 150;
  });
  new IntersectionObserver((ents) => { if (ents.some(x => x.isIntersecting)) loadMore(); }, { rootMargin: '1200px' }).observe(sentinel);

  async function showPages(focusPage) {
    mode = 'pages';
    modeBtn.textContent = 'Structured text';
    topMore.hidden = true;
    const pgs = await S.pages(sourceId);
    textEl.replaceChildren(...pgs.map(pg => h('div', { class: 'page-block', id: `pg-${pg.page}` },
      h('div', { class: 'page-no' }, `Page ${pg.page}`, pg.ocr ? badge('OCR — unverified', 'st-unknown') : null, pg.image_only ? badge('Image only', 'st-unknown') : null),
      h('div', { class: 'page-text' }, highlighted(pg.text || '', stems)))));
    if (focusPage) scrollToEl(document.getElementById(`pg-${focusPage}`));
  }
  async function showStructured(ord) {
    mode = 'structured';
    modeBtn.textContent = 'Page text';
    await loadFrom(ord ?? 0);
  }
  modeBtn.addEventListener('click', () => mode === 'structured' ? showPages() : showStructured(0));

  function scrollToEl(el) {
    if (!el) return;
    const y = el.getBoundingClientRect().top + window.scrollY - (document.querySelector('.topbar').offsetHeight + 12);
    window.scrollTo({ top: y });
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  }
  async function jumpTo(ord) {
    if (mode !== 'structured' || minOrd == null || ord < minOrd || ord > maxOrd) await showStructured(ord);
    scrollToEl(document.getElementById(`p-${ord}`));
  }

  async function runFind() {
    const text = findInput.value.trim();
    stems = stemsFor(S.tokens(text));
    matches = text ? await S.search({ text, mode: 'keywords', scope: { sourceId }, includeNonOperative: true, limit: 500 }) : [];
    matches.sort((a, b) => a.ordinal - b.ordinal);
    mi = -1;
    prevBtn.disabled = nextBtn.disabled = !matches.length;
    findCount.textContent = text ? (matches.length ? `${matches.length}${matches.length >= 500 ? '+' : ''} matches` : 'No matches') : '';
    // re-render visible text with highlights
    if (mode === 'pages') await showPages(); else if (minOrd != null) await loadFrom(minOrd);
    if (matches.length) step(1);
  }
  async function step(d) {
    if (!matches.length) return;
    mi = (mi + d + matches.length) % matches.length;
    const m = matches[mi];
    findCount.textContent = `${mi + 1} of ${matches.length}`;
    if (m.page != null) { await showPages(m.page); }
    else await jumpTo(m.ordinal);
  }
  prevBtn.addEventListener('click', () => step(-1));
  nextBtn.addEventListener('click', () => step(1));

  // Contents sheet
  tocBtn.addEventListener('click', () => {
    const filter = h('input', { type: 'search', placeholder: 'Go to section number or heading', 'aria-label': 'Filter contents' });
    const listEl = h('div', { class: 'toc' });
    const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Contents' },
      h('div', { class: 'sheet-head' }, h('strong', {}, 'Contents'), h('button', { class: 'btn small', type: 'button', onclick: () => sheet.remove() }, 'Done')),
      filter, listEl);
    const draw = async () => {
      const rows = await S.contents(sourceId, filter.value);
      listEl.replaceChildren(...rows.map(r => h('button', { type: 'button', class: `toc-row k-${r.kind}`, onclick: async () => { sheet.remove(); await jumpTo(r.ordinal); } },
        r.kind === 'section' || r.kind === 'schedule' ? `${r.label}${r.heading ? ' — ' + r.heading : ''}` : (r.text || r.label))));
      if (!rows.length) listEl.append(h('p', { class: 'muted' }, 'Nothing found.'));
    };
    let t;
    filter.addEventListener('input', () => { clearTimeout(t); t = setTimeout(draw, 150); });
    document.body.append(sheet);
    draw();
    filter.focus();
  });

  origBtn.addEventListener('click', () => openOriginal(src));

  // Initial position
  const pid = params.get('p');
  const page = params.get('page');
  c.addEventListener('mounted', async () => {
    if (page) { await showPages(parseInt(page, 10)); return; }
    if (pid) {
      const p = await S.provision(pid);
      await showStructured(p ? p.ordinal : 0);
      if (p) scrollToEl(document.getElementById(`p-${p.ordinal}`));
      else toast('That provision is not in the installed version.');
    } else {
      await showStructured(0);
    }
  }, { once: true });
  return src.title.length > 28 ? 'Document' : src.title;
}

async function openOriginal(src) {
  if (!src.original_path) { toast('No original file is installed for this source.'); return; }
  const blob = await S.original(state.current.slot, src.original_path);
  if (!blob) { toast('The original file is missing from the installed package.'); return; }
  const name = src.original_path.split('/').pop();
  const file = new File([blob], name, { type: blob.type });
  const url = URL.createObjectURL(blob);
  const isPdf = /pdf$/i.test(name);
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Original document' },
    h('div', { class: 'sheet-head' }, h('strong', {}, 'Original document'), h('button', { class: 'btn small', type: 'button', onclick: () => { sheet.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); } }, 'Done')),
    h('p', {}, name), h('p', { class: 'fine' }, `${fmtBytes(blob.size)} · as supplied, unchanged. ${S.reproductionNotice(src.level)}`),
    isPdf ? h('a', { class: 'btn primary block', href: url, target: '_blank', rel: 'noopener' }, 'Open PDF') : h('p', { class: 'fine' }, 'Word (.doc) files cannot be displayed in the browser. Use Share or save to open it in another app, such as Files or Pages.'),
    navigator.canShare && navigator.canShare({ files: [file] })
      ? h('button', { class: 'btn block', type: 'button', onclick: () => navigator.share({ files: [file], title: src.title }).catch(() => {}) }, 'Share or save')
      : h('a', { class: 'btn block', href: url, download: name }, 'Save a copy'));
  document.body.append(sheet);
}

// ---------------- search ----------------

async function searchView(c, params) {
  if (needContent(c)) return 'Search';
  let mode = params.get('m') || 'keywords';
  let levels = (params.get('l') || '').split(',').filter(Boolean);
  let munis = (params.get('mu') || '').split(',').filter(Boolean);
  let nonOp = params.get('n') === '1';
  const input = h('input', { type: 'search', placeholder: 'Search all sources', 'aria-label': 'Search all sources', value: params.get('q') || '', enterkeyhint: 'search' });
  const modes = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Search mode' });
  const lv = h('div', { class: 'chips', role: 'group', 'aria-label': 'Levels' });
  const mu = h('div', { class: 'chips', role: 'group', 'aria-label': 'Municipalities' });
  const nonOpBox = h('input', { type: 'checkbox', checked: nonOp });
  const results = h('div');
  const toggle = (arr, v) => arr.includes(v) ? arr.filter(x => x !== v) : arr.concat(v);
  const chip = (label, on, onclick) => h('button', { class: `chip${on ? ' on' : ''}`, type: 'button', 'aria-pressed': String(on), onclick }, label);
  function drawFilters() {
    modes.replaceChildren(...[['keywords', 'Keywords'], ['phrase', 'Exact phrase'], ['section', 'Section number']].map(([id, label]) =>
      h('button', { type: 'button', role: 'radio', 'aria-checked': String(mode === id), class: mode === id ? 'on' : '', onclick: () => { mode = id; drawFilters(); run(); } }, label)));
    lv.replaceChildren(...S.LEVELS.map(l => chip(l.title, levels.includes(l.id), () => { levels = toggle(levels, l.id); drawFilters(); run(); })));
    mu.hidden = !(levels.length === 0 || levels.includes('municipal'));
    mu.replaceChildren(...S.MUNICIPALITIES.map(m => chip(m.title, munis.includes(m.id), () => { munis = toggle(munis, m.id); drawFilters(); run(); })));
  }
  async function run() {
    const text = input.value.trim();
    history.replaceState(null, '', `#/search?q=${encodeURIComponent(text)}&m=${mode}&l=${levels.join(',')}&mu=${munis.join(',')}&n=${nonOp ? 1 : 0}`);
    if (!text) { results.replaceChildren(h('p', { class: 'muted' }, 'Searches every installed source on this phone. Not-yet-in-force text and editorial notes are excluded unless you include them.')); return; }
    const hits = await S.search({ text, mode, scope: { levels, municipalities: munis }, includeNonOperative: nonOp, limit: 80 });
    const saveBtn = h('button', { class: 'btn small', type: 'button', onclick: async () => { await S.saveSearch({ text, mode, levels, munis, nonOp }); toast('Search saved'); } }, 'Save search');
    results.replaceChildren(
      h('div', { class: 'results-head' }, h('span', { class: 'fine' }, hits.length ? `${hits.length} result${hits.length === 1 ? '' : 's'}${hits.length >= 80 ? ' (first 80)' : ''}` : 'No results'), saveBtn),
      h('div', { class: 'card' }, hits.map(r => h('a', { class: 'row hit', href: r.page != null ? `#/doc/${encodeURIComponent(r.source_id)}?page=${r.page}` : provHref(r.source_id, r.provision_id) },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title' }, `${r.label}${r.heading ? ' — ' + r.heading : ''}`),
          h('div', { class: 'row-sub' }, r.source_title, ' · ', h('span', { class: 'jl' }, r.jurisdiction_label), r.status !== 'in-force' && r.status !== 'unknown' ? [' · ', badge(STATUS_LABEL[r.status], `st-${r.status}`)] : null),
          h('div', { class: 'snip' }, snippet(r.snippet))),
        h('span', { class: 'chev' }, '›')))));
  }
  let t;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 350); });
  nonOpBox.addEventListener('change', () => { nonOp = nonOpBox.checked; run(); });
  c.append(h('form', { onsubmit: (e) => { e.preventDefault(); input.blur(); run(); } }, input), modes,
    h('div', { class: 'fine label' }, 'Levels (none selected = all)'), lv, mu,
    h('label', { class: 'check' }, nonOpBox, 'Include not-yet-in-force text and editorial notes'), results);
  drawFilters();
  await run();
  return 'Search';
}

// ---------------- saved ----------------

async function saved(c) {
  const [bm, ss] = await Promise.all([S.bookmarks(), S.savedSearches()]);
  c.append(section('Bookmarks', bm.length ? bm.map(b => h('div', { class: 'row-wrap' },
    row(provHref(b.sourceId, b.provisionId), `${b.label}${b.heading ? ' — ' + b.heading : ''}`, `${b.sourceTitle} · ${b.jurisdiction}`),
    h('button', { class: 'icon-btn del', type: 'button', 'aria-label': 'Remove bookmark', onclick: async () => { await S.toggleBookmark(b); render(); } }, '✕'))) : h('p', { class: 'muted pad' }, 'Tap ★ beside a provision to bookmark it.')));
  c.append(section('Saved searches', ss.length ? ss.map((s, i) => h('div', { class: 'row-wrap' },
    row(`#/search?q=${encodeURIComponent(s.text)}&m=${s.mode}&l=${(s.levels || []).join(',')}&mu=${(s.munis || []).join(',')}&n=${s.nonOp ? 1 : 0}`, s.text, `${s.mode}${s.levels && s.levels.length ? ' · ' + s.levels.join(', ') : ''}`),
    h('button', { class: 'icon-btn del', type: 'button', 'aria-label': 'Delete saved search', onclick: async () => { await S.deleteSavedSearch(i); render(); } }, '✕'))) : h('p', { class: 'muted pad' }, 'Use “Save search” on the Search tab.')));
  c.append(h('p', { class: 'fine' }, 'Bookmarks and saved searches are kept only on this phone.'));
  return 'Saved';
}

// ---------------- settings / content status ----------------

async function settings(c) {
  state = await S.status();
  const cur = state.current, prev = state.previous;
  const fileInput = h('input', { type: 'file', hidden: true });
  const prog = h('div', { class: 'progress', hidden: true }, h('div', { class: 'progress-label' }), h('div', { class: 'bar' }, h('div', { class: 'fill' })));
  const importBtn = h('button', { class: 'btn primary block', type: 'button', onclick: () => fileInput.click() }, cur ? 'Import a newer package' : 'Import content package');
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    fileInput.value = '';
    if (!f) return;
    importBtn.disabled = true;
    prog.hidden = false;
    const label = prog.querySelector('.progress-label'), fill = prog.querySelector('.fill');
    try {
      await S.install(f, (p) => { label.textContent = `${p.stage} (${p.done}/${p.total})`; fill.style.width = `${Math.round(100 * p.done / Math.max(1, p.total))}%`; });
      try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (_) {}
      toast('Package verified and installed');
      render();
    } catch (e) {
      prog.hidden = true;
      importBtn.disabled = false;
      c.prepend(banner('Package not installed', [String(e.message || e), cur ? 'The package already in use has not changed.' : ''].filter(Boolean), 'error'));
      window.scrollTo(0, 0);
    }
  });

  if (state.openError) c.append(banner('Installed content could not be opened', [state.openError], 'error'));
  const kv = (k, v) => h('div', { class: 'kv' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v));
  c.append(section('Content status',
    cur ? [
      kv('Package', cur.packageVersion), kv('Published', fmtDate(cur.publishedAt)), kv('Signed by key', `${cur.signingKeyId} (signature valid)`),
      kv('Imported on this phone', `${fmtDate(cur.importedAt)} — not a currency date`), kv('Files verified', String(cur.fileCount)),
      cur.description ? h('p', { class: 'fine pad' }, cur.description) : null,
      h('p', { class: 'fine pad' }, cur.statement),
    ] : h('p', { class: 'pad' }, 'No content installed.'),
    h('div', { class: 'pad' }, importBtn, prog, fileInput,
      h('p', { class: 'fine' }, 'Choose the .phqpkg file (for example from Files, iCloud Drive or AirDrop). It is checked against a trusted signature and every file’s hash before anything changes. The package stays on this phone.'))));
  if (prev) {
    c.append(section('Previous package',
      kv('Package', prev.packageVersion), kv('Imported', fmtDate(prev.importedAt)),
      h('div', { class: 'pad' },
        h('button', { class: 'btn block', type: 'button', onclick: async () => { try { await S.rollback(); toast('Rolled back'); render(); } catch (e) { toast(e.message); } } }, `Roll back to ${prev.packageVersion}`),
        h('button', { class: 'btn block', type: 'button', onclick: async () => { if (confirmBox('Delete the previous package? You will not be able to roll back.')) { await S.deletePrevious(); render(); } } }, 'Delete previous package to free space'))));
  }

  // Storage
  let est = null, persisted = null;
  try { est = await navigator.storage.estimate(); } catch (_) {}
  try { persisted = await navigator.storage.persisted(); } catch (_) {}
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  c.append(section('Storage on this phone',
    kv('Used', est ? fmtBytes(est.usage) : 'Unknown'), kv('Database storage', state.storageMode === 'opfs' ? 'On-device file storage' : 'Browser storage (slower start)'),
    kv('Protected from automatic clearing', persisted ? 'Yes' : 'Not confirmed'),
    !standalone ? h('p', { class: 'fine pad' }, 'Tip: open this page in Safari, tap Share, then “Add to Home Screen”. Content installed in the home-screen app is kept separately from Safari.') : null));

  // Preferences
  const lvl = await S.getSetting('explanationLevel', 'plain-language');
  c.append(section('Explanation level',
    h('div', { class: 'pad' }, h('select', { 'aria-label': 'Default explanation level', onchange: (e) => S.setSetting('explanationLevel', e.target.value) },
      S.EXPLANATION_LEVELS.map(l => h('option', { value: l.id, selected: l.id === lvl }, l.title))),
      h('p', { class: 'fine' }, 'Changes only the drafted summary. Quoted legal wording, conditions, limits and cautions are identical at every level.'))));

  c.append(section('Privacy',
    h('ul', { class: 'plain pad' },
      h('li', {}, 'Searches, bookmarks and installed content stay on this phone. Nothing is sent anywhere.'),
      h('li', {}, 'No analytics, tracking or crash reporting.'),
      h('li', {}, 'There is no AI assistant in the web version, so nothing is ever sent for cloud processing.'),
      h('li', {}, 'When online, your phone may check this website for a newer version of the app itself. No content or records are sent.')),
    h('div', { class: 'pad' },
      h('button', { class: 'btn block', type: 'button', onclick: async () => { if (confirmBox('Erase bookmarks, saved searches and settings?')) { await S.eraseUserRecords(); toast('Local records erased'); render(); } } }, 'Erase bookmarks, searches and settings'),
      cur ? h('button', { class: 'btn block danger', type: 'button', onclick: async () => { if (confirmBox('Remove all installed content from this phone?')) { await S.eraseContent(); toast('Content removed'); render(); } } }, 'Remove installed content') : null)));

  c.append(section('About',
    kv('App', `Police HQ web ${APP_VERSION}`), kv('Database engine', `SQLite ${state.sqlite || ''}`),
    h('p', { class: 'fine pad' }, 'Police HQ supports human judgment. It does not determine guilt, direct that charges be laid, create grounds or guarantee legal compliance. No guide has had a qualified legal review.'),
    h('div', { class: 'pad' }, h('a', { href: '#/gaps' }, 'Coverage gaps'), ' · ', h('a', { href: 'vendor/LICENSES.txt', target: '_blank' }, 'Open-source licences'))));
  return 'Settings';
}

function confirmBox(msg) { return window.confirm(msg); }

// ---------------- boot ----------------

async function boot() {
  try {
    state = await S.status();
  } catch (e) {
    state = { current: null, previous: null, openError: String(e.message || e) };
  }
  if (state.openError && state.current) toast(state.openError, 6000);
  await render();
}

if ('serviceWorker' in navigator) {
  // Only an update to an app that was already running counts; the first install is not an "update".
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').then(reg => {
    const notify = (w) => {
      const b = document.getElementById('update');
      b.hidden = false;
      b.querySelector('button').onclick = () => { w.postMessage('skipWaiting'); };
    };
    if (hadController && reg.waiting) notify(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w && w.addEventListener('statechange', () => { if (w.state === 'installed' && hadController && reg.active && reg.active !== w) notify(w); });
    });
  }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
}

boot();
