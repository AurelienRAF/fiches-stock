'use strict';
// Fiches stock buvettes : appli de terrain. Tout ce qui est saisi est gardé dans le téléphone tout de suite,
// puis envoyé au Google Sheet dès que ça capte. Le Sheet répond « reçu » ligne par ligne.

const URL_SCRIPT_EN_LIGNE = 'https://script.google.com/macros/s/AKfycbybsXd8nv24k-rohiZOizzf_j0zEb86qSAMxydDpVmtWMDWxfXQcrpDfMXhHeLCFEiQFQ/exec'; // adresse /exec du script Google (voir README)
const URL_SCRIPT = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? location.origin + '/exec' : URL_SCRIPT_EN_LIGNE;
const K_CONFIG = 'fs-config', K_ETAT = 'fs-etat', K_ACCES = 'fs-acces';
const NIV = [[0.1, 'presque vide'], [0.25, '1/4'], [0.5, '1/2'], [0.75, '3/4']];

// ---------- stockage du téléphone
let stockageOK = true;
const lire = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
const ecrire = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); stockageOK = true; } catch (e) { stockageOK = false; } };

// ---------- accès : le lien (QR code) porte la clé de la buvette, de la préparation ou d'Aurélien
function lireAcces() {
  const u = new URL(location.href), k = u.searchParams.get('k');
  if (k) { const a = { k, r: u.searchParams.get('r') || 'buvette', b: u.searchParams.get('b') || null }; ecrire(K_ACCES, a); return a; }
  return lire(K_ACCES, null);
}
const ACCES = lireAcces();
let CFG = lire(K_CONFIG, null);
if (CFG && (!ACCES || CFG.k !== ACCES.k)) CFG = null;
const ET = Object.assign({ prenom: '', file: [], mes: [], brouillons: {}, mepBr: {} }, lire(K_ETAT, {}));
const V = { screen: 'accueil', aj: null, tab: 'suivi', detB: null, mepB: null, err: null, conf: {}, focus: null, waText: null, horsLigne: false, erreurLien: null, aRendre: false, reglage: null };
const sauver = () => ecrire(K_ETAT, ET);

// ---------- petits outils
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o || {}));
const hDe = t => { const d = new Date(t); return d.getHours() + 'h' + String(d.getMinutes()).padStart(2, '0'); };
const fmt = x => (Math.round(x * 100) / 100).toLocaleString('fr-FR');
const plural = (n, w) => n + ' ' + w + (n > 1 ? 's' : '');
const progTxt = pr => pr.done + (pr.done > 1 ? ' produits comptés' : ' produit compté') + ' sur ' + pr.n;
const nivLabel = v => (NIV.find(n => n[0] === v) || [0, '?'])[1];
const role = () => (CFG ? CFG.role : (ACCES ? ACCES.r : null));
const matchCode = () => (CFG && CFG.match ? CFG.match.code : '');
const P = p => (CFG && CFG.produits[p]) || { n: p, d: p, u: '', t: 'snack', lot: null };
const liste = b => (CFG && CFG.listes[b]) || [];
const buvette = b => (CFG ? CFG.buvettes.find(x => x.id === b) : null) || { id: b, nom: b, court: b };
const SAISIE = t => (t === 'fut' || t === 'bag' || t === 'alcool') ? 'E' : (t === 'vin' ? 'E50' : 'P');
const labPl = t => (t === 'fut' || t === 'bag') ? 'Pleins' : (['soft', 'petit', 'biere', 'alcool', 'vin'].includes(t) ? 'Pleines' : 'Il reste');
const unitWord = t => t === 'fut' ? 'Fût' : (t === 'bag' ? 'Bag' : 'Bouteille');
function fam(b, p) {
  const t = P(p).t;
  if (['fut', 'bag', 'alcool', 'biere'].includes(t)) return 'Bières et alcools';
  if (t === 'soft') return b === 'haras' ? 'Grandes bouteilles (salon)' : 'Softs et eaux';
  if (t === 'petit') return b === 'haras' ? 'Petites bouteilles (loges)' : 'Softs et eaux';
  if (t === 'gobelet') return 'Boissons chaudes';
  if (t === 'sandwich') return 'Sandwichs';
  if (t === 'vin') return 'Vins et champagne';
  return 'Snacks';
}
function groups(b) { const g = [], m = {}; liste(b).forEach(p => { const f = fam(b, p); if (!m[f]) { m[f] = []; g.push([f, m[f]]); } m[f].push(p); }); return g; }

// ---------- données : ce que dit le Sheet + ce que ce téléphone a saisi et pas encore vu revenir
const donnees = b => (CFG && CFG.donnees && CFG.donnees[b]) || { mep: null, mepFaite: false, mepT: 0, ajouts: [], fiche: null };
const mesDuMatch = (type, b) => ET.mes.filter(s => s.type === type && s.b === b && s.match === matchCode() && !s.refus);
function ajoutsDe(b) {
  const srv = (donnees(b).ajouts || []).map(a => Object.assign({ envoye: true }, a));
  const ids = new Set(srv.map(a => a.id));
  const loc = mesDuMatch('ajout', b).filter(s => !ids.has(s.id)).map(s => ({ id: s.id, items: s.data.items, auteur: s.auteur, h: hDe(s.t), envoye: !!s.recu }));
  return srv.concat(loc);
}
function mepDe(b) {
  const d = donnees(b), loc = mesDuMatch('mep', b).slice(-1)[0];
  if (loc && loc.t >= (d.mepT || 0)) return { q: loc.data.q, faite: true, par: { auteur: loc.auteur, h: hDe(loc.t) }, envoye: !!loc.recu };
  return { q: d.mep, faite: d.mepFaite, par: d.mepPar, repris: d.mepRepris, envoye: true };
}
function ficheDe(b) {
  const srv = donnees(b).fiche, loc = mesDuMatch('fiche', b).slice(-1)[0];
  if (loc && (!srv || loc.t > srv.t)) return { c: loc.data.c, auteur: loc.auteur, h: hDe(loc.t), v: (srv ? srv.v : 0) + 1, envoye: !!loc.recu, recu: loc.recu || null, local: true };
  return srv ? Object.assign({ envoye: true }, srv) : null;
}
const ajSum = (b, p) => ajoutsDe(b).reduce((t, a) => t + ((a.items || {})[p] || 0), 0);
function recuDe(b, p) { const m = mepDe(b); return m.faite && m.q ? (m.q[p] || 0) + ajSum(b, p) : null; }

// brouillon du comptage de fin de match : gardé dans le téléphone tant qu'il n'est pas validé
const cleBr = b => matchCode() + '|' + b;
function brouillon(b) {
  const k = cleBr(b);
  if (!ET.brouillons[k]) { const f = ficheDe(b); ET.brouillons[k] = { c: f ? clone(f.c) : {}, modifie: false, base: f ? f.v : 0 }; }
  return ET.brouillons[k];
}
function cpt(b, p) { return brouillon(b).c[p]; }
function ens(b, p) { const br = brouillon(b); br.modifie = true; return br.c[p] = br.c[p] || { pl: null, en: 0, niv: [] }; }
function fixNiv(c) { c.niv = (c.niv || []).slice(0, c.en); while (c.niv.length < c.en) c.niv.push(null); }
function complete(b, p) {
  const c = cpt(b, p); if (!c || c.pl == null) return false;
  if (SAISIE(P(p).t) === 'E') for (let i = 0; i < c.en; i++) if (c.niv[i] == null) return false;
  return true;
}
function compteDans(c, p) { return c.pl + (SAISIE(P(p).t) === 'P' ? 0 : (c.en || 0)); }
function alertes(b, comptes) {
  return liste(b).map(p => {
    const c = comptes[p], r = recuDe(b, p);
    if (!c || c.pl == null || r == null) return null;
    const n = compteDans(c, p); return n > r ? { p, recu: r, compte: n } : null;
  }).filter(Boolean);
}
function conso(b, p, c) {
  if (!c || c.pl == null) return null;
  const m = mepDe(b), t = SAISIE(P(p).t);
  let ent = 0;
  if (t === 'E') ent = (c.niv || []).slice(0, c.en).reduce((a, x) => a + (x || 0), 0);
  if (t === 'E50') ent = (c.en || 0) * 0.5;
  return ((m.q && m.q[p]) || 0) + ajSum(b, p) - c.pl - ent;
}
function fmtC(c, p) {
  if (!c || c.pl == null) return '—';
  const t = SAISIE(P(p).t); let s = String(c.pl);
  if (t === 'E' && c.en) s += ' + ' + plural(c.en, 'entamé') + ' (' + (c.niv || []).slice(0, c.en).map(nivLabel).join(', ') + ')';
  if (t === 'E50' && c.en) s += ' + ' + plural(c.en, 'entamée') + ' (à moitié)';
  return s;
}
function synchroBrouillons() { // un brouillon pas modifié suit la dernière fiche reçue du Sheet
  Object.keys(ET.brouillons).forEach(k => {
    const i = k.lastIndexOf('|'), m = k.slice(0, i), b = k.slice(i + 1);
    if (m !== matchCode()) { delete ET.brouillons[k]; return; }
    const br = ET.brouillons[k], f = ficheDe(b);
    if (f && !br.modifie && f.v > br.base) { br.c = clone(f.c); br.base = f.v; }
  });
  Object.keys(ET.mepBr).forEach(k => {
    const i = k.lastIndexOf('|'); if (k.slice(0, i) !== matchCode()) { delete ET.mepBr[k]; return; }
    if (!ET.mepBr[k].modifie) delete ET.mepBr[k];
  });
  sauver();
}
function mepBrouillon(b) {
  const k = cleBr(b);
  if (!ET.mepBr[k]) { const m = mepDe(b); const q = {}; liste(b).forEach(p => { q[p] = (m.q && m.q[p]) || 0; }); ET.mepBr[k] = { q, modifie: false }; }
  return ET.mepBr[k];
}
function limiteDepassee() {
  if (!CFG || !CFG.match || !CFG.match.date) return false;
  const [d, m, y] = CFG.match.date.split('/').map(Number), [hh, mm] = (CFG.limite || '23:59').split(':').map(Number);
  return Date.now() > new Date(y, m - 1, d, hh, mm, 59).getTime();
}
const peutModifier = b => role() === 'admin' || !ficheDe(b) || !limiteDepassee();

// ---------- saisies, file d'attente et envoi
const idUnique = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
const auteur = () => role() === 'admin' ? 'Aurélien' : (role() === 'prepa' ? 'Préparation' : ET.prenom.trim());
function nouvelleSaisie(type, b, data, qui) {
  const s = { id: idUnique(), type, b: b || '', match: matchCode(), data, auteur: qui || auteur(), t: Date.now(), k: ACCES.k };
  ET.file.push(s); ET.mes.push(s); if (ET.mes.length > 400) ET.mes = ET.mes.slice(-400);
  sauver(); setTimeout(envoyer, 50); return s;
}
async function appel(corps) {
  if (URL_SCRIPT === 'A_REMPLIR') throw new Error('adresse du script pas réglée');
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetch(URL_SCRIPT, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(corps), signal: ctl.signal });
    return JSON.parse(await r.text()); // une page d'erreur Google n'est pas du JSON : on retentera
  } finally { clearTimeout(to); }
}
let envoiEnCours = false;
async function envoyer() {
  if (envoiEnCours || !ET.file.length || !ACCES) return;
  envoiEnCours = true;
  let encore = false;
  try {
    const cle = ET.file[0].k || ACCES.k; // chaque saisie part avec la clé du lien qui l'a créée
    const lot = ET.file.filter(s => (s.k || ACCES.k) === cle).slice(0, 40);
    const r = await appel({ a: 'saisie', k: cle, items: lot.map(s => { const c = Object.assign({}, s); delete c.k; return c; }) });
    if (r && r.ok) {
      const finis = new Set();
      (r.recus || []).forEach(x => { finis.add(x.id); const m = ET.mes.find(s => s.id === x.id); if (m) m.recu = x.h; });
      (r.refus || []).forEach(x => { finis.add(x.id); const m = ET.mes.find(s => s.id === x.id); if (m) m.refus = x.raison; toast('Refusé par le Sheet : ' + x.raison); });
      ET.file = ET.file.filter(s => !finis.has(s.id));
      V.horsLigne = false; encore = ET.file.length > 0; sauver();
      envoiEnCours = false;
      await rafraichir();
    } else if (r && r.code === 'lien') { V.erreurLien = r.erreur; }
  } catch (e) { V.horsLigne = true; }
  envoiEnCours = false;
  rendre();
  if (encore) envoyer();
}
let rafEnCours = false;
async function rafraichir() {
  if (rafEnCours || !ACCES) return;
  rafEnCours = true;
  try {
    const r = await appel({ a: 'config', k: ACCES.k });
    if (r && r.ok) { r.k = ACCES.k; r.recuLe = Date.now(); CFG = r; ecrire(K_CONFIG, CFG); V.horsLigne = false; V.erreurLien = null; synchroBrouillons(); }
    else if (r && r.code === 'lien') V.erreurLien = r.erreur;
  } catch (e) { V.horsLigne = true; }
  rafEnCours = false;
  rendre();
}
window.addEventListener('online', () => { envoyer(); rafraichir(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { envoyer(); rafraichir(); } });
setInterval(() => { if (!document.hidden) envoyer(); }, 20000);
setInterval(() => { if (!document.hidden && !ET.file.length) rafraichir(); }, 60000);

// ---------- affichage
let toastT = null;
function toast(t) { const el = document.getElementById('toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 2600); }
function pill() {
  const n = ET.file.length;
  if (V.horsLigne) return `<span id="pill" class="pill warn">${n ? n + ' en attente' : 'Pas de réseau'}</span>`;
  return n ? `<span id="pill" class="pill warn">Envoi…</span>` : `<span id="pill" class="pill ok">Tout est envoyé</span>`;
}
function band(t, s) { return `<header class="band"><div class="wrap band-in"><div class="band-txt"><div class="band-t">${esc(t)}</div><div class="band-s">${esc(s)}</div></div>${pill()}</div></header>`; }
const sousTitre = () => CFG && CFG.match ? CFG.match.affiche + ' · ' + CFG.match.jour : '';
function back(a, attr, label) { return `<button class="back" data-a="${a}" ${attr}>‹ ${label || 'Retour'}</button>`; }
function err() { return V.err ? `<p class="err" role="alert">${esc(V.err)}</p>` : ''; }
function stepper(o) { return `<div class="step"><button class="sb" data-a="${o.act}" ${o.data} data-d="-1" aria-label="Moins, ${esc(o.label)}">−</button><input class="si" type="number" inputmode="numeric" min="0" placeholder="?" value="${o.val == null ? '' : o.val}" data-in="${o.inKey}" ${o.data} aria-label="${esc(o.label)}"><button class="sb" data-a="${o.act}" ${o.data} data-d="1" aria-label="Plus, ${esc(o.label)}">+</button></div>`; }
function lotBtn(act, data, p) { const l = P(p).lot; return l ? `<button class="btn sm" data-a="${act}" ${data}>+1 ${esc(l[1])} de ${l[0]}</button>` : ''; }
function prenomField() { return `<label class="field">Ton prénom<input id="prenom" data-in="prenom" value="${esc(ET.prenom)}" autocomplete="given-name" placeholder="Écris ton prénom"></label>`; }
function svgC(t, v) {
  if (t === 'alcool') { const h = Math.round(25 * v); return `<svg viewBox="0 0 30 40" aria-hidden="true"><rect class="lq" x="8.5" y="${37.5 - h}" width="13" height="${h}"/><path class="ol" d="M12 2h6v9l3 3v23a1 1 0 0 1-1 1H10a1 1 0 0 1-1-1V14l3-3z"/></svg>`; }
  if (t === 'bag') { const h = Math.round(28 * v); return `<svg viewBox="0 0 30 40" aria-hidden="true"><rect class="lq" x="5.5" y="${36.5 - h}" width="19" height="${h}"/><rect class="ol" x="4" y="7" width="22" height="31" rx="3"/><rect class="ol" x="12" y="2" width="6" height="5"/></svg>`; }
  const h = Math.round(31 * v); return `<svg viewBox="0 0 30 40" aria-hidden="true"><rect class="lq" x="5" y="${36 - h}" width="20" height="${h}"/><rect class="ol" x="3" y="3" width="24" height="35" rx="6"/><path class="ol" d="M3 12h24M3 29h24"/></svg>`;
}
function vide(titre, texte, bouton) { return `<main class="wrap main"><div class="vide"><h1 class="h1">${esc(titre)}</h1><p class="muted">${esc(texte)}</p>${bouton || ''}</div></main>`; }

// ---------- écrans intérimaire
function scrAccueil(b) {
  const f = ficheDe(b), aj = ajoutsDe(b).slice().reverse();
  let h = '';
  if (f) h += f.envoye ? `<div class="note ok"><b>Fiche validée à ${esc(f.h)} par ${esc(f.auteur)}</b>${peutModifier(b) ? 'Tu peux encore la modifier jusqu\'à ' + esc((CFG.limite || '23:59').replace(':', 'h')) + '.' : 'Modification fermée : demande à Aurélien.'}</div>`
    : `<div class="note warn"><b>Fiche validée, pas encore reçue</b>Garde l'appli ouverte, elle part dès que ça capte.</div>`;
  h += `<div class="duo"><button class="btn choice" data-a="go" data-s="ajout"><span class="ct">J'ai reçu du stock</span><span class="cs">pendant le match</span></button>
    <button class="btn choice" data-a="go" data-s="comptage"><span class="ct">${f ? 'Modifier la fin de match' : 'Compter la fin de match'}</span><span class="cs">après le match</span></button></div>`;
  h += `<h2 class="h2">Ajouts notés</h2>`;
  h += aj.length ? `<ul class="list">${aj.map(a => `<li><div><b>${esc(a.h)}</b> · ${Object.entries(a.items || {}).map(([p, q]) => esc(P(p).d) + ' +' + q).join(', ')}</div><div class="muted">${esc(a.auteur)} · ${a.envoye ? 'envoyé' : 'en attente d\'envoi'}</div></li>`).join('')}</ul>`
    : `<p class="muted">Aucun ajout pour l'instant. Quand on t'apporte du stock pendant le match, note-le ici.</p>`;
  return h;
}
function scrAjout(b) {
  const tiles = liste(b).filter(p => P(p).t !== 'sandwich'), hasSw = liste(b).some(p => P(p).t === 'sandwich');
  return back('go', 'data-s="accueil"') + `<h1 class="h1">J'ai reçu du stock</h1><p class="muted">Touche ce que tu as reçu.</p>
  <div class="tiles">${tiles.map(p => `<button class="tile" data-a="ajp" data-p="${esc(p)}">${esc(P(p).d)}<small>${esc(P(p).u)}</small></button>`).join('')}
  ${hasSw ? `<button class="tile tile-wide" data-a="ajsw">Sandwichs<small>un compteur par goût</small></button>` : ''}</div>`;
}
function scrAjoutQte() {
  const q = V.aj.q, keys = Object.keys(q), tot = keys.reduce((t, p) => t + (q[p] || 0), 0);
  let h = back('ajback', '') + `<h1 class="h1">${V.aj.sw ? 'Sandwichs reçus' : esc(P(keys[0]).d)}</h1><p class="muted">${V.aj.sw ? 'Un compteur par goût.' : esc(P(keys[0]).u)}</p>`;
  h += keys.map(p => `<div class="card"><div class="card-h"><div><div class="pn">${esc(P(p).d)}</div><div class="pu">${V.aj.sw ? 'reçus' : 'quantité reçue'}</div></div>${stepper({ act: 'ajq', data: `data-p="${esc(p)}"`, val: q[p], inKey: 'ajq', label: P(p).d })}</div>
    ${lotBtn('ajpack', `data-p="${esc(p)}"`, p)}</div>`).join('');
  if (V.aj.sw) h += `<div class="kv"><span class="muted">Total</span><b id="ajtot">${plural(tot, 'sandwich')}</b></div>`;
  h += prenomField() + err() + `<button class="btn primary big" data-a="ajsave">Enregistrer l'ajout</button>`;
  return h;
}
function card(b, p) {
  const c = cpt(b, p) || { pl: null, en: 0, niv: [] }, t = P(p).t, s = SAISIE(t), data = `data-b="${esc(b)}" data-p="${esc(p)}"`;
  let h = `<div class="card ${complete(b, p) ? 'done' : ''}" id="card-${esc(p)}"><div class="card-h"><div><div class="pn">${esc(P(p).d)}</div><div class="pu">${esc(P(p).u)}</div></div>
    <div><div class="lab">${labPl(t)}</div>${stepper({ act: 'st', data: data + ' data-f="pl"', val: c.pl, inKey: 'cpt', label: labPl(t) + ', ' + P(p).d })}</div></div>${lotBtn('cpack', data, p)}`;
  if (s === 'E') {
    h += `<div class="sub"><span>${t === 'fut' ? 'Fûts' : (t === 'bag' ? 'Bags' : 'Bouteilles')} entamés</span>${stepper({ act: 'st', data: data + ' data-f="en"', val: c.en || 0, inKey: 'cpt', label: 'Entamés, ' + P(p).d })}</div>`;
    for (let i = 0; i < (c.en || 0); i++) {
      const v = (c.niv || [])[i];
      h += `<div><div class="gl">${unitWord(t)} entamé ${c.en > 1 ? (i + 1) + ' ' : ''}: il reste environ</div><div class="gopts">${NIV.map(([nv, l]) => `<button class="gopt ${v === nv ? 'on' : ''}" data-a="niv" ${data} data-i="${i}" data-v="${nv}" aria-pressed="${v === nv}">${svgC(t, nv)}<span>${l}</span></button>`).join('')}</div></div>`;
    }
  }
  if (s === 'E50') h += `<div class="sub"><span>Entamées <span class="muted">(comptées à moitié)</span></span>${stepper({ act: 'st', data: data + ' data-f="en"', val: c.en || 0, inKey: 'cpt', label: 'Entamées, ' + P(p).d })}</div>`;
  return h + '</div>';
}
const progress = b => ({ done: liste(b).filter(p => complete(b, p)).length, n: liste(b).length });
function scrComptage(b, admin) {
  const pr = progress(b), f = ficheDe(b);
  let h = admin ? back('tab', 'data-t="detail"', 'Retour à la fiche') : back('go', 'data-s="accueil"');
  h += `<h1 class="h1">${admin ? 'Corriger : ' + esc(buvette(b).nom) : 'Ce qui reste'}</h1>`;
  if (!peutModifier(b)) return h + `<div class="note bad"><b>Modification fermée</b>La fiche ne peut plus être modifiée depuis ${esc((CFG.limite || '23:59').replace(':', 'h'))}. Demande à Aurélien.</div>`;
  if (f && !admin) h += `<div class="note gold">Cette fiche est déjà validée. Valide à nouveau après ta modification : la nouvelle version remplacera l'ancienne.</div>`;
  h += `<p class="muted" id="prog">${progTxt(pr)}</p><div class="prog"><i id="progbar" style="width:${pr.n ? Math.round(pr.done / pr.n * 100) : 0}%"></i></div>`;
  groups(b).forEach(([g, l]) => {
    h += `<h2 class="h2">${esc(g)}</h2>`;
    if (['Softs et eaux', 'Grandes bouteilles (salon)', 'Petites bouteilles (loges)'].includes(g)) h += `<p class="hint">Compte seulement les bouteilles pleines : une bouteille ouverte compte comme vide.</p>`;
    h += l.map(p => card(b, p)).join('');
  });
  h += `<div class="actionbar">${err()}${admin ? `<button class="btn primary big" data-a="corrsave">Enregistrer la correction</button>` : `<button class="btn primary big" data-a="go" data-s="validation">Vérifier et valider</button>`}</div>`;
  return h;
}
function scrValidation(b) {
  const miss = liste(b).filter(p => !complete(b, p));
  let h = back('go', 'data-s="comptage"', 'Retour au comptage');
  if (miss.length) return h + `<h1 class="h1">Presque fini</h1><div class="note warn"><b>${miss.length > 1 ? 'Il manque ' + miss.length + ' produits' : 'Il manque 1 produit'}</b>${miss.map(p => esc(P(p).d) + ' (' + esc(P(p).u) + ')').join(', ')}.</div>
    <button class="btn primary big" data-a="gomiss" data-p="${esc(miss[0])}">Compléter le comptage</button>`;
  const al = alertes(b, brouillon(b).c);
  h += `<h1 class="h1">Vérifier et valider</h1>`;
  if (al.length) h += `<div class="note warn"><b>${al.length > 1 ? al.length + ' chiffres à vérifier' : 'Un chiffre à vérifier'}</b>${al.map(a => `<label class="alert"><input type="checkbox" data-in="conf" data-p="${esc(a.p)}" ${V.conf[a.p] ? 'checked' : ''}><span>${esc(P(a.p).d)} (${esc(P(a.p).u)}) : tu en comptes ${a.compte}, mais ${a.recu === 0 ? 'rien n\'a été reçu' : (a.recu === 1 ? '1 seul a été reçu' : a.recu + ' ont été reçus en tout')}. Recompte. Si ton chiffre est bon, coche ici.</span></label>`).join('')}</div>`;
  h += `<h2 class="h2">Récapitulatif</h2><ul class="recap">${liste(b).map(p => `<li><span>${esc(P(p).d)} <small>${esc(P(p).u)}</small></span><span>${esc(fmtC(cpt(b, p), p))}</span></li>`).join('')}</ul>`;
  h += prenomField() + err() + `<button class="btn primary big" data-a="valider">Valider la fiche</button>`;
  return h;
}
function scrConfirm(b) {
  const f = ficheDe(b);
  if (!f) return scrAccueil(b);
  let h = '';
  if (f.envoye) h += `<div class="note ok"><b>Fiche reçue${f.recu ? ' à ' + esc(f.recu) : ''}</b>Merci ${esc(f.auteur)}. Tu peux encore la modifier jusqu'à ${esc((CFG.limite || '23:59').replace(':', 'h'))}.${f.v > 1 ? ' Cette version ' + f.v + ' remplace la précédente.' : ''}</div>`;
  else h += `<div class="note warn"><b>Pas encore reçue</b>${V.horsLigne ? 'Pas de réseau. ' : 'Envoi en cours. '}Garde l'appli ouverte : elle réessaie dès que ça capte. Si tu dois partir, envoie la fiche par WhatsApp à Aurélien.</div>`;
  h += `<button class="btn" data-a="go" data-s="comptage">Modifier</button><button class="btn" data-a="wa">Copier le texte pour WhatsApp</button>`;
  if (V.waText != null) h += `<p class="muted">Texte copié. Si la copie n'a pas marché, sélectionne-le ici :</p><textarea id="watext" readonly>${esc(V.waText)}</textarea>`;
  h += `<button class="btn" data-a="go" data-s="accueil">Retour à l'accueil</button>`;
  return h;
}
function buvetteView() {
  const b = CFG.b; let body;
  switch (V.screen) {
    case 'ajout': body = V.aj ? scrAjoutQte() : scrAjout(b); break;
    case 'comptage': body = scrComptage(b, false); break;
    case 'validation': body = scrValidation(b); break;
    case 'confirm': body = scrConfirm(b); break;
    default: body = scrAccueil(b);
  }
  return band(buvette(b).nom, sousTitre()) + `<main class="wrap main">${body}</main>`;
}

// ---------- mise en place (Aurélien et préparation des palettes)
function scrMep() {
  if (!V.mepB || !CFG.buvettes.some(x => x.id === V.mepB)) { const nx = CFG.buvettes.find(x => !mepDe(x.id).faite); V.mepB = (nx || CFG.buvettes[0]).id; }
  const b = V.mepB, m = mepDe(b), br = mepBrouillon(b);
  let h = `<p class="muted">Une palette à la fois, dans l'ordre où tu les montes.</p><div class="chips-b">${CFG.buvettes.map(x => `<button class="cb ${x.id === b ? 'on' : ''}" data-a="mepb" data-b="${esc(x.id)}">${mepDe(x.id).faite ? '✓ ' : ''}${esc(x.court)}</button>`).join('')}</div>`;
  h += `<h1 class="h1">${esc(buvette(b).nom)}</h1>`;
  if (V.horsLigne) h += `<div class="note warn">Pas de réseau : tout est gardé sur ton téléphone et partira dès que ça capte.</div>`;
  h += m.faite ? `<p class="muted">${m.par ? 'Enregistrée à ' + esc(m.par.h) + '. ' : ''}${m.envoye ? 'Envoyée.' : 'Gardée sur le téléphone, en attente d\'envoi.'} Tu peux encore la corriger.</p>`
    : (m.repris ? `<div class="note gold">Repris de ${esc(m.repris)}. Corrige ce qui change, puis enregistre.</div>` : `<div class="note gold">Première mise en place de cette buvette : saisis tout, puis enregistre.</div>`);
  groups(b).forEach(([g, l]) => {
    h += `<h2 class="h2">${esc(g)}</h2>` + l.map(p => `<div class="card"><div class="card-h"><div><div class="pn">${esc(P(p).d)}</div><div class="pu">${esc(P(p).u)}</div></div>${stepper({ act: 'mst', data: `data-p="${esc(p)}"`, val: br.q[p] || 0, inKey: 'mep', label: 'Mise en place, ' + P(p).d })}</div>${lotBtn('mpack', `data-p="${esc(p)}"`, p)}</div>`).join('');
  });
  h += `<div class="actionbar">${err()}<button class="btn primary big" data-a="mepsave">Enregistrer ${esc(buvette(b).court)}</button></div>`;
  return h;
}
function prepaView() {
  return band('Préparation des palettes', sousTitre()) + `<main class="wrap main"><p class="muted">Ce lien sert seulement à noter la mise en place des buvettes.</p>${scrMep()}</main>`;
}

// ---------- vue d'Aurélien
function etat(b) {
  const f = ficheDe(b);
  if (f) return { cls: 'ok', txt: 'Validée ' + f.h + ' · ' + f.auteur + (f.v > 1 ? ' · v' + f.v : '') + (f.envoye ? '' : ' · en attente') };
  return { cls: 'bad', txt: 'Fiche pas encore validée' };
}
function scrSuivi() {
  const st = CFG.buvettes.map(b => etat(b.id)), nv = st.filter(s => s.cls === 'ok').length, n = CFG.buvettes.length;
  let h = `<p class="muted">${nv} ${nv > 1 ? 'fiches validées' : 'fiche validée'} sur ${n}</p>`;
  h += CFG.buvettes.map((b, i) => {
    const na = ajoutsDe(b.id).length, f = ficheDe(b.id), al = f ? alertes(b.id, f.c).length : 0, m = mepDe(b.id);
    return `<button class="srow" data-a="detail" data-b="${esc(b.id)}"><span class="sn">${esc(b.nom)}</span><span class="chips">
    <span class="chip ${m.faite ? 'ok' : 'bad'}">${m.faite ? 'Mise en place ✓' : 'Mise en place à faire'}</span>
    <span class="chip">${plural(na, 'ajout')}</span><span class="chip ${st[i].cls}">${esc(st[i].txt)}</span>
    ${al ? `<span class="chip warn">${plural(al, 'alerte')}</span>` : ''}</span></button>`;
  }).join('');
  h += `<button class="btn sm" data-a="refresh">Actualiser</button>`;
  return h;
}
function scrDetail(b) {
  const f = ficheDe(b), e = etat(b), m = mepDe(b), c = f ? f.c : {};
  let h = back('tab', 'data-t="suivi"', 'Retour au suivi') + `<h1 class="h1">${esc(buvette(b).nom)}</h1><p class="muted">${esc(e.txt)}</p>`;
  if (!m.faite) h += `<div class="note warn">Mise en place pas encore saisie : la consommation ne peut pas être calculée.</div>`;
  const al = f ? alertes(b, c).map(a => a.p) : [];
  h += `<div class="tw"><table><thead><tr><th>Produit</th><th>Mis</th><th>Ajouts</th><th>Reste</th><th>Ent.</th><th>Conso</th></tr></thead><tbody>`;
  liste(b).forEach(p => {
    const x = c[p], cs = m.faite ? conso(b, p, x) : null, t = SAISIE(P(p).t);
    h += `<tr class="${al.includes(p) ? 'al' : ''}"><td>${esc(P(p).d)}<span class="u">${esc(P(p).u)}</span></td><td>${m.faite && m.q ? (m.q[p] || 0) : '—'}</td><td>${ajSum(b, p)}</td>
    <td>${x && x.pl != null ? x.pl : '—'}</td><td>${t === 'P' ? '' : (x && x.pl != null ? (x.en || 0) : '—')}</td><td>${cs == null ? '—' : fmt(cs)}</td></tr>`;
  });
  h += `</tbody></table></div><p class="muted small">Conso = mis + ajouts − reste − entamés (fûts au niveau choisi, vins à moitié, softs comptés vides).</p>`;
  if (b === 'haras') {
    const loges = CFG.loges;
    h += `<h2 class="h2">Vins et champagne : salon ou loges</h2><p class="muted small">${loges} loges, 1 bouteille de chaque par loge. Le salon prend le reste.</p>`;
    h += `<div class="tw"><table><thead><tr><th>Produit</th><th>Conso</th><th>Loges</th><th>Salon</th></tr></thead><tbody>${liste(b).filter(p => (CFG.zones || {})[p] === 'Partagé').map(p => {
      const cs = m.faite ? conso(b, p, c[p]) : null;
      if (cs == null) return `<tr><td>${esc(P(p).d)}</td><td colspan="3">pas encore compté</td></tr>`;
      const l = Math.max(0, Math.min(cs, loges));
      return `<tr><td>${esc(P(p).d)}</td><td>${fmt(cs)}</td><td>${fmt(l)}</td><td>${fmt(cs - l)}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }
  h += `<button class="btn primary" data-a="corriger">${f ? 'Corriger cette fiche' : 'Remplir cette fiche'}</button><button class="btn" data-a="mepb" data-b="${esc(b)}" data-go="1">Voir sa mise en place</button>`;
  return h;
}
function scrReglages() {
  const r = V.reglage || { match: CFG.match.code, loges: CFG.loges };
  V.reglage = r;
  return `<h1 class="h1">Réglages</h1>
  <label class="field">Match en cours<select id="rg-match" data-in="rgmatch">${(CFG.matchs || []).map(m => `<option value="${esc(m.code)}" ${m.code === r.match ? 'selected' : ''}>${esc(m.affiche)} · ${esc(m.jour)}</option>`).join('')}</select></label>
  <p class="muted small">Changer de match ouvre des fiches vierges sur tous les téléphones. Fais-le avant la mise en place.</p>
  <div class="card"><div class="card-h"><div><div class="pn">Loges occupées au Haras</div><div class="pu">1 bouteille de rouge, de blanc et de champagne par loge</div></div>${stepper({ act: 'loges', data: '', val: r.loges, inKey: 'loges', label: 'Loges occupées' })}</div></div>
  ${err()}<button class="btn primary" data-a="rgsave">Enregistrer les réglages</button>`;
}
function adminView() {
  const on = t => V.tab === t || (t === 'suivi' && (V.tab === 'detail' || V.tab === 'corriger'));
  const tabs = `<nav class="tabs" aria-label="Sections">${[['suivi', 'Suivi'], ['mep', 'Mise en place'], ['reglages', 'Réglages']].map(([t, l]) => `<button class="tab ${on(t) ? 'on' : ''}" data-a="tab" data-t="${t}" aria-current="${on(t)}">${l}</button>`).join('')}</nav>`;
  let body;
  switch (V.tab) {
    case 'mep': body = scrMep(); break;
    case 'reglages': body = scrReglages(); break;
    case 'detail': body = scrDetail(V.detB); break;
    case 'corriger': body = scrComptage(V.detB, true); break;
    default: body = scrSuivi();
  }
  return band('Ta vue · Aurélien', sousTitre()) + `<main class="wrap main">${tabs}${body}</main>`;
}

function render() {
  const app = document.getElementById('app');
  let html;
  if (!ACCES) html = band('Fiches stock buvettes', '') + vide('Scanne le QR code de ta buvette', 'Le QR code est collé dans la buvette. Il ouvre directement ta fiche.');
  else if (V.erreurLien && !CFG) html = band('Fiches stock buvettes', '') + vide('Ce lien ne marche plus', 'Demande le bon QR code à Aurélien.');
  else if (!CFG) html = band('Fiches stock buvettes', '') + vide(V.horsLigne ? 'Pas de réseau' : 'Chargement…', 'La première ouverture a besoin de réseau. Ensuite, l\'appli marche même sans.', `<button class="btn" data-a="refresh">Réessayer</button>`);
  else if (CFG.role === 'admin') html = adminView();
  else if (CFG.role === 'prepa') html = prepaView();
  else html = buvetteView();
  if (!stockageOK) html += `<div class="wrap"><p class="err">Ce téléphone refuse de garder les données (navigation privée ?). Ouvre le lien dans une fenêtre normale.</p></div>`;
  app.innerHTML = html;
  if (V.focus) { const el = document.getElementById('card-' + V.focus); if (el) el.scrollIntoView({ block: 'center' }); V.focus = null; }
}
function rendre(force) { // un rafraîchissement automatique n'interrompt pas une saisie en cours
  const a = document.activeElement;
  if (!force && a && a.tagName === 'INPUT' && a.closest('#app')) { V.aRendre = true; const el = document.getElementById('pill'); if (el) el.outerHTML = pill(); return; }
  V.aRendre = false; render();
}
document.addEventListener('focusout', () => setTimeout(() => { const a = document.activeElement; if (V.aRendre && !(a && a.tagName === 'INPUT')) rendre(); }, 400));
function updateProgress(b, p) {
  const pr = progress(b), t = document.getElementById('prog'), bar = document.getElementById('progbar'), c = document.getElementById('card-' + p);
  if (t) t.textContent = progTxt(pr); if (bar) bar.style.width = (pr.n ? Math.round(pr.done / pr.n * 100) : 0) + '%'; if (c) c.classList.toggle('done', complete(b, p));
}
function waText(b) {
  const f = ficheDe(b), c = f ? f.c : brouillon(b).c;
  return ['Fiche stock · ' + buvette(b).nom, sousTitre(), '', ...liste(b).map(p => P(p).d + ' (' + P(p).u + ') : ' + fmtC(c[p], p)), '', 'Validée par ' + (f ? f.auteur : ET.prenom) + ' à ' + (f ? f.h : hDe(Date.now()))].join('\n');
}

// ---------- actions
function act(a, d) {
  V.err = null;
  const top = () => window.scrollTo(0, 0);
  const b = CFG && CFG.role === 'buvette' ? CFG.b : V.detB;
  switch (a) {
    case 'go': V.screen = d.s; V.aj = null; V.waText = null; render(); if (!V.focus) top(); break;
    case 'gomiss': V.screen = 'comptage'; V.focus = d.p; render(); break;
    case 'ajp': V.aj = { sw: false, q: { [d.p]: 0 } }; render(); top(); break;
    case 'ajsw': { const q = {}; liste(b).filter(p => P(p).t === 'sandwich').forEach(p => { q[p] = 0; }); V.aj = { sw: true, q }; render(); top(); break; }
    case 'ajq': V.aj.q[d.p] = Math.max(0, (V.aj.q[d.p] || 0) + (+d.d)); render(); break;
    case 'ajpack': V.aj.q[d.p] = (V.aj.q[d.p] || 0) + P(d.p).lot[0]; render(); break;
    case 'ajback': V.aj = null; render(); top(); break;
    case 'ajsave': {
      const items = {}; let tot = 0;
      Object.entries(V.aj.q).forEach(([p, q]) => { if (q > 0) { items[p] = q; tot += q; } });
      if (!tot) { V.err = 'Indique au moins une quantité.'; render(); break; }
      if (!ET.prenom.trim()) { V.err = 'Indique ton prénom.'; render(); break; }
      nouvelleSaisie('ajout', b, { items });
      V.aj = null; V.screen = 'accueil'; render(); top(); toast('Ajout enregistré'); break;
    }
    case 'st': { const c = ens(d.b, d.p), dd = +d.d; if (d.f === 'pl') c.pl = c.pl == null ? (dd > 0 ? 1 : 0) : Math.max(0, c.pl + dd); else { c.en = Math.max(0, (c.en || 0) + dd); fixNiv(c); } sauver(); render(); break; }
    case 'cpack': { const c = ens(d.b, d.p); c.pl = (c.pl || 0) + P(d.p).lot[0]; sauver(); render(); break; }
    case 'niv': { const c = ens(d.b, d.p); fixNiv(c); c.niv[+d.i] = +d.v; sauver(); render(); break; }
    case 'valider': {
      if (liste(b).some(p => !complete(b, p))) { V.err = 'Il manque des produits.'; render(); break; }
      if (alertes(b, brouillon(b).c).some(x => !V.conf[x.p])) { V.err = 'Recompte, ou coche les chiffres que tu confirmes.'; render(); break; }
      if (!ET.prenom.trim()) { V.err = 'Indique ton prénom.'; render(); break; }
      if (!peutModifier(b)) { V.err = 'Modification fermée : demande à Aurélien.'; render(); break; }
      const br = brouillon(b), avant = ficheDe(b);
      nouvelleSaisie('fiche', b, { c: clone(br.c) });
      br.modifie = false; br.base = (avant ? avant.v : 0) + 1; sauver();
      V.screen = 'confirm'; V.waText = null; V.conf = {}; render(); top(); break;
    }
    case 'wa': { const t = waText(b); V.waText = t; render(); try { navigator.clipboard.writeText(t).then(() => toast('Texte copié'), () => {}); } catch (e) { } break; }
    case 'tab': V.tab = d.t; if (d.t === 'reglages') V.reglage = null; render(); top(); break;
    case 'detail': V.tab = 'detail'; V.detB = d.b; render(); top(); break;
    case 'corriger': V.tab = 'corriger'; render(); top(); break;
    case 'corrsave': {
      if (liste(b).some(p => !complete(b, p))) { V.err = 'Il manque des produits : complète-les avant d\'enregistrer.'; render(); break; }
      const br = brouillon(b), avant = ficheDe(b);
      nouvelleSaisie('fiche', b, { c: clone(br.c) }, 'Aurélien (correction)');
      br.modifie = false; br.base = (avant ? avant.v : 0) + 1; sauver();
      V.tab = 'detail'; render(); top(); toast('Correction enregistrée'); break;
    }
    case 'mepb': V.mepB = d.b; if (d.go) V.tab = 'mep'; render(); top(); break;
    case 'mst': { const br = mepBrouillon(V.mepB); br.q[d.p] = Math.max(0, (br.q[d.p] || 0) + (+d.d)); br.modifie = true; sauver(); render(); break; }
    case 'mpack': { const br = mepBrouillon(V.mepB); br.q[d.p] = (br.q[d.p] || 0) + P(d.p).lot[0]; br.modifie = true; sauver(); render(); break; }
    case 'mepsave': {
      const br = mepBrouillon(V.mepB), nom = buvette(V.mepB).court;
      nouvelleSaisie('mep', V.mepB, { q: clone(br.q) });
      br.modifie = false; sauver();
      const nx = CFG.buvettes.find(x => !mepDe(x.id).faite);
      toast(nom + ' enregistré' + (nx ? ' · palette suivante : ' + nx.court : ''));
      if (nx) V.mepB = nx.id; render(); top(); break;
    }
    case 'loges': V.reglage.loges = Math.max(0, (V.reglage.loges || 0) + (+d.d)); render(); break;
    case 'rgsave': nouvelleSaisie('reglage', '', { match: V.reglage.match, loges: V.reglage.loges }); toast('Réglages envoyés'); V.tab = 'suivi'; render(); top(); break;
    case 'refresh': rafraichir(); envoyer(); toast('Actualisation…'); break;
  }
}
document.addEventListener('click', e => { const t = e.target.closest('[data-a]'); if (!t) return; act(t.dataset.a, t.dataset); });
document.addEventListener('input', e => {
  const t = e.target, k = t.dataset.in; if (!k) return;
  const n = Math.max(0, parseInt(t.value, 10) || 0);
  if (k === 'prenom') { ET.prenom = t.value; sauver(); return; }
  if (k === 'cpt' && t.dataset.f === 'pl') { const c = ens(t.dataset.b, t.dataset.p); c.pl = t.value === '' ? null : n; sauver(); updateProgress(t.dataset.b, t.dataset.p); return; }
  if (k === 'mep') { const br = mepBrouillon(V.mepB); br.q[t.dataset.p] = n; br.modifie = true; sauver(); return; }
  if (k === 'ajq') { V.aj.q[t.dataset.p] = n; const tt = document.getElementById('ajtot'); if (tt) tt.textContent = plural(Object.values(V.aj.q).reduce((x, y) => x + (y || 0), 0), 'sandwich'); return; }
  if (k === 'loges') { V.reglage.loges = n; return; }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.in === 'conf') { V.conf[t.dataset.p] = t.checked; return; }
  if (t.dataset.in === 'rgmatch') { V.reglage.match = t.value; return; }
  if (t.dataset.in === 'cpt' && t.dataset.f === 'en') { const c = ens(t.dataset.b, t.dataset.p); c.en = Math.max(0, parseInt(t.value, 10) || 0); fixNiv(c); sauver(); render(); }
});

render();
if (ACCES) { rafraichir(); envoyer(); }
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => { });
