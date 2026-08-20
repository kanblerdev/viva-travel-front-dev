import { Topbar } from "@/components/Topbar";
import { Icon } from "@/components/Icon";

const FUNNEL = [
  { label: "Prospectos", value: 182, h: 110, gradient: "linear-gradient(180deg, var(--blue), #5790E5)" },
  { label: "Contactados", value: 128, h: 92, gradient: "linear-gradient(180deg, var(--amber), #E5A52A)" },
  { label: "Cotizados", value: 64, h: 72, gradient: "linear-gradient(180deg, var(--orange), #F58359)" },
  { label: "En negociación", value: 28, h: 56, gradient: "linear-gradient(180deg, var(--purple), #8E72F5)" },
  { label: "Ganadas", value: 14, h: 38, gradient: "linear-gradient(180deg, var(--green), #4FCB95)" },
];

export default function ReportesPage() {
  return (
    <>
      <Topbar
        crumbs={[{ label: "CRM" }, { label: "Reportes", current: true }]}
      />
      <div className="pagebody">
        <div className="page-h">
          <div>
            <h1>Reportes comerciales</h1>
            <div className="sub">Vista analítica con cortes por período, asesor y destino.</div>
          </div>
          <div className="actions">
            <span className="chip" style={{ background: "var(--white)", border: "1px solid var(--border)", color: "var(--text)", padding: "8px 14px", fontSize: 12 }}>
              <Icon name="calendar" width={14} height={14} style={{ color: "var(--text-mute)" }} />
              Últimos 6 meses
            </span>
            <button className="btn ghost"><Icon name="download" />Excel</button>
            <button className="btn primary"><Icon name="download" />PDF</button>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Embudo de conversión</div>
              <div style={{ fontSize: 12, color: "var(--text-mute)", marginTop: 2 }}>
                Prospectos hasta ventas cerradas · Mayo 2025
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <span className="chip orange">Mensual</span>
              <span className="chip">Trimestral</span>
              <span className="chip">Anual</span>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 12 }}>
            {FUNNEL.map((f) => (
              <div key={f.label} style={{ textAlign: "center" }}>
                <div
                  style={{
                    height: f.h,
                    background: f.gradient,
                    borderRadius: 8,
                    display: "grid",
                    placeItems: "end center",
                    paddingBottom: f.h < 50 ? 6 : 10,
                  }}
                >
                  <div style={{ color: "#fff", fontSize: f.h < 50 ? 20 : 22, fontWeight: 800 }}>{f.value}</div>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-mute)", marginTop: 8, fontWeight: 600 }}>{f.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
          <div className="card">
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Tendencia de conversión</div>
            <svg viewBox="0 0 640 200" style={{ width: "100%", height: 180 }} preserveAspectRatio="none">
              <defs>
                <linearGradient id="lrep1" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#1FAE6E" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="#1FAE6E" stopOpacity="0" />
                </linearGradient>
                <linearGradient id="lrep2" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#EF5921" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="#EF5921" stopOpacity="0" />
                </linearGradient>
              </defs>
              <g stroke="#EFF1F5" strokeWidth="1">
                <line x1="0" y1="40" x2="640" y2="40" />
                <line x1="0" y1="90" x2="640" y2="90" />
                <line x1="0" y1="140" x2="640" y2="140" />
              </g>
              <path d="M0,150 L107,140 L214,130 L320,110 L427,95 L534,80 L640,60 L640,200 L0,200 Z" fill="url(#lrep2)" />
              <polyline points="0,150 107,140 214,130 320,110 427,95 534,80 640,60" fill="none" stroke="#EF5921" strokeWidth="2.5" />
              <polyline points="0,110 107,100 214,80 320,90 427,55 534,45 640,30" fill="none" stroke="#1FAE6E" strokeWidth="2.5" strokeDasharray="4 4" />
            </svg>
            <div style={{ display: "flex", gap: 18, fontSize: 11, marginTop: 8, color: "var(--text-mute)", flexWrap: "wrap" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 12, height: 2, background: "var(--orange)" }} />
                Cotizaciones enviadas
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 12, height: 2, background: "var(--green)" }} />
                Ventas cerradas
              </span>
            </div>
          </div>

          <div className="card">
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Distribución por tipo de viaje</div>
            <div style={{ display: "grid", gridTemplateColumns: "130px 1fr", gap: 16, alignItems: "center" }}>
              <svg viewBox="0 0 42 42" style={{ width: 130, height: 130, transform: "rotate(-90deg)" }}>
                <circle cx="21" cy="21" r="15.915" fill="none" stroke="#EFF1F5" strokeWidth="6" />
                <circle cx="21" cy="21" r="15.915" fill="none" stroke="#EF5921" strokeWidth="6" strokeDasharray="42 58" strokeDashoffset="0" />
                <circle cx="21" cy="21" r="15.915" fill="none" stroke="#2A6FDB" strokeWidth="6" strokeDasharray="28 72" strokeDashoffset="-42" />
                <circle cx="21" cy="21" r="15.915" fill="none" stroke="#6B4CE5" strokeWidth="6" strokeDasharray="18 82" strokeDashoffset="-70" />
                <circle cx="21" cy="21" r="15.915" fill="none" stroke="#1FAE6E" strokeWidth="6" strokeDasharray="12 88" strokeDashoffset="-88" />
              </svg>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 12 }}>
                <Legend swatch="var(--orange)" label="Placer" pct="42%" />
                <Legend swatch="var(--blue)" label="Familiar" pct="28%" />
                <Legend swatch="var(--purple)" label="Honeymoon" pct="18%" />
                <Legend swatch="var(--green)" label="Corporativo" pct="12%" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Legend({ swatch, label, pct }: { swatch: string; label: string; pct: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ width: 10, height: 10, background: swatch, borderRadius: 2 }} />
      {label}
      <span style={{ marginLeft: "auto", fontWeight: 700 }}>{pct}</span>
    </div>
  );
}
