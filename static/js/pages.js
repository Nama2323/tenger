// About: what TENGER is, its methods and limits, data credits with DOIs and the required acknowledgements,
// software and font licences, the base project, the team and the AI disclosure.
// (The game is in game-ui.js, lessons in learn-ui.js.) Every sentence comes from the English resource;
// only proper names, licence identifiers and URLs live here.
import { $, el } from './dom.js';
import { t } from './i18n.js';
import { CAN_SEE, CANNOT_SEE } from './help.js';
import { reservedRegions, reservedSource } from './reserved.js';

export const METHODS = ['seasons', 'quality', 'matching', 'holdout', 'receipts', 'recovery', 'scoring'];
export const LIMITS = ['saturation', 'contaminated', 'parallax', 'trials', 'approx'];

/** Data sources and services the code or the published data use. `ack` is a required acknowledgement. */
export const SOURCES = [
  {
    id: 'spherex',
    ack: 'ack.spherex',
    links: [
      ['https://doi.org/10.26131/IRSA678', 'about.link.doiDr1'],
      ['https://doi.org/10.26131/IRSA679', 'about.link.doiCube'],
      ['https://irsa.ipac.caltech.edu/data/SPHEREx/docs/overview_dr1.html', 'about.link.overview'],
    ],
  },
  { id: 'irsa', ack: 'ack.irsa', links: [['https://irsa.ipac.caltech.edu/', 'about.link.website']] },
  { id: 'wise', ack: 'ack.wise', links: [['https://irsa.ipac.caltech.edu/Missions/wise.html', 'about.link.website']] },
  { id: 'twomass', ack: 'ack.twomass', links: [['https://doi.org/10.26131/IRSA2', 'about.link.doi2mass']] },
  {
    id: 'gaia',
    ack: 'ack.gaia',
    links: [
      ['https://www.cosmos.esa.int/gaia', 'about.link.website'],
      ['https://www.cosmos.esa.int/web/gaia/dpac/consortium', 'about.link.gaiaDpac'],
    ],
  },
  { id: 'simbad', ack: 'ack.simbad', links: [['https://simbad.cds.unistra.fr/', 'about.link.website']] },
  { id: 'vizier', ack: 'ack.vizier', links: [['https://doi.org/10.26093/cds/vizier', 'about.link.doiVizier']] },
  { id: 'sesame', links: [['https://cds.unistra.fr/cgi-bin/Sesame', 'about.link.website']] },
  { id: 'vsx', links: [['https://www.aavso.org/vsx/', 'about.link.website']] },
  { id: 'horizons', links: [['https://ssd.jpl.nasa.gov/horizons/', 'about.link.website']] },
  { id: 'sbdb', links: [['https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html', 'about.link.website']] },
  { id: 'standish', links: [['https://ssd.jpl.nasa.gov/planets/approx_pos.html', 'about.link.website']] },
  { id: 'aladin', ack: 'ack.aladin', links: [['https://aladin.cds.unistra.fr/AladinLite/', 'about.link.website']] },
];

/** Libraries and tools, with the licence of the version in use (Python: installed package metadata, 14 Nov 2026). */
export const SOFTWARE = [
  { name: 'three.js 0.187.0', use: 'about.sw.three', licence: 'MIT', href: 'https://threejs.org/' },
  { name: 'Aladin Lite 3.8.2', use: 'about.sw.aladin', licence: 'GPL-3.0', href: 'https://github.com/cds-astro/aladin-lite' },
  { name: 'Python 3.12', use: 'about.sw.python', licence: 'PSF-2.0', href: 'https://www.python.org/' },
  { name: 'Astropy', use: 'about.sw.astropy', licence: 'BSD-3-Clause', href: 'https://www.astropy.org/', ack: 'ack.astropy' },
  { name: 'NumPy', use: 'about.sw.numpy', licence: 'BSD-3-Clause', href: 'https://numpy.org/' },
  { name: 'SciPy', use: 'about.sw.scipy', licence: 'BSD-3-Clause', href: 'https://scipy.org/' },
  { name: 'Pillow', use: 'about.sw.pillow', licence: 'MIT-CMU', href: 'https://python-pillow.github.io/' },
  { name: 'FastAPI', use: 'about.sw.fastapi', licence: 'MIT', href: 'https://fastapi.tiangolo.com/' },
  { name: 'Starlette', use: 'about.sw.starlette', licence: 'BSD-3-Clause', href: 'https://starlette.dev/' },
  { name: 'Uvicorn', use: 'about.sw.uvicorn', licence: 'BSD-3-Clause', href: 'https://uvicorn.dev/' },
  { name: 'HTTPX', use: 'about.sw.httpx', licence: 'BSD-3-Clause', href: 'https://www.python-httpx.org/' },
  { name: 'pytest', use: 'about.sw.pytest', licence: 'MIT', href: 'https://pytest.org/' },
  { name: 'Node.js', use: 'about.sw.node', licence: 'MIT', href: 'https://nodejs.org/' },
];

/** Every package in the Python environment (`importlib.metadata`, 14 Nov 2026), including dependencies. */
export const PYTHON_PACKAGES = [
  ['annotated-doc', 'MIT'], ['annotated-types', 'MIT'], ['anyio', 'MIT'], ['astropy', 'BSD-3-Clause'],
  ['astropy-iers-data', 'BSD-3-Clause'], ['certifi', 'MPL-2.0'], ['click', 'BSD-3-Clause'], ['fastapi', 'MIT'],
  ['h11', 'MIT'], ['httpcore', 'BSD-3-Clause'], ['httptools', 'MIT'], ['httpx', 'BSD-3-Clause'],
  ['idna', 'BSD-3-Clause'], ['iniconfig', 'MIT'], ['numpy', 'BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0'],
  ['opentelemetry-api', 'Apache-2.0'], ['packaging', 'Apache-2.0 OR BSD-2-Clause'], ['pillow', 'MIT-CMU'],
  ['pip', 'MIT'], ['pluggy', 'MIT'], ['pydantic', 'MIT'], ['pydantic_core', 'MIT'], ['pyerfa', 'BSD-3-Clause'],
  ['Pygments', 'BSD-2-Clause'], ['pytest', 'MIT'], ['python-dotenv', 'BSD-3-Clause'], ['PyYAML', 'MIT'],
  ['scipy', 'BSD-3-Clause'], ['starlette', 'BSD-3-Clause'], ['typing-inspection', 'MIT'],
  ['typing_extensions', 'PSF-2.0'], ['uvicorn', 'BSD-3-Clause'], ['uvloop', 'MIT OR Apache-2.0'],
  ['watchfiles', 'MIT'], ['websockets', 'BSD-3-Clause'],
];

/** Self-hosted fonts and their licence files (static/fonts/README.md). */
const FONTS = [
  { key: 'font.spaceGrotesk', family: 'Space Grotesk', licence: 'fonts/OFL-SpaceGrotesk.txt', class: 'font-head' },
  { key: 'font.inter', family: 'Inter', licence: 'fonts/OFL-Inter.txt', class: 'font-text' },
  { key: 'font.jetbrainsMono', family: 'JetBrains Mono', licence: 'fonts/OFL-JetBrainsMono.txt', class: 'font-mono' },
];

export const BASE_PROJECT = 'https://github.com/pythonhack000/spherex-blink';
export const TEAM = ['about.team.member1', 'about.team.member2', 'about.team.member3', 'about.team.member4'];
export const AI_DISCLOSURE = ['about.ai.planning', 'about.ai.code', 'about.ai.review', 'about.ai.images'];

const external = (href, text) => el('a', { href, text, rel: 'noopener' });

/** One <div> per term (allowed inside <dl>) so a term and its text stay together in the grid. */
const definitions = (prefix, ids) => ids.map((id) => el('div', {}, [
  el('dt', { text: t(`${prefix}.${id}.title`) }),
  el('dd', { text: t(`${prefix}.${id}`) }),
]));

function sourceItem(source) {
  return el('li', { class: 'source' }, [
    el('h3', { text: t(`about.src.${source.id}.name`) }),
    el('p', { text: t('about.use', { text: t(`about.src.${source.id}.use`) }) }),
    source.ack ? el('blockquote', { class: 'ack' }, [el('p', { text: t(source.ack) })]) : null,
    el('p', { class: 'source-links' }, source.links.map(([href, key]) => external(href, t(key)))),
  ]);
}

function softwareItem(item) {
  return el('li', {}, [
    el('strong', {}, external(item.href, item.name)),
    el('span', { text: ` · ${t(item.use)} · ` }),
    el('code', { text: item.licence }),
    item.ack ? el('blockquote', { class: 'ack' }, [el('p', { text: t(item.ack) })]) : null,
  ]);
}

export function renderAbout() {
  $('about-methods').replaceChildren(...definitions('about.m', METHODS));
  $('about-limits').replaceChildren(...definitions('about.l', LIMITS));
  $('about-see').replaceChildren(
    el('section', { class: 'limits-group can' }, [el('h3', { text: t('limits.canTitle') }), el('ul', {}, CAN_SEE.map((key) => el('li', { text: t(key) })))]),
    el('section', { class: 'limits-group cannot' }, [el('h3', { text: t('limits.cannotTitle') }), el('ul', {}, CANNOT_SEE.map((key) => el('li', { text: t(key) })))]),
  );
  $('about-data').replaceChildren(...SOURCES.map(sourceItem));
  $('about-software').replaceChildren(...SOFTWARE.map(softwareItem));
  $('about-packages').replaceChildren(
    el('thead', {}, el('tr', {}, [el('th', { scope: 'col', text: t('about.pkgName') }), el('th', { scope: 'col', text: t('about.pkgLicence') })])),
    el('tbody', {}, PYTHON_PACKAGES.map(([name, licence]) => el('tr', {}, [el('td', { text: name }), el('td', {}, el('code', { text: licence }))]))),
  );
  $('about-fonts').replaceChildren(...FONTS.map((font) => el('li', {}, [
    el('strong', { class: font.class, text: font.family }),
    el('span', { text: t(font.key) }),
    el('a', { href: font.licence, text: t('font.licence') }),
  ])));
  $('about-base-link').replaceChildren(external(BASE_PROJECT, t('about.link.source')));
  $('about-team').replaceChildren(...TEAM.map((key) => el('li', { text: t(key) })));
  $('about-ai').replaceChildren(...AI_DISCLOSURE.map((key) => el('li', { text: t(key) })));
}

/**
 * The reserved sky regions in force (from reserved.json, V10): released paths no longer block live loading;
 * the others still do. Called after the data load. nameOf(key) gives a target's display name.
 */
export function renderReserved(nameOf) {
  const items = reservedRegions().map((region) => el('li', { class: `reserved-item is-${region.status}` }, [
    el('strong', { text: nameOf(region.key) ?? region.key }),
    el('span', { class: `chip chip-reserved-${region.status}`, text: t(`about.reserved.${region.status}`) }),
    region.reasonKey ? el('span', { class: 'note', text: t(region.reasonKey) }) : null,
    region.untilKey ? el('span', { class: 'note', text: t(region.untilKey) }) : null,
  ]));
  $('about-reserved').replaceChildren(...items);
  $('about-reserved-source').textContent = reservedSource() === 'file' ? '' : t('about.reserved.builtIn');
}
