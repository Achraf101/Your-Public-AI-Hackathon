export default function KpiKaart ({ label, waarde, toelichting, accent }) {
  return (
    <div className="kpi-kaart" style={accent ? { borderTopColor: accent } : undefined}>
      <div className="kpi-kaart__waarde">{waarde}</div>
      <div className="kpi-kaart__label">{label}</div>
      {toelichting && <div className="kpi-kaart__toelichting">{toelichting}</div>}
    </div>
  )
}
