import { ZEKERHEID_KLEUR } from '../labels'

export default function ZekerheidBadge ({ zekerheid }) {
  const kleur = ZEKERHEID_KLEUR[zekerheid] ?? { tekst: '#555', achtergrond: '#eee', rand: '#ccc' }
  return (
    <span
      className="badge"
      style={{ color: kleur.tekst, background: kleur.achtergrond, borderColor: kleur.rand }}
    >
      {zekerheid ?? 'Onbekend'}
    </span>
  )
}
