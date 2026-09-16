import { STATUS_LABEL } from '../labels'

export default function StatusBadge ({ status }) {
  if (!status) return <span className="badge badge--neutraal">—</span>
  return <span className={`badge badge--status badge--status-${status}`}>{STATUS_LABEL[status] ?? status}</span>
}
