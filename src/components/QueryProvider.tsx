"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Capa de datos del CRM · `D1`.
 *
 * Cada pantalla traía su propio `useState` + `useEffect` + testigo de petición
 * para lo mismo: pedir, mostrar "Cargando…", capturar el error y evitar que una
 * respuesta lenta pisara a una más nueva. Esa última parte estaba escrita a mano
 * cuatro veces —Clientes, Ventas, Cotizaciones y la bandeja— porque el defecto
 * aparecía siempre igual: escribir "mar" y que su respuesta llegara después de
 * la de "maría", dejando la lista sin corresponder con lo escrito.
 *
 * Clientes es el piloto; el resto migra al tocarlo.
 *
 * `QueryClient` en estado y no como constante de módulo: en el servidor, una
 * sola instancia compartida mezclaría la caché de dos personas distintas.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            /**
             * Diez segundos de datos "frescos".
             *
             * Es lo que tarda el equipo en volver de un expediente al tablero:
             * dentro de esa ventana se pinta desde la caché y no se vuelve a
             * pedir. Pasada, se refresca en segundo plano mostrando lo viejo,
             * así que la pantalla nunca queda en blanco.
             */
            staleTime: 10_000,
            /**
             * Un solo reintento.
             *
             * Los tres por defecto convierten un API caído en doce segundos de
             * espera antes de mostrar el error, y acá el error explica qué pasó
             * y ofrece reintentar a mano.
             */
            retry: 1,
            /**
             * Sin refetch al volver a la pestaña.
             *
             * El CRM se usa con varias pestañas abiertas todo el día; refrescar
             * en cada cambio de foco multiplica las peticiones sin que el dato
             * haya cambiado. Lo que sí necesita estar al día —la bandeja— tiene
             * su propio sondeo.
             */
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
