# Viva Travel CRM — Frontend

CRM comercial de Viva Travel El Salvador. Es la aplicación que usan asesores y
gerentes para gestionar clientes, cotizaciones y ventas.

- **Stack:** Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS · Firebase Auth
- **Puerto por defecto:** `3000`

## Proyectos relacionados

| Proyecto | Repositorio | Puerto |
|---|---|---|
| API | `viva-travel-back-dev` | 4000 |
| Panel administrativo | `viva-travel-admin-dev` | 3001 |

Cada proyecto se despliega y versiona de forma independiente.

## Puesta en marcha

```bash
npm install
cp .env.example .env.local   # completar los valores
npm run dev                  # http://localhost:3000
```

El backend (`viva-travel-back-dev`) debe estar corriendo en el puerto 4000 para
que la aplicación tenga datos.

## Scripts

| Script | Descripción |
|---|---|
| `npm run dev` | Servidor de desarrollo en el puerto 3000 |
| `npm run build` | Build de producción |
| `npm start` | Sirve el build de producción |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |

> No ejecutes `npm run build` con el servidor de desarrollo levantado: ambos
> escriben sobre `.next/` y se corrompen entre sí.

## Variables de entorno

Se documentan en `.env.example`. Todas las variables del frontend usan el prefijo
`NEXT_PUBLIC_` y por lo tanto **son públicas**: nunca pongas aquí un secreto.
Los secretos viven solo en el backend.

## Estructura

```
src/
├── app/
│   ├── (app)/        rutas autenticadas del CRM
│   └── login/        autenticación
├── components/       componentes compartidos de UI
└── lib/
    ├── api/          cliente HTTP hacia el backend
    ├── auth/         sesión y control de acceso
    ├── domain/       tipos y enums del dominio
    ├── firebase/     inicialización del SDK cliente
    └── hooks/        hooks de React
```

Los enums de dominio están duplicados a mano respecto del backend: si cambias uno
allá, actualízalo también en `src/lib/domain/`.
