// ============================================================================
// Normalisatie van ruwe VKBO-velden, aan de kant van de applicatie.
// ----------------------------------------------------------------------------
// Twee eigenaardigheden van de bron (zie ook vkbo_tekst()/vkbo_is_echte_datum()
// in supabase/migrations/20260916120000_vkbo_helpers.sql):
//   1. "leeg" is in VKBO een string met een spatie (" "), niet NULL en niet "".
//   2. datums gebruiken placeholders: 1900-01-01 en 9999-12-31.
//
// tekst()/datumDeel() gebeuren hier in JS omdat we de classificatie
// (onderneming vs. vestiging) al moeten kennen VOORDAT er iets naar de
// database gaat. adres_gevalideerd en is_vme worden bewust NIET hier
// herberekend: die blijven in de database (GENERATED kolom / trigger), zodat
// er maar één plek is die bepaalt wat "gevalideerd" of "VME" betekent. Zie
// database.js.
// ============================================================================

/** Trimt en zet " " / "" om naar null. Mirror van SQL vkbo_tekst(). */
export function tekst (waarde) {
  if (waarde === null || waarde === undefined) return null
  const t = String(waarde).trim()
  return t === '' ? null : t
}

/**
 * Pakt het datumgedeelte (YYYY-MM-DD) uit een VKBO-tijdstempel zoals
 * "1900-01-01T00:00:00Z". Placeholder-datums worden NIET weggefilterd: die
 * blijven bewaard in enterprises.datum_stopzetting, precies zoals de
 * database ze ook opslaat. is_gestopt (GENERATED) filtert ze er pas achteraf uit.
 */
export function datumDeel (waarde) {
  const t = tekst(waarde)
  return t ? t.slice(0, 10) : null
}

/**
 * Classificeert één VKBO-rij als 'enterprise' of 'establishment', volgens de
 * regel uit de opdracht: een rij is een onderneming als Type_onderneming
 * 'Rechtspersoon' is, OF als Ondernemingsnr_maatsch_zetel leeg is. Anders is
 * het een vestiging.
 *
 * In de praktijk (gecontroleerd op de Schoten-steekproef) zijn dit twee
 * disjuncte groepen: onderneming-rijen dragen Rechtsvorm/Rechtstoestand en
 * hebben geen zetelnummer; vestigingsrijen dragen een zetelnummer en nooit een
 * Rechtsvorm.
 */
export function classificeer (properties) {
  const type = tekst(properties.Type_onderneming)
  const zetelnr = tekst(properties.Ondernemingsnr_maatsch_zetel)
  const isOnderneming = type === 'Rechtspersoon' || zetelnr === null
  return isOnderneming ? 'enterprise' : 'establishment'
}
