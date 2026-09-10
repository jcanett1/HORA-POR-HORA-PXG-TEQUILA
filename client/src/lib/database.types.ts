export type UserRole = "operador" | "supervisor" | "administrador";
export type MatchResult = "coincide" | "discrepancia" | "no_encontrado" | "duplicado";
export type SupervisorStatus = "pendiente" | "confirmado" | "rechazado" | "cancelado";
export type DocumentStatus = "cargado" | "procesando" | "validado" | "activo" | "archivado" | "error";

export type Profile = {
  id: string;
  nombre_completo: string;
  numero_empleado: string | null;
  rol: UserRole;
  planta: string;
  area: string;
  activo: boolean;
  created_at: string;
  updated_at: string;
};

export type CaptureRow = {
  id: string;
  usuario_id: string;
  fecha_hora_captura: string;
  turno_id: string | null;
  planta: string;
  area: string;
  orden_original: string;
  numero_parte_original: string;
  sh_original: string;
  orden_normalizada: string;
  numero_parte_normalizada: string;
  sh_normalizado: string;
  documento_id_validacion: string | null;
  dato_referencia_id: string | null;
  resultado_match: MatchResult;
  motivo_discrepancia: string | null;
  estatus_supervisor: SupervisorStatus;
  fecha_revision: string | null;
  revisado_por: string | null;
  observaciones: string | null;
  idempotency_key: string | null;
  created_at: string;
  perfiles_usuarios?: { nombre_completo: string } | null;
};

export type MasterDocument = {
  id: string;
  nombre_archivo: string;
  tipo_archivo: string;
  hash_archivo: string | null;
  usuario_carga_id: string | null;
  fecha_carga: string;
  planta: string;
  area: string;
  estatus_importacion: DocumentStatus;
  total_filas: number;
  filas_validas: number;
  filas_con_error: number;
  ruta_storage: string | null;
  fecha_activacion: string | null;
  activado_por: string | null;
  notas: string | null;
  created_at: string;
  updated_at: string;
};

export type Shift = {
  id: string;
  nombre: string;
  codigo: string | null;
  hora_inicio: string;
  hora_fin: string;
  zona_horaria: string;
  activo: boolean;
};

export type Database = {
  public: {
    Tables: {
      perfiles_usuarios: { Row: Profile; Insert: Partial<Profile> & Pick<Profile, "id">; Update: Partial<Profile> };
      registros_captura: { Row: CaptureRow; Insert: Partial<CaptureRow>; Update: Partial<CaptureRow> };
      documentos_maestros: { Row: MasterDocument; Insert: Partial<MasterDocument>; Update: Partial<MasterDocument> };
      turnos: { Row: Shift; Insert: Partial<Shift>; Update: Partial<Shift> };
      datos_referencia: { Row: Record<string, unknown>; Insert: Record<string, unknown>; Update: Record<string, unknown> };
      acciones_revision: { Row: Record<string, unknown>; Insert: Record<string, unknown>; Update: Record<string, unknown> };
    };
    Functions: {
      registrar_captura: {
        Args: {
          p_orden: string;
          p_numero_parte: string;
          p_sh: string;
          p_planta?: string;
          p_area?: string;
          p_turno_id?: string | null;
          p_observaciones?: string | null;
          p_idempotency_key?: string | null;
        };
        Returns: CaptureRow[];
      };
      confirmar_revision: {
        Args: {
          p_registro_id: string;
          p_nuevo_estatus: SupervisorStatus;
          p_motivo?: string | null;
          p_observaciones?: string | null;
        };
        Returns: CaptureRow;
      };
      activar_documento: { Args: { p_documento_id: string }; Returns: MasterDocument };
    };
  };
};
