import { AudioLines } from "lucide-react";

export function Brand({ compact = false }: { compact?: boolean }) {
  return <div className="brand"><span className="brand-mark"><AudioLines size={23} strokeWidth={1.8} aria-hidden="true" /></span>{!compact && <span>Interview<span className="brand-light">Win</span><small>LIVE INTERVIEWS</small></span>}</div>;
}
