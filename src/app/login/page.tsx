import Image from "next/image";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <div className="login-wrap">
      <div className="login-art">
        <div style={{ position: "relative", zIndex: 2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <Image
              src="/assets/viva-logo.png"
              alt="Viva Travel"
              width={80}
              height={80}
              style={{ height: 80, width: "auto" }}
              priority
            />
            <div style={{ lineHeight: 1 }}>
              <div style={{ fontSize: 30, fontWeight: 800, color: "#fff", letterSpacing: "0.04em" }}>
                VIVA TRAVEL
              </div>
              <div style={{ fontSize: 14, color: "#8FA3C9", fontWeight: 600, letterSpacing: "0.28em", marginTop: 6 }}>
                EL SALVADOR
              </div>
            </div>
          </div>
        </div>

        <div style={{ position: "relative", zIndex: 2 }}>
          <div style={{ fontSize: 18, color: "#8FA3C9", fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 20 }}>
            CRM Comercial Integral
          </div>
          <div style={{ fontSize: 60, fontWeight: 800, color: "#fff", lineHeight: 1.05, letterSpacing: "-0.02em" }}>
            Tu agencia, ordenada de extremo a extremo.
          </div>
          <div style={{ fontSize: 22, color: "#C7D3EA", lineHeight: 1.5, marginTop: 28, maxWidth: 580 }}>
            Centraliza clientes, cotizaciones, ventas y proveedores en un solo sistema interno diseñado para Viva Travel.
          </div>
        </div>

        <div style={{ position: "relative", zIndex: 2, display: "flex", gap: 36, color: "#8FA3C9", fontSize: 14 }}>
          <div>
            <div style={{ fontSize: 28, color: "#fff", fontWeight: 800 }}>120+</div>
            oportunidades activas
          </div>
          <div>
            <div style={{ fontSize: 28, color: "#fff", fontWeight: 800 }}>8</div>
            asesores en línea
          </div>
          <div>
            <div style={{ fontSize: 28, color: "#fff", fontWeight: 800 }}>24/7</div>
            acceso seguro
          </div>
        </div>
      </div>

      <div className="login-form-area">
        <LoginForm />
      </div>
    </div>
  );
}
