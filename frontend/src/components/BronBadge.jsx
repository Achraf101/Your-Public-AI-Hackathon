import { bronBadgeType } from '../labels'

// Maakt expliciet zichtbaar wat automatisch opgehaald is (Live: VKBO/Google
// Places) versus wat een ambtenaar zelf toevoegde (Handmatig, bv. een
// NBB-jaarrekeningcontrole). Nooit stilzwijgend vermengen.
export default function BronBadge ({ bron }) {
  const type = bronBadgeType(bron)
  return (
    <span className={`badge badge--bron badge--bron-${type}`} title={`Bron: ${bron}`}>
      {type === 'live' ? 'Live' : type === 'demo' ? 'Demo' : 'Handmatig'}
    </span>
  )
}
