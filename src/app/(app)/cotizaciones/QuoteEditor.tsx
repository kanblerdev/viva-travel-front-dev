"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { ApiError } from "@/lib/api/client";
import { useSession } from "@/lib/auth/AuthProvider";
import {
  crmApi,
  formatMoney,
  type ClientSummary,
  type QuoteDetail,
  type QuoteInput,
  type QuoteUpdateInput,
  type Supplier,
  type TeamMember,
} from "@/lib/api/crm";
import { ClientPicker } from "@/components/ClientPicker";
import {
  COMMISSION_MODES,
  COMMISSION_MODE_LABEL,
  QUOTE_TYPES,
  QUOTE_TYPE_LABEL,
  SERVICE_TYPES,
  SERVICE_TYPE_LABEL,
  type CommissionMode,
  type QuoteType,
  type ServiceType,
} from "@/lib/domain/enums";
import {
  commissionAmount,
  fromCents,
  isValidAmount,
  toCents,
} from "@/lib/domain/money";

type LineDraft = {
  serviceType: ServiceType;
  supplierId: string;
  description: string;
  /**
   * Fechas del servicio · hallazgo C6.
   *
   * El esquema, el DTO y el PDF siempre las soportaron —el PDF incluso las
   * imprime cuando están—, pero el editor no las exponía: un itinerario de siete
   * días se entregaba sin la fecha de cada servicio.
   */
  startDate: string;
  endDate: string;
};

/**
 * Imagen del anexo del PDF.
 *
 * Las nuevas viven como `File` hasta que se guarda la cotización: subirlas al
 * elegirlas dejaría archivos huérfanos en el expediente cada vez que alguien
 * abandona el formulario, y no existe un endpoint para borrarlos.
 */
type AnnexDraft = {
  /** Clave local estable, para React y el mapa de vistas previas. */
  key: string;
  /** Id del archivo en el servidor; vacío mientras está pendiente de subir. */
  id: string;
  /** Pendiente de subir al guardar. `null` cuando ya vive en el servidor. */
  file: File | null;
  name: string;
};

/** Espejo de QUOTE_ANNEX_LIMITS del backend, que vuelve a validar al guardar. */
const ANNEX_MAX_IMAGES = 6;
const ANNEX_MIME_TYPES = ["image/jpeg", "image/png"];
const ANNEX_MAX_BYTES = 10 * 1024 * 1024;

type Draft = {
  clientId: string;
  /**
   * Sucursal de origen PARA EL EXPEDIENTE · solo cuando el cliente aún no la
   * tiene (prospectos de Meta). Se guarda en el cliente, no en la cotización.
   */
  branchId: string;
  /** Vacío = quien cotiza. Solo Gerente y Administrador eligen a otro. */
  advisorId: string;
  quoteType: QuoteType;
  supplierAgencyId: string;
  destination: string;
  startDate: string;
  endDate: string;
  adults: number;
  children: number;
  serviceLines: LineDraft[];
  proposalDescription: string;
  includes: string;
  excludes: string;
  finalPrice: string;
  managementMode: CommissionMode;
  managementValue: string;
  agencyMode: CommissionMode;
  agencyValue: string;
  conditions: string;
  clientNotes: string;
  internalNotes: string;
  annexImages: AnnexDraft[];
  validUntil: string;
};

const isoDate = (value: string) => value.slice(0, 10);

function emptyDraft(clientId: string): Draft {
  const today = new Date();
  const start = new Date(today.getTime() + 30 * 86_400_000);
  const end = new Date(today.getTime() + 37 * 86_400_000);

  return {
    clientId,
    branchId: "",
    advisorId: "",
    quoteType: "own_package",
    supplierAgencyId: "",
    destination: "",
    startDate: isoDate(start.toISOString()),
    endDate: isoDate(end.toISOString()),
    adults: 2,
    children: 0,
    serviceLines: [
      { serviceType: "flight", supplierId: "", description: "", startDate: "", endDate: "" },
    ],
    proposalDescription: "",
    includes: "",
    excludes: "",
    finalPrice: "",
    managementMode: "percentage",
    managementValue: "10",
    agencyMode: "percentage",
    agencyValue: "",
    conditions: "",
    clientNotes: "",
    internalNotes: "",
    annexImages: [],
    validUntil: "",
  };
}

function draftFromQuote(quote: QuoteDetail): Draft {
  const version = quote.currentVersion;
  return {
    clientId: quote.client?.id ?? "",
    branchId: "",
    advisorId: quote.advisor?.id ?? "",
    quoteType: quote.quoteType,
    supplierAgencyId: quote.supplierAgency?.id ?? "",
    destination: version?.trip.destination ?? "",
    startDate: isoDate(version?.trip.startDate ?? ""),
    endDate: isoDate(version?.trip.endDate ?? ""),
    adults: version?.trip.passengers.adults ?? 1,
    children: version?.trip.passengers.children ?? 0,
    serviceLines:
      version?.serviceLines.map((line) => ({
        serviceType: line.serviceType,
        supplierId: line.supplierId ?? "",
        description: line.description,
        startDate: line.startDate ? isoDate(line.startDate) : "",
        endDate: line.endDate ? isoDate(line.endDate) : "",
      })) ?? [],
    proposalDescription: version?.supplierProposal?.description ?? "",
    includes: version?.supplierProposal?.includes.join(", ") ?? "",
    excludes: version?.supplierProposal?.excludes.join(", ") ?? "",
    finalPrice: version?.pricing.finalPrice ?? "",
    managementMode: version?.commissions.management.mode ?? "percentage",
    managementValue: version?.commissions.management.value ?? "10",
    agencyMode: version?.commissions.agency?.mode ?? "percentage",
    agencyValue: version?.commissions.agency?.value ?? "",
    conditions: version?.conditions ?? "",
    clientNotes: version?.clientNotes ?? "",
    internalNotes: version?.internalNotes ?? "",
    // El nombre y la vista previa llegan después, por la URL firmada: acá solo
    // importa QUÉ imágenes tiene la versión y en qué orden.
    annexImages: (version?.annexImageIds ?? []).map((id) => ({
      key: id,
      id,
      file: null,
      name: "",
    })),
    validUntil: isoDate(version?.validUntil ?? ""),
  };
}

function splitList(value: string): string[] {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

/**
 * Editor de cotizaciones · wireframe 05.
 *
 * La pantalla está partida a propósito: a la izquierda se trabaja y a la derecha
 * se ve **lo mismo que verá el cliente**. Las comisiones viven en un bloque
 * aparte, marcado como interno, y nunca aparecen en esa vista previa — es la
 * misma regla que cumple el PDF (Levantamiento Funcional · 8.2).
 */
export function QuoteEditor({
  quote,
  defaultClientId,
  onSaved,
  onCancel,
}: {
  /** Sin cotización es un alta; con cotización, una edición. */
  quote?: QuoteDetail | null;
  defaultClientId?: string | null;
  /** Si se pasa, la pantalla se queda donde está en vez de navegar. */
  onSaved?: (saved: QuoteDetail) => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const { user } = useSession();
  const editing = Boolean(quote);

  const initial = useMemo<Draft>(
    () => (quote ? draftFromQuote(quote) : emptyDraft(defaultClientId ?? "")),
    [quote, defaultClientId],
  );

  const [draft, setDraft] = useState<Draft>(initial);
  /**
   * Contra qué se compara el borrador para la guardia de salida.
   *
   * Es estado y no el memo porque los textos predeterminados llegan después,
   * por el API, y entran al borrador Y a la línea base a la vez: si solo
   * entraran al borrador, abrir el editor y cerrarlo sin tocar nada ya
   * preguntaría "¿salir y perderlos?" por un cambio que nadie hizo.
   */
  const [baseline, setBaseline] = useState<Draft>(initial);
  const [client, setClient] = useState<ClientSummary | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  /** Sugerencias de destino del catálogo del backoffice. */
  const [destinations, setDestinations] = useState<string[]>([]);
  /** Sucursales, solo para el expediente que llegó sin sucursal de origen. */
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ── Anexo de imágenes del PDF ────────────────────────────────────────────── */

  /** Vista previa y nombre por clave: URL local para las nuevas, firmada para las guardadas. */
  const [annexPreviews, setAnnexPreviews] = useState<
    Record<string, { url: string; name: string }>
  >({});
  const [annexError, setAnnexError] = useState<string | null>(null);
  const [annexDragOver, setAnnexDragOver] = useState(false);
  const annexInputRef = useRef<HTMLInputElement | null>(null);
  /** URLs de objeto creadas acá, para revocarlas al desmontar. */
  const annexObjectUrls = useRef<string[]>([]);
  /** Claves cuya URL firmada ya se pidió: un fallo no se reintenta en bucle. */
  const annexRequested = useRef(new Set<string>());

  useEffect(() => {
    crmApi
      .listSuppliers({ pageSize: 200 })
      .then((page) => setSuppliers(page.items))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    crmApi
      .quoteDestinations()
      .then((rows) => setDestinations(rows.map((row) => row.name)))
      .catch(() => undefined);
  }, []);

  // Textos predeterminados · solo al CREAR. Una edición muestra lo que la
  // versión ya tiene, y si el asesor escribió antes de que respondiera el API,
  // lo suyo manda: la precarga no pisa nada.
  useEffect(() => {
    if (editing) return;
    let vigente = true;
    crmApi
      .quoteDefaults()
      .then((defaults) => {
        if (!vigente || (!defaults.conditions && !defaults.clientNotes)) return;
        const apply = (prev: Draft): Draft =>
          prev.conditions || prev.clientNotes
            ? prev
            : {
                ...prev,
                conditions: defaults.conditions ?? "",
                clientNotes: defaults.clientNotes ?? "",
              };
        setDraft(apply);
        setBaseline(apply);
      })
      .catch(() => undefined);
    return () => {
      vigente = false;
    };
  }, [editing]);

  // Solo hace falta para el selector de responsable, que ven Gerente y
  // Administrador. Un Asesor cotiza siempre a su nombre.
  useEffect(() => {
    if (user?.role === "advisor") return;
    crmApi.team().then(setTeam).catch(() => undefined);
  }, [user?.role]);

  // El expediente precargado por `?clientId=` o el de la cotización que se está
  // editando: se pide de a uno para poder mostrar su nombre sin traer la cartera
  // entera, que era justamente lo que rompía el selector con más de 200 fichas.
  const clientId = draft.clientId;
  useEffect(() => {
    if (!clientId) {
      setClient(null);
      return;
    }
    let vigente = true;
    crmApi
      .getClient(clientId)
      .then((found) => {
        if (vigente) setClient(found);
      })
      .catch(() => undefined);
    return () => {
      vigente = false;
    };
  }, [clientId]);

  // El expediente sin sucursal de origen la recibe acá: es el último momento
  // en que puede faltar, porque el dashboard tabula los ingresos por sucursal.
  const needsBranch = Boolean(client && !client.branch);
  useEffect(() => {
    if (!needsBranch || branches.length > 0) return;
    crmApi
      .branches()
      .then(setBranches)
      .catch(() => undefined);
  }, [needsBranch, branches.length]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  /**
   * Suma imágenes al anexo, vengan del selector, de un arrastre o de Ctrl+V.
   *
   * Valida acá lo mismo que validará el backend —JPG o PNG, 10 MB, tope de
   * cantidad— para que el rechazo se vea al cargar y no al guardar.
   */
  function addAnnexImages(incoming: File[]) {
    if (incoming.length === 0 || submitting) return;

    const problems: string[] = [];
    let accepted: File[] = [];
    for (const file of incoming) {
      if (!ANNEX_MIME_TYPES.includes(file.type)) {
        problems.push(`"${file.name || "imagen"}" no es JPG ni PNG.`);
      } else if (file.size > ANNEX_MAX_BYTES) {
        problems.push(`"${file.name || "imagen"}" supera los 10 MB.`);
      } else {
        accepted.push(file);
      }
    }

    const room = ANNEX_MAX_IMAGES - draft.annexImages.length;
    if (accepted.length > room) {
      problems.push(`El anexo admite hasta ${ANNEX_MAX_IMAGES} imágenes.`);
      accepted = accepted.slice(0, Math.max(0, room));
    }

    if (accepted.length > 0) {
      const added = accepted.map((file, index) => {
        const url = URL.createObjectURL(file);
        annexObjectUrls.current.push(url);
        return {
          entry: {
            key: `local-${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`,
            id: "",
            file,
            name: file.name || "captura.png",
          },
          url,
        };
      });
      setAnnexPreviews((prev) => {
        const next = { ...prev };
        for (const item of added) next[item.entry.key] = { url: item.url, name: item.entry.name };
        return next;
      });
      setDraft((prev) => ({
        ...prev,
        annexImages: [...prev.annexImages, ...added.map((item) => item.entry)],
      }));
    }

    setAnnexError(problems.length > 0 ? problems.join(" ") : null);
  }

  // Ctrl+V en cualquier parte del editor: una captura recién tomada es el caso
  // que motivó el anexo. Un pegado de texto sigue su curso normal.
  const addAnnexImagesRef = useRef(addAnnexImages);
  addAnnexImagesRef.current = addAnnexImages;

  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      const files = Array.from(event.clipboardData?.items ?? [])
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));
      if (files.length === 0) return;
      event.preventDefault();
      addAnnexImagesRef.current(files);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  // Vista previa de las imágenes ya guardadas: URL firmada, pedida una sola vez.
  const annexImages = draft.annexImages;
  useEffect(() => {
    for (const entry of annexImages) {
      if (!entry.id || annexRequested.current.has(entry.key)) continue;
      annexRequested.current.add(entry.key);
      crmApi
        .fileUrl(entry.id)
        .then(({ url, fileName }) =>
          setAnnexPreviews((prev) =>
            prev[entry.key] ? prev : { ...prev, [entry.key]: { url, name: fileName } },
          ),
        )
        .catch(() => undefined);
    }
  }, [annexImages]);

  useEffect(
    () => () => {
      for (const url of annexObjectUrls.current) URL.revokeObjectURL(url);
    },
    [],
  );

  function removeAnnexImage(key: string) {
    setDraft((prev) => ({
      ...prev,
      annexImages: prev.annexImages.filter((entry) => entry.key !== key),
    }));
    setAnnexError(null);
  }

  function moveAnnexImage(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= draft.annexImages.length) return;
    setDraft((prev) => {
      const images = [...prev.annexImages];
      [images[index], images[target]] = [images[target], images[index]];
      return { ...prev, annexImages: images };
    });
  }

  /**
   * Sube las imágenes nuevas y devuelve los ids del anexo, en su orden.
   *
   * Cada subida queda anotada en el borrador apenas termina: si el guardado
   * posterior falla, el reintento reutiliza el id en vez de subirla de nuevo.
   */
  async function uploadPendingAnnexImages(): Promise<string[]> {
    const ids: string[] = [];
    const uploaded = new Map<string, string>();
    for (const entry of draft.annexImages) {
      if (entry.id) {
        ids.push(entry.id);
        continue;
      }
      if (!entry.file) continue;
      const stored = await crmApi.uploadFile(entry.file, {
        clientId: draft.clientId,
        fileType: "quote_annex",
      });
      uploaded.set(entry.key, stored.id);
      ids.push(stored.id);
    }
    if (uploaded.size > 0) {
      setDraft((prev) => ({
        ...prev,
        annexImages: prev.annexImages.map((entry) =>
          uploaded.has(entry.key)
            ? { ...entry, id: uploaded.get(entry.key)!, file: null }
            : entry,
        ),
      }));
    }
    return ids;
  }

  /**
   * Guardia de salida · hallazgo E2.
   *
   * Antes no había ninguna: "Cancelar", el botón atrás o cerrar la pestaña se
   * llevaban una cotización de diez líneas sin preguntar nada.
   */
  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(baseline),
    [draft, baseline],
  );
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty && !saved;

  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      if (!dirtyRef.current) return;
      event.preventDefault();
      // Los navegadores muestran su propio texto; lo que importa es prevenirlo.
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  function leave() {
    if (
      dirtyRef.current &&
      !window.confirm("Tenés cambios sin guardar. ¿Salir y perderlos?")
    ) {
      return;
    }
    if (onCancel) onCancel();
    else router.back();
  }

  /* ── Cálculo en vivo de la zona interna · HU-COT-06 ───────────────────────── */

  const utility = useMemo(() => {
    if (!isValidAmount(draft.finalPrice)) return null;

    const management = isValidAmount(draft.managementValue)
      ? commissionAmount(draft.finalPrice, {
          mode: draft.managementMode,
          value: draft.managementValue,
        })
      : "0.00";

    const agency =
      draft.quoteType === "supplier_package" && isValidAmount(draft.agencyValue)
        ? commissionAmount(draft.finalPrice, {
            mode: draft.agencyMode,
            value: draft.agencyValue,
          })
        : "0.00";

    return {
      management,
      agency,
      total: fromCents(toCents(management) + toCents(agency)),
    };
  }, [draft]);

  const exceedsPrice =
    utility !== null && toCents(utility.total) > toCents(draft.finalPrice || "0");

  const agencies = suppliers.filter((s) => s.type === "agency");

  /**
   * Reabrir una vencida exige vigencia futura, y el backend lo rechaza.
   * Decirlo acá evita completar el formulario entero para enterarse al guardar.
   */
  const reopening = quote?.status === "expired";

  const missing: string[] = [];
  if (!draft.clientId) missing.push("el cliente");
  if (needsBranch && !draft.branchId) missing.push("la sucursal de origen");
  if (!draft.destination.trim()) missing.push("el destino");
  if (!isValidAmount(draft.finalPrice)) missing.push("el precio final");
  if (draft.quoteType === "supplier_package") {
    if (!draft.supplierAgencyId) missing.push("la agencia proveedora");
    if (!draft.proposalDescription.trim()) missing.push("la propuesta");
  } else if (draft.serviceLines.every((line) => !line.description.trim())) {
    missing.push("al menos una línea de servicio");
  }

  /**
   * Avisos de fecha y pasajeros · hallazgo E3.
   *
   * Estas reglas ya vivían en el backend, pero solo se veían al guardar: se
   * podía llenar el formulario entero con el regreso antes de la salida y
   * recibir el rechazo al final.
   */
  const today = isoDate(new Date().toISOString());
  const problems: string[] = [];
  if (draft.startDate && draft.endDate && draft.endDate < draft.startDate) {
    problems.push("El regreso no puede ser anterior a la salida.");
  }
  if (draft.adults < 1) problems.push("Tiene que viajar al menos un adulto.");
  if (draft.validUntil && draft.validUntil < today) {
    problems.push("La vigencia ya pasó: la cotización nacería vencida.");
  }
  if (reopening && (!draft.validUntil || draft.validUntil <= today)) {
    problems.push("Para reabrirla, poné una vigencia posterior a hoy.");
  }

  /** Aviso, no bloqueo: una vigencia larga puede ser deliberada. */
  const validityAfterTrip =
    draft.validUntil && draft.startDate && draft.validUntil > draft.startDate;

  function buildPayload(): QuoteInput {
    return {
      clientId: draft.clientId,
      branchId: needsBranch ? draft.branchId || undefined : undefined,
      advisorId: draft.advisorId || undefined,
      quoteType: draft.quoteType,
      supplierAgencyId:
        draft.quoteType === "supplier_package" ? draft.supplierAgencyId : undefined,
      trip: {
        destination: draft.destination.trim(),
        startDate: draft.startDate,
        endDate: draft.endDate,
        passengers: { adults: draft.adults, children: draft.children },
      },
      serviceLines:
        draft.quoteType === "own_package"
          ? draft.serviceLines
              .filter((line) => line.description.trim())
              .map((line) => ({
                serviceType: line.serviceType,
                supplierId: line.supplierId || undefined,
                description: line.description.trim(),
                startDate: line.startDate || undefined,
                endDate: line.endDate || undefined,
              }))
          : undefined,
      supplierProposal:
        draft.quoteType === "supplier_package"
          ? {
              description: draft.proposalDescription.trim(),
              includes: splitList(draft.includes),
              excludes: splitList(draft.excludes),
            }
          : undefined,
      finalPrice: draft.finalPrice.trim(),
      managementCommission: {
        mode: draft.managementMode,
        value: draft.managementValue.trim() || "0",
      },
      agencyCommission:
        draft.quoteType === "supplier_package" && isValidAmount(draft.agencyValue)
          ? { mode: draft.agencyMode, value: draft.agencyValue.trim() }
          : null,
      conditions: draft.conditions.trim() || undefined,
      clientNotes: draft.clientNotes.trim() || undefined,
      internalNotes: draft.internalNotes.trim() || undefined,
      validUntil: draft.validUntil || undefined,
    };
  }

  /**
   * Cuerpo del PATCH · hallazgo C1.
   *
   * Un campo de texto vacío viaja como `null`, no como ausente: son cosas
   * distintas y el backend las trata distinto. Mandando `undefined`, borrar unas
   * condiciones no borraba nada —la versión nueva salía con el texto viejo— y no
   * había forma de quitar la comisión de la agencia.
   */
  function buildUpdate(payload: QuoteInput): QuoteUpdateInput {
    return {
      trip: payload.trip,
      serviceLines: payload.serviceLines,
      supplierProposal: payload.supplierProposal,
      finalPrice: payload.finalPrice,
      managementCommission: payload.managementCommission,
      agencyCommission: payload.agencyCommission ?? null,
      conditions: draft.conditions.trim() || null,
      clientNotes: draft.clientNotes.trim() || null,
      internalNotes: draft.internalNotes.trim() || null,
      // Siempre viaja: el arreglo vacío es lo que QUITA el anexo en el backend,
      // igual que `null` borra los textos.
      annexImageIds: payload.annexImageIds ?? [],
      validUntil: payload.validUntil,
    };
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      // Primero las imágenes: sin sus ids no hay payload completo que mandar.
      const annexImageIds = await uploadPendingAnnexImages();
      const payload = { ...buildPayload(), annexImageIds };
      const result = quote
        ? await crmApi.updateQuote(quote.id, buildUpdate(payload))
        : await crmApi.createQuote(payload);

      // Marca el borrador como guardado ANTES de navegar: si no, la guardia de
      // salida se dispara sobre los cambios que se acaban de persistir.
      setSaved(true);
      dirtyRef.current = false;

      if (onSaved) onSaved(result);
      else router.push(`/cotizaciones/${result.id}`);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "No se pudo guardar la cotización.",
      );
      setSubmitting(false);
    }
  }

  /* ── Líneas de servicio · HU-COT-03 ───────────────────────────────────────── */

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setDraft((prev) => ({
      ...prev,
      serviceLines: prev.serviceLines.map((line, i) =>
        i === index ? { ...line, ...patch } : line,
      ),
    }));
  }

  function moveLine(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= draft.serviceLines.length) return;
    setDraft((prev) => {
      const lines = [...prev.serviceLines];
      [lines[index], lines[target]] = [lines[target], lines[index]];
      return { ...prev, serviceLines: lines };
    });
  }

  return (
    <form onSubmit={handleSubmit} className="pagebody-split-420" style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        {error && (
          <div className="auth-alert error" role="alert">
            <Icon name="target" />
            <div>{error}</div>
          </div>
        )}

        {editing && reopening && (
          <div className="auth-alert info">
            <Icon name="calendar" />
            <div>
              Estás <b>reabriendo una cotización vencida</b>. Al guardar se emite la
              versión {quote ? quote.versionCount + 1 : 2} con la vigencia nueva y vuelve a
              borrador, lista para enviar. El historial se conserva completo.
            </div>
          </div>
        )}

        {editing && !reopening && quote?.status !== "draft" && (
          <div className="auth-alert info">
            <Icon name="doc" />
            <div>
              Esta cotización ya fue enviada. Al guardar se emite la{" "}
              <b>versión {quote ? quote.versionCount + 1 : 2}</b> y la anterior queda
              como constancia de lo que el cliente recibió.{" "}
              <b>La versión nueva no sale sola</b>: hay que enviarla.
            </div>
          </div>
        )}

        {/* La vista previa cae al final en móvil, así que se puede abrir desde
            acá sin recorrer todo el formulario (hallazgo G2). */}
        <button
          type="button"
          className="btn ghost qpreview-toggle"
          aria-expanded={showPreview}
          onClick={() => setShowPreview((current) => !current)}
        >
          <Icon name="eye" />
          {showPreview ? "Ocultar la vista del cliente" : "Ver lo que verá el cliente"}
        </button>

        {/* Cliente y viaje */}
        <div className="card">
          <div className="card-h">
            <span className="ttl">Cliente y viaje</span>
          </div>

          <div className="modal-grid">
            <div>
              <label className="label" htmlFor="clientId">
                Cliente *
              </label>
              <ClientPicker
                value={draft.clientId}
                selected={client}
                disabled={submitting}
                locked={editing}
                onSelect={(chosen) => {
                  setClient(chosen);
                  set("clientId", chosen?.id ?? "");
                }}
              />
              {editing ? (
                <div style={hint}>
                  <Icon name="lock" width={12} height={12} />
                  El cliente no cambia: es la identidad del documento.
                </div>
              ) : (
                <div style={hint}>
                  <Icon name="search" width={12} height={12} />
                  Se busca sobre la cartera completa, no sobre una lista recortada.
                </div>
              )}
            </div>

            <div>
              <label className="label" htmlFor="quoteType">
                Tipo de paquete
              </label>
              <select
                id="quoteType"
                className="input"
                value={draft.quoteType}
                onChange={(e) => set("quoteType", e.target.value as QuoteType)}
                disabled={submitting || editing}
              >
                {QUOTE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {QUOTE_TYPE_LABEL[type]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* El expediente llegó sin sucursal de origen (entró solo por un
              canal de Meta): cotizar es el último momento en que puede faltar,
              y lo que se elija queda guardado EN EL EXPEDIENTE. */}
          {needsBranch && (
            <div style={{ marginTop: 14 }}>
              <label className="label" htmlFor="branchId">
                Sucursal de origen *
              </label>
              <select
                id="branchId"
                className="input"
                required
                value={draft.branchId}
                onChange={(e) => set("branchId", e.target.value)}
                disabled={submitting}
              >
                <option value="">
                  {branches.length === 0 ? "Cargando sucursales…" : "Elegí la sucursal…"}
                </option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
              <div style={hint}>
                <Icon name="target" width={12} height={12} />
                Este expediente no tiene sucursal de origen; queda guardada en él
                y tabula los ingresos del dashboard.
              </div>
            </div>
          )}

          {/* Un Gerente puede cotizar a nombre de un asesor. El backend siempre
              lo admitió; sin este control, toda cotización creada por un gerente
              quedaba a su nombre y descuadraba el reporte por asesor. */}
          {!editing && user?.role !== "advisor" && team.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <label className="label" htmlFor="advisorId">
                Asesor responsable
              </label>
              <select
                id="advisorId"
                className="input"
                value={draft.advisorId}
                onChange={(e) => set("advisorId", e.target.value)}
                disabled={submitting}
              >
                <option value="">Yo ({user?.fullName ?? "quien cotiza"})</option>
                {team
                  .filter((member) => member.id !== user?.id)
                  .map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.fullName}
                    </option>
                  ))}
              </select>
              <div style={hint}>
                <Icon name="users" width={12} height={12} />
                Es a quien se le acredita la cotización en el reporte por asesor.
              </div>
            </div>
          )}

          <div className="modal-grid" style={{ marginTop: 14 }}>
            <div>
              <label className="label" htmlFor="destination">
                Destino *
              </label>
              {/* Sugerencias del catálogo del backoffice, SIN cerrar el campo:
                  un destino que no está en la lista se escribe igual y queda
                  solo en esta cotización. */}
              <input
                id="destination"
                className="input"
                required
                list="destino-sugerencias"
                value={draft.destination}
                onChange={(e) => set("destination", e.target.value)}
                placeholder="Cancún"
                disabled={submitting}
              />
              <datalist id="destino-sugerencias">
                {destinations.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="label" htmlFor="validUntil">
                Válida hasta
              </label>
              <input
                id="validUntil"
                type="date"
                className="input"
                value={draft.validUntil}
                onChange={(e) => set("validUntil", e.target.value)}
                disabled={submitting}
              />
              {!draft.validUntil ? (
                <div style={hint}>
                  <Icon name="calendar" width={12} height={12} />
                  Vacío = 30 días desde hoy.
                </div>
              ) : validityAfterTrip ? (
                <div style={{ ...hint, color: "var(--amber-deep, var(--text-mute))" }}>
                  <Icon name="target" width={12} height={12} />
                  La vigencia cae después de la salida del viaje.
                </div>
              ) : null}
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
              gap: 14,
              marginTop: 14,
            }}
          >
            <div>
              <label className="label" htmlFor="startDate">
                Salida
              </label>
              <input
                id="startDate"
                type="date"
                className="input"
                required
                value={draft.startDate}
                onChange={(e) => set("startDate", e.target.value)}
                disabled={submitting}
              />
            </div>
            <div>
              <label className="label" htmlFor="endDate">
                Regreso
              </label>
              <input
                id="endDate"
                type="date"
                className="input"
                required
                value={draft.endDate}
                onChange={(e) => set("endDate", e.target.value)}
                disabled={submitting}
              />
            </div>
            <div>
              <label className="label" htmlFor="adults">
                Adultos
              </label>
              <input
                id="adults"
                type="number"
                min={1}
                className="input"
                value={draft.adults === 0 ? "" : draft.adults}
                onChange={(e) => set("adults", e.target.value === "" ? 0 : Number(e.target.value))}
                disabled={submitting}
              />
            </div>
            <div>
              <label className="label" htmlFor="children">
                Menores
              </label>
              <input
                id="children"
                type="number"
                min={0}
                className="input"
                value={draft.children}
                onChange={(e) =>
                  set("children", e.target.value === "" ? 0 : Number(e.target.value))
                }
                disabled={submitting}
              />
            </div>
          </div>
        </div>

        {/* Contenido según el tipo · HU-COT-03 y HU-COT-04 */}
        {draft.quoteType === "own_package" ? (
          <div className="card">
            <div className="card-h">
              <span className="ttl">Servicios incluidos</span>
              <button
                type="button"
                className="btn ghost tiny"
                disabled={submitting}
                onClick={() =>
                  setDraft((prev) => ({
                    ...prev,
                    serviceLines: [
                      ...prev.serviceLines,
                      {
                        serviceType: "hotel",
                        supplierId: "",
                        description: "",
                        startDate: "",
                        endDate: "",
                      },
                    ],
                  }))
                }
              >
                <Icon name="plus" />
                Agregar
              </button>
            </div>

            {draft.serviceLines.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--text-mute)" }}>
                Agregá al menos un servicio: son las líneas que verá el cliente.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {draft.serviceLines.map((line, index) => (
                  <div key={index} className="qline">
                    <select
                      className="input"
                      value={line.serviceType}
                      onChange={(e) =>
                        updateLine(index, { serviceType: e.target.value as ServiceType })
                      }
                      disabled={submitting}
                      aria-label={`Tipo de servicio ${index + 1}`}
                    >
                      {SERVICE_TYPES.map((service) => (
                        <option key={service} value={service}>
                          {SERVICE_TYPE_LABEL[service]}
                        </option>
                      ))}
                    </select>

                    <input
                      className="input"
                      value={line.description}
                      onChange={(e) => updateLine(index, { description: e.target.value })}
                      placeholder="Vuelo SAL–CUN ida y vuelta, equipaje incluido"
                      disabled={submitting}
                      aria-label={`Descripción ${index + 1}`}
                    />

                    <select
                      className="input"
                      value={line.supplierId}
                      onChange={(e) => updateLine(index, { supplierId: e.target.value })}
                      disabled={submitting}
                      aria-label={`Proveedor ${index + 1}`}
                    >
                      <option value="">Sin proveedor</option>
                      {suppliers
                        .filter(
                          (s) =>
                            s.type === "tourism_service" &&
                            s.serviceTypes.includes(line.serviceType),
                        )
                        .map((supplier) => (
                          <option key={supplier.id} value={supplier.id}>
                            {supplier.name}
                          </option>
                        ))}
                    </select>

                    {/* Plegadas hasta que se piden: la mayoría de las líneas no
                        las necesita y desplegarlas siempre ensancharía la fila
                        para todo el mundo. */}
                    <details className="qline-dates">
                      <summary aria-label={`Fechas del servicio ${index + 1}`}>
                        <Icon name="calendar" width={12} height={12} />
                        {line.startDate || line.endDate ? "Con fechas" : "Fechas"}
                      </summary>
                      <div className="qline-dates-body">
                        <label className="label" htmlFor={`lineStart-${index}`}>
                          Desde
                        </label>
                        <input
                          id={`lineStart-${index}`}
                          type="date"
                          className="input"
                          value={line.startDate}
                          onChange={(e) => updateLine(index, { startDate: e.target.value })}
                          disabled={submitting}
                        />
                        <label className="label" htmlFor={`lineEnd-${index}`}>
                          Hasta
                        </label>
                        <input
                          id={`lineEnd-${index}`}
                          type="date"
                          className="input"
                          value={line.endDate}
                          onChange={(e) => updateLine(index, { endDate: e.target.value })}
                          disabled={submitting}
                        />
                      </div>
                    </details>

                    <span className="qline-actions" style={{ display: "flex", gap: 4 }}>
                      <button
                        type="button"
                        className="iconbtn"
                        onClick={() => moveLine(index, -1)}
                        disabled={submitting || index === 0}
                        aria-label="Subir"
                      >
                        <Icon name="arrow-up" />
                      </button>
                      <button
                        type="button"
                        className="iconbtn"
                        onClick={() => moveLine(index, 1)}
                        disabled={submitting || index === draft.serviceLines.length - 1}
                        aria-label="Bajar"
                      >
                        <Icon name="arrow-down" />
                      </button>
                      <button
                        type="button"
                        className="iconbtn"
                        onClick={() =>
                          setDraft((prev) => ({
                            ...prev,
                            serviceLines: prev.serviceLines.filter((_, i) => i !== index),
                          }))
                        }
                        disabled={submitting}
                        aria-label="Quitar"
                      >
                        <Icon name="trash" />
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="card">
            <div className="card-h">
              <span className="ttl">Propuesta de la agencia</span>
            </div>

            <label className="label" htmlFor="supplierAgencyId">
              Agencia proveedora *
            </label>
            <select
              id="supplierAgencyId"
              className="input"
              value={draft.supplierAgencyId}
              onChange={(e) => set("supplierAgencyId", e.target.value)}
              disabled={submitting || editing}
            >
              <option value="">Elegí la agencia…</option>
              {agencies.map((agency) => (
                <option key={agency.id} value={agency.id}>
                  {agency.name}
                </option>
              ))}
            </select>

            <label className="label" htmlFor="proposalDescription" style={{ marginTop: 14 }}>
              Descripción del paquete *
            </label>
            <textarea
              id="proposalDescription"
              className="input"
              rows={3}
              style={{ resize: "vertical", lineHeight: 1.6 }}
              value={draft.proposalDescription}
              onChange={(e) => set("proposalDescription", e.target.value)}
              placeholder="Paquete todo incluido 7 noches en hotel 5 estrellas…"
              disabled={submitting}
            />

            <div className="modal-grid" style={{ marginTop: 14 }}>
              <div>
                <label className="label" htmlFor="includes">
                  Incluye
                </label>
                <input
                  id="includes"
                  className="input"
                  value={draft.includes}
                  onChange={(e) => set("includes", e.target.value)}
                  placeholder="Vuelo, Hotel, Traslados"
                  disabled={submitting}
                />
              </div>
              <div>
                <label className="label" htmlFor="excludes">
                  No incluye
                </label>
                <input
                  id="excludes"
                  className="input"
                  value={draft.excludes}
                  onChange={(e) => set("excludes", e.target.value)}
                  placeholder="Seguro de viaje, propinas"
                  disabled={submitting}
                />
              </div>
            </div>
            <div style={hint}>
              <Icon name="tag" width={12} height={12} />
              Separá cada punto con una coma.
            </div>
          </div>
        )}

        {/* Zona visible al cliente */}
        <div className="card">
          <div className="card-h">
            <span className="ttl">Texto para el cliente</span>
            <span className="chip blue">Sale en el PDF</span>
          </div>

          <label className="label" htmlFor="conditions">
            Condiciones
          </label>
          <textarea
            id="conditions"
            className="input"
            rows={2}
            style={{ resize: "vertical", lineHeight: 1.6 }}
            value={draft.conditions}
            onChange={(e) => set("conditions", e.target.value)}
            placeholder="Precios sujetos a disponibilidad al momento de reservar."
            disabled={submitting}
          />

          <label className="label" htmlFor="clientNotes" style={{ marginTop: 14 }}>
            Nota para el cliente
          </label>
          <textarea
            id="clientNotes"
            className="input"
            rows={2}
            style={{ resize: "vertical", lineHeight: 1.6 }}
            value={draft.clientNotes}
            onChange={(e) => set("clientNotes", e.target.value)}
            placeholder="Incluye traslados aeropuerto–hotel."
            disabled={submitting}
          />
        </div>

        {/* Anexo de imágenes del PDF: va entre las condiciones y las notas */}
        <div className="card">
          <div className="card-h">
            <span className="ttl">Anexo de imágenes</span>
            <span className="chip blue">Sale en el PDF · opcional</span>
          </div>

          <div
            role="button"
            tabIndex={0}
            aria-label="Agregar imágenes al anexo"
            onClick={() => annexInputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                annexInputRef.current?.click();
              }
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setAnnexDragOver(true);
            }}
            onDragLeave={() => setAnnexDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setAnnexDragOver(false);
              addAnnexImages(Array.from(event.dataTransfer.files));
            }}
            style={{
              border: `2px dashed ${annexDragOver ? "var(--orange)" : "var(--border)"}`,
              background: annexDragOver ? "var(--orange-pale)" : "var(--bg-app)",
              borderRadius: 10,
              padding: "16px 14px",
              textAlign: "center",
              cursor: "pointer",
              transition: "border-color .15s, background .15s",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              Arrastrá una imagen, pegala con Ctrl+V o hacé clic para elegirla
            </div>
            <div style={{ fontSize: 12, color: "var(--text-mute)", marginTop: 4 }}>
              JPG o PNG · hasta 10 MB cada una · máximo {ANNEX_MAX_IMAGES}. Salen en el
              PDF entre las condiciones y las notas.
            </div>
          </div>
          <input
            ref={annexInputRef}
            type="file"
            accept="image/png,image/jpeg"
            multiple
            hidden
            onChange={(event) => {
              addAnnexImages(Array.from(event.target.files ?? []));
              // Permite volver a elegir el mismo archivo tras quitarlo.
              event.target.value = "";
            }}
            disabled={submitting}
          />

          {annexError && (
            <div style={{ ...hint, color: "var(--red)" }} role="alert">
              <Icon name="target" width={12} height={12} />
              {annexError}
            </div>
          )}

          {draft.annexImages.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
              {draft.annexImages.map((entry, index) => {
                const preview = annexPreviews[entry.key];
                const name = entry.name || preview?.name || `Imagen ${index + 1}`;
                return (
                  <div
                    key={entry.key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      border: "1px solid var(--border)",
                      borderRadius: 10,
                      padding: 6,
                    }}
                  >
                    <div
                      style={{
                        width: 88,
                        height: 56,
                        flex: "none",
                        borderRadius: 6,
                        overflow: "hidden",
                        background: "var(--bg-app)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--text-mute)",
                      }}
                    >
                      {preview ? (
                        /* Vistas previas locales y URLs firmadas que caducan:
                           next/image no aplica acá. */
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={preview.url}
                          alt={name}
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                      ) : (
                        <Icon name="image" />
                      )}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={name}
                      >
                        {name}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-mute)" }}>
                        {entry.file
                          ? "Se sube al guardar"
                          : "Guardada en el expediente"}
                      </div>
                    </div>
                    <span style={{ display: "flex", gap: 4, flex: "none" }}>
                      <button
                        type="button"
                        className="iconbtn"
                        onClick={() => moveAnnexImage(index, -1)}
                        disabled={submitting || index === 0}
                        aria-label="Subir en el anexo"
                      >
                        <Icon name="arrow-up" />
                      </button>
                      <button
                        type="button"
                        className="iconbtn"
                        onClick={() => moveAnnexImage(index, 1)}
                        disabled={submitting || index === draft.annexImages.length - 1}
                        aria-label="Bajar en el anexo"
                      >
                        <Icon name="arrow-down" />
                      </button>
                      <button
                        type="button"
                        className="iconbtn"
                        onClick={() => removeAnnexImage(entry.key)}
                        disabled={submitting}
                        aria-label="Quitar del anexo"
                      >
                        <Icon name="trash" />
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Zona interna */}
        <div className="card" style={{ borderColor: "var(--navy-soft, var(--border))" }}>
          <div className="card-h">
            <span className="ttl">Precio y comisiones</span>
            <span className="chip">
              <Icon name="lock" width={11} height={11} />
              Interno · nunca sale al cliente
            </span>
          </div>

          <div className="modal-grid">
            <div>
              <label className="label" htmlFor="finalPrice">
                Precio final al cliente (USD) *
              </label>
              <input
                id="finalPrice"
                className="input"
                inputMode="decimal"
                required
                value={draft.finalPrice}
                onChange={(e) => set("finalPrice", e.target.value)}
                placeholder="2500.00"
                disabled={submitting}
              />
            </div>
            <div>
              <label className="label">Utilidad total</label>
              <div
                className="input"
                style={{
                  fontWeight: 800,
                  color: exceedsPrice ? "var(--red)" : "var(--green)",
                  background: "var(--bg-app)",
                }}
              >
                {utility ? `$${utility.total}` : "—"}
              </div>
            </div>
          </div>

          <CommissionRow
            title="Comisión de gestión"
            mode={draft.managementMode}
            value={draft.managementValue}
            amount={utility?.management ?? null}
            disabled={submitting}
            onMode={(mode) => set("managementMode", mode)}
            onValue={(value) => set("managementValue", value)}
          />

          {draft.quoteType === "supplier_package" && (
            <CommissionRow
              title="Comisión de la agencia"
              mode={draft.agencyMode}
              value={draft.agencyValue}
              amount={utility?.agency ?? null}
              disabled={submitting}
              onMode={(mode) => set("agencyMode", mode)}
              onValue={(value) => set("agencyValue", value)}
            />
          )}

          {exceedsPrice && (
            <div className="auth-alert error" style={{ marginTop: 14 }}>
              <Icon name="target" />
              <div>La utilidad supera el precio final. Revisá las comisiones.</div>
            </div>
          )}

          <label className="label" htmlFor="internalNotes" style={{ marginTop: 14 }}>
            Notas internas
          </label>
          <textarea
            id="internalNotes"
            className="input"
            rows={2}
            style={{ resize: "vertical", lineHeight: 1.6 }}
            value={draft.internalNotes}
            onChange={(e) => set("internalNotes", e.target.value)}
            placeholder="Margen negociable hasta 8 %, el cliente pidió salida por la mañana…"
            disabled={submitting}
          />
        </div>

        {problems.length > 0 && (
          <div className="auth-alert error" role="alert">
            <Icon name="target" />
            <div>
              {problems.map((problem) => (
                <div key={problem}>{problem}</div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button type="button" className="btn ghost" onClick={leave} disabled={submitting}>
            Cancelar
          </button>
          <button
            type="submit"
            className="btn primary"
            disabled={
              submitting || missing.length > 0 || problems.length > 0 || exceedsPrice
            }
            title={missing.length > 0 ? `Falta ${missing.join(", ")}` : undefined}
          >
            {submitting
              ? "Guardando…"
              : reopening
                ? "Reabrir con esta versión"
                : editing && quote?.status !== "draft"
                  ? "Guardar nueva versión"
                  : "Guardar borrador"}
          </button>
        </div>

        {missing.length > 0 && (
          <div style={{ ...hint, justifyContent: "flex-end" }}>
            <Icon name="target" width={12} height={12} />
            Falta {missing.join(", ")}.
          </div>
        )}
      </div>

      {/* Vista previa: exactamente lo que verá el cliente */}
      <ClientPreview
        draft={draft}
        clientName={client?.fullName ?? "—"}
        collapsed={!showPreview}
        annexUrls={draft.annexImages
          .map((entry) => annexPreviews[entry.key]?.url)
          .filter((url): url is string => Boolean(url))}
      />
    </form>
  );
}

function CommissionRow({
  title,
  mode,
  value,
  amount,
  disabled,
  onMode,
  onValue,
}: {
  title: string;
  mode: CommissionMode;
  value: string;
  amount: string | null;
  disabled: boolean;
  onMode: (mode: CommissionMode) => void;
  onValue: (value: string) => void;
}) {
  return (
    <div style={{ marginTop: 14 }}>
      <span className="label">{title}</span>
      <div className="qcommission">
        <select
          className="input"
          value={mode}
          onChange={(e) => onMode(e.target.value as CommissionMode)}
          disabled={disabled}
          aria-label={`Modo de ${title.toLowerCase()}`}
        >
          {COMMISSION_MODES.map((option) => (
            <option key={option} value={option}>
              {COMMISSION_MODE_LABEL[option]}
            </option>
          ))}
        </select>
        <input
          className="input"
          inputMode="decimal"
          value={value}
          onChange={(e) => onValue(e.target.value)}
          placeholder={mode === "percentage" ? "10" : "150.00"}
          disabled={disabled}
          aria-label={`Valor de ${title.toLowerCase()}`}
        />
        <div
          className="input"
          style={{ background: "var(--bg-app)", color: "var(--text-mute)", fontWeight: 600 }}
        >
          {amount ? `$${amount}` : "—"}
        </div>
      </div>
    </div>
  );
}

/**
 * Vista previa del documento.
 *
 * Muestra lo mismo que el PDF: viaje, servicios, precio final y textos. Ninguna
 * comisión entra acá — si aparece una, el error se ve al instante.
 */
function ClientPreview({
  draft,
  clientName,
  collapsed,
  annexUrls,
}: {
  draft: Draft;
  clientName: string;
  /** Solo aplica en móvil; en escritorio la columna siempre está a la vista. */
  collapsed: boolean;
  /** Vistas previas del anexo, en el orden en que saldrán en el PDF. */
  annexUrls: string[];
}) {
  const travelers =
    draft.children > 0
      ? `${draft.adults} adulto(s) y ${draft.children} menor(es)`
      : `${draft.adults} adulto(s)`;

  return (
    <div className={`qpreview${collapsed ? " is-collapsed" : ""}`}>
      <div className="card" style={{ padding: 0, overflow: "hidden", position: "sticky", top: 14 }}>
        <div
          style={{
            background: "var(--navy)",
            color: "#fff",
            padding: "16px 18px",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div style={{ lineHeight: 1.1 }}>
            <b style={{ fontSize: 14, fontWeight: 800 }}>VIVA TRAVEL</b>
            <div style={{ fontSize: 9, color: "#8FA3C9", letterSpacing: "0.2em" }}>
              EL SALVADOR
            </div>
          </div>
          <div style={{ marginLeft: "auto", fontSize: 11, color: "#8FA3C9" }}>
            Vista del cliente
          </div>
        </div>

        <div style={{ padding: "16px 18px" }}>
          <div
            style={{
              fontSize: 11,
              color: "var(--text-mute)",
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            Cotización para
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, marginTop: 4 }}>{clientName}</div>
          <div style={{ fontSize: 12, color: "var(--text-mute)", marginTop: 2 }}>
            {draft.destination || "Destino por definir"} · {travelers}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-mute)" }}>
            {previewDate(draft.startDate)} al {previewDate(draft.endDate)}
          </div>

          <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 8 }}>
            {draft.quoteType === "own_package"
              ? draft.serviceLines
                  .filter((line) => line.description.trim())
                  .map((line, index) => (
                    <div key={index} style={{ fontSize: 12, display: "flex", gap: 8 }}>
                      <span style={{ color: "var(--orange-deep)", fontWeight: 700, flex: "none" }}>
                        {SERVICE_TYPE_LABEL[line.serviceType]}
                      </span>
                      <span>
                        {line.description}
                        {line.startDate && line.endDate && (
                          <span style={{ color: "var(--text-mute)" }}>
                            {" · "}
                            {previewDate(line.startDate)} – {previewDate(line.endDate)}
                          </span>
                        )}
                      </span>
                    </div>
                  ))
              : draft.proposalDescription && (
                  <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                    {draft.proposalDescription}
                  </div>
                )}

            {draft.quoteType === "supplier_package" && splitList(draft.includes).length > 0 && (
              <div style={{ fontSize: 12, marginTop: 6 }}>
                <b>Incluye:</b> {splitList(draft.includes).join(", ")}
              </div>
            )}
            {draft.quoteType === "supplier_package" && splitList(draft.excludes).length > 0 && (
              <div style={{ fontSize: 12, color: "var(--text-mute)" }}>
                <b>No incluye:</b> {splitList(draft.excludes).join(", ")}
              </div>
            )}
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: 16,
              paddingTop: 14,
              borderTop: "1px solid var(--border)",
              alignItems: "baseline",
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--navy)" }}>
              Precio final
            </span>
            <span style={{ fontSize: 22, fontWeight: 800, color: "var(--orange)" }}>
              {isValidAmount(draft.finalPrice) ? formatMoney(draft.finalPrice) : "$—"}{" "}
              <span style={{ fontSize: 12, color: "var(--text-mute)", fontWeight: 500 }}>
                USD
              </span>
            </span>
          </div>

          {/* La vigencia y la nota al cliente salen en el PDF y faltaban acá: la
              vista previa prometía fidelidad y no la cumplía (hallazgo E4). */}
          {draft.validUntil && (
            <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-mute)", textAlign: "right" }}>
              Válida hasta {previewDate(draft.validUntil)}
            </div>
          )}

          {draft.clientNotes && (
            <div
              style={{
                marginTop: 14,
                fontSize: 12,
                lineHeight: 1.7,
                whiteSpace: "pre-wrap",
              }}
            >
              {draft.clientNotes}
            </div>
          )}

          {draft.conditions && (
            <div
              style={{
                marginTop: 14,
                fontSize: 11,
                color: "var(--text-mute)",
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
              }}
            >
              {draft.conditions}
            </div>
          )}

          {annexUrls.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-mute)",
                  fontWeight: 600,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                }}
              >
                Anexo
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
                {annexUrls.map((url, index) => (
                  /* Igual que en el editor: URLs locales o firmadas, next/image
                     no aplica. */
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={`${url}-${index}`}
                    src={url}
                    alt={`Imagen ${index + 1} del anexo`}
                    style={{
                      width: "100%",
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      display: "block",
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <div
          style={{
            background: "var(--orange-pale)",
            padding: "12px 18px",
            fontSize: 11,
            color: "var(--text-mute)",
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          <Icon name="lock" width={12} height={12} />
          Las comisiones y las notas internas no aparecen acá ni en el PDF.
        </div>
      </div>
    </div>
  );
}

/** Igual que el PDF: `es-SV` con el mes escrito, no la fecha ISO en crudo. */
function previewDate(value: string): string {
  if (!value) return "—";
  // El valor viene como `2026-09-18`; interpretarlo como UTC y formatearlo así
  // evita que la zona horaria lo corra un día hacia atrás.
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("es-SV", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

const hint = {
  fontSize: 12,
  color: "var(--text-mute)",
  marginTop: 8,
  display: "flex",
  gap: 6,
  alignItems: "center",
} as const;

