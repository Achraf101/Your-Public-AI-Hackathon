import { ZEKERHEID_KLEUR, bandVanPercentage } from '../labels'

/**
 * Toont de kans dat een zaak echt actief is als percentage, met de band
 * (Hoog/Middel/Laag) als kleur en klein bijschrift. Het getal staat voorop:
 * 70% en 95% zijn allebei "Hoog", maar vragen een andere reactie.
 *
 * Valt terug op alleen de band als er nog geen percentage is (oudere rijen).
 *
 * @param {number|null} percentage - 0-100, of null
 * @param {string|null} zekerheid - Hoog/Middel/Laag, terugval als percentage ontbreekt
 * @param {boolean} [compact] - alleen het percentage, zonder bandwoord (voor tabellen)
 */
export default function ZekerheidBadge ({ percentage, zekerheid, compact = false }) {
  const band = bandVanPercentage(percentage) ?? zekerheid
  const kleur = ZEKERHEID_KLEUR[band] ?? { tekst: '#555', achtergrond: '#eee', rand: '#ccc' }
  const heeftPercentage = typeof percentage === 'number'

  return (
    <span
      className="badge badge--zekerheid"
      style={{ color: kleur.tekst, background: kleur.achtergrond, borderColor: kleur.rand }}
      title={heeftPercentage
        ? `${percentage}% kans dat deze zaak echt actief is op dit adres (band: ${band})`
        : 'Nog niet beoordeeld'}
    >
      {heeftPercentage
        ? (
          <>
            <strong className="badge__cijfer">{percentage}%</strong>
            {!compact && <span className="badge__band">{band}</span>}
          </>
          )
        : (band ?? 'Onbekend')}
    </span>
  )
}

/**
 * Percentage met een balkje erbij — voor plekken waar één beoordeling centraal
 * staat (detailpagina, reviewkaart) en er ruimte is om de kans ook visueel te
 * tonen.
 */
export function ZekerheidMeter ({ percentage, zekerheid }) {
  const band = bandVanPercentage(percentage) ?? zekerheid
  const kleur = ZEKERHEID_KLEUR[band] ?? { tekst: '#555', achtergrond: '#eee', rand: '#ccc' }
  if (typeof percentage !== 'number') return <ZekerheidBadge percentage={percentage} zekerheid={zekerheid} />

  return (
    <span className="zekerheid-meter">
      <span className="zekerheid-meter__cijfer" style={{ color: kleur.tekst }}>{percentage}%</span>
      <span className="zekerheid-meter__balk" aria-hidden="true">
        <span
          className="zekerheid-meter__vulling"
          style={{ width: `${percentage}%`, background: kleur.tekst }}
        />
      </span>
      <span className="zekerheid-meter__label">kans dat deze zaak echt actief is · {band}</span>
    </span>
  )
}
