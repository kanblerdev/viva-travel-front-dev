"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import {
  formatMoney,
  isFollowUpOverdue,
  relativeTime,
  type ClientSummary,
  type PipelineStage,
} from "@/lib/api/crm";
import {
  CHANNEL_LABEL,
  PIPELINE_STAGE_COLOR,
  SOURCE_CHANNEL_LABEL,
  stageLabel,
  type SourceChannel,
} from "@/lib/domain/enums";
import { KANBAN_PAGE_SIZE, type StageBucket } from "./useClientsData";

const CHANNEL_CLASS: Record<SourceChannel, string> = {
  whatsapp: "wa",
  messenger: "ms",
  instagram: "ig",
  other: "",
};

type Props = {
  stages: PipelineStage[];
  /** Una tanda cargada por etapa. El total de cada una está en `counts`. */
  board: Record<string, StageBucket>;
  counts: Record<string, number>;
  /** Devuelve false si el movimiento se rechazó, para revertir el optimismo. */
  onMove: (clientId: string, stageId: string) => Promise<boolean>;
  onLoadMore: (stageId: string) => void;
  onRequestLost: (client: ClientSummary) => void;
};

export function KanbanBoard({
  stages,
  board,
  counts,
  onMove,
  onLoadMore,
  onRequestLost,
}: Props) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [hoverStage, setHoverStage] = useState<string | null>(null);
  /** Etapa provisional mientras el backend confirma, para que la tarjeta no salte. */
  const [optimistic, setOptimistic] = useState<Record<string, string>>({});
  /** Tarjeta con el menú abierto. Solo una a la vez. */
  const [menuFor, setMenuFor] = useState<string | null>(null);

  /**
   * Todas las fichas cargadas, sin repetir.
   *
   * Se aplanan las tandas de las columnas porque una ficha movida a mano vive,
   * por un instante, en la tanda de su etapa vieja: si cada columna dibujara
   * solo su propia tanda, la tarjeta desaparecería hasta la próxima recarga.
   */
  const cards = useMemo(() => {
    const seen = new Set<string>();
    return Object.values(board).flatMap((bucket) =>
      bucket.items.filter((client) => {
        if (seen.has(client.id)) return false;
        seen.add(client.id);
        return true;
      }),
    );
  }, [board]);

  const stageOf = (client: ClientSummary) =>
    optimistic[client.id] ?? client.pipelineStageId;

  /**
   * Mueve una ficha de etapa.
   *
   * Es el único camino: lo usan tanto el arrastre como el menú de la tarjeta, así
   * que las dos vías se comportan igual y no hay una segunda copia de la regla de
   * la etapa terminal.
   */
  async function moveTo(client: ClientSummary, stage: PipelineStage) {
    setMenuFor(null);
    if (stageOf(client) === stage.id) return;

    // Descartar exige motivo: el backend rechaza el movimiento directo, así que
    // en vez de provocar un error se abre el modal (HU-CLI-05).
    if (stage.isTerminal) {
      onRequestLost(client);
      return;
    }

    setOptimistic((prev) => ({ ...prev, [client.id]: stage.id }));
    try {
      await onMove(client.id, stage.id);
    } finally {
      // Se limpia SIEMPRE, no solo cuando el backend rechaza. Si el movimiento
      // salió bien, el padre ya reemplazó la ficha con su etapa real antes de
      // resolver, así que soltar la entrada no mueve nada en pantalla.
      //
      // Conservarla sí rompía: la entrada quedaba viva toda la sesión y le ganaba
      // al dato real. Al descartar después esa misma tarjeta desde el modal, la
      // ficha se quedaba dibujada en su etapa vieja mientras el contador de
      // "Perdido" —que viene del backend— ya la contaba. Dos verdades distintas
      // en la misma pantalla, y solo se arreglaba recargando.
      setOptimistic((prev) => {
        const next = { ...prev };
        delete next[client.id];
        return next;
      });
    }
  }

  async function handleDrop(stage: PipelineStage) {
    const clientId = dragging;
    setDragging(null);
    setHoverStage(null);
    if (!clientId) return;

    const client = cards.find((c) => c.id === clientId);
    if (client) await moveTo(client, stage);
  }

  return (
    <div className="kanban">
      {stages.map((stage) => {
        const columnCards = cards.filter((c) => stageOf(c) === stage.id);
        const isHovered = hoverStage === stage.id;
        const bucket = board[stage.id];
        const total = counts[stage.id] ?? 0;
        // Cuántas quedan por traer de esta columna. El total sale del backend, no
        // de contar lo cargado: es la diferencia la que hay que poder alcanzar.
        const remaining = Math.max(0, total - columnCards.length);

        return (
          <div
            key={stage.id}
            className={`col${isHovered ? " is-drop-target" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setHoverStage(stage.id);
            }}
            onDragLeave={() => setHoverStage((prev) => (prev === stage.id ? null : prev))}
            onDrop={() => void handleDrop(stage)}
          >
            <div className="col-h">
              <div className="ttl">
                <span
                  className="swatch"
                  style={{
                    background: PIPELINE_STAGE_COLOR[stage.code]?.swatch ?? "var(--text-faint)",
                  }}
                />
                {stageLabel(stage)}
                <span className="pill">{counts[stage.id] ?? 0}</span>
              </div>
            </div>

            <div className="col-body">
              {isHovered && dragging && (
                <div className="drop-hint">Soltar aquí para mover</div>
              )}

              {columnCards.map((client) => (
                <OpportunityCard
                  key={client.id}
                  client={client}
                  stages={stages}
                  currentStageId={stageOf(client)}
                  isDragging={dragging === client.id}
                  menuOpen={menuFor === client.id}
                  onToggleMenu={() =>
                    setMenuFor((prev) => (prev === client.id ? null : client.id))
                  }
                  onCloseMenu={() => setMenuFor(null)}
                  onMoveTo={(target) => void moveTo(client, target)}
                  onDragStart={() => setDragging(client.id)}
                  onDragEnd={() => {
                    setDragging(null);
                    setHoverStage(null);
                  }}
                />
              ))}

              {columnCards.length === 0 && !isHovered && (
                <div className="col-empty">Sin oportunidades</div>
              )}

              {remaining > 0 && (
                <button
                  type="button"
                  className="col-more"
                  disabled={bucket?.loadingMore}
                  onClick={() => onLoadMore(stage.id)}
                >
                  {bucket?.loadingMore
                    ? "Cargando…"
                    : `Cargar ${Math.min(remaining, KANBAN_PAGE_SIZE)} más · quedan ${remaining}`}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OpportunityCard({
  client,
  stages,
  currentStageId,
  isDragging,
  menuOpen,
  onToggleMenu,
  onCloseMenu,
  onMoveTo,
  onDragStart,
  onDragEnd,
}: {
  client: ClientSummary;
  stages: PipelineStage[];
  currentStageId: string;
  isDragging: boolean;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onMoveTo: (stage: PipelineStage) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const unassigned = !client.advisor;
  const overdue = isFollowUpOverdue(client.nextFollowUpAt);
  const menuRef = useRef<HTMLDivElement>(null);

  // Escape cierra y devuelve el foco al botón, como cualquier menú del sistema.
  useEffect(() => {
    if (!menuOpen) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseMenu();
    };
    const onClickOutside = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onCloseMenu();
    };

    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClickOutside);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClickOutside);
    };
  }, [menuOpen, onCloseMenu]);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`kcard${unassigned ? " is-unassigned" : ""}${isDragging ? " is-dragging" : ""}`}
    >
      <div className="kcard-head">
        <Link
          href={`/clientes/${client.id}`}
          className="name"
          style={{ color: "inherit", textDecoration: "none" }}
        >
          {client.fullName}
          {/* HU-CLI-10: el aviso donde se trabaja, no solo dentro del expediente. */}
          {client.duplicateCount ? (
            <span className="chip amber duplicate-chip" title="Otro expediente coincide por teléfono, correo o nombre">
              Posible duplicado
            </span>
          ) : null}
        </Link>

        <div className="kcard-actions">
          {client.sourceChannel !== "other" && (
            <span className={`chip ${CHANNEL_CLASS[client.sourceChannel]}`}>
              {CHANNEL_LABEL[client.sourceChannel as keyof typeof CHANNEL_LABEL] ??
                SOURCE_CHANNEL_LABEL[client.sourceChannel]}
            </span>
          )}

          {/*
            El arrastre es un acelerador, no el único camino.

            Los eventos de arrastre HTML5 no se disparan en pantallas táctiles ni
            con teclado, así que sin este menú la acción central del tablero no
            existía en celular ni para quien no usa mouse.
          */}
          <div className="kcard-menu" ref={menuRef}>
            <button
              type="button"
              className="iconbtn tiny"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={`Acciones de ${client.fullName}`}
              onClick={onToggleMenu}
            >
              <Icon name="dots" />
            </button>

            {menuOpen && (
              <div className="kcard-menu-list" role="menu">
                <div className="kcard-menu-title">Mover a</div>
                {stages
                  .filter((stage) => stage.id !== currentStageId)
                  .map((stage) => (
                    <button
                      key={stage.id}
                      type="button"
                      role="menuitem"
                      className={stage.isTerminal ? "is-terminal" : undefined}
                      onClick={() => onMoveTo(stage)}
                    >
                      <span
                        className="swatch"
                        style={{
                          background:
                            PIPELINE_STAGE_COLOR[stage.code]?.swatch ?? "var(--text-faint)",
                        }}
                      />
                      {stageLabel(stage)}
                    </button>
                  ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="trip">
        {client.destinations.length > 0 ? client.destinations.join(" · ") : "Sin destino"}
      </div>

      {client.estimatedValue && (
        <div className="price">
          {formatMoney(client.estimatedValue)}{" "}
          <span style={{ color: "var(--text-mute)", fontWeight: 500, fontSize: 11 }}>
            USD
          </span>
        </div>
      )}

      {overdue && (
        <div className="alert">
          <Icon name="target" />
          Seguimiento vencido
        </div>
      )}

      <div className="foot" style={{ marginTop: 10 }}>
        {client.advisor ? (
          <span className="who">
            <span className="av">{client.advisor.initials}</span>
            {client.advisor.fullName}
          </span>
        ) : (
          <span className="chip amber">Sin asignar</span>
        )}
        <span className="date">{relativeTime(client.lastContactAt)}</span>
      </div>
    </div>
  );
}
